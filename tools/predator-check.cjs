const assert = require("node:assert/strict");
module.exports = async function checkPredatorModes(page) {
  const gpu = await page.evaluate(() => boidsTest.mode === "gpu");
  const ready = () =>
    page.waitForFunction(() => window.boidsTest?.ready, null, {
      timeout: 90000,
    });
  const advance = async (ticks = 12) => {
    const start = await page.evaluate(() =>
      boidsTest.mode === "gpu"
        ? boidsTest.gpuStats().submittedSteps
        : boidsTest.cpuTicks,
    );
    await page.waitForFunction(
      (target) =>
        (boidsTest.mode === "gpu"
          ? boidsTest.gpuStats().steps
          : boidsTest.cpuTicks) >= target,
      start + ticks,
      { timeout: 90000 },
    );
  };
  await page.click("#send");
  await page.click("#send");
  const flights = await page.evaluate(() =>
    boidsTest.predators().filter((p) => p.crossing),
  );
  assert.equal(flights.length, 2);
  assert.notEqual(flights[0].targetY, flights[1].targetY);
  for (const p of flights) {
    assert.equal(p.targetX, 1024);
    assert(p.targetY >= 0 && p.targetY < 1024);
    assert(Math.cos(p.heading) > 0);
    assert(
      Math.abs(Math.atan2(p.targetY - p.y, p.targetX - p.x) - p.heading) <
        0.001,
    );
  }
  await page.click("#add");
  await page.click("#add");
  await page.selectOption("#map-size", "256");
  await page
    .locator('.functor-panel[data-group="Predators"]')
    .evaluate((panel) => (panel.open = true));
  await page.selectOption("#param-predator-mode", "1");
  assert.match(await page.locator("#orbit-caption").textContent(), /Perlin/);
  const before = await page.evaluate(() =>
    boidsTest.predators().filter((p) => !p.crossing),
  );
  await advance(30);
  const random = await page.evaluate(() =>
    boidsTest.predators().filter((p) => !p.crossing),
  );
  assert(
    random.some((p, i) => Math.hypot(p.x - before[i].x, p.y - before[i].y) > 1),
  );
  assert(
    random.some((p, i) => Math.abs(p.heading - before[i].heading) > 0.001),
  );
  await page.selectOption("#param-predator-mode", "2");
  await page.evaluate(() => {
    for (const name of ["cohesion", "alignment", "repulsion"])
      boidsTest.setParameter(name + "-enabled", 0);
  });
  await page.waitForFunction(
    () => boidsTest.huntDensityTotal === boidsTest.population,
    null,
    { timeout: 90000 },
  );
  await advance();
  const hunt = await page.evaluate(() => ({
    predators: boidsTest.predators().filter((p) => !p.crossing),
    density: boidsTest.huntDensityTotal,
    gpu: boidsTest.gpuStats(),
  }));
  assert.equal(
    hunt.density,
    gpu ? 100000 : 10000,
    "hunt uses the active flock, including when boid neighbour rules are disabled",
  );
  if (gpu) assert(hunt.gpu.densityReads > 0);
  assert(
    hunt.predators.some(
      (p, i) => Math.hypot(p.x - random[i].x, p.y - random[i].y) > 1,
    ),
  );
  for (const p of hunt.predators)
    assert(
      p.x >= 0 &&
        p.x < 256 &&
        p.y >= 0 &&
        p.y < 256 &&
        Number.isFinite(p.heading),
    );
  await page.reload();
  await ready();
  assert.equal(
    await page.evaluate(() => boidsTest.settings()["predator-mode"]),
    2,
  );
  assert.equal(await page.locator("#param-predator-mode").inputValue(), "2");
  assert.equal(await page.evaluate(() => boidsTest.predatorCount), 2);
  assert.equal(await page.evaluate(() => boidsTest.crossingCount), 0);
  await page
    .locator('.functor-panel[data-group="Predators"]')
    .evaluate((panel) => (panel.open = true));
  await page.selectOption("#param-predator-mode", "0");
  await advance();
  const orbit = await page.evaluate(() => boidsTest.predators());
  for (const p of orbit)
    assert(Math.abs(Math.hypot(p.x - 128, p.y - 128) - 100) < 0.01);
  const fixed = await page.evaluate(() =>
    boidsTest.predators().map((p) => [p.identity, p.speedMultiplier]),
  );
  assert(fixed.every(([, speed]) => speed >= 0.8 && speed <= 1.20001));
  await page.click("#reset-defaults");
  assert.deepEqual(
    await page.evaluate(() =>
      boidsTest.predators().map((p) => [p.identity, p.speedMultiplier]),
    ),
    fixed,
  );
  // Restore global test state explicitly; a flock-preset reset no longer touches it.
  await page.click("#remove");
  await page.click("#remove");
  await page.selectOption("#map-size", "1024");
  assert.equal(
    await page.evaluate(() => boidsTest.settings()["predator-mode"]),
    0,
  );
  if (gpu && (await page.evaluate(() => boidsTest.mode !== "gpu"))) {
    await page.selectOption("#simulation-mode", "gpu");
    await page.waitForFunction(() => boidsTest.mode === "gpu", null, {
      timeout: 90000,
    });
  }
  console.log(
    "PASS: random right-edge flights, Perlin/random/hunt/orbit movement, active-flock density, persistence and reset",
    gpu ? "GPU" : "CPU",
  );
};
