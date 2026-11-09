# Tiled wind and unbiased neighbour sampling

Fixed both backends after reproducing grid dependence on the CPU with Wind disabled. The old CPU quota/remainder allocation was anchored to a fixed cell partition and reused its sampling phase for eight ticks. GPU quotas used capped representative counts instead of actual populations, while first-arrival pools could favour particular logical IDs. Wind wrapped its lookup table around non-periodic underlying noise, with bilinear derivative discontinuities and aliased high octaves.

CPU sampling now uses a systematic sample of the full adjacent-cell population. GPU sampling weights uncapped populations and uses hash-stratified min-hash representatives independent of arrival order. Both translate the periodic sampling grid and refresh the sampling phase each tick. Sampling remains bounded (CPU adaptive 8–48 candidates; GPU 32, at most 128 representatives per cell), so individual trajectories retain sampling noise rather than exact all-pairs equivalence.

Wind wraps the Perlin lattice in both spatial dimensions, blends neighbouring integer periods for arbitrary scales, filters octaves beyond cache resolution, and uses wrapped bicubic interpolation. The cache has 64 nodes per side by default, rising to 128/256 at finer spatial scales. Time remains the third noise dimension, with 15 Hz keyframe reuse. This removes spatial seam/derivative discontinuities without a per-boid noise evaluation.

MSVC native and Node/WASM each pass **61,383 checks**. New tests compare dense frozen CPU sampling means against exhaustive sums at five translations, verify full-cell sampling-origin coverage, and check raw/cached wind seam values and derivatives. WebGPU passes **6,144 dense steering probes with zero errors**, an exact sparse all-pairs reference across both wrapping seams, and wind continuity/finite-state probes at three scales on all three maps. Existing population, presets, predators, rendering, browser and mobile-layout checks pass.

Hardware: Intel Core Ultra 9 275HX, NVIDIA GeForce RTX 5090 Laptop GPU, Windows x64, Chrome 156 headless. Normal RAF, 920-square backing resolution, ten-second samples:

| Scene | FPS | Simulation Hz | CPU tick ms | GPU compute ms/tick |
| --- | ---: | ---: | ---: | ---: |
| CPU 10,000 | 60.00 | 60.00 | 4.20 | — |
| CPU 10,000, six-octave wind | 60.00 | 60.00 | 4.93 | — |
| CPU 100,000 | 53.81 | 55.11 | 17.20 | — |
| GPU 1,000,000 | 59.96 | 59.90 | — | 6.76 |
| GPU 1,000,000, six-octave wind | 59.95 | 60.00 | — | 8.57 |
| GPU 1,000,000, wind + 4 swarms + 10,000 boids/s swaps | 60.00 | 60.00 | — | 9.94 |

CPU maximum uses eight candidates; the 10,000 scenes retain 48. Warm-up is three seconds except CPU maximum (20 seconds). Wind scale is 160. The CPU maximum remains below 60 FPS; no claim covers every parameter combination or mobile hardware.

Fixed-budget processing probes (360 measured ticks after 120 warm-up) show the correctness cost: CPU baseline 3.57 → 4.91 ms/frame and heavy wind/predator scene 5.29 → 6.33 ms/frame; GPU compute baseline 0.151 → 0.566 ms/tick and heavy scene 0.169 → 0.603 ms/tick at 100,000 boids. Grid preparation itself becomes cheaper through shared cumulative distributions; corrected sampling and smoother wind cost more. The revised stochastic trajectories also change scene structure, so these are processing observations rather than identical-input microbenchmarks. Raw measurements and reproduction notes: [benchmarks/wrapping-fix.json](benchmarks/wrapping-fix.json).

---

# Live populations, mode-aware predator controls and swarm forests

The Boids slider under Simulation mode uses `base * 10^(2t)` with t in [0,1], rounded to whole boids. CPU base is 1,000 and GPU base 10,000; midpoints are the existing 10,000/100,000 defaults, and endpoints reach 100,000 CPU / 1,000,000 GPU. The shared slider position is generic autosaved state, independent of flock slots. CPU Flecs entities grow/shrink live; GPU storage grows amortised, preserves both interpolation buffers and initialises only new tails. Resizing an inactive backend's map is applied before spawning additions. Active survivors and clocks continue without a restart.

Predator rows now follow the movement dropdown: Orbit radius/period for Orbit; roaming speed/turn/noise for Random and Hunt's fallback search; hunt radius only for Hunt; crossing speed in every mode. Hidden rows retain their values. Swarm adds a 1-512 power-of-two count (default 1) and 0-10,000 boids/s swap rate in 0.1 increments (default 0). Low bits assign groups and roots 0 through S-1; the remaining bits form each binary tree. A swap exchanges two logical roles while retaining physical state and interpolation. The rate counts both participants, so pair frequency is half the displayed rate. Fractional budgets accrue per simulated tick. These two parameters are flock-preset settings.

GPU swaps copy the current state once then overwrite disjoint selected pairs in a compute pass. A keyed Feistel permutation with cycle walking supplies unique random indices without atomics, races or individual boid readback in normal simulation. CPU swaps use the same permutation and physical-state semantics. Default rate zero skips the swap work.

Validation: MSVC native and Node/WASM pass **61,161 checks**, including permutation bijections/inverses, root membership, growth to 100,000, survivor/predator continuity, interpolation and zero/fractional swap rates. Browser probes exercise every logarithmic anchor in both modes, reach one million on the GPU, compare surviving GPU records byte-for-byte, scan all live records for valid positions/velocities, check mode visibility and save/reload/preset behaviour. GPU tests compare all words of selected/unselected records after a swap and verify rate accounting. One-root and four-root forests both achieve >98% correct-parent alignment with neighbour rules disabled. Existing scaled rendering, wind/shoal, predator and layout suites pass.

Hardware observations (normal RAF, 920-square backing resolution, Chrome 156 headless, Windows x64, Intel Core Ultra 9 275HX / RTX 5090 Laptop GPU):

| Scenario | Boids | Completed FPS | Simulation Hz | Sampled GPU compute ms/tick |
| --- | ---: | ---: | ---: | ---: |
| CPU default flock | 100,000 | 37.14 | 36.14 | - |
| GPU default flock | 1,000,000 | 59.72 | 60.00 | 1.705 |
| GPU + 4 swarms + 10,000 boids/s swaps | 1,000,000 | 60.01 | 60.00 | 1.795 |

Samples are 10 seconds, after 20 seconds CPU / 3 seconds GPU warm-up. CPU max-count work uses its minimum eight-neighbour budget. Under overload, the CPU browser loop limits catch-up to one fixed tick per display frame; this improved max-count display responsiveness from approximately 10 to 37 FPS in the local observation while retaining the requested population. The initial CPU neighbour budget also adapts immediately to population size. These are device-specific measurements: **the CPU maximum does not reach 60 FPS on this machine**. Raw measurements: [benchmarks/population-limits.json](benchmarks/population-limits.json). Defaults remain at their previous counts and around 60 FPS.

Chrome CPU/GPU and Firefox CPU suites pass. [CI and Pages deployment](https://github.com/jkeywo/boids-test/actions/runs/42649073461) pass for [f004671](https://github.com/jkeywo/boids-test/commit/f004671), including software-GPU million-boid resizing, storage-word swap validation and one/four-root forest tests. Live Pages checks confirm all six CPU/GPU anchor counts, defaults of one swarm/zero swaps, active CPU and GPU swapping, finite wrapped GPU records and mode-dependent predator rows, with no browser/GPU errors. Published WASM SHA-256 matches the tested build: `24B9B9A6E563FEC4EFD8890B7E11B5F83EB23E2C5B664A4DF50D36175BFA7618`; HTML, CSS, loader, app, GPU host and both shaders match as well (text line endings normalised).

---

# Uniform map scaling

The 1024, 512 and 256 maps now use spatial factors 1, 0.5 and 0.25 throughout CPU and GPU simulation/rendering. Slider/preset values stay in 1024-map reference units; native parameter evaluation and GPU uniform packing convert distance/speed units locally. Positions and velocities rescale on map switches. Flock, flee, hunt and orbit radii; wind/random noise scales; all movement/prediction speeds; spawn/exit margins; and boid/predator glyphs have consistent screen dimensions. Angles, durations, weights and populations are unchanged. Repulsion regularisation and coincidence tolerances scale with distance squared, preserving force balance. The canvas backing resolution is now independent of map extent, capped at 1024 squared.

Native MSVC and Node/WASM each pass **13,854 checks**, including normalised multi-tick trajectories with every flock functor and all predator movement modes, forecast centres, fixed speeds, canonical settings and map round trips. CPU browser probes freeze motion and get identical complete pixel hashes at 1024/512/256/1024 (920-square canvas, 69,525 coloured pixels, hash 342104164), with identical settings. GPU checks compare all 100,000 boids against the same reference at each scale: zero mismatches, identical 1,004 affected / 98,996 outside, and matching spatial uniforms. Actual GPU sprite readback at 1024-square resolution gives the same 2 boid pixels and 90 predator pixels in isolated crops on each map.

Settings version 4 converts the previously map-local orbit radius from versions 1-3 into reference units once. Tests cover version-2 active-slot migration, version-3 orbit conversion, version-4 reload without double scaling, preset continuity and generic/flock separation. Historical smaller-map benchmarks below predate this uniform scaling.

Chrome CPU/GPU and Firefox CPU suites pass. Short hardware RAF samples remain about 60 FPS at 1024-square backing resolution, including the 256-map scene (Intel Core Ultra 9 275HX / RTX 5090 Laptop GPU, Chrome 156 headless). [CI and Pages deployment](https://github.com/jkeywo/boids-test/actions/runs/42640172831) pass for [3fabd7c](https://github.com/jkeywo/boids-test/commit/3fabd7c), including software-GPU pixel/force checks. Live CPU/GPU checks pass on all three maps: constant 920-square backing resolution, unchanged reference settings/populations, normalised orbit radius 400, finite wrapped GPU positions and normalised GPU speed 70 (maximum error below 0.000016), with no browser/GPU errors. Published WASM SHA-256 matches the tested build: `A723A2E68BBC254A7F8FCB79EB411D06783BE31B0FB6A6639E723B9CEDD2C105`; loader, app, GPU host and shaders match as well (text line endings normalised).

---

# Predictive elliptical predator avoidance

Predator flee now uses a heading-aligned ellipse at the linearly projected position `position + velocity * predictionSeconds`, with toroidal wrapping. Prediction defaults to 0.5 seconds and has a 0-3 second slider. Forward and Side radius are independently configurable semi-axes (defaults 100 and 50 units); the existing `flee-radius` key remains the forward radius. Weight and enable are unchanged. New fields are flock-preset settings, with defaults merged into older saved slots. Current velocity includes the predator's deterministic speed multiplier, using crossing/roaming speed or orbit tangential speed.

The outward ellipse normal supplies the flee direction, with falloff `1 - sqrt((forward/a)^2 + (side/b)^2)` inside the ellipse and zero outside. A coincident centre gets a finite lateral escape. CPU mode caches projected centres/directions once per predator per tick and bins them with a conservative bound from the larger semi-axis. GPU predator records now carry both the displayed position/direction and predicted centre; rendering uses the matching 32-byte record stride. All boid state remains on the GPU in normal GPU simulation.

Validation: native MSVC and Node/WASM each pass **12,239 checks**, including prediction speed/modes, zero/configurable lookahead, multiple-wrap projection, rotated ellipse membership, falloff/normal, coincident and near-centre cases, both seams, projected CPU broadphase and wide-side bounds. Browser tests check centre prediction at 0/0.5/3 seconds in Orbit/Random/Hunt, new parameter controls, flock presets, storage/reset and existing features. A separate GPU test checks one actual compute step for all 100,000 boids against an independent JavaScript reference, including exact centre/edge fixtures: 1,004 affected, 98,996 outside, zero mismatches (maximum velocity error approximately 0.000011 units/second). It also distinguishes 221 projected-only hits and 2,925 points excluded by the narrower ellipse.

Installed Chrome CPU tests pass for desktop/mobile layout and controls. Thirty-second RAF samples hold approximately 60 FPS and 60 simulation Hz for baseline and 256-map/six-octave-wind/16-predator scenes; the normal adaptive CPU budget ranges 32-48 in the latter. Hardware: Windows x64, Intel Core Ultra 9 275HX, NVIDIA RTX 5090 Laptop GPU, Chrome 156 headless. Raw CPU report: `artifacts/ellipse-cpu-30s.json`. GPU Hunt and 256-map wind samples also pass at 59.98/59.99 completed FPS and 59.93 simulation Hz, with average compute costs 0.175/0.109 ms per tick. Raw GPU report: `artifacts/ellipse-gpu-30s.json`.

Firefox CPU browser checks also pass. [CI and Pages deployment](https://github.com/jkeywo/boids-test/actions/runs/42634237169) pass for [b7941a7](https://github.com/jkeywo/boids-test/commit/b7941a7), including the software-GPU reference test. Live Pages checks confirm the 0.5-second/50-unit side defaults, advancing CPU and GPU modes, and 100,000 finite GPU positions/velocities with wrapped positions and no browser/GPU errors. Published WASM SHA-256 matches the tested build: `7B2D76FA1AC82CFB5D371252EDCDC2C78B43128825E06DAEBAF7D812A23CF267`; loader, app, GPU host and both shaders also match (text compared with normalised line endings).

---

# CPU and GPU optimisation pass — 9 November 2026

Compared with `f7a91f0`, using identical population, map, candidate budgets and functor settings. Hardware: Windows x64, Intel Core Ultra 9 275HX, NVIDIA RTX 5090 Laptop GPU, installed Chrome 156 headless with the non-fallback NVIDIA adapter. Each fresh scene warms 120 fixed 60 Hz ticks, then measures 600 ticks; three alternating before/after runs. CPU profiling fixes the full 48-candidate budget. GPU retains 32 candidates and 128 representatives per cell. Normal production builds retain adaptive CPU quality. The baseline received only the same profiling instrumentation. Raw samples and metadata: [benchmarks/optimization-pass.json](benchmarks/optimization-pass.json).

CPU numbers measure simulation plus CPU render preparation/WebGL submission. GPU numbers are completed hardware timestamps for **compute plus rendering**, excluding the asynchronous timer readback and host waits. These are processing costs, not uncapped display FPS or end-to-end browser latency. The RAF cap remains 60 Hz. CPU clock/load variation is visible in the ranges below; a median ratio is not a guaranteed gain on every run or device.

| Mode / scene | Before median ms | After median ms | Median speedup | Before range ms | After range ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| CPU / baseline | 7.692 | 3.430 | 2.24x | 6.590–8.116 | 3.378–4.417 |
| CPU / heavy | 8.733 | 4.113 | 2.12x | 7.274–9.177 | 4.045–5.442 |
| CPU / tiny | 8.324 | 3.988 | 2.09x | 7.905–10.548 | 3.969–5.148 |
| CPU / swarm | 0.663 | 0.246 | 2.70x | 0.548–0.711 | 0.240–0.252 |
| GPU / baseline | 0.262 | 0.199 | 1.31x | 0.262–0.263 | 0.199–0.201 |
| GPU / heavy | 0.300 | 0.220 | 1.36x | 0.299–0.301 | 0.216–0.220 |
| GPU / tiny | 0.366 | 0.171 | 2.14x | 0.365–0.380 | 0.169–0.177 |
| GPU / swarm | 0.055 | 0.055 | 0.98x | 0.055–0.057 | 0.054–0.057 |

Baseline: 1024 map, default flocking, no predators. Heavy: 1024 map, default flocking plus six-octave wind, shoal, direction hue and 16 Hunt predators. Tiny: the same heavy settings on a 256 map. Swarm: 1024 map, only Swarm steering enabled, no predators. All 10,000 CPU or 100,000 GPU boids remain active. The two implementations already use different bounded samples; floating-point summation/steering changes can also cause trajectories to diverge over time.

The CPU meets the 2x target in these median frame-processing samples. GPU heavy/tiny compute alone drops from approximately 0.318 to 0.121 ms; including rendering gives 2.14x. GPU baseline/heavy on the larger map improve by 1.31x/1.36x, below target. GPU swarm-only is effectively unchanged (0.98x median); it already has very little compute work. Rendering by itself did not show a reliable gain. No claim of universal 2x speedup is made.

The pass covers packed SIMD neighbour reads and shared sampling plans, vector steering/shoal thresholds, wind interpolation/keyframe reuse, predator broadphase storage/flee arithmetic, direct Flecs instance extraction, GPU colour caching and reused host staging/upload work. Hunt density resolution and cadence, functor radii/weights and candidate budgets are preserved. The extra GPU plan buffer uses approximately 1.27 MiB and brings compute storage bindings to WebGPU's standard limit of eight. CPU plans use approximately 1.27 MiB. WASM now uses SIMD128; native x64 uses SSE2, with a scalar path on other native targets.

Reproduce current processing costs with `python tools/build.py --test --profile`, `$env:PERF_FRAMES='600'`, then `npm run benchmark:stages`. Preserve a profiling build under a different directory and set `PERF_SITE` to alternate versions; `PERF_OUTPUT` selects each JSON output. This harness freezes normal RAF and drives completed fixed ticks directly. Production validation: MSVC native and Node/WASM each pass **12,217 checks**, including 631 new all-pairs/SIMD and predator-broadphase checks. Installed Chrome passes CPU and GPU browser suites for controls, colour, wrapped maps, wind/shoal, predator paths/density, presets, persistence, fallback and desktop/mobile layout. The GPU Swarm check validates 99,990 records with zero invalid records and >99% aligned to the correct parents.

Normal RAF production runs, 30 seconds per scenario: CPU baseline/tiny report 60.00 FPS and 60.00/59.97 simulation Hz, retaining the full 48-candidate budget. GPU baseline/tiny/Hunt report 59.99/59.98/60.00 completed FPS and approximately 60 simulation Hz. GPU compute averages 0.176/0.116/0.161 ms/tick respectively. These are hardware-specific 60 Hz observations, not a promise for other GPUs or mobile hardware. The raw production reports are included in the measurement JSON.

Firefox CPU/WASM also passes the browser suite. [CI and Pages deployment](https://github.com/jkeywo/boids-test/actions/runs/42625849880) pass for code release [0d62201](https://github.com/jkeywo/boids-test/commit/0d62201), including Linux native, WASM, browser and software-GPU tests. The live Pages CPU and GPU modes both advance; a diagnostic snapshot confirms all 100,000 GPU positions/velocities are finite and wrapped, with no browser/GPU errors. Published WASM SHA-256 matches the tested production build: `C55FFDB1C7C668F640F7F5D0F23F4A23020D59CBDC5EED743D7F12A350645897`. Published loader, app, GPU host and both shaders also match the tested assets (text compared with normalised line endings).

---

# Flock-only presets and fixed predator speed variation

Release [221081b](https://github.com/jkeywo/boids-test/commit/221081b) separates flock presets from generic settings. The six presets store only boid motion, functors (including predator-flee response) and boid appearance. Map size, backend, resident count and all Predators-panel controls are global and autosaved. Switching or resetting a flock preset preserves live predators and their identities. Version 2 saves migrate generic values from the formerly active slot; version 1 saves migrate their scene-wide values. The version 3 record retains the existing storage key.

Each actual predator birth gets an increasing identity and a deterministic hashed 0.8x-1.2x speed multiplier. The multiplier remains fixed for its lifetime and applies to crossing speed, roaming speed and orbit angular speed. Mode, map and preset changes never reroll it. Global base speeds/periods remain live controls. Reloading creates new predators, as before; individual predator state is not a saved setting.

**11,586 native MSVC and Node/WASM checks pass.** Tests cover deterministic assignment independently of flock size, variation bounds, actual crossing/roaming/orbit movement, lifetime stability and non-reused identities. Chrome CPU/GPU and Firefox CPU suites pass flock-only serialization, global predator/map preservation, live identity/multiplier preservation, reset scope, and active-slot version 2 migration. [CI and Pages deployment](https://github.com/jkeywo/boids-test/actions/runs/42614294796) pass. The same CPU/GPU suites pass on the published page. Its WASM matches the tested local build: SHA-256 `C147E43B0548C483757F4DCF7D80A9C83D9771761D15C055DC2FDCFFAAD2ECEC`.

A full 60-second Chrome 156 hardware run on the documented RTX 5090 Laptop GPU setup sustained **60.00 FPS** with 100,000 boids, six-octave wind, shoal boosts and 16 Hunt predators using individual speed multipliers. Simulation rate: 60.02 Hz; p95/p99 RAF: 16.90/17.20 ms; mean sampled GPU compute: 0.229 ms/tick; CPU submission: 0.198 ms/frame. Map/backing size: 1024. One crossing exits early in the sample. Raw local report: `artifacts/global-settings-predator-speeds-60s.json`. These are hardware-specific measurements, not a universal device guarantee.

---

# Swarm and six live settings slots

Release [3c88e38](https://github.com/jkeywo/boids-test/commit/3c88e38) adds the Swarm functor and six coloured autosaving slots. Swarm follows the binary-tree parent `(index - 1) >> 1` for indices above zero, with wrapped displacement and a pre-tick snapshot. Boid 0 has no Swarm parent. All six slot buttons fill a fixed left-hand viewport-height column on desktop and mobile; slot switches apply settings to the current flock and preserve crossing flights. CPU/GPU selection is global. Reset changes only the active slot and preserves the other five and the running backend. Version 1 single-setting records migrate to slot 1 in the new six-slot version 2 record.

Native MSVC and Node/WASM each pass **11,555 checks**, including parent mapping, root behavior, seam following, disabled-neighbour operation and snapshot ordering. Chrome CPU/GPU and Firefox CPU pass slot switching, pending-save capture, all-slot reload, per-slot reset, legacy migration and blocked-storage checks. GPU tests read all 100,000 records and verify that over 98% aim toward the correct parent with other rules disabled, with a separate check for even indices to catch the off-by-one formula. Tick counters and crossing trajectories continue across slot switches. The mobile rail and right settings panel both span the viewport; one-off layout checks cover page scrolling and 393x852, 393x650, 852x393 and 1600x900 viewports.

[CI and Pages deployment](https://github.com/jkeywo/boids-test/actions/runs/42603844812) pass. The same CPU/GPU movement, slot and Swarm suites pass on the published HTTPS site. Published WASM SHA-256 matches the locally tested build: `7798CAC5CABB441C2B9D2694711E1F0AF60EC534732E67032BF80C795B8CC03E`.

A full 60-second hardware sample on the previously documented Windows/Chrome 156/RTX 5090 Laptop GPU setup sustained **60.00 FPS** with 100,000 boids on a 1024 map, Swarm enabled at weight 1, six-octave wind, shoal boosts and 16 orbiting predators. Simulation rate: 59.98 Hz; p95/p99 RAF intervals: 16.80/17.00 ms; mean sampled GPU compute: 0.286 ms/tick; CPU submission: 0.147 ms/frame. A crossing predator exits early in the sample. Raw local report: `artifacts/swarm-slots-gpu-60s.json`. Reproduce using `BROWSER_CHANNEL=chrome`, `BENCHMARK_SECONDS=60`, `BENCHMARK_SCENARIOS=gpu-swarm`, then `npm run test:gpu`.

The software-adapter CI benchmark waits for an actual completed simulation tick if a one-second window contains none; fixed-duration hardware measurements are unchanged. Software validation is not a 60 FPS performance claim. Real mobile hardware remains unmeasured.

---

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
