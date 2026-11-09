const assert = require("node:assert/strict");
module.exports = async function checkEllipse(page) {
  const result = await page.evaluate(async () => {
    const { GPUBoids } = await import("./gpu.js");
    const settings = boidsTest.settings();
    const definitions = boidsTest.parameterSchema();
    for (const name of [
      "cohesion",
      "alignment",
      "repulsion",
      "swarm",
      "wind",
      "shoal",
    ])
      settings[name + "-enabled"] = 0;
    Object.assign(settings, {
      "flee-enabled": 1,
      "flee-radius": 80,
      "flee-side-radius": 20,
      "flee-weight": 5,
      "flee-prediction": 0.5,
      "turn-rate": 720,
      speed: 70,
    });
    const predators = [
      { x: 1000, y: 512, heading: 0, avoidanceX: 26, avoidanceY: 512 },
      {
        x: 500,
        y: 1020,
        heading: Math.PI / 2,
        avoidanceX: 500,
        avoidanceY: 36,
      },
    ];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    canvas.style.display = "none";
    document.body.append(canvas);
    const errors = [];
    let world = 1024;
    const engine = await GPUBoids.create(canvas, definitions, {
      settings: () => settings,
      worldSize: () => world,
      predatorCount: () => predators.length,
      residentCount: () => 0,
      predator: (i) => {
        const p = predators[i],
          scale = world / 1024;
        return {
          ...p,
          x: p.x * scale,
          y: p.y * scale,
          avoidanceX: p.avoidanceX * scale,
          avoidanceY: p.avoidanceY * scale,
        };
      },
      step: () => {},
      huntDensity: () => {},
      onError: (message) => errors.push(message),
    });
    try {
      const before = new Float32Array(await engine.snapshot());
      const fixtures = before.slice(0, 5 * 8);
      [
        [26, 512],
        [66, 512],
        [26, 522],
        [106, 512],
        [26, 537],
      ].forEach(([x, y], i) => {
        fixtures[i * 8] = x;
        fixtures[i * 8 + 1] = y;
      });
      before.set(fixtures);
      const verify = (before, after, inverse) => {
        const wrapDelta = (d) =>
          d >= 512 ? d - 1024 : d < -512 ? d + 1024 : d;
        let affected = 0,
          outside = 0,
          projectedOnly = 0,
          shortExcluded = 0,
          mismatches = 0,
          maximumError = 0;
        for (let i = 0; i < 100000; i++) {
          const a = i * 8,
            x = before[a] * inverse,
            y = before[a + 1] * inverse;
          let fx = 0,
            fy = 0,
            inside = false;
          for (const predator of predators) {
            const dx = wrapDelta(x - predator.avoidanceX),
              dy = wrapDelta(y - predator.avoidanceY);
            const forward = [
                Math.cos(predator.heading),
                Math.sin(predator.heading),
              ],
              side = [-forward[1], forward[0]];
            const u = (dx * forward[0] + dy * forward[1]) / 80,
              v = (dx * side[0] + dy * side[1]) / 20,
              q = u * u + v * v;
            if (q < 1) {
              inside = true;
              let nx = side[0],
                ny = side[1];
              if (q >= 1e-8) {
                nx = (forward[0] * u) / 80 + (side[0] * v) / 20;
                ny = (forward[1] * u) / 80 + (side[1] * v) / 20;
                const factor = (1 - Math.sqrt(q)) / Math.hypot(nx, ny);
                nx *= factor;
                ny *= factor;
              }
              fx += nx * 5;
              fy += ny * 5;
              if (
                wrapDelta(x - predator.x) ** 2 +
                  wrapDelta(y - predator.y) ** 2 >
                80 ** 2
              )
                projectedOnly++;
            } else if (dx * dx + dy * dy < 80 ** 2) shortExcluded++;
          }
          if (inside) affected++;
          else outside++;
          const original = Math.atan2(before[a + 3], before[a + 2]);
          let wanted =
              Math.hypot(fx, fy) < 1e-5 ? original : Math.atan2(fy, fx),
            error = wanted - original;
          if (error > Math.PI) error -= 2 * Math.PI;
          if (error < -Math.PI) error += 2 * Math.PI;
          const heading =
            original + Math.max(-Math.PI / 15, Math.min(Math.PI / 15, error));
          const difference = Math.hypot(
            after[a + 2] * inverse - Math.cos(heading) * 70,
            after[a + 3] * inverse - Math.sin(heading) * 70,
          );
          maximumError = Math.max(maximumError, difference);
          if (difference > 0.01) mismatches++;
        }
        return {
          affected,
          outside,
          projectedOnly,
          shortExcluded,
          mismatches,
          maximumError,
          errors: [...errors, ...engine.errors],
        };
      };
      const maps = [];
      for (const size of [1024, 512, 256]) {
        world = size;
        engine.resizeWorld(settings);
        engine.resetClock();
        engine.ticks = 0;
        const scale = world / 1024,
          scaled = before.slice();
        for (let i = 0; i < 100000; i++)
          for (let j = 0; j < 4; j++) scaled[i * 8 + j] *= scale;
        for (const buffer of engine.states)
          engine.device.queue.writeBuffer(buffer, 0, scaled);
        engine.frame(1 / 60);
        await engine.device.queue.onSubmittedWorkDone();
        const after = new Float32Array(await engine.snapshot());
        const config = new Float32Array(engine.configArena);
        const uniformValid = definitions
          .filter((d) => d.unit.startsWith("u"))
          .every(
            (d) =>
              Math.abs(config[16 + d.id] - settings[d.name] * scale) < 0.0001,
          );
        maps.push({ size, uniformValid, ...verify(scaled, after, 1 / scale) });
      }
      // Read actual rasterised sprites at a fixed backing resolution. All other
      // boids overlap in the corner so the central boid/predator crops are isolated.
      canvas.width = canvas.height = 1024;
      engine.context.configure({
        device: engine.device,
        format: engine.format,
        alphaMode: "opaque",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      predators[0].x = predators[0].y = 512;
      const pixels = [];
      for (const size of [1024, 512, 256]) {
        world = size;
        engine.resizeWorld(settings);
        engine.resetClock();
        const scale = size / 1024,
          glyphs = before.slice();
        for (let i = 0; i < 100000; i++) {
          glyphs[i * 8] = 0;
          glyphs[i * 8 + 1] = 0;
        }
        glyphs[0] = 256 * scale;
        glyphs[1] = 512 * scale;
        glyphs[2] = 70 * scale;
        glyphs[3] = 0;
        for (const buffer of engine.states)
          engine.device.queue.writeBuffer(buffer, 0, glyphs);
        const texture = engine.context.getCurrentTexture();
        engine.frame(0);
        const read = engine.device.createBuffer({
          size: 1024 * 1024 * 4,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        const encoder = engine.device.createCommandEncoder();
        encoder.copyTextureToBuffer(
          { texture },
          { buffer: read, bytesPerRow: 4096 },
          [1024, 1024],
        );
        engine.device.queue.submit([encoder.finish()]);
        await read.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(read.getMappedRange());
        const count = (cx, cy, r) => {
          let n = 0;
          for (let y = cy - r; y < cy + r; y++)
            for (let x = cx - r; x < cx + r; x++) {
              const p = (x + y * 1024) * 4;
              if (Math.max(data[p], data[p + 1], data[p + 2]) > 40) n++;
            }
          return n;
        };
        pixels.push({
          size,
          boid: count(256, 512, 10),
          predator: count(512, 512, 20),
        });
        read.unmap();
        read.destroy();
        await engine.device.queue.onSubmittedWorkDone();
      }
      return { ...maps[0], maps, pixels };
    } finally {
      engine.device.destroy();
      canvas.remove();
    }
  });
  for (const map of result.maps) {
    assert.equal(map.mismatches, 0, JSON.stringify(map));
    assert(map.uniformValid, JSON.stringify(map));
    assert.equal(map.errors.length, 0, JSON.stringify(map));
  }
  for (const pixels of result.pixels) {
    assert(pixels.boid > 0 && pixels.predator > 0, JSON.stringify(pixels));
    assert.equal(
      pixels.boid,
      result.pixels[0].boid,
      JSON.stringify(result.pixels),
    );
    assert.equal(
      pixels.predator,
      result.pixels[0].predator,
      JSON.stringify(result.pixels),
    );
  }
  assert.equal(result.mismatches, 0, JSON.stringify(result));
  assert.equal(result.errors.length, 0, JSON.stringify(result));
  assert(
    result.affected > 100 &&
      result.outside > 90000 &&
      result.projectedOnly > 20 &&
      result.shortExcluded > 100,
    JSON.stringify(result),
  );
  console.log(
    "PASS: GPU predicted ellipse matches independent per-boid reference",
    result,
  );
};
