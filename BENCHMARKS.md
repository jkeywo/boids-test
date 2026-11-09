# Performance validation

Measured on 9 November 2026 with **10,000 active boids and a 1024 x 1024 backing buffer**. Each listed scenario has a one-second settling period followed by a 60-second sample, using normal requestAnimationFrame scheduling in headless browsers.

Hardware: Intel Core Ultra 9 275HX and NVIDIA GeForce RTX 5090 Laptop GPU, Windows x64. Chrome reports the RTX 5090 renderer. Firefox reports the generic string "GTX 980 ... or similar" on the same PC; the raw report preserves that string.

| Browser | Scenario | Mean FPS | Actual simulation Hz | p95 frame ms | p99 frame ms | Mean reported tick ms | Neighbour budget |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Chrome 156 | Standard flock | 60.00 | 60.00 | 16.90 | 17.10 | 6.56 | 32 |
| Chrome 156 | Shoal enabled | 60.00 | 60.00 | 16.90 | 17.10 | 6.57 | 32 |
| Chrome 156 | Shoal + 8 orbiting predators | 60.00 | 60.00 | 16.90 | 17.10 | 6.72 | 32 |
| Chrome 156 | Shoal + 16 orbiting predators | 60.00 | 60.00 | 16.90 | 17.10 | 6.80 | 32 |
| Firefox 142 | Shoal + 16 orbiting predators | 59.28 | 60.00 | 16.68 | 31.52 | 8.58 | 8 |

The predator samples include a crossing predator during their initial portion. Budget ranges are recorded because adaptive sampling changes neighbour work across browsers and scenes. All boids remain active throughout. The target simulation rate is 60 Hz; rendering interpolates between ticks.

Chrome sustains approximately 60 fps across the full scenario set. Firefox reaches approximately 59 fps in the heaviest tested scene, with occasional longer frames visible in its percentiles. These measurements establish performance on this PC; real iPhone/Pixel hardware and Safari remain untested. Phone-sized desktop viewports validate layout only.

Raw local reports: `artifacts/desktop-chrome-60s.json` and `artifacts/desktop-firefox-60s.json`. These generated files are intentionally ignored by Git. The benchmark command prints the full report, including user agent and WebGL renderer.

Measured source: [c5ca3bd](https://github.com/jkeywo/boids-test/commit/c5ca3bd). The public WASM matches the tested binary byte for byte (SHA-256: `44CDD0DD5160FE050715C8CB5790EE353F8594FDDBDF9A4BBE860F447AD7EDC8`).

## Correctness and deployment

- 10,039 checks pass under native MSVC C++ and Node-hosted WebAssembly, including both-axis seam interactions, shoal timing/rearming, predator lifecycle/count limits, adaptive work bounds, predator broadphase across the seam, and a fully coincident 10,000-boid cluster.
- Chromium and Firefox smoke checks cover WASM/WebGL loading, controls, predator cleanup, count limits, and desktop/mobile layout under the GitHub Pages project path.
- GitHub Actions runs native Linux tests, WASM tests and Chromium smoke checks before deploying. The public Pages site has also been smoke-tested.

## Reproduce

Build with `python tools/build.py --test`, install browser dependencies as described in README.md, then run:

```powershell
$env:BROWSER_CHANNEL = 'chrome'
$env:BENCHMARK_SECONDS = '60'
npm run test:browser
```

Omit `BROWSER_CHANNEL` to use bundled Chromium. For the Firefox stress sample, install it with `npx playwright install firefox`, set `BROWSER_ENGINE=firefox` and `BENCHMARK_SCENARIOS=sixteen-predators`, and run the same test. Set `TEST_URL=https://jkeywo.github.io/boids-test/` to exercise the deployed build.

For real mobile hardware, use its remote developer console to call `boidsTest.startBenchmark()`, leave the visible page running for 60 seconds, then call `boidsTest.stopBenchmark()`. Record the phone, browser version, render resolution and thermal conditions with the result.
