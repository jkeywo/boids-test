// PARAMETER_CONSTANTS
struct Config {
  data: vec4<f32>,
  // extent, dt, boosted turn sine, interpolation alpha
  counts: vec4<u32>,
  // population, grid side, candidate budget, predators
  misc: vec4<u32>,
  // tick, insertion rotation, hunt-density enabled, wind keyframe reuse
  scale: vec4<f32>,
  // map-rescale ratio, base turn cosine/sine, boosted turn cosine
  params: array<vec4<f32>, PARAMETER_VECTORS>,
  operation: vec4<u32>, // spawn start, swap pairs, permutation seed, halfBits bits
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
@group(0) @binding(7) var<storage, read_write> huntDensity: Counts;
struct Plans { values: array<atomic<u32>> }
@group(0) @binding(8) var<storage, read_write> plans: Plans;
const PI: f32 = 3.14159265359;
// Dense cells keep hash-selected representatives; every boid is integrated.
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
  let r = v-cfg.data.x*floor(v/cfg.data.x);
  // A tiny negative coordinate can round up to exactly extent after addition.
  // Match the CPU guard so every stored position stays in [0, extent).
  return select(r, vec2(0.0), r >= vec2(cfg.data.x));
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
  let shift = vec2(random(cfg.misc.x^0x51ed270bu), random(cfg.misc.x^0x9e3779b9u));
  let xy = min(vec2<u32>(fract(position/cfg.data.x+shift/f32(cfg.counts.y))*f32(cfg.counts.y)), vec2(cfg.counts.y-1u));
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
fn noise(v: vec3<f32>, seed: u32, period: i32) -> f32 {
  var lattice = vec3<i32>(floor(v));
  lattice.x=((lattice.x%period)+period)%period;
  lattice.y=((lattice.y%period)+period)%period;
  let f = fract(v);
  let weights = fade(f);
  var result = 0.0;
  for (var z = 0;z<2;z++) {
    for (var y = 0;y<2;y++) {
      for (var x = 0;x<2;x++) {
        var c = lattice+vec3(x, y, z);
        c.x=select(c.x,0,c.x==period);
        c.y=select(c.y,0,c.y==period);
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
fn tiled(position: vec2<f32>, z: f32, frequency: f32, seed: u32) -> f32 {
  let n=u32(floor(frequency)); let t=fract(frequency);
  let a=noise(vec3(position*f32(n)+vec2(.371,.619),z),seed^(n*0x9e3779b9u),i32(n));
  if(t==0.0){return a;}
  let b=noise(vec3(position*f32(n+1u)+vec2(.371,.619),z),seed^((n+1u)*0x9e3779b9u),i32(n+1u));
  return mix(a,b,t)*inverseSqrt((1.0-t)*(1.0-t)+t*t);
}
fn windSide() -> u32 { return select(select(64u,128u,cfg.data.x/p(P_WIND_SCALE)>16.0),256u,cfg.data.x/p(P_WIND_SCALE)>32.0); }
fn fractal(position: vec2<f32>, time: f32) -> vec2<f32> {
  var result=vec2(0.0);var amplitude=1.0;var total=0.0;
  var frequency=cfg.data.x/p(P_WIND_SCALE);var z=time*p(P_WIND_TIME);
  let nyquist=f32(windSide())*.5;
  for(var octave=0u;octave<u32(p(P_WIND_OCTAVES));octave++) {
    let cut=clamp((nyquist-frequency)/(nyquist*.5),0.0,1.0);
    let weight=amplitude*cut*cut*(3.0-2.0*cut);
    if(weight==0.0){break;}
    result+=weight*vec2(tiled(position/cfg.data.x,z,frequency,0x1234abcdu),tiled(position/cfg.data.x,z,frequency,0xa74f53c1u));
    total+=weight;amplitude*=p(P_WIND_PERSISTENCE);frequency*=p(P_WIND_LACUNARITY);z*=p(P_WIND_LACUNARITY);
  }
  return result/total;
}
// The spare word caches display colour once per tick, shared by all vertices.
fn boidColour(velocity: vec2<f32>, boost: f32) -> u32 {
  var hue = p(P_BOID_HUE);
  if (p(P_DIRECTION_HUE)>0.0) {
    hue += atan2(velocity.y, velocity.x)*57.2957795131;
  }
  if (boost>0.0 && p(P_SHOAL_HUE_ENABLED)>0.0) {
    hue += p(P_SHOAL_HUE_OFFSET);
  }
  let h = fract(hue/360.0);
  let rgb = clamp(abs(fract(vec3(h)+vec3(0.0, 2.0/3.0, 1.0/3.0))*6.0-3.0)-1.0, vec3(0.0), vec3(1.0));
  return pack4x8unorm(vec4(0.86*mix(vec3(1.0), rgb, vec3(0.73)), 1.0));
}
@compute @workgroup_size(128) fn initialize(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x+cfg.operation.x;
  if (id>=cfg.counts.x || id<cfg.operation.x) {
    return;
  }
  let angle = random(id*3u+3u)*2.0*PI;
  stateOut.values[id] = Boid(vec2(random(id*3u+1u), random(id*3u+2u))*cfg.data.x, vec2(cos(angle), sin(angle))*p(P_SPEED), 0, 0, 1u, boidColour(vec2(cos(angle),sin(angle)),0));
}
fn permutation(input: u32, inverse: bool) -> u32 {
  let halfBits=cfg.operation.w;let mask=(1u<<halfBits)-1u;
  var value=input;
  loop {
    var left=value>>halfBits;var right=value&mask;
    for(var i=0u;i<4u;i++) {
      let round=select(i,3u-i,inverse);
      let h=hash(select(right,left,inverse)^cfg.operation.z^(round*0x9e3779b9u))&mask;
      let next=select(left,right,inverse)^h;
      if(inverse){right=left;left=next;}else{left=right;right=next;}
    }
    value=(left<<halfBits)|right;
    if(value<cfg.counts.x){break;}
  }
  return value;
}
@compute @workgroup_size(128) fn swapState(@builtin(global_invocation_id) gid: vec3<u32>) {
  let pair=gid.x;if(pair>=cfg.operation.y){return;}
  let a=permutation(pair*2u,false);let b=permutation(pair*2u+1u,false);
  stateOut.values[a]=stateIn.values[b];stateOut.values[b]=stateIn.values[a];
}
@compute @workgroup_size(128) fn rescale(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id>=cfg.counts.x) {
    return;
  }
  var b = stateIn.values[id];
  b.position = wrap(b.position*cfg.scale.x);
  b.velocity *= cfg.scale.x;
  stateOut.values[id] = b;
}
// Hash-stratified min-hash representatives are independent of invocation order.
// First 1024*128 words hold min-hash keys. Each cell then has 32 words
// for its actual-population CDF, representative count and sentinel identity.
const META: u32 = 131072u;
fn planBase(c:u32) -> u32 { return META+c*32u; }
fn unhash(input:u32) -> u32 {
  var h=input;h^=h>>16u;h*=1124208931u;h^=(h>>15u)^(h>>30u);h*=493478565u;return h^(h>>16u);
}
@compute @workgroup_size(128) fn clearCells(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c=gid.x;if(c>=1024u){return;}
  atomicStore(&cellCounts.values[c],0u);atomicStore(&huntDensity.values[c],0u);
  atomicStore(&plans.values[planBase(c)+21u],0u);
  for(var j=0u;j<POOL;j++){atomicStore(&plans.values[c*POOL+j],0xffffffffu);}
}
@compute @workgroup_size(128) fn binBoids(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id=gid.x;if(id>=cfg.counts.x){return;}
  if(cfg.misc.z!=0u){
    let xy=min(vec2<u32>(stateIn.values[id].position/cfg.data.x*32.0),vec2(31u));
    atomicAdd(&huntDensity.values[xy.x+32u*xy.y],1u);
  }
  let c=cell(stateIn.values[id].position);
  let slot=atomicAdd(&cellCounts.values[c],1u);
  if(slot<POOL){cellIndices.values[c*POOL+slot]=id;}
  let key=hash(id^(cfg.misc.x*2246822519u));
  atomicMin(&plans.values[c*POOL+(key&127u)],key);
  if(key==0xffffffffu){atomicStore(&plans.values[planBase(c)+21u],id+1u);}
}
@compute @workgroup_size(128) fn preparePlans(@builtin(global_invocation_id) gid: vec3<u32>) {
  let c=gid.x;let side=cfg.counts.y;if(c>=side*side){return;}
  let count=atomicLoad(&cellCounts.values[c]);var available=count;
  if(count>POOL){
    available=0u;
    for(var j=0u;j<POOL;j++){
      let key=atomicLoad(&plans.values[c*POOL+j]);
      if(key!=0xffffffffu || (j==127u && atomicLoad(&plans.values[planBase(c)+21u])>0u)){
        cellIndices.values[c*POOL+available]=unhash(key)^(cfg.misc.x*2246822519u);available++;
      }
    }
  }
  atomicStore(&plans.values[planBase(c)+2u],available);
  let buckets=select(9u,4u,side==2u);var total=0u;
  let xy=vec2<i32>(i32(c%side),i32(c/side));
  for(var j=0u;j<buckets;j++){
    var other=j;
    if(side!=2u){let v=(xy+vec2<i32>(i32(j%3u)-1,i32(j/3u)-1))&vec2<i32>(i32(side)-1);other=u32(v.x)+side*u32(v.y);}
    total+=atomicLoad(&cellCounts.values[other]);
    atomicStore(&plans.values[planBase(c)+3u+j],other);
    atomicStore(&plans.values[planBase(c)+12u+j],total);
  }
  atomicStore(&plans.values[planBase(c)],total);
}
@compute @workgroup_size(128) fn updateWind(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id>=windSide()*windSide()) {
    return;
  }
  let position = vec2<f32>(f32(id%windSide()), f32(id/windSide()))*cfg.data.x/f32(windSide());
  let time = f32(cfg.misc.x/4u)/15.0;
  var previous = wind.values[id].zw;
  if (cfg.misc.w==0u) {
    previous = fractal(position, time);
  }
  wind.values[id] = vec4(previous, fractal(position, time+1.0/15.0));
}
fn windNode(x:i32,y:i32) -> vec2<f32> {
  let side=i32(windSide());let v=wind.values[u32((x&(side-1))+side*(y&(side-1)))];
  return mix(v.xy,v.zw,f32(cfg.misc.x%4u)/4.0);
}
fn cubic(a:vec2<f32>,b:vec2<f32>,c:vec2<f32>,d:vec2<f32>,t:f32)->vec2<f32>{
  return b+(c-a+(2.0*a-5.0*b+4.0*c-d+(3.0*(b-c)+d-a)*t)*t)*(t*.5);
}
fn windAt(position:vec2<f32>)->vec2<f32>{
  let xy=position/cfg.data.x*f32(windSide());let c=vec2<i32>(floor(xy));let f=fract(xy);
  var rows:array<vec2<f32>,4>;
  for(var j=0;j<4;j++){let y=c.y+j-1;rows[j]=cubic(windNode(c.x-1,y),windNode(c.x,y),windNode(c.x+1,y),windNode(c.x+2,y),f.x);}
  return cubic(rows[0],rows[1],rows[2],rows[3],f.y)*vec2(p(P_WIND_X),p(P_WIND_Y))*p(P_WIND_WEIGHT);
}
@compute @workgroup_size(128) fn advance(@builtin(global_invocation_id) gid: vec3<u32>) {
  let id = gid.x;
  if (id>=cfg.counts.x) {
    return;
  }
  var b = stateIn.values[id];
  let mapScale=cfg.data.x/1024.0;
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
    let plan=planBase(cell(b.position));
    // Rank the full population, not the capped representative pools.
    let total=atomicLoad(&plans.values[plan]);let take=min(total,cfg.counts.z);
    let baseHash=hash(id^(cfg.misc.x*2246822519u));
    let jitter=random(baseHash);var j=0u;var previous=0u;
    let cohesion2=p(P_COHESION_RADIUS)*p(P_COHESION_RADIUS);
    let alignment2=p(P_ALIGNMENT_RADIUS)*p(P_ALIGNMENT_RADIUS);
    let repulsion2=p(P_REPULSION_RADIUS)*p(P_REPULSION_RADIUS);
    for(var k=0u;k<take;k++) {
        let rank=min(total-1u,u32((f32(k)+jitter)*f32(total)/f32(take)));
        loop {
          let cumulative=atomicLoad(&plans.values[plan+12u+j]);
          if(rank<cumulative){break;} previous=cumulative;j++;
        }
        let bucket=atomicLoad(&plans.values[plan+3u+j]);
        let count=atomicLoad(&cellCounts.values[bucket]);
        let available=atomicLoad(&plans.values[planBase(bucket)+2u]);
        var slot=rank-previous;
        if(count>POOL){slot=min(available-1u,u32(random(baseHash^(k*0x9e3779b9u))*f32(available)));}
        let otherId=cellIndices.values[bucket*POOL+slot];
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
          if (q<1e-8*mapScale*mapScale) {
            let sign = select(-1.0, 1.0, id<otherId);
            separation+=vec2(sign, sign*.5);
          }
          else {
            separation-=d*mapScale/(q+.01*mapScale*mapScale);
          }
        }
    }
  }
  var desired = unit(offset/mapScale)*p(P_COHESION_WEIGHT)+unit(velocity/mapScale)*p(P_ALIGNMENT_WEIGHT)+unit(separation)*p(P_REPULSION_WEIGHT);
  // Binary-tree links: 1/2 follow 0, 3/4 follow 1. Root 0 has no parent.
  if (id >= u32(p(P_SWARM_COUNT)) && p(P_SWARM_ENABLED)>0.0 && p(P_SWARM_WEIGHT)>0.0) {
    let roots=u32(p(P_SWARM_COUNT));
    let parent = (((id/roots-1u)>>1u)*roots)|(id&(roots-1u));
    desired += unit(difference(b.position, stateIn.values[parent].position)/mapScale)*p(P_SWARM_WEIGHT);
  }
  if (p(P_FLEE_ENABLED)>0.0&&p(P_FLEE_WEIGHT)>0.0) {
    let inverseForward = 1.0/p(P_FLEE_RADIUS);
    let inverseSide = 1.0/p(P_FLEE_SIDE_RADIUS);
    for (var i=0u; i<cfg.counts.w; i++) {
      let predator = predators.values[i*2u];
      let centre = predators.values[i*2u+1u].xy;
      let side = vec2(-predator.w, predator.z);
      let d = difference(centre, b.position);
      let longitudinal = dot(d, predator.zw)*inverseForward;
      let lateral = dot(d, side)*inverseSide;
      let squared = longitudinal*longitudinal+lateral*lateral;
      if (squared<1.0) {
        var away = side;
        if (squared>=1e-8) {
          let normal = predator.zw*(longitudinal*inverseForward)+side*(lateral*inverseSide);
          away = normal*((1.0-sqrt(squared))*inverseSqrt(dot(normal, normal)));
        }
        desired += away*p(P_FLEE_WEIGHT);
      }
    }
  }
  if (p(P_WIND_ENABLED)>0.0&&p(P_WIND_WEIGHT)>0.0) {
    desired+=windAt(b.position);
  }
  if (dot(desired, desired)<1e-10) {
    desired = unit(b.velocity);
  }
  let old = unit(b.velocity);
  let desiredDirection = unit(desired);
  let cosine = clamp(dot(old, desiredDirection), -1.0, 1.0);
  // Shoal angle parameters are packed as cosines by writeConfig.
  if (p(P_SHOAL_ENABLED)==0.0) {
    b.boost = 0;
    b.cooldown = 0;
    b.armed = 1u;
  }
  else {
    b.boost = max(0.0, min(b.boost, p(P_SHOAL_DURATION))-cfg.data.y);
    b.cooldown = max(0.0, b.cooldown-cfg.data.y);
    if (cosine>=p(P_SHOAL_REARM)&&b.cooldown==0.0) {
      b.armed = 1u;
    }
    if (b.armed==1u&&b.cooldown==0.0&&cosine<p(P_SHOAL_THRESHOLD)) {
      b.boost = p(P_SHOAL_DURATION);
      b.cooldown = p(P_SHOAL_DURATION)+p(P_SHOAL_COOLDOWN);
      b.armed = 0u;
    }
  }
  let turnCos = select(cfg.scale.y, cfg.scale.w, b.boost>0.0);
  let turnSin = select(cfg.scale.z, cfg.data.z, b.boost>0.0);
  var direction = desiredDirection;
  if (cosine<turnCos) {
    let sign = select(-1.0, 1.0, old.x*desiredDirection.y-old.y*desiredDirection.x>=0.0);
    let sn = turnSin*sign;
    direction = vec2(old.x*turnCos-old.y*sn, old.x*sn+old.y*turnCos);
  }
  let speed = p(P_SPEED)*select(1.0, p(P_SHOAL_SPEED), b.boost>0.0);
  b.velocity = direction*speed;
  b.padding = boidColour(b.velocity, b.boost);
  b.position = wrap(b.position+b.velocity*cfg.data.y);
  stateOut.values[id] = b;
}
