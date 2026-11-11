// =====================================================================================
// MAIN - boots the game and runs the frame loop.
// The simulation advances in fixed 1/60 s steps so 2x and 3x speed behave the same as 1x,
// just with more steps per frame.
// =====================================================================================

import { loadIndex } from "./data.js";
import { initSemantic, findSubject, semanticTop } from "./search.js";
import { state, step } from "./game.js";
import { draw } from "./render.js";
import { initUI, onDataReady, refreshUI } from "./ui.js";

const STEP = 1 / 60;
let last = performance.now();
let owed = 0;        // simulated time waiting to be stepped

function frame(now) {
  const real = Math.min(0.1, (now - last) / 1000);   // cap so a hidden tab does not fast-forward
  last = now;
  if (!state.paused) {
    owed += real * state.speed;
    let guard = 0;
    while (owed >= STEP && guard++ < 30) { step(STEP); owed -= STEP; }
  }
  draw();
  refreshUI();
  requestAnimationFrame(frame);
}

async function boot() {
  initUI();
  requestAnimationFrame(frame);
  try {
    await loadIndex();
    onDataReady();
    initSemantic();      // meaning search loads in the background, the game is playable meanwhile
  } catch (err) {
    document.getElementById("menu-loading").textContent = err.message;
  }
}

boot();

// Handy for poking at the game from the browser console while tuning.
window.spritepocalypse = { state, step, refreshUI, findSubject, semanticTop };
