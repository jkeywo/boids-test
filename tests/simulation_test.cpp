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
int main() {
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
  check(sim.sendPredator() && !sim.sendPredator(), "one crossing predator");
  for (int i = 0; i < 400; ++i)
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
  dense.setShoal(true);
  dense.setNeighbourBudget(8);
  for (int i = 0; i < 10; ++i)
    dense.tick(1.f / 60);
  for (auto &boid : dense.state())
    check(boid.position.x >= 0 && boid.position.x < 1024 &&
              std::isfinite(boid.position.y),
          "dense cluster stable");
  tuningTests();
  std::printf("PASS: %d checks\n", checks);
}
