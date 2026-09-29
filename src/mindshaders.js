// Shaders for the inside of the mind. GLSL ES 1.00.
// Every material does its own fog toward the horizon colour, so the far
// field dissolves the same way whether it is a stitch, a trace or the sky.

export const HASH = `
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

const FOG = `
uniform vec3 uFog;
uniform float uFogNear;
uniform float uFogFar;
vec3 fogged(vec3 c, float d){ return mix(c, uFog, smoothstep(uFogNear, uFogFar, d)); }
`;

export const basicVert = `
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
void main(){
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/* --- cross-stitch cells: tree, stars, anything built from X's --------- */

export const stitchVert = `
attribute float aPhase;
attribute float aOrder;
uniform float uGrow;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vW;
varying float vLed;
void main(){
  float g = smoothstep(aOrder, aOrder + 0.025, uGrow);
  vec3 p = position * g;
  #ifdef USE_INSTANCING
    mat4 m = modelMatrix * instanceMatrix;
  #else
    mat4 m = modelMatrix;
  #endif
  vec4 w = m * vec4(p, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(m) * normal);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #else
    vCol = vec3(1.0);
  #endif
  vLed = aPhase;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const stitchFrag = `
uniform float uTime;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vW;
varying float vLed;
${FOG}
void main(){
  float l = 0.80 + 0.30 * max(0.0, dot(vN, normalize(vec3(0.35, 0.8, 0.5))));
  vec3 c = vCol * l;
  if (vLed > 0.0) {
    float p = pow(0.5 + 0.5 * sin(uTime * 2.3 + vLed * 37.0), 5.0);
    c = mix(c, min(vec3(1.0), c * 1.9 + 0.12), p);
  }
  gl_FragColor = vec4(fogged(c, distance(vW, cameraPosition)), 1.0);
}
`;

/* --- sky --------------------------------------------------------------- */

export const skyVert = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

export const skyFrag = `
uniform float uTime;
uniform vec3 uFog;
varying vec3 vDir;
${HASH}
void main(){
  float h = clamp(vDir.y, -0.2, 1.0);
  vec3 zen = vec3(0.018, 0.016, 0.040);
  vec3 c = mix(uFog, zen, smoothstep(0.0, 0.55, h));
  // stars on a grid in direction space, so they do not swim
  vec2 g = vec2(atan(vDir.z, vDir.x) * 90.0, vDir.y * 90.0);
  vec2 gi = floor(g);
  float r = hash21(gi);
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + r * 3.0) + r * 40.0);
  float star = step(0.985, r) * smoothstep(0.42, 0.05, length(fract(g) - 0.5)) * tw;
  c += star * mix(vec3(0.9, 0.85, 0.7), vec3(0.4, 0.9, 1.0), hash21(gi + 3.0)) * smoothstep(0.02, 0.2, h);
  // a faint band of rhombi around the horizon, like the hem of a sleeve
  float band = smoothstep(0.035, 0.0, abs(h - 0.09));
  float a = atan(vDir.z, vDir.x) * 36.0;
  float m = abs(fract(a) - 0.5) * 2.0 + abs((h - 0.09) / 0.035);
  c += band * step(abs(m - 0.8), 0.18) * vec3(0.30, 0.03, 0.08);
  gl_FragColor = vec4(c, 1.0);
}
`;

/* --- ground: dark linen, circuit traces, embroidered rings, footsteps -- */

export const groundFrag = `
uniform float uTime;
uniform vec4 uTrail[16];   // x, z, age 0..1, hue
uniform vec4 uRings[6];    // x, z, radius, colour index
varying vec2 vUv;
varying vec3 vW;
${FOG}
${HASH}

vec3 folk(float i){
  if (i < 0.5) return vec3(0.78, 0.06, 0.18);   // poppy red
  if (i < 1.5) return vec3(0.15, 0.83, 0.88);   // cyan
  if (i < 2.5) return vec3(0.92, 0.20, 0.74);   // magenta
  if (i < 3.5) return vec3(0.91, 0.65, 0.24);   // gold
  if (i < 4.5) return vec3(0.80, 0.95, 0.06);   // acid
  return vec3(0.49, 0.29, 0.85);                // violet
}

void main(){
  vec2 p = vW.xz;
  vec3 c = vec3(0.050, 0.043, 0.074);
  // linen weave
  vec2 wv = fract(p * 5.0);
  c += 0.010 * (step(0.5, wv.x) + step(0.5, wv.y));

  // circuit board: one trace decision per cell
  vec2 cs = p / 2.4;
  vec2 ci = floor(cs), cf = fract(cs);
  float r = hash21(ci);
  float w = 0.04;
  float line = 0.0, along = 0.0;
  if (r < 0.28) { line = step(abs(cf.y - 0.5), w); along = cs.x; }
  else if (r < 0.52) { line = step(abs(cf.x - 0.5), w); along = cs.y; }
  else if (r < 0.66) {
    line = max(step(abs(cf.y - 0.5), w) * step(cf.x, 0.5 + w), step(abs(cf.x - 0.5), w) * step(0.5 - w, cf.y));
    along = cs.x + cs.y;
  }
  float pad = (step(0.52, r) * step(r, 0.66) + step(0.93, r)) * smoothstep(0.13, 0.08, length(cf - 0.5));
  float pulse = smoothstep(0.93, 1.0, fract(along * 0.22 - uTime * 0.30 + r * 7.0));
  float near = 1.0 - smoothstep(25.0, 70.0, length(p));
  c = mix(c, vec3(0.06, 0.17, 0.14) + pulse * vec3(0.60, 0.80, 0.05), line * (0.45 + 0.4 * near));
  c = mix(c, vec3(0.55, 0.40, 0.16), pad * 0.55);

  // embroidered rings around each place: a rhombus chain on the stitch grid
  for (int i = 0; i < 6; i++) {
    vec2 d = p - uRings[i].xy;
    float rr = length(d);
    float band = rr - uRings[i].z;
    if (abs(band) < 1.0) {
      float s = atan(d.y, d.x) * uRings[i].z;
      vec2 q = floor(vec2(s, band) / 0.32) + 0.5;
      float m = abs(mod(q.x, 6.0) - 3.0) + abs(q.y);
      float edge = step(abs(m - 2.5), 0.51);
      float heart = step(m, 0.6);
      vec3 col = folk(uRings[i].w);
      c = mix(c, col * 0.85, edge * 0.9);
      c = mix(c, vec3(0.91, 0.65, 0.24), heart * 0.8);
    }
    // soft glow under the place itself
    c += folk(uRings[i].w) * 0.05 * smoothstep(uRings[i].z, 0.0, rr);
  }

  // footsteps: every step you take leaves a stitched rhombus that fades
  for (int i = 0; i < 16; i++) {
    vec4 t = uTrail[i];
    if (t.z < 1.0) {
      vec2 d = p - t.xy;
      float m = abs(d.x) + abs(d.y);
      float ring = step(abs(m - 0.30 - t.z * 0.35), 0.05);
      c = mix(c, folk(t.w), ring * (1.0 - t.z));
    }
  }

  gl_FragColor = vec4(fogged(c, distance(vW, cameraPosition)), 1.0);
}
`;

/* --- a circuit trace that is also a line of running stitch ------------ */

export const traceVert = `
attribute float aS;
varying float vS;
varying vec2 vUv;
varying vec3 vW;
void main(){
  vS = aS; vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const traceFrag = `
uniform float uTime;
uniform vec3 uCol;
varying float vS;
varying vec2 vUv;
varying vec3 vW;
${FOG}
void main(){
  float across = abs(vUv.y - 0.5) * 2.0;
  vec3 c = vec3(0.05, 0.045, 0.07);
  // twin copper rails
  c = mix(c, vec3(0.10, 0.28, 0.20), step(0.72, across) * step(across, 0.92));
  // running stitch down the middle
  float dash = step(fract(vS / 0.55), 0.6) * step(across, 0.34);
  c = mix(c, vec3(0.78, 0.06, 0.18), dash);
  // current flowing out of the tree
  float p = fract(vS / 14.0 - uTime * 0.35);
  float head = smoothstep(0.90, 1.0, p);
  c = mix(c, uCol, head * (1.0 - across * 0.6));
  gl_FragColor = vec4(fogged(c, distance(vW, cameraPosition)), 1.0);
}
`;

/* --- the code monoliths ------------------------------------------------ */

export const codeFrag = `
uniform sampler2D uMap;
uniform float uTime;
uniform float uSpeed;
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
${FOG}
void main(){
  vec2 uv = vUv;
  uv.y = fract(uv.y * 0.62 + uTime * uSpeed);
  vec3 c = texture2D(uMap, uv).rgb;
  // scanning line
  float scan = smoothstep(0.02, 0.0, abs(fract(vUv.y - uTime * 0.08) - 0.5));
  c += scan * vec3(0.1, 0.25, 0.05);
  gl_FragColor = vec4(fogged(c, distance(vW, cameraPosition)), 1.0);
}
`;

/* --- a CPPN-flavoured painting that only knows where it is ------------- */

export const cppnFrag = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vW;
${FOG}
float th(float x){ float e = exp(2.0 * clamp(x, -8.0, 8.0)); return (e - 1.0) / (e + 1.0); }
void main(){
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  float t = uTime * 0.25;
  float a = sin(p.x * 3.1 + t) * cos(p.y * 2.3 - t * 0.8);
  float b = exp(-r * r * 2.2) * sin(r * 9.0 - t * 2.0 + a * 2.0);
  float g = th(a * 1.6 + b * 2.4 + sin(p.x * p.y * 6.0 + t));
  vec3 c = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + g * 0.55 + r * 0.25 + t * 0.1));
  // an embroidered frame
  float fr = max(abs(p.x), abs(p.y));
  c = mix(c, vec3(0.78, 0.06, 0.18), step(0.9, fr));
  c = mix(c, vec3(0.91, 0.65, 0.24), step(0.955, fr));
  gl_FragColor = vec4(fogged(c, distance(vW, cameraPosition)), 1.0);
}
`;

/* --- a torus knot that keeps changing its mind about its colours -------- */

export const bandFrag = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vW;
varying vec3 vN;
${FOG}
void main(){
  float b = floor(vUv.x * 28.0 + uTime * 1.5);
  float k = mod(b, 5.0);
  vec3 c = k < 1.0 ? vec3(0.78, 0.06, 0.18) : k < 2.0 ? vec3(0.91, 0.65, 0.24) :
           k < 3.0 ? vec3(0.15, 0.83, 0.88) : k < 4.0 ? vec3(0.92, 0.20, 0.74) : vec3(0.06, 0.05, 0.08);
  float l = 0.6 + 0.4 * max(0.0, dot(vN, normalize(vec3(0.3, 0.9, 0.4))));
  gl_FragColor = vec4(fogged(c * l, distance(vW, cameraPosition)), 1.0);
}
`;

/* --- the flight field: a potential field drawn as contour lines -------- */

export const fieldFrag = `
uniform float uTime;
uniform vec3 uObs[7];
uniform vec2 uGoal;
uniform float uRadius;
varying vec2 vUv;
varying vec3 vW;
${FOG}
void main(){
  vec2 p = (vUv - 0.5) * 2.0 * uRadius;
  float f = length(p - uGoal) * 0.07;
  for (int i = 0; i < 7; i++) {
    vec2 d = p - uObs[i].xy;
    f += exp(-dot(d, d) / (uObs[i].z * uObs[i].z * 1.8)) * 1.3;
  }
  float k = fract(f * 5.0 - uTime * 0.15);
  float line = smoothstep(0.09, 0.0, min(k, 1.0 - k));
  vec3 c = vec3(0.05, 0.045, 0.075);
  c = mix(c, mix(vec3(0.80, 0.95, 0.06), vec3(0.92, 0.20, 0.74), clamp(f - 0.6, 0.0, 1.0)), line * 0.75);
  float edge = smoothstep(uRadius, uRadius * 0.9, length(p));
  gl_FragColor = vec4(fogged(c, distance(vW, cameraPosition)), edge);
}
`;

/* --- a glowing beam over each place, so you can find it from far away -- */

export const beamFrag = `
uniform vec3 uCol;
uniform float uTime;
varying vec2 vUv;
void main(){
  float a = (1.0 - vUv.y) * 0.55 * (0.8 + 0.2 * sin(uTime * 2.0 + vUv.y * 20.0));
  gl_FragColor = vec4(uCol * a, a);
}
`;

/* --- the loom's woven panel -------------------------------------------- */

export const loomFrag = `
uniform sampler2D uMap;
uniform vec2 uCells;
varying vec2 vUv;
varying vec3 vW;
${FOG}
void main(){
  vec2 q = vUv * uCells;
  vec2 f = fract(q);
  vec3 c = texture2D(uMap, (floor(q) + 0.5) / uCells).rgb;
  // every cell is an X of thread on linen
  float x = min(abs(f.x - f.y), abs(f.x + f.y - 1.0));
  float th = smoothstep(0.30, 0.12, x);
  vec3 linen = vec3(0.86, 0.81, 0.70);
  float filled = step(0.01, 1.0 - step(0.99, dot(c, vec3(0.333))));
  c = mix(linen * (0.92 + 0.08 * step(0.5, fract(q.x * 2.0 + q.y * 2.0))), c, th * filled);
  gl_FragColor = vec4(fogged(c, distance(vW, cameraPosition)), 1.0);
}
`;
