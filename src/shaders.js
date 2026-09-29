// GLSL ES 1.00. three.js prepends precision and the standard uniforms.

const HASH = `
float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
`;

/* ------------------------------------------------------------------ */
/* character: depth-displaced plane                                     */
/* ------------------------------------------------------------------ */

export const charVert = `
uniform sampler2D uDepth;
uniform float uDisp;
varying vec2 vUv;
void main(){
  vUv = uv;
  float d = texture2D(uDepth, uv).r;
  vec3 p = position + vec3(0.0, 0.0, d * uDisp);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

export const charFrag = `
uniform sampler2D uMap;
uniform float uTime;
uniform float uGlitch;
#ifdef HAS_FACE
uniform sampler2D uMouth;
uniform sampler2D uEyes;
uniform float uSpeak;
uniform float uEye;
#endif
varying vec2 vUv;
${HASH}
void main(){
  vec2 uv = vUv;
  float amt = uGlitch;
  float m = 0.0;

  #ifdef HAS_FACE
    m = texture2D(uMouth, vUv).r;
    // the jaw drops: pull the masked region downward with the voice envelope
    uv.y += m * uSpeak * 0.022;
    amt += m * uSpeak * 2.4;
  #endif

  // block scramble, concentrated wherever amt is high
  float t = floor(uTime * 18.0);
  vec2 bc = floor(uv * vec2(46.0, 46.0));
  float r = hash21(bc + t);
  if (r > 1.0 - amt * 0.17) {
    uv += (vec2(hash21(bc + t + 2.0), hash21(bc + t + 7.0)) - 0.5)
          * vec2(0.052, 0.026) * (0.45 + amt);
  }

  vec4 c = texture2D(uMap, uv);
  if (c.a < 0.35) discard;

  #ifdef HAS_FACE
    float e = texture2D(uEyes, vUv).r * uEye;
    c.rgb = mix(c.rgb, vec3(0.15, 0.83, 0.88), e * 0.6);
    c.rgb *= 1.0 - m * uSpeak * 0.42;          // the open mouth reads as a void
  #endif

  gl_FragColor = vec4(c.rgb, 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* notebook page: curl about the spine at x = 0                         */
/* ------------------------------------------------------------------ */

export const pageVert = `
uniform float uTurn;      // 0 = flat right, 1 = flat left
uniform float uSide;      // +1 right page, -1 left page
uniform float uCurl;      // 0 = rigid, 1 = the free edge leads, as when pulled
varying vec2 vUv;
varying float vBend;
const float PI = 3.14159265;
void main(){
  vUv = uv;
  vec3 p = position;
  float k = clamp(p.x, 0.0, 1.0);
  float lift = sin(uTurn * PI);
  float a = (uTurn + uCurl * lift * (k - 0.35) * 0.22) * PI * uSide;
  float c = cos(a), s = sin(a);
  vec3 q = vec3(p.x * c, p.y, p.x * s);   // +z lifts the page toward the viewer
  float bend = sin(k * PI * 0.5) * lift * (0.16 + uCurl * 0.05);
  q.z += bend;
  // the corner under the hand lifts a little further than the rest
  q.z += uCurl * lift * k * k * max(0.0, -p.y) * 0.06;
  vBend = bend;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
}
`;

export const pageFrag = `
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uAlpha;
varying vec2 vUv;
varying float vBend;
void main(){
  vec2 uv = vUv;
  vec4 c;
  if (gl_FrontFacing) {
    c = texture2D(uFront, uv);
  } else {
    c = texture2D(uBack, vec2(1.0 - uv.x, uv.y));
  }
  // paper shades as it lifts off the spine
  c.rgb *= 1.0 - clamp(vBend, 0.0, 1.0) * 0.7;
  gl_FragColor = vec4(c.rgb, c.a * uAlpha);
}
`;

/* ------------------------------------------------------------------ */
/* flat textured quad, used for the dialogue panels                     */
/* ------------------------------------------------------------------ */

export const uiVert = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const uiFrag = `
uniform sampler2D uMap;
uniform float uReveal;   // 0..1 wipe-in
uniform float uTime;
uniform float uHover;
varying vec2 vUv;
${HASH}
void main(){
  vec2 uv = vUv;
  float t = floor(uTime * 22.0);

  // the panel tears itself into existence
  float edge = 1.0 - uReveal;
  float row = floor(uv.y * 22.0);
  float rr = hash21(vec2(row, t));
  if (rr < edge * 1.15) discard;
  uv.x += (hash21(vec2(row, t + 3.0)) - 0.5) * edge * 0.22;

  vec4 c = texture2D(uMap, uv);
  if (c.a < 0.02) discard;
  c.rgb = mix(c.rgb, vec3(0.80, 0.95, 0.06), uHover * 0.22);
  gl_FragColor = vec4(c.rgb, c.a);
}
`;

/* ------------------------------------------------------------------ */
/* composite: pixel grade, palette quantise, glitch, eyelids            */
/* ------------------------------------------------------------------ */

export const compVert = `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const compFrag = `
uniform sampler2D uUI;
uniform sampler2D uMind;
uniform vec2  uMindRes;
uniform vec3  uMindPal[16];
uniform float uTime;
uniform float uGlitch;
uniform float uLid;
uniform float uFocus;       // blur while the eyes are still opening
uniform float uStitch;      // how strongly every pixel reads as an X
uniform float uDim;         // darkens the world while a book is open
varying vec2 vUv;
${HASH}

float bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a){ return bayer2(a * 0.5) * 0.25 + bayer2(a); }

float lidMask(vec2 uv, float l){
  if (l <= 0.001) return 1.0;
  float curve = 0.055 * sin(uv.x * 3.14159265);
  float topE = mix(-0.04, 0.5, l) + curve;
  float botE = mix( 1.04, 0.5, l) - curve;
  float a = smoothstep(topE, topE + 0.006, uv.y);
  float b = smoothstep(botE, botE - 0.006, uv.y);
  return a * b;
}

vec3 quantMind(vec3 c){
  float best = 1e9;
  vec3 o = c;
  for (int i = 0; i < 16; i++) {
    vec3 d = c - uMindPal[i];
    float m = dot(d, d);
    if (m < best) { best = m; o = uMindPal[i]; }
  }
  return o;
}

vec3 sampleMind(vec2 cuv, float ab){
  vec3 c;
  c.r = texture2D(uMind, cuv + vec2(ab, 0.0)).r;
  c.g = texture2D(uMind, cuv).g;
  c.b = texture2D(uMind, cuv - vec2(ab, 0.0)).b;
  return c;
}

// The world is rendered small, then each low-res pixel is sampled at its
// centre, dithered into a 16-colour palette and shaded with an X.
vec3 mindPass(vec2 uv){
  float t = floor(uTime * 9.0);
  float band = floor(uv.y * uMindRes.y / 4.0);
  float r = hash21(vec2(band, t));
  uv.x += step(0.988 - uGlitch * 0.05, r) * (hash21(vec2(band, t + 4.0)) - 0.5) * 0.035;
  vec2 mp = uv * uMindRes;
  vec2 cell = floor(mp), f = fract(mp);
  vec2 cuv = (cell + 0.5) / uMindRes;
  float ab = (1.0 + uGlitch * 2.0 + uFocus * 6.0) / uMindRes.x;
  vec3 c = sampleMind(cuv, ab);
  if (uFocus > 0.002) {
    float o = uFocus * 0.012;
    vec3 s = sampleMind(cuv + vec2(o, 0.0), ab) + sampleMind(cuv - vec2(o, 0.0), ab)
           + sampleMind(cuv + vec2(0.0, o), ab) + sampleMind(cuv - vec2(0.0, o), ab);
    c = mix(c, s * 0.25, clamp(uFocus, 0.0, 0.85));
  }
  c = quantMind(clamp(c + (bayer4(cell) - 0.5) * 0.085, 0.0, 1.0));
  float x = min(abs(f.x - f.y), abs(f.x + f.y - 1.0));
  float thread = smoothstep(0.36, 0.10, x);
  float lum = dot(c, vec3(0.3, 0.59, 0.11));
  float st = uStitch * smoothstep(0.035, 0.14, lum);
  c *= mix(1.0, mix(0.58, 1.10, thread), st);
  float scan = 0.955 + 0.045 * sin(uv.y * uMindRes.y * 3.14159265);
  c *= scan;
  vec2 v = uv - 0.5;
  c *= 1.0 - dot(v, v) * 0.5;
  return c;
}

void main(){
  vec3 col = mindPass(vUv) * (1.0 - uDim * 0.62);
  // the open book, drawn at full resolution so its text stays sharp
  vec4 ui = texture2D(uUI, vUv);
  col = col * (1.0 - clamp(ui.a, 0.0, 1.0)) + ui.rgb;
  col *= lidMask(vUv, uLid);
  gl_FragColor = vec4(col, 1.0);
}
`;
