const assert = require("node:assert/strict");
module.exports = async function checkSlots(page) {
  const key = "boids-test.settings.v1",
    mode = await page.evaluate(() => boidsTest.mode);
  const choose = (n) =>
    page.locator(`.slot-button[data-slot="${n - 1}"]`).click();
  const ready = () =>
    page.waitForFunction(() => window.boidsTest?.ready, null, {
      timeout: 90000,
    });
  const settings = () => page.evaluate(() => boidsTest.settings());
  const genericNames = await page
    .locator('.functor-panel[data-group="Predators"] [data-parameter]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.parameter));
  const original = await settings();
  const expected = [
    { speed: 71, hue: 10 },
    { speed: 99, hue: 200 },
    ...[3, 4, 5, 6].map((n) => ({ speed: 80 + n, hue: 40 * n })),
  ];
  await page.evaluate(() => {
    boidsTest.setParameter("boid-hue", 10);
    boidsTest.setParameter("swarm-enabled", 1);
    boidsTest.setParameter("swarm-weight", 2.25);
    boidsTest.setParameter("crossing-speed", 20);
    boidsTest.setParameter("predator-speed", 95);
    boidsTest.setParameter("predator-mode", 1);
  });
  await page.click("#add");
  await page.click("#add");
  await page.click("#send");
  const before = await page.evaluate(() => ({
    steps:
      boidsTest.mode === "gpu"
        ? boidsTest.gpuStats().steps
        : boidsTest.cpuTicks,
    predators: boidsTest.predators(),
  }));
  await page.evaluate(() => {
    const input = document.querySelector("#param-speed");
    input.value = "71";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector('[data-slot="1"]').click();
  });
  assert.equal(await page.evaluate(() => boidsTest.activeSlot), 2);
  assert.equal(await page.evaluate(() => boidsTest.mode), mode);
  assert.equal(
    await page.evaluate(() => boidsTest.predatorCount),
    3,
    "slot switch preserves resident and crossing predators",
  );
  assert.equal((await settings())["predator-mode"], 1);
  assert.equal((await settings())["crossing-speed"], 20);
  assert.equal((await settings())["predator-speed"], 95);
  await page.evaluate(() => {
    boidsTest.setParameter("speed", 99);
    boidsTest.setParameter("boid-hue", 200);
  });
  await page.selectOption("#map-size", "256");
  await choose(1);
  assert.equal((await settings()).speed, 71);
  assert.equal((await settings())["swarm-weight"], 2.25);
  assert.equal((await settings())["swarm-enabled"], 1);
  assert.equal(
    await page.evaluate(() => boidsTest.worldSize),
    256,
    "map size is global",
  );
  const after = await page.evaluate(() => ({
    steps:
      boidsTest.mode === "gpu"
        ? boidsTest.gpuStats().steps
        : boidsTest.cpuTicks,
    predators: boidsTest.predators(),
  }));
  assert(after.steps >= before.steps);
  assert.deepEqual(
    after.predators.map((p) => [p.identity, p.speedMultiplier]),
    before.predators.map((p) => [p.identity, p.speedMultiplier]),
    "same predator identities and fixed speeds survive switches",
  );
  const flightBefore = before.predators.find((p) => p.crossing),
    flightAfter = after.predators.find((p) => p.crossing);
  assert(flightAfter.x >= flightBefore.x * 0.25);
  assert.equal(flightAfter.targetY, flightBefore.targetY * 0.25);
  for (let n = 3; n <= 6; n++) {
    await choose(n);
    await page.evaluate(
      ({ speed, hue }) => {
        boidsTest.setParameter("speed", speed);
        boidsTest.setParameter("boid-hue", hue);
      },
      expected[n - 1],
    );
  }
  await page.reload();
  await ready();
  assert.equal(await page.evaluate(() => boidsTest.activeSlot), 6);
  assert.equal(await page.evaluate(() => boidsTest.mode), mode);
  for (let n = 1; n <= 6; n++) {
    await choose(n);
    const s = await settings();
    assert.equal(s.speed, expected[n - 1].speed);
    assert.equal(s["boid-hue"], expected[n - 1].hue);
    assert.equal(s["predator-mode"], 1);
    assert.equal(s["predator-speed"], 95);
    assert.equal(await page.evaluate(() => boidsTest.predatorCount), 2);
    assert.equal(await page.evaluate(() => boidsTest.worldSize), 256);
  }
  const speedIds = await page.evaluate(() =>
    boidsTest.predators().map((p) => [p.identity, p.speedMultiplier]),
  );
  await page.click("#reset-defaults");
  assert.equal(await page.evaluate(() => boidsTest.mode), mode);
  assert.equal(await page.evaluate(() => boidsTest.predatorCount), 2);
  assert.equal(await page.evaluate(() => boidsTest.worldSize), 256);
  assert.deepEqual(
    await page.evaluate(() =>
      boidsTest.predators().map((p) => [p.identity, p.speedMultiplier]),
    ),
    speedIds,
  );
  await choose(1);
  assert.equal((await settings()).speed, 71, "reset preserves other presets");
  const record = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)),
    key,
  );
  assert.equal(record.version, 3);
  assert.equal(record.generic.worldSize, 256);
  assert.equal(record.generic.orbitCount, 2);
  for (const slot of record.slots) {
    assert.equal("worldSize" in slot, false);
    assert.equal("orbitCount" in slot, false);
    for (const name of genericNames)
      assert.equal(
        name in slot.parameters,
        false,
        "no predator parameters inside flock presets",
      );
  }
  for (let n = 1; n <= 6; n++) {
    await choose(n);
    await page.click("#reset-defaults");
  }
  await choose(1);
  await page.selectOption("#map-size", "1024");
  await page.evaluate(
    (values) => {
      for (const [n, v] of Object.entries(values)) boidsTest.setParameter(n, v);
    },
    Object.fromEntries(genericNames.map((n) => [n, original[n]])),
  );
  await page.click("#remove");
  await page.click("#remove");
  await page.reload();
  await ready();
  // Migrate generic settings from the formerly active version-2 preset, not slot 1.
  const clean = await page.evaluate((key) => localStorage.getItem(key), key);
  await page.evaluate(
    ({ key, mode }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 2,
          mode,
          activeSlot: 1,
          slots: [
            {
              worldSize: 1024,
              orbitCount: 5,
              parameters: { speed: 81, "predator-mode": 1 },
            },
            {
              worldSize: 512,
              orbitCount: 3,
              parameters: {
                speed: 99,
                "predator-mode": 2,
                "predator-speed": 125,
                "orbit-radius": 160,
              },
            },
          ],
        }),
      ),
    { key, mode },
  );
  await page.reload();
  await ready();
  assert.equal(await page.evaluate(() => boidsTest.activeSlot), 2);
  assert.equal(await page.evaluate(() => boidsTest.worldSize), 512);
  assert.equal(await page.evaluate(() => boidsTest.predatorCount), 3);
  assert.equal((await settings())["predator-mode"], 2);
  await choose(1);
  assert.equal((await settings()).speed, 81);
  assert.equal((await settings())["predator-speed"], 125);
  assert.equal((await settings())["orbit-radius"], 160);
  assert.equal(await page.evaluate(() => boidsTest.worldSize), 512);
  assert.equal(await page.evaluate(() => boidsTest.predatorCount), 3);
  await page.evaluate(({ key, clean }) => localStorage.setItem(key, clean), {
    key,
    clean,
  });
  await page.reload();
  await ready();
  console.log(
    "PASS: flock-only presets, global map/predators, fixed predator speeds, version-2 migration, reset and live continuity",
    mode,
  );
};
