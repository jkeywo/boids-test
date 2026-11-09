"use strict";
const status = document.querySelector("#status");
const canvas = document.querySelector("canvas");
const buttons = Object.fromEntries(
  ["shoal", "send", "add", "remove"].map((id) => [
    id,
    document.getElementById(id),
  ]),
);
let moduleInstance;
const frameTimes = [];
const tickTimes = [];
let measuring = false;
function resize() {
  const width = Math.max(
    1,
    Math.min(
      1024,
      Math.round(
        canvas.getBoundingClientRect().width * window.devicePixelRatio,
      ),
    ),
  );
  canvas.width = width;
  canvas.height = width;
}
new ResizeObserver(resize).observe(canvas);
function refresh() {
  const m = moduleInstance,
    count = m._statistic(0),
    crossing = !!m._statistic(1),
    shoal = !!m._statistic(2);
  buttons.shoal.setAttribute("aria-pressed", String(shoal));
  document.getElementById("shoal-state").textContent = shoal ? "ON" : "OFF";
  document.getElementById("count").value = count;
  buttons.send.disabled = crossing;
  buttons.add.disabled = count >= 16;
  buttons.remove.disabled = count === 0;
}
Object.entries({ shoal: 0, send: 1, add: 2, remove: 3 }).forEach(
  ([id, action]) =>
    buttons[id].addEventListener("click", () => {
      moduleInstance._command(action);
      refresh();
    }),
);
window.boidsTest = {
  ready: false,
  startBenchmark() {
    frameTimes.length = 0;
    tickTimes.length = 0;
    measuring = true;
  },
  stopBenchmark() {
    measuring = false;
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const quantile = (p) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
    return {
      frames: sorted.length,
      meanFps:
        1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length),
      p50ms: quantile(0.5),
      p95ms: quantile(0.95),
      p99ms: quantile(0.99),
      meanTickMs: tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length,
      renderResolution: canvas.width,
      userAgent: navigator.userAgent,
      population: 10000,
    };
  },
};
(async () => {
  try {
    moduleInstance = await createBoids({
      locateFile: (path) => new URL(path, document.baseURI).href,
      printErr: (message) => console.error(message),
    });
    if (!moduleInstance._initialize())
      throw new Error(
        "WebGL 2 is required. Enable hardware acceleration or use a compatible browser.",
      );
    buttons.shoal.disabled = false;
    status.hidden = true;
    refresh();
    resize();
    window.boidsTest.ready = true;
    let previous = 0,
      elapsed = 0,
      frames = 0;
    document.addEventListener("visibilitychange", () => {
      previous = 0;
      moduleInstance._resume();
    });
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      status.textContent =
        "Graphics context lost. Reload to restart the flock.";
      status.hidden = false;
    });
    function loop(now) {
      requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = previous ? (now - previous) / 1000 : 0;
      previous = now;
      moduleInstance._frame(dt);
      if (dt > 0) {
        elapsed += dt;
        frames++;
        if (measuring) {
          frameTimes.push(dt * 1000);
          tickTimes.push(moduleInstance._statistic(3));
        }
      }
      if (elapsed >= 0.5) {
        document.getElementById("fps").textContent = Math.round(
          frames / elapsed,
        );
        document.getElementById("sim-ms").textContent = moduleInstance
          ._statistic(3)
          .toFixed(1);
        elapsed = 0;
        frames = 0;
        refresh();
      }
    }
    requestAnimationFrame(loop);
  } catch (error) {
    status.textContent = "Unable to start: " + error.message;
    console.error(error);
  }
})();
