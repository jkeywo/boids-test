#include "simulation.hpp"
#include <cstdio>
#include <cstdlib>
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
  Simulation sim(100);
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
  for (int i = 0; i < 10; ++i)
    dense.tick(1.f / 60);
  for (auto &boid : dense.state())
    check(boid.position.x >= 0 && boid.position.x < 1024 &&
              std::isfinite(boid.position.y),
          "dense cluster stable");
  std::printf("PASS: %d checks\n", checks);
}
