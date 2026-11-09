// PARAMETER_CONSTANTS
struct Config {
  data: vec4<f32>,
  counts: vec4<u32>,
  misc: vec4<u32>,
  scale: vec4<f32>,
  params: array<vec4<f32>, PARAMETER_VECTORS>
}
struct Boid {
  position: vec2<f32>,
  velocity: vec2<f32>,
  boost: f32,
  cooldown: f32,
  armed: u32,
  padding: u32
}
struct Boids {
  values: array<Boid>
}
struct Vectors {
  values: array<vec4<f32>>
}
@group(0) @binding(0) var<uniform> cfg: Config;
@group(0) @binding(1) var<storage, read> current: Boids;
@group(0) @binding(2) var<storage, read> previous: Boids;
@group(0) @binding(3) var<storage, read> predators: Vectors;
struct VertexOut {
  @builtin(position) position: vec4<f32>, @location(0) color: vec3<f32>
}
fn difference(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  var d = b-a;
  d = select(d, d-vec2(cfg.data.x), d>=vec2(cfg.data.x*.5));
  d = select(d, d+vec2(cfg.data.x), d<vec2(-cfg.data.x*.5));
  return d;
}
fn p(id: u32) -> f32 { return cfg.params[id / 4u][id % 4u]; }
fn hueColour(degrees: f32) -> vec3<f32> {
  let h = fract(degrees / 360.0);
  let rgb = clamp(abs(fract(vec3(h) + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, vec3(0.0), vec3(1.0));
  return 0.86 * mix(vec3(1.0), rgb, vec3(0.73));
}
@vertex fn vertex(@builtin(vertex_index) vertexId: u32, @builtin(instance_index) id: u32) -> VertexOut {
  var shape = array<vec2<f32>, 3>(vec2(4.0, 0.0), vec2(-2.0, -1.5), vec2(-2.0, 1.5));
  var point: vec2<f32>;
  var direction: vec2<f32>;
  var color: vec3<f32>;
  var scale = .5;
  if (id>=cfg.counts.x) {
    let predator = predators.values[id-cfg.counts.x];
    point = predator.xy;
    direction = predator.zw;
    color = vec3(1.0, .27, .32);
    scale = 3.2;
  }
  else {
    let boid = current.values[id];
    let old = previous.values[id];
    point = old.position+difference(old.position, boid.position)*cfg.data.w;
    point-=cfg.data.x*floor(point/cfg.data.x);
    point = select(point, vec2(0.0), point >= vec2(cfg.data.x));
    direction = normalize(boid.velocity);
    var hue = p(P_BOID_HUE);
    if (p(P_DIRECTION_HUE) > 0.0) { hue += atan2(direction.y, direction.x) * 57.2957795131; }
    if (boid.boost > 0.0 && p(P_SHOAL_HUE_ENABLED) > 0.0) { hue += p(P_SHOAL_HUE_OFFSET); }
    color = hueColour(hue);
  }
  let v = shape[vertexId]*scale;
  point+=vec2(v.x*direction.x-v.y*direction.y, v.x*direction.y+v.y*direction.x);
  var out: VertexOut;
  out.position = vec4(point.x/cfg.data.x*2.0-1.0, 1.0-point.y/cfg.data.x*2.0, 0.0, 1.0);
  out.color = color;
  return out;
}
@fragment fn fragment(input: VertexOut) -> @location(0) vec4<f32> {
  return vec4(input.color, 1.0);
}
