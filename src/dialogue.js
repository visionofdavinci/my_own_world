// The conversation is data. Adding a branch means editing content/dialogue.json.
// This keeps a little memory of the conversation so that she can answer a
// second visit differently, and so choices already explored read as explored.

export class Dialogue {
  constructor(data) {
    this.data = data;
    this.id = null;
    this.seen = new Set();          // nodes she has already said
    this.lastAsked = '';            // the label the visitor just chose
  }
  get node() { return this.data.nodes[this.id]; }

  start() { return this.go(this.data.start); }

  go(id) {
    if (!this.data.nodes[id]) id = this.data.start;
    const again = this.seen.has(id);
    this.id = id;
    this.seen.add(id);
    const n = this.node;
    return {
      id,
      line: (again && n.again) ? n.again : n.line,
      options: (n.options || []).map(o => ({ ...o, seen: o.next !== this.data.start && this.seen.has(o.next) }))
    };
  }

  pick(i) {
    const o = this.node?.options?.[i];
    if (!o) return null;
    this.lastAsked = o.label;
    return { option: o, next: this.go(o.next) };
  }
}
