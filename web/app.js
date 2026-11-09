"use strict";
const status = document.querySelector("#status");
const canvas = document.querySelector("canvas");
const buttons = Object.fromEntries(
  ["send", "add", "remove"].map((id) => [id, document.getElementById(id)]),
);
const mapSize = document.querySelector("#map-size");
const modeSelect = document.querySelector("#simulation-mode");
const modeStatus = document.querySelector("#mode-status");
const gpuCanvas = document.querySelector("#gpu-simulation");
const canvasWrap = document.querySelector(".canvas-wrap");
let activeMode = "cpu",
  gpuEngine = null,
  modeEpoch = 0,
  modeLoading = false,
  initialized = false;
async function setSimulationMode(requested) {
  const epoch = ++modeEpoch;
  if (requested !== "gpu") {
    activeMode = "cpu";
    modeLoading = false;
    canvas.hidden = false;
    gpuCanvas.hidden = true;
    moduleInstance._resume();
    gpuEngine?.resetClock();
    modeStatus.textContent = "CPU simulation active.";
    refresh();
    resize();
    return true;
  }
  modeLoading = true;
  modeSelect.value = "gpu";
  modeSelect.disabled = true;
  modeStatus.textContent = "Preparing GPU simulation...";
  try {
    if (!gpuEngine) {
      const { GPUBoids } = await import("./gpu.js");
      gpuEngine = await GPUBoids.create(gpuCanvas, parameterDefinitions, {
        settings: parameterValues,
        worldSize: () => moduleInstance._statistic(7),
        predatorCount: () => moduleInstance._statistic(9),
        predator: (i) => ({
          x: moduleInstance._predator_value(i, 0),
          y: moduleInstance._predator_value(i, 1),
          heading: moduleInstance._predator_value(i, 2),
        }),
        step: (dt) => moduleInstance._gpu_control_step(dt),
        onError: (message) => {
          setSimulationMode("cpu");
          modeStatus.textContent = "GPU mode stopped: " + message;
        },
      });
    }
    if (epoch !== modeEpoch) return false;
    if (gpuEngine.lost)
      throw new Error("The GPU device is unavailable. Reload to retry.");
    activeMode = "gpu";
    modeLoading = false;
    canvas.hidden = true;
    gpuCanvas.hidden = false;
    gpuEngine.resetClock();
    modeStatus.textContent = "100,000 boids simulated on the GPU.";
    refresh();
    resize();
    return true;
  } catch (error) {
    if (epoch !== modeEpoch) return false;
    activeMode = "cpu";
    modeLoading = false;
    canvas.hidden = false;
    gpuCanvas.hidden = true;
    modeStatus.textContent = "GPU mode unavailable: " + error.message;
    refresh();
    resize();
    return false;
  }
}
modeSelect.addEventListener("change", async () => {
  if (await setSimulationMode(modeSelect.value)) saveSettings();
});
const resetButton = document.querySelector("#reset-defaults");
const settingsStatus = document.querySelector("#settings-status");
const SETTINGS_KEY = "boids-test.settings.v1";
let factorySettings;
let saveTimer = null;
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
    input.disabled = true;
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
      scheduleSettingsSave();
    });
    if (!spec.toggle) input.addEventListener("change", saveSettings);
    parameterWidgets.set(spec.id, { input, spec });
  }
}

// Preferences use stable parameter names from the C++ registry.
function parameterValues() {
  return Object.fromEntries(
    parameterDefinitions.map((spec) => [
      spec.name,
      moduleInstance._get_parameter(spec.id),
    ]),
  );
}
function currentPreferences() {
  return {
    version: 1,
    mode: activeMode,
    worldSize: moduleInstance._statistic(7),
    orbitCount: moduleInstance._statistic(0),
    parameters: parameterValues(),
  };
}
function storageUnavailable() {
  settingsStatus.textContent =
    "Browser storage is unavailable; changes apply for this visit.";
}
function cancelPendingSave() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = null;
}
function saveSettings() {
  cancelPendingSave();
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(currentPreferences()));
    settingsStatus.textContent = "Changes save automatically in this browser.";
  } catch {
    storageUnavailable();
  }
}
function scheduleSettingsSave() {
  cancelPendingSave();
  saveTimer = setTimeout(saveSettings, 150);
}
function setOrbitCount(value) {
  const target = Math.max(0, Math.min(16, value));
  while (moduleInstance._statistic(0) < target) moduleInstance._command(2);
  while (moduleInstance._statistic(0) > target) moduleInstance._command(3);
}
function applyPreferences(saved) {
  if ([256, 512, 1024].includes(saved.worldSize))
    moduleInstance._set_world_size(saved.worldSize);
  const values = saved.parameters;
  if (values && typeof values === "object" && !Array.isArray(values)) {
    // Apply in registry order: trigger before rearm, and map size before orbit radius.
    for (const spec of parameterDefinitions) {
      if (
        Object.hasOwn(values, spec.name) &&
        typeof values[spec.name] === "number" &&
        Number.isFinite(values[spec.name])
      )
        moduleInstance._set_parameter(spec.id, values[spec.name]);
    }
  }
  if (Number.isInteger(saved.orbitCount)) setOrbitCount(saved.orbitCount);
}
async function restoreSettings() {
  let raw;
  try {
    raw = localStorage.getItem(SETTINGS_KEY);
  } catch {
    storageUnavailable();
    return;
  }
  if (raw === null) return;
  try {
    const saved = JSON.parse(raw);
    if (
      !saved ||
      typeof saved !== "object" ||
      Array.isArray(saved) ||
      saved.version !== 1
    )
      return;
    applyPreferences(saved);
    if (saved.mode === "gpu") await setSimulationMode("gpu");
    settingsStatus.textContent = "Saved settings restored.";
  } catch {
    settingsStatus.textContent =
      "Saved settings could not be read; using defaults.";
  }
}
function resetDefaults() {
  cancelPendingSave();
  setSimulationMode("cpu");
  moduleInstance._command(5);
  applyPreferences(factorySettings);
  refresh();
  resize();
  try {
    localStorage.removeItem(SETTINGS_KEY);
    settingsStatus.textContent = "Default settings restored.";
  } catch {
    storageUnavailable();
  }
}
resetButton.addEventListener("click", resetDefaults);
window.addEventListener("pagehide", () => {
  if (saveTimer !== null) saveSettings();
});
const frameTimes = [];
const tickTimes = [];
let measuring = false;
let initialFrames = 0,
  initialTime = 0,
  initialGpuMs = [],
  initialTicks = 0,
  minBudget = 48,
  maxBudget = 8;
function resize() {
  const width = Math.max(
    1,
    Math.min(
      moduleInstance ? moduleInstance._statistic(7) : 1024,
      Math.round(canvasWrap.clientWidth * window.devicePixelRatio),
    ),
  );
  canvas.width = width;
  canvas.height = width;
  gpuCanvas.width = width;
  gpuCanvas.height = width;
}
new ResizeObserver(resize).observe(canvasWrap);
function refresh() {
  const m = moduleInstance,
    count = m._statistic(0),
    width = m._statistic(7);
  document.getElementById("count").value = count;
  buttons.send.disabled = !initialized;
  buttons.add.disabled = !initialized || count >= 16;
  buttons.remove.disabled = !initialized || count === 0;
  const crossing = m._statistic(8);
  document.querySelector("#crossing-status").textContent =
    `Each click launches another predator. ${crossing} active.`;
  mapSize.disabled = !initialized;
  resetButton.disabled = !initialized;
  modeSelect.disabled = !initialized || modeLoading;
  modeSelect.querySelector('[value="gpu"]').disabled = !navigator.gpu;
  if (!modeLoading) modeSelect.value = activeMode;
  document.querySelector("#population-count").textContent =
    activeMode === "gpu" ? "100,000" : "10,000";
  document.querySelector("#backend-caption").textContent =
    activeMode === "gpu"
      ? "WebGPU \u00b7 WGSL"
      : "C++ \u00b7 WASM \u00b7 WebGL 2";
  document.title =
    activeMode === "gpu" ? "Boids / 100,000 GPU" : "Boids / 10,000";
  document.querySelector("#simulation-label").textContent =
    activeMode === "gpu"
      ? gpuEngine?.gpuMs != null
        ? "GPU COMPUTE"
        : "CPU SUBMIT"
      : "SIMULATION";
  document.querySelector("#simulation-unit").textContent =
    activeMode === "gpu" && gpuEngine?.gpuMs == null
      ? " ms / frame"
      : " ms / tick";
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
    input.disabled = !initialized;
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
    if (action !== 1) saveSettings();
  }),
);
mapSize.addEventListener("change", () => {
  moduleInstance._set_world_size(Number(mapSize.value));
  refresh();
  resize();
  saveSettings();
});
window.boidsTest = {
  ready: false,
  get mode() {
    return activeMode;
  },
  get population() {
    return activeMode === "gpu" ? 100000 : 10000;
  },
  get cpuTicks() {
    return moduleInstance._statistic(6);
  },
  gpuStats() {
    return gpuEngine?.stats() || null;
  },
  gpuSnapshot() {
    if (activeMode !== "gpu") throw new Error("Select GPU mode first.");
    return gpuEngine.snapshot();
  },
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
    return parameterValues();
  },
  setParameter(name, value) {
    const spec = parameterDefinitions.find((spec) => spec.name === name);
    if (!spec) throw new Error("Unknown parameter: " + name);
    const actual = moduleInstance._set_parameter(spec.id, value);
    refresh();
    scheduleSettingsSave();
    return actual;
  },
  startBenchmark() {
    frameTimes.length = 0;
    tickTimes.length = 0;
    measuring = true;
    initialTicks =
      activeMode === "gpu"
        ? gpuEngine.completedTicks
        : moduleInstance._statistic(6);
    initialFrames = activeMode === "gpu" ? gpuEngine.completedFrames : 0;
    initialTime = performance.now();
    initialGpuMs = [];
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
        activeMode === "gpu"
          ? ((gpuEngine.completedFrames - initialFrames) * 1000) /
            (performance.now() - initialTime)
          : 1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length),
      p50ms: quantile(0.5),
      p95ms: quantile(0.95),
      p99ms: quantile(0.99),
      meanTickMs: tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length,
      simulationHz:
        ((activeMode === "gpu"
          ? gpuEngine.completedTicks
          : moduleInstance._statistic(6)) -
          initialTicks) /
        (frameTimes.reduce((a, b) => a + b, 0) / 1000),
      minNeighbourBudget: minBudget,
      maxNeighbourBudget: maxBudget,
      renderResolution: canvas.width,
      userAgent: navigator.userAgent,
      population: this.population,
      backend: activeMode === "gpu" ? "WebGPU compute" : "C++/WASM + WebGL 2",
      gpu: activeMode === "gpu" ? gpuEngine.stats() : null,
      meanGpuComputeMs: initialGpuMs.length
        ? initialGpuMs.reduce((a, b) => a + b, 0) / initialGpuMs.length
        : null,
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
    factorySettings = currentPreferences();
    await restoreSettings();
    initialized = true;
    if (!navigator.gpu)
      modeStatus.textContent =
        "CPU active. GPU mode needs a WebGPU-capable browser.";
    status.hidden = true;
    refresh();
    resize();
    window.boidsTest.ready = true;
    let previous = 0,
      elapsed = 0,
      frames = 0,
      lastGpuFrames = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && saveTimer !== null) saveSettings();
      previous = 0;
      moduleInstance._resume();
      gpuEngine?.resetClock();
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
      if (activeMode === "gpu") gpuEngine.frame(dt);
      else moduleInstance._frame(dt);
      if (dt > 0) {
        elapsed += dt;
        if (activeMode === "gpu") {
          const completed = gpuEngine.completedFrames;
          frames += Math.max(0, completed - lastGpuFrames);
          lastGpuFrames = completed;
        } else {
          frames++;
          lastGpuFrames = gpuEngine?.completedFrames || 0;
        }
        if (measuring) {
          frameTimes.push(dt * 1000);
          const budget =
            activeMode === "gpu"
              ? gpuEngine.budget
              : moduleInstance._statistic(5);
          minBudget = Math.min(minBudget, budget);
          maxBudget = Math.max(maxBudget, budget);
          tickTimes.push(
            activeMode === "gpu"
              ? gpuEngine.submitMs
              : moduleInstance._statistic(3),
          );
          if (activeMode === "gpu" && gpuEngine.gpuMs != null)
            initialGpuMs.push(gpuEngine.gpuMs);
        }
      }
      if (elapsed >= 0.5) {
        document.getElementById("fps").textContent = Math.round(
          frames / elapsed,
        );
        document.getElementById("sim-ms").textContent = (
          activeMode === "gpu"
            ? (gpuEngine.gpuMs ?? gpuEngine.submitMs)
            : moduleInstance._statistic(3)
        ).toFixed(2);
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
