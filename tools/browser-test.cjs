const { chromium, firefox } = require("@playwright/test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../build/site");
const artifact = path.resolve(__dirname, "../artifacts");
fs.mkdirSync(artifact, { recursive: true });
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(
    new URL(req.url, "http://localhost").pathname,
  );
  if (!pathname.startsWith("/boids-test/")) {
    res.writeHead(404);
    return res.end();
  }
  let file = path.join(
    root,
    pathname.slice("/boids-test/".length) || "index.html",
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end();
    }
    const types = {
      ".wasm": "application/wasm",
      ".js": "application/javascript",
      ".css": "text/css",
      ".html": "text/html",
    };
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] || "application/octet-stream",
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
    const engineName = process.env.BROWSER_ENGINE || "chromium";
    const browserType = engineName === "firefox" ? firefox : chromium;
    const launchOptions =
      engineName === "firefox"
        ? {
            headless: true,
            firefoxUserPrefs: { "webgl.force-enabled": true },
          }
        : {
            headless: true,
            channel: process.env.BROWSER_CHANNEL || "chromium",
            args: [
              "--enable-webgl",
              "--ignore-gpu-blocklist",

              "--disable-background-timer-throttling",
            ],
          };
    browser = await browserType.launch(launchOptions);
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1200 },
    });
    const errors = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error("Page error:", error.message);
    });
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
        console.error("Console:", message.text());
      }
    });
    console.log("Opening", url);
    await page.goto(url);
    await page.waitForFunction(() => window.boidsTest?.ready, null, {
      timeout: 60000,
    });
    console.log("Simulation ready");
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      canvas.width = 1024;
      canvas.height = 1024;
    });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator("#status").isVisible(), false);
    assert.equal(await page.locator("#remove").isDisabled(), true);
    assert.equal(await page.locator("#shoal").count(), 0);
    assert.equal(
      await page.locator("#param-shoal-enabled").getAttribute("type"),
      "checkbox",
    );
    await page.locator("#param-shoal-enabled").check();
    assert.equal(await page.locator("#param-shoal-enabled").isChecked(), true);
    await page.click("#add");
    await page.click("#add");
    assert.equal(await page.locator("#count").textContent(), "2");
    await page.click("#remove");
    assert.equal(await page.locator("#count").textContent(), "1");
    for (let i = 0; i < 3; ++i) {
      await page.click("#send");
      assert.equal(await page.locator("#send").isDisabled(), false);
    }
    assert.equal(await page.evaluate(() => window.boidsTest.crossingCount), 3);
    // Exceed the old CPU bitmask and GPU instance-buffer capacities.
    await page.evaluate(() => {
      for (let i = 0; i < 40; ++i) document.querySelector("#send").click();
    });
    await page.waitForTimeout(200);
    assert(await page.evaluate(() => window.boidsTest.crossingCount >= 40));
    assert.equal(
      await page.evaluate(() =>
        document.querySelector("canvas").getContext("webgl2").getError(),
      ),
      0,
    );
    await page.waitForFunction(
      () => window.boidsTest.crossingCount === 0,
      null,
      { timeout: 30000 },
    );
    assert.equal(await page.locator("#send").isDisabled(), false);
    for (let i = 1; i < 16; ++i) await page.click("#add");
    assert.equal(await page.locator("#add").isDisabled(), true);
    assert.equal(await page.locator("#count").textContent(), "16");
    // Exercise every generated slider and toggle through its actual DOM event.
    const controlReport = await page.evaluate(() => {
      const original = window.boidsTest.settings();
      document
        .querySelectorAll(".functor-panel")
        .forEach((panel) => (panel.open = true));
      let sliders = 0,
        toggles = 0;
      for (const input of document.querySelectorAll("input[data-parameter]")) {
        const name = input.dataset.parameter;
        if (input.type === "checkbox") {
          for (const checked of [false, true]) {
            input.checked = checked;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            if (!!window.boidsTest.settings()[name] !== checked)
              throw new Error("Toggle did not apply: " + name);
          }
          toggles++;
        } else {
          input.value =
            Number(input.min) + (Number(input.max) - Number(input.min)) * 0.63;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          const actual = window.boidsTest.settings()[name];
          if (Math.abs(Number(input.value) - actual) > 0.001)
            throw new Error("Slider did not apply: " + name);
          if (!document.getElementById(input.id + "-value").textContent)
            throw new Error("Missing slider output");
          sliders++;
        }
      }
      for (const [name, value] of Object.entries(original))
        window.boidsTest.setParameter(name, value);
      document
        .querySelectorAll(".functor-panel")
        .forEach((panel) => (panel.open = panel.dataset.group === "Wind"));
      document.querySelector("#parameter-controls").scrollTop = 0;
      return { sliders, toggles };
    });
    assert.equal(controlReport.sliders, 27);
    assert.equal(controlReport.toggles, 6);
    await page.selectOption("#map-size", "512");
    assert.equal(await page.evaluate(() => window.boidsTest.worldSize), 512);
    assert.equal(await page.locator("#map-size").inputValue(), "512");
    assert.equal(
      Number(await page.locator("#param-orbit-radius").inputValue()),
      200,
    );
    assert.equal(
      await page.locator("#param-orbit-radius").getAttribute("max"),
      "240",
    );
    await page.locator("#param-wind-enabled").check();
    await page.evaluate(() => window.boidsTest.setParameter("wind-octaves", 6));
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(artifact, "wind-small.png"),
      fullPage: true,
    });
    await page.click("#send");
    await page.selectOption("#map-size", "256");
    assert.equal(await page.evaluate(() => window.boidsTest.worldSize), 256);
    assert.equal(await page.evaluate(() => window.boidsTest.crossingCount), 1);
    assert.equal(
      Number(await page.locator("#param-orbit-radius").inputValue()),
      100,
    );
    assert.equal(
      await page.locator("#param-orbit-radius").getAttribute("max"),
      "112",
    );
    await page.waitForTimeout(150);
    await page.screenshot({
      path: path.join(artifact, "wind-tiny.png"),
      fullPage: true,
    });
    await page.selectOption("#map-size", "512");
    assert.equal(
      Number(await page.locator("#param-orbit-radius").inputValue()),
      200,
    );
    await page.selectOption("#map-size", "1024");
    assert.equal(await page.evaluate(() => window.boidsTest.worldSize), 1024);
    assert.equal(
      Number(await page.locator("#param-orbit-radius").inputValue()),
      400,
    );
    await page.locator("#param-wind-enabled").uncheck();
    await page.evaluate(() => window.boidsTest.setParameter("wind-octaves", 3));
    await page.evaluate(
      () => (document.querySelector("#parameter-controls").scrollTop = 0),
    );
    await page.waitForFunction(
      () => window.boidsTest.crossingCount === 0,
      null,
      { timeout: 30000 },
    );
    console.log(
      "PASS: all parameter controls, Perlin wind and live map resizing",
      controlReport,
    );
    console.log("Taking screenshot");
    await page.screenshot({
      path: path.join(artifact, "desktop.png"),
      fullPage: true,
    });
    const seconds = Number(process.env.BENCHMARK_SECONDS || 5);
    const results = [];
    const scenarios = [
      { name: "baseline", shoal: false, count: 0 },
      { name: "shoal", shoal: true, count: 0 },
      { name: "eight-predators", shoal: true, count: 8 },
      { name: "sixteen-predators", shoal: true, count: 16 },
      { name: "wind", shoal: true, count: 16, wind: true },
      {
        name: "wind-small",
        shoal: true,
        count: 16,
        wind: true,
        small: true,
        octaves: 6,
      },
      {
        name: "wind-tiny",
        shoal: true,
        count: 16,
        wind: true,
        size: 256,
        octaves: 6,
        crossings: 8,
      },
    ];
    const selected = process.env.BENCHMARK_SCENARIOS?.split(",");
    for (const scenario of scenarios.filter(
      (s) => !selected || selected.includes(s.name),
    )) {
      const targetSize = scenario.size || (scenario.small ? 512 : 1024);
      if (
        (await page.evaluate(() => window.boidsTest.worldSize)) !== targetSize
      )
        await page.selectOption("#map-size", String(targetSize));
      await page.locator("#param-wind-enabled").setChecked(!!scenario.wind);
      await page.evaluate(
        (octaves) => window.boidsTest.setParameter("wind-octaves", octaves),
        scenario.octaves || 3,
      );
      await page.locator("#param-shoal-enabled").setChecked(scenario.shoal);
      assert.equal(
        await page.locator("#param-shoal-enabled").isChecked(),
        scenario.shoal,
      );
      let count = Number(await page.locator("#count").textContent());
      while (count < scenario.count) {
        await page.click("#add");
        count++;
      }
      while (count > scenario.count) {
        await page.click("#remove");
        count--;
      }
      if (scenario.count)
        for (let i = 0; i < (scenario.crossings || 1); ++i)
          await page.click("#send");
      await page.evaluate(() => {
        const canvas = document.querySelector("canvas");
        canvas.width = window.boidsTest.worldSize;
        canvas.height = canvas.width;
      });
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.boidsTest.startBenchmark());
      await page.waitForTimeout(seconds * 1000);
      console.log("Completed scenario", scenario.name);
      results.push({
        scenario: scenario.name,
        ...(await page.evaluate(() => window.boidsTest.stopBenchmark())),
      });
    }
    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(500);
    const boxes = await Promise.all([
      page.locator("aside").boundingBox(),
      page.locator("canvas").boundingBox(),
    ]);
    assert(
      boxes[0].x + boxes[0].width <= boxes[1].x,
      "controls stay left on mobile",
    );
    assert(
      Math.abs(boxes[1].width - boxes[1].height) < 1,
      "square mobile canvas",
    );
    console.log("Taking screenshot");
    await page.screenshot({
      path: path.join(artifact, "mobile-layout.png"),
      fullPage: true,
    });
    assert.equal(errors.length, 0, errors.join("\n"));
    const gpu = await page.evaluate(() => {
      let gl = document.querySelector("canvas").getContext("webgl2");
      let ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
    });
    const report = {
      testedAt: new Date().toISOString(),
      url,
      gpu,
      headless: true,
      browserEngine: engineName,
      channel:
        engineName === "firefox"
          ? "firefox"
          : process.env.BROWSER_CHANNEL || "chromium",
      mobileHardwareTested: false,
      results,
    };
    fs.writeFileSync(
      path.join(artifact, "benchmark.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          ...report,
          results: report.results.map(
            ({ settings, userAgent, ...metrics }) => metrics,
          ),
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: browser controls, WebGL/WASM, desktop/mobile layout and project-path loading",
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
