# Controls, map sizes and concurrent predators

Validation for [d968992](https://github.com/jkeywo/boids-test/commit/d968992), measured on 9 November 2026. Shoal now uses the same checkbox as the other five functors. The map selector offers 1024, 512 and 256 units. Each predator launch is independent of existing crossings; expired crossings leave individually.

## Correctness

- 10,192 checks pass in native MSVC C++ and Node-hosted WebAssembly. They cover all three map sizes, the dense 256 map at maximum interaction radius, 70 simultaneous launches, independent orbit/crossing lifecycles, and flee responses from predators beyond the old bitmask capacity.
- Chromium and Firefox exercise all 27 sliders and six checkboxes, all three map sizes, and overlapping launches. A browser burst creates more than 40 crossings and verifies that the expanded instance buffer produces no WebGL error.
- [CI build, browser checks and deployment](https://github.com/jkeywo/boids-test/actions/runs/42569998786) are green. The published WASM matches the locally tested binary byte for byte: SHA-256 `12467F6B087BC1F6EAD1CD018FD8EEBCF0BF08F15D91E1964A091B4D32603453`.

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
