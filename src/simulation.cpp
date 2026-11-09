#include "simulation.hpp"
#include "simd.hpp"
#ifdef BOIDS_PROFILE
#include <chrono>
static double profileNow() {
  return std::chrono::duration<double, std::milli>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
#endif
namespace boids {
float Simulation::random() {
  randomState ^= randomState << 13;
  randomState ^= randomState >> 17;
  randomState ^= randomState << 5;
  return (randomState >> 8) * (1.f / 16777216);
}
void Simulation::assignPredatorIdentity(Predator &p) {
  p.identity = ++predatorSerial;
  uint32_t h = p.identity ^ 0x91e10da5u;
  h ^= h >> 16;
  h *= 0x7feb352du;
  h ^= h >> 15;
  h *= 0x846ca68bu;
  h ^= h >> 16;
  p.speedMultiplier = .8f + .4f * float(h >> 8) / 16777216.f;
}
Simulation::Simulation(int count)
    : query(world.query<Boid>()), snapshot(count), packed(count),
      plans(cellCount), previousPositions(count) {
  predators.reserve(32);
  predatorThreats.reserve(32);
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
  resetInterpolation();
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
    packed[cursor[cell(b.position)]++] = {b.position, b.velocity,
                                          float(b.index)};
  const int bucketCount = gridSide == 2 ? 4 : 9;
  for (int c = 0; c < gridSide * gridSide; ++c) {
    if (!counts[c])
      continue;
    int buckets[9], base[9], total = 0, assigned = 0;
    for (int j = 0; j < bucketCount; ++j) {
      buckets[j] =
          gridSide == 2
              ? j
              : ((c % gridSide + j % 3 - 1) & (gridSide - 1)) +
                    gridSide * ((c / gridSide + j / 3 - 1) & (gridSide - 1));
      total += counts[buckets[j]];
    }
    const float scale =
        total > candidateLimit ? float(candidateLimit) / total : 1.f;
    for (int j = 0; j < bucketCount; ++j) {
      base[j] = total <= candidateLimit ? counts[buckets[j]]
                                        : int(counts[buckets[j]] * scale);
      assigned += base[j];
    }
    for (int first = 0; first < bucketCount; ++first) {
      auto &plan = plans[c][first];
      for (int j = 0; j < bucketCount; ++j)
        plan[j] = {offsets[buckets[j]], counts[buckets[j]], base[j], 0};
      int remaining = std::min(total, candidateLimit) - assigned;
      for (int k = 0; k < bucketCount && remaining; ++k) {
        int j = (k + first) % bucketCount;
        if (plan[j].take < plan[j].count) {
          ++plan[j].take;
          --remaining;
        }
      }
      for (int j = 0; j < bucketCount; ++j)
        if (plan[j].take)
          plan[j].stride = float(plan[j].count) / plan[j].take;
    }
  }
}
Neighbours Simulation::neighbours(const Boid &b) const {
  Neighbours n;
  if (perceptionRadius <= 0)
    return n;
  const int bucketCount = gridSide == 2 ? 4 : 9;
  const auto &plan = plans[cell(b.position)][b.index % bucketCount];
  const uint32_t hash =
      uint32_t(b.index) * 2654435761u + uint32_t(ticks / 8) * 2246822519u;
  const float cohesion2 =
                  parameters[CohesionRadius] * parameters[CohesionRadius],
              alignment2 =
                  parameters[AlignmentRadius] * parameters[AlignmentRadius],
              repulsion2 =
                  parameters[RepulsionRadius] * parameters[RepulsionRadius];
#ifdef BOIDS_SIMD
  using namespace simd;
  const F zero = splat(0), half = splat(extent * .5f),
          minusHalf = splat(-extent * .5f), width = splat(extent);
  const F bx = splat(b.position.x), by = splat(b.position.y);
  const F cr = splat(parameters[CohesionEnabled] ? cohesion2 : -1),
          ar = splat(parameters[AlignmentEnabled] ? alignment2 : -1),
          rr = splat(parameters[RepulsionEnabled] ? repulsion2 : -1);
  F ox = zero, oy = zero, vx = zero, vy = zero, sx = zero, sy = zero;
  const NeighbourRecord *batch[4];
  int used = 0;
  const NeighbourRecord dummy{b.position, {}, float(b.index)};
  auto accumulate = [&]() {
    F x = load(&batch[0]->position.x), y = load(&batch[1]->position.x),
      velx = load(&batch[2]->position.x), vely = load(&batch[3]->position.x);
    transpose(x, y, velx, vely);
    F dx = sub(x, bx), dy = sub(y, by);
    dx = choose(le(half, dx), sub(dx, width), dx);
    dx = choose(lt(dx, minusHalf), add(dx, width), dx);
    dy = choose(le(half, dy), sub(dy, width), dy);
    dy = choose(lt(dy, minusHalf), add(dy, width), dy);
    const F q = add(mul(dx, dx), mul(dy, dy));
    const F ids = set(batch[0]->index, batch[1]->index, batch[2]->index,
                      batch[3]->index),
            self = splat(float(b.index));
    const F valid = ne(ids, self);
    const F cm = mask(valid, le(q, cr)), am = mask(valid, le(q, ar)),
            rm = mask(valid, le(q, rr));
    ox = add(ox, mask(cm, dx));
    oy = add(oy, mask(cm, dy));
    vx = add(vx, mask(am, velx));
    vy = add(vy, mask(am, vely));
    const F factor = div(splat(-1), add(q, splat(.01f))),
            tiny = lt(q, splat(1e-8f));
    const F sign = choose(lt(self, ids), splat(1), splat(-1));
    sx = add(sx, mask(rm, choose(tiny, sign, mul(dx, factor))));
    sy =
        add(sy, mask(rm, choose(tiny, mul(sign, splat(.5f)), mul(dy, factor))));
    used = 0;
  };
  for (int j = 0; j < bucketCount; ++j) {
    const auto &bucket = plan[j];
    if (!bucket.take)
      continue;
    const bool full = bucket.take == bucket.count;
    const int start =
        full ? 0 : int((uint64_t(hash) * uint32_t(bucket.count)) >> 32);
    for (int k = 0; k < bucket.take; ++k) {
      int at = full ? k : start + int(k * bucket.stride);
      if (at >= bucket.count)
        at -= bucket.count;
      batch[used++] = &packed[bucket.offset + at];
      if (used == 4)
        accumulate();
    }
  }
  if (used) {
    while (used < 4)
      batch[used++] = &dummy;
    accumulate();
  }
  n.offset = {sum(ox), sum(oy)};
  n.velocity = {sum(vx), sum(vy)};
  n.separation = {sum(sx), sum(sy)};
  n.count = 1;
#else
  for (int j = 0; j < bucketCount; ++j) {
    int count = plan[j].count, take = plan[j].take;
    if (!take)
      continue;
    bool full = take == count;
    int start = full ? 0 : int((uint64_t(hash) * uint32_t(count)) >> 32);
    float stride = plan[j].stride;
    for (int k = 0; k < take; ++k) {
      int at = full ? k : start + int(k * stride);
      if (at >= count)
        at -= count;
      const auto &other = packed[plan[j].offset + at];
      int id = int(other.index);
      if (id == b.index)
        continue;
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
#endif
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
  double frame = parameters[WindTime] == 0 ? 0 : std::floor(elapsed * 15);
  float time = float(frame / 15);
  if (frame != windFrame) {
    if (windFrame >= 0 && frame == windFrame + 1)
      windPrevious = windNext;
    else
      fillWind(windPrevious, time);
    fillWind(windNext, time + 1.f / 15);
    windFrame = frame;
  }
  windAlpha = parameters[WindTime] == 0
                  ? 0
                  : std::clamp(float(elapsed * 15 - frame), 0.f, 1.f);
  for (int i = 0; i < cellCount; ++i)
    windBlended[i] =
        windPrevious[i] * (1 - windAlpha) + windNext[i] * windAlpha;
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
  return fieldSample(windBlended);
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
                    (parameters[CrossingSpeed] * p.speedMultiplier * dt);
    } else if (parameters[PredatorMode] == 0) {
      p.phase = std::fmod(p.phase + 2 * pi / parameters[OrbitPeriod] *
                                        p.speedMultiplier * dt,
                          2 * pi);
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
                    (parameters[PredatorSpeed] * p.speedMultiplier * dt);
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
#ifdef BOIDS_PROFILE
  double stamp = profileNow();
#endif
  advanceEnvironment(dt);
#ifdef BOIDS_PROFILE
  profileMs[0] += profileNow() - stamp;
  stamp = profileNow();
#endif
  // Cell lists retain all active predators, including launches beyond 32.
  for (auto &cell : predatorCells)
    cell.clear();
  const float threatRadius =
      std::max(parameters[FleeRadius], parameters[FleeSideRadius]);
  const bool allPredators = std::ceil(threatRadius / (extent / 8)) >= 4;
  const Flee flee{parameters[FleeRadius], parameters[FleeSideRadius]};
  predatorThreats.clear();
  if (parameters[FleeEnabled] && parameters[FleeWeight] > 0) {
    for (const auto &predator : predators)
      predatorThreats.push_back(predatorThreat(predator));
    if (!allPredators) {
      const int ring = int(std::ceil(threatRadius / (extent / 8)));
      for (const auto &threat : predatorThreats) {
        const int cx = int(threat.centre.x / (extent / 8)),
                  cy = int(threat.centre.y / (extent / 8));
        for (int dy = -ring; dy <= ring; ++dy)
          for (int dx = -ring; dx <= ring; ++dx)
            predatorCells[((cx + dx + 8) & 7) + 8 * ((cy + dy + 8) & 7)]
                .push_back(&threat);
      }
    }
  }
#ifdef BOIDS_PROFILE
  profileMs[1] += profileNow() - stamp;
  stamp = profileNow();
#endif
  const bool swarm = parameters[SwarmEnabled] && parameters[SwarmWeight] > 0;
  if (perceptionRadius > 0)
    buildGrid();
  else if (swarm)
    query.each([&](const Boid &b) { snapshot[b.index] = b; });
#ifdef BOIDS_PROFILE
  profileMs[2] += profileNow() - stamp;
  stamp = profileNow();
#endif
  const float baseTurn = parameters[TurnRate] * pi / 180 * dt,
              boostTurn = baseTurn * parameters[ShoalTurn];
  const float baseCos = std::cos(baseTurn), baseSin = std::sin(baseTurn),
              boostCos = std::cos(boostTurn), boostSin = std::sin(boostTurn);
  const float rearmCos = std::cos(parameters[ShoalRearm] * pi / 180),
              thresholdCos = std::cos(parameters[ShoalThreshold] * pi / 180);
  query.each([&](Boid &b) {
    previousPositions[b.index] = b.position;
    Neighbours n = neighbours(perceptionRadius > 0 ? snapshot[b.index] : b);
    Vec desired = Cohesion{}(n)*parameters[CohesionWeight] +
                  Alignment{}(n)*parameters[AlignmentWeight] +
                  Repulsion{}(n)*parameters[RepulsionWeight];
    if (swarm)
      desired += Swarm{}(snapshot[b.index], snapshot, extent) *
                 parameters[SwarmWeight];
    if (parameters[FleeEnabled] && parameters[FleeWeight] > 0)
      desired +=
          (allPredators
               ? flee(b.position, predatorThreats, extent)
               : flee(b.position,
                      predatorCells[int(b.position.x / (extent / 8)) +
                                    8 * int(b.position.y / (extent / 8))],
                      extent)) *
          parameters[FleeWeight];
    if (parameters[WindEnabled] && parameters[WindWeight] > 0)
      desired += windAt(b.position);
    if (length2(desired) < 1e-10f)
      desired = unit(b.velocity);
    const Vec old = unit(b.velocity), target = unit(desired);
    const float cosine =
        std::clamp(old.x * target.x + old.y * target.y, -1.f, 1.f);
    // Compare cosines instead of evaluating two angles for every boid.
    if (!parameters[ShoalEnabled]) {
      b.boost = b.cooldown = 0;
      b.armed = true;
    } else {
      b.boost =
          std::max(0.f, std::min(b.boost, parameters[ShoalDuration]) - dt);
      b.cooldown = std::max(0.f, b.cooldown - dt);
      if (cosine >= rearmCos && b.cooldown == 0)
        b.armed = true;
      if (b.armed && b.cooldown == 0 && cosine < thresholdCos) {
        b.boost = parameters[ShoalDuration];
        b.cooldown = parameters[ShoalDuration] + parameters[ShoalCooldown];
        b.armed = false;
      }
    }
    const bool boosted = b.boost > 0;
    const float turn = boosted ? boostTurn : baseTurn,
                c = boosted ? boostCos : baseCos,
                sine = boosted ? boostSin : baseSin;
    Vec direction;
    if (turn >= pi || cosine >= c) {
      direction = target;
    } else {
      const float sign = old.x * target.y - old.y * target.x >= 0 ? 1.f : -1.f;
      const float sn = sine * sign;
      direction = {old.x * c - old.y * sn, old.x * sn + old.y * c};
    }
    const float speed =
        parameters[Speed] * (boosted ? parameters[ShoalSpeed] : 1);
    b.velocity = direction * speed;
    b.position += b.velocity * dt;
    b.position = {wrap(b.position.x, extent), wrap(b.position.y, extent)};
  });
  ++ticks;
#ifdef BOIDS_PROFILE
  profileMs[3] += profileNow() - stamp;
  ++profileTicks;
#endif
}
void Simulation::resetInterpolation() {
  query.each([&](const Boid &b) { previousPositions[b.index] = b.position; });
}
void Simulation::writeRenderInstances(std::vector<float> &output, float alpha) {
  output.resize((snapshot.size() + predators.size()) * 6);
  query.each([&](const Boid &b) {
    const Vec old = previousPositions[b.index];
    const Vec p = old + delta(old, b.position, extent) * alpha,
              direction = unit(b.velocity);
    float *v = output.data() + b.index * 6;
    v[0] = wrap(p.x, extent);
    v[1] = wrap(p.y, extent);
    v[2] = direction.x;
    v[3] = direction.y;
    v[4] = 0;
    v[5] = b.boost > 0 ? 1.f : 0.f;
  });
  for (size_t i = 0; i < predators.size(); ++i) {
    const auto &p = predators[i];
    float *v = output.data() + (snapshot.size() + i) * 6;
    v[0] = p.position.x;
    v[1] = p.position.y;
    v[2] = std::cos(p.heading);
    v[3] = std::sin(p.heading);
    v[4] = 1;
    v[5] = 0;
  }
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
  assignPredatorIdentity(predators.back());
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
  assignPredatorIdentity(predators.back());
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
  query.each([&](const Boid &b) {
    snapshot[b.index] = b;
    // Heading is a diagnostic view of velocity, materialised only on demand.
    snapshot[b.index].heading = std::atan2(b.velocity.y, b.velocity.x);
  });
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
