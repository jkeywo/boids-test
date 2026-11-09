const { chromium } = require("@playwright/test");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path");
const root = path.resolve(process.env.PERF_SITE || "build/site");
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (!pathname.startsWith("/boids-test/")) {
    res.writeHead(404);
    return res.end();
  }
  const file = path.join(
    root,
    new URL(req.url, "http://localhost").pathname.replace(
      /^\/boids-test\//,
      "",
    ) || "index.html",
  );
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (e, data) => {
    if (e) {
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
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--ignore-gpu-blocklist"],
  });
  const results = [];
  try {
    for (const mode of (process.env.PERF_MODES || "cpu,gpu").split(","))
      for (const scene of (
        process.env.PERF_SCENES || "baseline,heavy,tiny,swarm"
      ).split(",")) {
        const page = await browser.newPage({
          viewport: { width: 1600, height: 1200 },
        });
        page.on("console", (m) => {
          if (m.type() === "error") console.error(m.text());
        });
        page.on("pageerror", (e) => console.error(e));
        await page.addInitScript(() => {
          window.requestAnimationFrame = () => 0;
          localStorage.clear();
        });
        await page.goto(
          `http://127.0.0.1:${server.address().port}/boids-test/`,
        );
        await page.waitForFunction(
          () => window.boidsTest?.ready,
          {},
          { polling: 50 },
        );
        if (scene === "tiny") await page.selectOption("#map-size", "256");
        if (scene === "heavy" || scene === "tiny") {
          await page.evaluate(() => {
            for (const [n, v] of Object.entries({
              "wind-enabled": 1,
              "wind-octaves": 6,
              "shoal-enabled": 1,
              "direction-hue": 1,
              "predator-mode": 2,
            }))
              boidsTest.setParameter(n, v);
          });
          for (let i = 0; i < 16; i++) await page.locator("#add").click();
        }
        if (scene === "swarm")
          await page.evaluate(() => {
            for (const n of [
              "cohesion",
              "alignment",
              "repulsion",
              "flee",
              "wind",
              "shoal",
            ])
              boidsTest.setParameter(n + "-enabled", 0);
            boidsTest.setParameter("swarm-enabled", 1);
          });
        if (mode === "gpu") {
          await page.selectOption("#simulation-mode", "gpu");
          await page
            .waitForFunction(
              () => boidsTest.mode === "gpu",
              {},
              { polling: 50, timeout: 20000 },
            )
            .catch(async (e) => {
              console.error(await page.locator("body").innerText());
              throw e;
            });
        }
        const result = await page.evaluate(
          (n) => boidsTest.profileRun(n),
          Number(process.env.PERF_FRAMES || 360),
        );
        results.push({ mode, scene, ...result });
        console.log(JSON.stringify(results.at(-1)));
        await page.close();
      }
    fs.mkdirSync("artifacts", { recursive: true });
    fs.writeFileSync(
      process.env.PERF_OUTPUT || "artifacts/perf.json",
      JSON.stringify({ browser: browser.version(), results }, null, 2),
    );
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
