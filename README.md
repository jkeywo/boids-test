# Boids / 10,000

A 1024 × 1024 toroidal flock: C++20, Flecs 4.1.0, Emscripten 4.0.23, WebAssembly and WebGL 2.

**Live:** https://jkeywo.github.io/boids-test/

## Controls

- **Shoal boost:** individual boids turning more than 45° get 1.5× speed and 2× turn rate for 0.6 seconds. A further 0.8-second cooldown and a turn below 20° rearm the trigger. Disabling clears boosts.
- **Send predator:** a single left-to-right pass at 180 units/second; the button rearms after it exits.
- **− / +:** zero to 16 predators orbit the centre at radius 400, clockwise once every 20 seconds. A new predator enters the largest angular gap.

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

The browser test serves the site under `/boids-test/`, exercises controls and count limits, checks crossing-predator cleanup, verifies the side-by-side mobile layout, and saves screenshots and timing samples under `artifacts/`.

For a 60-second sample per scenario in a browser, set `BENCHMARK_SECONDS=60` before running the browser test. `BROWSER_CHANNEL=chrome` selects an installed Google Chrome instead of the bundled Chromium. `TEST_URL` optionally targets the published site. It reports baseline, shoal, eight-predator and 16-predator scenarios, including crossing predators, with mean FPS and p50/p95/p99 frame intervals. Both the test and production use normal requestAnimationFrame scheduling.

For ordinary refresh-limited timing on a real device, open the live site, wait for warm-up, then run `boidsTest.startBenchmark()` in its console; after 60 seconds run `boidsTest.stopBenchmark()`. The target is 60 fps (approximately 16.7 ms per frame) in current desktop Chrome/Firefox, iPhone 15-class Safari and Pixel 8-class Chrome. Mobile layout emulation does not prove mobile hardware performance. See `BENCHMARKS.md` for actual measurements.

## Architecture

Flecs entities own boid state. Each fixed 60 Hz tick snapshots positions/velocities, packs a 32 × 32 spatial grid, computes independent steering and commits movement. Neighbours use a 32-unit radius; separation uses 10 units. Cohesion/alignment/separation weights are 0.65/1/1.6. Flee has weight 5 and a 100-unit radius. Normal speed is 70 units/second with a 180°/second turn limit.

Dense cells use a rotating, spatially distributed sample with a maximum of 48 candidate inspections per boid. Sparse regions inspect all candidates. This bounds neighbour work while retaining all 10,000 entities. Coincident boids receive an opposing deterministic separation impulse.

The renderer interpolates wrapped positions between ticks, streams one instance buffer and draws boids/predators in one instanced call. No per-boid DOM elements or JavaScript calls are involved. WASM is single-threaded and needs no cross-origin isolation. The canvas backing buffer is capped at 1024². The fixed simulation caps catch-up at four ticks, discards excess accumulated lag and pauses in hidden tabs; a slow device may therefore lose simulated time rather than accumulate an unbounded backlog.

## Deployment

Pushes to `main` run native and WASM tests plus Chromium smoke tests, then publish `build/site` through GitHub Pages Actions. Pull requests run checks without deployment. Dependencies are pinned; Flecs source and its MIT licence are vendored. No backend is required.
