const { chromium } = require("@playwright/test");
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
    browser = await chromium.launch({
      headless: true,
      channel: process.env.BROWSER_CHANNEL || "chromium",
      args: [
        "--enable-webgl",
        "--ignore-gpu-blocklist",

        "--disable-background-timer-throttling",
      ],
    });
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
    console.log("Click shoal");
    await page.click("#shoal");
    assert.equal(
      await page.locator("#shoal").getAttribute("aria-pressed"),
      "true",
    );
    await page.click("#add");
    await page.click("#add");
    assert.equal(await page.locator("#count").textContent(), "2");
    await page.click("#remove");
    assert.equal(await page.locator("#count").textContent(), "1");
    await page.click("#send");
    assert.equal(await page.locator("#send").isDisabled(), true);
    await page.waitForFunction(
      () => !document.querySelector("#send").disabled,
      null,
      { timeout: 15000 },
    );
    for (let i = 1; i < 16; ++i) await page.click("#add");
    assert.equal(await page.locator("#add").isDisabled(), true);
    assert.equal(await page.locator("#count").textContent(), "16");
    console.log("Taking screenshot");
    await page.screenshot({
      path: path.join(artifact, "desktop.png"),
      fullPage: true,
    });
    const seconds = Number(process.env.BENCHMARK_SECONDS || 5);
    const results = [];
    for (const scenario of [
      { name: "baseline", shoal: false, count: 0 },
      { name: "shoal", shoal: true, count: 0 },
      { name: "eight-predators", shoal: true, count: 8 },
      { name: "sixteen-predators", shoal: true, count: 16 },
    ]) {
      if (
        ((await page.locator("#shoal").getAttribute("aria-pressed")) ===
          "true") !==
        scenario.shoal
      ) {
        await page.click("#shoal");
      }
      assert.equal(
        await page.locator("#shoal").getAttribute("aria-pressed"),
        String(scenario.shoal),
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
      if (scenario.count) await page.click("#send");
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
      channel: process.env.BROWSER_CHANNEL || "chromium",
      mobileHardwareTested: false,
      results,
    };
    fs.writeFileSync(
      path.join(artifact, "benchmark.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
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
