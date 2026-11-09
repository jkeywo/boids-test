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
static double accumulator = 0;
static float simulationMs = 0;
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
out vec3 color;
void main(){float s=flags.x>0.5?3.2:1.;vec2 v=vertex*s;vec2 p=transform.xy+vec2(v.x*transform.z-v.y*transform.w,v.x*transform.w+v.y*transform.z);gl_Position=vec4(p.x/512.-1.,1.-p.y/512.,0.,1.);color=flags.x>0.5?vec3(1.,.27,.32):mix(vec3(.23,.83,.86),vec3(1.,.88,.46),flags.y);})";
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
  glBufferData(GL_ARRAY_BUFFER, (population + 17) * 6 * sizeof(float), nullptr,
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
  instances.reserve((population + 17) * 6);
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
  }
  if (steps == 4)
    accumulator = std::fmod(accumulator, 1. / 60);
  if (steps)
    simulationMs = float((emscripten_get_now() - begin) / steps);
  auto &state = sim->state();
  float alpha = float(accumulator * 60);
  instances.clear();
  for (auto &b : state) {
    Vec p = previous[b.index] + delta(previous[b.index], b.position) * alpha;
    const float speed = b.boost > 0 ? 105.f : 70.f;
    instances.insert(instances.end(),
                     {wrap(p.x), wrap(p.y), b.velocity.x / speed,
                      b.velocity.y / speed, 0, b.boost > 0 ? 1.f : 0.f});
  }
  for (auto &p : sim->predators)
    instances.insert(instances.end(),
                     {p.position.x, p.position.y, std::cos(p.heading),
                      std::sin(p.heading), 1, 0});
  int w, h;
  emscripten_get_canvas_element_size("#simulation", &w, &h);
  glViewport(0, 0, w, h);
  glClearColor(.025f, .048f, .065f, 1);
  glClear(GL_COLOR_BUFFER_BIT);
  glUseProgram(program);
  glBindVertexArray(vao);
  glBindBuffer(GL_ARRAY_BUFFER, vbo);
  glBufferSubData(GL_ARRAY_BUFFER, 0, instances.size() * sizeof(float),
                  instances.data());
  glDrawArraysInstanced(GL_TRIANGLES, 0, 3, GLsizei(instances.size() / 6));
}
EMSCRIPTEN_KEEPALIVE void command(int action) {
  if (!sim)
    return;
  switch (action) {
  case 0:
    sim->setShoal(!sim->shoal);
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
    return sim->shoal;
  case 3:
    return simulationMs;
  default:
    return population;
  }
}
EMSCRIPTEN_KEEPALIVE void resume() { accumulator = 0; }
}
