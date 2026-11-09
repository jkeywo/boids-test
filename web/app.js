"use strict";
const status = document.querySelector("#status");
const canvas = document.querySelector("canvas");
const buttons = Object.fromEntries(
  ["send", "add", "remove"].map((id) => [id, document.getElementById(id)]),
);
const mapSize = document.querySelector("#map-size");
let moduleInstance;
let parameterDefinitions = [];
const parameterWidgets = new Map();
function formatParameter(spec, value) {
  const decimals = spec.step < 0.1 ? 2 : spec.step < 1 ? 1 : 0;
  return Number(value).toFixed(decimals) + (spec.unit ? " " + spec.unit : "");
}
function buildParameterControls() {
  parameterDefinitions = JSON.parse(
    moduleInstance.UTF8ToString(moduleInstance._parameter_schema()),
  );
  const container = document.querySelector("#parameter-controls");
  const groups = new Map();
  for (const spec of parameterDefinitions) {
    let group = groups.get(spec.group);
    if (!group) {
      const details = document.createElement("details");
      details.className = "functor-panel";
      details.dataset.group = spec.group;
      details.open = spec.group === "Wind";
      const summary = document.createElement("summary");
      const title = document.createElement("span");
      title.textContent = spec.group;
      summary.append(title);
      details.append(summary);
      container.append(details);
      group = { details, summary };
      groups.set(spec.group, group);
    }
    const input = document.createElement("input");
    input.id = "param-" + spec.name;
    input.dataset.parameter = spec.name;
    if (spec.toggle) {
      input.type = "checkbox";
      input.setAttribute("aria-label", "Enable " + spec.group.toLowerCase());
      input.addEventListener("click", (event) => event.stopPropagation());
      group.summary.append(input);
    } else {
      input.type = "range";
      input.min = spec.min;
      input.max = spec.max;
      input.step = spec.step;
      const row = document.createElement("div");
      row.className = "parameter-row";
      const label = document.createElement("label");
      label.htmlFor = input.id;
      label.textContent = spec.label;
      const output = document.createElement("output");
      output.htmlFor = input.id;
      output.id = input.id + "-value";
      row.append(label, output, input);
      group.details.append(row);
    }
    input.addEventListener(spec.toggle ? "change" : "input", () => {
      moduleInstance._set_parameter(
        spec.id,
        spec.toggle ? Number(input.checked) : Number(input.value),
      );
      refresh();
    });
    parameterWidgets.set(spec.id, { input, spec });
  }
}

const frameTimes = [];
const tickTimes = [];
let measuring = false;
let initialTicks = 0,
  minBudget = 48,
  maxBudget = 8;
function resize() {
  const width = Math.max(
    1,
    Math.min(
      moduleInstance ? moduleInstance._statistic(7) : 1024,
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
    width = m._statistic(7);
  document.getElementById("count").value = count;
  buttons.send.disabled = false;
  buttons.add.disabled = count >= 16;
  buttons.remove.disabled = count === 0;
  const crossing = m._statistic(8);
  document.querySelector("#crossing-status").textContent =
    `Each click launches another predator. ${crossing} active.`;
  mapSize.disabled = false;
  mapSize.value = String(width);
  document.querySelector("#world-caption").textContent =
    `${width} x ${width} / TOROIDAL WORLD`;
  const orbitSpec = parameterDefinitions.find(
    (spec) => spec.name === "orbit-radius",
  );
  document.querySelector("#orbit-caption").textContent =
    `Circling ${m._get_parameter(orbitSpec.id).toFixed(0)} units from the centre.`;
  for (const { input, spec } of parameterWidgets.values()) {
    const value = m._get_parameter(spec.id);
    if (spec.toggle) input.checked = value > 0;
    else {
      input.max = m._parameter_max(spec.id);
      input.value = value;
      document.getElementById(input.id + "-value").value = formatParameter(
        spec,
        value,
      );
    }
  }
}
Object.entries({ send: 1, add: 2, remove: 3 }).forEach(([id, action]) =>
  buttons[id].addEventListener("click", () => {
    moduleInstance._command(action);
    refresh();
  }),
);
mapSize.addEventListener("change", () => {
  moduleInstance._set_world_size(Number(mapSize.value));
  refresh();
  resize();
});
window.boidsTest = {
  ready: false,
  get worldSize() {
    return moduleInstance._statistic(7);
  },
  get crossingCount() {
    return moduleInstance._statistic(8);
  },
  get predatorCount() {
    return moduleInstance._statistic(9);
  },
  settings() {
    return Object.fromEntries(
      parameterDefinitions.map((spec) => [
        spec.name,
        moduleInstance._get_parameter(spec.id),
      ]),
    );
  },
  setParameter(name, value) {
    const spec = parameterDefinitions.find((spec) => spec.name === name);
    if (!spec) throw new Error("Unknown parameter: " + name);
    const actual = moduleInstance._set_parameter(spec.id, value);
    refresh();
    return actual;
  },
  startBenchmark() {
    frameTimes.length = 0;
    tickTimes.length = 0;
    measuring = true;
    initialTicks = moduleInstance._statistic(6);
    minBudget = 48;
    maxBudget = 8;
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
      simulationHz:
        (moduleInstance._statistic(6) - initialTicks) /
        (frameTimes.reduce((a, b) => a + b, 0) / 1000),
      minNeighbourBudget: minBudget,
      maxNeighbourBudget: maxBudget,
      renderResolution: canvas.width,
      userAgent: navigator.userAgent,
      population: 10000,
      worldSize: moduleInstance._statistic(7),
      crossingPredators: this.crossingCount,
      totalPredators: this.predatorCount,
      settings: this.settings(),
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
    buildParameterControls();
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
          const budget = moduleInstance._statistic(5);
          minBudget = Math.min(minBudget, budget);
          maxBudget = Math.max(maxBudget, budget);
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
