// Two doors: the plain CV, or the inside of my mind. The CV never waits
// for the 3D code; the mind is fetched in the background while you choose.
import { loadContent, renderPlain } from './plain.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let content = null;
let mindModule = null;
const loadMind = () => (mindModule ??= import('./main.js'));

function setUrl(q) { history.replaceState(null, '', q ? `?${q}` : location.pathname); }

function showCV(note) {
  $('gate').classList.add('gone');
  document.body.classList.add('plain');
  $('cv-note').textContent = note || '';
  $('cv-note').hidden = !note;
  setUrl('cv');
  window.scrollTo(0, 0);
  $('plain').focus({ preventScroll: true });
}

async function enterMind() {
  $('gate').classList.add('gone');
  document.body.classList.remove('plain');
  setUrl(params.has('debug') ? 'debug' : '');
  $('loading').hidden = false;
  try {
    const m = await loadMind();
    await m.enterMind(content, {
      showCV: () => showCV(),
      ready: () => { $('loading').hidden = true; }
    });
  } catch (err) {
    console.error(err);
    $('loading').hidden = true;
    showCV('The 3D version could not start in this browser, so here is the CV.');
  }
}

async function init() {
  try { content = await loadContent(); }
  catch (err) { console.error(err); $('gate-status').textContent = 'The content could not be loaded. Please reload the page.'; return; }
  renderPlain(content, { onMind: enterMind });
  $('go-cv').addEventListener('click', () => showCV());
  $('go-mind').addEventListener('click', enterMind);
  $('gate').classList.add('ready');
  if (params.has('cv') || params.has('plain')) showCV();
  // warm the 3D code up while the visitor reads the two options
  setTimeout(() => loadMind().catch(() => {}), 400);
}
init();
