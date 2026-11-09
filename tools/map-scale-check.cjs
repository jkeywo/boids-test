const assert = require("node:assert/strict");
module.exports = async function checkMapScale(page) {
  const context = await page
    .context()
    .browser()
    .newContext({ viewport: { width: 1600, height: 1200 } });
  try {
    const probe = await context.newPage();
    await probe.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await probe.goto(page.url());
    await probe.waitForFunction(() => window.boidsTest?.ready, null, {
      polling: 50,
      timeout: 90000,
    });
    const result = await probe.evaluate(() => {
      document.querySelector("#add").click();
      const original = boidsTest.settings(),
        rows = [];
      for (const size of [1024, 512, 256, 1024]) {
        const select = document.querySelector("#map-size");
        select.value = String(size);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        const canvas = document.querySelector("#simulation"),
          gl = canvas.getContext("webgl2"),
          pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        let hash = 2166136261,
          coloured = 0;
        for (let i = 0; i < pixels.length; i++) {
          hash = Math.imul(hash ^ pixels[i], 16777619);
          if (
            i % 4 === 0 &&
            Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 40
          )
            coloured++;
        }
        rows.push({
          size,
          resolution: canvas.width,
          hash: hash >>> 0,
          coloured,
          settings: boidsTest.settings(),
        });
      }
      return { original, rows };
    });
    for (const row of result.rows) {
      assert.deepEqual(
        row.settings,
        result.original,
        "map switches preserve reference parameters",
      );
      assert.equal(row.resolution, result.rows[0].resolution);
      assert(row.coloured > 1000, "frame contains rendered boids");
      assert.equal(
        row.hash,
        result.rows[0].hash,
        "boid and predator sizes/positions render identically at every map size",
      );
    }
    console.log(
      "PASS: identical CPU pixels and settings across 1024/512/256 map round trip",
      result.rows.map(({ size, resolution, hash, coloured }) => ({
        size,
        resolution,
        hash,
        coloured,
      })),
    );
  } finally {
    await context.close();
  }
};
