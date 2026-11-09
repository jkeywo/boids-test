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
        residentCount: () => moduleInstance._statistic(0),
        huntDensity: (density, extent) => {
          if (
            activeMode !== "gpu" ||
            moduleInstance._statistic(7) !== extent ||
            moduleInstance._get_parameter(
              parameterDefinitions.find((spec) => spec.name === "predator-mode")
                .id,
            ) !== 2
          )
            return;
          moduleInstance.HEAPU32.set(
            density,
            moduleInstance._hunt_density_buffer() >>> 2,
          );
          moduleInstance._apply_hunt_density(extent);
        },
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
    moduleInstance._clear_hunt_density();
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
let activeSlot = 0;
let settingsSlots = [];
const slotButtons = [...document.querySelectorAll(".slot-button")];
slotButtons.forEach((button) =>
  button.addEventListener("click", () =>
    selectSettingsSlot(Number(button.dataset.slot)),
  ),
);
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
      details.open = spec.group === "Wind" || spec.group === "Appearance";
      const summary = document.createElement("summary");
      const title = document.createElement("span");
      title.textContent = spec.group;
      summary.append(title);
      details.append(summary);
      if (spec.group === "Appearance") container.prepend(details);
      else container.append(details);
      group = { details, summary };
      groups.set(spec.group, group);
    }
    const input = document.createElement(spec.options ? "select" : "input");
    input.disabled = true;
    input.id = "param-" + spec.name;
    input.dataset.parameter = spec.name;
    if (spec.toggle) {
      input.type = "checkbox";
      input.setAttribute(
        "aria-label",
        spec.label === "Enabled"
          ? "Enable " + spec.group.toLowerCase()
          : spec.label,
      );
      input.addEventListener("click", (event) => event.stopPropagation());
      if (spec.label === "Enabled") group.summary.append(input);
      else {
        const row = document.createElement("div");
        row.className = "parameter-row toggle-row";
        const label = document.createElement("label");
        label.htmlFor = input.id;
        label.textContent = spec.label;
        row.append(label, input);
        group.details.append(row);
      }
    } else {
      if (spec.options) {
        spec.options.forEach((name, index) => {
          const option = document.createElement("option");
          option.value = String(index);
          option.textContent = name;
          input.append(option);
        });
      } else {
        input.type = "range";
        input.min = spec.min;
        input.max = spec.max;
        input.step = spec.step;
      }
      const row = document.createElement("div");
      row.className = "parameter-row";
      const label = document.createElement("label");
      label.htmlFor = input.id;
      label.textContent = spec.label;
      if (spec.options) {
        row.append(label, input);
        group.details.insertBefore(row, group.summary.nextSibling);
      } else {
        const output = document.createElement("output");
        output.htmlFor = input.id;
        output.id = input.id + "-value";
        row.append(label, output, input);
        group.details.append(row);
      }
    }
    input.addEventListener(
      spec.toggle || spec.options ? "change" : "input",
      () => {
        moduleInstance._set_parameter(
          spec.id,
          spec.toggle ? Number(input.checked) : Number(input.value),
        );
        refresh();
        scheduleSettingsSave();
      },
    );
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
  settingsSlots[activeSlot] = currentPreferences();
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        version: 2,
        mode: activeMode,
        activeSlot,
        slots: settingsSlots,
      }),
    );
    settingsStatus.textContent = `Slot ${activeSlot + 1} saves automatically in this browser.`;
    return true;
  } catch {
    storageUnavailable();
    return false;
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
  if (
    [256, 512, 1024].includes(saved.worldSize) &&
    saved.worldSize !== moduleInstance._statistic(7)
  )
    moduleInstance._set_world_size(saved.worldSize);
  const values = saved.parameters;
  if (values && typeof values === "object" && !Array.isArray(values)) {
    // Apply in registry order: trigger before rearm, and map size before orbit radius.
    for (const spec of parameterDefinitions) {
      if (
        Object.hasOwn(values, spec.name) &&
        typeof values[spec.name] === "number" &&
        Number.isFinite(values[spec.name]) &&
        values[spec.name] !== moduleInstance._get_parameter(spec.id)
      )
        moduleInstance._set_parameter(spec.id, values[spec.name]);
    }
  }
  if (Number.isInteger(saved.orbitCount)) setOrbitCount(saved.orbitCount);
}
function normaliseSlot(saved) {
  const slot = structuredClone(factorySettings);
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return slot;
  if ([256, 512, 1024].includes(saved.worldSize)) {
    slot.worldSize = saved.worldSize;
    slot.parameters["orbit-radius"] *=
      saved.worldSize / factorySettings.worldSize;
  }
  if (Number.isInteger(saved.orbitCount))
    slot.orbitCount = Math.max(0, Math.min(16, saved.orbitCount));
  const values = saved.parameters;
  if (values && typeof values === "object" && !Array.isArray(values))
    for (const spec of parameterDefinitions)
      if (
        Object.hasOwn(values, spec.name) &&
        typeof values[spec.name] === "number" &&
        Number.isFinite(values[spec.name])
      )
        slot.parameters[spec.name] = values[spec.name];
  return slot;
}
function selectSettingsSlot(index) {
  if (
    !initialized ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= 6 ||
    index === activeSlot
  )
    return;
  cancelPendingSave();
  settingsSlots[activeSlot] = currentPreferences();
  const previousWorld = moduleInstance._statistic(7);
  activeSlot = index;
  applyPreferences(normaliseSlot(settingsSlots[index]));
  refresh();
  if (previousWorld !== moduleInstance._statistic(7)) resize();
  saveSettings();
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
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
    if (saved.version === 1) {
      settingsSlots[0] = normaliseSlot(saved);
    } else if (saved.version === 2 && Array.isArray(saved.slots)) {
      settingsSlots = Array.from({ length: 6 }, (_, i) =>
        normaliseSlot(saved.slots[i]),
      );
      activeSlot =
        Number.isInteger(saved.activeSlot) &&
        saved.activeSlot >= 0 &&
        saved.activeSlot < 6
          ? saved.activeSlot
          : 0;
    } else return;
    applyPreferences(settingsSlots[activeSlot]);
    settingsSlots[activeSlot] = currentPreferences();
    if (saved.mode === "gpu") await setSimulationMode("gpu");
    // Migrate previous single-setting records into slot 1 without hiding storage failures.
    if (saved.version === 1 && !saveSettings()) return;
    settingsStatus.textContent = `Slot ${activeSlot + 1} restored.`;
  } catch {
    settingsStatus.textContent =
      "Saved settings could not be read; using defaults.";
  }
}
function resetDefaults() {
  cancelPendingSave();
  const previousWorld = moduleInstance._statistic(7);
  moduleInstance._command(5);
  applyPreferences(factorySettings);
  refresh();
  if (previousWorld !== moduleInstance._statistic(7)) resize();
  saveSettings();
  // Keep every other slot, the selected backend, and the running boid state.
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
  slotButtons.forEach((button, index) => {
    button.disabled = !initialized;
    button.setAttribute("aria-pressed", String(index === activeSlot));
    button.title = `Settings slot ${index + 1}${index === activeSlot ? " (active)" : ""}`;
  });
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
  const colours = parameterValues();
  const orbitSpec = parameterDefinitions.find(
    (spec) => spec.name === "orbit-radius",
  );
  document.querySelector("#orbit-caption").textContent = [
    `Circling ${m._get_parameter(orbitSpec.id).toFixed(0)} units from the centre.`,
    "Roaming with Perlin-noise steering; wraps at the edges.",
    "Hunting the densest nearby boid clusters; wraps at the edges.",
  ][Math.round(colours["predator-mode"])];
  for (const { input, spec } of parameterWidgets.values()) {
    const value = m._get_parameter(spec.id);
    input.disabled = !initialized;
    if (spec.toggle) input.checked = value > 0;
    else if (spec.options) input.value = String(value);
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
  get activeSlot() {
    return activeSlot + 1;
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
  get huntDensityTotal() {
    return moduleInstance._statistic(10);
  },
  predators() {
    return Array.from({ length: this.predatorCount }, (_, i) => ({
      x: moduleInstance._predator_value(i, 0),
      y: moduleInstance._predator_value(i, 1),
      heading: moduleInstance._predator_value(i, 2),
      targetX: moduleInstance._predator_value(i, 3),
      targetY: moduleInstance._predator_value(i, 4),
      crossing: !!moduleInstance._predator_value(i, 5),
    }));
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
      renderResolution: activeMode === "gpu" ? gpuCanvas.width : canvas.width,
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
    settingsSlots = Array.from({ length: 6 }, () =>
      structuredClone(factorySettings),
    );
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
