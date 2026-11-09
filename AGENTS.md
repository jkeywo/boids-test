# boids-test

Standalone project. Do not modify sibling repositories.

- C++20/Flecs simulation; WebGL 2 renderer compiled with Emscripten 4.0.23.
- `python tools/build.py --test` builds/tests WASM and emits `build/site`.
- Native tests: CMake configure/build, then CTest (see README).
- `npm ci` and `npm run test:browser` run browser smoke checks after building.
- Keep the population at 10,000, toroidal neighbour displacement, bounded neighbour work, and fixed 60 Hz simulation.
- UI commands cross the WASM boundary; boid simulation stays in C++.
- Site files use relative URLs to work beneath `/boids-test/` on GitHub Pages.
- `artifacts/`, `build/` and `.tools/` are local output and must not be committed.
- CI deploys successful main builds. Record actual hardware for performance claims.
