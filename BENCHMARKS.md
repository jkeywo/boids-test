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
