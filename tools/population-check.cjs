const assert = require("node:assert/strict");
module.exports = async function checkPopulation(page, mode) {
  const context = await page
    .context()
    .browser()
    .newContext({ viewport: { width: 1600, height: 1200 } });
  try {
    const probe = await context.newPage();
    await probe.addInitScript(() => (window.requestAnimationFrame = () => 0));
    await probe.goto(page.url());
    await probe.waitForFunction(() => window.boidsTest?.ready, null, {
      polling: 50,
      timeout: 90000,
    });
    if (mode === "gpu") {
      await probe.selectOption("#simulation-mode", "gpu");
      await probe.waitForFunction(() => boidsTest.mode === "gpu", null, {
        polling: 50,
        timeout: 90000,
      });
    }
    const result = await probe.evaluate(async (mode) => {
      const anchors = [],
        settings = boidsTest.settings();
      let previous =
          mode === "gpu" ? new Uint8Array(await boidsTest.gpuSnapshot()) : null,
        preserved = true,
        invalid = 0;
      for (const level of [0, 0.5, 1, 0.5, 0]) {
        const count = boidsTest.setPopulationLevel(level);
        anchors.push(count);
        if (mode === "gpu") {
          const now = new Uint8Array(await boidsTest.gpuSnapshot()),
            bytes = Math.min(previous.length, now.length);
          for (let i = 0; i < bytes; i++)
            if (previous[i] !== now[i]) {
              preserved = false;
              break;
            }
          const values = new Float32Array(now.buffer);
          for (let i = 0; i < count; i++) {
            const k = i * 8;
            if (
              !Number.isFinite(
                values[k] + values[k + 1] + values[k + 2] + values[k + 3],
              ) ||
              values[k] < 0 ||
              values[k] >= boidsTest.worldSize ||
              values[k + 1] < 0 ||
              values[k + 1] >= boidsTest.worldSize
            )
              invalid++;
          }
          previous = now;
        }
      }
      const visibility = [];
      for (const mode of [0, 1, 2]) {
        boidsTest.setParameter("predator-mode", mode);
        const hidden = (name) =>
          document.querySelector("#param-" + name).closest(".parameter-row")
            .hidden;
        visibility.push({
          mode,
          orbit: hidden("orbit-radius"),
          roam: hidden("predator-speed"),
          noise: hidden("predator-noise-scale"),
          hunt: hidden("predator-hunt-radius"),
          crossing: hidden("crossing-speed"),
        });
      }
      boidsTest.setParameter("predator-mode", 0);
      boidsTest.setParameter("swarm-count", 4);
      boidsTest.setParameter("swarm-swap-rate", 0.5);
      document.querySelector('[data-slot="1"]').click();
      const second = boidsTest.settings();
      document.querySelector('[data-slot="0"]').click();
      const first = boidsTest.settings();
      document
        .querySelector("#population-slider")
        .dispatchEvent(new Event("change", { bubbles: true }));
      return {
        anchors,
        preserved,
        invalid,
        visibility,
        first,
        second,
        settings,
        population: boidsTest.population,
      };
    }, mode);
    const base = mode === "gpu" ? 10000 : 1000;
    assert.deepEqual(result.anchors, [
      base,
      base * 10,
      base * 100,
      base * 10,
      base,
    ]);
    assert(result.preserved, "surviving GPU records remain byte-identical");
    assert.equal(result.invalid, 0);
    for (const row of result.visibility) {
      assert.equal(row.orbit, row.mode !== 0);
      assert.equal(row.roam, row.mode === 0);
      assert.equal(row.noise, row.mode === 0);
      assert.equal(row.hunt, row.mode !== 2);
      assert.equal(row.crossing, false);
    }
    assert.equal(result.first["swarm-count"], 4);
    assert.equal(result.first["swarm-swap-rate"], 0.5);
    assert.equal(result.second["swarm-count"], 1);
    assert.equal(result.second["swarm-swap-rate"], 0);
    if (mode === "gpu") {
      await probe.selectOption("#simulation-mode", "cpu");
      await probe.selectOption("#map-size", "512");
      await probe.evaluate(() => boidsTest.setPopulationLevel(0.5));
      await probe.selectOption("#simulation-mode", "gpu");
      await probe.waitForFunction(() => boidsTest.mode === "gpu", null, {
        polling: 50,
        timeout: 90000,
      });
      const birth = await probe.evaluate(async () => {
        const values = new Float32Array(await boidsTest.gpuSnapshot());
        let sum = 0;
        for (let i = 10000; i < 100000; i++) sum += values[i * 8];
        return sum / 90000 / boidsTest.worldSize;
      });
      assert(
        Math.abs(birth - 0.5) < 0.01,
        "new boids fill the current world after resizing an inactive backend",
      );
      await probe.selectOption("#map-size", "1024");
      await probe.evaluate(() => {
        boidsTest.setPopulationLevel(0);
        document
          .querySelector("#population-slider")
          .dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await probe.reload();
    await probe.waitForFunction(() => window.boidsTest?.ready, null, {
      polling: 50,
      timeout: 90000,
    });
    assert.equal(await probe.evaluate(() => boidsTest.population), base);
    assert.equal(await probe.locator("#population-slider").inputValue(), "0");
    console.log(
      "PASS: logarithmic live population endpoints, survivor continuity, mode visibility, swarm presets and persistence",
      mode,
      result.anchors,
    );
  } finally {
    await context.close();
  }
};
