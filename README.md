# Persona

The personal site of Ioana-Teodora Gomoi. The start screen offers two ways in.

1. **Read my CV** opens a plain page with education, experience, projects, passions and contact details. It loads no 3D code, so it appears at once. `?cv` in the address opens it directly.
2. **Enter my mind** opens a 3D landscape. Vis stands in it as a guide, explains how to move, and points to five books hidden near the places in the landscape. Each book holds one part of the CV.

## Running it

It fetches JSON, so it needs a server.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Editing content

Everything you will want to change is data.

| File | What it holds |
|---|---|
| `content/education.json` | Degrees |
| `content/experience.json` | The lab, teaching, events, hackathons, skills |
| `content/projects.json` | Research projects and software |
| `content/passions.json` | Who I am, art, music, background |
| `content/contact.json` | Contact details. Each entry in `links` with a `url` becomes a button under the open book and a link at the top of the CV |
| `content/dialogue.json` | What the guide says and the choices offered |
| `content/mind.json` | The places, the five books (`books`) and where the guide stands (`guide`) |
| `src/config.js` | Timing, glitch amount, stitch strength, audio |

The CV page and the books read the same five files, so a change appears in both.

A page looks like this.

```json
{ "eyebrow": "2023 to 2026", "title": "BSc Artificial Intelligence", "meta": "Vrije Universiteit Amsterdam",
  "body": ["Paragraph one.", "Paragraph two."], "tags": ["Honours CS"] }
```

### Writing rules

All visible text follows the same rules. Say things literally, with no metaphors or flourishes. Do not use hyphens or dashes, and only use a colon to introduce a list. Names that contain a hyphen are the exception.

### Moving a book

In `content/mind.json`, each book has `x` and `z` (metres, the tree is at 0, 0) and `near`, the place it belongs to. Keep books about 3 metres away from anything solid.

## How the start works

`src/start.js` loads the content and renders the CV (`src/plain.js`) without touching Three.js. While the visitor reads the two options, it fetches `src/main.js` in the background, so entering the mind is quick. If WebGL fails, the visitor lands on the CV with a short note.

## The inside of the mind

`src/mind.js` builds the landscape entirely in code. It is rendered into a small buffer and the composite pass in `src/shaders.js` draws every low resolution pixel as an X, dithered into a 16 colour palette. `CFG.mind.stitch` controls how strong the effect is.

**The guide.** Her portrait (`src/character.js`, two planes with depth maps, head on its own pivot) sits on a body built in `addGuide`, a glitching dress and legs. She turns to face the visitor, her mouth follows the voice, and the glitch follows her speech. Her conversation is shown by `src/talk.js`. She greets the visitor on arrival, says something different on a second visit, and says something when all five books have been read.

**The books.** Five open books float above plinths, each with a light beam that disappears once it has been read. Walking close shows a prompt (E, Enter or space on a keyboard, a tap on touch screens). The book opens as the flippable notebook (`src/notebook.js`) over the dimmed world. Drag a page to turn it, or use the arrow keys. Escape or a tap outside the book closes it.

**The places.** The tree of life, the code garden, the listening ring (generative music, `MindMusic` in `src/audio.js`), the colour field, the flight field and the loom. Each shows a short text when you walk close.

**Controls.** Drag to look. WASD or the arrow keys to walk, the left and right arrows turn. Shift to run. On touch screens there is a pad in the lower left. The list on the left walks you to any book, place or the guide.

## The voice

She is synthesised in the browser: formants over a sawtooth, ring modulated, through a bit crusher. To use recorded lines, add `assets/vo/<nodeId>.ogg` files matching the node names in `dialogue.json`. Missing files fall back to the synth.

## Accessibility

- The CV page is plain HTML with a section menu.
- In the mind, the guide's text, her choices, the place texts and the list of books and places are ordinary HTML and reachable by keyboard. Keys 1 to 4 pick a choice.
- `prefers-reduced-motion` shortens the opening and calms the motion.
- Sound never starts before a click and can be muted in the corner.

## Checking it

`?debug` exposes `window.__persona` and shortens the opening, for automated screenshots. It changes nothing else.
