#include "simulation.hpp"
#include <cstdio>
#include <cstdlib>
#include <limits>
using namespace boids;
static int checks = 0;
void check(bool value, const char *label) {
  ++checks;
  if (!value) {
    std::fprintf(stderr, "FAIL: %s\n", label);
    std::exit(1);
  }
}
bool near(float a, float b, float epsilon = .01f) {
  return std::abs(a - b) < epsilon;
}

void tuningTests() {
  Parameters settings;
  for (int id = 0; id < ParameterCount; ++id) {
    const auto &spec = parameterSpecs[id];
    check(settings[Parameter(id)] >= spec.minimum &&
              settings[Parameter(id)] <= spec.maximum,
          "registry defaults in bounds");
  }
  float original = settings[Speed];
  check(!settings.set(Speed, std::numeric_limits<float>::quiet_NaN()) &&
            settings[Speed] == original,
        "nonfinite settings rejected");
  settings.set(Speed, 10000);
  check(near(settings[Speed], 180), "speed bounded");
  settings.set(WindOctaves, 3.7f);
  check(near(settings[WindOctaves], 4), "octaves are integral");
  Simulation isolated(1);
  for (auto id :
       {CohesionEnabled, AlignmentEnabled, RepulsionEnabled, FleeEnabled})
    isolated.setParameter(id, 0);
  isolated.setParameter(Speed, 110);
  isolated.setBoid(0, {100, 100}, .7f);
  isolated.predators.push_back({{101, 100}, 0, 0, true});
  isolated.tick(1.f / 60);
  check(near(isolated.state()[0].heading, .7f, .0001f),
        "disabled functors preserve heading");
  check(near(std::sqrt(length2(isolated.state()[0].velocity)), 110),
        "speed slider applies");
  Simulation radius(2);
  for (auto id : {AlignmentEnabled, RepulsionEnabled, FleeEnabled})
    radius.setParameter(id, 0);
  radius.setParameter(CohesionRadius, 10);
  radius.setBoid(0, {100, 100}, pi / 2);
  radius.setBoid(1, {170, 100}, 0);
  radius.tick(1.f / 60);
  check(near(radius.state()[0].heading, pi / 2, .0001f),
        "cohesion excludes outside its radius");
  radius.setParameter(CohesionRadius, 96);
  radius.tick(1.f / 60);
  check(radius.state()[0].heading < pi / 2 - .02f,
        "larger radius rebuilds broadphase");
  radius.setParameter(CohesionEnabled, 0);
  float heading = radius.state()[0].heading;
  radius.tick(1.f / 60);
  check(near(radius.state()[0].heading, heading, .0001f),
        "cohesion toggle removes contribution");
  Simulation separation(2);
  for (auto id : {CohesionEnabled, AlignmentEnabled, FleeEnabled})
    separation.setParameter(id, 0);
  separation.setParameter(RepulsionRadius, 96);
  separation.setBoid(0, {100, 100}, 0);
  separation.setBoid(1, {160, 100}, 0);
  separation.tick(1.f / 60);
  check(std::abs(separation.state()[0].heading) > .02f,
        "repulsion has its own configurable radius");
  Simulation flee(1);
  for (auto id : {CohesionEnabled, AlignmentEnabled, RepulsionEnabled})
    flee.setParameter(id, 0);
  flee.setBoid(0, {0, 100}, 0);
  flee.predators.push_back({{150, 100}, 0, 0, true});
  flee.tick(1.f / 60);
  check(near(flee.state()[0].heading, 0, .0001f),
        "flee radius excludes distant predator");
  flee.setParameter(FleeRadius, 200);
  flee.tick(1.f / 60);
  check(std::abs(flee.state()[0].heading) > .02f,
        "expanded flee radius updates predator broadphase");
  settings = Parameters{};
  settings.set(ShoalThreshold, 90);
  Boid boost;
  Shoal{}(boost, pi / 3, 1.f / 60, true, settings);
  check(boost.boost == 0, "custom shoal threshold");
  settings.set(ShoalThreshold, 30);
  settings.set(ShoalDuration, 1.2f);
  settings.set(ShoalCooldown, .3f);
  Shoal{}(boost, pi / 3, 1.f / 60, true, settings);
  check(near(boost.boost, 1.2f) && near(boost.cooldown, 1.5f),
        "custom boost and cooldown durations");
  settings.set(ShoalRearm, 0);
  boost.boost = 0;
  boost.cooldown = 0;
  boost.armed = false;
  Shoal{}(boost, 0, 1.f / 60, true, settings);
  check(boost.armed, "zero rearm threshold accepts straight motion");
  isolated.setParameter(ShoalThreshold, 10);
  check(isolated.parameter(ShoalRearm) < isolated.parameter(ShoalThreshold),
        "rearm stays below trigger threshold");
  Simulation map(2);
  map.setBoid(0, {800, 700}, 0);
  map.setBoid(1, {1000, 1000}, 0);
  map.addPredator();
  map.setSmallMap(true);
  check(map.worldSize() == 512 && map.state().size() == 2,
        "map switch retains population");
  check(near(map.state()[0].position.x, 400) &&
            near(map.state()[0].position.y, 350),
        "map switch rescales positions");
  check(near(map.parameter(OrbitRadius), 200) &&
            near(std::sqrt(length2(map.predators[0].position - Vec{256, 256})),
                 200),
        "small map orbit scales around new centre");
  auto seam = delta({2, 2}, {510, 510}, 512);
  check(near(seam.x, -4) && near(seam.y, -4), "small map wraps both axes");
  map.setParameter(OrbitRadius, 999);
  check(near(map.parameter(OrbitRadius), 240),
        "small map clamps orbit inside map");
  map.setSmallMap(false);
  check(near(map.state()[0].position.x, 800) &&
            near(map.state()[0].position.y, 700),
        "large map restores proportional layout");
  check(near(Perlin3D::sample(0, 0, 0), 0), "Perlin lattice value");
  check(near(Perlin3D::sample(.9999f, .2f, .6f),
             Perlin3D::sample(1.0001f, .2f, .6f), .01f),
        "Perlin continuity across lattice boundary");
  settings = Parameters{};
  Vec a = Wind{}({45.5f, 89.2f}, 0, settings),
      b = Wind{}({45.5f, 89.2f}, 2, settings);
  check(length2(a - b) > 1e-6f,
        "third noise dimension animates wind over time");
  settings.set(WindX, 0);
  a = Wind{}({45.5f, 89.2f}, 1, settings);
  check(a.x == 0 && std::abs(a.y) > 1e-6f, "independent wind force weights");
  settings.set(WindTime, 0);
  a = Wind{}({45.5f, 89.2f}, 0, settings);
  b = Wind{}({45.5f, 89.2f}, 10, settings);
  check(length2(a - b) < 1e-10f, "zero time scale freezes noise");
  Simulation wind(8);
  wind.setParameter(WindEnabled, 1);
  wind.tick(1.f / 60);
  check(length2(wind.windAt({0, 25}) - wind.windAt({1024, 25})) < 1e-10f,
        "wind field wraps continuously");
  wind.setParameter(WindTime, 0);
  wind.tick(1.f / 60);
  a = wind.windAt({77, 128});
  for (int i = 0; i < 120; ++i)
    wind.tick(1.f / 60);
  b = wind.windAt({77, 128});
  check(length2(a - b) < 1e-8f, "cached field respects frozen time");
  wind.setSmallMap(true);
  wind.setParameter(WindOctaves, 6);
  wind.setParameter(WindScale, 16);
  wind.setParameter(FleeRadius, 256);
  wind.setParameter(CohesionRadius, 128);
  wind.addPredator();
  for (int i = 0; i < 20; ++i)
    wind.tick(1.f / 60);
  for (const auto &boid : wind.state())
    check(boid.position.x >= 0 && boid.position.x < 512 &&
              boid.position.y >= 0 && boid.position.y < 512 &&
              std::isfinite(boid.heading),
          "small map and extreme wind remain finite");
}

void launchAndMapTests() {
  Simulation flock(4);
  flock.setBoid(0, {900, 700}, 0);
  flock.addPredator();
  check(flock.setWorldSize(256), "256 map accepted");
  check(flock.worldSize() == 256 && flock.state().size() == 4,
        "256 map preserves population");
  check(near(flock.state()[0].position.x, 225) &&
            near(flock.state()[0].position.y, 175),
        "256 positions rescale");
  check(near(flock.parameter(OrbitRadius), 100),
        "256 orbit radius scales to 100");
  check(near(std::sqrt(length2(flock.predators[0].position - Vec{128, 128})),
             100),
        "256 orbit uses new centre");
  flock.setParameter(OrbitRadius, 496);
  check(near(flock.parameter(OrbitRadius), 112),
        "256 orbit bounded inside world");
  check(!flock.setWorldSize(300) && flock.worldSize() == 256,
        "unsupported map size rejected");
  auto d = delta({1, 1}, {255, 255}, 256);
  check(near(d.x, -2) && near(d.y, -2), "256 wraps both seams");
  flock.setWorldSize(512);
  check(near(flock.state()[0].position.x, 450), "256 to 512 position rescale");
  flock.setWorldSize(1024);
  check(near(flock.state()[0].position.x, 900), "256 to 1024 position rescale");
  Simulation launches(1);
  for (int i = 0; i < 16; ++i)
    launches.addPredator();
  for (int i = 0; i < 70; ++i)
    check(launches.sendPredator(), "every repeated launch accepted");
  check(launches.crossingCount() == 70 && launches.orbitCount() == 16,
        "crossing and orbit populations independent");
  launches.tick(1.f / 60);
  check(launches.crossingCount() == 70,
        "more than 32 predators survive simulation tick");
  for (int i = 0; i < 900; ++i)
    launches.tick(1.f / 60);
  check(launches.crossingCount() == 0 && launches.orbitCount() == 16,
        "crossing predators exit independently of orbits");
  // Only a predator beyond the former bitmask capacity is close enough to flee.
  Simulation distantIndex(1);
  distantIndex.setBoid(0, {4, 512}, pi);
  for (int i = 0; i < 69; ++i)
    distantIndex.predators.push_back({{512, 512}, 0, 0, true});
  distantIndex.predators.push_back({{1020, 512}, 0, 0, true});
  distantIndex.tick(1.f / 60);
  check(std::abs(distantIndex.state()[0].velocity.y) > 1,
        "late-index predators contribute flee force");
}
void predatorMovementTests() {
  Simulation flights(0);
  for (int i = 0; i < 32; ++i)
    flights.sendPredator();
  int angled = 0;
  for (const auto &p : flights.predators) {
    check(p.destination.x == 1024 && p.destination.y >= 0 &&
              p.destination.y < 1024,
          "crossing target is on the right edge");
    check(near(p.position.y + std::tan(p.heading) * (1024 - p.position.x),
               p.destination.y, .001f),
          "crossing heading aims at its target");
    angled += std::abs(p.heading) > .01f;
  }
  check(angled > 25, "crossing destinations produce varied diagonal paths");
  flights.advanceEnvironment(.1f, false);
  for (const auto &p : flights.predators)
    check(p.position.x > -16, "crossings fly to the right");
  flights.setWorldSize(256);
  for (const auto &p : flights.predators)
    check(p.destination.x == 256, "crossing targets rescale");

  Simulation roaming(0);
  roaming.setWorldSize(256);
  roaming.setParameter(PredatorMode, 1);
  roaming.addPredator();
  roaming.addPredator();
  check(roaming.predators[0].noiseSeed != roaming.predators[1].noiseSeed,
        "independent predator noise seeds");
  const float initial = roaming.predators[0].heading;
  for (int step = 0; step < 600; step++) {
    const float before = roaming.predators[0].heading;
    roaming.advanceEnvironment(1.f / 60, false);
    const auto &p = roaming.predators[0];
    check(p.position.x >= 0 && p.position.x < 256 && p.position.y >= 0 &&
              p.position.y < 256,
          "random predators wrap");
    check(std::abs(angleDifference(before, p.heading)) <=
              roaming.parameter(PredatorTurnRate) * pi / 180 / 60 + .0001f,
          "random turning is bounded");
  }
  check(std::abs(angleDifference(initial, roaming.predators[0].heading)) > .01f,
        "Perlin steering changes heading");
  check(roaming.orbitCount() == 2, "roaming residents remain active");

  Simulation hunt(12);
  for (int i = 0; i < 12; i++)
    hunt.setBoid(i, i < 8 ? Vec{512, 650} : Vec{600, 512}, 0);
  hunt.predators.push_back({{512, 512}, 0, 0, false});
  hunt.setParameter(PredatorMode, 2);
  hunt.setParameter(PredatorTurnRate, 720);
  hunt.advanceEnvironment(.1f, false);
  check(hunt.predators[0].heading > 1,
        "hunt chooses denser cluster over closer sparse cluster");
  check(hunt.huntDensityTotal() == 12, "native hunt density counts all boids");
  hunt.predators[0].position = {512, 512};
  hunt.predators[0].heading = 0;
  hunt.setParameter(PredatorHuntRadius, 128);
  hunt.advanceEnvironment(.1f, false);
  check(std::abs(hunt.predators[0].heading) < .5f,
        "hunt ignores concentration outside search radius");
  for (int i = 0; i < 12; i++)
    hunt.setBoid(i, {1018, 512}, 0);
  hunt.predators[0].position = {4, 512};
  hunt.predators[0].heading = pi / 2;
  hunt.advanceEnvironment(.1f, false);
  check(std::cos(hunt.predators[0].heading) < 0,
        "hunt targets across toroidal seam");

  Simulation external(0);
  external.addPredator();
  external.setParameter(PredatorMode, 2);
  external.setParameter(PredatorHuntRadius, 768);
  external.setParameter(PredatorTurnRate, 720);
  external.predators[0].position = {512, 512};
  external.predators[0].heading = 0;
  std::array<uint32_t, cellCount> density{};
  density[16 + 32 * 20] = 100000;
  external.setHuntDensity(density);
  external.advanceEnvironment(.1f, false, false);
  check(external.predators[0].heading > 1 &&
            external.huntDensityTotal() == 100000,
        "GPU density drives hunt without CPU flock");
  external.setWorldSize(256);
  check(external.huntDensityTotal() == 0, "resizing invalidates density");
}
void predatorSpeedTests() {
  Simulation a(0), b(7);
  for (int i = 0; i < 8; i++) {
    if (i % 2) {
      a.sendPredator();
      b.sendPredator();
    } else {
      a.addPredator();
      b.addPredator();
    }
  }
  float lowest = 2, highest = 0;
  for (size_t i = 0; i < a.predators.size(); i++) {
    const auto &p = a.predators[i];
    check(p.identity == i + 1, "predator birth identities increase");
    check(p.speedMultiplier >= .8f && p.speedMultiplier <= 1.2f,
          "predator speed variation is bounded");
    check(p.speedMultiplier == b.predators[i].speedMultiplier,
          "predator speed is deterministic independently of flock state");
    lowest = std::min(lowest, p.speedMultiplier);
    highest = std::max(highest, p.speedMultiplier);
  }
  check(highest - lowest > .1f, "predators have varied speeds");
  auto &flight = a.predators[1];
  const float multiplier = flight.speedMultiplier;
  Vec before = flight.position;
  a.advanceEnvironment(.1f, false);
  check(near(std::sqrt(length2(flight.position - before)),
             a.parameter(CrossingSpeed) * multiplier * .1f),
        "crossing speed uses fixed multiplier");
  before = flight.position;
  a.advanceEnvironment(.1f, false);
  check(flight.speedMultiplier == multiplier &&
            near(std::sqrt(length2(flight.position - before)),
                 a.parameter(CrossingSpeed) * multiplier * .1f),
        "crossing speed does not reroll each tick");
  auto &resident = a.predators[0];
  const float residentMultiplier = resident.speedMultiplier;
  const float phase = resident.phase;
  a.advanceEnvironment(.1f, false);
  check(near(resident.phase - phase,
             2 * pi / a.parameter(OrbitPeriod) * residentMultiplier * .1f),
        "orbit angular speed varies per predator");
  a.setParameter(PredatorMode, 1);
  resident.position = {512, 512};
  before = resident.position;
  a.advanceEnvironment(.1f, false);
  check(near(std::sqrt(length2(resident.position - before)),
             a.parameter(PredatorSpeed) * residentMultiplier * .1f),
        "roaming speed uses predator multiplier");
  a.setParameter(PredatorMode, 2);
  a.setWorldSize(256);
  a.advanceEnvironment(.1f, false);
  check(resident.speedMultiplier == residentMultiplier,
        "speed identity survives mode and map changes");
  const auto last = a.predators.back().identity;
  a.removePredator();
  a.addPredator();
  check(a.predators.back().identity > last,
        "removed predator identities are not reused");
}
void swarmTests() {
  std::vector<Boid> flock(7);
  for (int i = 0; i < 7; i++) {
    flock[i].index = i;
    flock[i].position = {float(100 + i * 30), float(100 + i * 10)};
  }
  check(length2(Swarm{}(flock[0], flock, 1024)) == 0,
        "swarm root has no parent");
  for (int i = 1; i < 7; i++) {
    const Vec expected =
        unit(delta(flock[i].position, flock[(i - 1) >> 1].position, 1024));
    const Vec actual = Swarm{}(flock[i], flock, 1024);
    check(near(actual.x, expected.x, .00001f) &&
              near(actual.y, expected.y, .00001f),
          "swarm follows binary-tree parent");
  }
  flock[0].position = {1020, 500};
  flock[1].position = {4, 500};
  check(Swarm{}(flock[1], flock, 1024).x < -.99f,
        "swarm follows parent across wrap seam");
  Simulation sim(4);
  for (auto id : {CohesionEnabled, AlignmentEnabled, RepulsionEnabled,
                  FleeEnabled, WindEnabled})
    sim.setParameter(id, 0);
  sim.setParameter(SwarmEnabled, 1);
  sim.setParameter(TurnRate, 720);
  sim.setParameter(Speed, 10);
  sim.setBoid(0, {100, 100}, 0);
  sim.setBoid(1, {100, 150}, 0);
  sim.setBoid(2, {150, 100}, pi / 2);
  sim.setBoid(3, {150, 150}, 0);
  sim.tick(1.f);
  const auto &state = sim.state();
  check(near(state[0].heading, 0, .00001f),
        "swarm leaves root heading unchanged");
  check(near(state[1].heading, -pi / 2, .00001f),
        "swarm works with all neighbour rules disabled");
  check(near(std::abs(state[2].heading), pi, .00001f),
        "boid 2 follows 0 rather than 1");
  check(near(std::abs(state[3].heading), pi, .00001f),
        "swarm reads parent from pre-tick snapshot");
  sim.setParameter(SwarmEnabled, 0);
  const float before = sim.state()[1].heading;
  sim.tick(.1f);
  check(near(sim.state()[1].heading, before, .00001f),
        "swarm toggle removes steering");
}
int main() {
  predatorSpeedTests();
  swarmTests();
  predatorMovementTests();
  check(near(wrap(-1), 1023) && near(wrap(1024), 0) && near(wrap(2050), 2),
        "position wrapping");
  auto d = delta({2, 2}, {1022, 1022});
  check(near(d.x, -4) && near(d.y, -4),
        "shortest displacement across both seams");
  Neighbours n{{-8, 0}, {0, 12}, {4, 0}, 2};
  check(Cohesion{}(n).x < 0 && Alignment{}(n).y > 0 && Repulsion{}(n).x > 0,
        "steering functors");
  Boid b;
  Shoal{}(b, pi / 2, 1.f / 60, true);
  check(b.boost > .59f && b.cooldown > 1.39f, "shoal activation");
  for (int i = 0; i < 40; ++i)
    Shoal{}(b, pi / 2, 1.f / 60, true);
  check(b.boost == 0 && !b.armed, "boost expires without permanent retrigger");
  for (int i = 0; i < 50; ++i)
    Shoal{}(b, 0, 1.f / 60, true);
  check(b.armed, "shoal cooldown and rearm");
  Shoal{}(b, pi / 2, 1.f / 60, true);
  Shoal{}(b, 0, 1.f / 60, false);
  check(b.boost == 0 && b.cooldown == 0, "disable clears boost");
  std::vector<Predator> p{{{1020, 500}, 0, 0, false}};
  check(Flee{}({4, 500}, p).x > 0, "predator flee wraps seam");
  check(length2(Flee{}({500, 500}, p)) == 0, "predator radius");
  NeighbourBudgetController quality;
  for (int i = 0; i < 10; ++i)
    quality.observe(1200, 60);
  check(quality.observe(0, 0) == 8,
        "sustained slow ticks reduce work to a bounded minimum");
  for (int i = 0; i < 10; ++i)
    quality.observe(120, 60);
  check(quality.observe(0, 0) == 48,
        "spare capacity restores neighbour detail");
  Simulation sim(100);
  sim.setNeighbourBudget(-1);
  check(sim.neighbourBudget() == 8, "minimum neighbour budget");
  sim.setNeighbourBudget(100);
  check(sim.neighbourBudget() == 48, "maximum neighbour budget");
  for (int i = 0; i < 20; ++i)
    sim.addPredator();
  check(sim.orbitCount() == 16, "predator upper bound");
  sim.tick(1.f / 60);
  for (auto &pred : sim.predators)
    check(near(std::sqrt(length2(pred.position - Vec{512, 512})), 400),
          "orbit radius");
  for (int i = 0; i < 20; ++i)
    sim.removePredator();
  check(sim.orbitCount() == 0, "predator lower bound");
  check(sim.sendPredator() && sim.sendPredator() && sim.crossingCount() == 2,
        "multiple crossing predators launch together");
  for (int i = 0; i < 900; ++i)
    sim.tick(1.f / 60);
  check(!sim.crossingActive(), "crossing predator exits");
  check(sim.state().size() == 100, "predators never remove boids");
  Simulation threat(1);
  threat.setBoid(0, {4, 512}, pi);
  threat.predators.push_back({{1020, 512}, 0, 0, true});
  threat.tick(1.f / 60);
  check(std::abs(threat.state()[0].velocity.y) > 1,
        "predator broadphase preserves seam flee");
  Simulation pair(2);
  pair.setBoid(0, {1, 512}, pi);
  pair.setBoid(1, {1023, 512}, 0);
  pair.tick(1.f / 60);
  check(std::abs(pair.state()[0].velocity.y) > 1,
        "seam neighbour contributes steering");
  pair.setBoid(0, {512, 1}, -pi / 2);
  pair.setBoid(1, {512, 1023}, pi / 2);
  pair.tick(1.f / 60);
  check(std::abs(pair.state()[0].velocity.x) > 1,
        "vertical seam neighbour contributes steering");
  pair.setBoid(0, {512, 512}, 0);
  pair.setBoid(1, {512, 512}, 0);
  for (int i = 0; i < 120; ++i)
    pair.tick(1.f / 60);
  for (auto &boid : pair.state())
    check(std::isfinite(boid.position.x) && std::isfinite(boid.heading),
          "coincident boids stay finite");
  Simulation dense(population);
  for (int i = 0; i < population; ++i)
    dense.setBoid(i, {512, 512}, 0);
  dense.setWorldSize(256);
  for (auto id : {CohesionRadius, AlignmentRadius, RepulsionRadius})
    dense.setParameter(id, 128);
  dense.setShoal(true);
  dense.setNeighbourBudget(8);
  for (int i = 0; i < 10; ++i)
    dense.tick(1.f / 60);
  for (auto &boid : dense.state())
    check(boid.position.x >= 0 && boid.position.x < 256 &&
              boid.position.y >= 0 && boid.position.y < 256 &&
              std::isfinite(boid.position.y),
          "dense 256 cluster stable at maximum interaction radius");
  tuningTests();
  launchAndMapTests();
  std::printf("PASS: %d checks\n", checks);
}
