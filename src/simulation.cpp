#include "simulation.hpp"
namespace boids {
float Simulation::random() {
  randomState ^= randomState << 13;
  randomState ^= randomState >> 17;
  randomState ^= randomState << 5;
  return (randomState >> 8) * (1.f / 16777216);
}
Simulation::Simulation(int count)
    : query(world.query<Boid>()), snapshot(count), packed(count) {
  predators.reserve(17);
  for (int i = 0; i < count; ++i) {
    float a = random() * 2 * pi;
    world.entity().set<Boid>({{random() * size, random() * size},
                              {std::cos(a) * 70, std::sin(a) * 70},
                              a,
                              0,
                              0,
                              true,
                              i});
  }
}
void Simulation::buildGrid() {
  counts.fill(0);
  query.each([&](Boid &b) {
    snapshot[b.index] = b;
    ++counts[cell(b.position)];
  });
  offsets[0] = 0;
  for (int c = 0; c < cellCount; ++c) {
    offsets[c + 1] = offsets[c] + counts[c];
    cursor[c] = offsets[c];
  }
  for (auto &b : snapshot)
    packed[cursor[cell(b.position)]++] = b.index;
}
Neighbours Simulation::neighbours(const Boid &b) const {
  Neighbours n;
  int buckets[9], samples[9];
  const int cx = int(b.position.x / 32), cy = int(b.position.y / 32);
  int total = 0;
  for (int j = 0; j < 9; ++j) {
    buckets[j] = ((cx + j % 3 - 1 + cells) % cells) +
                 cells * ((cy + j / 3 - 1 + cells) % cells);
    total += counts[buckets[j]];
  }
  int assigned = 0;
  for (int j = 0; j < 9; ++j) {
    const int count = counts[buckets[j]];
    samples[j] =
        total <= candidateLimit ? count : count * candidateLimit / total;
    assigned += samples[j];
  }
  // Allocate rounding leftovers without consistently favouring one direction.
  int remaining = std::min(total, candidateLimit) - assigned;
  for (int k = 0; k < 9 && remaining; ++k) {
    const int j = (k + b.index % 9) % 9;
    if (samples[j] < counts[buckets[j]]) {
      ++samples[j];
      --remaining;
    }
  }
  for (int j = 0; j < 9; ++j) {
    const int count = counts[buckets[j]], take = samples[j];
    if (!take)
      continue;
    const bool full = take == count;
    const int start = full ? 0
                           : int((uint32_t(b.index) * 2654435761u +
                                  uint32_t(ticks / 8) * 2246822519u) %
                                 count);
    const float stride = float(count) / take;
    for (int k = 0; k < take; ++k) {
      int at = full ? k : start + int(k * stride);
      if (at >= count)
        at -= count;
      const int id = packed[offsets[buckets[j]] + at];
      if (id == b.index)
        continue;
      const auto &other = snapshot[id];
      const Vec d = delta(b.position, other.position);
      const float q = length2(d);
      if (q > 32 * 32)
        continue;
      n.offset += d;
      n.velocity += other.velocity;
      ++n.count;
      if (q < 10 * 10) {
        if (q < 1e-8f) {
          const float sign = b.index < id ? 1.f : -1.f;
          n.separation += Vec{sign, sign * .5f};
        } else
          n.separation += d * (-1 / (q + .01f));
      }
    }
  }
  return n;
}
void Simulation::tick(float dt) {
  for (auto &p : predators) {
    if (p.crossing) {
      p.position.x += 180 * dt;
    } else {
      p.phase = std::fmod(p.phase + 2 * pi / 20 * dt, 2 * pi);
      p.position = {512 + 400 * std::cos(p.phase),
                    512 + 400 * std::sin(p.phase)};
      p.heading = p.phase + pi / 2;
    }
  }
  predators.erase(
      std::remove_if(predators.begin(), predators.end(),
                     [](auto &p) { return p.crossing && p.position.x > 1040; }),
      predators.end());
  // 128-unit cells exceed the flee radius. Adjacent wrapped cells therefore
  // contain every relevant predator, avoiding a full predator scan per boid.
  predatorMasks.fill(0);
  for (unsigned i = 0; i < predators.size(); ++i) {
    const int cx = int(wrap(predators[i].position.x) / 128);
    const int cy = int(wrap(predators[i].position.y) / 128);
    for (int dy = -1; dy <= 1; ++dy)
      for (int dx = -1; dx <= 1; ++dx)
        predatorMasks[(cx + dx + 8) % 8 + 8 * ((cy + dy + 8) % 8)] |= 1u << i;
  }
  buildGrid();
  query.each([&](Boid &b) {
    Neighbours n = neighbours(snapshot[b.index]);
    Vec desired = Cohesion{}(n) * .65f + Alignment{}(n) * 1.f +
                  Repulsion{}(n) * 1.6f +
                  Flee{}(b.position, predators,
                         predatorMasks[int(b.position.x / 128) +
                                       8 * int(b.position.y / 128)]) *
                      5.f;
    if (length2(desired) < 1e-10f)
      desired = unit(b.velocity);
    float error = angleDifference(b.heading, std::atan2(desired.y, desired.x));
    Shoal{}(b, error, dt, shoal);
    float turn = pi * (b.boost > 0 ? 2 : 1) * dt;
    b.heading =
        std::remainder(b.heading + std::clamp(error, -turn, turn), 2 * pi);
    float speed = 70 * (b.boost > 0 ? 1.5f : 1);
    b.velocity = {std::cos(b.heading) * speed, std::sin(b.heading) * speed};
    b.position += b.velocity * dt;
    b.position = {wrap(b.position.x), wrap(b.position.y)};
  });
  ++ticks;
}
void Simulation::setShoal(bool value) {
  shoal = value;
  if (!value)
    query.each([](Boid &b) {
      b.boost = 0;
      b.cooldown = 0;
      b.armed = true;
    });
}
int Simulation::orbitCount() const {
  return int(std::count_if(predators.begin(), predators.end(),
                           [](auto &p) { return !p.crossing; }));
}
bool Simulation::crossingActive() const {
  return std::any_of(predators.begin(), predators.end(),
                     [](auto &p) { return p.crossing; });
}
bool Simulation::sendPredator() {
  if (crossingActive())
    return false;
  predators.push_back({{-16, 128 + random() * 768}, 0, 0, true});
  return true;
}
void Simulation::addPredator() {
  if (orbitCount() >= 16)
    return;
  std::vector<float> phases;
  for (auto &p : predators)
    if (!p.crossing)
      phases.push_back(wrap(p.phase / (2 * pi) * size) / size * 2 * pi);
  std::sort(phases.begin(), phases.end());
  float phase = 0, gap = 0;
  if (!phases.empty())
    for (size_t i = 0; i < phases.size(); ++i) {
      float end = i + 1 < phases.size() ? phases[i + 1] : phases[0] + 2 * pi;
      float g = end - phases[i];
      if (g > gap) {
        gap = g;
        phase = phases[i] + g / 2;
      }
    }
  predators.push_back(
      {{512 + 400 * std::cos(phase), 512 + 400 * std::sin(phase)},
       phase + pi / 2,
       phase,
       false});
}
void Simulation::removePredator() {
  for (auto it = predators.end(); it != predators.begin();) {
    --it;
    if (!it->crossing) {
      predators.erase(it);
      return;
    }
  }
}
const std::vector<Boid> &Simulation::state() {
  query.each([&](Boid &b) { snapshot[b.index] = b; });
  return snapshot;
}
void Simulation::setBoid(int i, Vec p, float heading) {
  query.each([&](Boid &b) {
    if (b.index == i) {
      b.position = {wrap(p.x), wrap(p.y)};
      b.heading = heading;
      b.velocity = {std::cos(heading) * 70, std::sin(heading) * 70};
    }
  });
}
} // namespace boids
