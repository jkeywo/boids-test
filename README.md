# Boids / 10,000

A 1024 × 1024 or 512 × 512 toroidal flock: C++20, Flecs 4.1.0, Emscripten 4.0.23, WebAssembly and WebGL 2.

**Live:** https://jkeywo.github.io/boids-test/

## Controls

- **Shoal boost:** individual boids turning more than 45° get 1.5× speed and 2× turn rate for 0.6 seconds. A further 0.8-second cooldown and a turn below 20° rearm the trigger. Disabling clears boosts.
- **Send predator:** a single left-to-right pass at 180 units/second; the button rearms after it exits.
- **− / +:** zero to 16 predators orbit the centre at radius 400 by default, clockwise once every 20 seconds. A new predator enters the largest angular gap.
- **512 x 512 map:** switches the logical world and maximum backing buffer between 512 and 1024 units. All 10,000 boids remain; positions and orbit radius scale proportionally (400 becomes 200). Boid/crossing speeds remain in world units per second.
- **Functor panels:** independent enable switches and live sliders for cohesion, alignment, repulsion, predator flee, shoal and wind. The existing shoal button is its enable switch. The parameter area scrolls independently of the simulation.

Predators only scare boids. The population stays at 10,000. All steering uses shortest toroidal displacement, so boids interact across boundaries.

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

For a 60-second sample per scenario in a browser, set `BENCHMARK_SECONDS=60` before running the browser test. `BROWSER_CHANNEL=chrome` selects an installed Google Chrome instead of the bundled Chromium. `TEST_URL` optionally targets the published site. It reports baseline, shoal, eight-predator, 16-predator and two wind scenarios, including crossing predators, with mean FPS, p50/p95/p99 frame intervals, actual simulation Hz and the neighbour-budget range. `BENCHMARK_SCENARIOS` optionally selects comma-separated scenario names (`baseline`, `shoal`, `eight-predators`, `sixteen-predators`, `wind`, `wind-small`). Both the test and production use normal requestAnimationFrame scheduling.

For ordinary refresh-limited timing on a real device, open the live site, wait for warm-up, then run `boidsTest.startBenchmark()` in its console; after 60 seconds run `boidsTest.stopBenchmark()`. The target is 60 fps (approximately 16.7 ms per frame) in current desktop Chrome/Firefox, iPhone 15-class Safari and Pixel 8-class Chrome. Mobile layout emulation does not prove mobile hardware performance. See `BENCHMARKS.md` for actual measurements.

## Architecture

Flecs entities own boid state. Each fixed 60 Hz tick snapshots positions/velocities, packs a spatial grid, computes independent steering and commits movement. The grid uses up to 32 x 32 cells and adjusts its cell size to the largest enabled boid-interaction radius, so changing a radius or map size keeps adjacent-cell lookup correct. Cohesion, alignment and repulsion each filter their own radius independently. Initial defaults are 32/32/10 units and weights 0.65/1/1.6; flee starts at radius 100 and weight 5. Speed and turn rate also have sliders.

Dense cells use a rotating, spatially distributed sample with at most 48 candidate inspections per boid. The browser adapts this budget through 48/32/24/16/12/8 to keep CPU headroom on slower devices: after 60 simulated ticks it reduces detail if the mean tick exceeds 8 ms and restores detail below 3 ms. Sparse regions inspect all candidates when they fit within the current budget. All 10,000 entities remain active and the target simulation rate remains 60 Hz. A separate wrapped broadphase restricts predator checks to nearby cells. Coincident boids receive an opposing deterministic separation impulse.

The renderer interpolates wrapped positions between ticks, streams one instance buffer and draws boids/predators in one instanced call. No per-boid DOM elements or JavaScript calls are involved. WASM is single-threaded and needs no cross-origin isolation. The canvas backing buffer is capped at 1024². The fixed simulation caps catch-up at four ticks, discards excess accumulated lag and pauses in hidden tabs; a slow device may therefore lose simulated time rather than accumulate an unbounded backlog.

## Wind and live parameters

Wind uses two independently seeded 3D gradient-noise channels for X and Y steering forces, with simulation time as the third coordinate. Each channel combines normalized octaves of Perlin noise using quintic interpolation ([algorithm reference](https://cs.nyu.edu/~perlin/noise/)). Controls expose octaves (1-6), spatial scale, time scale, overall weight, X/Y weights, persistence and lacunarity. Wind starts disabled; setting time scale to zero freezes the field.

For bounded cost with 10,000 boids, C++ samples a periodic 32 x 32 field at 15 Hz, interpolates between its time slices, then bilinearly samples that field for each boid at 60 Hz. Sampling wraps at the edges. Very fine octave detail is limited by this field resolution.

Other panels expose individual steering radii/weights, shoal trigger/rearm angles, boost duration/cooldown, speed/turn multipliers, orbit radius/period and crossing-predator speed. Changes apply live. Orbit radius is clamped to fit the active map, and shoal rearm angle stays below its trigger angle. Settings reset on page reload.

`src/parameters.hpp` is the single parameter registry. It supplies names, groups, defaults, bounds and steps to both C++ validation and the automatically generated controls. A future functor can register its toggle/settings there and add its C++ contribution without hand-building another UI panel.

WASM exports `parameter_schema()`, `get_parameter(id)`, `set_parameter(id, value)` and `parameter_max(id)`. Resolve IDs by the stable names in the JSON schema. The JS debug/interop API also offers `boidsTest.settings()`, `boidsTest.setParameter(name, value)` and `boidsTest.worldSize`. Slider inputs are bounded and quantized; nonfinite updates are rejected.

## Deployment

Pushes to `main` run native and WASM tests plus Chromium smoke tests, then publish `build/site` through GitHub Pages Actions. Pull requests run checks without deployment. Documentation-only pushes skip the workflow. Dependencies are pinned; Flecs source and its MIT licence are vendored. No backend is required.
