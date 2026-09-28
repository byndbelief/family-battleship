// Sound effects, synthesized on the fly with Web Audio (no files to download).
// Browsers only allow sound after the player taps something, so effects before the
// first tap are silently skipped. A 🔊 button on every page mutes them; the choice is
// remembered on this device.

let ac = null, master = null, noiseBuf = null;
const KEY = 'sfx.muted';
let muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

function ctx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return ac;
}
const unlock = () => { const a = ctx(); if (a && a.state === 'suspended') a.resume(); };
addEventListener('pointerdown', unlock, { capture: true });
addEventListener('keydown', unlock, { capture: true });

// ---- building blocks
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(type, f0, f1, t, dur, vol = 0.3, a = 0.005) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, a, vol, dur); o.connect(g).connect(master); o.start(t); o.stop(t + a + dur + 0.05);
  return o;
}
function noise(t, dur, vol, filter = 'lowpass', f0 = 1000, f1 = f0, q = 0.8, a = 0.005) {
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = noiseBuf; s.loop = true; f.type = filter; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, a, vol, dur); s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + a + dur + 0.05);
}
const notes = (type, freqs, t, step, dur, vol) => freqs.forEach((f, i) => tone(type, f, f, t + i * step, dur, vol));

const SOUNDS = {
  // Hilltop Duel / Battleship
  cannon(t) { noise(t, 0.35, 0.8, 'lowpass', 900, 120); tone('sine', 150, 40, t, 0.3, 0.7); },
  whistle(t, o = {}) { const d = o.dur || 0.9; tone('sine', 1500, 600, t, d, 0.07, 0.08); },
  boom(t, o = {}) { const s = o.size || 1; noise(t, 0.6 + 0.5 * s, 0.9, 'lowpass', 1400, 60); tone('sine', 90, 28, t, 0.5 + 0.4 * s, 0.8); },
  splash(t) { noise(t, 0.45, 0.5, 'bandpass', 2400, 700, 1.2, 0.02); noise(t + 0.05, 0.25, 0.2, 'highpass', 3000, 5000); },
  thud(t) { tone('sine', 110, 55, t, 0.18, 0.5); },
  // Putt Post
  putt(t, o = {}) { const v = Math.min(1, o.power ?? 0.6); tone('triangle', 900, 600, t, 0.05, 0.25 + 0.3 * v); noise(t, 0.04, 0.2 * v, 'highpass', 2000); },
  clack(t) { tone('square', 1300, 900, t, 0.03, 0.08); },
  boing(t) { tone('sine', 300, 700, t, 0.15, 0.2); },
  cup(t) { tone('sine', 520, 260, t, 0.12, 0.3); tone('triangle', 1400, 1400, t + 0.12, 0.05, 0.12); tone('triangle', 1250, 1250, t + 0.2, 0.05, 0.1); },
  plunk(t) { noise(t, 0.3, 0.35, 'bandpass', 900, 300, 2, 0.01); tone('sine', 400, 120, t, 0.25, 0.2); },
  // Shared
  fanfare(t) { notes('triangle', [523, 659, 784, 1047], t, 0.11, 0.18, 0.22); tone('triangle', 1047, 1047, t + 0.44, 0.6, 0.2); notes('sine', [262, 330, 392], t + 0.44, 0, 0.6, 0.12); },
  birdie(t) { notes('triangle', [784, 988, 1175], t, 0.08, 0.14, 0.2); },
  lose(t) { notes('triangle', [392, 370, 349, 311], t, 0.22, 0.3, 0.2); },
  pop(t) { tone('sine', 700, 1400, t, 0.06, 0.2); noise(t + 0.05, 0.25, 0.15, 'highpass', 4000); },
  chime(t) { notes('sine', [1319, 1760, 2093], t, 0.07, 0.35, 0.16); },
  curse(t) { [0, 7].forEach((d) => { const o = tone('sawtooth', 110 + d, 70, t, 0.9, 0.1, 0.05); o.detune.value = d * 4; }); noise(t, 0.9, 0.1, 'bandpass', 300, 120, 4, 0.1); },
  twist(t) { noise(t, 0.6, 0.35, 'bandpass', 300, 3000, 3, 0.15); tone('sine', 300, 900, t, 0.6, 0.08, 0.1); },
  sneaky(t) { notes('triangle', [440, 523, 440, 392], t, 0.09, 0.08, 0.12); },
  buzz(t) { tone('square', 140, 120, t, 0.4, 0.12); },
  ping(t) { tone('sine', 1250, 1250, t, 0.9, 0.25); tone('sine', 1250, 1250, t + 0.45, 0.6, 0.08); },
  click(t) { tone('triangle', 1200, 1200, t, 0.03, 0.08); },
  // Drama
  drumroll(t, o = {}) { const d = o.dur || 1.2; for (let i = 0; i < d / 0.045; i++) noise(t + i * 0.045, 0.05, 0.12 + 0.25 * (i * 0.045 / d), 'bandpass', 220, 180, 1.5, 0.002); tone('sine', 70, 70, t + d, 0.35, 0.5); },
  heartbeat(t) { tone('sine', 60, 40, t, 0.12, 0.7); tone('sine', 55, 38, t + 0.2, 0.14, 0.5); },
  gasp(t) { noise(t, 0.9, 0.35, 'bandpass', 900, 420, 1.2, 0.12); tone('sine', 380, 260, t, 0.9, 0.06, 0.1); },
  cheer(t) { noise(t, 1.6, 0.35, 'bandpass', 1400, 2200, 0.8, 0.15); noise(t + 0.3, 1.2, 0.2, 'highpass', 3000, 5000, 0.7, 0.2); },
  alarm(t) { for (let i = 0; i < 4; i++) { tone('square', 880, 880, t + i * 0.3, 0.13, 0.08); tone('square', 660, 660, t + i * 0.3 + 0.15, 0.13, 0.08); } },
  stinger(t) { [110, 131, 165].forEach((f) => tone('sawtooth', f, f * 0.98, t, 1.1, 0.07, 0.02)); noise(t, 0.4, 0.4, 'lowpass', 600, 80); tone('sine', 55, 40, t, 1, 0.5); },
  flash(t) { noise(t, 0.25, 0.6, 'highpass', 5000, 1200, 0.7, 0.002); tone('sine', 120, 30, t, 0.6, 0.9); },
};

export function sfx(name, opts) {
  if (muted || !SOUNDS[name]) return;
  const a = ctx();
  if (!a || a.state !== 'running') return;
  try { SOUNDS[name](a.currentTime + 0.01 + (opts?.delay || 0), opts || {}); } catch { /* never break a game over a sound */ }
}
export const isMuted = () => muted;
export function setMuted(m) { muted = m; try { localStorage.setItem(KEY, m ? '1' : '0'); } catch {} }

// A small fixed mute button, bottom right.
export function soundButton() {
  if (document.getElementById('sfxToggle')) return;
  const b = document.createElement('button');
  b.id = 'sfxToggle'; b.type = 'button';
  b.style.cssText = 'position:fixed;right:calc(12px + env(safe-area-inset-right,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:70;width:44px;height:44px;border-radius:50%;border:1.5px solid #ffffff44;background:#141026cc;color:#fff;font-size:20px;line-height:1;padding:0;cursor:pointer;box-shadow:0 6px 16px #0006';
  const show = () => { b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off'); b.setAttribute('aria-pressed', String(!muted)); };
  b.onclick = () => { setMuted(!muted); show(); if (!muted) { unlock(); setTimeout(() => sfx('click'), 30); } };
  show(); document.body.appendChild(b);
}
