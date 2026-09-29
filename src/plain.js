// The CV as a plain page. This module loads no 3D code, so the page
// appears as soon as the text has arrived.

export const BOOKS = ['education', 'experience', 'projects', 'passions', 'contact'];

const json = p => fetch(p).then(r => {
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  return r.json();
});

export async function loadContent() {
  const [dialogue, mind, ...books] = await Promise.all([
    json('content/dialogue.json'),
    json('content/mind.json'),
    ...BOOKS.map(k => json(`content/${k}.json`))
  ]);
  const sections = {};
  BOOKS.forEach((k, i) => sections[k] = books[i]);
  return { sections, dialogue, mind };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderPlain(content, { onMind } = {}) {
  const root = document.getElementById('cv-body');
  if (!root) return;
  const S = content.sections;
  const links = (S.contact.pages[0].links || []).filter(l => l.url);
  const linkLabel = l => l.url.startsWith('mailto:') ? l.url.slice(7) : l.url.replace(/^https?:\/\//, '');

  let html = `
    <header class="cv-head">
      <h1>Ioana-Teodora Gomoi</h1>
      <p class="cv-lede">AI researcher and digital artist. MSc Artificial Intelligence at the University of Amsterdam.</p>
      <p class="cv-links">${links.map(l => `<a href="${esc(l.url)}"${l.url.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(linkLabel(l))}</a>`).join('')}</p>
      <button type="button" class="cv-mind">enter my mind</button>
    </header>
    <nav class="cv-nav" aria-label="Sections">${BOOKS.map(k => `<a href="#cv-${k}">${esc(S[k].title.toLowerCase())}</a>`).join('')}</nav>`;

  for (const key of BOOKS) {
    const s = S[key];
    html += `<section class="cv-sec" id="cv-${key}"><h2>${esc(s.title.toLowerCase())}</h2>`;
    for (const p of s.pages) {
      if (!p) continue;
      html += `<article class="cv-item"><div class="cv-row"><h3>${esc(p.title)}</h3>${p.eyebrow ? `<span class="cv-when">${esc(p.eyebrow)}</span>` : ''}</div>`;
      if (p.meta) html += `<p class="cv-meta">${esc(p.meta)}</p>`;
      for (const b of (p.body || [])) html += `<p>${esc(b)}</p>`;
      if (p.tags?.length) html += `<p class="cv-tags">${p.tags.map(t => `<span>${esc(t)}</span>`).join('')}</p>`;
      html += `</article>`;
    }
    html += `</section>`;
  }
  html += `<footer class="cv-foot"><button type="button" class="cv-mind">enter my mind</button></footer>`;
  root.innerHTML = html;
  root.querySelectorAll('.cv-mind').forEach(b => b.addEventListener('click', () => onMind?.()));
}
