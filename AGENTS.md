# boids-test

Standalone project. Do not modify sibling repositories.

- C++20/Flecs CPU simulation and WebGL 2 renderer compiled with Emscripten 4.0.23; WebGPU/WGSL for the optional 100,000-boid mode.
- `python tools/build.py --test` builds/tests WASM and emits `build/site`.
- Native tests: CMake configure/build, then CTest (see README).
- `npm ci` and `npm run test:browser` run browser smoke checks after building.
- Support live CPU populations 1,000-100,000 and GPU populations 10,000-1,000,000 (defaults 10,000/100,000), toroidal neighbour displacement, bounded neighbour work, and fixed 60 Hz simulation.
- UI commands cross the WASM boundary; CPU boid simulation stays in C++; GPU boid state and computation stay on the GPU.
- Site files use relative URLs to work beneath `/boids-test/` on GitHub Pages.
- `artifacts/`, `build/` and `.tools/` are local output and must not be committed.
- CI deploys successful main builds. Record actual hardware for performance claims.

- Preset slots contain only boid motion, flock functors and boid appearance. Map/backend, predator count and all Predators-panel parameters are global generic settings.
- Predator speed multipliers are deterministic per birth and fixed for each lifetime; never reroll them on ticks, preset changes or movement-mode changes.
