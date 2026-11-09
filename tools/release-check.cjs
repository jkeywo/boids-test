const assert = require("node:assert/strict");
module.exports = async function checkRelease(page, mode) {
  const context = await page.context().browser().newContext();
  try {
    const probe = await context.newPage(),
      base = new URL(".", page.url());
    const names = [
      "style.css",
      "app.js",
      "boids.js",
      "boids.wasm",
      "gpu.js",
      "gpu-sim.wgsl",
      "gpu-render.wgsl",
    ];
    const stale = [],
      loaded = [],
      errors = [];
    // Model an existing browser cache holding obsolete, incompatible root assets.
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (names.some((name) => url.href === new URL(name, base).href)) {
        stale.push(url.pathname);
        return route.fulfill({
          contentType: url.pathname.endsWith(".wasm")
            ? "application/wasm"
            : "application/javascript",
          body: 'throw new Error("obsolete cached release");',
        });
      }
      return route.continue();
    });
    probe.on("request", (r) => {
      const url = new URL(r.url());
      if (names.some((n) => url.pathname.endsWith("/" + n)))
        loaded.push(url.pathname);
    });
    probe.on("pageerror", (e) => errors.push(e.message));
    await probe.goto(page.url());
    await probe.waitForFunction(() => window.boidsTest?.ready, null, {
      timeout: 90000,
    });
    const release = await probe.evaluate(
      async () => await (await fetch("./release.json")).json(),
    );
    assert.match(release.release, /^[a-f0-9]{24}$/);
    assert(
      await probe.evaluate(() =>
        boidsTest.parameterSchema().some((p) => p.name === "swarm-count"),
      ),
    );
    if (mode === "gpu") {
      await probe.selectOption("#simulation-mode", "gpu");
      await probe.waitForFunction(
        () => boidsTest.mode === "gpu" && boidsTest.gpuStats().steps >= 2,
        null,
        { timeout: 90000 },
      );
      assert.deepEqual(
        await probe.evaluate(() => boidsTest.gpuStats().errors),
        [],
      );
    }
    if (mode === "gpu") {
      const mismatch = await probe.evaluate(
        async (moduleURL) => {
          const { GPUBoids } = await import(moduleURL);
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 64;
          try {
            const engine = await GPUBoids.create(
              canvas,
              boidsTest
                .parameterSchema()
                .filter((p) => p.name !== "swarm-count"),
              {
                settings: () => boidsTest.settings(),
                worldSize: () => 1024,
                predatorCount: () => 0,
                residentCount: () => 0,
                step: () => {},
                huntDensity: () => {},
                onError: () => {},
              },
            );
            engine.device.destroy();
            return "Unexpectedly accepted incompatible parameters";
          } catch (error) {
            return error.message;
          }
        },
        new URL(release.assets + "gpu.js", base).href,
      );
      assert.match(mismatch, /different versions/);
      assert.match(mismatch, /P_SWARM_COUNT/);
    }
    const expected = new URL(release.assets, base).pathname;
    assert(
      loaded.every((url) => url.startsWith(expected)),
      JSON.stringify(loaded),
    );
    for (const name of mode === "gpu"
      ? names
      : ["style.css", "app.js", "boids.js", "boids.wasm"])
      assert(
        loaded.some((url) => url === expected + name),
        name + " must use the release URL",
      );
    assert.deepEqual(stale, []);
    assert.deepEqual(errors, []);
    console.log(
      "PASS: coherent " +
        mode +
        " release despite incompatible cached root assets",
      release.release,
    );
  } finally {
    await context.close();
  }
};
