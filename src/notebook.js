import * as THREE from 'three';
import { pageVert, pageFrag, uiVert, uiFrag } from './shaders.js';
import { approach, clamp } from './noise.js';
import { wrap } from './text.js';

const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';
const PAPER = '#cdbf85';
const INK = '#0a1006';
const RUST = '#c04415';
const PW = 1.0, PH = 1.4;
const CW = 720, CH = Math.round(720 * PH / PW);

function pageCanvas() {
  const c = document.createElement('canvas');
  c.width = CW; c.height = CH;
  return c;
}

function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function paper(ctx, seed) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CW, CH);
  // age: blotches and speckle, deterministic per page
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = i % 3 ? '#8d7c45' : '#6d5f30';
    const r = 30 + rnd() * 140;
    ctx.beginPath(); ctx.arc(rnd() * CW, rnd() * CH, r, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 0.11;
  ctx.fillStyle = '#5c5228';
  for (let i = 0; i < 900; i++) ctx.fillRect(rnd() * CW, rnd() * CH, 1.5, 1.5);
  ctx.globalAlpha = 1;
  // ruled lines and margin
  ctx.strokeStyle = 'rgba(60,70,40,0.16)';
  ctx.lineWidth = 1;
  for (let y = CH * 0.16; y < CH * 0.93; y += CH * 0.038) {
    ctx.beginPath(); ctx.moveTo(CW * 0.10, y); ctx.lineTo(CW * 0.92, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(192,68,21,0.30)';
  ctx.beginPath(); ctx.moveTo(CW * 0.105, CH * 0.06); ctx.lineTo(CW * 0.105, CH * 0.95); ctx.stroke();
}

function drawPage(canvas, page, section, num) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CW, CH);
  paper(ctx, num + 3);
  if (!page) return canvas;      // blank leaf at the end of an odd-length section

  const L = CW * 0.135, R = CW * 0.945, w = R - L;
  ctx.textBaseline = 'alphabetic';

  // running head
  ctx.font = `${CW * 0.030}px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${CW * 0.011}px`;
  ctx.fillStyle = 'rgba(10,16,6,0.45)';
  ctx.fillText(String(section).toLowerCase(), L, CH * 0.075);

  let y = CH * 0.155;

  if (page.eyebrow) {
    ctx.font = `${CW * 0.033}px ${MONO}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${CW * 0.013}px`;
    ctx.fillStyle = RUST;
    ctx.fillText(String(page.eyebrow).toLowerCase(), L, y);
    y += CH * 0.036;
  }

  if ('letterSpacing' in ctx) ctx.letterSpacing = `${CW * 0.002}px`;
  ctx.font = `${CW * 0.084}px ${MONO}`;
  ctx.fillStyle = INK;
  for (const line of wrap(ctx, page.title || '', w)) { ctx.fillText(line, L, y + CH * 0.045); y += CH * 0.058; }

  if (page.meta) {
    y += CH * 0.020;
    ctx.font = `${CW * 0.034}px ${MONO}`;
    ctx.fillStyle = 'rgba(10,16,6,0.62)';
    for (const line of wrap(ctx, page.meta, w)) { ctx.fillText(line, L, y + CH * 0.020); y += CH * 0.034; }
  }

  y += CH * 0.030;
  ctx.strokeStyle = 'rgba(10,16,6,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + w * 0.24, y); ctx.stroke();
  y += CH * 0.034;

  // shrink the body until the whole entry fits: truncating a project
  // description is worse than a smaller typeface
  const avail = CH * 0.86 - y - (page.portal ? CH * 0.31 : 0);
  const paras = page.body || [];
  let size = CW * 0.0435, laid = null;
  for (let pass = 0; pass < 14; pass++) {
    ctx.font = `${size}px ${MONO}`;
    const lh = size * 1.58;
    const blocks = paras.map(t => wrap(ctx, t, w));
    const total = blocks.reduce((a, b) => a + b.length, 0) * lh + Math.max(0, blocks.length - 1) * lh * 0.55;
    if (total <= avail || size <= CW * 0.027) { laid = { blocks, lh }; break; }
    size *= 0.94;
  }
  if (!laid) { ctx.font = `${size}px ${MONO}`; laid = { blocks: paras.map(t => wrap(ctx, t, w)), lh: size * 1.58 }; }
  ctx.fillStyle = INK;
  for (const block of laid.blocks) {
    for (const line of block) { ctx.fillText(line, L, y); y += laid.lh; }
    y += laid.lh * 0.55;
  }

  if (page.tags && page.tags.length) {
    const ts = CW * 0.029;
    ctx.font = `${ts}px ${MONO}`;
    let tx = L, ty = CH * 0.905;
    for (const tag of page.tags) {
      const tw = ctx.measureText(tag).width + ts * 1.5;
      if (tx + tw > R) { tx = L; ty += ts * 2.1; }
      ctx.strokeStyle = 'rgba(10,16,6,0.40)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(tx, ty - ts * 1.25, tw, ts * 1.85);
      ctx.fillStyle = 'rgba(10,16,6,0.78)';
      ctx.fillText(tag, tx + ts * 0.75, ty + ts * 0.22);
      tx += tw + ts * 0.6;
    }
  }

  if (page.portal) drawPortal(ctx, y);

  ctx.font = `${CW * 0.028}px ${MONO}`;
  ctx.fillStyle = 'rgba(10,16,6,0.40)';
  const label = String(num + 1).padStart(2, '0');
  ctx.fillText(label, R - ctx.measureText(label).width, CH * 0.965);
  return canvas;
}

// A small study of the landscape behind the page: a stitched tree of life
// whose roots turn into circuit traces.
function drawPortal(ctx, y) {
  const x0 = CW * 0.16, x1 = CW * 0.84;
  const h = Math.max(CH * 0.2, Math.min(CH * 0.3, CH * 0.92 - y));
  const y0 = y + CH * 0.01, y1 = y0 + h, w = x1 - x0;
  ctx.save();
  ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  ctx.fillStyle = '#10121a';
  ctx.fillRect(x0, y0, w, h);
  // traces
  ctx.strokeStyle = 'rgba(203,243,15,0.55)'; ctx.lineWidth = 2;
  const cx = (x0 + x1) / 2, gy = y1 - h * 0.14;
  [[-0.42, -0.2], [-0.28, 0.1], [0.3, -0.12], [0.44, 0.08]].forEach(([dx, dy]) => {
    ctx.beginPath(); ctx.moveTo(cx, gy);
    ctx.lineTo(cx + dx * w * 0.5, gy); ctx.lineTo(cx + dx * w, gy + dy * h * 0.3);
    ctx.stroke();
    ctx.fillStyle = '#26d4e1';
    ctx.fillRect(cx + dx * w - 3, gy + dy * h * 0.3 - 3, 6, 6);
  });
  // cross-stitch tree
  const s = Math.max(4, Math.floor(h * 0.78 / 24));
  const X = (i, j, col) => {
    const px = cx + i * s, py = gy - j * s;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, s * 0.28);
    ctx.beginPath();
    ctx.moveTo(px - s * 0.4, py - s * 0.4); ctx.lineTo(px + s * 0.4, py + s * 0.4);
    ctx.moveTo(px + s * 0.4, py - s * 0.4); ctx.lineTo(px - s * 0.4, py + s * 0.4);
    ctx.stroke();
  };
  for (let j = 1; j < 18; j++) X(0, j, '#c8102e');
  for (let b = 0; b < 4; b++) {
    const j0 = 4 + b * 3, len = 6 - b;
    for (let k = 1; k <= len; k++) { X(k, j0 + k, '#c8102e'); X(-k, j0 + k, '#c8102e'); }
    X(len + 1, j0 + len + 1, '#eb32bc'); X(-len - 1, j0 + len + 1, '#eb32bc');
  }
  [[0, 19], [1, 20], [-1, 20], [0, 21], [2, 21], [-2, 21], [1, 22], [-1, 22], [0, 23]]
    .forEach(([i, j]) => X(i, j, '#e8a63c'));
  ctx.restore();
  ctx.strokeStyle = 'rgba(10,16,6,0.6)'; ctx.lineWidth = 4;
  ctx.strokeRect(x0, y0, w, h);
}

function navTexture(label, planeW, planeH, accent) {
  // canvas aspect has to match the plane, or the glyphs stretch
  const H = 96, W = Math.round(H * planeW / planeH);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const col = accent ? '#e8963c' : '#cbf30f';
  ctx.fillStyle = accent ? 'rgba(10,7,4,0.92)' : 'rgba(6,10,4,0.90)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = accent ? 'rgba(232,150,60,0.65)' : 'rgba(203,243,15,0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  let size = 30;
  ctx.font = `${size}px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  while (ctx.measureText(label).width > W - 34 && size > 12) {
    size *= 0.92;
    ctx.font = `${size}px ${MONO}`;
  }
  ctx.fillStyle = col;
  ctx.textBaseline = 'middle';
  ctx.fillText(label, (W - ctx.measureText(label).width) / 2, H / 2 + 1);
  return tex(c);
}

// every page is drawn once per section and then copied, so a drag that
// starts a turn does not stall on text layout
const pageCache = new Map();
function cachedPage(pages, i, section) {
  const key = `${section}:${i}:${pages[i] ? pages[i].title : '_'}`;
  let c = pageCache.get(key);
  if (!c) { c = drawPage(pageCanvas(), pages[i], section, i); pageCache.set(key, c); }
  return c;
}

class Sheet {
  constructor(scene, order) {
    const geo = new THREE.PlaneGeometry(PW, PH, 44, 6);
    geo.translate(PW / 2, 0, 0);                    // spine at x = 0
    this.front = pageCanvas(); this.back = pageCanvas();
    this.ft = tex(this.front); this.bt = tex(this.back);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uFront: { value: this.ft }, uBack: { value: this.bt },
        uTurn: { value: 0 }, uSide: { value: 1 }, uAlpha: { value: 0 }, uCurl: { value: 0 }
      },
      vertexShader: pageVert, fragmentShader: pageFrag,
      side: THREE.DoubleSide, transparent: true, depthTest: false, depthWrite: false
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    scene.add(this.mesh);
    this.keys = [null, null];
  }
  set(pages, fi, bi, section) {
    const put = (canvas, t, i, slot) => {
      const k = `${section}:${i}`;
      if (this.keys[slot] === k) return;
      this.keys[slot] = k;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, CW, CH);
      ctx.drawImage(cachedPage(pages, i, section), 0, 0);
      t.needsUpdate = true;
    };
    put(this.front, this.ft, fi, 0);
    put(this.back, this.bt, bi, 1);
  }
}

function labelTexture(text, planeW, planeH) {
  const H = 72, W = Math.round(H * planeW / planeH);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.font = `28px ${MONO}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '4px';
  ctx.fillStyle = 'rgba(197,182,119,0.75)';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, (W - ctx.measureText(text).width) / 2, H / 2);
  return c;
}

export class Notebook {
  constructor(content) {
    this.content = content;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.book = new THREE.Group();          // everything that shifts in single-page mode
    this.group.add(this.book);

    const cover = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x14200c, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
    );
    cover.position.z = -0.05; cover.renderOrder = 0;
    this.cover = cover;
    this.book.add(cover);

    // the left page is a sheet held at full turn, so it lands on x < 0 showing
    // its back face. Mirroring the mesh instead would mirror the text.
    this.left = new Sheet(this.book, 1);
    this.left.mat.uniforms.uTurn.value = 1;
    this.right = new Sheet(this.book, 1);
    this.turner = new Sheet(this.book, 3);
    this.turner.mesh.position.z = 0.012;

    this.stack = [];
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 1; k <= 3; k++) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(PW * (1 - k * 0.006), PH * (1 - k * 0.008)),
          new THREE.MeshBasicMaterial({ color: k === 1 ? 0x9c8f63 : 0x6f6544, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
        );
        m.position.set(side * (PW / 2 + side * 0.004 * k), -0.006 * k, -0.012 * k);
        m.renderOrder = 0;
        m.userData.side = side;
        this.book.add(m);
        this.stack.push(m);
      }
    }

    const spine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.022, PH),
      new THREE.MeshBasicMaterial({ color: 0x1a312a, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
    );
    spine.position.z = 0.006; spine.renderOrder = 2;
    this.spine = spine;
    this.book.add(spine);

    // invisible surface the pointer grabs pages through
    this.grab = new THREE.Mesh(new THREE.PlaneGeometry(PW * 2, PH), new THREE.MeshBasicMaterial({ visible: false }));
    this.grab.position.z = 0.02;
    this.book.add(this.grab);

    // nav
    this.nav = [];
    [['<', 'prev', 0.13], ['>', 'next', 0.13], ['close', 'close', 0.26], ['go inside', 'enter', 0.40]].forEach(([label, action, pw], i) => {
      const ph = 0.085;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(pw, ph),
        new THREE.ShaderMaterial({
          uniforms: { uMap: { value: navTexture(label, pw, ph, action === 'enter') }, uReveal: { value: 1 }, uTime: { value: 0 }, uHover: { value: 0 } },
          vertexShader: uiVert, fragmentShader: uiFrag,
          transparent: true, depthTest: false, depthWrite: false
        })
      );
      m.renderOrder = 4;
      m.userData.action = action;
      m.userData.w = pw;
      m.visible = false;
      this.nav.push(m);
      this.group.add(m);
    });

    // page counter
    this.counterCanvas = labelTexture('', 0.36, 0.06);
    this.counterTex = tex(this.counterCanvas);
    this.counter = new THREE.Mesh(
      new THREE.PlaneGeometry(0.36, 0.06),
      new THREE.MeshBasicMaterial({ map: this.counterTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
    );
    this.counter.renderOrder = 4;
    this.group.add(this.counter);

    this.raycaster = new THREE.Raycaster();
    this.open = false;
    this.alpha = 0; this.targetAlpha = 0;
    this.x = 0; this.targetX = 0;
    this.scale = 1; this.targetScale = 1;
    this.single = false;
    this.pos = 0;                 // first visible page
    this.turn = 0; this.turnTarget = 0;
    this.turning = 0;             // +1 forward, -1 back, 0 idle
    this.commit = true;
    this.drag = null;             // active pointer drag on the pages
    this.tease = 0;
    this.section = null;
    this.key = null;
    this.pages = [];
    this.hover = null;
    this.mouse = { x: 0, y: 0 };
    this.tilt = 0; this.tiltX = 0;
    this.onTurn = null;
  }

  get step() { return this.single ? 1 : 2; }

  show(key, at) {
    const sec = this.content[key];
    if (!sec) return;
    const same = this.key === key && this.open;
    this.key = key;
    this.section = sec.title || key;
    this.pages = sec.pages.slice();
    if (!this.single && this.pages.length % 2) this.pages.push(null);
    if (!same) this.pos = 0;
    if (at === 'last') this.pos = this.lastPos();
    this.pos = this.align(this.pos);
    this.turning = 0; this.turn = 0; this.drag = null;
    this.refresh();
    this.open = true;
    this.targetAlpha = 1;
    // a small lift of the corner, so it is obvious the pages can be taken hold of
    this.tease = (!same && this.canNext()) ? 1.2 : 0;
  }

  hide() {
    this.open = false;
    this.targetAlpha = 0;
    this.drag = null;
  }

  lastPos() {
    const real = this.content[this.key].pages.length;
    return this.single ? real - 1 : Math.floor((real - 1) / 2) * 2;
  }
  align(p) { return clamp(this.single ? p : p - (p % 2), 0, Math.max(0, this.pages.length - 1)); }

  setSingle(single) {
    if (single === this.single) return;
    const page = this.pos;
    this.single = single;
    if (this.key) {
      this.pages = this.content[this.key].pages.slice();
      if (!single && this.pages.length % 2) this.pages.push(null);
      this.pos = this.align(page);
      this.turning = 0; this.turn = 0; this.drag = null;
      this.refresh();
    }
  }

  refresh() {
    const p = this.pages, s = this.pos, sec = this.section;
    if (this.single) {
      this.right.set(p, s, s, sec);
    } else {
      this.left.set(p, s, s, sec);
      this.right.set(p, s + 1, s + 1, sec);
    }
    this.turner.mat.uniforms.uTurn.value = 0;
    this.turner.mesh.visible = false;
    this.updateCounter();
  }

  updateCounter() {
    const n = this.content[this.key]?.pages.length || 0;
    let label;
    if (this.single) label = `${this.pos + 1} of ${n}`;
    else {
      const a = this.pos + 1, b = Math.min(n, this.pos + 2);
      label = a === b ? `${a} of ${n}` : `${a} and ${b} of ${n}`;
    }
    const c = labelTexture(label, 0.36, 0.06);
    const ctx = this.counterCanvas.getContext('2d');
    ctx.clearRect(0, 0, this.counterCanvas.width, this.counterCanvas.height);
    ctx.drawImage(c, 0, 0);
    this.counterTex.needsUpdate = true;
  }

  canNext() { return this.pos + this.step < this.pages.length; }
  canPrev() { return this.pos > 0; }

  // Arrange the turning sheet for a turn in direction dir, without animating.
  arm(dir) {
    const p = this.pages, s = this.pos, sec = this.section;
    if (dir > 0) {
      if (this.single) { this.turner.set(p, s, -1, sec); this.right.set(p, s + 1, s + 1, sec); }
      else { this.turner.set(p, s + 1, s + 2, sec); this.right.set(p, s + 3, s + 3, sec); }
      this.turn = 0;
    } else {
      if (this.single) { this.turner.set(p, s - 1, -1, sec); }
      else { this.turner.set(p, s - 1, s, sec); this.left.set(p, s - 2, s - 2, sec); }
      this.turn = 1;
    }
    this.turner.mesh.visible = true;
    this.turning = dir;
    this.tease = 0;
  }

  next() {
    if (this.turning || !this.canNext()) return false;
    this.arm(1); this.turnTarget = 1; this.commit = true;
    this.onTurn?.();
    return true;
  }

  prev() {
    if (this.turning || !this.canPrev()) return false;
    this.arm(-1); this.turnTarget = 0; this.commit = true;
    this.onTurn?.();
    return true;
  }

  finishTurn() {
    if (this.commit) this.pos += this.turning * this.step;
    this.turning = 0;
    this.refresh();
  }

  portalVisible() {
    const s = this.pos;
    const vis = this.single ? [this.pages[s]] : [this.pages[s], this.pages[s + 1]];
    return vis.some(p => p && p.portal);
  }

  setMouse(nx, ny) { this.mouse = { x: nx, y: ny }; }

  // geom.book is a region in UI units: x in -1..1, y in -yHalf..yHalf
  fit(geom) {
    const b = geom.book;
    this.setSingle(b.single);
    const yH = 1 / geom.aspect;
    const bw = (b.x1 - b.x0) / 2;                 // fraction of full width
    const bh = (b.y1 - b.y0) / (2 * yH);          // fraction of full height
    const needW = this.single ? PW * 1.08 : PW * 2.14;
    const needH = PH * 1.07 + 0.2;               // pages plus the nav row under them
    const halfH = Math.max(needW / (2 * bw) / geom.aspect, needH / (2 * bh));
    this.camera.aspect = geom.aspect;
    this.camera.position.z = halfH / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.updateProjectionMatrix();
    this.halfW = halfH * geom.aspect;
    this.halfH = halfH;
    this.targetX = ((b.x0 + b.x1) / 2) * this.halfW;
    this.group.position.y = ((b.y0 + b.y1) / 2) / yH * halfH + 0.09;
    this.targetScale = 1;
    this.tilt = b.tilt || 0;
    this.tiltX = b.tiltX || 0;

    // single mode: the right page is centred, the left half is off stage
    this.book.position.x = this.single ? -PW / 2 : 0;
    this.cover.scale.set(this.single ? PW * 1.06 : PW * 2.12, PH * 1.07, 1);
    this.cover.position.x = this.single ? PW / 2 : 0;
    this.grab.scale.set(this.single ? 0.5 : 1, 1, 1);
    this.grab.position.x = this.single ? PW / 2 : 0;
    this.left.mesh.visible = !this.single;
    this.stack.forEach(m => m.visible = !(this.single && m.userData.side < 0));
    this.spine.visible = !this.single;

    const ny = -PH * 0.535 - 0.06;
    const W = this.single ? PW : PW * 2;
    const pos = this.single
      ? { prev: [-0.43, ny], next: [-0.27, ny], close: [0.37, ny], enter: [0.03, ny] }
      : { prev: [-0.93, ny], next: [-0.77, ny], close: [0.87, ny], enter: [0.45, ny] };
    this.nav.forEach(n => n.position.set(pos[n.userData.action][0], pos[n.userData.action][1], 0.02));
    this.counter.position.set(this.single ? 0.02 : 0, ny, 0.02);
  }

  // --- pointer ---

  localX(nx, ny) {
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hit = this.raycaster.intersectObject(this.grab, false);
    if (!hit.length) return null;
    const p = this.book.worldToLocal(hit[0].point.clone());
    return p.x;
  }

  pointer(nx, ny) {
    if (!this.open) { this.hover = null; return null; }
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const hit = this.raycaster.intersectObjects(this.nav.filter(n => n.visible), false);
    this.nav.forEach(n => n.material.uniforms.uHover.value = 0);
    if (hit.length) {
      hit[0].object.material.uniforms.uHover.value = 1;
      this.hover = hit[0].object.userData.action;
    } else if (this.localX(nx, ny) !== null) {
      this.hover = 'page';
    } else this.hover = null;
    return this.hover;
  }

  click() {
    if (!this.hover || this.hover === 'page') return null;
    const a = this.hover;
    if (a === 'next') this.next();
    else if (a === 'prev') this.prev();
    return a;
  }

  // Pages follow the finger. A drag that goes far enough, or is flicked,
  // completes the turn; anything else settles back where it came from.
  dragStart(nx, ny, time) {
    if (!this.open || this.turning) return false;
    const x = this.localX(nx, ny);
    if (x === null) return false;
    this.drag = { x0: x, x, t: time, vx: 0, armed: 0, lastT: time };
    return true;
  }

  dragMove(nx, ny, time) {
    const d = this.drag;
    if (!d) return;
    const x = this.localX(nx, ny);
    if (x === null) return;
    const dtt = Math.max(1e-3, time - d.lastT);
    d.vx = d.vx * 0.6 + ((x - d.x) / dtt) * 0.4;
    d.x = x; d.lastT = time;
    const dx = x - d.x0;
    if (!d.armed && Math.abs(dx) > 0.035) {
      if (dx < 0 && this.canNext()) { this.arm(1); d.armed = 1; this.onTurn?.(); }
      else if (dx > 0 && this.canPrev()) { this.arm(-1); d.armed = -1; this.onTurn?.(); }
      else d.armed = 2;             // nowhere to go: absorb the drag
    }
    const span = this.single ? PW * 1.25 : PW * 1.7;
    if (d.armed === 1) this.turn = clamp(-dx / span, 0, 1);
    if (d.armed === -1) this.turn = clamp(1 - dx / span, 0, 1);
    this.turnTarget = this.turn;
  }

  // returns 'tap-next' | 'tap-prev' | 'drag' | null
  dragEnd() {
    const d = this.drag;
    this.drag = null;
    if (!d) return null;
    if (d.armed === 1 || d.armed === -1) {
      const flick = d.vx * (d.armed === 1 ? -1 : 1) > 1.4;
      const prog = d.armed === 1 ? this.turn : 1 - this.turn;
      this.commit = flick || prog > 0.33;
      this.turnTarget = (d.armed === 1) === this.commit ? 1 : 0;
      return 'drag';
    }
    if (d.armed === 2) return 'drag';
    // a tap on the outer part of a page turns it
    const W = PW;
    if (this.single) {
      if (d.x0 > W * 0.6 && this.next()) return 'tap-next';
      if (d.x0 < W * 0.4 && this.prev()) return 'tap-prev';
    } else {
      if (d.x0 > W * 0.35 && this.next()) return 'tap-next';
      if (d.x0 < -W * 0.35 && this.prev()) return 'tap-prev';
    }
    return null;
  }

  update(dt, alphaScale) {
    this.alpha = approach(this.alpha, this.targetAlpha, 5, dt);
    this.x = approach(this.x, this.open ? this.targetX : this.targetX + 0.55, 4, dt);
    this.scale = approach(this.scale, this.open ? this.targetScale : this.targetScale * 0.9, 4, dt);
    this.group.position.x = this.x;
    this.group.scale.setScalar(this.scale);
    const lean = this.drag ? 0.3 : 1;
    this.group.rotation.y = approach(this.group.rotation.y, this.tilt - this.mouse.x * 0.10 * lean, 3.2, dt);
    this.group.rotation.x = approach(this.group.rotation.x, this.tiltX + this.mouse.y * 0.07 * lean, 3.2, dt);

    // corner tease on first opening
    if (this.tease > 0 && !this.turning && !this.drag && this.alpha > 0.6) {
      this.tease -= dt;
      const p = clamp(1.2 - this.tease, 0, 1.2);
      if (p > 0.35) {
        if (!this.turner.mesh.visible) {
          const s = this.pos, pg = this.pages;
          if (this.single) this.turner.set(pg, s, -1, this.section);
          else this.turner.set(pg, s + 1, s + 2, this.section);
          this.turner.mesh.visible = true;
        }
        const k = (p - 0.35) / 0.85;
        this.turner.mat.uniforms.uTurn.value = Math.sin(k * Math.PI) * 0.09;
        this.turner.mat.uniforms.uCurl.value = Math.sin(k * Math.PI);
      }
      if (this.tease <= 0) { this.turner.mesh.visible = false; this.turner.mat.uniforms.uTurn.value = 0; this.turner.mat.uniforms.uCurl.value = 0; }
    }

    if (this.turning) {
      if (!this.drag) {
        this.turn = approach(this.turn, this.turnTarget, 6.5, dt);
        if (Math.abs(this.turn - this.turnTarget) < 0.006) {
          this.turn = this.turnTarget;
          this.finishTurn();
        }
      }
      this.turner.mat.uniforms.uTurn.value = clamp(this.turn, 0, 1);
      this.turner.mat.uniforms.uCurl.value = this.drag ? 1 : 0.6;
    }

    const a = this.alpha * alphaScale;
    this.left.mat.uniforms.uAlpha.value = a;
    this.right.mat.uniforms.uAlpha.value = a;
    this.turner.mat.uniforms.uAlpha.value = a;
    this.cover.material.opacity = a * 0.95;
    this.stack.forEach((m, i) => { m.material.opacity = a * (i % 3 === 0 ? 0.85 : 0.6); });
    this.spine.material.opacity = a * 0.8;
    this.counter.material.opacity = (this.single && this.portalVisible() && !this.turning) ? 0 : a;
    this.nav.forEach(n => {
      n.material.uniforms.uReveal.value = a;
      let show = this.open && a > 0.05;
      if (n.userData.action === 'enter') show = show && this.portalVisible() && !this.turning;
      if (n.userData.action === 'prev') show = show && this.canPrev();
      if (n.userData.action === 'next') show = show && this.canNext();
      n.visible = show;
    });
    this.group.visible = a > 0.01;
  }
}
