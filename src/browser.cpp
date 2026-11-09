#include "simulation.hpp"
#include <GLES3/gl3.h>
#include <cstdio>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <memory>
using namespace boids;
static std::unique_ptr<Simulation> sim;
static std::vector<float> instances;
static std::vector<Vec> previous;
static GLuint program, vao, vbo;
static GLint worldSizeUniform, colourUniform;
static size_t instanceCapacity = (population + 32) * 6;
static double accumulator = 0;
static float simulationMs = 0;
static NeighbourBudgetController quality;
static uint64_t totalTicks = 0;
static std::array<uint32_t, cellCount> incomingHuntDensity;
static GLuint shader(GLenum type, const char *source) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &source, nullptr);
  glCompileShader(s);
  GLint ok;
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[2048];
    glGetShaderInfoLog(s, 2048, nullptr, log);
    std::fprintf(stderr, "Shader: %s\n", log);
  }
  return s;
}
extern "C" {
EMSCRIPTEN_KEEPALIVE int initialize() {
  EmscriptenWebGLContextAttributes attr;
  emscripten_webgl_init_context_attributes(&attr);
  attr.majorVersion = 2;
  attr.alpha = false;
  attr.antialias = false;
  attr.depth = false;
  attr.stencil = false;
  auto context = emscripten_webgl_create_context("#simulation", &attr);
  if (context <= 0)
    return 0;
  emscripten_webgl_make_context_current(context);
  const char *vs = R"(#version 300 es
layout(location=0) in vec2 vertex;
layout(location=1) in vec4 transform;
layout(location=2) in vec2 flags;
uniform float worldSize;
uniform vec4 appearance; // base hue, direction colouring, boost offset enabled, boost offset
vec3 hueColour(float degrees) {
  float h = fract(degrees / 360.);
  vec3 rgb = clamp(abs(fract(vec3(h) + vec3(0., 2./3., 1./3.)) * 6. - 3.) - 1., 0., 1.);
  return .86 * mix(vec3(1.), rgb, .73);
}
out vec3 color;
void main() {
  float s = flags.x > .5 ? 3.2 : 1.;
  vec2 v = vertex * s;
  vec2 p = transform.xy + vec2(v.x*transform.z-v.y*transform.w, v.x*transform.w+v.y*transform.z);
  gl_Position = vec4(p.x/worldSize*2.-1., 1.-p.y/worldSize*2., 0., 1.);
  float hue = appearance.x;
  if (appearance.y > .5) hue += atan(transform.w, transform.z) * 57.2957795131;
  if (flags.y > .5 && appearance.z > .5) hue += appearance.w;
  color = flags.x > .5 ? vec3(1., .27, .32) : hueColour(hue);
})";
  const char *fs = R"(#version 300 es
precision mediump float;
in vec3 color;out vec4 outColor;
void main(){outColor=vec4(color,1.);})";
  GLuint vert = shader(GL_VERTEX_SHADER, vs),
         frag = shader(GL_FRAGMENT_SHADER, fs);
  program = glCreateProgram();
  glAttachShader(program, vert);
  glAttachShader(program, frag);
  glLinkProgram(program);
  worldSizeUniform = glGetUniformLocation(program, "worldSize");
  colourUniform = glGetUniformLocation(program, "appearance");
  glDeleteShader(vert);
  glDeleteShader(frag);
  GLint linked;
  glGetProgramiv(program, GL_LINK_STATUS, &linked);
  if (!linked)
    return 0;
  glGenVertexArrays(1, &vao);
  glBindVertexArray(vao);
  GLuint vertices;
  glGenBuffers(1, &vertices);
  glBindBuffer(GL_ARRAY_BUFFER, vertices);
  float triangle[] = {4, 0, -2, -1.5f, -2, 1.5f};
  glBufferData(GL_ARRAY_BUFFER, sizeof(triangle), triangle, GL_STATIC_DRAW);
  glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, nullptr);
  glEnableVertexAttribArray(0);
  glGenBuffers(1, &vbo);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glBufferData(GL_ARRAY_BUFFER, instanceCapacity * sizeof(float), nullptr,
               GL_STREAM_DRAW);
  glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, 6 * sizeof(float), nullptr);
  glEnableVertexAttribArray(1);
  glVertexAttribDivisor(1, 1);
  glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, 6 * sizeof(float),
                        (void *)(4 * sizeof(float)));
  glEnableVertexAttribArray(2);
  glVertexAttribDivisor(2, 1);
  sim = std::make_unique<Simulation>();
  previous.resize(population);
  auto &initial = sim->state();
  for (auto &b : initial)
    previous[b.index] = b.position;
  instances.reserve(instanceCapacity);
  return 1;
}
EMSCRIPTEN_KEEPALIVE void frame(double dt) {
  if (!sim)
    return;
  accumulator += std::clamp(dt, 0., .1);
  int steps = 0;
  double begin = emscripten_get_now();
  while (accumulator >= 1. / 60 && steps < 4) {
    auto &before = sim->state();
    for (auto &b : before)
      previous[b.index] = b.position;
    sim->tick(1.f / 60);
    accumulator -= 1. / 60;
    ++steps;
    ++totalTicks;
  }
  if (steps == 4)
    accumulator = std::fmod(accumulator, 1. / 60);
  if (steps) {
    const float elapsedMs = float(emscripten_get_now() - begin);
    simulationMs = elapsedMs / steps;
    sim->setNeighbourBudget(quality.observe(elapsedMs, steps));
  }
  auto &state = sim->state();
  float alpha = float(accumulator * 60);
  instances.clear();
  for (auto &b : state) {
    Vec p = previous[b.index] +
            delta(previous[b.index], b.position, sim->worldSize()) * alpha;
    const Vec direction = unit(b.velocity);
    instances.insert(instances.end(),
                     {wrap(p.x, sim->worldSize()), wrap(p.y, sim->worldSize()),
                      direction.x, direction.y, 0, b.boost > 0 ? 1.f : 0.f});
  }
  for (auto &p : sim->predators)
    instances.insert(instances.end(),
                     {p.position.x, p.position.y, std::cos(p.heading),
                      std::sin(p.heading), 1, 0});
  int w, h;
  emscripten_get_canvas_element_size("#simulation", &w, &h);
  glViewport(0, 0, w, h);
  // A dark HSV shade of the base hue, independent of individual
  // headings/boosts.
  const float hue = sim->parameter(BoidHue) / 60.f;
  auto channel = [hue](float shift) {
    const float k = std::fmod(hue + shift, 6.f);
    return .065f *
           (1.f - .615f * std::clamp(std::abs(k - 3.f) - 1.f, 0.f, 1.f));
  };
  glClearColor(channel(3), channel(1), channel(5), 1);
  glClear(GL_COLOR_BUFFER_BIT);
  glUseProgram(program);
  glUniform1f(worldSizeUniform, sim->worldSize());
  glUniform4f(colourUniform, sim->parameter(BoidHue),
              sim->parameter(DirectionHue), sim->parameter(ShoalHueEnabled),
              sim->parameter(ShoalHueOffset));
  glBindVertexArray(vao);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  if (instances.size() > instanceCapacity) {
    instanceCapacity = std::max(instanceCapacity * 2, instances.size());
    glBufferData(GL_ARRAY_BUFFER, instanceCapacity * sizeof(float), nullptr,
                 GL_STREAM_DRAW);
  }
  glBufferSubData(GL_ARRAY_BUFFER, 0, instances.size() * sizeof(float),
                  instances.data());
  glDrawArraysInstanced(GL_TRIANGLES, 0, 3, GLsizei(instances.size() / 6));
}
EMSCRIPTEN_KEEPALIVE void command(int action) {
  if (!sim)
    return;
  switch (action) {
  case 0:
    sim->setShoal(!sim->parameter(ShoalEnabled));
    break;
  case 1:
    sim->sendPredator();
    break;
  case 2:
    sim->addPredator();
    break;
  case 3:
    sim->removePredator();
    break;
  case 5:
    sim->predators.clear();
    break;
  case 4:
    sim->setSmallMap(sim->worldSize() != 512);
    for (const auto &b : sim->state())
      previous[b.index] = b.position;
    accumulator = 0;
    break;
  }
}
EMSCRIPTEN_KEEPALIVE double statistic(int id) {
  if (!sim)
    return 0;
  switch (id) {
  case 0:
    return sim->orbitCount();
  case 1:
    return sim->crossingActive();
  case 2:
    return sim->parameter(ShoalEnabled);
  case 3:
    return simulationMs;
  case 5:
    return sim->neighbourBudget();
  case 6:
    return double(totalTicks);
  case 7:
    return sim->worldSize();
  case 8:
    return sim->crossingCount();
  case 9:
    return double(sim->predators.size());
  case 10:
    return sim->huntDensityTotal();
  default:
    return population;
  }
}
EMSCRIPTEN_KEEPALIVE int set_world_size(int width) {
  if (!sim || !sim->setWorldSize(float(width)))
    return 0;
  for (const auto &b : sim->state())
    previous[b.index] = b.position;
  accumulator = 0;
  return int(sim->worldSize());
}
EMSCRIPTEN_KEEPALIVE const char *parameter_schema() {
  static const std::string schema = parameterSchema();
  return schema.c_str();
}
EMSCRIPTEN_KEEPALIVE double get_parameter(int id) {
  return sim && id >= 0 && id < ParameterCount ? sim->parameter(Parameter(id))
                                               : 0;
}
EMSCRIPTEN_KEEPALIVE double parameter_max(int id) {
  return sim && id >= 0 && id < ParameterCount
             ? sim->parameterMax(Parameter(id))
             : 0;
}
EMSCRIPTEN_KEEPALIVE double set_parameter(int id, double value) {
  if (sim && id >= 0 && id < ParameterCount && std::isfinite(value)) {
    sim->setParameter(Parameter(id), float(value));
    return sim->parameter(Parameter(id));
  }
  return 0;
}
// GPU mode advances only shared controls/environment, never the 10k CPU flock.
EMSCRIPTEN_KEEPALIVE void gpu_control_step(double dt) {
  if (sim && std::isfinite(dt) && dt > 0)
    sim->advanceEnvironment(float(dt), false, false);
}
EMSCRIPTEN_KEEPALIVE double predator_value(int index, int field) {
  if (!sim || index < 0 || size_t(index) >= sim->predators.size())
    return 0;
  const auto &p = sim->predators[size_t(index)];
  switch (field) {
  case 0:
    return p.position.x;
  case 1:
    return p.position.y;
  case 2:
    return p.heading;
  case 3:
    return p.destination.x;
  case 4:
    return p.destination.y;
  case 5:
    return p.crossing ? 1 : 0;
  case 6:
    return p.speedMultiplier;
  case 7:
    return p.identity;
  default:
    return 0;
  }
}
EMSCRIPTEN_KEEPALIVE uint32_t *hunt_density_buffer() {
  return incomingHuntDensity.data();
}
EMSCRIPTEN_KEEPALIVE void apply_hunt_density(double extent) {
  if (sim && sim->worldSize() == extent)
    sim->setHuntDensity(incomingHuntDensity);
}
EMSCRIPTEN_KEEPALIVE void clear_hunt_density() {
  if (sim)
    sim->clearHuntDensity();
}
EMSCRIPTEN_KEEPALIVE void resume() { accumulator = 0; }
}
