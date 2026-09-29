// Every number you are likely to want to change lives here.

export const CFG = {
  // --- render pipeline ---
  maxPixelRatio: 2,

  // --- character ---
  worldScale: 1 / 300,       // world units per source-image pixel
  displacement: 0.20,        // depth-map extrusion, world units
  headSegments: 110,
  bodySegments: 90,

  // idle motion (radians / world units)
  idle: {
    yaw:   { amp: 0.115, freq: 0.071 },
    pitch: { amp: 0.075, freq: 0.113 },
    roll:  { amp: 0.045, freq: 0.053 },
    bob:   { amp: 0.016, freq: 0.089 },
    sway:  { amp: 0.011, freq: 0.041 },
    mouseYaw: 0.055,         // keep small or it fights the noise
    mousePitch: 0.035
  },

  // scripted motion beats: occasional "look up and settle"
  beat: { minGap: 6.5, maxGap: 15.0, dur: 2.6, pitch: -0.20, yaw: 0.12 },

  // --- glitch ---
  glitch: {
    idle: 0.16,              // always-on baseline
    speak: 0.34,             // added while talking
    spikeDecay: 2.6,         // per second
    dither: 0.055
  },

  // --- wake sequence (seconds from first click) ---
  wake: [
    { t: 0.00, lid: 1.00, focus: 1.00 },
    { t: 0.55, lid: 0.35, focus: 0.95 },
    { t: 0.80, lid: 0.95, focus: 0.90 },
    { t: 1.25, lid: 0.20, focus: 0.72 },
    { t: 1.50, lid: 0.85, focus: 0.68 },
    { t: 2.10, lid: 0.06, focus: 0.30 },
    { t: 2.55, lid: 0.30, focus: 0.34 },
    { t: 3.10, lid: 0.00, focus: 0.09 },
    { t: 4.20, lid: 0.00, focus: 0.00 }
  ],
  firstLineAt: 3.4,

  // --- the inside of the mind ---
  mind: {
    stitch: 0.85,          // 0 = plain pixels, 1 = every pixel a full cross-stitch
    transition: 2.5        // seconds for the whole falling-asleep-and-waking arc
  },

  // --- audio ---
  audio: {
    f0: 188,                 // base pitch of the synthesised voice, Hz
    ring: 74,                // ring-modulator frequency, Hz
    crush: 0.42,             // 0..1
    voiceGain: 0.30,
    bedGain: 0.045,
    voPath: 'assets/vo/'     // drop {nodeId}.ogg here to override the synth
  }
};

export const VOWELS = {
  a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010],
  o: [570, 840, 2410],  u: [300, 870, 2240],  y: [440, 1900, 2600]
};
