# Live parameter and wind validation

Measured on 9 November 2026 using 10,000 boids, shoal enabled and 16 orbiting predators. A crossing predator is included during the beginning of each sample. Wind uses its default spatial/time scales and weights; the small-map stress case uses six octaves. Each sample follows a one-second settling period.

Hardware: Intel Core Ultra 9 275HX and NVIDIA GeForce RTX 5090 Laptop GPU, Windows x64. Both browsers run headless with normal requestAnimationFrame scheduling. Firefox reports a generic "GTX 980 ... or similar" renderer string on this PC.

| Browser | Map / backing buffer | Wind octaves | Sample | Mean FPS | p95 frame ms | p99 frame ms | Mean reported tick ms | Neighbour budget |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Chrome 156 | 1024 x 1024 | 3 | 60 s | 60.00 | 17.00 | 17.10 | 6.76 | 48-48 |
| Chrome 156 | 512 x 512 | 6 | 60 s | 60.00 | 17.00 | 17.20 | 7.14 | 48-48 |
| Firefox 142 | 512 x 512 | 6 | 5 s | 60.00 | 16.68 | 16.68 | 11.43 | 8-8 |

Chrome sustained 60 fps for both full-minute samples. Firefox passed a short compatibility/stress sample at approximately 60 fps; its five-second result is not a full-minute performance claim. The simulation remains fixed at 60 Hz. Tick counts at measurement boundaries can differ by one tick.

Adaptive neighbour sampling keeps all 10,000 entities active. Budgets differ by browser and workload. Wind is sampled into a periodic 32 x 32 field at 15 Hz and interpolated in space and time; very fine octave detail is limited by the field resolution. These measurements apply to this PC. Real phone hardware and Safari remain untested.

## Correctness and publication

- 10,108 checks pass under native MSVC C++ and Node-hosted WebAssembly. Tests include independent radii/toggles, parameter bounds/nonfinite input, shoal settings, map rescaling, predator broadphase changes, 3D-noise continuity/time variation, frozen wind time and field wrapping.
- Browser checks exercise all 27 generated sliders, five new checkbox toggles and the existing shoal toggle, live map switching, orbit bounds, predator lifecycle and desktop/mobile layouts in Chromium and Firefox.
- GitHub Actions runs native Linux, WASM and Chromium checks before deployment. [Release checks](https://github.com/jkeywo/boids-test/actions/runs/42541965308) are green.
- Source: [9aaacca](https://github.com/jkeywo/boids-test/commit/9aaacca). The public WASM matches the locally tested binary byte for byte, SHA-256 `EB8DAA34280697F14ED485F0A7D7A24948736A2690061F79469ED53E237D81AF`.

Raw local reports: `artifacts/wind-chrome-60s.json` and `artifacts/wind-firefox-smoke.json`. These ignored generated files contain complete settings, user agents and timing samples. The command prints a timing summary. [Earlier baseline measurements](https://github.com/jkeywo/boids-test/blob/cfc6ad6/BENCHMARKS.md) are archived with their tested source revision.

## Reproduce

After building and installing browser dependencies as described in README.md:

```powershell
$env:BROWSER_CHANNEL = 'chrome'
$env:BENCHMARK_SCENARIOS = 'wind,wind-small'
$env:BENCHMARK_SECONDS = '60'
npm run test:browser
```

For Firefox, install it with `npx playwright install firefox` and set `BROWSER_ENGINE=firefox`. Omit `BENCHMARK_SCENARIOS` to include all six scenarios. `TEST_URL=https://jkeywo.github.io/boids-test/` targets the deployed site.

On real mobile hardware, use its remote developer console to call `boidsTest.startBenchmark()`, leave the visible page running for 60 seconds, then call `boidsTest.stopBenchmark()`. Record the device, browser version, settings, resolution and thermal conditions with the result.
