// PARAMETER_CONSTANTS
struct Config {
  data: vec4<f32>,
  // extent, dt, time, interpolation alpha
  counts: vec4<u32>,
  // population, grid side, candidate budget, predators
  misc: vec4<u32>,
  // tick, insertion rotation, reserved, reserved
  scale: vec4<f32>,
  // map-rescale ratio
  params: array<vec4<f32>, 9>,
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
struct Counts {
  values: array<atomic<u32>>
}
struct Indices {
  values: array<u32>
}
struct Vectors {
  values: array<vec4<f32>>
}
@group(0) @binding(0) var<uniform> cfg: Config;
@group(0) @binding(1) var<storage, read> stateIn: Boids;
@group(0) @binding(2) var<storage, read_write> stateOut: Boids;
@group(0) @binding(3) var<storage, read_write> cellCounts: Counts;
@group(0) @binding(4) var<storage, read_write> cellIndices: Indices;
@group(0) @binding(5) var<storage, read_write> wind: Vectors;
@group(0) @binding(6) var<storage, read> predators: Vectors;
const PI: f32 = 3.14159265359;
// Each cell keeps a rotating bounded pool; every boid is still integrated.
const POOL: u32 = 128u;
fn p(id: u32) -> f32 {
  return cfg.params[id/4u][id%4u];
}
fn hash(input: u32) -> u32 {
  var h = input;
  h^=h>>16u;
  h*=0x7feb352du;
  h^=h>>15u;
  h*=0x846ca68bu;
  return h^(h>>16u);
}
fn random(input: u32) -> f32 {
  return f32(hash(input)&0xffffffu)/16777216.0;
}
fn wrap(v: vec2<f32>) -> vec2<f32> {
  return v-cfg.data.x*floor(v/cfg.data.x);
}
fn difference(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  var d = b-a;
  d = select(d, d-vec2(cfg.data.x), d>=vec2(cfg.data.x*.5));
  d = select(d, d+vec2(cfg.data.x), d<vec2(-cfg.data.x*.5));
  return d;
}
fn unit(v: vec2<f32>) -> vec2<f32> {
  let q = dot(v, v);
  if (q>1e-12) {
    return v*inverseSqrt(q);
  }
  return vec2(0.0);
}
fn cell(position: vec2<f32>) -> u32 {
  let xy = min(vec2<u32>(position/cfg.data.x*f32(cfg.counts.y)), vec2(cfg.counts.y-1u));
  return xy.x+xy.y*cfg.counts.y;
}
fn fade(t: vec3<f32>) -> vec3<f32> {
  return t*t*t*(t*(t*6.0-15.0)+10.0);
}
fn gradient(h: u32, v: vec3<f32>) -> f32 {
  switch (h%12u) {
    case 0u: {
      return v.x+v.y;
    }
    case 1u: {
      return -v.x+v.y;
    }
    case 2u: {
      return v.x-v.y;
    }
    case 3u: {
      return -v.x-v.y;
    }
    case 4u: {
      return v.x+v.z;
    }
    case 5u: {
      return -v.x+v.z;
    }
    case 6u: {
      return v.x-v.z;
    }
    case 7u: {
      return -v.x-v.z;
    }
    case 8u: {
      return v.y+v.z;
    }
    case 9u: {
      return -v.y+v.z;
    }
    case 10u: {
      return v.y-v.z;
    }
    default: {
      return -v.y-v.z;
    }
  }
}
fn noise(v: vec3<f32>, seed: u32) -> f32 {
  let lattice = vec3<i32>(floor(v));
  let f = fract(v);
  let weights = fade(f);
  var result = 0.0;
  for (var z = 0;z<2;z++) {
    for (var y = 0;y<2;y++) {
      for (var x = 0;x<2;x++) {
        let c = lattice+vec3(x, y, z);
        var h = (bitcast<u32>(c.x)*0x8da6b343u)^(bitcast<u32>(c.y)*0xd8163841u)^(bitcast<u32>(c.z)*0xcb1ab31fu)^seed;
        h^=h>>16u;
        h*=0x7feb352du;
        h^=h>>15u;
        let w = select(1.0-weights, weights, vec3(x, y, z)==vec3(1));
        result+=gradient(h, f-vec3<f32>(f32(x), f32(y), f32(z)))*w.x*w.y*w.z;
      }
    }
  }
  return result;
}
fn fractal(position: vec2<f32>, time: f32) -> vec2<f32> {
  var result = vec2(0.0);
  var amplitude = 1.0;
  var total = 0.0;
  var frequency = 1.0/p(P_WIND_SCALE);
  var z = time*p(P_WIND_TIME);
  for (var octave = 0u;octave<u32(p(P_WIND_OCTAVES));octave++) {
    let v = vec3(position*frequency, z);
    result+=amplitude*vec2(noise(v, 0x1234abcdu), noise(v, 0xa74f53c1u));
    total+=amplitude;
    amplitude*=p(P_WIND_PERSISTENCE);
    frequency*=p(P_WIND_LACUNARITY);
    z*=p(P_WIND_LACUNARITY);
  }
  return result/total;
}
@compute @workgroup_size(128) fn initialize(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id>=cfg.counts.x) {
    return;
  }
  let angle = random(id*3u+3u)*2.0*PI;
  stateOut.values[id] = Boid(vec2(random(id*3u+1u), random(id*3u+2u))*cfg.data.x, vec2(cos(angle), sin(angle))*p(P_SPEED), 0, 0, 1u, 0u);
}
@compute @workgroup_size(128) fn rescale(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id>=cfg.counts.x) {
    return;
  }
  var b = stateIn.values[id];
  b.position = wrap(b.position*cfg.scale.x);
  stateOut.values[id] = b;
}
@compute @workgroup_size(128) fn clearCells(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x<1024u) {
    atomicStore(&cellCounts.values[gid.x], 0u);
  }
}
// Rotate invocation order to avoid permanently preferring the same dense-cell IDs.
@compute @workgroup_size(128) fn binBoids(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x>=cfg.counts.x) {
    return;
  }
  var id = gid.x+cfg.misc.y;
  if (id>=cfg.counts.x) {
    id-=cfg.counts.x;
  }
  let c = cell(stateIn.values[id].position);
  let slot = atomicAdd(&cellCounts.values[c], 1u);
  if (slot<POOL) {
    cellIndices.values[c*POOL+slot] = id;
  }
}
@compute @workgroup_size(128) fn updateWind(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id>=1024u) {
    return;
  }
  let position = vec2<f32>(f32(id%32u), f32(id/32u))*cfg.data.x/32.0;
  let time = f32(cfg.misc.x/4u)/15.0;
  wind.values[id] = vec4(fractal(position, time), fractal(position, time+1.0/15.0));
}
fn windNode(x: u32, y: u32) -> vec2<f32> {
  let v = wind.values[(x&31u)+32u*(y&31u)];
  return mix(v.xy, v.zw, f32(cfg.misc.x%4u)/4.0);
}
fn windAt(position: vec2<f32>) -> vec2<f32> {
  let xy = position/cfg.data.x*32.0;
  let cell = vec2<u32>(floor(xy));
  let f = fract(xy);
  let a = mix(windNode(cell.x, cell.y), windNode(cell.x+1u, cell.y), f.x);
  let b = mix(windNode(cell.x, cell.y+1u), windNode(cell.x+1u, cell.y+1u), f.x);
  return mix(a, b, f.y)*vec2(p(P_WIND_X), p(P_WIND_Y))*p(P_WIND_WEIGHT);
}
@compute @workgroup_size(128) fn advance(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id>=cfg.counts.x) {
    return;
  }
  var b = stateIn.values[id];
  var maximum = 0.0;
  let cohesionOn = p(P_COHESION_ENABLED)>0.0&&p(P_COHESION_WEIGHT)>0.0;
  let alignmentOn = p(P_ALIGNMENT_ENABLED)>0.0&&p(P_ALIGNMENT_WEIGHT)>0.0;
  let repulsionOn = p(P_REPULSION_ENABLED)>0.0&&p(P_REPULSION_WEIGHT)>0.0;
  if (cohesionOn) {
    maximum = max(maximum, p(P_COHESION_RADIUS));
  }
  if (alignmentOn) {
    maximum = max(maximum, p(P_ALIGNMENT_RADIUS));
  }
  if (repulsionOn) {
    maximum = max(maximum, p(P_REPULSION_RADIUS));
  }
  var offset = vec2(0.0);
  var velocity = vec2(0.0);
  var separation = vec2(0.0);
  if (maximum>0) {
    var buckets: array<u32, 9>;
    var sizes: array<u32, 9>;
    var samples: array<u32, 9>;
    let side = cfg.counts.y;
    let xy = vec2<i32>(b.position/cfg.data.x*f32(side));
    let bucketCount = select(9u, 4u, side==2u);
    var total = 0u;
    for (var j = 0u;j<bucketCount;j++) {
      var c = j;
      if (side!=2u) {
        let v = (xy+vec2<i32>(i32(j%3u)-1, i32(j/3u)-1))&vec2<i32>(i32(side)-1);
        c = u32(v.x)+side*u32(v.y);
      }
      buckets[j] = c;
      sizes[j] = min(atomicLoad(&cellCounts.values[c]), POOL);
      total+=sizes[j];
    }
    // Divide the per-boid candidate budget across nonempty neighbouring cells.
    var assigned = 0u;
    let budget = min(total, cfg.counts.z);
    let ratio = f32(budget)/f32(max(total, 1u));
    for (var j = 0u;j<bucketCount;j++) {
      samples[j] = min(sizes[j], u32(f32(sizes[j])*ratio));
      assigned+=samples[j];
    }
    var remaining = budget-assigned;
    let first = id%bucketCount;
    for (var k = 0u;k<bucketCount&&remaining>0u;k++) {
      var j = k+first;
      if (j>=bucketCount) {
        j-=bucketCount;
      }
      if (samples[j]<sizes[j]) {
        samples[j]++;
        remaining--;
      }
    }
    let baseHash = hash(id^(cfg.misc.x*2246822519u));
    let cohesion2 = p(P_COHESION_RADIUS)*p(P_COHESION_RADIUS);
    let alignment2 = p(P_ALIGNMENT_RADIUS)*p(P_ALIGNMENT_RADIUS);
    let repulsion2 = p(P_REPULSION_RADIUS)*p(P_REPULSION_RADIUS);
    for (var j = 0u;j<bucketCount;j++) {
      let take = samples[j];
      let available = sizes[j];
      if (take==0u) {
        continue;
      }
      let start = u32(random(baseHash^buckets[j])*f32(available));
      let stride = f32(available)/f32(take);
      for (var k = 0u;k<take;k++) {
        var slot = start+u32(f32(k)*stride);
        if (slot>=available) {
          slot-=available;
        }
        let otherId = cellIndices.values[buckets[j]*POOL+slot];
        if (otherId==id) {
          continue;
        }
        let other = stateIn.values[otherId];
        let d = difference(b.position, other.position);
        let q = dot(d, d);
        if (q>maximum*maximum) {
          continue;
        }
        if (cohesionOn&&q<=cohesion2) {
          offset+=d;
        }
        if (alignmentOn&&q<=alignment2) {
          velocity+=other.velocity;
        }
        if (repulsionOn&&q<=repulsion2) {
          if (q<1e-8) {
            let sign = select(-1.0, 1.0, id<otherId);
            separation+=vec2(sign, sign*.5);
          }
          else {
            separation-=d/(q+.01);
          }
        }
      }
    }
  }
  var desired = unit(offset)*p(P_COHESION_WEIGHT)+unit(velocity)*p(P_ALIGNMENT_WEIGHT)+unit(separation)*p(P_REPULSION_WEIGHT);
  if (p(P_FLEE_ENABLED)>0.0&&p(P_FLEE_WEIGHT)>0.0) {
    let radius = p(P_FLEE_RADIUS);
    for (var i = 0u;i<cfg.counts.w;i++) {
      let predator = predators.values[i];
      var d = difference(predator.xy, b.position);
      let q = dot(d, d);
      if (q<radius*radius) {
        if (q<1e-8) {
          d = vec2(-predator.w, predator.z);
        }
        desired+=unit(d)*(1.0-sqrt(q)/radius)*p(P_FLEE_WEIGHT);
      }
    }
  }
  if (p(P_WIND_ENABLED)>0.0&&p(P_WIND_WEIGHT)>0.0) {
    desired+=windAt(b.position);
  }
  if (dot(desired, desired)<1e-10) {
    desired = unit(b.velocity);
  }
  var heading = atan2(b.velocity.y, b.velocity.x);
  var error = atan2(desired.y, desired.x)-heading;
  if (error>PI) {
    error-=2.0*PI;
  }
  if (error< -PI) {
    error+=2.0*PI;
  }
  if (p(P_SHOAL_ENABLED)==0.0) {
    b.boost = 0;
    b.cooldown = 0;
    b.armed = 1u;
  }
  else {
    b.boost = max(0.0, min(b.boost, p(P_SHOAL_DURATION))-cfg.data.y);
    b.cooldown = max(0.0, b.cooldown-cfg.data.y);
    if (abs(error)<=p(P_SHOAL_REARM)*PI/180.0&&b.cooldown==0.0) {
      b.armed = 1u;
    }
    if (b.armed==1u&&b.cooldown==0.0&&abs(error)>p(P_SHOAL_THRESHOLD)*PI/180.0) {
      b.boost = p(P_SHOAL_DURATION);
      b.cooldown = p(P_SHOAL_DURATION)+p(P_SHOAL_COOLDOWN);
      b.armed = 0u;
    }
  }
  let turn = p(P_TURN_RATE)*PI/180.0*select(1.0, p(P_SHOAL_TURN), b.boost>0.0)*cfg.data.y;
  heading+=clamp(error, -turn, turn);
  let speed = p(P_SPEED)*select(1.0, p(P_SHOAL_SPEED), b.boost>0.0);
  b.velocity = vec2(cos(heading), sin(heading))*speed;
  b.position = wrap(b.position+b.velocity*cfg.data.y);
  stateOut.values[id] = b;
}
