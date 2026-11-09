#pragma once
#include "flecs.h"
#include "noise.hpp"
#include "parameters.hpp"
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <vector>
namespace boids {
constexpr float size = 1024, pi = 3.14159265359f;
constexpr int population = 10000, cells = 32, cellCount = cells * cells,
              candidateBudget = 48;
struct Vec {
  float x = 0, y = 0;
  Vec operator+(Vec b) const { return {x + b.x, y + b.y}; }
  Vec operator-(Vec b) const { return {x - b.x, y - b.y}; }
  Vec operator*(float s) const { return {x * s, y * s}; }
  Vec &operator+=(Vec b) {
    x += b.x;
    y += b.y;
    return *this;
  }
};
inline float length2(Vec v) { return v.x * v.x + v.y * v.y; }
inline float wrap(float x, float extent = size) {
  const float r = x - extent * std::floor(x / extent);
  return r >= extent ? 0 : r;
}
inline Vec delta(Vec a, Vec b, float extent = size) {
  Vec d = b - a;
  if (d.x >= extent / 2)
    d.x -= extent;
  if (d.x < -extent / 2)
    d.x += extent;
  if (d.y >= extent / 2)
    d.y -= extent;
  if (d.y < -extent / 2)
    d.y += extent;
  return d;
}
inline Vec unit(Vec v) {
  float q = length2(v);
  return q > 1e-12f ? v * (1 / std::sqrt(q)) : Vec{};
}
inline float angleDifference(float a, float b) {
  float d = b - a;
  if (d > pi)
    d -= 2 * pi;
  if (d < -pi)
    d += 2 * pi;
  return d;
}
struct Boid {
  Vec position, velocity;
  float heading = 0, boost = 0, cooldown = 0;
  bool armed = true;
  int index = 0;
};
struct Predator {
  Vec position;
  float heading = 0, phase = 0;
  bool crossing = false;
  Vec destination;
  uint32_t noiseSeed = 0;
};
struct Neighbours {
  Vec offset, velocity, separation;
  int count = 0;
};
struct Cohesion {
  Vec operator()(const Neighbours &n) const {
    return n.count ? unit(n.offset) : Vec{};
  }
};
struct Alignment {
  Vec operator()(const Neighbours &n) const {
    return n.count ? unit(n.velocity) : Vec{};
  }
};
struct Repulsion {
  Vec operator()(const Neighbours &n) const { return unit(n.separation); }
};
struct Swarm {
  Vec operator()(const Boid &b, const std::vector<Boid> &flock,
                 float extent) const {
    if (b.index <= 0)
      return {};
    const size_t parent = size_t((b.index - 1) >> 1);
    return parent < flock.size()
               ? unit(delta(b.position, flock[parent].position, extent))
               : Vec{};
  }
};
struct Flee {
  Vec operator()(Vec p, const std::vector<Predator> &predators,
                 float radius = 100, float extent = size) const {
    Vec force;
    for (const auto &q : predators) {
      Vec d = delta(q.position, p, extent);
      float l = length2(d);
      if (l < radius * radius) {
        if (l < 1e-8f)
          d = {std::cos(q.heading + pi / 2), std::sin(q.heading + pi / 2)};
        force += unit(d) * (1 - std::sqrt(l) / radius);
      }
    }
    return force;
  }
};
struct Shoal {
  void operator()(Boid &b, float error, float dt, bool enabled,
                  const Parameters &p = {}) const {
    if (!enabled) {
      b.boost = 0;
      b.cooldown = 0;
      b.armed = true;
      return;
    }
    b.boost = std::max(0.f, std::min(b.boost, p[ShoalDuration]) - dt);
    b.cooldown = std::max(0.f, b.cooldown - dt);
    if (std::abs(error) <= p[ShoalRearm] * pi / 180 && b.cooldown == 0)
      b.armed = true;
    if (b.armed && b.cooldown == 0 &&
        std::abs(error) > p[ShoalThreshold] * pi / 180) {
      b.boost = p[ShoalDuration];
      b.cooldown = p[ShoalDuration] + p[ShoalCooldown];
      b.armed = false;
    }
  }
};
struct Wind {
  Vec operator()(Vec position, float time, const Parameters &p) const {
    Vec result;
    float amplitude = 1, total = 0, frequency = 1 / p[WindScale],
          z = time * p[WindTime];
    for (int octave = 0; octave < int(p[WindOctaves]); ++octave) {
      result.x +=
          amplitude * Perlin3D::sample(position.x * frequency,
                                       position.y * frequency, z, 0x1234abcdu);
      result.y +=
          amplitude * Perlin3D::sample(position.x * frequency,
                                       position.y * frequency, z, 0xa74f53c1u);
      total += amplitude;
      amplitude *= p[WindPersistence];
      frequency *= p[WindLacunarity];
      z *= p[WindLacunarity];
    }
    return {result.x / total * p[WindX] * p[WindWeight],
            result.y / total * p[WindY] * p[WindWeight]};
  }
};
struct NeighbourBudgetController {
  static constexpr int levels[] = {48, 32, 24, 16, 12, 8};
  int level = 0, ticks = 0;
  float costMs = 0;
  int observe(float elapsedMs, int steps) {
    if (steps <= 0)
      return levels[level];
    ticks += steps;
    costMs += elapsedMs;
    if (ticks >= 60) {
      float average = costMs / ticks;
      if (average > 8 && level < 5)
        ++level;
      else if (average < 3 && level > 0)
        --level;
      ticks = 0;
      costMs = 0;
    }
    return levels[level];
  }
};
class Simulation {
  flecs::world world;
  flecs::query<Boid> query;
  std::vector<Boid> snapshot;
  std::vector<int> packed;
  std::array<int, cellCount + 1> offsets{};
  std::array<int, cellCount> counts{}, cursor{};
  std::array<std::vector<Predator>, 64> predatorCells;
  std::array<Vec, cellCount> windPrevious{}, windNext{};
  Parameters parameters;
  std::array<uint32_t, cellCount> huntDensity{};
  uint32_t randomState = 0x12345678;
  uint64_t ticks = 0;
  int candidateLimit = candidateBudget;
  float extent = size, cellWidth = 32, perceptionRadius = 32;
  int gridSide = 32;
  double elapsed = 0, windFrame = -1;
  float windAlpha = 0;
  float random();
  int cell(Vec p) const {
    return int(p.x / cellWidth) + gridSide * int(p.y / cellWidth);
  }
  void configureGrid();
  void buildGrid();
  Neighbours neighbours(const Boid &b) const;
  void updateWind();
  void updateHuntDensity();
  float randomPredatorTurn(const Predator &p) const;
  Vec huntTarget(Vec position) const;
  void fillWind(std::array<Vec, cellCount> &field, float time);

public:
  std::vector<Predator> predators;
  explicit Simulation(int count = population);
  void tick(float dt);
  void advanceEnvironment(float dt, bool includeWind = true,
                          bool nativeHuntDensity = true);
  void setHuntDensity(const std::array<uint32_t, cellCount> &density) {
    huntDensity = density;
  }
  uint32_t huntDensityTotal() const {
    uint32_t total = 0;
    for (auto count : huntDensity)
      total += count;
    return total;
  }
  void clearHuntDensity() { huntDensity.fill(0); }
  void setNeighbourBudget(int v) {
    candidateLimit = std::clamp(v, 8, candidateBudget);
  }
  int neighbourBudget() const { return candidateLimit; }
  float parameter(Parameter id) const { return parameters[id]; }
  bool setParameter(Parameter id, float value);
  float parameterMax(Parameter id) const {
    return id == OrbitRadius ? extent / 2 - 16 : parameterSpecs[id].maximum;
  }
  float worldSize() const { return extent; }
  bool setWorldSize(float wanted);
  void setSmallMap(bool small) { setWorldSize(small ? 512.f : 1024.f); }
  Vec windAt(Vec position) const;
  void setShoal(bool enabled);
  void addPredator();
  void removePredator();
  bool sendPredator();
  int orbitCount() const;
  bool crossingActive() const;
  int crossingCount() const;
  const std::vector<Boid> &state();
  void setBoid(int index, Vec position, float heading);
};
} // namespace boids
