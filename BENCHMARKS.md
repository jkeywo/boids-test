# Performance validation

Measured on 9 November 2026 with 10,000 boids and a 1024 × 1024 backing buffer, using headless Google Chrome 156 with normal requestAnimationFrame scheduling. Hardware: Intel Core Ultra 9 275HX and NVIDIA GeForce RTX 5090 Laptop GPU, Windows x64. Each scenario includes a one-second settling period followed by a 60-second sample.

| Scenario | Mean FPS | p50 frame (ms) | p95 frame (ms) | p99 frame (ms) | Mean reported tick (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard flock | 60.00 | 16.70 | 16.80 | 16.90 | 9.79 |
| Shoal enabled | 59.83 | 16.70 | 16.80 | 17.30 | 10.16 |
| Shoal + 8 orbiting predators | 59.98 | 16.70 | 16.90 | 17.60 | 10.46 |
| Shoal + 16 orbiting predators | 59.50 | 16.70 | 16.80 | 17.00 | 9.98 |

The predator scenarios include a crossing predator during the initial portion of the sample. All boids remain active throughout. The simulation runs at a fixed 60 Hz; rendering interpolates between ticks. Occasional stalls mean the result should be described as approximately 60 fps, rather than a guarantee of 60 on every frame.

The raw local report is saved at `artifacts/desktop-chrome-60s.json`. Browser test output also reports the user agent and WebGL renderer, allowing a software-rendered run to be distinguished from a hardware-rendered one.

## Correctness and compatibility

- 10,034 checks pass under native MSVC C++ and Node-hosted WebAssembly, including both-axis seam interactions, shoal timing, predator lifecycle/count boundaries, and a fully coincident 10,000-boid cluster.
- Browser smoke checks cover WASM/WebGL loading, controls, predator cleanup, count limits, and desktop/mobile layout under the GitHub Pages project path.
- Real iPhone/Pixel hardware and Safari have not been tested. A phone-sized desktop viewport validates layout only; it does not verify mobile performance. No mobile 60 fps claim is made.

## Reproduce

Build with `python tools/build.py --test`, install browser dependencies as described in README.md, then run:

```powershell
$env:BROWSER_CHANNEL = 'chrome'
$env:BENCHMARK_SECONDS = '60'
npm run test:browser
```

Omit `BROWSER_CHANNEL` to use the bundled Chromium. Set `BROWSER_ENGINE=firefox` to run the same checks in Playwright Firefox after `npx playwright install firefox`. Set `TEST_URL=https://jkeywo.github.io/boids-test/` to exercise the deployed build.

For real mobile hardware, use its remote developer console to call `boidsTest.startBenchmark()`, leave the visible page running for 60 seconds, and call `boidsTest.stopBenchmark()`. Record the phone, browser version, render resolution, and thermal conditions alongside the result.
