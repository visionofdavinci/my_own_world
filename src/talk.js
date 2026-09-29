// The guide's side of the conversation, as ordinary HTML: what you asked,
// her answer typing out at the speed she speaks, then your choices.

export class Talk {
  constructor(el, onChoose) {
    this.el = el;
    this.askedEl = el.querySelector('.asked');
    this.lineEl = el.querySelector('.line');
    this.optsEl = el.querySelector('.opts');
    this.onChoose = onChoose;
    this.text = ''; this.shown = 0; this.rate = 40;
    this.typing = false; this.waitUntil = 0;
    this.options = [];
    this.open = false;
    this.lineEl.addEventListener('click', () => this.skip());
  }

  show(node, asked, now) {
    this.text = node.line;
    this.options = node.options || [];
    this.shown = 0;
    this.typing = true;
    this.waitUntil = now + (asked ? 0.35 : 0.1);
    this.rate = 40;
    this.askedEl.textContent = asked ? '> ' + asked : '';
    this.askedEl.hidden = !asked;
    this.lineEl.textContent = '';
    this.lineEl.setAttribute('aria-label', node.line);
    this.optsEl.innerHTML = '';
    this.el.classList.add('on');
    this.el.setAttribute('aria-hidden', 'false');
    this.open = true;
  }

  hide() {
    this.open = false;
    this.typing = false;
    this.el.classList.remove('on');
    this.el.setAttribute('aria-hidden', 'true');
  }

  setDuration(sec) {
    if (!sec || !isFinite(sec)) return;
    this.rate = Math.min(80, Math.max(22, this.text.length / Math.max(0.6, sec * 0.92)));
  }

  skip() {
    if (!this.typing) return false;
    this.shown = this.text.length;
    return true;
  }

  choose(i) {
    if (!this.open || this.typing || !this.options[i]) return false;
    this.onChoose(i);
    return true;
  }

  renderOptions() {
    this.optsEl.innerHTML = '';
    this.options.forEach((o, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span class="n">${i + 1}</span>`;
      b.append(o.label);
      if (o.seen) b.classList.add('seen');
      b.addEventListener('click', e => { e.stopPropagation(); this.choose(i); });
      li.appendChild(b);
      this.optsEl.appendChild(li);
    });
    if (!this.options.length) {
      // a closing line: the panel goes away by itself
      clearTimeout(this.closer);
      this.closer = setTimeout(() => { if (!this.typing && !this.options.length) this.hide(); }, 2600);
    }
  }

  update(now, dt) {
    if (!this.typing || now < this.waitUntil) return;
    const before = Math.floor(this.shown);
    this.shown = Math.min(this.text.length, this.shown + this.rate * dt);
    if (Math.floor(this.shown) !== before) this.lineEl.textContent = this.text.slice(0, Math.floor(this.shown));
    if (this.shown >= this.text.length) {
      this.typing = false;
      this.lineEl.textContent = this.text;
      this.renderOptions();
    }
  }
}
