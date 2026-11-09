# Boids / 10,000 CPU or 100,000 GPU

A toroidal flock with 1024 x 1024, 512 x 512 or 256 x 256 worlds: C++20, Flecs 4.1.0, Emscripten 4.0.23, WebAssembly and WebGL 2.

The simulation selector adds a **100,000-boid WebGPU compute mode** in browsers with WebGPU on HTTPS or localhost. The existing 10,000-boid C++/Flecs/WASM mode remains available.

**Live:** https://jkeywo.github.io/boids-test/

## Controls

- **Simulation mode:** choose 10,000 CPU boids or 100,000 GPU boids. Each flock pauses while its mode is inactive. The same controls work in both modes; the selected mode is saved. Unsupported GPU devices fall back to CPU with a message.
- **Six coloured settings slots:** the full-height column on the far left selects one of six flock presets. Only boid motion, flock functors and boid appearance are stored in a preset. Map size, CPU/GPU selection, predator count and all predator controls are generic settings shared by every slot and saved automatically. Slot switches and flock resets leave those generic settings and the running predators untouched. No save/load dialogs are used.
- **Swarm:** enable its checkbox and set its weight in the right-hand panel. Boid `i > 0` steers toward boid `(i - 1) >> 1`: 1 and 2 follow 0; 3 and 4 follow 1; 5 and 6 follow 2. Boid 0 has no Swarm parent. Links use the shortest wrapped displacement and a pre-tick snapshot; other enabled functors still contribute. Swarm works even when all spatial-neighbour rules are disabled.
- **Shoal boost:** individual boids turning more than 45° get 1.5× speed and 2× turn rate for 0.6 seconds. A further 0.8-second cooldown and a turn below 20° rearm the trigger. Disabling clears boosts.
- **Predator flee:** a heading-aligned ellipse centred on the predator's current position plus its current velocity times **Prediction time** (default **0.5 seconds**, range 0-3). Forward radius and Side radius are independently adjustable semi-axes, initially 100 and 50 world units. Flee weight and enable remain available. The force points along the outward ellipse normal and fades to zero at its edge; coincident centres get a finite lateral escape. Prediction uses the actual speed multiplier, crossing/roaming speed or orbit tangential speed. It projects linearly along the current heading, including for turning predators, and wraps the projected centre and displacement. All flee controls belong to the active flock preset and autosave; existing presets retain their `flee-radius` as the forward radius and receive the new side/prediction defaults.
- **Send predator:** every click launches another flight from the left edge to its own random target on the right edge, at a nominal 180 units/second by default. Multiple crossings and resident predators coexist. Each crossing predator leaves automatically after its own pass.
- **− / +:** zero to 16 resident predators. Orbit mode circles the centre at radius 400 by default, clockwise with a nominal 20-second period. A new predator enters the largest angular gap.
- **Resident movement (Predators panel on the right):** choose Orbit, Random or Hunt. Random uses independently seeded 3D Perlin noise at (x, y, time) to drive smooth turn rates. Hunt turns toward the highest-density nearby boid cell, breaking equal-density ties by distance; without a nearby target it searches using the same Perlin steering. Random and Hunt wrap around the map. Sliders control roaming speed, maximum turn rate, noise spatial/time scales and hunt radius. Mode and settings persist; launched flights remain independent of resident movement.
- **Predator speed variation:** each birth receives a monotonically increasing identity and a deterministic hashed multiplier in the range 0.8x-1.2x. That multiplier is fixed for the predator's lifetime and survives mode changes, map changes and preset switches. It scales crossing/roaming speed and orbit angular speed; changing a global base speed/period still updates the nominal speed. There is no per-frame reroll. The same birth sequence produces the same multipliers independently of flock state; removed identities are not reused.
- **Map size:** choose 1024 x 1024, 512 x 512 or 256 x 256. The full selected population remains; positions and orbit radius scale proportionally (400 / 200 / 100 units by default). Boid/crossing speeds remain in world units per second.
- **Appearance:** boid hue (0-360 degrees), a dark background in the same hue, optional hue by heading (base hue plus the direction angle), and an optional signed shoal hue offset (-180 to +180 degrees). Offsets wrap around the colour wheel, including negative values. The offset applies only while a boid is boosted; disabling the offset keeps boosted boids at their normal hue. Predators retain their red marker. All appearance settings are saved and reset with the other controls, in CPU and GPU modes.
- **Functor panels:** independent enable switches and live sliders for cohesion, alignment, repulsion, predator flee, shoal and wind. All seven functors use the same checkbox control. Functor and appearance settings sit in a separate full-viewport-height panel to the right of the simulation, with controls scrolling inside it. On mobile the panel stays fixed at the top and follows the visible viewport height as browser chrome changes. Main actions stay on the left on desktop; on narrow screens they sit below the simulation while functor settings remain on the right.

Predators only scare boids. The selected population stays constant. All steering uses shortest toroidal displacement, so boids interact across boundaries.

## Build and run

Install Python 3, Node.js and [Emscripten](https://emscripten.org/docs/getting_started/downloads.html) **4.0.23**. Activate the SDK in the current terminal. Alternatively install it at `.tools/emsdk`; the build script detects this location.

```powershell
python tools/build.py --test
python -m http.server 8080 --directory build/site
```

Open http://localhost:8080. Do not open the HTML with `file://`.

The build script compiles the C dependency as C and the simulation/renderer as C++. It runs the simulation tests as WebAssembly under Node, then emits the static site. Native simulation tests are also available:

```sh
cmake -S . -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native --config Release
ctest --test-dir build/native -C Release --output-on-failure
```

## Browser checks and benchmarking

```sh
npm ci
npx playwright install chromium
npm run test:browser
```

For Firefox compatibility checks, install it with `npx playwright install firefox` and set `BROWSER_ENGINE=firefox` before running the same test.

The browser test serves the site under `/boids-test/`, exercises controls and count limits, checks crossing-predator cleanup, verifies the side-by-side mobile layout, and saves screenshots and timing samples under `artifacts/`.

For a 60-second sample per scenario in a browser, set `BENCHMARK_SECONDS=60` before running the browser test. `BROWSER_CHANNEL=chrome` selects an installed Google Chrome instead of the bundled Chromium. `TEST_URL` optionally targets the published site. It reports baseline, shoal, eight-predator, 16-predator and three wind scenarios, including crossing predators, with mean FPS, p50/p95/p99 frame intervals, actual simulation Hz and the neighbour-budget range. `BENCHMARK_SCENARIOS` optionally selects comma-separated scenario names (`baseline`, `shoal`, `eight-predators`, `sixteen-predators`, `wind`, `wind-small`, `wind-tiny`). Both the test and production use normal requestAnimationFrame scheduling.

For ordinary refresh-limited timing on a real device, open the live site, wait for warm-up, then run `boidsTest.startBenchmark()` in its console; after 60 seconds run `boidsTest.stopBenchmark()`. The target is 60 fps (approximately 16.7 ms per frame) in current desktop Chrome/Firefox, iPhone 15-class Safari and Pixel 8-class Chrome. Mobile layout emulation does not prove mobile hardware performance. See `BENCHMARKS.md` for actual measurements.

For repeatable processing-cost measurements, build with `python tools/build.py --profile`, then run `npm run benchmark:stages`. This diagnostic harness freezes RAF, warms up 120 fixed ticks and measures 360 fixed ticks per fresh scene. CPU profiling pins the full 48-candidate budget and reports environment, predator broadphase, grid, steering, render preparation/submission and total CPU time. GPU profiling waits for completed work and averages hardware timestamps for compute and rendering separately. Its host wall time includes readback/synchronisation waits and is not a GPU throughput measurement. `PERF_FRAMES`, `PERF_MODES` (`cpu,gpu`), `PERF_SCENES` (`baseline,heavy,tiny,swarm`), `PERF_SITE` and `PERF_OUTPUT` customise the run. Rebuild without `--profile` for deployment. See [BENCHMARKS.md](BENCHMARKS.md) for measured results and limits.

## Architecture

Flecs entities own boid state. Each fixed 60 Hz tick snapshots positions/velocities, packs a spatial grid, computes independent steering and commits movement. The grid uses up to 32 x 32 cells and adjusts its cell size to the largest enabled boid-interaction radius, so changing a radius or map size keeps adjacent-cell lookup correct. Cohesion, alignment and repulsion each filter their own radius independently. Initial defaults are 32/32/10 units and weights 0.65/1/1.6; flee starts with forward/side radii 100/50, 0.5 seconds prediction and weight 5. Speed and turn rate also have sliders.

Dense cells use a rotating, spatially distributed sample with at most 48 candidate inspections per boid. The browser adapts this budget through 48/32/24/16/12/8 to keep CPU headroom on slower devices: after 60 simulated ticks it reduces detail if the mean tick exceeds 8 ms and restores detail below 3 ms. Sparse regions inspect all candidates when they fit within the current budget. All 10,000 entities remain active and the target simulation rate remains 60 Hz. A separate wrapped broadphase stores predicted predator ellipses in cell lists using the larger semi-axis as a conservative bound, covering every active crossing without a fixed bitmask limit. CPU/GPU instance buffers grow as needed when repeated launches add more predators. Coincident boids receive an opposing deterministic separation impulse.

Neighbour position/velocity records are packed together and sampled in four-wide WASM SIMD batches (SSE2 for native x64, scalar fallback for other native targets). Per-cell sampling plans share quota/stride calculations without changing the rotating sample budget. Steering uses vector dot/cross products and once-per-tick turn sines/cosines; heading is calculated only for diagnostic state reads. Wind keyframes are blended once per field node, then bilinearly sampled per boid. Predator broadphase cells hold references to cached projected centres/directions, and broad radii check the full predator list once instead of duplicating wrapped cells.

The renderer extracts instances directly from Flecs and interpolates wrapped positions between ticks, streams one instance buffer and draws boids/predators in one instanced call. No per-boid DOM elements or JavaScript calls are involved. WASM is single-threaded and needs no cross-origin isolation. The canvas backing buffer is capped at 1024². The fixed simulation caps catch-up at four ticks, discards excess accumulated lag and pauses in hidden tabs; a slow device may therefore lose simulated time rather than accumulate an unbounded backlog.

## GPU simulation

`web/gpu.js` manages WebGPU resources; `gpu-sim.wgsl` implements initialization, spatial binning, independent cohesion/alignment/repulsion/flee, Perlin wind, shoal state, turn limiting and wrapped integration. Two 3.2 MB storage buffers hold all 100,000 boids. `gpu-render.wgsl` reads these buffers directly and draws all boids and predators in one instanced call. No per-frame boid upload or readback is needed. C++/Flecs continues to own validated settings and predator paths while CPU boid integration is suspended.

The grid has up to 32 x 32 cells, adapting to the map and interaction radii. Each cell retains up to 128 representatives, with insertion order rotated each tick. Each boid inspects up to 32 candidates distributed across adjacent cells, filtering each functor by its own radius. This is a bounded approximation in crowded regions, rather than an all-pairs solution. Every one of the 100,000 boids is integrated at a target 60 Hz. All active predators are checked by the flee shader; wind is generated on the GPU as a periodic 32 x 32 field with two Perlin time slices at 15 Hz.

A separate compute pass prepares shared per-cell sampling plans, including each rotated remainder allocation. The advance shader retains the same 32-candidate budget and 128-representative pool, uses precomputed turn trigonometry and cosine shoal thresholds, and caches packed colour in the boid record for the vertex shader. Consecutive wind updates reuse the existing next keyframe. Host configuration/predator staging arrays are reused, and render only updates interpolation when a tick has already supplied its settings.

GPU uniform packing derives its size from the shared parameter registry, including appearance settings. Four aligned configuration slots keep catch-up ticks independent. At most two frames may remain in flight, preventing a slow GPU from building an unbounded command queue. GPU work is measured asynchronously with timestamp queries when supported; the UI otherwise labels CPU submission time explicitly. The FPS counter and benchmarks count completed GPU submissions. The canvas remains capped at the selected map size.

Run `npm run test:gpu` after building. `BROWSER_CHANNEL=chrome` uses installed Chrome; `GPU_SOFTWARE=1` enables a software adapter for CI shader/functional validation, which is not a hardware performance measurement. The test reads all 100,000 GPU records, checks motion and finite wrapped state, CPU suspension, all map sizes, wind/shoal, 56 predators, mode persistence/reset, unsupported-browser fallback and layout. `BENCHMARK_SECONDS=60` records sustained hardware results; scenarios are `gpu-baseline`, `gpu-wind-small`, `gpu-wind-tiny`, `gpu-random` and `gpu-hunt`. Reports and screenshots are written to `artifacts/`. Normal operation never reads back boid state; `boidsTest.gpuSnapshot()` exists for explicit diagnostics only. WebGPU requires a compatible browser/driver; the CPU mode remains the default. No experimental browser flags are used for hardware measurements.

WebGPU implementation references: [specification](https://gpuweb.github.io/gpuweb/) and [official compute-boids example](https://webgpu.github.io/webgpu-samples/?sample=computeBoids). GPU and CPU trajectories differ because neighbour sampling and noise seeds differ.

## Predator hunting density

Hunt uses a fixed 32 x 32 grid of actual boid counts and a configurable toroidal search radius. It selects the most populated cell within that radius, steering toward its centre with bounded turn rate. The density grid is a coarse estimate; boids are not individually chased. Native CPU mode rebuilds it from the active 10,000-boid flock. GPU mode accumulates all 100,000 boids on the GPU, including when cohesion/alignment/repulsion are disabled. It asynchronously transfers just this 4 KB aggregate field at up to 10 Hz in simulation time to the shared C++ predator controller; individual boid state stays on the GPU. Hunt therefore has a short sensor delay in GPU mode. Stale samples are discarded after resizing or switching modes. Orbit and Random need no density readback.

Crossing paths keep their original straight-line heading through the selected right-edge target, then leave past the edge. Diagonal flights can take longer to cross at the same path speed. Resizing scales both current positions and destinations. All resident modes share the existing predator-flee force. The legacy `orbitCount` saved field counts resident predators in every mode for backwards compatibility.

## Wind and live parameters

Wind uses two independently seeded 3D gradient-noise channels for X and Y steering forces, with simulation time as the third coordinate. Each channel combines normalized octaves of Perlin noise using quintic interpolation ([algorithm reference](https://cs.nyu.edu/~perlin/noise/)). Controls expose octaves (1-6), spatial scale, time scale, overall weight, X/Y weights, persistence and lacunarity. Wind starts disabled; setting time scale to zero freezes the field.

For bounded cost with 10,000 boids, C++ samples a periodic 32 x 32 field at 15 Hz, interpolates between its time slices, then bilinearly samples that field for each boid at 60 Hz. Sampling wraps at the edges. Very fine octave detail is limited by this field resolution.

Other panels expose individual steering radii/weights, shoal trigger/rearm angles, boost duration/cooldown, speed/turn multipliers, orbit radius/period and crossing-predator speed. Changes apply live. Orbit radius is clamped to fit the active map, and shoal rearm angle stays below its trigger angle. Settings save automatically in this browser. Reloading starts a fresh flock with the saved sliders, functor toggles, simulation mode, map size and resident-predator count.

`src/parameters.hpp` is the single parameter registry. It supplies names, groups, defaults, bounds and steps to both C++ validation and the automatically generated controls. A future functor can register its toggle/settings there and add its C++ and WGSL contributions without hand-building another UI panel.

`boidsTest.activeSlot` reports the selected slot number (1-6). WASM exports `parameter_schema()`, `get_parameter(id)`, `set_parameter(id, value)` and `parameter_max(id)`. Resolve IDs by the stable names in the JSON schema. `set_world_size(width)` accepts 256, 512 or 1024 and resets interpolation after resizing. The JS debug/interop API also offers `boidsTest.settings()`, `boidsTest.setParameter(name, value)`, `boidsTest.worldSize`, `boidsTest.crossingCount` and `boidsTest.predatorCount`. `boidsTest.predators()` exposes each predator's identity and fixed speed multiplier. Slider inputs are bounded and quantized; nonfinite updates are rejected.

## Saved settings

Settings stay in local storage under `boids-test.settings.v1`; schema version 3 separates generic settings from the six flock presets. The root stores CPU/GPU selection and active slot; `generic` stores map size, resident-predator count and every parameter in the Predators panel. Each slot contains only boid motion, functor and appearance parameters. Predator-flee parameters belong to the flock, because they control boid responses rather than predator movement.

Version 1 records migrate into slot 1 and generic settings. Version 2 records retain all six flock presets and migrate generic settings from the previously active slot, preserving the current scene at upgrade. Missing or invalid fields fall back to defaults; inputs are bounded and validated through C++ when applied.

Slider writes are debounced and flushed when switching slots or leaving the page. Slot selection, map size and resident counts save immediately. Switching slots changes only the flock parameters; map, predators and simulation backend remain as they were. Reloading starts a fresh flock and resident population; live boid positions, crossing flights and individual predator state are not saved. Speed multipliers are deterministically assigned to new births. The coloured rail fills the visible viewport height on desktop and mobile and remains accessible while the page scrolls.

**Reset flock defaults** resets only the active flock preset. It preserves all generic settings, live predators, the other five presets and the running simulation. Unrelated local-storage entries are preserved. With storage blocked, all six presets still work in memory for the current visit.

## Deployment

Pushes to `main` run native and WASM tests plus Chromium CPU smoke tests and software-adapter WebGPU shader/functional tests, then publish `build/site` through GitHub Pages Actions. Pull requests run checks without deployment. Documentation-only pushes skip the workflow. Dependencies are pinned; Flecs source and its MIT licence are vendored. No backend is required.
