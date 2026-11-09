const assert = require("node:assert/strict");
module.exports = async function checkTiling(page) {
  const result = await page.evaluate(async () => {
    const { GPUBoids } = await import("./gpu.js");
    const settings = boidsTest.settings(),
      definitions = boidsTest.parameterSchema();
    for (const name of [
      "alignment",
      "repulsion",
      "swarm",
      "flee",
      "wind",
      "shoal",
    ])
      settings[name + "-enabled"] = 0;
    Object.assign(settings, {
      "cohesion-enabled": 1,
      "cohesion-radius": 128,
      "cohesion-weight": 1,
      "turn-rate": 720,
      speed: 70,
      "wind-octaves": 6,
      "wind-scale": 160,
    });
    let world = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    document.body.append(canvas);
    const errors = [];
    const engine = await GPUBoids.create(canvas, definitions, {
      settings: () => settings,
      worldSize: () => world,
      population: () => 100000,
      predatorCount: () => 0,
      residentCount: () => 0,
      step: () => {},
      huntDensity: () => {},
      onError: (m) => errors.push(m),
    });
    try {
      const d = engine.device;
      const data = new Float32Array(engine.count * 8);
      let wrong = 0,
        tested = 0;
      const seamPositions = [
        [1, 1],
        [1023, 1],
        [1, 1023],
        [1023, 1023],
        [3, 6],
        [1018, 3],
        [2, 1019],
        [1019, 1021],
      ];
      for (let i = 0; i < engine.count; i++) {
        const k = i * 8,
          position = seamPositions[i] || [512, 512];
        data[k] = position[0];
        data[k + 1] = position[1];
        data[k + 2] = 70;
        data[k + 6] = 1;
      }
      for (const buffer of engine.states) d.queue.writeBuffer(buffer, 0, data);
      engine.writeConfig(0, settings, 0.25, 0);
      const sparse = d.createCommandEncoder();
      for (const [name, groups] of [
        ["clearCells", 8],
        ["binBoids", Math.ceil(engine.count / 128)],
        ["preparePlans", 1],
        ["advance", 1],
      ])
        engine.dispatch(sparse, name, 0, groups);
      d.queue.submit([sparse.finish()]);
      await d.queue.onSubmittedWorkDone();
      engine.current = 1 - engine.current;
      const sparseOut = new Float32Array(await engine.snapshot());
      let sparseErrors = 0;
      for (let i = 0; i < seamPositions.length; i++) {
        let x = 0,
          y = 0;
        const wrap = (v) => (v >= 512 ? v - 1024 : v < -512 ? v + 1024 : v);
        for (let j = 0; j < seamPositions.length; j++)
          if (i !== j) {
            x += wrap(seamPositions[j][0] - seamPositions[i][0]);
            y += wrap(seamPositions[j][1] - seamPositions[i][1]);
          }
        const length = Math.hypot(x, y);
        if (
          Math.hypot(
            sparseOut[i * 8 + 2] - (70 * x) / length,
            sparseOut[i * 8 + 3] - (70 * y) / length,
          ) > 0.001
        )
          sparseErrors++;
      }
      // Reversed logical order makes a first-arrival reservoir particularly biased.
      for (const phase of [0, 17, 505]) {
        for (let i = 0; i < engine.count; i++) {
          const k = i * 8;
          data[k] = ((i < 256 ? 512 : i < 10256 ? 544 : 480) + phase) % 1024;
          data[k + 1] = 512;
          data[k + 2] = 70;
          data[k + 6] = 1;
        }
        for (let epoch = 0; epoch < 8; epoch++) {
          for (const buffer of engine.states)
            d.queue.writeBuffer(buffer, 0, data);
          engine.ticks = epoch;
          engine.writeConfig(0, settings, 0.25, 0);
          const enc = d.createCommandEncoder();
          for (const [name, groups] of [
            ["clearCells", 8],
            ["binBoids", Math.ceil(engine.count / 128)],
            ["preparePlans", 1],
            ["advance", 2],
          ])
            engine.dispatch(enc, name, 0, groups);
          d.queue.submit([enc.finish()]);
          await d.queue.onSubmittedWorkDone();
          engine.current = 1 - engine.current;
          const out = new Float32Array(await engine.snapshot());
          for (let i = 0; i < 256; i++) {
            tested++;
            if (out[i * 8 + 2] > -69) wrong++;
          }
        }
      }
      // Compile a diagnostic entry point against the production wind sampler.
      let source = await (await fetch("./gpu-sim.wgsl")).text();
      const constants = definitions
        .map(
          (s) =>
            `const P_${s.name.toUpperCase().replaceAll("-", "_")}:u32=${s.id}u;`,
        )
        .join("\n");
      source = source
        .replace("// PARAMETER_CONSTANTS", constants)
        .replaceAll("PARAMETER_VECTORS", String(engine.parameterVectors));
      source +=
        "\n@compute @workgroup_size(128) fn probeWind(@builtin(global_invocation_id) gid:vec3<u32>){if(gid.x<128u){var b=stateIn.values[gid.x];b.velocity=windAt(b.position);stateOut.values[gid.x]=b;}}";
      engine.pipelines.probeWind = await d.createComputePipelineAsync({
        layout: d.createPipelineLayout({
          bindGroupLayouts: [engine.computeLayout],
        }),
        compute: {
          module: d.createShaderModule({ code: source }),
          entryPoint: "probeWind",
        },
      });
      let maxJump = 0,
        maxDerivativeError = 0,
        invalid = 0;
      const h = 0.05;
      for (const scale of [16, 160, 512])
        for (const size of [1024, 512, 256]) {
          world = size;
          settings["wind-scale"] = scale;
          engine.world = size;
          engine.ticks = 7;
          engine.windFrame = -1;
          engine.writeConfig(0, settings, 1 / 60, 0);
          const positions = [];
          for (const axis of [0, 1])
            for (const boundary of [0, size / 128, size / 2, size])
              for (const offset of [-h, 0, h]) {
                const v = (((boundary + offset) % size) + size) % size;
                positions.push(axis ? [size * 0.371, v] : [v, size * 0.371]);
              }
          for (let i = 0; i < positions.length; i++) {
            data[i * 8] = positions[i][0];
            data[i * 8 + 1] = positions[i][1];
          }
          for (const buffer of engine.states)
            d.queue.writeBuffer(buffer, 0, data);
          const enc = d.createCommandEncoder();
          engine.dispatch(
            enc,
            "updateWind",
            0,
            (scale < 32 ? 256 : scale < 64 ? 128 : 64) ** 2 / 128,
          );
          engine.dispatch(enc, "probeWind", 0, 1);
          d.queue.submit([enc.finish()]);
          await d.queue.onSubmittedWorkDone();
          engine.current = 1 - engine.current;
          const out = new Float32Array(await engine.snapshot());
          for (let i = 0; i < positions.length; i += 3) {
            const v = [0, 1, 2].map((j) => [
              out[(i + j) * 8 + 2],
              out[(i + j) * 8 + 3],
            ]);
            if (!v.flat().every(Number.isFinite)) invalid++;
            maxJump = Math.max(
              maxJump,
              Math.hypot(v[2][0] - v[0][0], v[2][1] - v[0][1]),
            );
            maxDerivativeError = Math.max(
              maxDerivativeError,
              Math.hypot(
                v[2][0] - 2 * v[1][0] + v[0][0],
                v[2][1] - 2 * v[1][1] + v[0][1],
              ) / h,
            );
          }
        }
      return {
        wrong,
        tested,
        sparseErrors,
        maxJump,
        maxDerivativeError,
        invalid,
        errors: [...errors, ...engine.errors],
      };
    } finally {
      engine.device.destroy();
      canvas.remove();
    }
  });
  assert.equal(result.sparseErrors, 0, JSON.stringify(result));
  assert(result.wrong / result.tested < 0.01, JSON.stringify(result));
  assert.equal(result.invalid, 0, JSON.stringify(result));
  assert(result.maxDerivativeError < 0.04, JSON.stringify(result));
  assert.equal(result.errors.length, 0, JSON.stringify(result));
  console.log(
    "PASS: GPU density-weighted sampling and smooth tiled wind",
    result,
  );
};
