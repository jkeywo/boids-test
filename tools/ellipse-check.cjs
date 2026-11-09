const assert = require("node:assert/strict");
module.exports = async function checkEllipse(page) {
  const result = await page.evaluate(async () => {
    const { GPUBoids } = await import("./gpu.js");
    const settings = boidsTest.settings();
    const definitions = Object.keys(settings).map((name, id) => ({ name, id }));
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
    const engine = await GPUBoids.create(canvas, definitions, {
      settings: () => settings,
      worldSize: () => 1024,
      predatorCount: () => predators.length,
      residentCount: () => 0,
      predator: (i) => predators[i],
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
      for (const buffer of engine.states)
        engine.device.queue.writeBuffer(buffer, 0, fixtures);
      engine.frame(1 / 60);
      await engine.device.queue.onSubmittedWorkDone();
      const after = new Float32Array(await engine.snapshot());
      const wrapDelta = (d) => (d >= 512 ? d - 1024 : d < -512 ? d + 1024 : d);
      let affected = 0,
        outside = 0,
        projectedOnly = 0,
        shortExcluded = 0,
        mismatches = 0,
        maximumError = 0;
      for (let i = 0; i < 100000; i++) {
        const a = i * 8,
          x = before[a],
          y = before[a + 1];
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
              wrapDelta(x - predator.x) ** 2 + wrapDelta(y - predator.y) ** 2 >
              80 ** 2
            )
              projectedOnly++;
          } else if (dx * dx + dy * dy < 80 ** 2) shortExcluded++;
        }
        if (inside) affected++;
        else outside++;
        const original = Math.atan2(before[a + 3], before[a + 2]);
        let wanted = Math.hypot(fx, fy) < 1e-5 ? original : Math.atan2(fy, fx),
          error = wanted - original;
        if (error > Math.PI) error -= 2 * Math.PI;
        if (error < -Math.PI) error += 2 * Math.PI;
        const heading =
          original + Math.max(-Math.PI / 15, Math.min(Math.PI / 15, error));
        const difference = Math.hypot(
          after[a + 2] - Math.cos(heading) * 70,
          after[a + 3] - Math.sin(heading) * 70,
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
    } finally {
      engine.device.destroy();
      canvas.remove();
    }
  });
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
