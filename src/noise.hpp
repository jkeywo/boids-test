#pragma once
#include <cmath>
#include <cstdint>
namespace boids {
// Gradient noise on a 3D lattice with quintic interpolation. Independent seeds
// decorrelate the vector components; no permutation-table asset is required.
struct Perlin3D {
  static uint32_t hash(int x, int y, int z, uint32_t seed) {
    uint32_t h = uint32_t(x) * 0x8da6b343u ^ uint32_t(y) * 0xd8163841u ^
                 uint32_t(z) * 0xcb1ab31fu ^ seed;
    h ^= h >> 16;
    h *= 0x7feb352du;
    h ^= h >> 15;
    return h;
  }
  static float fade(float t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  static float gradient(uint32_t h, float x, float y, float z) {
    // Twelve edge directions of a cube, chosen by a lattice hash.
    switch (h % 12) {
    case 0:
      return x + y;
    case 1:
      return -x + y;
    case 2:
      return x - y;
    case 3:
      return -x - y;
    case 4:
      return x + z;
    case 5:
      return -x + z;
    case 6:
      return x - z;
    case 7:
      return -x - z;
    case 8:
      return y + z;
    case 9:
      return -y + z;
    case 10:
      return y - z;
    default:
      return -y - z;
    }
  }
  static float sample(float x, float y, float z, uint32_t seed = 0x1234abcdu) {
    int ix = int(std::floor(x)), iy = int(std::floor(y)),
        iz = int(std::floor(z));
    float fx = x - ix, fy = y - iy, fz = z - iz;
    float sum = 0;
    const float u = fade(fx), v = fade(fy), w = fade(fz);
    for (int dz = 0; dz < 2; ++dz)
      for (int dy = 0; dy < 2; ++dy)
        for (int dx = 0; dx < 2; ++dx) {
          float weight = (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
          sum += gradient(hash(ix + dx, iy + dy, iz + dz, seed), fx - dx,
                          fy - dy, fz - dz) *
                 weight;
        }
    return sum;
  }
};
} // namespace boids
