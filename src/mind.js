import * as THREE from 'three';
import { approach, clamp, fbm1 } from './noise.js';
import {
  basicVert, stitchVert, stitchFrag, skyVert, skyFrag, groundFrag, traceVert, traceFrag,
  codeFrag, cppnFrag, bandFrag, fieldFrag, beamFrag, loomFrag
} from './mindshaders.js';

/*
  The inside of her mind: a night landscape where circuit traces are sewn
  like thread. Everything is generated here; there are no image assets.
  It is rendered small and the composite pass turns every pixel into a
  cross-stitch, which is where the look comes from.
*/

const FOG = new THREE.Color(0.105, 0.070, 0.150);
const C = {
  red: 0xc8102e, deep: 0x6e0b1d, black: 0x17121c, linen: 0xefe6d2, gold: 0xe8a63c,
  acid: 0xcbf30f, cyan: 0x26d4e1, mag: 0xeb32bc, cobalt: 0x2a5bd7, green: 0x1f7a4a,
  orange: 0xff7a3d, violet: 0x7d4bd8
};
const LM_COLOR = { tree: C.red, code: C.acid, music: C.cyan, shape: C.mag, flight: C.gold, loom: C.violet };
const LM_RING = { tree: 0, code: 4, music: 1, shape: 2, flight: 3, loom: 5 };
const EYE = 1.7;
const BOUND = 78;

const common = () => ({
  uTime: { value: 0 },
  uFog: { value: FOG },
  uFogNear: { value: 38 },
  uFogFar: { value: 150 }
});

function shader(vert, frag, extra = {}, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...common(), ...extra },
    vertexShader: vert, fragmentShader: frag, ...opts
  });
}

/* ------------------------------------------------------------------ */
/* the stitch: two crossed bars                                         */
/* ------------------------------------------------------------------ */

function stitchGeometry(size = 1) {
  const parts = [];
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    const g = new THREE.BoxGeometry(size * 1.3, size * 0.55, size * 0.3).toNonIndexed();
    g.rotateZ(a);
    parts.push(g);
  }
  const pos = [], nor = [];
  parts.forEach(g => { pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

// cells: [{ x, y, color, led, order }], laid out on a plane, one instance each
function stitchPanel(cells, cell, uniforms) {
  const geo = stitchGeometry(cell * 0.7);
  const n = cells.length;
  const phase = new Float32Array(n), order = new Float32Array(n);
  cells.forEach((c, i) => { phase[i] = c.led ? 0.1 + Math.random() : 0; order[i] = c.order ?? 0; });
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute('aOrder', new THREE.InstancedBufferAttribute(order, 1));
  const mat = shader(stitchVert, stitchFrag, uniforms);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  cells.forEach((c, i) => {
    m.makeTranslation(c.x * cell, c.y * cell, c.z || 0);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, col.set(c.color).multiplyScalar(1.15));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* motifs                                                              */
/* ------------------------------------------------------------------ */

// Pomul vieții: pot, trunk, symmetric branches ending in leaves, a star on top.
function treeCells() {
  const map = new Map();
  const put = (i, j, color, led = false) => map.set(`${i},${j}`, { x: i, y: j, color, led });
  const sym = (i, j, color, led) => { put(i, j, color, led); put(-i, j, color, led); };

  // the pot
  for (let j = 0; j <= 6; j++) {
    const half = 3 + Math.round(j * 0.9);
    for (let i = 0; i <= half; i++) {
      const edge = i === half || j === 0 || j === 6;
      const diamond = Math.abs(i) + Math.abs(j - 3) === 2;
      sym(i, j, edge ? C.black : diamond ? C.gold : C.red);
    }
  }
  // trunk
  for (let j = 7; j <= 54; j++) { put(0, j, C.red); sym(1, j, C.black); }
  // branches
  for (let b = 0; b < 6; b++) {
    const r = 11 + b * 7, len = 13 - b * 2;
    for (let m = 1; m <= len; m++) {
      sym(m + 1, r + m, C.red);
      if (m % 3 === 0 && m < len) sym(m + 1, r + m - 2, C.mag, true);   // buds hang under
    }
    // a leaf: rhombus outline with a lit heart
    const cx = len + 3, cy = r + len + 2;
    for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
      const d = Math.abs(a) + Math.abs(c);
      if (d === 2) sym(cx + a, cy + c, C.black);
      else if (d === 1) sym(cx + a, cy + c, b % 2 ? C.green : C.gold);
      else if (d === 0) sym(cx + a, cy + c, C.acid, true);
    }
  }
  // crown: an eight-pointed star
  const sy = 60;
  for (let a = -6; a <= 6; a++) for (let c = -6; c <= 6; c++) {
    const d = Math.abs(a) + Math.abs(c), q = Math.max(Math.abs(a), Math.abs(c));
    if (d <= 6 || q <= 4) {
      const ring = Math.min(d, q + 2);
      const color = ring >= 5 ? C.red : ring >= 3 ? C.gold : ring >= 1 ? C.red : C.cyan;
      put(a, sy + c, color, ring === 0 || (d === 6 && q === 3));
    }
  }
  // two birds on the lowest branch
  [[0, 0], [1, 0], [2, 0], [1, 1], [-1, 1], [2, 1], [3, 2]].forEach(([a, c]) => sym(9 + a, 22 + c, C.cobalt));
  const cells = [...map.values()];
  const top = Math.max(...cells.map(c => c.y));
  cells.forEach(c => c.order = c.y / top * 0.85 + Math.random() * 0.12);
  return cells;
}

// Ochiul boului: the eight-pointed star rosette.
function starCells(R, palette) {
  const cells = [];
  for (let a = -R; a <= R; a++) for (let c = -R; c <= R; c++) {
    const d = Math.abs(a) + Math.abs(c), q = Math.max(Math.abs(a), Math.abs(c));
    if (d <= R || q <= Math.round(R * 0.68)) {
      const ring = Math.floor(Math.min(d, q + 2) / 2);
      cells.push({ x: a, y: c, color: palette[ring % palette.length], led: ring === 0 });
    }
  }
  return cells;
}

/* ------------------------------------------------------------------ */
/* code for the monoliths                                              */
/* ------------------------------------------------------------------ */

const CODE = [
  { title: 'zephyr / arbiter.py', lines: [
    'def field_force(p, obstacles, goal):',
    '    f = attract(goal - p)',
    '    for o in obstacles:',
    '        d = p - o.center',
    '        r = norm(d) - o.radius',
    '        f += k * gauss(r, sigma) * d / norm(d)',
    '    return f',
    '',
    'class PredictiveArbiter:',
    '    def select(self, s):',
    '        risk = self.forecast(s, horizon=12)',
    '        if risk.trapped > tau:',
    '            return Mode.ESCAPE   # PPO',
    '        if risk.clearance < c_min:',
    '            return Mode.INVERSE',
    '        return Mode.GAUSSIAN',
    '',
    '# success 0.514 -> 0.963',
    '# same controllers, new arbiter'
  ]},
  { title: 'daedalus / cppn.py', lines: [
    'def draw(poem):',
    '    words = embed(tokenize(poem))',
    '    genome = neat.evolve(',
    '        fitness=lambda g: fit(g, words),',
    '        generations=200)',
    '    net = CPPN(genome)',
    '    for x, y in grid(512, 512):',
    '        d = sqrt(x*x + y*y)',
    '        h, s, v, a = net(x, y, d, words.mean)',
    '        stroke(x, y, hsv(h, s, v), a)',
    '    return svg()',
    '',
    '# no image corpora',
    '# no borrowed art'
  ]},
  { title: 'tree_of_life.js', lines: [
    'const S = 12;',
    'function stitch(i, j, c) {',
    '  stroke(c); strokeWeight(3);',
    '  const x = width/2 + i*S;',
    '  const y = height - j*S;',
    '  line(x-4, y-4, x+4, y+4);',
    '  line(x+4, y-4, x-4, y+4);',
    '}',
    'function draw() {',
    "  background('#efe6d2');",
    '  for (let j = 1; j < 55; j++)',
    "    stitch(0, j, '#c8102e');",
    '  for (let b = 0; b < 6; b++) {',
    '    const r = 11 + 7*b;',
    '    for (let m = 1; m < 14-2*b; m++) {',
    "      stitch( m, r+m, '#c8102e');",
    "      stitch(-m, r+m, '#c8102e');",
    '    }',
    '  }',
    '}'
  ]},
  { title: 'stitch.frag', lines: [
    'vec2 cell = floor(uv * res);',
    'vec2 f = fract(uv * res);',
    'vec3 c = texture2D(scene,',
    '  (cell + 0.5) / res).rgb;',
    'c = quantise(c + dither(cell));',
    '',
    'float x = min(abs(f.x - f.y),',
    '          abs(f.x + f.y - 1.0));',
    'float thread = smoothstep(.34, .12, x);',
    'c *= mix(.62, 1.12, thread);',
    '',
    'gl_FragColor = vec4(c, 1.0);',
    '// each pixel drawn as an X'
  ]},
  { title: 'atlas / rank.py', lines: [
    'def score(pass_, frame):',
    '    t = triangle(pass_, frame.support)',
    '    v = vector(pass_, frame.pressure)',
    '    r = radius(pass_.target, frame.opps)',
    '    d = direction(pass_, frame.goal)',
    '    return -(a*t + b*v + c*r + e*d)',
    '',
    'ranked = sorted(options, key=score)',
    '',
    '# H@3 on Euro 2020 and Euro 2024',
    '# direction matters most'
  ]}
];

function codeCanvas(code) {
  const W = 512, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0a12';
  ctx.fillRect(0, 0, W, H);
  // stitched borders
  const X = (x, y, s, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
  };
  for (let y = 10; y < H; y += 14) {
    const k = Math.floor(y / 14) % 6;
    X(12, y, 5, k < 3 ? '#c8102e' : '#6e0b1d');
    X(W - 12, y, 5, k < 3 ? '#c8102e' : '#6e0b1d');
    if (Math.abs((k % 6) - 3) === 1) { X(26, y, 4, '#e8a63c'); X(W - 26, y, 4, '#e8a63c'); }
  }
  const font = 'ui-monospace, Menlo, Consolas, monospace';
  ctx.textBaseline = 'top';
  const KW = /\b(def|class|return|for|in|if|const|let|function|vec2|vec3|float)\b/g;
  const drawBlock = (y0) => {
    ctx.font = `bold 21px ${font}`;
    ctx.fillStyle = '#e8a63c';
    ctx.fillText(code.title, 46, y0);
    let y = y0 + 44;
    ctx.font = `17px ${font}`;
    for (const line of code.lines) {
      if (line.trim().startsWith('#') || line.trim().startsWith('//')) {
        ctx.fillStyle = '#8f8670'; ctx.fillText(line, 46, y);
      } else {
        // crude highlighting: keywords, then the rest
        let x = 46, last = 0;
        const parts = [];
        line.replace(KW, (m, _g, i) => { parts.push([line.slice(last, i), '#cbf30f']); parts.push([m, '#eb32bc']); last = i + m.length; });
        parts.push([line.slice(last), '#cbf30f']);
        for (const [t, col] of parts) {
          ctx.fillStyle = /'[^']*'/.test(t) ? '#26d4e1' : col;
          ctx.fillText(t, x, y); x += ctx.measureText(t).width;
        }
      }
      y += 25;
    }
    return y;
  };
  let y = 40;
  while (y < H - 60) y = drawBlock(y) + 60;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ------------------------------------------------------------------ */
/* the loom: rows woven by elementary cellular automata                 */
/* ------------------------------------------------------------------ */

class Loom {
  constructor(w = 65, h = 44) {
    this.w = w; this.h = h;
    this.data = new Uint8Array(w * h * 4).fill(255);
    this.tex = new THREE.DataTexture(this.data, w, h, THREE.RGBAFormat);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.row = new Uint8Array(w);
    this.rules = [90, 150, 105, 126, 18, 22];
    this.band = 0; this.rowsInBand = 0; this.acc = 0;
    this.palettes = [[C.red, C.black], [C.red, C.gold], [C.black, C.red], [C.cobalt, C.red], [C.green, C.gold], [C.violet, C.red]];
    this.seed();
    for (let i = 0; i < h; i++) this.step();
  }
  seed() { this.row.fill(0); this.row[this.w >> 1] = 1; }
  step() {
    const rule = this.rules[this.band % this.rules.length];
    const w = this.w, r = this.row, next = new Uint8Array(w);
    for (let i = 0; i < w; i++) {
      const k = (r[(i - 1 + w) % w] << 2) | (r[i] << 1) | r[(i + 1) % w];
      next[i] = (rule >> k) & 1;
    }
    this.row = next;
    if (++this.rowsInBand >= 16 || next.every(v => v === 0)) {
      this.band++; this.rowsInBand = 0; this.seed();
    }
    // scroll the cloth up one row and weave the new one in at the bottom
    this.data.copyWithin(w * 4, 0, w * (this.h - 1) * 4);
    const pal = this.palettes[this.band % this.palettes.length];
    const col = new THREE.Color();
    for (let i = 0; i < w; i++) {
      const o = i * 4;
      if (this.row[i]) {
        col.set(pal[(Math.abs(i - (w >> 1)) >> 2) % 2]);
        this.data[o] = col.r * 255; this.data[o + 1] = col.g * 255; this.data[o + 2] = col.b * 255;
      } else { this.data[o] = this.data[o + 1] = this.data[o + 2] = 255; }
      this.data[o + 3] = 255;
    }
    this.tex.needsUpdate = true;
  }
  update(dt) {
    this.acc += dt;
    while (this.acc > 0.32) { this.acc -= 0.32; this.step(); }
  }
}

/* ------------------------------------------------------------------ */

export class Mind {
  constructor(data, hud) {
    this.data = data;
    this.hud = hud;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(FOG, 38, 150);
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, 400);
    this.rt = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true
    });
    this.timed = [];                   // materials that need uTime
    this.updaters = [];                // per-frame callbacks
    this.solids = [];                  // [x, z, r] you cannot walk through
    this.hits = [];                    // pick targets for the places
    this.landmarks = data.landmarks;
    this.byId = Object.fromEntries(this.landmarks.map(l => [l.id, l]));
    this.visited = new Set();
    this.read = new Set();             // books opened
    this.locked = false;               // true while a book is open
    this.target = null;                // what E or a tap would act on
    this.onInteract = null;            // set by main: (kind, key) => {}
    this.guide = null;
    this.music = null;

    this.buildSky();
    this.buildGround();
    this.buildMountains();
    this.buildTraces();
    this.buildTree();
    this.buildCode();
    this.buildRing();
    this.buildShapes();
    this.buildFlight();
    this.buildLoom();
    this.buildStars();
    this.buildMarkers();
    this.buildMotes();
    this.buildBooks();

    // player
    this.pos = new THREE.Vector3(0, EYE, 31);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0.04;
    this.yawT = 0; this.pitchT = 0.04;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.drag = null;
    this.travel = null;
    this.walked = 0;
    this.lastStep = new THREE.Vector2(0, 31);
    this.trail = Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 1, 0));
    this.trailHead = 0;
    this.active = false;
    this.near = null;
    this.grow = 0;
    this.raycaster = new THREE.Raycaster();

    this.initHud();
  }

  timedMat(m) { this.timed.push(m); return m; }

  /* ---------------- world ---------------- */

  buildSky() {
    const m = this.timedMat(shader(skyVert, skyFrag, {}, { side: THREE.BackSide, depthWrite: false }));
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), m);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.scene.add(sky);
    this.sky = sky;
  }

  buildGround() {
    const rings = this.landmarks.map(l => new THREE.Vector4(l.x, l.z, l.r * 0.95, LM_RING[l.id] ?? 0));
    while (rings.length < 6) rings.push(new THREE.Vector4(9999, 9999, 1, 0));
    this.groundMat = this.timedMat(shader(basicVert, groundFrag, {
      uTrail: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 1, 0)) },
      uRings: { value: rings.slice(0, 6) }
    }));
    const g = new THREE.Mesh(new THREE.PlaneGeometry(420, 420, 1, 1), this.groundMat);
    g.rotation.x = -Math.PI / 2;
    this.scene.add(g);
  }

  // Munții: the mountain motif, a zigzag hem around the whole world
  buildMountains() {
    const R = 150, N = 72;
    const pos = [], lines = [], lines2 = [];
    for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2, am = (a0 + a1) / 2;
      const h = 18 + (Math.sin(i * 1.7) * 0.5 + 0.5) * 22 + (i % 3 === 0 ? 10 : 0);
      const p0 = [Math.cos(a0) * R, 0, Math.sin(a0) * R];
      const p1 = [Math.cos(a1) * R, 0, Math.sin(a1) * R];
      const pm = [Math.cos(am) * R, h, Math.sin(am) * R];
      pos.push(...p0, ...pm, ...p1);
      lines.push(...p0, ...pm, ...pm, ...p1);
      const s = 0.62;
      lines2.push(p0[0], h * (1 - s) * 0.5, p0[2], pm[0], h * s, pm[2], pm[0], h * s, pm[2], p1[0], h * (1 - s) * 0.5, p1[2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x120d1a, side: THREE.DoubleSide, fog: false })));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.scene.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x8a0f26, fog: false })));
    const lg2 = new THREE.BufferGeometry(); lg2.setAttribute('position', new THREE.Float32BufferAttribute(lines2, 3));
    this.scene.add(new THREE.LineSegments(lg2, new THREE.LineBasicMaterial({ color: 0x3a1f55, fog: false })));
  }

  // circuit traces from the roots of the tree out to every other place,
  // routed the way a board is routed: straight runs and 45 degree bends
  buildTraces() {
    const W = 0.55;
    this.landmarks.filter(l => l.id !== 'tree').forEach((l, k) => {
      const ang = Math.atan2(l.z, l.x);
      const start = new THREE.Vector2(Math.cos(ang) * 6.5, Math.sin(ang) * 6.5);
      const end = new THREE.Vector2(l.x - Math.cos(ang) * l.r * 0.9, l.z - Math.sin(ang) * l.r * 0.9);
      const dx = end.x - start.x, dz = end.y - start.y;
      const diag = Math.min(Math.abs(dx), Math.abs(dz));
      const pts = [start.clone()];
      const straightX = Math.abs(dx) > Math.abs(dz);
      const rest = (straightX ? Math.abs(dx) : Math.abs(dz)) - diag;
      const a = pts[0].clone();
      if (straightX) a.x += Math.sign(dx) * rest * 0.5; else a.y += Math.sign(dz) * rest * 0.5;
      const b = a.clone(); b.x += Math.sign(dx) * diag; b.y += Math.sign(dz) * diag;
      pts.push(a, b, end);
      // ribbon
      const pos = [], uv = [], sArr = [], idx = [];
      let s = 0, v = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i], p1 = pts[i + 1];
        const d = p1.clone().sub(p0); const len = d.length(); if (len < 1e-3) continue;
        const n = new THREE.Vector2(-d.y, d.x).normalize().multiplyScalar(W / 2);
        const e = d.clone().normalize().multiplyScalar(W * 0.5);        // overlap the joints
        const q0 = p0.clone().sub(i ? e : new THREE.Vector2()), q1 = p1.clone().add(e);
        pos.push(q0.x + n.x, 0.03, q0.y + n.y, q0.x - n.x, 0.03, q0.y - n.y, q1.x + n.x, 0.03, q1.y + n.y, q1.x - n.x, 0.03, q1.y - n.y);
        uv.push(0, 0, 0, 1, 1, 0, 1, 1);
        sArr.push(s, s, s + len, s + len);
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        v += 4; s += len;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('aS', new THREE.Float32BufferAttribute(sArr, 1));
      geo.setIndex(idx);
      const m = this.timedMat(shader(traceVert, traceFrag, { uCol: { value: new THREE.Color(LM_COLOR[l.id]) } }));
      m.polygonOffset = true; m.polygonOffsetFactor = -1;
      this.scene.add(new THREE.Mesh(geo, m));
      // solder pads at the bends
      [a, b].forEach(p => {
        const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 8), new THREE.MeshBasicMaterial({ color: C.gold }));
        pad.position.set(p.x, 0.05, p.y);
        this.scene.add(pad);
      });
    });
  }

  buildTree() {
    const cells = treeCells();
    this.treeUniforms = { uGrow: { value: 0 } };
    const cell = 0.42;
    const g = new THREE.Group();
    const a = stitchPanel(cells, cell, this.treeUniforms);
    const b = stitchPanel(cells, cell, this.treeUniforms);
    b.rotation.y = Math.PI / 2;
    [a, b].forEach(m => { this.timedMat(m.material); g.add(m); });
    b.material.uniforms = a.material.uniforms;
    g.position.set(0, cell * 0.5, 0);
    this.scene.add(g);
    this.tree = g;
    this.solids.push([0, 0, 2.6]);
    this.hitbox('tree', 0, 8, 0, 6);
  }

  buildCode() {
    const L = this.byId.code;
    const g = new THREE.Group();
    g.position.set(L.x, 0, L.z);
    CODE.forEach((code, i) => {
      const a = (i - (CODE.length - 1) / 2) * 0.42;
      const r = 6.5;
      const tex = codeCanvas(code);
      const face = this.timedMat(shader(basicVert, codeFrag, { uMap: { value: tex }, uSpeed: { value: 0.012 + i * 0.004 } }));
      const side = new THREE.MeshBasicMaterial({ color: 0x1a1426 });
      const h = 6 + (i % 2) * 1.6;
      const mono = new THREE.Mesh(new THREE.BoxGeometry(2.8, h, 0.4), [side, side, side, side, face, face]);
      // an arc on the far side, all facing the way you arrive from the tree
      mono.position.set(Math.sin(a) * r, h / 2, -Math.cos(a) * r);
      mono.rotation.y = -a;
      g.add(mono);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.14, 0.6), new THREE.MeshBasicMaterial({ color: C.red }));
      cap.position.set(mono.position.x, h + 0.07, mono.position.z); cap.rotation.y = -a;
      g.add(cap);
      this.solids.push([L.x + mono.position.x, L.z + mono.position.z, 1.6]);
    });
    // a slow orbit of brackets and semicolons
    const glyphs = ['{', '}', ';', '<', '/', '>', '=', '(', ')', '[', ']', '*'];
    const sprites = glyphs.map((ch, i) => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d');
      x.font = 'bold 48px ui-monospace, Menlo, monospace'; x.fillStyle = i % 3 ? '#cbf30f' : '#26d4e1';
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ch, 32, 34);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
      s.scale.setScalar(0.9);
      g.add(s);
      return { s, a: i / glyphs.length * Math.PI * 2, r: 3 + (i % 3), y: 2 + (i % 4) * 1.4 };
    });
    this.updaters.push((dt, t) => sprites.forEach((o, i) => {
      const a = o.a + t * (0.12 + (i % 3) * 0.04);
      o.s.position.set(Math.cos(a) * o.r, o.y + Math.sin(t * 0.8 + i) * 0.3, Math.sin(a) * o.r);
    }));
    this.scene.add(g);
    this.hitbox('code', L.x, 4, L.z, 7);
  }

  buildRing() {
    const L = this.byId.music;
    const g = new THREE.Group();
    g.position.set(L.x, 0, L.z);
    const N = 16, R = 6.5;
    const cols = [C.red, C.gold, C.cyan, C.mag, C.acid, C.orange, C.violet, C.cobalt];
    this.pillars = [];
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      const mat = new THREE.MeshBasicMaterial({ color: cols[i % cols.length] });
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.62, 1, 0.62), mat);
      p.position.set(Math.cos(a) * R, 0.5, Math.sin(a) * R);
      g.add(p);
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), new THREE.MeshBasicMaterial({ color: C.linen }));
      g.add(cap);
      this.pillars.push({ mesh: p, cap, base: new THREE.Color(cols[i % cols.length]), hit: 0, level: 0, a, wx: L.x + Math.cos(a) * R, wz: L.z + Math.sin(a) * R, last: -9 });
    }
    // the instrument at the centre: a cimbalom, strings that shake when struck
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.25, 2.2), new THREE.MeshBasicMaterial({ color: 0x3a1a12 }));
    deck.position.y = 1.0;
    g.add(deck);
    const SEG = 18;
    this.strings = { pos: new Float32Array(N * SEG * 2 * 3), amp: new Float32Array(N), g: null };
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.strings.pos, 3));
    const sl = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: C.gold }));
    sl.position.y = 1.16;
    sl.frustumCulled = false;
    g.add(sl);
    this.strings.g = sg;
    this.strings.seg = SEG;
    this.scene.add(g);
    this.ringGroup = g;
    this.solids.push([L.x, L.z, 2.0]);
    this.hitbox('music', L.x, 3, L.z, 7);
  }

  buildShapes() {
    const L = this.byId.shape;
    const g = new THREE.Group();
    g.position.set(L.x, 0, L.z);
    const R = 6;
    const spot = (i) => { const a = i / 5 * Math.PI * 2 + 0.3; return [Math.cos(a) * R, Math.sin(a) * R]; };
    const plinth = (x, z, col) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 0.8, 8), new THREE.MeshBasicMaterial({ color: col }));
      m.position.set(x, 0.4, z); g.add(m);
      this.solids.push([L.x + x, L.z + z, 1.5]);
    };

    // 1. torus knot in shifting bands
    let [x, z] = spot(0);
    plinth(x, z, 0x1b1426);
    const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.25, 0.36, 180, 14, 2, 3), this.timedMat(shader(basicVert, bandFrag)));
    knot.position.set(x, 3.4, z); g.add(knot);

    // 2. solids nested in solids
    [x, z] = spot(1);
    plinth(x, z, 0x1b1426);
    const nest = new THREE.Group(); nest.position.set(x, 3.4, z); g.add(nest);
    const solids = [
      [new THREE.BoxGeometry(2.6, 2.6, 2.6), C.acid],
      [new THREE.OctahedronGeometry(1.5), C.mag],
      [new THREE.IcosahedronGeometry(0.95), C.cyan],
      [new THREE.TetrahedronGeometry(0.55), C.gold]
    ].map(([geo, col]) => {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: col }));
      nest.add(l); return l;
    });

    // 3. a harmonograph drawing itself
    [x, z] = spot(2);
    plinth(x, z, 0x1b1426);
    const HN = 1400;
    const hpos = new Float32Array(HN * 3), hcol = new Float32Array(HN * 3);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(hpos, 3));
    hg.setAttribute('color', new THREE.BufferAttribute(hcol, 3));
    const harm = new THREE.Line(hg, new THREE.LineBasicMaterial({ vertexColors: true }));
    harm.position.set(x, 3.2, z); harm.frustumCulled = false; g.add(harm);
    const hsl = new THREE.Color();
    const regen = () => {
      const f = [2 + Math.floor(Math.random() * 3), 3 + Math.floor(Math.random() * 3), 1 + Math.random() * 0.02, 2 + Math.random() * 0.02];
      const ph = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
      const hue = Math.random();
      for (let i = 0; i < HN; i++) {
        const t = i / HN * 60, d = Math.exp(-t * 0.035);
        hpos[i * 3] = (Math.sin(t * f[0] * 0.3 + ph[0]) + Math.sin(t * f[2] * 0.3)) * 0.8 * d;
        hpos[i * 3 + 1] = (Math.sin(t * f[1] * 0.3 + ph[1]) + Math.sin(t * f[3] * 0.3 + ph[2])) * 0.8 * d;
        hpos[i * 3 + 2] = Math.cos(t * f[0] * 0.15 + ph[2]) * 0.6 * d;
        hsl.setHSL((hue + i / HN * 0.5) % 1, 0.9, 0.58);
        hcol[i * 3] = hsl.r; hcol[i * 3 + 1] = hsl.g; hcol[i * 3 + 2] = hsl.b;
      }
      hg.attributes.position.needsUpdate = true; hg.attributes.color.needsUpdate = true;
    };
    regen();
    let hdraw = 0;

    // 4. a painting by a network that only knows where it is
    [x, z] = spot(3);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), this.timedMat(shader(basicVert, cppnFrag, {}, { side: THREE.DoubleSide })));
    panel.position.set(x, 2.6, z);
    panel.lookAt(0, 2.6, 0);
    g.add(panel);
    const easel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.4, 0.2), new THREE.MeshBasicMaterial({ color: 0x3a1a12 }));
    easel.position.set(x, 2.2, z); g.add(easel);
    this.solids.push([L.x + x, L.z + z, 1.0]);

    // 5. a stack of primaries
    [x, z] = spot(4);
    plinth(x, z, 0x1b1426);
    const stack = new THREE.Group(); stack.position.set(x, 0.8, z); g.add(stack);
    const lamb = (c) => new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.35 });
    const parts = [
      [new THREE.BoxGeometry(1.4, 1.0, 1.4), lamb(0x17121c), 0.5],
      [new THREE.CylinderGeometry(0.55, 0.55, 1.2, 20), lamb(C.cobalt), 1.6],
      [new THREE.ConeGeometry(0.75, 1.3, 4), lamb(C.gold), 2.85],
      [new THREE.SphereGeometry(0.55, 20, 14), lamb(C.red), 4.05]
    ].map(([geo, m, y]) => { const s = new THREE.Mesh(geo, m); s.position.y = y; stack.add(s); return s; });
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-20, 30, 10);
    this.scene.add(sun, new THREE.AmbientLight(0x6a5a8a, 0.8));

    this.updaters.push((dt, t) => {
      knot.rotation.set(t * 0.21, t * 0.33, 0);
      knot.position.y = 3.4 + Math.sin(t * 0.9) * 0.25;
      solids.forEach((s, i) => s.rotation.set(t * (0.2 + i * 0.13) * (i % 2 ? -1 : 1), t * (0.31 - i * 0.05), t * 0.1 * i));
      hdraw += dt * 260;
      if (hdraw > HN + 400) { hdraw = 0; regen(); }
      hg.setDrawRange(0, Math.min(HN, Math.floor(hdraw)));
      harm.rotation.y = t * 0.15;
      parts.forEach((p, i) => { p.rotation.y = t * (0.3 + i * 0.17) * (i % 2 ? -1 : 1); });
      parts[3].position.y = 4.05 + Math.abs(Math.sin(t * 1.6)) * 0.35;
    });
    this.scene.add(g);
    this.hitbox('shape', L.x, 3, L.z, 7.5);
  }

  buildFlight() {
    const L = this.byId.flight;
    const g = new THREE.Group();
    g.position.set(L.x, 0, L.z);
    const R = 9;
    const obs = [[-3.5, -2, 1.2], [2.5, -4, 1.0], [0.5, 1.0, 1.4], [4.5, 2.5, 0.9], [-2.5, 4.2, 1.1], [-5.5, 1.5, 0.8], [3.0, 6.0, 0.8]];
    const fm = this.timedMat(shader(basicVert, fieldFrag, {
      uObs: { value: obs.map(o => new THREE.Vector3(o[0], -o[1], o[2])) },
      uGoal: { value: new THREE.Vector2(6, -6) },
      uRadius: { value: R }
    }, { transparent: true, depthWrite: false }));
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), fm);
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05;
    g.add(disc);
    obs.forEach(([x, z, r], i) => {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshLambertMaterial({ color: i % 2 ? C.mag : C.cyan, flatShading: true, emissive: i % 2 ? C.mag : C.cyan, emissiveIntensity: 0.25 }));
      m.position.set(x, 1.6 + (i % 3) * 0.8, z);
      g.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(r * 1.08, 1)), new THREE.LineBasicMaterial({ color: C.linen }));
      e.position.copy(m.position); g.add(e);
      this.solids.push([L.x + x, L.z + z, r + 0.4]);
    });
    // a path that threads between them
    const curve = new THREE.CatmullRomCurve3([
      [-7, 2.5, -5], [-1, 3.2, -3.5], [1.5, 2.2, -1.5], [6, 3.0, -1], [2.5, 3.8, 3.8], [-1, 2.6, 3], [-4.2, 2.8, 0.5]
    ].map(p => new THREE.Vector3(...p)), true, 'centripetal');
    const drone = new THREE.Group();
    const dm = new THREE.MeshBasicMaterial({ color: C.linen });
    drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), new THREE.MeshBasicMaterial({ color: C.gold })));
    const rotors = [];
    [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(([a, b]) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.08), dm);
      arm.position.set(a * 0.22, 0, b * 0.22); arm.rotation.y = Math.atan2(b, a) * -1; drone.add(arm);
      const rot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.07), new THREE.MeshBasicMaterial({ color: C.acid }));
      rot.position.set(a * 0.42, 0.08, b * 0.42); drone.add(rot); rotors.push(rot);
    });
    drone.scale.setScalar(1.5);
    g.add(drone);
    const TN = 90;
    const tpos = new Float32Array(TN * 3);
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: C.acid }));
    trail.frustumCulled = false;
    g.add(trail);
    let u = 0, tick = 0;
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    this.updaters.push((dt, t) => {
      u = (u + dt * 0.035) % 1;
      curve.getPointAt(u, p); curve.getPointAt((u + 0.01) % 1, q);
      drone.position.copy(p);
      drone.lookAt(q.x + L.x, q.y, q.z + L.z);
      rotors.forEach((r, i) => r.rotation.y = t * 40 * (i % 2 ? 1 : -1));
      tick += dt;
      if (tick > 0.05) {
        tick = 0;
        tpos.copyWithin(3, 0, (TN - 1) * 3);
        tpos[0] = p.x; tpos[1] = p.y; tpos[2] = p.z;
        tg.attributes.position.needsUpdate = true;
      }
    });
    this.scene.add(g);
    this.hitbox('flight', L.x, 3, L.z, 8);
  }

  buildLoom() {
    const L = this.byId.loom;
    const g = new THREE.Group();
    g.position.set(L.x, 0, L.z);
    // face the tree
    g.rotation.y = Math.atan2(-L.x, -L.z);
    this.loom = new Loom(65, 44);
    const w = 7.2, h = w * 44 / 65;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.timedMat(shader(basicVert, loomFrag, {
      uMap: { value: this.loom.tex }, uCells: { value: new THREE.Vector2(65, 44) }
    }, { side: THREE.DoubleSide })));
    cloth.position.y = 1.4 + h / 2;
    g.add(cloth);
    const wood = new THREE.MeshBasicMaterial({ color: 0x5a3018 });
    [[-w / 2 - 0.2, 0], [w / 2 + 0.2, 0]].forEach(([x]) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, h + 2.4, 0.3), wood);
      post.position.set(x, (h + 2.4) / 2, 0); g.add(post);
    });
    [1.3, h + 1.5].forEach(y => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.25, 0.35), wood);
      beam.position.set(0, y, 0); g.add(beam);
    });
    const shuttle = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.2), new THREE.MeshBasicMaterial({ color: C.gold }));
    shuttle.position.set(0, 1.5, 0.15); g.add(shuttle);
    // warp threads hanging below
    const warp = [];
    for (let i = 0; i <= 26; i++) { const x = -w / 2 + i / 26 * w; warp.push(x, 0.2, 0.02, x, 1.3, 0.02); }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(warp, 3));
    g.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: C.linen })));
    this.updaters.push((dt, t) => {
      this.loom.update(dt);
      shuttle.position.x = Math.sin(t * Math.PI / 0.64) * w * 0.46;
    });
    this.scene.add(g);
    const ax = Math.cos(-g.rotation.y) * (w / 2), az = Math.sin(-g.rotation.y) * (w / 2);
    this.solids.push([L.x, L.z, 1.0], [L.x + ax, L.z + az, 0.8], [L.x - ax, L.z - az, 0.8]);
    this.hitbox('loom', L.x, 3, L.z, 6);
  }

  buildStars() {
    const specs = [
      { p: [-20, 17, 24], R: 6, cell: 0.42, pal: [C.red, C.gold, C.black, C.red, C.cyan] },
      { p: [70, 52, -90], R: 9, cell: 1.5, pal: [C.red, C.gold, C.mag, C.red] },
      { p: [-95, 60, -50], R: 8, cell: 1.6, pal: [C.cyan, C.red, C.gold, C.violet] },
      { p: [20, 70, 110], R: 7, cell: 1.8, pal: [C.gold, C.red, C.cobalt] }
    ];
    this.stars = specs.map((s, i) => {
      const u = { uGrow: { value: 1 } };
      const m = stitchPanel(starCells(s.R, s.pal), s.cell, u);
      this.timedMat(m.material);
      const holder = new THREE.Group();
      holder.position.set(...s.p);
      holder.lookAt(0, s.p[1] * 0.4, 0);
      holder.add(m);
      this.scene.add(holder);
      return { m, speed: (i % 2 ? -1 : 1) * (0.06 + i * 0.02) };
    });
    this.updaters.push((dt, t) => this.stars.forEach(s => { s.m.rotation.z = t * s.speed; }));
  }

  buildMarkers() {
    this.markers = this.landmarks.map(l => {
      const col = new THREE.Color(LM_COLOR[l.id]);
      const top = l.id === 'tree' ? 30 : 11;
      const gem = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.8)), new THREE.LineBasicMaterial({ color: col, fog: false }));
      gem.position.set(l.x, top, l.z);
      this.scene.add(gem);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 40, 6, 1, true),
        this.timedMat(shader(basicVert, beamFrag, { uCol: { value: col } }, {
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
        })));
      beam.position.set(l.x, top + 20.5, l.z);
      this.scene.add(beam);
      return { gem, beam, l, top };
    });
    this.updaters.push((dt, t) => this.markers.forEach((m, i) => {
      m.gem.rotation.y = t * 0.8 + i;
      m.gem.position.y = m.top + Math.sin(t * 1.3 + i) * 0.35;
      const seen = this.visited.has(m.l.id);
      m.beam.visible = !seen || this.near?.id === m.l.id;
    }));
  }

  buildMotes() {
    const N = 360;
    const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
    const pal = [C.acid, C.cyan, C.mag, C.gold, C.linen].map(c => new THREE.Color(c));
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60; pos[i * 3 + 1] = Math.random() * 16; pos[i * 3 + 2] = (Math.random() - 0.5) * 60;
      const c = pal[i % pal.length]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.updaters.push((dt, t) => {
      // the motes follow you, wrapping around a box centred on your position
      for (let i = 0; i < N; i++) {
        let y = pos[i * 3 + 1] + dt * (0.25 + (i % 5) * 0.08);
        if (y > 16) y -= 16;
        pos[i * 3 + 1] = y;
        for (const k of [0, 2]) {
          const c = k === 0 ? this.pos.x : this.pos.z;
          let v = pos[i * 3 + k];
          if (v - c > 30) v -= 60; else if (c - v > 30) v += 60;
          pos[i * 3 + k] = v;
        }
      }
      g.attributes.position.needsUpdate = true;
    });
  }

  /* ---------------- the books ---------------- */

  buildBooks() {
    const COL = { acid: C.acid, gold: C.gold, violet: C.violet, mag: C.mag, cyan: C.cyan, red: C.red };
    this.books = (this.data.books || []).map((b, i) => {
      const col = COL[b.color] ?? C.red;
      const g = new THREE.Group();
      g.position.set(b.x, 0, b.z);
      // a plinth with a lit ring
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.9, 8), new THREE.MeshBasicMaterial({ color: 0x1b1426 }));
      plinth.position.y = 0.45; g.add(plinth);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: col }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0.92; g.add(ring);
      // the book, open, floating above it
      const book = new THREE.Group();
      book.position.y = 1.65;
      const cover = new THREE.MeshBasicMaterial({ color: col });
      const paper = new THREE.MeshBasicMaterial({ color: C.linen });
      [-1, 1].forEach(side => {
        const half = new THREE.Group();
        half.rotation.z = side * 0.42;
        const c = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.035, 0.64), cover);
        c.position.x = side * 0.23; half.add(c);
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.58), paper);
        p.position.set(side * 0.22, 0.04, 0); half.add(p);
        book.add(half);
      });
      book.scale.setScalar(1.25);
      g.add(book);
      // its name, floating over it
      const c = document.createElement('canvas'); c.width = 512; c.height = 96;
      const x = c.getContext('2d');
      x.font = '48px ui-monospace, Menlo, Consolas, monospace';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#efe6d2'; x.fillText(b.title.toLowerCase(), 256, 50);
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.NoColorSpace;
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false }));
      label.scale.set(2.4, 0.45, 1); label.position.y = 2.75; g.add(label);
      // a beam until it has been read
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 30, 6, 1, true),
        this.timedMat(shader(basicVert, beamFrag, { uCol: { value: new THREE.Color(col) } }, {
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
      beam.position.y = 17.5; g.add(beam);
      this.scene.add(g);
      this.solids.push([b.x, b.z, 0.75]);
      this.hitbox('book:' + b.key, b.x, 1.6, b.z, 1.1, 'book');
      return { ...b, col, g, book, beam, phase: i * 1.3 };
    });
    this.updaters.push((dt, t) => this.books.forEach(b => {
      b.book.rotation.y = t * 0.5 + b.phase;
      b.book.position.y = 1.65 + Math.sin(t * 1.4 + b.phase) * 0.08;
      b.beam.visible = !this.read.has(b.key);
    }));
  }

  // The guide: her portrait on top of a body made of the same glitch.
  addGuide(character, def) {
    const g = new THREE.Group();
    g.position.set(def.x, 0, def.z);
    const bust = new THREE.Group();
    const S = 0.39;                                   // portrait pixels to metres
    bust.scale.setScalar(S);
    bust.position.y = 1.42;
    bust.add(character.root);
    g.add(bust);

    const bodyMat = this.timedMat(shader(`
      uniform float uTime;
      uniform float uGlitch;
      varying vec2 vUv;
      varying vec3 vW;
      float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main(){
        vUv = uv;
        vec3 p = position;
        float t = floor(uTime * 10.0);
        float slice = floor(p.y * 14.0);
        p.x += step(0.9, h(vec2(slice, t))) * (h(vec2(slice, t + 3.0)) - 0.5) * 0.06 * (0.4 + uGlitch * 2.0);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`, `
      uniform float uTime;
      uniform float uGlitch;
      varying vec2 vUv;
      varying vec3 vW;
      float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      void main(){
        vec2 b = floor(vUv * vec2(26.0, 16.0));
        float t = floor(uTime * 6.0);
        float r = h(b);
        if (h(b + t) > 0.97) r = h(b + t + 1.0);
        vec3 c = r < 0.30 ? vec3(0.10, 0.19, 0.16) : r < 0.55 ? vec3(0.07, 0.40, 0.51)
               : r < 0.75 ? vec3(0.77, 0.71, 0.47) : r < 0.90 ? vec3(0.80, 0.95, 0.06) : vec3(0.92, 0.20, 0.74);
        // a band of red and black at the hem, like the hem of a traditional blouse
        float hem = step(vUv.y, 0.12);
        float m = abs(mod(b.x, 4.0) - 2.0) + abs(b.y - 1.0);
        c = mix(c, m < 1.5 ? vec3(0.78, 0.06, 0.18) : vec3(0.08, 0.05, 0.07), hem);
        if (h(b * 1.7 + t * 0.3) < uGlitch * 0.06) discard;
        gl_FragColor = vec4(c, 1.0);
      }`, { uGlitch: { value: 0.2 } }, { side: THREE.DoubleSide }));
    // a dress from the chest to the knees, then legs
    const prof = [[0.17, 1.22], [0.19, 1.12], [0.16, 1.0], [0.20, 0.86], [0.27, 0.66], [0.33, 0.48]].map(([r, y]) => new THREE.Vector2(r, y));
    const dress = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), bodyMat);
    dress.position.z = -0.04;
    g.add(dress);
    const legMat = new THREE.MeshBasicMaterial({ color: 0x1a312a });
    [-0.09, 0.09].forEach(x => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.5, 8), legMat);
      leg.position.set(x, 0.25, -0.02); g.add(leg);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), new THREE.MeshBasicMaterial({ color: C.linen }));
      foot.position.set(x, 0.03, 0.03); g.add(foot);
    });
    // her name
    const c = document.createElement('canvas'); c.width = 256; c.height = 80;
    const x = c.getContext('2d');
    x.font = '44px ui-monospace, Menlo, Consolas, monospace';
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#cbf30f';
    x.fillText(def.name || 'Vis', 128, 42);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.NoColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, transparent: true, depthWrite: false }));
    label.scale.set(0.9, 0.28, 1); label.position.y = 2.12;
    g.add(label);
    this.scene.add(g);
    this.solids.push([def.x, def.z, 0.45]);
    this.hitbox('guide', def.x, 1.1, def.z, 0.9, 'guide');
    this.guide = { g, def, bodyMat, character, label, yaw: 0 };
    // start the visitor turned toward her
    this.yaw = this.yawT = Math.atan2(-(def.x - this.pos.x), -(def.z - this.pos.z)) * 0.8;
    this.initHud();
  }

  hitbox(id, x, y, z, r, kind = 'place') {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    m.position.set(x, y, z);
    m.userData.id = id;
    m.userData.kind = kind;
    this.scene.add(m);
    this.hits.push(m);
  }

  /* ---------------- hud ---------------- */

  initHud() {
    const h = this.hud;
    h.places.innerHTML = '';
    this.placeButtons = {};
    const group = label => { const li = document.createElement('li'); li.className = 'grp'; li.textContent = label; h.places.appendChild(li); };
    const item = (id, name, color) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="sw" style="--c:#${new THREE.Color(color).getHexString()}"></span>${name}`;
      b.addEventListener('click', e => { e.stopPropagation(); this.goTo(id); });
      li.appendChild(b); h.places.appendChild(li);
      this.placeButtons[id] = b;
    };
    group('books');
    (this.books || []).forEach(b => item('book:' + b.key, b.title, b.col));
    group('places');
    if (this.guide) item('guide', `${this.guide.def.name || 'Vis'}, your guide`, C.acid);
    this.landmarks.forEach(l => item(l.id, l.name, LM_COLOR[l.id]));
    (this.books || []).forEach(b => { if (this.read.has(b.key)) this.placeButtons['book:' + b.key].classList.add('seen'); });
    this.updateCount();
  }

  updateCount() {
    const n = this.books?.length || 0;
    this.hud.count.textContent = `${this.read.size} of ${n} books read`;
  }

  markRead(key) {
    if (this.read.has(key)) return;
    this.read.add(key);
    this.placeButtons['book:' + key]?.classList.add('seen');
    this.updateCount();
  }
  get allRead() { return this.books.length > 0 && this.read.size >= this.books.length; }

  showCard(l) {
    const h = this.hud;
    h.cardKind.textContent = l.kind;
    h.cardTitle.textContent = l.name;
    h.cardBody.innerHTML = '';
    String(l.body).split('\n\n').forEach(p => { const e = document.createElement('p'); e.textContent = p; h.cardBody.appendChild(e); });
    h.card.style.setProperty('--c', '#' + new THREE.Color(LM_COLOR[l.id]).getHexString());
    h.card.classList.add('on');
    h.card.setAttribute('aria-hidden', 'false');
  }
  hideCard() { this.hud.card.classList.remove('on'); this.hud.card.setAttribute('aria-hidden', 'true'); }

  /* ---------------- input ---------------- */

  keyDown(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!this.locked && ['w', 'a', 's', 'd', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Shift'].includes(k)) {
      this.keys.add(k);
      if (k !== 'Shift') this.travel = null;
      e.preventDefault();
    }
  }
  keyUp(e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    this.keys.delete(k);
  }
  clearKeys() { this.keys.clear(); }

  pointerDown(e) {
    if (this.drag && this.drag.id !== e.pointerId) return;   // one look drag at a time
    this.drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, id: e.pointerId, moved: 0, touch: e.pointerType === 'touch' };
  }
  pointerMove(e) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId || this.locked) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    const s = d.touch ? 0.0062 : 0.0042;
    // grab the world: dragging right swings the view left, like pulling it round
    this.yawT += dx * s;
    this.pitchT = clamp(this.pitchT + dy * s * 0.8, -0.9, 0.9);
    if (d.moved > (d.touch ? 16 : 6)) this.travel = null;
  }
  // Only the finger that started a drag can end it, so lifting the thumb
  // off the pad does not stop the other finger from looking around.
  pointerCancel(e) {
    if (this.drag && this.drag.id === e.pointerId) this.drag = null;
  }
  pointerUp(e, nx, ny) {
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    this.drag = null;
    const slop = d.touch ? 16 : 8;           // fingers move a little even when tapping
    if (d.moved > slop || this.locked) return;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hits = this.raycaster.intersectObjects(this.hits, false).filter(h => h.distance < 140);
    if (!hits.length) return;
    const hit = hits.find(h => h.object.userData.kind !== 'place') || hits[0];
    const { id, kind } = hit.object.userData;
    if (kind === 'book' || kind === 'guide') {
      const key = kind === 'book' ? id.slice(5) : 'guide';
      const p = hit.object.position;
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 6) { this.onInteract?.(kind, key); return; }
    }
    this.goTo(id);
  }
  wheel(e) {
    this.travel = null;
    const f = clamp(-e.deltaY * 0.012, -2, 2);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.vel.x += fx * f * 4; this.vel.z += fz * f * 4;
  }
  setStick(x, y) { this.stick.x = x; this.stick.y = y; if (x || y) this.travel = null; }

  goTo(id) {
    let tx, tz, stand, pitch = 0.1;
    if (id === 'guide' && this.guide) { tx = this.guide.def.x; tz = this.guide.def.z; stand = 2.2; pitch = 0.02; }
    else if (id.startsWith('book:')) {
      const b = this.books.find(k => 'book:' + k.key === id);
      if (!b) return;
      tx = b.x; tz = b.z; stand = 2.6; pitch = -0.05;
    } else {
      const l = this.byId[id];
      if (!l) return;
      tx = l.x; tz = l.z; stand = l.r * (id === 'tree' ? 0.85 : 0.78); pitch = id === 'tree' ? 0.42 : 0.1;
    }
    const dir = new THREE.Vector2(this.pos.x - tx, this.pos.z - tz);
    if (dir.lengthSq() < 1e-4) dir.set(0, 1);
    dir.normalize();
    this.travel = { id, x: tx + dir.x * stand, z: tz + dir.y * stand, lx: tx, lz: tz, pitch };
  }

  /* ---------------- lifecycle ---------------- */

  enter() {
    this.active = true;
    this.hud.root.classList.add('on');
    this.hud.root.setAttribute('aria-hidden', 'false');
    this.music?.start();
  }
  leave() {
    this.active = false;
    this.clearKeys();
    this.stick.x = this.stick.y = 0;
    this.drag = null; this.travel = null;
    this.hud.root.classList.remove('on');
    this.hud.root.setAttribute('aria-hidden', 'true');
    this.hideCard();
    this.near = null;
    this.setTarget(null);
    this.music?.stop();
  }

  fit(w, h, dpr) {
    // pixels are sized in CSS pixels so a stitch reads the same on every screen
    const block = clamp(w / 330, 2.2, 4.6);
    const px = Math.max(1, Math.round(block * dpr));
    const lw = Math.max(120, Math.floor(w * dpr / px));
    const lh = Math.max(90, Math.floor(h * dpr / px));
    this.rt.setSize(lw, lh);
    this.res = new THREE.Vector2(lw, lh);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 78 : 66;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- frame ---------------- */

  update(dt, t, mix) {
    if (mix < 0.002 && !this.active) return;
    this.timed.forEach(m => { if (m.uniforms.uTime) m.uniforms.uTime.value = t; });
    this.updaters.forEach(f => f(dt, t));

    // the tree stitches itself the first time you arrive
    if (this.active) this.grow = Math.min(1.05, this.grow + dt * 0.16);
    this.treeUniforms.uGrow.value = this.grow;

    this.move(dt, t);

    // footsteps
    const here = new THREE.Vector2(this.pos.x, this.pos.z);
    if (here.distanceTo(this.lastStep) > 1.25) {
      const side = (this.trailHead % 2 ? 1 : -1) * 0.28;
      const rx = Math.cos(this.yaw) * side, rz = -Math.sin(this.yaw) * side;
      this.trail[this.trailHead].set(this.pos.x + rx, this.pos.z + rz, 0, (this.trailHead * 7) % 6);
      this.trailHead = (this.trailHead + 1) % this.trail.length;
      this.lastStep.copy(here);
    }
    this.trail.forEach(v => { v.z = Math.min(1, v.z + dt * 0.12); });
    this.groundMat.uniforms.uTrail.value = this.trail;

    this.updateMusic(dt, t);
    this.updateNear();
    this.updateGuide(dt, t);
    this.updateTarget();
  }

  updateGuide(dt, t) {
    const G = this.guide;
    if (!G) return;
    const want = Math.atan2(this.pos.x - G.def.x, this.pos.z - G.def.z);
    let d = want - G.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    G.yaw += d * Math.min(1, dt * 3);
    G.g.rotation.y = G.yaw;
    G.bodyMat.uniforms.uGlitch.value = G.character.glitch;
    G.label.position.y = 2.12 + Math.sin(t * 1.6) * 0.03;
  }

  distTo(x, z) { return Math.hypot(this.pos.x - x, this.pos.z - z); }
  get guideDist() { return this.guide ? this.distTo(this.guide.def.x, this.guide.def.z) : Infinity; }

  updateTarget() {
    if (this.locked) { this.setTarget(null); return; }
    let best = null, bd = Infinity;
    if (this.guide) {
      const d = this.guideDist;
      if (d < 4.2) { best = { kind: 'guide', key: 'guide', name: this.guide.def.name || 'Vis' }; bd = d; }
    }
    for (const b of this.books) {
      const d = this.distTo(b.x, b.z);
      if (d < 4 && d < bd) { best = { kind: 'book', key: b.key, name: b.title }; bd = d; }
    }
    this.setTarget(best);
  }

  setTarget(t) {
    const same = (t && this.target && t.kind === this.target.kind && t.key === this.target.key) || (!t && !this.target);
    this.target = t;
    if (same) return;
    const el = this.hud.prompt;
    if (!t) { el.classList.remove('on'); return; }
    const how = document.body.classList.contains('touch') ? 'Tap here' : 'Press E';
    el.textContent = t.kind === 'guide' ? `${how} to talk to ${t.name}` : `${how} to read ${t.name.toLowerCase()}`;
    el.classList.add('on');
  }
  // redraw the prompt text, e.g. after a touchscreen is detected
  refreshPrompt() { const t = this.target; this.target = null; this.setTarget(t); }

  interact() {
    if (this.target) this.onInteract?.(this.target.kind, this.target.key);
  }

  move(dt, t) {
    const k = this.keys;
    let fwd = 0, strafe = 0, turn = 0;
    if (k.has('w') || k.has('ArrowUp')) fwd += 1;
    if (k.has('s') || k.has('ArrowDown')) fwd -= 1;
    if (k.has('d')) strafe += 1;
    if (k.has('a')) strafe -= 1;
    if (k.has('ArrowLeft')) turn += 1;
    if (k.has('ArrowRight')) turn -= 1;
    fwd += -this.stick.y; strafe += this.stick.x * 0.85;
    if (this.locked) { fwd = 0; strafe = 0; turn = 0; }
    this.yawT += turn * dt * 1.9;

    const run = k.has('Shift') ? 1.8 : 1;
    const speed = 7.2 * run;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const want = new THREE.Vector3(
      (-sy * fwd + cy * strafe) * speed, 0,
      (-cy * fwd - sy * strafe) * speed
    );

    if (this.travel) {
      const tr = this.travel;
      const d = new THREE.Vector2(tr.x - this.pos.x, tr.z - this.pos.z);
      const dist = d.length();
      const face = Math.atan2(-(tr.lx - this.pos.x), -(tr.lz - this.pos.z));
      let dy = face - this.yawT;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yawT += dy * Math.min(1, dt * 3);
      this.pitchT = approach(this.pitchT, tr.pitch, 2, dt);
      if (dist < 0.4) this.travel = null;
      else {
        const v = Math.min(16, dist * 2.2 + 2);
        want.set(d.x / dist * v, 0, d.y / dist * v);
      }
    }

    this.vel.x = approach(this.vel.x, want.x, 7, dt);
    this.vel.z = approach(this.vel.z, want.z, 7, dt);
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    const p = new THREE.Vector2(nx, nz);
    for (const [sx, sz, r] of this.solids) {
      const d = new THREE.Vector2(p.x - sx, p.y - sz);
      const l = d.length();
      if (l < r + 0.4) p.set(sx, sz).add(d.multiplyScalar((r + 0.4) / Math.max(l, 1e-3)));
    }
    if (p.length() > BOUND) p.multiplyScalar(BOUND / p.length());
    const moved = Math.hypot(p.x - this.pos.x, p.y - this.pos.z);
    this.walked += moved;
    this.pos.x = p.x; this.pos.z = p.y;

    this.yaw = approach(this.yaw, this.yawT, 12, dt);
    this.pitch = approach(this.pitch, this.pitchT, 12, dt);
    const bob = Math.sin(this.walked * 2.2) * 0.06 * Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 5);
    this.camera.position.set(this.pos.x, EYE + bob + fbm1(t * 0.2, 9) * 0.03, this.pos.z);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;   // positive looks up
  }

  updateNear() {
    let best = null, bd = Infinity;
    for (const l of this.landmarks) {
      const d = Math.hypot(this.pos.x - l.x, this.pos.z - l.z);
      if (d < l.r * 1.05 && d < bd) { best = l; bd = d; }
    }
    if (best !== this.near) {
      this.near = best;
      Object.values(this.placeButtons).forEach(b => b.removeAttribute('aria-current'));
      if (best) {
        if (!this.locked) this.showCard(best);
        this.placeButtons[best.id].setAttribute('aria-current', 'true');
        if (!this.visited.has(best.id)) {
          this.visited.add(best.id);
          this.placeButtons[best.id].classList.add('seen');
          this.updateCount();
        }
      } else this.hideCard();
    }
  }

  updateMusic(dt, t) {
    const L = this.byId.music;
    const d = Math.hypot(this.pos.x - L.x, this.pos.z - L.z);
    const presence = clamp(1 - (d - 5) / 38, 0.12, 1);
    this.music?.setPresence(this.active ? presence : 0);

    // walking between two pillars plucks them
    for (let i = 0; i < this.pillars.length; i++) {
      const p = this.pillars[i];
      if (Math.hypot(this.pos.x - p.wx, this.pos.z - p.wz) < 1.5 && t - p.last > 0.7) {
        p.last = t;
        this.music?.pluck(i, 1);
        this.onNote(i, 1);
      }
    }
    const bins = this.music?.levels(this.pillars.length);
    this.pillars.forEach((p, i) => {
      p.hit = Math.max(0, p.hit - dt * 1.6);
      const lv = bins ? bins[i] : 0.2 + 0.2 * Math.sin(t * 1.3 + i);
      p.level = approach(p.level, lv, 10, dt);
      const hgt = 1.4 + p.level * 5 + p.hit * 3.5;
      p.mesh.scale.y = hgt;
      p.mesh.position.y = hgt / 2;
      p.cap.position.set(p.mesh.position.x, hgt + 0.6 + Math.sin(t * 2 + i) * 0.1, p.mesh.position.z);
      p.cap.rotation.y = t + i;
      p.mesh.material.color.copy(p.base).multiplyScalar(0.65 + p.hit * 0.8);
    });

    // strings
    const S = this.strings, SEG = S.seg, N = this.pillars.length;
    for (let i = 0; i < N; i++) {
      S.amp[i] *= Math.exp(-dt * 2.5);
      const z = -0.95 + i / (N - 1) * 1.9;
      const len = 2.9 - i * 0.07;
      for (let s = 0; s < SEG; s++) {
        const u0 = s / SEG, u1 = (s + 1) / SEG;
        const y0 = Math.sin(u0 * Math.PI) * Math.sin(t * 60 + i) * S.amp[i] * 0.12;
        const y1 = Math.sin(u1 * Math.PI) * Math.sin(t * 60 + i) * S.amp[i] * 0.12;
        const o = (i * SEG + s) * 6;
        S.pos[o] = -len / 2 + u0 * len; S.pos[o + 1] = y0; S.pos[o + 2] = z;
        S.pos[o + 3] = -len / 2 + u1 * len; S.pos[o + 4] = y1; S.pos[o + 5] = z;
      }
    }
    S.g.attributes.position.needsUpdate = true;
  }

  onNote(i, v = 1) {
    const p = this.pillars[i % this.pillars.length];
    if (p) p.hit = Math.min(1, p.hit + 0.8 * v);
    this.strings.amp[i % this.pillars.length] = 1;
  }

  render(renderer) {
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(FOG, 1);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(0x000000, 0);
  }
}

export const MIND_PALETTE = [
  0x07060c, 0x16121f, 0x2b2140, 0xefe6d2, 0xb9ac8f, 0xc8102e, 0x6e0b1d, 0x3b1020,
  0xe8a63c, 0xcbf30f, 0x26d4e1, 0xeb32bc, 0x2a5bd7, 0x1f7a4a, 0xff7a3d, 0x7d4bd8
];
