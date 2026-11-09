# Boids / 10,000 CPU or 100,000 GPU

A toroidal flock with 1024 x 1024, 512 x 512 or 256 x 256 worlds: C++20, Flecs 4.1.0, Emscripten 4.0.23, WebAssembly and WebGL 2.

The simulation selector adds a **100,000-boid WebGPU compute mode** in browsers with WebGPU on HTTPS or localhost. The existing 10,000-boid C++/Flecs/WASM mode remains available.

**Live:** https://jkeywo.github.io/boids-test/

## Controls

- **Simulation mode:** choose 10,000 CPU boids or 100,000 GPU boids. Each flock pauses while its mode is inactive. The same controls work in both modes; the selected mode is saved. Unsupported GPU devices fall back to CPU with a message.
- **Six coloured settings slots:** the full-height column on the far left selects one of six independent configurations. Edits autosave into the selected slot; switching saves pending edits and applies the other slot immediately. The flock and crossing flights keep running. CPU/GPU selection is global, so a slot switch keeps the same simulation backend. Slots start with defaults; existing saved settings migrate into slot 1.
- **Swarm:** enable its checkbox and set its weight in the right-hand panel. Boid `i > 0` steers toward boid `(i - 1) >> 1`: 1 and 2 follow 0; 3 and 4 follow 1; 5 and 6 follow 2. Boid 0 has no Swarm parent. Links use the shortest wrapped displacement and a pre-tick snapshot; other enabled functors still contribute. Swarm works even when all spatial-neighbour rules are disabled.
- **Shoal boost:** individual boids turning more than 45° get 1.5× speed and 2× turn rate for 0.6 seconds. A further 0.8-second cooldown and a turn below 20° rearm the trigger. Disabling clears boosts.
- **Send predator:** every click launches another flight from the left edge to its own random target on the right edge, at 180 units/second by default. Multiple crossings and resident predators coexist. Each crossing predator leaves automatically after its own pass.
- **− / +:** zero to 16 resident predators. Orbit mode circles the centre at radius 400 by default, clockwise once every 20 seconds. A new predator enters the largest angular gap.
- **Resident movement (Predators panel on the right):** choose Orbit, Random or Hunt. Random uses independently seeded 3D Perlin noise at (x, y, time) to drive smooth turn rates. Hunt turns toward the highest-density nearby boid cell, breaking equal-density ties by distance; without a nearby target it searches using the same Perlin steering. Random and Hunt wrap around the map. Sliders control roaming speed, maximum turn rate, noise spatial/time scales and hunt radius. Mode and settings persist; launched flights remain independent of resident movement.
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

## Architecture

Flecs entities own boid state. Each fixed 60 Hz tick snapshots positions/velocities, packs a spatial grid, computes independent steering and commits movement. The grid uses up to 32 x 32 cells and adjusts its cell size to the largest enabled boid-interaction radius, so changing a radius or map size keeps adjacent-cell lookup correct. Cohesion, alignment and repulsion each filter their own radius independently. Initial defaults are 32/32/10 units and weights 0.65/1/1.6; flee starts at radius 100 and weight 5. Speed and turn rate also have sliders.

Dense cells use a rotating, spatially distributed sample with at most 48 candidate inspections per boid. The browser adapts this budget through 48/32/24/16/12/8 to keep CPU headroom on slower devices: after 60 simulated ticks it reduces detail if the mean tick exceeds 8 ms and restores detail below 3 ms. Sparse regions inspect all candidates when they fit within the current budget. All 10,000 entities remain active and the target simulation rate remains 60 Hz. A separate wrapped broadphase stores nearby predators in cell lists, covering every active crossing without a fixed bitmask limit. CPU/GPU instance buffers grow as needed when repeated launches add more predators. Coincident boids receive an opposing deterministic separation impulse.

The renderer interpolates wrapped positions between ticks, streams one instance buffer and draws boids/predators in one instanced call. No per-boid DOM elements or JavaScript calls are involved. WASM is single-threaded and needs no cross-origin isolation. The canvas backing buffer is capped at 1024². The fixed simulation caps catch-up at four ticks, discards excess accumulated lag and pauses in hidden tabs; a slow device may therefore lose simulated time rather than accumulate an unbounded backlog.

## GPU simulation

`web/gpu.js` manages WebGPU resources; `gpu-sim.wgsl` implements initialization, spatial binning, independent cohesion/alignment/repulsion/flee, Perlin wind, shoal state, turn limiting and wrapped integration. Two 3.2 MB storage buffers hold all 100,000 boids. `gpu-render.wgsl` reads these buffers directly and draws all boids and predators in one instanced call. No per-frame boid upload or readback is needed. C++/Flecs continues to own validated settings and predator paths while CPU boid integration is suspended.

The grid has up to 32 x 32 cells, adapting to the map and interaction radii. Each cell retains up to 128 representatives, with insertion order rotated each tick. Each boid inspects up to 32 candidates distributed across adjacent cells, filtering each functor by its own radius. This is a bounded approximation in crowded regions, rather than an all-pairs solution. Every one of the 100,000 boids is integrated at a target 60 Hz. All active predators are checked by the flee shader; wind is generated on the GPU as a periodic 32 x 32 field with two Perlin time slices at 15 Hz.

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

`boidsTest.activeSlot` reports the selected slot number (1-6). WASM exports `parameter_schema()`, `get_parameter(id)`, `set_parameter(id, value)` and `parameter_max(id)`. Resolve IDs by the stable names in the JSON schema. `set_world_size(width)` accepts 256, 512 or 1024 and resets interpolation after resizing. The JS debug/interop API also offers `boidsTest.settings()`, `boidsTest.setParameter(name, value)`, `boidsTest.worldSize`, `boidsTest.crossingCount` and `boidsTest.predatorCount`. Slider inputs are bounded and quantized; nonfinite updates are rejected.

## Saved settings

Settings stay in local storage under `boids-test.settings.v1`; the record now uses schema version 2 with a global CPU/GPU mode, active slot, and six independent slot configurations. Each slot stores its map size, resident-predator count, and all functor/appearance parameters. Version 1 records migrate into slot 1; the other five slots receive factory defaults. Missing or invalid slot fields fall back to defaults, and values are validated through C++ when applied.

Slider writes are debounced and flushed when switching slots or leaving the page. Slot selection, map size and resident counts save immediately. Switching slots applies changes to the current flock; resizing scales it instead of reinitializing it. Existing crossing predators continue between slot changes. Reloading starts a fresh flock using the selected slot; boid positions and crossing flights are not stored. The coloured rail fills the visible viewport height on desktop and mobile and remains accessible while the page scrolls.

**Reset to defaults** resets only the active slot, restores its 1024 map and zero predators, and preserves every other slot plus the global CPU/GPU selection. It clears predators but keeps the current boid simulation running. Unrelated local-storage entries are preserved. When storage is blocked, all six slots still work in memory for the current visit.

## Deployment

Pushes to `main` run native and WASM tests plus Chromium CPU smoke tests and software-adapter WebGPU shader/functional tests, then publish `build/site` through GitHub Pages Actions. Pull requests run checks without deployment. Documentation-only pushes skip the workflow. Dependencies are pinned; Flecs source and its MIT licence are vendored. No backend is required.
