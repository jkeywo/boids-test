#pragma once
#include "flecs.h"
#include <algorithm>
#include <array>
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
inline float wrap(float x) {
  const float result = x - size * std::floor(x / size);
  return result >= size ? 0.f : result;
}
inline Vec delta(Vec a, Vec b) {
  Vec d = b - a;
  // Inputs are in the world, or at most one predator half-length outside it.
  if (d.x >= size / 2)
    d.x -= size;
  if (d.x < -size / 2)
    d.x += size;
  if (d.y >= size / 2)
    d.y -= size;
  if (d.y < -size / 2)
    d.y += size;
  return d;
}
inline Vec unit(Vec v) {
  float q = length2(v);
  return q > 1e-12f ? v * (1 / std::sqrt(q)) : Vec{};
}
inline float angleDifference(float a, float b) {
  return std::remainder(b - a, 2 * pi);
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
struct Flee {
  Vec operator()(Vec p, const std::vector<Predator> &predators) const {
    Vec force;
    for (auto &q : predators) {
      Vec d = delta(q.position, p);
      float l = length2(d);
      if (l < 10000) {
        if (l < 1e-8f)
          d = {std::cos(q.heading + pi / 2), std::sin(q.heading + pi / 2)};
        force += unit(d) * (1 - std::sqrt(l) / 100);
      }
    }
    return force;
  }
};
struct Shoal {
  void operator()(Boid &b, float error, float dt, bool enabled) const {
    if (!enabled) {
      b.boost = 0;
      b.cooldown = 0;
      b.armed = true;
      return;
    }
    b.boost = std::max(0.f, b.boost - dt);
    b.cooldown = std::max(0.f, b.cooldown - dt);
    if (std::abs(error) < 20 * pi / 180 && b.cooldown == 0)
      b.armed = true;
    if (b.armed && b.cooldown == 0 && std::abs(error) > pi / 4) {
      b.boost = .6f;
      b.cooldown = 1.4f;
      b.armed = false;
    }
  }
};
class Simulation {
  flecs::world world;
  flecs::query<Boid> query;
  std::vector<Boid> snapshot;
  std::vector<int> packed;
  std::array<int, cellCount + 1> offsets{};
  std::array<int, cellCount> counts{}, cursor{};
  uint32_t randomState = 0x12345678;
  uint64_t ticks = 0;
  float random();
  static int cell(Vec p) { return int(p.x / 32) + cells * int(p.y / 32); }
  void buildGrid();
  Neighbours neighbours(const Boid &b) const;

public:
  bool shoal = false;
  std::vector<Predator> predators;
  explicit Simulation(int count = population);
  void tick(float dt);
  void setShoal(bool value);
  void addPredator();
  void removePredator();
  bool sendPredator();
  int orbitCount() const;
  bool crossingActive() const;
  const std::vector<Boid> &state();
  void setBoid(int index, Vec position, float heading);
};
} // namespace boids
