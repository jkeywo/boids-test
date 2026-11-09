#pragma once
// Four-wide neighbour arithmetic, with the same scalar fallback on other CPUs.
#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
namespace boids::simd {
using F = v128_t;
inline F set(float a, float b, float c, float d) {
  return wasm_f32x4_make(a, b, c, d);
}
inline F load(const float *x) { return wasm_v128_load(x); }
inline void transpose(F &a, F &b, F &c, F &d) {
  F ab0 = wasm_i32x4_shuffle(a, b, 0, 4, 1, 5),
    ab1 = wasm_i32x4_shuffle(a, b, 2, 6, 3, 7),
    cd0 = wasm_i32x4_shuffle(c, d, 0, 4, 1, 5),
    cd1 = wasm_i32x4_shuffle(c, d, 2, 6, 3, 7);
  a = wasm_i32x4_shuffle(ab0, cd0, 0, 1, 4, 5);
  b = wasm_i32x4_shuffle(ab0, cd0, 2, 3, 6, 7);
  c = wasm_i32x4_shuffle(ab1, cd1, 0, 1, 4, 5);
  d = wasm_i32x4_shuffle(ab1, cd1, 2, 3, 6, 7);
}
inline F splat(float x) { return wasm_f32x4_splat(x); }
inline F add(F a, F b) { return wasm_f32x4_add(a, b); }
inline F sub(F a, F b) { return wasm_f32x4_sub(a, b); }
inline F mul(F a, F b) { return wasm_f32x4_mul(a, b); }
inline F div(F a, F b) { return wasm_f32x4_div(a, b); }
inline F ne(F a, F b) { return wasm_f32x4_ne(a, b); }
inline F lt(F a, F b) { return wasm_f32x4_lt(a, b); }
inline F le(F a, F b) { return wasm_f32x4_le(a, b); }
inline F mask(F a, F b) { return wasm_v128_and(a, b); }
inline F choose(F test, F yes, F no) {
  return wasm_v128_bitselect(yes, no, test);
}
inline float sum(F a) {
  float v[4];
  wasm_v128_store(v, a);
  return (v[0] + v[1]) + (v[2] + v[3]);
}
} // namespace boids::simd
#define BOIDS_SIMD 1
#elif defined(__SSE2__) || defined(_M_X64)
#include <emmintrin.h>
namespace boids::simd {
using F = __m128;
inline F set(float a, float b, float c, float d) {
  return _mm_setr_ps(a, b, c, d);
}
inline F load(const float *x) { return _mm_loadu_ps(x); }
inline void transpose(F &a, F &b, F &c, F &d) { _MM_TRANSPOSE4_PS(a, b, c, d); }
inline F splat(float x) { return _mm_set1_ps(x); }
inline F add(F a, F b) { return _mm_add_ps(a, b); }
inline F sub(F a, F b) { return _mm_sub_ps(a, b); }
inline F mul(F a, F b) { return _mm_mul_ps(a, b); }
inline F div(F a, F b) { return _mm_div_ps(a, b); }
inline F ne(F a, F b) { return _mm_cmpneq_ps(a, b); }
inline F lt(F a, F b) { return _mm_cmplt_ps(a, b); }
inline F le(F a, F b) { return _mm_cmple_ps(a, b); }
inline F mask(F a, F b) { return _mm_and_ps(a, b); }
inline F choose(F test, F yes, F no) {
  return _mm_or_ps(_mm_and_ps(test, yes), _mm_andnot_ps(test, no));
}
inline float sum(F a) {
  float v[4];
  _mm_storeu_ps(v, a);
  return (v[0] + v[1]) + (v[2] + v[3]);
}
} // namespace boids::simd
#define BOIDS_SIMD 1
#endif
