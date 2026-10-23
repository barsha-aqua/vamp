// A short synthesized "wings and wind" whoosh (filtered noise with a flutter). No audio files.
let ac = null, muted = false;
export function initAudio() {
  try { ac ||= new (window.AudioContext || window.webkitAudioContext)(); ac.resume?.(); } catch { /* no audio */ }
}
export const setMuted = (m) => { muted = m; };

export function whoosh(kind) {
  if (!ac || muted) return;
  const t = ac.currentTime, dur = 1.5, out = kind === 'out';
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(); src.buffer = buf;

  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(out ? 280 : 2600, t);
  bp.frequency.exponentialRampToValueAtTime(out ? 2600 : 280, t + dur);

  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.3, t + dur * 0.3);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  // Wing flutter: a ~13 Hz tremolo on top of the envelope.
  const flutter = ac.createGain(); flutter.gain.value = 0.65;
  const lfo = ac.createOscillator(); lfo.frequency.value = 13;
  const depth = ac.createGain(); depth.gain.value = 0.35;
  lfo.connect(depth); depth.connect(flutter.gain);

  src.connect(bp); bp.connect(env); env.connect(flutter); flutter.connect(ac.destination);
  src.start(t); lfo.start(t); src.stop(t + dur); lfo.stop(t + dur);
}
