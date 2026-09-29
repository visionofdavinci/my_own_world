import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, approach, lerp } from './noise.js';
import { Character, loadCharacterTextures } from './character.js';
import { Notebook } from './notebook.js';
import { Dialogue } from './dialogue.js';
import { Voice, MindMusic } from './audio.js';
import { Mind, MIND_PALETTE } from './mind.js';
import { Talk } from './talk.js';
import { compVert, compFrag } from './shaders.js';

/*
  The inside of my mind. Booted once, the first time the visitor chooses it;
  after that, leaving closes the eyes and returning opens them again.
*/

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let app = null;

export async function enterMind(content, hooks) {
  if (!app) app = await boot(content, hooks);
  app.open();
}

// Where the open book goes, in UI units (x from -1 to 1, y from -H/W to H/W).
function bookGeometry(W, H) {
  const aspect = W / H, k = 2 / W;
  const ux = px => (px - W / 2) * k, uy = py => (H / 2 - py) * k;
  const wide = aspect >= 1.1;
  const x0 = wide ? W * 0.1 : 10, x1 = wide ? W * 0.9 : W - 10;
  const y0 = wide ? 70 : 96, y1 = H - 46;
  const spreadPage = Math.min((x1 - x0) / 2.14, (y1 - y0) / 1.72);
  return {
    aspect,
    book: { x0: ux(x0), x1: ux(x1), y0: uy(y1), y1: uy(y0), single: spreadPage < 250, tilt: wide ? -0.06 : 0, tiltX: 0.04 }
  };
}

async function boot(content, hooks) {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  const $ = id => document.getElementById(id);

  const canvas = $('gl');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // palette matching is done by hand
  renderer.autoClear = true;

  const loader = new THREE.TextureLoader();
  const [rig, tex] = await Promise.all([
    fetch('assets/character/rig.json').then(r => r.json()),
    loadCharacterTextures(loader)
  ]);

  const hud = {
    root: $('mind'), places: $('m-places'), count: $('m-count'), prompt: $('m-prompt'),
    card: $('m-card'), cardKind: $('m-card').querySelector('.k'), cardTitle: $('m-card').querySelector('h3'),
    cardBody: $('m-card').querySelector('.b')
  };
  const mind = new Mind(content.mind, hud);
  const character = new Character(rig, tex);
  character.setLayout(0, 0, 1);
  mind.addGuide(character, content.mind.guide);

  const notebook = new Notebook(content.sections);
  const voice = new Voice();
  const dialogue = new Dialogue(content.dialogue);
  const now = () => performance.now() / 1000;

  /* --- the guide --- */
  let glitchSpike = 0;
  const spike = v => { glitchSpike = Math.min(1.1, glitchSpike + v); };

  function say(node, asked) {
    talk.show(node, asked, now());
    spike(asked ? 0.4 : 0.6);
    setTimeout(async () => talk.setDuration(await voice.speak(node.line, node.id)), asked ? 350 : 100);
  }
  const talk = new Talk($('m-talk'), i => {
    const r = dialogue.pick(i);
    if (!r) return;
    voice.tick(0.8);
    if (r.option.action === 'close') { say(r.next, r.option.label); return; }
    say(r.next, r.option.label);
  });
  function talkToGuide() {
    if (talk.open) return;
    const id = mind.allRead ? 'allfound' : (dialogue.seen.has('root') ? 'again' : 'root');
    say(dialogue.go(id), '');
  }

  /* --- the books --- */
  let bookOpen = false;
  const linksEl = $('links');
  function renderLinks(key) {
    linksEl.innerHTML = '';
    (content.sections[key]?.pages?.[0]?.links || []).filter(l => l.url).forEach(l => {
      const a = document.createElement('a');
      a.href = l.url; a.textContent = l.label;
      if (!l.url.startsWith('mailto:')) { a.target = '_blank'; a.rel = 'noopener'; }
      linksEl.appendChild(a);
    });
  }
  function openBook(key) {
    if (!content.sections[key]) return;
    notebook.show(key);
    bookOpen = true;
    mind.locked = true;
    mind.clearKeys();
    mind.hideCard();
    mind.markRead(key);
    hud.root.classList.add('reading');
    renderLinks(key);
    linksEl.classList.toggle('on', linksEl.children.length > 0);
    voice.tick(0.7); spike(0.4);
  }
  function closeBook() {
    if (!bookOpen) return;
    notebook.hide();
    bookOpen = false;
    mind.locked = false;
    hud.root.classList.remove('reading');
    linksEl.classList.remove('on');
    voice.tick(0.5);
    // finding the last book is worth telling her about
    if (mind.allRead && !dialogue.seen.has('allfound') && mind.guideDist < 30) say(dialogue.go('allfound'), '');
  }
  mind.onInteract = (kind, key) => {
    if (kind === 'book') openBook(key);
    else if (kind === 'guide') talkToGuide();
  };
  notebook.onTurn = () => { voice.tick(0.35); spike(0.2); };

  /* --- composite --- */
  const rtUI = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false
  });
  const U = {
    uUI: { value: rtUI.texture },
    uMind: { value: mind.rt.texture },
    uMindRes: { value: new THREE.Vector2(1, 1) },
    uMindPal: { value: MIND_PALETTE.map(c => new THREE.Color(c)) },
    uStitch: { value: CFG.mind.stitch },
    uTime: { value: 0 },
    uGlitch: { value: CFG.glitch.idle },
    uLid: { value: 1 },
    uFocus: { value: 1 },
    uDim: { value: 0 }
  };
  const compScene = new THREE.Scene();
  const comp = new THREE.Mesh(new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: U, vertexShader: compVert, fragmentShader: compFrag, depthTest: false, depthWrite: false }));
  comp.frustumCulled = false;
  compScene.add(comp);
  const compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, CFG.maxPixelRatio);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    rtUI.setSize(Math.round(w * dpr), Math.round(h * dpr));
    mind.fit(w, h, dpr);
    U.uMindRes.value.copy(mind.res);
    notebook.fit(bookGeometry(w, h));
  }
  let resizePending = false;
  window.addEventListener('resize', () => {
    if (resizePending) return;
    resizePending = true;
    requestAnimationFrame(() => { resizePending = false; resize(); });
  });
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));

  /* --- input --- */
  let running = false, trans = null, awake = false;
  const pointer = new THREE.Vector2();
  const toNdc = e => ({ x: (e.clientX / window.innerWidth) * 2 - 1, y: -(e.clientY / window.innerHeight) * 2 + 1 });
  const onHud = e => e.target instanceof Element && !!e.target.closest('button, a, #m-card, #m-talk, #m-stick, #links, #chrome, #plain, #gate');
  let bookDrag = false;

  window.addEventListener('pointermove', e => {
    if (!running) return;
    const p = toNdc(e);
    pointer.set(p.x, p.y);
    if (bookOpen) {
      if (bookDrag) { notebook.dragMove(p.x, p.y, now()); canvas.style.cursor = 'grabbing'; return; }
      const over = notebook.pointer(p.x, p.y);
      canvas.style.cursor = over === 'page' ? 'grab' : over ? 'pointer' : 'default';
      return;
    }
    canvas.style.cursor = mind.drag ? 'grabbing' : 'grab';
    mind.pointerMove(e);
  }, { passive: true });

  window.addEventListener('pointerdown', e => {
    if (!running || !awake || trans || onHud(e)) return;
    const p = toNdc(e);
    if (bookOpen) {
      const nav = notebook.pointer(p.x, p.y);
      if (nav === 'close') { closeBook(); return; }
      if (nav && nav !== 'page') { notebook.click(); return; }
      if (nav === 'page' && notebook.dragStart(p.x, p.y, now())) {
        bookDrag = true;
        try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }
      closeBook();                      // a tap outside the book puts it down
      return;
    }
    mind.pointerDown(e);
  });
  const endPointer = e => {
    if (!running) return;
    if (bookDrag) { bookDrag = false; notebook.dragEnd(); return; }
    const p = toNdc(e);
    mind.pointerUp(e, p.x, p.y);
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  window.addEventListener('wheel', e => { if (running && !bookOpen && !onHud(e)) mind.wheel(e); }, { passive: true });

  window.addEventListener('keydown', e => {
    if (!running || !awake || trans) return;
    const onButton = e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement;
    if (e.key === 'Escape') {
      if (bookOpen) closeBook(); else if (talk.open) talk.hide();
      return;
    }
    if (bookOpen) {
      if (e.key === 'ArrowRight') notebook.next();
      if (e.key === 'ArrowLeft') notebook.prev();
      return;
    }
    if (talk.open && /^[1-4]$/.test(e.key)) { if (!talk.skip()) talk.choose(Number(e.key) - 1); return; }
    if (!onButton && (e.key === 'e' || e.key === 'E' || e.key === 'Enter' || e.key === ' ')) {
      if (talk.open && talk.skip()) { e.preventDefault(); return; }
      if (mind.target) { mind.interact(); e.preventDefault(); return; }
    }
    if (!onButton || !['Enter', ' '].includes(e.key)) mind.keyDown(e);
  });
  window.addEventListener('keyup', e => mind.keyUp(e));
  window.addEventListener('blur', () => mind.clearKeys());

  hud.prompt.addEventListener('click', e => { e.stopPropagation(); mind.interact(); });

  // the pad on touch screens
  const stickEl = $('m-stick'), knob = stickEl.querySelector('span');
  let stickId = null;
  const stickMove = e => {
    const r = stickEl.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    knob.style.transform = `translate(${dx * 36}px, ${dy * 36}px)`;
    mind.setStick(dx, dy);
  };
  stickEl.addEventListener('pointerdown', e => { e.stopPropagation(); stickId = e.pointerId; stickEl.setPointerCapture(e.pointerId); stickMove(e); });
  stickEl.addEventListener('pointermove', e => { if (e.pointerId === stickId) { e.stopPropagation(); stickMove(e); } });
  const stickEnd = e => { if (e.pointerId !== stickId) return; stickId = null; knob.style.transform = ''; mind.setStick(0, 0); };
  stickEl.addEventListener('pointerup', stickEnd);
  stickEl.addEventListener('pointercancel', stickEnd);

  $('m-cv').addEventListener('click', () => leave());

  const muteBtn = $('mute');
  let muted = false;
  muteBtn?.addEventListener('click', () => {
    muted = !muted;
    voice.setMuted(muted);
    muteBtn.textContent = `sound ${muted ? 'off' : 'on'}`;
  });

  /* --- eyes opening and closing --- */
  const WAKE_FIRST = CFG.wake;                               // the first time: a few slow blinks
  const WAKE_AGAIN = [{ t: 0, lid: 1, focus: 0.8 }, { t: 0.5, lid: 0.3, focus: 0.5 }, { t: 1.1, lid: 0, focus: 0 }];
  const SLEEP = [{ t: 0, lid: 0, focus: 0 }, { t: 0.7, lid: 1, focus: 0.6 }];
  function sample(kf, t) {
    if (t <= kf[0].t) return kf[0];
    for (let i = 1; i < kf.length; i++) {
      if (t <= kf[i].t) {
        const a = kf[i - 1], b = kf[i], q = (t - a.t) / (b.t - a.t), e = q * q * (3 - 2 * q);
        return { lid: lerp(a.lid, b.lid, e), focus: lerp(a.focus, b.focus, e) };
      }
    }
    return kf[kf.length - 1];
  }
  let firstTime = true;

  function open() {
    $('stage').hidden = false;
    document.body.classList.add('in-mind');
    voice.unlock().then(() => {
      if (!mind.music) mind.music = new MindMusic(voice, (i, v) => mind.onNote(i, v));
      mind.enter();
    });
    mind.enter();
    resize();
    const kf = (firstTime && !reduced && !debug) ? WAKE_FIRST : WAKE_AGAIN;
    trans = { kf, t: 0, end: kf[kf.length - 1].t, onEnd: () => {
      awake = true;
      if (firstTime) { firstTime = false; say(dialogue.start(), ''); }
    } };
    if (!running) { running = true; clock.getDelta(); requestAnimationFrame(frame); }
    hooks?.ready?.();
  }

  function leave() {
    if (trans) return;
    closeBook();
    talk.hide();
    awake = false;
    trans = { kf: SLEEP, t: 0, end: SLEEP[1].t, onEnd: () => {
      running = false;
      mind.leave();
      document.body.classList.remove('in-mind');
      $('stage').hidden = true;
      hooks?.showCV?.();
    } };
  }

  /* --- loop --- */
  const clock = new THREE.Clock();
  let lastGlitchPush = 0, uiClear = true;

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.getElapsedTime();

    if (trans) {
      trans.t += dt;
      const v = sample(trans.kf, trans.t);
      U.uLid.value = v.lid; U.uFocus.value = v.focus;
      if (trans.t >= trans.end) { const done = trans.onEnd; trans = null; done(); }
    }

    // she speaks, her mouth follows, the glitch follows her voice
    const energy = voice.sample();
    character.speak = approach(character.speak, energy, 22, dt);
    glitchSpike = Math.max(0, glitchSpike - CFG.glitch.spikeDecay * dt);
    const g = clamp(CFG.glitch.idle * (reduced ? 0.4 : 0.8) + character.speak * CFG.glitch.speak + glitchSpike, 0, 1.2);
    character.glitch = g;
    U.uGlitch.value = 0.05 + glitchSpike * 0.5;
    U.uTime.value = t;
    if (t - lastGlitchPush > 0.1) { voice.setGlitch(g * 0.5); lastGlitchPush = t; }
    character.setMouse(0, 0.2);
    character.update(dt, t, reduced);

    talk.update(now(), dt);
    hud.root.classList.toggle('talking', talk.open && mind.target?.kind === 'guide');
    if (talk.open && mind.guideDist > 11) talk.hide();

    mind.update(dt, t, 1);
    mind.render(renderer);

    U.uDim.value = approach(U.uDim.value, bookOpen ? 1 : 0, 6, dt);
    notebook.setMouse(pointer.x * 0.4, pointer.y * 0.4);
    notebook.update(dt, 1);
    if (notebook.alpha > 0.01) {
      renderer.setRenderTarget(rtUI);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(notebook.scene, notebook.camera);
      uiClear = false;
    } else if (!uiClear) {
      renderer.setRenderTarget(rtUI);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      uiClear = true;
    }

    renderer.setRenderTarget(null);
    renderer.render(compScene, compCam);
  }

  resize();
  if (debug) window.__persona = { mind, notebook, dialogue, talk, openBook, closeBook, say, leave, get bookOpen() { return bookOpen; } };
  return { open };
}
