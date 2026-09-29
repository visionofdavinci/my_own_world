import * as THREE from 'three';
import { CFG } from './config.js';
import { fbm1, clamp, approach, lerp } from './noise.js';
import { charVert, charFrag } from './shaders.js';

const smoothstep = t => t * t * (3 - 2 * t);

export class Character {
  constructor(rig, tex) {
    const S = CFG.worldScale;
    const { w: W, h: H } = rig.source;

    this.root = new THREE.Group();        // layout: position and scale
    this.inner = new THREE.Group();       // holds the figure, centred on the origin
    this.root.add(this.inner);
    this.pivot = new THREE.Group();       // head rotates about the base of the neck
    this.uniforms = {};

    const toWorld = (px, py) => new THREE.Vector2((px - W / 2) * S, (H / 2 - py) * S);

    const build = (box, maps, hasFace) => {
      const [a0, a1, b0, b1] = box;
      const wPx = b1 - b0, hPx = a1 - a0;
      const seg = hasFace ? CFG.headSegments : CFG.bodySegments;
      const geo = new THREE.PlaneGeometry(wPx * S, hPx * S, seg, Math.round(seg * hPx / wPx));

      const u = {
        uMap:   { value: maps.map },
        uDepth: { value: maps.depth },
        uDisp:  { value: CFG.displacement * (hasFace ? 1.0 : 0.72) },
        uTime:  { value: 0 },
        uGlitch:{ value: CFG.glitch.idle }
      };
      if (hasFace) {
        u.uMouth = { value: maps.mouth };
        u.uEyes  = { value: maps.eyes };
        u.uSpeak = { value: 0 };
        u.uEye   = { value: 0 };
      }

      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: charVert,
        fragmentShader: charFrag,
        defines: hasFace ? { HAS_FACE: '' } : {},
        transparent: false,
        depthWrite: true,
        depthTest: true
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      const c = toWorld((b0 + b1) / 2, (a0 + a1) / 2);
      mesh.position.set(c.x, c.y, 0);
      Object.assign(this.uniforms, hasFace ? { head: u } : { body: u });
      return mesh;
    };

    this.bodyMesh = build(rig.body.box, { map: tex.body, depth: tex.bodyDepth }, false);
    this.headMesh = build(rig.head.box, {
      map: tex.head, depth: tex.headDepth, mouth: tex.mouth, eyes: tex.eyes
    }, true);

    // reparent the head onto its pivot at the base of the neck
    const [ha0, , hb0] = rig.head.box;
    const hw = rig.head.box[3] - hb0;
    const hh = rig.head.box[1] - ha0;
    const pv = toWorld(hb0 + rig.head.pivotU * hw, ha0 + (1 - rig.head.pivotV) * hh);
    this.pivot.position.set(pv.x, pv.y, 0.03);
    this.headMesh.position.sub(new THREE.Vector3(pv.x, pv.y, 0));
    this.pivot.add(this.headMesh);

    this.inner.add(this.bodyMesh, this.pivot);

    // centre the whole figure on the origin, inside the layout group
    const yTop = (H / 2 - rig.topY) * S;
    const yBot = (H / 2 - rig.botY) * S;
    this.inner.position.y = -(yTop + yBot) / 2;

    // state
    this.targetX = 0; this.targetY = 0;
    this.x = 0; this.y = 0;
    this.speak = 0;
    this.glitch = CFG.glitch.idle;
    this.eye = 0;
    this.beatAt = 4 + Math.random() * 6;
    this.beat = 0;
    this.mouse = new THREE.Vector2();
    this.scale = 1;
    this.targetScale = 1;
  }

  setLayout(x, y, scale) { this.targetX = x; this.targetY = y; this.targetScale = scale; }
  setMouse(nx, ny) { this.mouse.set(nx, ny); }

  update(dt, t, reduced) {
    const I = CFG.idle;
    const damp = reduced ? 0.25 : 1;

    // scripted beat: an occasional slow look-up that settles back
    this.beatAt -= dt;
    if (this.beatAt <= 0 && this.beat <= 0 && !reduced) {
      this.beat = CFG.beat.dur;
      this.beatAt = CFG.beat.minGap + Math.random() * (CFG.beat.maxGap - CFG.beat.minGap);
    }
    let bp = 0, by = 0;
    if (this.beat > 0) {
      this.beat -= dt;
      const p = 1 - clamp(this.beat / CFG.beat.dur, 0, 1);
      const env = Math.sin(smoothstep(clamp(p, 0, 1)) * Math.PI);
      bp = CFG.beat.pitch * env;
      by = CFG.beat.yaw * env;
    }

    const p = this.pivot;
    p.rotation.y = approach(p.rotation.y,
      fbm1(t * I.yaw.freq, 1) * I.yaw.amp * damp + this.mouse.x * I.mouseYaw + by, 5, dt);
    p.rotation.x = approach(p.rotation.x,
      fbm1(t * I.pitch.freq, 2) * I.pitch.amp * damp + this.mouse.y * I.mousePitch + bp, 5, dt);
    p.rotation.z = approach(p.rotation.z, fbm1(t * I.roll.freq, 3) * I.roll.amp * damp, 4, dt);

    this.x = approach(this.x, this.targetX, 3.4, dt);
    this.y = approach(this.y, this.targetY, 3.4, dt);
    this.scale = approach(this.scale, this.targetScale, 3.4, dt);
    this.root.position.x = this.x + fbm1(t * I.sway.freq, 4) * I.sway.amp * damp;
    this.root.position.y = this.y + fbm1(t * I.bob.freq, 5) * I.bob.amp * damp;
    this.root.scale.setScalar(this.scale);

    // rare eye flare, gated on the glitch level
    this.eye = approach(this.eye, 0, 3.0, dt);
    if (!reduced && Math.random() < dt * (0.25 + this.glitch * 1.6)) this.eye = 0.5 + Math.random() * 0.5;

    const hu = this.uniforms.head, bu = this.uniforms.body;
    hu.uTime.value = bu.uTime.value = t;
    hu.uGlitch.value = bu.uGlitch.value = this.glitch;
    hu.uSpeak.value = this.speak;
    hu.uEye.value = this.eye;
  }
}

export function loadCharacterTextures(loader) {
  const P = 'assets/character/';
  const nearest = t => {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    return t;
  };
  const linear = t => {
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    return t;
  };
  const get = (f, fn) => new Promise((res, rej) => loader.load(P + f, tx => res(fn(tx)), undefined, rej));

  return Promise.all([
    get('head.png', nearest), get('head_depth.png', linear),
    get('body.png', nearest), get('body_depth.png', linear),
    get('mouth_mask.png', linear), get('eyes_mask.png', linear),
    get('palette.png', nearest)
  ]).then(([head, headDepth, body, bodyDepth, mouth, eyes, palette]) =>
    ({ head, headDepth, body, bodyDepth, mouth, eyes, palette }));
}

export { lerp };
