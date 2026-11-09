const assert = require("node:assert/strict");
module.exports = async function checkSlots(page) {
  const mode = await page.evaluate(() => boidsTest.mode);
  const choose = (n) =>
    page.locator(`.slot-button[data-slot="${n - 1}"]`).click();
  const settings = () => page.evaluate(() => boidsTest.settings());
  const expected = [
    { speed: 71, hue: 10 },
    { speed: 99, hue: 200 },
    ...[3, 4, 5, 6].map((n) => ({ speed: 80 + n, hue: 40 * n })),
  ];
  assert.equal(await page.locator(".slot-button").count(), 6);
  await page.evaluate(() => {
    boidsTest.setParameter("boid-hue", 10);
    boidsTest.setParameter("swarm-enabled", 1);
    boidsTest.setParameter("swarm-weight", 2.25);
    boidsTest.setParameter("crossing-speed", 20);
  });
  await page.click("#send");
  const before = await page.evaluate(() => ({
    steps:
      boidsTest.mode === "gpu"
        ? boidsTest.gpuStats().steps
        : boidsTest.cpuTicks,
    crossings: boidsTest.crossingCount,
    predator: boidsTest.predators().find((p) => p.crossing),
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
    await page.evaluate(() => boidsTest.crossingCount),
    before.crossings,
  );
  assert.notEqual((await settings()).speed, 71);
  await page.evaluate(() => {
    boidsTest.setParameter("speed", 99);
    boidsTest.setParameter("boid-hue", 200);
  });
  await page.selectOption("#map-size", "256");
  await choose(1);
  assert.equal((await settings()).speed, 71);
  assert.equal((await settings())["swarm-weight"], 2.25);
  assert.equal((await settings())["swarm-enabled"], 1);
  assert.equal(await page.evaluate(() => boidsTest.worldSize), 1024);
  const after = await page.evaluate(() => ({
    steps:
      boidsTest.mode === "gpu"
        ? boidsTest.gpuStats().steps
        : boidsTest.cpuTicks,
    crossings: boidsTest.crossingCount,
    predator: boidsTest.predators().find((p) => p.crossing),
  }));
  assert(
    after.steps >= before.steps,
    "slot switches preserve simulation tick counter",
  );
  assert.equal(after.crossings, before.crossings);
  assert(
    after.predator.x >= before.predator.x,
    "crossing flight continues across slots and resizing",
  );
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
  await page.waitForFunction(() => window.boidsTest?.ready, null, {
    timeout: 90000,
  });
  assert.equal(await page.evaluate(() => boidsTest.activeSlot), 6);
  assert.equal(await page.evaluate(() => boidsTest.mode), mode);
  for (let n = 1; n <= 6; n++) {
    await choose(n);
    const actual = await settings();
    assert.equal(actual.speed, expected[n - 1].speed);
    assert.equal(actual["boid-hue"], expected[n - 1].hue);
  }
  await page.click("#reset-defaults");
  assert.equal(await page.evaluate(() => boidsTest.mode), mode);
  await choose(1);
  assert.equal(
    (await settings()).speed,
    71,
    "reset of slot 6 preserves slot 1",
  );
  await choose(2);
  assert.equal(await page.evaluate(() => boidsTest.worldSize), 256);
  assert.equal((await settings()).speed, 99);
  for (let n = 1; n <= 6; n++) {
    await choose(n);
    await page.click("#reset-defaults");
  }
  await choose(1);
  console.log(
    "PASS: six autosaving slots, pending-save switches, active-slot reload, per-slot reset and live flock/predator continuity",
    mode,
  );
};
