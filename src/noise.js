// Small deterministic 1D value noise. Enough for organic idle motion,
// far cheaper and more controllable than a full simplex implementation.

function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

function smooth(t) { return t * t * (3 - 2 * t); }

export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(i + seed * 31.7);
  const b = hash(i + 1 + seed * 31.7);
  return (a + (b - a) * smooth(f)) * 2 - 1;   // -1..1
}

// Two octaves reads as "alive" rather than "oscillating".
export function fbm1(x, seed = 0) {
  return noise1(x, seed) * 0.68 + noise1(x * 2.13 + 11.3, seed + 5) * 0.32;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// Frame-rate independent exponential approach.
export function approach(cur, target, lambda, dt) {
  return lerp(cur, target, 1 - Math.exp(-lambda * dt));
}
