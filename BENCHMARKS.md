# Performance validation

Target: 10,000 boids at 60 fps, with the fixed simulation running at 60 Hz.

The release build has passed 10,033 checks under both native MSVC C++ and Node-hosted WebAssembly, including a fully coincident 10,000-boid cluster. Chromium smoke checks cover WASM/WebGL loading, controls, predator lifecycle/count boundaries, and desktop/mobile layout.

Desktop short samples reached approximately 60 fps. Full 60-second measurements are being recorded before final handover.

Real iPhone/Pixel hardware and Safari have not been tested. A phone-sized desktop viewport validates layout only; it does not verify mobile performance.

Reproduce measurements with `BENCHMARK_SECONDS=60 npm run test:browser` (set the environment variable using the syntax for your shell). Reports and screenshots are saved to `artifacts/`. See README.md for details.
