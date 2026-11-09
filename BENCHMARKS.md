# Predator flights, Random and Hunt movement

Release [03d4ced](https://github.com/jkeywo/boids-test/commit/03d4ced) sends each launched predator toward its own random point on the right edge. Resident predators support Orbit, independently seeded Perlin turn steering in (x, y, time), and bounded turning toward the highest-density nearby boid cell. The right-hand Predators panel exposes the movement selector plus roaming speed, turn-rate, noise spatial/time and hunt-radius sliders. Settings persist and reset normally; the UI now has 34 sliders, eight checkboxes and one parameter dropdown.

Native MSVC and Node/WASM each pass 11,540 checks. Tests cover flight geometry, independent targets, finite wrapped roaming, bounded turn rates, dense-vs-close target choice, hunt-radius exclusion, toroidal targets and externally supplied density. Chrome CPU/GPU and Firefox CPU suites pass locally. Both CPU and GPU movement/control suites pass against the published site. [CI and Pages deployment](https://github.com/jkeywo/boids-test/actions/runs/42596218750) pass, including software-GPU density and movement checks. Published WASM SHA-256 matches the tested local build: `252002E79F704FC1C17801F1621C6834BE9C7D54AF4FA9D081F3E51E26ABB158`.

Hardware measurement: Windows x64, Intel Core Ultra 9 275HX, RTX 5090 Laptop GPU, Chrome 156 headless, normal RAF scheduling, non-fallback NVIDIA WebGPU adapter. Each 60-second sample simulates all 100,000 boids on a 1024 map with six-octave wind, shoal boosts and 16 resident predators; one crossing launches before warm-up and exits early.

| Resident mode | Mean completed FPS | Simulation Hz | p95 / p99 RAF ms | Mean sampled GPU compute ms/tick | CPU submission ms/frame |
| --- | ---: | ---: | ---: | ---: | ---: |
| Random | 60.00 | 60.00 | 16.80 / 16.90 | 0.278 | 0.139 |
| Hunt | 60.00 | 60.00 | 16.80 / 16.90 | 0.288 | 0.153 |

Hunt counts all boids into an uncapped 32 x 32 GPU density field, independently of the bounded neighbour sample. Only this 4 KB field is read asynchronously at up to 10 Hz in simulation time; individual boid state is not read back. The C++ predator controller uses that field rather than the paused CPU flock. Browser tests verify totals of 100,000 in GPU mode and 10,000 in CPU mode with boid-neighbour rules disabled. Resizing and mode changes invalidate stale fields. Hunt resolution and GPU sensor latency are approximations; these hardware results do not establish performance on every device.

Reproduce with `BROWSER_CHANNEL=chrome`, `BENCHMARK_SECONDS=60`, `BENCHMARK_SCENARIOS=gpu-random,gpu-hunt`, then `npm run test:gpu`. Raw local report: `artifacts/predator-modes-gpu-60s.json`.

---

# Appearance controls and hue wrapping

Release [a904d08](https://github.com/jkeywo/boids-test/commit/a904d08) adds a base boid hue, a dark background in that hue, optional direction colouring and an optional signed hue offset during shoal boosts. All four controls persist in local storage and reset to their defaults. The UI now exposes 29 sliders and eight checkboxes. GPU configuration packing derives from the parameter registry instead of assuming a fixed array size.

Rendered-pixel tests verify base hues, 360-degree wrapping, background colours, multiple direction hues, positive and negative shoal offsets, and disabling the offset in both WebGL and WebGPU. Chrome and Firefox CPU checks pass locally. Native/WASM checks pass (10,196 each). [CI and Pages deployment](https://github.com/jkeywo/boids-test/actions/runs/42582799734) pass, including the software-GPU tests. Both CPU and GPU colour/control suites pass on the published HTTPS site. Published WASM SHA-256 matches the tested local build: `06B2DF1AE889CD9BF43349C1990AF1F236E4958134DA31CC6A3AD292DDEFBF42`.

On the same Windows/Chrome 156/RTX 5090 Laptop GPU hardware documented below, the final GPU code sustained **60.00 FPS over 60 seconds** with 100,000 boids on the 256 map, direction colouring enabled, base hue 310 degrees, shoal offset +120 degrees, six-octave wind, shoal boosts and 16 orbiting predators. Simulation rate: 59.99 Hz; p95/p99 RAF interval: 17.00/17.00 ms; mean sampled GPU compute: 0.468 ms/tick. A crossing predator exits early in the sample. Raw local report: `artifacts/hue-direction-gpu-60s-guard.json`. This release also matches the CPU boundary guard when GPU wrapping rounds a tiny negative coordinate up to exactly the map extent.

---

# 100,000-boid GPU mode

Measured on 9 November 2026 for [ebb8e87](https://github.com/jkeywo/boids-test/commit/ebb8e87). Windows x64, Intel Core Ultra 9 275HX, NVIDIA GeForce RTX 5090 Laptop GPU, installed Chrome 156 in headless mode. WebGPU reports a non-fallback NVIDIA Blackwell adapter. Normal requestAnimationFrame scheduling; no experimental WebGPU or software-rendering flags in these hardware runs. Each scenario runs for a full 60 seconds after warm-up, with all 100,000 boids active and a 32-candidate budget.

| Scenario | World / GPU canvas | Mean completed FPS | Simulation Hz | p95 frame ms | p99 frame ms | Mean sampled GPU compute ms/tick | CPU submit ms/frame |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Default flock | 1024 / 1024 | 60.00 | 59.98 | 16.90 | 17.00 | 0.212 | 0.136 |
| Six-octave wind, shoal, 16 orbiting predators | 512 / 512 | 60.00 | 59.97 | 16.90 | 17.00 | 0.285 | 0.146 |
| Six-octave wind, shoal, 16 orbiting predators | 256 / 256 | 60.00 | 60.02 | 17.00 | 17.00 | 0.347 | 0.113 |

A crossing predator launches before each heavy scenario and exits early in the sample. Tick counts can differ by one at measurement boundaries. GPU compute figures use asynchronously sampled timestamp queries across binning, wind and steering/integration; they exclude the draw pass. The reported mean averages the latest sample visible each frame. Browser timestamp precision is limited, so sub-millisecond values are approximate. CPU submit time measures command preparation/submission, not GPU completion. FPS counts completed GPU submissions; p95/p99 describe RAF intervals. The first report's renderResolution field incorrectly read the hidden CPU canvas (1022); the GPU test explicitly set the actual GPU canvas to 1024 before timing. This reporting field has been corrected.

The GPU keeps two 3.2 MB boid storage buffers and draws directly from them. Spatial work is bounded: up to 128 rotating representatives per cell and 32 candidates per boid. This approximates dense neighbourhoods; it does not skip simulation of any boids. A maximum of two GPU frames can be in flight. The GPU path performs no normal per-frame boid readback.

Validation reads all 100,000 records and checks finite wrapped positions, movement, speed, wind response and shoal boost/disable. It verifies that CPU boid ticks stop during GPU mode, all three world sizes, maximum-radius 2x2 bins, 56 simultaneous predators, saved mode/parameters, factory reset, unsupported-WebGPU fallback and desktop/mobile layout. Native and WASM simulation checks still pass (10,192 each). CPU browser regression checks pass. Software-adapter CI validates shaders and behavior separately from hardware performance.

Release [84575a1](https://github.com/jkeywo/boids-test/commit/84575a1) passes [CI and Pages deployment](https://github.com/jkeywo/boids-test/actions/runs/42579877491), including all native/WASM, CPU browser and software-adapter GPU checks. The same full GPU functional test passes against the published HTTPS site in installed Chrome, with three-second compatibility samples of 59.94 / 60.09 / 59.70 FPS for the 1024 / 512 / 256 scenarios. These short published checks supplement the minute-long local measurements above. The deployed WASM matches the locally tested binary: SHA-256 `4B3ACE838F81E14F2DEB35E9CE9855E33D541712F38FA4D061A817358764230E`. CPU regression tests also pass locally in Firefox 142. Software GPU speed assertions allow 0.1 unit/s error at speed 180 because WGSL trigonometric functions permit small numerical approximations; tests wait for completed GPU ticks after settings changes.

These measurements demonstrate 60 FPS on this machine. They do not establish performance on integrated GPUs, phones, Safari or every WebGPU implementation. Raw local hardware report: `artifacts/gpu-chrome-60s.json` (ignored build evidence).

```powershell
$env:BROWSER_CHANNEL = 'chrome'
$env:BENCHMARK_SECONDS = '60'
npm run test:gpu
```

Set BENCHMARK_SCENARIOS to gpu-baseline, gpu-wind-small or gpu-wind-tiny to select cases; TEST_URL can target the deployed page.

---

# Saved settings and reset validation

For [73358b0](https://github.com/jkeywo/boids-test/commit/73358b0), the save/reload/reset checks pass in Chromium and Firefox. They cover all settings, map size before orbit-radius restoration, saved orbit count, pending-save flush on reload, factory reset, preservation of unrelated storage, malformed/future-version data and blocked local storage. The deployed page passes the same checks.

The existing 10,192 WebAssembly checks and native Linux CI checks remain green. [Release CI and deployment](https://github.com/jkeywo/boids-test/actions/runs/42571915362) pass. Published WASM SHA-256: `5950F851B2A04203F2F444E3A4F603EAC35A3D628A595BC50B2AAF90973D4265`, identical to the locally tested binary.

The measurements below are from the earlier recorded revision; this settings update does not change simulation physics.

## Earlier controls, map sizes and concurrent predator measurements

Validation for [d968992](https://github.com/jkeywo/boids-test/commit/d968992), measured on 9 November 2026. Shoal now uses the same checkbox as the other five functors. The map selector offers 1024, 512 and 256 units. Each predator launch is independent of existing crossings; expired crossings leave individually.

## Correctness

- 10,192 checks pass in native MSVC C++ and Node-hosted WebAssembly. They cover all three map sizes, the dense 256 map at maximum interaction radius, 70 simultaneous launches, independent orbit/crossing lifecycles, and flee responses from predators beyond the old bitmask capacity.
- Chromium and Firefox exercise all 27 sliders and six checkboxes, all three map sizes, and overlapping launches. A browser burst creates more than 40 crossings and verifies that the expanded instance buffer produces no WebGL error.
- [CI build, browser checks and deployment](https://github.com/jkeywo/boids-test/actions/runs/42569998786) are green. For this recorded revision, the published WASM matched the locally tested binary byte for byte: SHA-256 `12467F6B087BC1F6EAD1CD018FD8EEBCF0BF08F15D91E1964A091B4D32603453`.

## 256-map performance

10,000 boids on a 256 x 256 map/backing buffer, shoal enabled, six-octave wind and 16 orbiting predators. Eight crossing predators launch before the one-second settling period; they exit during the start of the sample. The sample then continues with the orbiting predators. Browsers use normal requestAnimationFrame scheduling in headless mode.

Hardware: Intel Core Ultra 9 275HX, NVIDIA GeForce RTX 5090 Laptop GPU, Windows x64. Firefox reports a generic "GTX 980 ... or similar" renderer string on this PC.

| Browser | Sample | Mean FPS | Simulation Hz | p95 frame ms | p99 frame ms | Mean reported tick ms | Neighbour budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Chrome 156 | 60 s | 60.00 | 59.98 | 17.00 | 17.10 | 7.17 | 48-48 |
| Firefox 142 | 5 s | 42.52 | 60.00 | 33.34 | 33.34 | 15.05 | 8-8 |

Chrome sustained 60 fps for the full minute. Firefox passed the functional checks but renders this heavy 256-map scene below the 60 fps target, while maintaining approximately 60 simulation ticks per second. Its five-second run is a compatibility sample. Tick counts at sample boundaries can differ by one tick. Real mobile hardware and Safari remain untested.

Raw local reports: `artifacts/maps256-chrome-60s.json` and `artifacts/maps256-firefox-smoke.json`. These generated files are ignored by Git. [Previous 1024/512 wind measurements](https://github.com/jkeywo/boids-test/blob/fcbba4b/BENCHMARKS.md) are archived with their tested revision.

## Reproduce

After the build and browser setup in README.md:

```powershell
$env:BROWSER_CHANNEL = 'chrome'
$env:BENCHMARK_SCENARIOS = 'wind-tiny'
$env:BENCHMARK_SECONDS = '60'
npm run test:browser
```

Set `BROWSER_ENGINE=firefox` to use Playwright Firefox. Omit `BENCHMARK_SCENARIOS` to run all seven cases. `TEST_URL=https://jkeywo.github.io/boids-test/` targets the published app. Reports save complete settings and user agents alongside timing data.
