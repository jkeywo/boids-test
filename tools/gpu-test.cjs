const { chromium } = require("@playwright/test");
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../build/site");
const artifacts = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (!pathname.startsWith("/boids-test/")) {
    res.writeHead(404);
    return res.end();
  }
  const file = path.join(
    root,
    pathname.slice("/boids-test/".length) || "index.html",
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end();
    }
    res.setHeader(
      "Content-Type",
      {
        ".js": "application/javascript",
        ".wasm": "application/wasm",
        ".html": "text/html",
        ".css": "text/css",
      }[path.extname(file)] || "text/plain",
    );
    res.end(data);
  });
});
(async () => {
  let browser;
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url =
      process.env.TEST_URL ||
      `http://127.0.0.1:${server.address().port}/boids-test/`;
    browser = await chromium.launch({
      headless: true,
      channel: process.env.BROWSER_CHANNEL || "chromium",
      args: [
        "--ignore-gpu-blocklist",
        ...(process.env.GPU_SOFTWARE === "1"
          ? [
              "--enable-unsafe-webgpu",
              "--use-angle=swiftshader",
              "--use-vulkan=swiftshader",
              "--enable-features=Vulkan",
              "--use-webgpu-adapter=swiftshader",
              "--enable-unsafe-swiftshader",
            ]
          : []),
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1200 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") {
        errors.push(m.text());
        console.error(m.text());
      }
    });
    const ready = () =>
      page.waitForFunction(() => window.boidsTest?.ready, null, {
        timeout: 90000,
      });
    await page.goto(url);
    await ready();
    const adapterAvailable = await page.evaluate(
      async () => !!(await navigator.gpu?.requestAdapter()),
    );
    assert(
      adapterAvailable,
      "GPU test requires a WebGPU adapter; use GPU_SOFTWARE=1 for CI",
    );
    await page.selectOption("#simulation-mode", "gpu");
    await page.waitForFunction(() => boidsTest.mode === "gpu", null, {
      timeout: 90000,
    });
    await page.waitForFunction(() => boidsTest.gpuStats().steps >= 30, null, {
      timeout: 90000,
    });
    assert.equal(await page.evaluate(() => boidsTest.population), 100000);
    assert.equal(await page.locator("#simulation").isVisible(), false);
    assert.equal(await page.locator("#gpu-simulation").isVisible(), true);
    await require("./colour-check.cjs")(page, "#gpu-simulation");
    await require("./predator-check.cjs")(page);
    // No CPU boid integration is allowed to masquerade as GPU simulation.
    const cpuTicks = await page.evaluate(() => boidsTest.cpuTicks);
    const step = await page.evaluate(() => boidsTest.gpuStats().steps);
    await page.waitForFunction(
      (s) => boidsTest.gpuStats().steps >= s + 10,
      step,
      { timeout: 60000 },
    );
    assert.equal(await page.evaluate(() => boidsTest.cpuTicks), cpuTicks);
    // Inspect all 100,000 records, not just a rendered population label.
    // A software adapter may take longer than an arbitrary 300/500 ms delay.
    // Wait past every already-submitted tick plus two newly configured ticks.
    const settle = async () => {
      const submitted = await page.evaluate(
        () => boidsTest.gpuStats().submittedSteps,
      );
      await page.waitForFunction(
        (target) => boidsTest.gpuStats().steps >= target,
        submitted + 2,
        { timeout: 90000 },
      );
    };
    const inspect = () =>
      page.evaluate(async () => {
        const values = new Float32Array(await boidsTest.gpuSnapshot());
        let invalid = 0,
          boosted = 0,
          minSpeed = Infinity,
          maxSpeed = 0,
          moved = 0,
          turned = 0;
        const extent = boidsTest.worldSize;
        for (let i = 0; i < 100000; i++) {
          const k = i * 8,
            speed = Math.hypot(values[k + 2], values[k + 3]);
          if (
            ![
              values[k],
              values[k + 1],
              speed,
              values[k + 4],
              values[k + 5],
            ].every(Number.isFinite) ||
            values[k] < 0 ||
            values[k] >= extent ||
            values[k + 1] < 0 ||
            values[k + 1] >= extent
          )
            invalid++;
          if (values[k + 4] > 0) boosted++;
          minSpeed = Math.min(minSpeed, speed);
          maxSpeed = Math.max(maxSpeed, speed);
          if (window.lastGPUState) {
            if (
              Math.hypot(
                values[k] - lastGPUState[k],
                values[k + 1] - lastGPUState[k + 1],
              ) > 0.001
            )
              moved++;
            if (
              Math.hypot(
                values[k + 2] - lastGPUState[k + 2],
                values[k + 3] - lastGPUState[k + 3],
              ) > 0.1
            )
              turned++;
          }
        }
        window.lastGPUState = values;
        return {
          length: values.length,
          invalid,
          boosted,
          minSpeed,
          maxSpeed,
          moved,
          turned,
          lastBoid: Array.from(values.slice(-8, -4)),
        };
      });
    let state = await inspect();
    assert.equal(state.length, 800000);
    assert.equal(state.invalid, 0);
    await page.evaluate(() => {
      for (const name of [
        "cohesion",
        "alignment",
        "repulsion",
        "flee",
        "shoal",
        "wind",
      ])
        boidsTest.setParameter(name + "-enabled", 0);
      boidsTest.setParameter("speed", 180);
    });
    await settle();
    await inspect();
    await settle();
    state = await inspect();
    assert.equal(state.invalid, 0);
    assert(state.moved > 99990, JSON.stringify(state));
    assert.equal(state.turned, 0);
    // WGSL trig is approximate: SwiftShader varies by ~0.04 units/s at speed 180.
    assert(
      Math.abs(state.maxSpeed - 180) < 0.1 &&
        Math.abs(state.minSpeed - 180) < 0.1,
      JSON.stringify(state),
    );
    for (const world of [512, 256, 1024]) {
      await page.selectOption("#map-size", String(world));
      await settle();
      state = await inspect();
      assert.equal(state.invalid, 0, `GPU rescale ${world}`);
      if (world === 256) {
        // Radius 128 selects the special 2x2 grid: four unique cells, not nine aliases.
        await page.evaluate(() => {
          for (const name of ["cohesion", "alignment", "repulsion"]) {
            boidsTest.setParameter(name + "-enabled", 1);
            boidsTest.setParameter(name + "-radius", 128);
          }
        });
        await settle();
        state = await inspect();
        assert.equal(state.invalid, 0, "dense 2x2 GPU grid");
        await page.evaluate(() => {
          for (const name of ["cohesion", "alignment", "repulsion"]) {
            boidsTest.setParameter(name + "-enabled", 0);
            boidsTest.setParameter(
              name + "-radius",
              name === "repulsion" ? 10 : 32,
            );
          }
        });
      }
      assert(
        Number(await page.locator("#gpu-simulation").getAttribute("width")) <=
          world,
      );
    }
    await page.evaluate(() => {
      boidsTest.setParameter("wind-enabled", 1);
      boidsTest.setParameter("wind-octaves", 6);
      boidsTest.setParameter("wind-weight", 5);
      boidsTest.setParameter("shoal-enabled", 1);
      boidsTest.setParameter("shoal-threshold", 5);
    });
    await settle();
    state = await inspect();
    assert.equal(state.invalid, 0);
    assert(state.turned > 1000, "GPU Perlin wind steers");
    assert(state.boosted > 0, "GPU shoal boosts");
    assert(state.maxSpeed > 200);
    await page.evaluate(() => boidsTest.setParameter("shoal-enabled", 0));
    await settle();
    state = await inspect();
    assert.equal(state.boosted, 0);
    // WGSL trig is approximate: SwiftShader varies by ~0.04 units/s at speed 180.
    assert(
      Math.abs(state.maxSpeed - 180) < 0.1 &&
        Math.abs(state.minSpeed - 180) < 0.1,
      JSON.stringify(state),
    );
    await page.evaluate(() => {
      boidsTest.setParameter("flee-enabled", 1);
      boidsTest.setParameter("crossing-speed", 20);
      for (let i = 0; i < 16; i++) document.querySelector("#add").click();
      for (let i = 0; i < 40; i++) document.querySelector("#send").click();
    });
    await settle();
    assert.equal(await page.evaluate(() => boidsTest.predatorCount), 56);
    state = await inspect();
    assert.equal(state.invalid, 0);
    assert.deepEqual(
      await page.evaluate(() => boidsTest.gpuStats().errors),
      [],
    );
    await page.reload();
    await ready();
    assert.equal(await page.evaluate(() => boidsTest.mode), "gpu");
    assert.equal(await page.evaluate(() => boidsTest.predatorCount), 16);
    assert.equal(
      await page.evaluate(() => boidsTest.settings()["wind-octaves"]),
      6,
    );
    await page.click("#reset-defaults");
    assert.equal(await page.evaluate(() => boidsTest.mode), "cpu");
    assert.equal(
      await page.evaluate(() => localStorage.getItem("boids-test.settings.v1")),
      null,
    );
    await page.reload();
    await ready();
    assert.equal(await page.evaluate(() => boidsTest.mode), "cpu");
    await page.selectOption("#simulation-mode", "gpu");
    await page.waitForFunction(() => boidsTest.mode === "gpu", null, {
      timeout: 90000,
    });
    const seconds = Number(process.env.BENCHMARK_SECONDS || 3);
    const results = [];
    for (const scenario of [
      { name: "gpu-baseline", world: 1024, heavy: false },
      { name: "gpu-wind-small", world: 512, heavy: true },
      { name: "gpu-wind-tiny", world: 256, heavy: true },
      { name: "gpu-random", world: 1024, heavy: true, movement: 1 },
      { name: "gpu-hunt", world: 1024, heavy: true, movement: 2 },
    ]) {
      if (
        process.env.BENCHMARK_SCENARIOS &&
        !process.env.BENCHMARK_SCENARIOS.split(",").includes(scenario.name)
      )
        continue;
      await page.selectOption("#map-size", String(scenario.world));
      if (scenario.heavy)
        await page.evaluate(() => {
          boidsTest.setParameter("wind-enabled", 1);
          boidsTest.setParameter("wind-octaves", 6);
          boidsTest.setParameter("shoal-enabled", 1);
          for (let i = 0; i < 16; i++) document.querySelector("#add").click();
          document.querySelector("#send").click();
        });
      await page.evaluate(
        (mode) => boidsTest.setParameter("predator-mode", mode),
        scenario.movement || 0,
      );
      await page.evaluate(() => {
        const c = document.querySelector("#gpu-simulation");
        c.width = boidsTest.worldSize;
        c.height = c.width;
      });
      await page.waitForTimeout(1500);
      await page.evaluate(() => boidsTest.startBenchmark());
      await page.waitForTimeout(seconds * 1000);
      const metrics = await page.evaluate(() => boidsTest.stopBenchmark());
      results.push({ scenario: scenario.name, ...metrics });
      assert.equal(metrics.population, 100000);
      assert(metrics.simulationHz > 0);
      assert.deepEqual(metrics.gpu.errors, []);
      console.log(
        scenario.name,
        JSON.stringify({
          fps: metrics.meanFps,
          hz: metrics.simulationHz,
          gpuMs: metrics.meanGpuComputeMs,
          p95: metrics.p95ms,
        }),
      );
      if (!scenario.heavy)
        await page.screenshot({
          path: path.join(artifacts, "gpu-desktop.png"),
        });
    }
    await page.setViewportSize({ width: 393, height: 852 });
    await settle();
    const sidebar = await page.locator(".functor-settings").boundingBox(),
      canvas = await page.locator("#gpu-simulation").boundingBox();
    assert(canvas.x + canvas.width <= sidebar.x);
    assert(Math.abs(canvas.width - canvas.height) < 1);
    assert(
      Math.abs(sidebar.height - 852) < 1 && Math.abs(sidebar.y) < 1,
      "settings fill the mobile viewport",
    );
    await page.screenshot({
      path: path.join(artifacts, "gpu-mobile-layout.png"),
      fullPage: true,
    });
    const fallback = await browser.newPage();
    await fallback.addInitScript(() => {
      Object.defineProperty(navigator, "gpu", { value: undefined });
      localStorage.setItem(
        "boids-test.settings.v1",
        JSON.stringify({
          version: 1,
          mode: "gpu",
          worldSize: 256,
          parameters: { speed: 88 },
        }),
      );
    });
    await fallback.goto(url);
    await fallback.waitForFunction(() => window.boidsTest?.ready, null, {
      timeout: 60000,
    });
    assert.equal(await fallback.evaluate(() => boidsTest.mode), "cpu");
    assert.equal(await fallback.evaluate(() => boidsTest.settings().speed), 88);
    assert.equal(
      await fallback.locator("#simulation-mode option[value=gpu]").isDisabled(),
      true,
    );
    await fallback.close();
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(artifacts, "gpu-benchmark.json"),
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          url,
          channel: process.env.BROWSER_CHANNEL || "chromium",
          software: process.env.GPU_SOFTWARE === "1",
          headless: true,
          mobileHardwareTested: false,
          results,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: 100,000 GPU records, frozen CPU boids, wrapping maps, wind/shoal, 56 predators, mode persistence, defaults, fallback and layout",
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
