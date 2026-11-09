#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <string>
namespace boids {
// One registry supplies both C++ defaults/validation and the browser controls.
#define BOID_PARAMETERS(X)                                                     \
  X(Speed, "speed", "Motion", "Speed", "u/s", 10, 180, 1, 70, false)           \
  X(TurnRate, "turn-rate", "Motion", "Turn rate", "deg/s", 30, 720, 5, 180,    \
    false)                                                                     \
  X(CohesionEnabled, "cohesion-enabled", "Cohesion", "Enabled", "", 0, 1, 1,   \
    1, true)                                                                   \
  X(CohesionRadius, "cohesion-radius", "Cohesion", "Radius", "u", 1, 128, 1,   \
    32, false)                                                                 \
  X(CohesionWeight, "cohesion-weight", "Cohesion", "Weight", "", 0, 5, .05,    \
    .65, false)                                                                \
  X(AlignmentEnabled, "alignment-enabled", "Alignment", "Enabled", "", 0, 1,   \
    1, 1, true)                                                                \
  X(AlignmentRadius, "alignment-radius", "Alignment", "Radius", "u", 1, 128,   \
    1, 32, false)                                                              \
  X(AlignmentWeight, "alignment-weight", "Alignment", "Weight", "", 0, 5, .05, \
    1, false)                                                                  \
  X(RepulsionEnabled, "repulsion-enabled", "Repulsion", "Enabled", "", 0, 1,   \
    1, 1, true)                                                                \
  X(RepulsionRadius, "repulsion-radius", "Repulsion", "Radius", "u", 1, 128,   \
    1, 10, false)                                                              \
  X(RepulsionWeight, "repulsion-weight", "Repulsion", "Weight", "", 0, 5, .05, \
    1.6, false)                                                                \
  X(FleeEnabled, "flee-enabled", "Predator flee", "Enabled", "", 0, 1, 1, 1,   \
    true)                                                                      \
  X(FleeRadius, "flee-radius", "Predator flee", "Forward radius", "u", 1, 256, \
    1, 100, false)                                                             \
  X(FleeWeight, "flee-weight", "Predator flee", "Weight", "", 0, 12, .1, 5,    \
    false)                                                                     \
  X(ShoalEnabled, "shoal-enabled", "Shoal boost", "Enabled", "", 0, 1, 1, 0,   \
    true)                                                                      \
  X(ShoalThreshold, "shoal-threshold", "Shoal boost", "Turn threshold", "deg", \
    5, 180, 1, 45, false)                                                      \
  X(ShoalRearm, "shoal-rearm", "Shoal boost", "Rearm below", "deg", 0, 90, 1,  \
    20, false)                                                                 \
  X(ShoalDuration, "shoal-duration", "Shoal boost", "Boost duration", "s",     \
    .05, 3, .05, .6, false)                                                    \
  X(ShoalCooldown, "shoal-cooldown", "Shoal boost", "Cooldown after boost",    \
    "s", 0, 5, .05, .8, false)                                                 \
  X(ShoalSpeed, "shoal-speed", "Shoal boost", "Speed multiplier", "x", 1, 3,   \
    .05, 1.5, false)                                                           \
  X(ShoalTurn, "shoal-turn", "Shoal boost", "Turn multiplier", "x", 1, 4, .05, \
    2, false)                                                                  \
  X(WindEnabled, "wind-enabled", "Wind", "Enabled", "", 0, 1, 1, 0, true)      \
  X(WindOctaves, "wind-octaves", "Wind", "Octaves", "", 1, 6, 1, 3, false)     \
  X(WindScale, "wind-scale", "Wind", "Spatial scale", "u", 16, 512, 4, 160,    \
    false)                                                                     \
  X(WindTime, "wind-time", "Wind", "Time scale", "/s", 0, 1, .01, .15, false)  \
  X(WindWeight, "wind-weight", "Wind", "Weight", "", 0, 5, .05, 1, false)      \
  X(WindX, "wind-x", "Wind", "X force weight", "", 0, 5, .05, 1, false)        \
  X(WindY, "wind-y", "Wind", "Y force weight", "", 0, 5, .05, 1, false)        \
  X(WindPersistence, "wind-persistence", "Wind", "Persistence", "", 0, 1, .05, \
    .5, false)                                                                 \
  X(WindLacunarity, "wind-lacunarity", "Wind", "Lacunarity", "", 1, 4, .1, 2,  \
    false)                                                                     \
  X(OrbitRadius, "orbit-radius", "Predators", "Orbit radius", "u", 16, 496, 1, \
    400, false)                                                                \
  X(OrbitPeriod, "orbit-period", "Predators", "Orbit period", "s", 2, 60, 1,   \
    20, false)                                                                 \
  X(CrossingSpeed, "crossing-speed", "Predators", "Crossing speed", "u/s", 20, \
    400, 5, 180, false)                                                        \
  X(BoidHue, "boid-hue", "Appearance", "Boid hue", "deg", 0, 360, 1, 183,      \
    false)                                                                     \
  X(DirectionHue, "direction-hue", "Appearance", "Hue by direction", "", 0, 1, \
    1, 0, true)                                                                \
  X(ShoalHueEnabled, "shoal-hue-enabled", "Appearance", "Shoal hue offset",    \
    "", 0, 1, 1, 1, true)                                                      \
  X(ShoalHueOffset, "shoal-hue-offset", "Appearance", "Shoal offset", "deg",   \
    -180, 180, 1, -132, false)                                                 \
  X(PredatorMode, "predator-mode", "Predators", "Resident movement", "", 0, 2, \
    1, 0, false)                                                               \
  X(PredatorSpeed, "predator-speed", "Predators", "Roaming speed", "u/s", 10,  \
    400, 5, 100, false)                                                        \
  X(PredatorTurnRate, "predator-turn-rate", "Predators", "Turn rate", "deg/s", \
    10, 720, 5, 120, false)                                                    \
  X(PredatorNoiseScale, "predator-noise-scale", "Predators",                   \
    "Random noise scale", "u", 16, 1024, 4, 192, false)                        \
  X(PredatorNoiseTime, "predator-noise-time", "Predators",                     \
    "Random time scale", "/s", 0, 2, .01, .2, false)                           \
  X(PredatorHuntRadius, "predator-hunt-radius", "Predators", "Hunt radius",    \
    "u", 16, 768, 4, 192, false)                                               \
  X(SwarmEnabled, "swarm-enabled", "Swarm", "Enabled", "", 0, 1, 1, 0, true)   \
  X(SwarmWeight, "swarm-weight", "Swarm", "Weight", "", 0, 5, .05, 1, false)   \
  X(FleeSideRadius, "flee-side-radius", "Predator flee", "Side radius", "u",   \
    1, 256, 1, 50, false)                                                      \
  X(FleePrediction, "flee-prediction", "Predator flee", "Prediction time",     \
    "s", 0, 3, .05, .5, false)
enum Parameter {
#define ENUM(id, ...) id,
  BOID_PARAMETERS(ENUM)
#undef ENUM
      ParameterCount
};
struct ParameterSpec {
  const char *name, *group, *label, *unit;
  float minimum, maximum, step, initial;
  bool toggle;
};
inline constexpr ParameterSpec parameterSpecs[] = {
#define SPEC(id, name, group, label, unit, lo, hi, step, initial, toggle)      \
  {name, group, label, unit, lo, hi, step, initial, toggle},
    BOID_PARAMETERS(SPEC)
#undef SPEC
};
static_assert(std::size(parameterSpecs) == ParameterCount);
struct Parameters {
  std::array<float, ParameterCount> values{};
  float spatialScale = 1; // values stay in reference (1024-map) units.
  Parameters() {
    for (int i = 0; i < ParameterCount; ++i)
      values[i] = parameterSpecs[i].initial;
  }
  float operator[](Parameter id) const {
    return values[id] *
           (parameterSpecs[id].unit[0] == 'u' ? spatialScale : 1.f);
  }
  bool set(Parameter id, float value) {
    if (id < 0 || id >= ParameterCount || !std::isfinite(value))
      return false;
    const auto &s = parameterSpecs[id];
    value = std::clamp(value, s.minimum, s.maximum);
    values[id] = std::clamp(
        s.minimum + std::round((value - s.minimum) / s.step) * s.step,
        s.minimum, s.maximum);
    return true;
  }
};
inline std::string parameterSchema() {
  std::string json = "[";
  for (int i = 0; i < ParameterCount; ++i) {
    const auto &s = parameterSpecs[i];
    if (i)
      json += ",";
    json += "{\"id\":" + std::to_string(i) + ",\"name\":\"" + s.name +
            "\",\"group\":\"" + s.group + "\",\"label\":\"" + s.label +
            "\",\"unit\":\"" + s.unit +
            "\",\"min\":" + std::to_string(s.minimum) +
            ",\"max\":" + std::to_string(s.maximum) +
            ",\"step\":" + std::to_string(s.step) +
            ",\"toggle\":" + (s.toggle ? "true" : "false");
    if (i == PredatorMode)
      json += ",\"options\":[\"Orbit\",\"Random\",\"Hunt\"]";
    json += "}";
  }
  return json + "]";
}
} // namespace boids
