Drop recorded voice lines here as <nodeId>.ogg, matching the keys in
content/dialogue.json — root.ogg, projects.ogg, self.ogg, back.ogg, etc.

Any file present is used instead of the in-browser synth. Anything missing
falls back automatically, so you can record them a few at a time.

Suggested processing chain for a TTS render:
  pitch down ~3 semitones -> formant shift -> ring mod around 60-90 Hz
  -> bitcrush to 8 bit -> granular stutter on the line endings
