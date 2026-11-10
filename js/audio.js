// =====================================================================================
// AUDIO - tiny generated blips (Web Audio square and triangle waves). No sound files.
// Browsers only allow sound after the first tap or key press, so the context is
// created lazily on the first sound that follows one.
// =====================================================================================

import { CONFIG } from "./config.js";

let ctx = null;
let enabled = true;
const lastPlayed = {};   // name -> time, used to stop rapid-fire sounds stacking up

try { enabled = localStorage.getItem("spritepocalypse.sound") !== "off"; } catch (err) { /* storage blocked: keep default */ }

export function soundOn() { return enabled; }

export function setSound(on) {
  enabled = on;
  try { localStorage.setItem("spritepocalypse.sound", on ? "on" : "off"); } catch (err) { /* ignore */ }
}

/** Call from a click or key handler so the browser lets audio start. */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx && ctx.state === "suspended") ctx.resume();
}

/**
 * Play one blip.
 * freq = start pitch in Hz, to = end pitch (slides), dur = seconds, type = wave shape,
 * vol = loudness 0..1 before master volume, gap = minimum seconds between repeats of this name.
 */
function blip(name, { freq, to = freq, dur = 0.08, type = "square", vol = 0.5, gap = 0.03, delay = 0 }) {
  if (!enabled || !ctx || ctx.state !== "running") return;
  const now = ctx.currentTime;
  if (lastPlayed[name] && now - lastPlayed[name] < gap) return;
  lastPlayed[name] = now;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now + delay);
  osc.frequency.exponentialRampToValueAtTime(Math.max(30, to), now + delay + dur);
  gain.gain.setValueAtTime(vol * CONFIG.audio.volume, now + delay);
  gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now + delay);
  osc.stop(now + delay + dur + 0.02);
}

// Each element gets its own shot pitch so mixed defences sound different.
const SHOT_PITCH = { Physical: 520, Magic: 880, Fire: 300, Ice: 1100, Poison: 240, Lightning: 1400, Holy: 990, Dark: 180, Water: 420, Nature: 360, Sonic: 660 };

export const sfx = {
  block: () => blip("block", { freq: 220, to: 160, dur: 0.05, type: "triangle", vol: 0.7 }),
  erase: () => blip("erase", { freq: 180, to: 120, dur: 0.05, type: "triangle", vol: 0.5 }),
  place: () => { blip("place", { freq: 440, to: 660, dur: 0.07 }); blip("place2", { freq: 660, to: 880, dur: 0.07, delay: 0.07 }); },
  sell: () => blip("sell", { freq: 700, to: 350, dur: 0.12, type: "triangle" }),
  found: () => blip("found", { freq: 600, to: 900, dur: 0.06, vol: 0.4 }),
  error: () => blip("error", { freq: 140, to: 90, dur: 0.16, type: "sawtooth", vol: 0.4 }),
  shoot: (element) => blip("shoot", { freq: SHOT_PITCH[element] || 520, to: (SHOT_PITCH[element] || 520) * 0.6, dur: 0.04, vol: 0.18, gap: 0.05 }),
  hit: () => blip("hit", { freq: 200, to: 120, dur: 0.03, type: "triangle", vol: 0.15, gap: 0.06 }),
  kill: () => blip("kill", { freq: 500, to: 1000, dur: 0.06, vol: 0.3, gap: 0.04 }),
  boom: () => blip("boom", { freq: 120, to: 40, dur: 0.3, type: "sawtooth", vol: 0.6 }),
  leak: () => blip("leak", { freq: 200, to: 60, dur: 0.3, type: "sawtooth", vol: 0.7 }),
  wave: () => [392, 523, 659].forEach((f, i) => blip("wave" + i, { freq: f, dur: 0.1, delay: i * 0.09 })),
  // wave cleared: a rising fanfare, longer and brighter when no enemy got through
  waveClear: (flawless) => {
    const notes = flawless ? [523, 659, 784, 1047, 1319, 1568] : [523, 659, 784, 1047];
    notes.forEach((f, i) => blip("clear" + i, { freq: f, dur: 0.12, delay: i * 0.08, vol: 0.55 }));
    if (flawless) [1047, 1319, 1568].forEach((f, i) => blip("chord" + i, { freq: f, dur: 0.35, delay: 0.5, type: "triangle", vol: 0.35 }));
  },
  // maze rating: more notes and higher pitch the better the rating, a flat "wah" for the bottom tiers
  style: (tier, tiers) => {
    if (tier <= 1) { blip("style0", { freq: 220, to: 150, dur: 0.3, type: "sawtooth", vol: 0.4 }); return; }
    const scale = [392, 494, 587, 698, 784, 988, 1175, 1397, 1568];
    for (let i = 0; i <= Math.min(tier, tiers - 1) - 1; i++) blip("style" + i, { freq: scale[i], dur: 0.09, delay: i * 0.06, vol: 0.5 });
  },
  boss: () => [110, 98, 82].forEach((f, i) => blip("boss" + i, { freq: f, to: f * 0.8, dur: 0.35, delay: i * 0.28, type: "sawtooth", vol: 0.7 })),
  bossDown: () => [392, 523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => blip("bossdown" + i, { freq: f, dur: 0.12, delay: i * 0.06, vol: 0.55 })),
  coin: () => { blip("coin", { freq: 988, dur: 0.05, vol: 0.35, gap: 0.08 }); blip("coin2", { freq: 1319, dur: 0.12, delay: 0.05, vol: 0.35, gap: 0.08 }); },
  tick: () => blip("tick", { freq: 1175, to: 1568, dur: 0.04, type: "triangle", vol: 0.2, gap: 0.07 }),
  hurt: () => blip("hurt", { freq: 160, to: 80, dur: 0.2, type: "square", vol: 0.5 }),
  gameOver: () => [392, 330, 262, 196].forEach((f, i) => blip("over" + i, { freq: f, dur: 0.22, delay: i * 0.2, type: "triangle", vol: 0.7 })),
  click: () => blip("click", { freq: 330, dur: 0.03, vol: 0.3 }),
};
