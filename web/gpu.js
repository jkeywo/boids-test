// WebGPU boid state never crosses back to the CPU during normal simulation.
const DEFAULT_COUNT = 100000,
  STRIDE = 32,
  MAX_STEPS = 4;
const aligned = (n, alignment = 256) => Math.ceil(n / alignment) * alignment;
export class GPUBoids {
  static async create(canvas, definitions, bridge) {
    if (!navigator.gpu)
      throw new Error("WebGPU is unavailable in this browser.");
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw new Error("No WebGPU adapter is available.");
    const timers = adapter.features.has("timestamp-query");
    const device = await adapter.requestDevice({
      requiredFeatures: timers ? ["timestamp-query"] : [],
    });
    const engine = new GPUBoids(
      canvas,
      definitions,
      bridge,
      adapter,
      device,
      timers,
    );
    try {
      await engine.initialize();
      return engine;
    } catch (error) {
      device.destroy();
      throw error;
    }
  }
  constructor(canvas, definitions, bridge, adapter, device, timers) {
    this.canvas = canvas;
    this.definitions = definitions;
    this.parameterVectors = Math.ceil(definitions.length / 4);
    this.configBytes = 80 + this.parameterVectors * 16;
    this.uniformStride = aligned(this.configBytes);
    this.bridge = bridge;
    this.device = device;
    this.timers = timers;
    this.adapter = Object.fromEntries(
      [
        "vendor",
        "architecture",
        "device",
        "description",
        "isFallbackAdapter",
      ].map((key) => [key, adapter.info?.[key]]),
    );
    this.count = bridge.population?.() || DEFAULT_COUNT;
    this.capacity = this.count;
    this.spawnStart = 0;
    this.swapRemainder = 0;
    this.swapSerial = 0;
    this.swappedBoids = 0;
    this.budget = 32;
    this.current = 0;
    this.ticks = 0;
    this.completedTicks = 0;
    this.frames = 0;
    this.completedFrames = 0;
    this.inflight = 0;
    this.accumulator = 0;
    this.world = bridge.worldSize();
    this.gpuMs = null;
    this.submitMs = 0;
    this.windSignature = "";
    this.windFrame = -1;
    this.lost = false;
    this.mapping = false;
    this.mappingDensity = false;
    this.lastDensityTick = -6;
    this.densityEpoch = 0;
    this.densityReads = 0;
    this.errors = [];
    device.addEventListener("uncapturederror", (event) => {
      this.errors.push(event.error.message);
      this.lost = true;
      bridge.onError(event.error.message);
    });
    device.lost.then((info) => {
      if (info.reason !== "destroyed") {
        this.lost = true;
        bridge.onError(info.message || "GPU device lost.");
      }
    });
  }
  async initialize() {
    const d = this.device;
    this.context = this.canvas.getContext("webgpu");
    if (!this.context)
      throw new Error("WebGPU canvas context could not be created.");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: d,
      format: this.format,
      alphaMode: "opaque",
    });
    this.uniform = d.createBuffer({
      label: "Per-tick configuration",
      size: this.uniformStride * MAX_STEPS,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.states = [0, 1].map((i) =>
      d.createBuffer({
        label: `Boid state ${i}`,
        size: this.count * STRIDE,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.COPY_SRC |
          GPUBufferUsage.COPY_DST,
      }),
    );
    this.cellCounts = d.createBuffer({
      label: "Cell counts",
      size: 1024 * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    this.huntDensity = d.createBuffer({
      label: "32x32 hunt density (no boid readback)",
      size: 4096,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.readDensity = d.createBuffer({
      size: 4096,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    this.neighbourPlans = d.createBuffer({
      label: "Shared neighbour sampling plans",
      size: 1024 * 9 * 9 * 16,
      usage: GPUBufferUsage.STORAGE,
    });
    this.configArena = new ArrayBuffer(this.configBytes);
    this.predatorArena = new Float32Array(32 * 8);
    this.cellIndices = d.createBuffer({
      label: "Bounded spatial representatives",
      size: 1024 * 128 * 4,
      usage: GPUBufferUsage.STORAGE,
    });
    this.wind = d.createBuffer({
      label: "GPU Perlin wind keyframes",
      size: 256 * 256 * 16,
      usage: GPUBufferUsage.STORAGE,
    });
    this.predatorCapacity = 32;
    this.predatorStride = aligned(this.predatorCapacity * 32);
    this.predators = d.createBuffer({
      label: "Predators per tick",
      size: this.predatorStride * MAX_STEPS,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.computeLayout = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: this.configBytes,
          },
        },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((binding) => ({
          binding,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: [1, 6].includes(binding) ? "read-only-storage" : "storage",
            hasDynamicOffset: binding === 6,
          },
        })),
      ],
    });
    this.renderLayout = d.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: "uniform",
            hasDynamicOffset: true,
            minBindingSize: this.configBytes,
          },
        },
        ...[1, 2, 3].map((binding) => ({
          binding,
          visibility: GPUShaderStage.VERTEX,
          buffer: {
            type: "read-only-storage",
            hasDynamicOffset: binding === 3,
          },
        })),
      ],
    });
    const constants = this.definitions
      .map(
        (spec) =>
          `const P_${spec.name.toUpperCase().replaceAll("-", "_")}:u32=${spec.id}u;`,
      )
      .join("\n");
    const [computeSource, renderSource] = await Promise.all(
      ["gpu-sim.wgsl", "gpu-render.wgsl"].map(async (file) => {
        const response = await fetch(new URL(file, import.meta.url));
        if (!response.ok) throw new Error(`Unable to load ${file}`);
        return response.text();
      }),
    );
    const configureShader = (source) =>
      source
        .replace("// PARAMETER_CONSTANTS", constants)
        .replaceAll("PARAMETER_VECTORS", String(this.parameterVectors));
    const compute = d.createShaderModule({
      label: "Spatial boids compute",
      code: configureShader(computeSource),
    });
    const render = d.createShaderModule({
      label: "GPU boid renderer",
      code: configureShader(renderSource),
    });
    for (const module of [compute, render]) {
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === "error");
      if (errors.length)
        throw new Error(
          errors
            .map((m) => `${m.lineNum}:${m.linePos} ${m.message}`)
            .join("\n"),
        );
    }
    d.pushErrorScope("validation");
    const layout = d.createPipelineLayout({
      bindGroupLayouts: [this.computeLayout],
    });
    const entries = [
      "initialize",
      "swapState",
      "rescale",
      "clearCells",
      "binBoids",
      "preparePlans",
      "updateWind",
      "advance",
    ];
    this.pipelines = Object.fromEntries(
      await Promise.all(
        entries.map(async (entry) => [
          entry,
          await d.createComputePipelineAsync({
            label: entry,
            layout,
            compute: { module: compute, entryPoint: entry },
          }),
        ]),
      ),
    );
    this.renderPipeline = await d.createRenderPipelineAsync({
      label: "100,000 instanced triangles",
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.renderLayout] }),
      vertex: { module: render, entryPoint: "vertex" },
      fragment: {
        module: render,
        entryPoint: "fragment",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });
    const validation = await d.popErrorScope();
    if (validation) throw new Error(validation.message);
    this.buildGroups();
    if (this.timers) {
      this.queries = d.createQuerySet({
        type: "timestamp",
        count: MAX_STEPS * 2 + 2,
      });
      this.resolveBuffer = d.createBuffer({
        size: 256,
        usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
      });
      this.readTimer = d.createBuffer({
        size: 80,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
    }
    const settings = this.bridge.settings();
    this.world = this.bridge.worldSize();
    this.writeConfig(0, settings, 0, 0, 1);
    const encoder = d.createCommandEncoder();
    this.dispatch(encoder, "initialize", 0, Math.ceil(this.count / 128));
    encoder.copyBufferToBuffer(
      this.states[1],
      0,
      this.states[0],
      0,
      this.count * STRIDE,
    );
    d.queue.submit([encoder.finish()]);
    await d.queue.onSubmittedWorkDone();
  }
  buildGroups() {
    const d = this.device;
    this.computeGroups = [0, 1].map((i) =>
      d.createBindGroup({
        layout: this.computeLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: this.uniform, size: this.configBytes },
          },
          { binding: 1, resource: { buffer: this.states[i] } },
          { binding: 2, resource: { buffer: this.states[1 - i] } },
          { binding: 3, resource: { buffer: this.cellCounts } },
          { binding: 4, resource: { buffer: this.cellIndices } },
          { binding: 5, resource: { buffer: this.wind } },
          { binding: 7, resource: { buffer: this.huntDensity } },
          { binding: 8, resource: { buffer: this.neighbourPlans } },
          {
            binding: 6,
            resource: { buffer: this.predators, size: this.predatorStride },
          },
        ],
      }),
    );
    this.renderGroups = [0, 1].map((i) =>
      d.createBindGroup({
        layout: this.renderLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: this.uniform, size: this.configBytes },
          },
          { binding: 1, resource: { buffer: this.states[i] } },
          { binding: 2, resource: { buffer: this.states[1 - i] } },
          {
            binding: 3,
            resource: { buffer: this.predators, size: this.predatorStride },
          },
        ],
      }),
    );
  }
  ensurePredators(count) {
    if (count <= this.predatorCapacity) return;
    this.predatorCapacity = Math.max(count, this.predatorCapacity * 2);
    this.predatorStride = aligned(this.predatorCapacity * 32);
    const old = this.predators;
    this.predators = this.device.createBuffer({
      size: this.predatorStride * MAX_STEPS,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.buildGroups();
    old.destroy();
  }
  setPopulation(wanted) {
    this.resizeWorld(this.bridge.settings());
    wanted = Math.max(10000, Math.min(1000000, Math.round(wanted)));
    if (wanted === this.count) return;
    const oldCount = this.count,
      oldStates = this.states;
    const encoder = this.device.createCommandEncoder();
    if (wanted > this.capacity) {
      this.capacity = Math.min(1000000, Math.max(wanted, this.capacity * 2));
      this.states = [0, 1].map(() =>
        this.device.createBuffer({
          size: this.capacity * STRIDE,
          usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_SRC |
            GPUBufferUsage.COPY_DST,
        }),
      );
      for (let i = 0; i < 2; i++)
        encoder.copyBufferToBuffer(
          oldStates[i],
          0,
          this.states[i],
          0,
          oldCount * STRIDE,
        );
      this.buildGroups();
    }
    this.count = wanted;
    this.densityEpoch++;
    this.lastDensityTick = -6;
    if (wanted > oldCount) {
      this.spawnStart = oldCount;
      this.writeConfig(0, this.bridge.settings(), 0, 0);
      this.dispatch(
        encoder,
        "initialize",
        0,
        Math.ceil((wanted - oldCount) / 128),
      );
      encoder.copyBufferToBuffer(
        this.states[1 - this.current],
        oldCount * STRIDE,
        this.states[this.current],
        oldCount * STRIDE,
        (wanted - oldCount) * STRIDE,
      );
      this.spawnStart = 0;
    }
    this.device.queue.submit([encoder.finish()]);
    if (oldStates !== this.states)
      oldStates.forEach((buffer) => buffer.destroy());
  }
  writeConfig(slot, settings, dt, alpha, ratio = 1) {
    const buffer = this.configArena,
      f = new Float32Array(buffer),
      u = new Uint32Array(buffer);
    const world = this.bridge.worldSize();
    let radius = 0;
    for (const rule of ["cohesion", "alignment", "repulsion"])
      if (settings[rule + "-enabled"] && settings[rule + "-weight"] > 0)
        radius = Math.max(radius, (settings[rule + "-radius"] * world) / 1024);
    let side = 32;
    while (side > 2 && world / side < radius) side /= 2;
    const predatorCount = this.bridge.predatorCount();
    f.set([world, dt, this.ticks / 60, alpha], 0);
    u.set([this.count, side, this.budget, predatorCount], 4);
    const hunting =
      settings["predator-mode"] === 2 && this.bridge.residentCount() > 0;
    u.set(
      [this.ticks, (this.ticks * 7919) % this.count, Number(hunting), 0],
      8,
    );
    const turn = ((settings["turn-rate"] * Math.PI) / 180) * dt;
    f[2] = Math.sin(turn * settings["shoal-turn"]);
    f.set(
      [
        ratio,
        Math.cos(turn),
        Math.sin(turn),
        Math.cos(turn * settings["shoal-turn"]),
      ],
      12,
    );
    u[11] = Number(
      this.windFrame >= 0 && this.windFrame + 1 === Math.floor(this.ticks / 4),
    );
    for (const spec of this.definitions)
      f[16 + spec.id] =
        settings[spec.name] * (spec.unit?.startsWith("u") ? world / 1024 : 1);
    for (const name of ["shoal-rearm", "shoal-threshold"]) {
      const spec = this.definitions.find((p) => p.name === name);
      f[16 + spec.id] = Math.cos((settings[name] * Math.PI) / 180);
    }
    u.set([this.spawnStart, 0, 0, 0], 16 + this.parameterVectors * 4);
    this.device.queue.writeBuffer(
      this.uniform,
      slot * this.uniformStride,
      buffer,
    );
    const length = Math.max(8, predatorCount * 8);
    if (this.predatorArena.length < length)
      this.predatorArena = new Float32Array(length * 2);
    const data = this.predatorArena.subarray(0, length);
    for (let i = 0; i < predatorCount; i++) {
      const p = this.bridge.predator(i);
      data.set(
        [
          p.x,
          p.y,
          Math.cos(p.heading),
          Math.sin(p.heading),
          p.avoidanceX,
          p.avoidanceY,
          0,
          0,
        ],
        i * 8,
      );
    }
    this.device.queue.writeBuffer(
      this.predators,
      slot * this.predatorStride,
      data,
    );
    return { radius, predatorCount, hunting, side };
  }
  dispatch(encoder, name, slot, groups, timestamps) {
    const descriptor = { label: name };
    if (timestamps) descriptor.timestampWrites = timestamps;
    const pass = encoder.beginComputePass(descriptor);
    pass.setPipeline(this.pipelines[name]);
    pass.setBindGroup(0, this.computeGroups[this.current], [
      slot * this.uniformStride,
      slot * this.predatorStride,
    ]);
    pass.dispatchWorkgroups(groups);
    pass.end();
  }
  resizeWorld(settings) {
    const wanted = this.bridge.worldSize();
    if (wanted === this.world) return;
    this.ensurePredators(this.bridge.predatorCount());
    this.writeConfig(0, settings, 0, 0, wanted / this.world);
    const encoder = this.device.createCommandEncoder();
    this.dispatch(encoder, "rescale", 0, Math.ceil(this.count / 128));
    encoder.copyBufferToBuffer(
      this.states[1 - this.current],
      0,
      this.states[this.current],
      0,
      this.count * STRIDE,
    );
    this.device.queue.submit([encoder.finish()]);
    this.world = wanted;
    this.densityEpoch++;
    this.lastDensityTick = -6;
    this.accumulator = 0;
    this.windFrame = -1;
  }
  frame(dt) {
    if (this.lost) return;
    const begin = performance.now();
    const settings = this.bridge.settings();
    const hunting =
      settings["predator-mode"] === 2 && this.bridge.residentCount() > 0;
    if (hunting !== this.wasHunting) {
      this.wasHunting = hunting;
      this.densityEpoch++;
      this.lastDensityTick = -6;
    }
    this.resizeWorld(settings);
    this.accumulator = Math.min(
      this.accumulator + Math.max(0, Math.min(dt, 0.1)),
      4 / 60,
    );
    if (this.inflight >= 2) {
      this.accumulator = Math.min(this.accumulator, 1 / 30);
      return;
    }
    this.ensurePredators(this.bridge.predatorCount());
    const encoder = this.device.createCommandEncoder();
    let steps = 0;
    const timing =
      this.timers &&
      !this.mapping &&
      (this.profileEveryFrame || this.frames % 30 === 0) &&
      this.accumulator >= 1 / 60;
    const windSignature = [
      "wind-enabled",
      "wind-octaves",
      "wind-scale",
      "wind-time",
      "wind-persistence",
      "wind-lacunarity",
    ]
      .map((k) => settings[k])
      .join(",");
    if (windSignature !== this.windSignature) {
      this.windFrame = -1;
      this.windSignature = windSignature;
    }
    while (this.accumulator >= 1 / 60 && steps < MAX_STEPS) {
      this.bridge.step(1 / 60);
      this.ticks++;
      const config = this.writeConfig(
        steps,
        settings,
        1 / 60,
        Math.max(0, this.accumulator * 60 - 1),
      );
      if (settings["swarm-enabled"] && settings["swarm-swap-rate"] > 0) {
        this.swapRemainder += settings["swarm-swap-rate"] / 120;
        const pairs = Math.floor(this.swapRemainder + 1e-6);
        this.swapRemainder -= pairs;
        if (pairs > 0) {
          const u = new Uint32Array(this.configArena),
            half = Math.ceil(Math.ceil(Math.log2(this.count)) / 2);
          u.set(
            [0, pairs, Math.imul(++this.swapSerial, 0x9e3779b9) >>> 0, half],
            16 + this.parameterVectors * 4,
          );
          this.device.queue.writeBuffer(
            this.uniform,
            steps * this.uniformStride,
            this.configArena,
          );
          encoder.copyBufferToBuffer(
            this.states[this.current],
            0,
            this.states[1 - this.current],
            0,
            this.count * STRIDE,
          );
          this.dispatch(encoder, "swapState", steps, Math.ceil(pairs / 128));
          this.current = 1 - this.current;
          this.swappedBoids += pairs * 2;
        }
      } else this.swapRemainder = 0;
      this.dispatch(
        encoder,
        "clearCells",
        steps,
        8,
        timing
          ? { querySet: this.queries, beginningOfPassWriteIndex: steps * 2 }
          : undefined,
      );
      if (config.radius > 0 || config.hunting)
        this.dispatch(encoder, "binBoids", steps, Math.ceil(this.count / 128));
      if (config.radius > 0)
        this.dispatch(
          encoder,
          "preparePlans",
          steps,
          Math.ceil((config.side * config.side) / 128),
        );
      if (
        settings["wind-enabled"] &&
        settings["wind-weight"] > 0 &&
        (this.windFrame < 0 ||
          (settings["wind-time"] > 0 &&
            this.windFrame !== Math.floor(this.ticks / 4)))
      ) {
        const windSide =
          settings["wind-scale"] < 32
            ? 256
            : settings["wind-scale"] < 64
              ? 128
              : 64;
        this.dispatch(
          encoder,
          "updateWind",
          steps,
          (windSide * windSide) / 128,
        );
        this.windFrame = Math.floor(this.ticks / 4);
      }
      this.dispatch(
        encoder,
        "advance",
        steps,
        Math.ceil(this.count / 128),
        timing
          ? { querySet: this.queries, endOfPassWriteIndex: steps * 2 + 1 }
          : undefined,
      );
      this.current = 1 - this.current;
      this.accumulator -= 1 / 60;
      steps++;
    }
    // The last tick's uniform supplies the same settings and interpolation for render.
    const renderSlot = Math.max(0, steps - 1);
    if (steps === 0)
      this.writeConfig(
        renderSlot,
        settings,
        1 / 60,
        Math.min(1, this.accumulator * 60),
      );
    else
      this.device.queue.writeBuffer(
        this.uniform,
        renderSlot * this.uniformStride + 12,
        new Float32Array([Math.min(1, this.accumulator * 60)]),
      );
    const hue = settings["boid-hue"] / 60;
    const channel = (shift) =>
      0.065 *
      (1 -
        0.615 *
          Math.max(0, Math.min(1, Math.abs(((hue + shift) % 6) - 3) - 1)));
    const pass = encoder.beginRenderPass({
      label: "100,000 boids",
      ...(timing
        ? {
            timestampWrites: {
              querySet: this.queries,
              beginningOfPassWriteIndex: steps * 2,
              endOfPassWriteIndex: steps * 2 + 1,
            },
          }
        : {}),
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: channel(3), g: channel(1), b: channel(5), a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderGroups[this.current], [
      renderSlot * this.uniformStride,
      renderSlot * this.predatorStride,
    ]);
    pass.draw(3, this.count + this.bridge.predatorCount());
    pass.end();
    if (timing) {
      encoder.resolveQuerySet(
        this.queries,
        0,
        steps * 2 + 2,
        this.resolveBuffer,
        0,
      );
      encoder.copyBufferToBuffer(this.resolveBuffer, 0, this.readTimer, 0, 80);
      this.mapping = true;
    }
    const densityRead =
      settings["predator-mode"] === 2 &&
      this.bridge.residentCount() > 0 &&
      steps > 0 &&
      !this.mappingDensity &&
      this.ticks - this.lastDensityTick >= 6;
    const densityWorld = this.world,
      densityEpoch = this.densityEpoch;
    if (densityRead) {
      encoder.copyBufferToBuffer(
        this.huntDensity,
        0,
        this.readDensity,
        0,
        4096,
      );
      this.mappingDensity = true;
      this.lastDensityTick = this.ticks;
    }
    this.device.queue.submit([encoder.finish()]);
    if (densityRead)
      this.readDensity
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          if (
            densityEpoch === this.densityEpoch &&
            densityWorld === this.world
          ) {
            this.bridge.huntDensity(
              new Uint32Array(this.readDensity.getMappedRange()),
              densityWorld,
            );
            this.densityReads++;
          }
          this.readDensity.unmap();
          this.mappingDensity = false;
        })
        .catch(() => {
          this.mappingDensity = false;
        });
    this.frames++;
    this.inflight++;
    this.device.queue
      .onSubmittedWorkDone()
      .then(() => {
        this.inflight--;
        this.completedFrames++;
        this.completedTicks += steps;
      })
      .catch((error) => this.bridge.onError(error.message));
    if (timing)
      this.readTimer
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          const values = new BigUint64Array(this.readTimer.getMappedRange());
          let total = 0;
          for (let i = 0; i < steps; i++)
            total += Number(values[i * 2 + 1] - values[i * 2]);
          this.gpuMs = total / steps / 1e6;
          const render =
            Number(values[steps * 2 + 1] - values[steps * 2]) / 1e6;
          this.profileCompute = (this.profileCompute || 0) + total / 1e6;
          this.profileRender = (this.profileRender || 0) + render;
          this.profileSamples = (this.profileSamples || 0) + 1;
          this.profileSteps = (this.profileSteps || 0) + steps;
          this.readTimer.unmap();
          this.mapping = false;
        })
        .catch(() => {
          this.mapping = false;
        });
    this.submitMs = performance.now() - begin;
  }
  resetClock() {
    this.accumulator = 0;
    this.densityEpoch++;
    this.lastDensityTick = -6;
  }
  async snapshot() {
    await this.device.queue.onSubmittedWorkDone();
    const buffer = this.device.createBuffer({
      size: this.count * STRIDE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      this.states[this.current],
      0,
      buffer,
      0,
      this.count * STRIDE,
    );
    this.device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const copy = buffer.getMappedRange().slice(0);
    buffer.unmap();
    buffer.destroy();
    return copy;
  }
  stats() {
    return {
      population: this.count,
      swappedBoids: this.swappedBoids,
      densityReads: this.densityReads,
      steps: this.completedTicks,
      submittedSteps: this.ticks,
      submittedFrames: this.frames,
      completedFrames: this.completedFrames,
      gpuMs: this.gpuMs,
      cpuSubmitMs: this.submitMs,
      budget: this.budget,
      adapter: this.adapter,
      inflight: this.inflight,
      errors: [...this.errors],
    };
  }
}
