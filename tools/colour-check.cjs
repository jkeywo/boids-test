const assert = require("node:assert/strict");
const path = require("node:path");
const { PNG } = require(
  path.join(
    path.dirname(require.resolve("playwright-core/package.json")),
    "lib/utilsBundle.js",
  ),
);
module.exports = async function checkColours(page, canvasId) {
  const original = await page.evaluate(() => boidsTest.settings());
  async function apply(values) {
    await page.evaluate((values) => {
      for (const [key, value] of Object.entries(values))
        boidsTest.setParameter(key, value);
    }, values);
    const target = await page.evaluate(() =>
      boidsTest.mode === "gpu"
        ? boidsTest.gpuStats().submittedSteps + 2
        : boidsTest.cpuTicks + 2,
    );
    await page.waitForFunction(
      (target) =>
        (boidsTest.mode === "gpu"
          ? boidsTest.gpuStats().steps
          : boidsTest.cpuTicks) >= target,
      target,
      { timeout: 90000 },
    );
    // Let the completed submission reach the compositor before capturing it.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
  }
  async function pixels() {
    const image = PNG.sync.read(await page.locator(canvasId).screenshot());
    const bins = Array(36).fill(0);
    const dark = new Map();
    for (let i = 0; i < image.data.length; i += 4) {
      const [r, g, b] = image.data.subarray(i, i + 3),
        max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      if (max < 30) {
        const key = `${r},${g},${b}`;
        dark.set(key, (dark.get(key) || 0) + 1);
      }
      if (max < 100 || max - min < 40) continue;
      let h =
        max === r
          ? ((g - b) / (max - min)) % 6
          : max === g
            ? (b - r) / (max - min) + 2
            : (r - g) / (max - min) + 4;
      h = (h * 60 + 360) % 360;
      bins[Math.floor(h / 10)]++;
    }
    return {
      bins,
      bright: bins.reduce((a, b) => a + b, 0),
      background: [...dark].sort((a, b) => b[1] - a[1])[0]?.[0],
    };
  }
  const fraction = (sample, bins) =>
    bins.reduce((sum, bin) => sum + sample.bins[bin], 0) / sample.bright;
  await apply({
    "cohesion-enabled": 0,
    "alignment-enabled": 0,
    "repulsion-enabled": 0,
    "flee-enabled": 0,
    "wind-enabled": 0,
    "shoal-enabled": 0,
    "direction-hue": 0,
    "boid-hue": 0,
  });
  let sample = await pixels();
  assert(sample.bright > 100);
  assert(fraction(sample, [0, 35]) > 0.95, JSON.stringify(sample));
  assert.equal(sample.background, "17,6,6");
  await apply({ "boid-hue": 360 });
  sample = await pixels();
  assert(fraction(sample, [0, 35]) > 0.95, "360 degrees wraps to red");
  await apply({ "boid-hue": 120 });
  sample = await pixels();
  assert(fraction(sample, [11, 12]) > 0.95, JSON.stringify(sample));
  assert.equal(sample.background, "6,17,6");
  await apply({ "direction-hue": 1 });
  sample = await pixels();
  assert(
    sample.bins.filter((n) => n > sample.bright * 0.005).length >= 4,
    "heading colours form multiple hues",
  );
  assert.equal(
    sample.background,
    "6,17,6",
    "background follows base hue, not individual direction",
  );
  await apply({
    "direction-hue": 0,
    "boid-hue": 350,
    "shoal-enabled": 1,
    "shoal-threshold": 5,
    "shoal-duration": 3,
    "shoal-hue-enabled": 1,
    "shoal-hue-offset": 30,
    "wind-enabled": 1,
    "wind-weight": 5,
  });
  sample = await pixels();
  assert(
    fraction(sample, [1, 2]) > 0.01,
    `positive boost offset wraps through zero: ${JSON.stringify(sample)}`,
  );
  await apply({ "boid-hue": 10, "shoal-hue-offset": -30 });
  sample = await pixels();
  assert(
    fraction(sample, [33, 34]) > 0.01,
    `negative boost offset wraps: ${JSON.stringify(sample)}`,
  );
  await apply({ "shoal-hue-enabled": 0 });
  sample = await pixels();
  assert(fraction(sample, [0, 1]) > 0.95, JSON.stringify(sample));
  await page
    .locator(canvasId)
    .screenshot({
      path: path.resolve(
        "artifacts",
        canvasId.includes("gpu") ? "gpu-hue.png" : "cpu-hue.png",
      ),
    });
  await apply(original);
  console.log(
    "PASS: rendered hue slider, matching dark background, direction colours and signed shoal wrapping",
    canvasId,
  );
};
