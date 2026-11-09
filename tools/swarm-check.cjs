const assert = require("node:assert/strict");
module.exports = async function checkGPUSwarm(page) {
  const original = await page.evaluate(() => boidsTest.settings());
  await page.evaluate(() => {
    for (const name of [
      "cohesion",
      "alignment",
      "repulsion",
      "flee",
      "wind",
      "shoal",
    ])
      boidsTest.setParameter(name + "-enabled", 0);
    boidsTest.setParameter("swarm-enabled", 1);
    boidsTest.setParameter("swarm-weight", 1);
    boidsTest.setParameter("speed", 10);
    boidsTest.setParameter("turn-rate", 720);
  });
  const results = [];
  for (const roots of [1, 4]) {
    await page.evaluate(
      (roots) => boidsTest.setParameter("swarm-count", roots),
      roots,
    );
    const target = await page.evaluate(
      () => boidsTest.gpuStats().submittedSteps + 45,
    );
    await page.waitForFunction(
      (target) => boidsTest.gpuStats().steps >= target,
      target,
      { timeout: 90000 },
    );
    const result = await page.evaluate(async () => {
      const v = new Float32Array(await boidsTest.gpuSnapshot()),
        extent = boidsTest.worldSize;
      let tested = 0,
        aligned = 0,
        evenTested = 0,
        evenAligned = 0,
        invalid = 0;
      const roots = boidsTest.settings()["swarm-count"];
      for (let i = roots; i < boidsTest.population; i++) {
        const k = i * 8,
          parent =
            (((Math.floor(i / roots) - 1) >> 1) * roots + (i & (roots - 1))) *
            8;
        let dx = v[parent] - v[k],
          dy = v[parent + 1] - v[k + 1];
        dx -= extent * Math.round(dx / extent);
        dy -= extent * Math.round(dy / extent);
        const d = Math.hypot(dx, dy),
          speed = Math.hypot(v[k + 2], v[k + 3]);
        if (
          !Number.isFinite(d + speed) ||
          v[k] < 0 ||
          v[k] >= extent ||
          v[k + 1] < 0 ||
          v[k + 1] >= extent
        )
          invalid++;
        if (d < 1) continue;
        const aim = (dx * v[k + 2] + dy * v[k + 3]) / (d * speed);
        tested++;
        if (aim > 0.98) aligned++;
        if (i % 2 === 0) {
          evenTested++;
          if (aim > 0.98) evenAligned++;
        }
      }
      return { tested, aligned, evenTested, evenAligned, invalid };
    });
    assert.equal(result.invalid, 0);
    assert(result.aligned / result.tested > 0.98, JSON.stringify(result));
    assert(
      result.evenAligned / result.evenTested > 0.98,
      "even boids must follow (index-1)>>1 rather than index>>1: " +
        JSON.stringify(result),
    );
    results.push({ roots, ...result });
  }
  await page.evaluate((values) => {
    for (const [name, value] of Object.entries(values))
      boidsTest.setParameter(name, value);
  }, original);
  console.log(
    "PASS: GPU swarm follows binary-tree parents with neighbour rules disabled",
    results,
  );
};
