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
  predators.reserve(32);
  for (auto &cell : predatorCells)
    cell.reserve(16);
  for (int i = 0; i < count; ++i) {
    float a = random() * 2 * pi;
    world.entity().set<Boid>(
        {{random() * extent, random() * extent},
         {std::cos(a) * parameters[Speed], std::sin(a) * parameters[Speed]},
         a,
         0,
         0,
         true,
         i});
  }
  configureGrid();
}
void Simulation::configureGrid() {
  perceptionRadius = 0;
  if (parameters[CohesionEnabled] && parameters[CohesionWeight] > 0)
    perceptionRadius = std::max(perceptionRadius, parameters[CohesionRadius]);
  if (parameters[AlignmentEnabled] && parameters[AlignmentWeight] > 0)
    perceptionRadius = std::max(perceptionRadius, parameters[AlignmentRadius]);
  if (parameters[RepulsionEnabled] && parameters[RepulsionWeight] > 0)
    perceptionRadius = std::max(perceptionRadius, parameters[RepulsionRadius]);
  gridSide = cells;
  while (gridSide > 2 && extent / gridSide < perceptionRadius)
    gridSide /= 2;
  cellWidth = extent / gridSide;
}
bool Simulation::setParameter(Parameter id, float value) {
  if (!parameters.set(id, value))
    return false;
  if (id == OrbitRadius)
    parameters.values[id] = std::min(parameters[id], parameterMax(id));
  if (id == ShoalThreshold || id == ShoalRearm)
    parameters.values[ShoalRearm] =
        std::min(parameters[ShoalRearm], parameters[ShoalThreshold] - 1);
  if (id == ShoalEnabled && !parameters[id])
    query.each([](Boid &b) {
      b.boost = 0;
      b.cooldown = 0;
      b.armed = true;
    });
  if (id >= WindEnabled && id <= WindLacunarity)
    windFrame = -1;
  if (id == PredatorMode)
    huntDensity.fill(0);
  if (id == PredatorMode && parameters[id] == 0)
    for (auto &p : predators)
      if (!p.crossing)
        p.phase =
            std::atan2(p.position.y - extent / 2, p.position.x - extent / 2);
  if (id == OrbitRadius && parameters[PredatorMode] == 0)
    for (auto &p : predators)
      if (!p.crossing)
        p.position = {extent / 2 + parameters[id] * std::cos(p.phase),
                      extent / 2 + parameters[id] * std::sin(p.phase)};
  configureGrid();
  return true;
}
bool Simulation::setWorldSize(float wanted) {
  if (wanted != 256 && wanted != 512 && wanted != 1024)
    return false;
  if (wanted == extent)
    return true;
  float ratio = wanted / extent;
  extent = wanted;
  query.each([&](Boid &b) { b.position = b.position * ratio; });
  for (auto &p : predators) {
    p.position = p.position * ratio;
    p.destination = p.destination * ratio;
  }
  huntDensity.fill(0);
  parameters.set(OrbitRadius,
                 std::min(parameters[OrbitRadius] * ratio, extent / 2 - 16));
  windFrame = -1;
  configureGrid();
  return true;
}
void Simulation::buildGrid() {
  counts.fill(0);
  query.each([&](Boid &b) {
    snapshot[b.index] = b;
    ++counts[cell(b.position)];
  });
  offsets[0] = 0;
  for (int c = 0; c < gridSide * gridSide; ++c) {
    offsets[c + 1] = offsets[c] + counts[c];
    cursor[c] = offsets[c];
  }
  for (auto &b : snapshot)
    packed[cursor[cell(b.position)]++] = b.index;
}
Neighbours Simulation::neighbours(const Boid &b) const {
  Neighbours n;
  if (perceptionRadius <= 0)
    return n;
  int buckets[9], samples[9];
  const int cx = int(b.position.x / cellWidth),
            cy = int(b.position.y / cellWidth);
  // A 2x2 grid has only four unique cells, not nine wrapped neighbours.
  const int bucketCount = gridSide == 2 ? 4 : 9;
  int total = 0;
  for (int j = 0; j < bucketCount; ++j) {
    buckets[j] = gridSide == 2
                     ? j
                     : ((cx + j % 3 - 1) & (gridSide - 1)) +
                           gridSide * ((cy + j / 3 - 1) & (gridSide - 1));
    total += counts[buckets[j]];
  }
  float scale = total > candidateLimit ? float(candidateLimit) / total : 1.f;
  uint32_t hash =
      uint32_t(b.index) * 2654435761u + uint32_t(ticks / 8) * 2246822519u;
  int assigned = 0;
  for (int j = 0; j < bucketCount; ++j) {
    int count = counts[buckets[j]];
    samples[j] = total <= candidateLimit ? count : int(count * scale);
    assigned += samples[j];
  }
  int remaining = std::min(total, candidateLimit) - assigned;
  for (int k = 0; k < bucketCount && remaining; ++k) {
    int j = (k + b.index % bucketCount) % bucketCount;
    if (samples[j] < counts[buckets[j]]) {
      ++samples[j];
      --remaining;
    }
  }
  const float cohesion2 =
                  parameters[CohesionRadius] * parameters[CohesionRadius],
              alignment2 =
                  parameters[AlignmentRadius] * parameters[AlignmentRadius],
              repulsion2 =
                  parameters[RepulsionRadius] * parameters[RepulsionRadius];
  for (int j = 0; j < bucketCount; ++j) {
    int count = counts[buckets[j]], take = samples[j];
    if (!take)
      continue;
    bool full = take == count;
    int start = full ? 0 : int((uint64_t(hash) * uint32_t(count)) >> 32);
    float stride = float(count) / take;
    for (int k = 0; k < take; ++k) {
      int at = full ? k : start + int(k * stride);
      if (at >= count)
        at -= count;
      int id = packed[offsets[buckets[j]] + at];
      if (id == b.index)
        continue;
      const auto &other = snapshot[id];
      Vec d = delta(b.position, other.position, extent);
      float q = length2(d);
      if (q > perceptionRadius * perceptionRadius)
        continue;
      ++n.count;
      if (parameters[CohesionEnabled] && q <= cohesion2)
        n.offset += d;
      if (parameters[AlignmentEnabled] && q <= alignment2)
        n.velocity += other.velocity;
      if (parameters[RepulsionEnabled] && q <= repulsion2) {
        if (q < 1e-8f) {
          float sign = b.index < id ? 1.f : -1.f;
          n.separation += Vec{sign, sign * .5f};
        } else
          n.separation += d * (-1 / (q + .01f));
      }
    }
  }
  return n;
}
void Simulation::fillWind(std::array<Vec, cellCount> &field, float time) {
  for (int y = 0; y < cells; ++y)
    for (int x = 0; x < cells; ++x)
      field[x + y * cells] =
          Wind{}({x * extent / cells, y * extent / cells}, time, parameters);
}
void Simulation::updateWind() {
  if (!parameters[WindEnabled] || parameters[WindWeight] == 0)
    return;
  double frame = std::floor(elapsed * 15);
  float time = float(frame / 15);
  if (frame != windFrame) {
    if (windFrame >= 0 && frame == windFrame + 1)
      windPrevious = windNext;
    else
      fillWind(windPrevious, time);
    fillWind(windNext, time + 1.f / 15);
    windFrame = frame;
  }
  windAlpha = std::clamp(float(elapsed * 15 - frame), 0.f, 1.f);
}
Vec Simulation::windAt(Vec p) const {
  float x = wrap(p.x, extent) / extent * cells,
        y = wrap(p.y, extent) / extent * cells;
  int ix = int(x), iy = int(y);
  float fx = x - ix, fy = y - iy;
  auto fieldSample = [&](const auto &field) {
    auto at = [&](int dx, int dy) {
      return field[((ix + dx) & (cells - 1)) +
                   cells * ((iy + dy) & (cells - 1))];
    };
    return at(0, 0) * ((1 - fx) * (1 - fy)) + at(1, 0) * (fx * (1 - fy)) +
           at(0, 1) * ((1 - fx) * fy) + at(1, 1) * (fx * fy);
  };
  return fieldSample(windPrevious) * (1 - windAlpha) +
         fieldSample(windNext) * windAlpha;
}
void Simulation::updateHuntDensity() {
  huntDensity.fill(0);
  query.each([&](const Boid &b) {
    const int x = std::min(31, int(b.position.x / extent * 32));
    const int y = std::min(31, int(b.position.y / extent * 32));
    ++huntDensity[x + 32 * y];
  });
}
float Simulation::randomPredatorTurn(const Predator &p) const {
  const float scale = parameters[PredatorNoiseScale];
  return std::clamp(2 * Perlin3D::sample(
                            p.position.x / scale, p.position.y / scale,
                            float(elapsed) * parameters[PredatorNoiseTime],
                            p.noiseSeed),
                    -1.f, 1.f) *
         parameters[PredatorTurnRate] * pi / 180;
}
Vec Simulation::huntTarget(Vec position) const {
  uint32_t highest = 0;
  float nearest =
      parameters[PredatorHuntRadius] * parameters[PredatorHuntRadius];
  Vec target;
  for (int c = 0; c < cellCount; ++c) {
    if (!huntDensity[c] || huntDensity[c] < highest)
      continue;
    const Vec centre{(float(c % 32) + .5f) * extent / 32,
                     (float(c / 32) + .5f) * extent / 32};
    const Vec d = delta(position, centre, extent);
    const float distance = length2(d);
    if (distance >
        parameters[PredatorHuntRadius] * parameters[PredatorHuntRadius])
      continue;
    if (huntDensity[c] > highest || distance < nearest) {
      highest = huntDensity[c];
      nearest = distance;
      target = d;
    }
  }
  return target;
}
void Simulation::advanceEnvironment(float dt, bool includeWind,
                                    bool nativeHuntDensity) {
  elapsed += dt;
  if (includeWind)
    updateWind();
  if (nativeHuntDensity && parameters[PredatorMode] == 2 && orbitCount() > 0)
    updateHuntDensity();
  for (auto &p : predators) {
    if (p.crossing) {
      p.position += Vec{std::cos(p.heading), std::sin(p.heading)} *
                    (parameters[CrossingSpeed] * dt);
    } else if (parameters[PredatorMode] == 0) {
      p.phase =
          std::fmod(p.phase + 2 * pi / parameters[OrbitPeriod] * dt, 2 * pi);
      p.position = {extent / 2 + parameters[OrbitRadius] * std::cos(p.phase),
                    extent / 2 + parameters[OrbitRadius] * std::sin(p.phase)};
      p.heading = std::remainder(p.phase + pi / 2, 2 * pi);
    } else {
      float turn = randomPredatorTurn(p) * dt;
      if (parameters[PredatorMode] == 2) {
        const Vec target = huntTarget(p.position);
        if (length2(target) > 1e-8f) {
          const float limit = parameters[PredatorTurnRate] * pi / 180 * dt;
          turn = std::clamp(
              angleDifference(p.heading, std::atan2(target.y, target.x)),
              -limit, limit);
        }
      }
      p.heading = std::remainder(p.heading + turn, 2 * pi);
      p.position += Vec{std::cos(p.heading), std::sin(p.heading)} *
                    (parameters[PredatorSpeed] * dt);
      p.position = {wrap(p.position.x, extent), wrap(p.position.y, extent)};
    }
  }
  predators.erase(std::remove_if(predators.begin(), predators.end(),
                                 [&](auto &p) {
                                   return p.crossing &&
                                          p.position.x > extent + 16;
                                 }),
                  predators.end());
}
void Simulation::tick(float dt) {
  advanceEnvironment(dt);
  // Cell lists retain all active predators, including launches beyond 32.
  for (auto &cell : predatorCells)
    cell.clear();
  if (parameters[FleeEnabled] && parameters[FleeWeight] > 0) {
    int ring = int(std::ceil(parameters[FleeRadius] / (extent / 8)));
    for (const auto &predator : predators) {
      if (ring >= 4) {
        for (auto &cell : predatorCells)
          cell.push_back(predator);
      } else {
        int cx = int(wrap(predator.position.x, extent) / (extent / 8));
        int cy = int(wrap(predator.position.y, extent) / (extent / 8));
        for (int dy = -ring; dy <= ring; ++dy)
          for (int dx = -ring; dx <= ring; ++dx)
            predatorCells[((cx + dx + 8) & 7) + 8 * ((cy + dy + 8) & 7)]
                .push_back(predator);
      }
    }
  }
  if (perceptionRadius > 0)
    buildGrid();
  query.each([&](Boid &b) {
    Neighbours n = neighbours(perceptionRadius > 0 ? snapshot[b.index] : b);
    Vec desired = Cohesion{}(n)*parameters[CohesionWeight] +
                  Alignment{}(n)*parameters[AlignmentWeight] +
                  Repulsion{}(n)*parameters[RepulsionWeight];
    if (parameters[FleeEnabled] && parameters[FleeWeight] > 0)
      desired += Flee{}(b.position,
                        predatorCells[int(b.position.x / (extent / 8)) +
                                      8 * int(b.position.y / (extent / 8))],
                        parameters[FleeRadius], extent) *
                 parameters[FleeWeight];
    if (parameters[WindEnabled] && parameters[WindWeight] > 0)
      desired += windAt(b.position);
    if (length2(desired) < 1e-10f)
      desired = unit(b.velocity);
    float error = angleDifference(b.heading, std::atan2(desired.y, desired.x));
    Shoal{}(b, error, dt, parameters[ShoalEnabled] > 0, parameters);
    float turn = parameters[TurnRate] * pi / 180 *
                 (b.boost > 0 ? parameters[ShoalTurn] : 1) * dt;
    b.heading =
        std::remainder(b.heading + std::clamp(error, -turn, turn), 2 * pi);
    float speed =
        parameters[Speed] * (b.boost > 0 ? parameters[ShoalSpeed] : 1);
    b.velocity = {std::cos(b.heading) * speed, std::sin(b.heading) * speed};
    b.position += b.velocity * dt;
    b.position = {wrap(b.position.x, extent), wrap(b.position.y, extent)};
  });
  ++ticks;
}
void Simulation::setShoal(bool enabled) {
  setParameter(ShoalEnabled, enabled ? 1 : 0);
}
int Simulation::orbitCount() const {
  return int(std::count_if(predators.begin(), predators.end(),
                           [](auto &p) { return !p.crossing; }));
}
bool Simulation::crossingActive() const {
  return std::any_of(predators.begin(), predators.end(),
                     [](auto &p) { return p.crossing; });
}
int Simulation::crossingCount() const {
  return int(std::count_if(predators.begin(), predators.end(),
                           [](const auto &p) { return p.crossing; }));
}
bool Simulation::sendPredator() {
  const Vec start{-16, extent * (.125f + random() * .75f)};
  const Vec destination{extent, random() * extent};
  const float heading =
      std::atan2(destination.y - start.y, destination.x - start.x);
  predators.push_back({start, heading, 0, true, destination});
  return true;
}
void Simulation::addPredator() {
  if (orbitCount() >= 16)
    return;
  if (orbitCount() == 0)
    huntDensity.fill(0);
  std::vector<float> phases;
  for (auto &p : predators)
    if (!p.crossing)
      phases.push_back(wrap(std::atan2(p.position.y - extent / 2,
                                       p.position.x - extent / 2) /
                            (2 * pi) * size) /
                       size * 2 * pi);
  std::sort(phases.begin(), phases.end());
  float phase = 0, gap = 0;
  if (!phases.empty())
    for (size_t i = 0; i < phases.size(); ++i) {
      float end = i + 1 < phases.size() ? phases[i + 1] : phases[0] + 2 * pi,
            g = end - phases[i];
      if (g > gap) {
        gap = g;
        phase = phases[i] + g / 2;
      }
    }
  predators.push_back({{extent / 2 + parameters[OrbitRadius] * std::cos(phase),
                        extent / 2 + parameters[OrbitRadius] * std::sin(phase)},
                       std::remainder(phase + pi / 2, 2 * pi),
                       phase,
                       false,
                       {},
                       uint32_t(random() * 16777216.f) ^ 0x9e3779b9u});
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
      b.position = {wrap(p.x, extent), wrap(p.y, extent)};
      b.heading = heading;
      b.velocity = {std::cos(heading) * parameters[Speed],
                    std::sin(heading) * parameters[Speed]};
    }
  });
}
} // namespace boids
