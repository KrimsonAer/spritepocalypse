// =====================================================================================
// RENDER - draws the board on one canvas. Reads game state, never changes it.
// Everything is positioned in grid cells and scaled by `view.cell` (pixels per cell).
// Sprites are 16x16 and drawn with smoothing off so they stay crisp at any size.
// =====================================================================================

import { CONFIG, ELEMENT_COLORS, COMBOS } from "./config.js";
import { state, cellIndex, towerRange, towerStats } from "./game.js";

const B = CONFIG.board;
const L = CONFIG.look;

export const view = {
  canvas: null, ctx: null,
  cell: 40,            // pixels per cell (CSS pixels)
  dpr: 1,              // device pixel ratio
  paper: null,         // cached graph paper
  blocks: [],          // cached pencil block doodles
  hover: null,         // { x, y } cell under the pointer
  selected: null,      // selected tower
  selectedEnemy: null, // enemy being inspected
  ghost: null,         // { pack, drawing, tags, px, py } sprite being dragged, in CSS pixels
  armed: null,         // candidate waiting to be placed (shows a ghost on hovered blocks)
};

/** Small deterministic random generator so doodles do not shimmer between frames. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Fit the canvas to its container and rebuild the cached backgrounds. */
export function resize(canvas, availW, availH) {
  view.canvas = canvas;
  view.ctx = canvas.getContext("2d");
  view.dpr = Math.min(3, window.devicePixelRatio || 1);
  view.cell = Math.max(16, Math.floor(Math.min(availW / B.cols, availH / B.rows)));
  const w = view.cell * B.cols, h = view.cell * B.rows;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = Math.round(w * view.dpr);
  canvas.height = Math.round(h * view.dpr);
  buildPaper(w, h);
  buildBlocks();
}

function buildPaper(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.round(w * view.dpr); c.height = Math.round(h * view.dpr);
  const g = c.getContext("2d");
  g.scale(view.dpr, view.dpr);
  g.fillStyle = L.paper;
  g.fillRect(0, 0, w, h);
  // thin lines: each cell is split into 4 small squares, like real graph paper
  g.strokeStyle = L.lineMinor; g.lineWidth = 1;
  g.beginPath();
  const sub = view.cell / 4;
  for (let x = 0; x <= w + 0.5; x += sub) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, h); }
  for (let y = 0; y <= h + 0.5; y += sub) { g.moveTo(0, Math.round(y) + 0.5); g.lineTo(w, Math.round(y) + 0.5); }
  g.stroke();
  // bold lines on the cell boundaries
  g.strokeStyle = L.lineMajor; g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i <= B.cols; i++) { g.moveTo(i * view.cell, 0); g.lineTo(i * view.cell, h); }
  for (let j = 0; j <= B.rows; j++) { g.moveTo(0, j * view.cell); g.lineTo(w, j * view.cell); }
  g.stroke();
  view.paper = c;
}

// Pencil-doodle blocks: a wobbly outline with hatched shading. A few variants, picked per cell.
function buildBlocks() {
  view.blocks = [];
  const s = view.cell;
  for (let v = 0; v < 6; v++) {
    const c = document.createElement("canvas");
    c.width = Math.round(s * view.dpr); c.height = Math.round(s * view.dpr);
    const g = c.getContext("2d");
    g.scale(view.dpr, view.dpr);
    const rnd = seeded(v * 977 + 13);
    const wob = () => (rnd() - 0.5) * s * 0.06;
    const m = s * 0.07;
    const corners = [[m, m], [s - m, m], [s - m, s - m], [m, s - m]].map(([x, y]) => [x + wob(), y + wob()]);
    g.fillStyle = "#eef0f4";
    g.beginPath();
    corners.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    // hatching
    g.save();
    g.clip();
    g.strokeStyle = L.pencilFill; g.lineWidth = Math.max(1, s * 0.035); g.lineCap = "round";
    const gap = s * 0.16;
    for (let k = -s; k < s * 2; k += gap) {
      g.beginPath();
      g.moveTo(k + wob(), s + wob());
      g.lineTo(k + s + wob(), wob());
      g.stroke();
    }
    g.restore();
    // outline drawn twice, slightly off, like a pencil going round again
    g.strokeStyle = L.pencil; g.lineJoin = "round"; g.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
      g.lineWidth = Math.max(1, s * (pass ? 0.025 : 0.05));
      g.globalAlpha = pass ? 0.6 : 1;
      g.beginPath();
      corners.forEach(([x, y], i) => {
        const px = x + (pass ? wob() : 0), py = y + (pass ? wob() : 0);
        if (i) g.lineTo(px, py); else g.moveTo(px, py);
      });
      g.closePath();
      g.stroke();
    }
    g.globalAlpha = 1;
    view.blocks.push(c);
  }
}

/** Draw a 16x16 sprite centred on (cx, cy) in cell units, `size` cells wide. */
function drawSprite(g, canvas, cx, cy, size) {
  const px = size * view.cell;
  g.drawImage(canvas, Math.round(cx * view.cell + view.cell / 2 - px / 2), Math.round(cy * view.cell + view.cell / 2 - px / 2), Math.round(px), Math.round(px));
}

const centre = (v) => v * view.cell + view.cell / 2;

function pencilLine(g, pts, dashed) {
  g.strokeStyle = L.pencil; g.lineWidth = Math.max(1.5, view.cell * 0.05); g.lineCap = "round"; g.lineJoin = "round";
  g.setLineDash(dashed ? [view.cell * 0.12, view.cell * 0.2] : []);
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(centre(p.x), centre(p.y)) : g.moveTo(centre(p.x), centre(p.y))));
  g.stroke();
  g.setLineDash([]);
}

/** Draw one frame. */
export function draw() {
  const g = view.ctx;
  if (!g) return;
  const s = view.cell;
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(view.paper, 0, 0, s * B.cols, s * B.rows);

  // route preview while building
  if (state.phase === "build" && L.pathPreview && state.groundPath) {
    g.globalAlpha = 0.35;
    for (const route of state.groundPaths) pencilLine(g, route.pts, true);   // both branches when the route splits
    g.globalAlpha = 1;
  }

  drawMarkers(g);

  // blocks
  for (let y = 0; y < B.rows; y++) {
    for (let x = 0; x < B.cols; x++) {
      if (state.blocks[cellIndex(x, y)]) g.drawImage(view.blocks[(x * 7 + y * 13) % view.blocks.length], x * s, y * s, s, s);
    }
  }
  drawComboBlocks(g);

  // hover highlight
  if (view.hover && state.phase !== "menu" && state.phase !== "over") {
    g.fillStyle = "rgba(59, 130, 246, 0.12)";
    g.fillRect(view.hover.x * s, view.hover.y * s, s, s);
  }

  // range ring for the selected tower, or for the armed sprite over a hovered block
  if (view.selected) rangeRing(g, view.selected.x, view.selected.y, towerRange(view.selected), view.selected.stats.color);
  if (view.armed && view.hover && state.blocks[cellIndex(view.hover.x, view.hover.y)] && !state.towerAt.has(cellIndex(view.hover.x, view.hover.y))) {
    const stats = towerStats(view.armed.tags);
    rangeRing(g, view.hover.x, view.hover.y, stats.range, stats.color);
    g.globalAlpha = 0.6;
    drawSprite(g, view.armed.pack.sprite(view.armed.drawing), view.hover.x, view.hover.y, 0.8);
    g.globalAlpha = 1;
  }

  // towers
  for (const t of state.towers) {
    const stunned = state.time < t.stunUntil;
    const bob = t.locked ? 0 : Math.sin(state.time * 4 + t.id) * 0.03;      // unlocked towers bob gently
    const size = 0.8 * (1 + t.recoil * 0.15);
    if (stunned) g.globalAlpha = 0.45;
    drawSprite(g, t.pack.sprite(t.drawing), t.x, t.y + bob, size);
    g.globalAlpha = 1;
    if (!t.locked) {                                                          // dashed outline = can still be moved for free
      g.strokeStyle = "#2563eb"; g.lineWidth = 1.5; g.setLineDash([4, 4]);
      g.strokeRect(t.x * s + 3, t.y * s + 3, s - 6, s - 6);
      g.setLineDash([]);
    }
    if (t === view.selected) {
      g.strokeStyle = "#f59e0b"; g.lineWidth = 2.5;
      g.strokeRect(t.x * s + 2, t.y * s + 2, s - 4, s - 4);
    }
    if (stunned) label(g, "zz", t.x, t.y - 0.3, "#475569", 0.8);
    // beam
    if (t.beamTarget && !t.beamTarget.dead && !stunned) {
      g.strokeStyle = t.stats.color; g.lineCap = "round";
      g.lineWidth = Math.max(2, s * 0.05 * t.beamRamp);
      g.globalAlpha = 0.85;
      g.beginPath(); g.moveTo(centre(t.x), centre(t.y)); g.lineTo(centre(t.beamTarget.x), centre(t.beamTarget.y)); g.stroke();
      g.globalAlpha = 1;
    }
  }

  // enemies: walkers first, flyers on top with a shadow
  const ordered = state.enemies.slice().sort((a, b) => (a.flying - b.flying) || (a.y - b.y));
  for (const e of ordered) drawEnemy(g, e);

  // shots
  for (const shot of state.shots) {
    g.fillStyle = shot.color;
    const r = Math.max(2, Math.round(s * (shot.kind === "splash" ? 0.11 : 0.08)));
    const px = Math.round(centre(shot.x)), py = Math.round(centre(shot.y));
    if (shot.kind === "pierce") {
      g.strokeStyle = shot.color; g.lineWidth = r; g.lineCap = "butt";
      const len = s * 0.35, sp = Math.hypot(shot.vx, shot.vy);
      g.beginPath(); g.moveTo(px, py); g.lineTo(px - (shot.vx / sp) * len, py - (shot.vy / sp) * len); g.stroke();
    } else {
      g.fillRect(px - r, py - r, r * 2, r * 2);     // square blob, pixel style
      g.fillStyle = "#fff";
      g.fillRect(px - r, py - r, r, r);
    }
  }

  // effects
  for (const f of state.fx) {
    const k = Math.max(0, f.life / f.max);
    if (f.kind === "ring" || f.kind === "pop") {
      g.strokeStyle = f.color; g.globalAlpha = k * 0.8; g.lineWidth = Math.max(2, s * 0.06);
      g.beginPath(); g.arc(centre(f.x), centre(f.y), f.r * s * (1 - k * 0.6), 0, Math.PI * 2); g.stroke();
    } else if (f.kind === "zap") {
      g.strokeStyle = f.color; g.globalAlpha = k; g.lineWidth = Math.max(2, s * 0.07);
      const mx = (f.x1 + f.x2) / 2 + (f.y2 - f.y1) * 0.15, my = (f.y1 + f.y2) / 2 - (f.x2 - f.x1) * 0.15;
      g.beginPath(); g.moveTo(centre(f.x1), centre(f.y1)); g.lineTo(centre(mx), centre(my)); g.lineTo(centre(f.x2), centre(f.y2)); g.stroke();
    } else if (f.kind === "text") {
      g.globalAlpha = Math.min(1, k * 2);
      label(g, f.text, f.x, f.y, f.color, f.scale);
    } else if (f.kind === "chev") {
      // knockback marker: two chevrons pointing the way the enemy was shoved
      g.globalAlpha = Math.min(1, k * 1.6);
      g.save();
      g.translate(centre(f.x + f.dx * (1 - k) * 0.5), centre(f.y + f.dy * (1 - k) * 0.5));
      g.rotate(Math.atan2(f.dy, f.dx));
      g.lineCap = "square"; g.lineJoin = "miter";
      const a = s * 0.16;
      for (const [color, width] of [["#1e293b", Math.max(4, s * 0.12)], [f.color, Math.max(2, s * 0.06)]]) {
        g.strokeStyle = color; g.lineWidth = width;
        for (const off of [-a * 0.9, a * 0.5]) {
          g.beginPath(); g.moveTo(off - a * 0.6, -a); g.lineTo(off + a * 0.4, 0); g.lineTo(off - a * 0.6, a); g.stroke();
        }
      }
      g.restore();
    } else if (f.kind === "spark") {
      g.globalAlpha = Math.min(1, k * 1.5);
      const u = Math.max(2, Math.round(f.size * s));
      g.fillStyle = f.color;
      g.fillRect(Math.round(centre(f.x) - u / 2), Math.round(centre(f.y) - u / 2), u, u);
    }
    g.globalAlpha = 1;
  }
  for (const f of state.fx) if (f.kind === "big") drawBigText(g, f);

  // dragged sprite
  if (view.ghost) {
    const rect = view.canvas.getBoundingClientRect();
    const px = view.ghost.px - rect.left, py = view.ghost.py - rect.top;
    g.globalAlpha = 0.8;
    g.drawImage(view.ghost.pack.sprite(view.ghost.drawing), Math.round(px - s * 0.45), Math.round(py - s * 0.45), Math.round(s * 0.9), Math.round(s * 0.9));
    g.globalAlpha = 1;
  }

  // (the incoming-group banner now lives in the score bar, see ui.js)
}

// Combos: the blocks under linked towers take the category's colour and merge into one shape.
// Each block is filled, and the gap between linked neighbours is filled too (a bridge across the
// shared edge, or a diamond across the shared corner for diagonal links).
function drawComboBlocks(g) {
  const s = view.cell, m = s * 0.07;
  for (const t of state.towers) {
    if (!t.combos || !t.combos.length) continue;
    const color = COMBOS[t.combos[0]].color;
    g.fillStyle = color;
    g.globalAlpha = 0.55;
    g.fillRect(t.x * s + m, t.y * s + m, s - 2 * m, s - 2 * m);
    for (const link of t.links) {
      const o = link.to;
      if (o.id < t.id || link.cat !== t.combos[0]) continue;      // draw each bridge once
      g.fillStyle = COMBOS[link.cat].color;
      if (o.x !== t.x && o.y !== t.y) {                        // diagonal: diamond over the shared corner
        const cx = Math.max(t.x, o.x) * s, cy = Math.max(t.y, o.y) * s, r = m * 2.2;
        g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath(); g.fill();
      } else if (o.x !== t.x) {                                // side by side
        g.fillRect(Math.max(t.x, o.x) * s - m - 1, t.y * s + m, 2 * m + 2, s - 2 * m);
      } else {                                                 // one above the other
        g.fillRect(t.x * s + m, Math.max(t.y, o.y) * s - m - 1, s - 2 * m, 2 * m + 2);
      }
    }
    g.globalAlpha = 1;
  }
}

function rangeRing(g, x, y, range, color) {
  g.strokeStyle = color; g.fillStyle = color;
  g.globalAlpha = 0.1;
  g.beginPath(); g.arc(centre(x), centre(y), range * view.cell, 0, Math.PI * 2); g.fill();
  g.globalAlpha = 0.7; g.lineWidth = 2; g.setLineDash([6, 5]);
  g.stroke();
  g.setLineDash([]); g.globalAlpha = 1;
}

function label(g, text, x, y, color, scale = 1) {
  const size = Math.max(9, Math.round(view.cell * 0.34 * scale));
  g.font = `${Math.round((size) * 1.3)}px "VT323", "Courier New", monospace`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = Math.max(2, size * 0.28); g.strokeStyle = "#ffffff"; g.lineJoin = "round";
  g.strokeText(text, centre(x), centre(y));
  g.fillStyle = color;
  g.fillText(text, centre(x), centre(y));
}

// Spawn (top) and home (bottom) are pencil doodles: an arrow in, and a little house with a heart.
function drawMarkers(g) {
  const s = view.cell;
  g.strokeStyle = "#dc2626"; g.lineWidth = Math.max(2, s * 0.07); g.lineCap = "round"; g.lineJoin = "round";
  const sx = centre(B.spawn.x), sy = centre(B.spawn.y);
  g.beginPath();
  g.moveTo(sx, sy - s * 0.32); g.lineTo(sx, sy + s * 0.28);
  g.moveTo(sx - s * 0.2, sy + s * 0.06); g.lineTo(sx, sy + s * 0.28); g.lineTo(sx + s * 0.2, sy + s * 0.06);
  g.stroke();

  const hx = centre(B.home.x), hy = centre(B.home.y);
  g.strokeStyle = L.pencil;
  g.beginPath();
  g.moveTo(hx - s * 0.3, hy + s * 0.32); g.lineTo(hx - s * 0.3, hy - s * 0.02); g.lineTo(hx, hy - s * 0.34);
  g.lineTo(hx + s * 0.3, hy - s * 0.02); g.lineTo(hx + s * 0.3, hy + s * 0.32); g.closePath();
  g.stroke();
  g.fillStyle = "#e11d48";
  const u = Math.max(1, Math.round(s * 0.05));      // pixel heart
  [[-2, -1, 2, 1], [1, -1, 2, 1], [-3, 0, 7, 2], [-2, 2, 5, 1], [-1, 3, 3, 1], [0, 4, 1, 1]].forEach(([x, y, w, h]) => {
    g.fillRect(Math.round(hx - u / 2) + x * u, Math.round(hy + s * 0.02) + y * u, w * u, h * u);
  });
}

function drawEnemy(g, e) {
  const s = view.cell;
  const now = state.time;
  if (e.y < -0.9) return;
  if (e.flying) {                       // shadow, and float a little above the path
    g.fillStyle = "rgba(30, 41, 59, 0.18)";
    g.beginPath(); g.ellipse(centre(e.x), centre(e.y) + s * 0.3, s * e.size * 0.3, s * e.size * 0.12, 0, 0, Math.PI * 2); g.fill();
  }
  const lift = e.flying ? -0.18 + Math.sin(now * 6 + e.id) * 0.04 : Math.abs(Math.sin(now * 8 + e.id)) * -0.04;
  if (e === view.selectedEnemy) {      // inspection ring
    g.strokeStyle = "#f59e0b"; g.lineWidth = Math.max(2, s * 0.06); g.setLineDash([5, 4]);
    g.beginPath(); g.arc(centre(e.x), centre(e.y + lift), s * e.size * 0.62, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
  }
  if (e.stealth) g.globalAlpha = 0.5;
  const img = now < e.flashUntil ? e.pack.flash(e.drawing) : e.pack.sprite(e.drawing);
  drawSprite(g, img, e.x, e.y + lift, e.size);
  g.globalAlpha = 1;

  // health bar, with the shield in blue above it
  const w = s * 0.7 * Math.min(1.3, e.size / 0.8), x = centre(e.x) - w / 2, y = centre(e.y + lift) - s * e.size * 0.5 - s * 0.12;
  const hpH = Math.max(3, Math.round(s * 0.07));
  g.fillStyle = "#1e293b"; g.fillRect(Math.round(x) - 1, Math.round(y) - 1, Math.round(w) + 2, hpH + 2);
  g.fillStyle = "#ef4444"; g.fillRect(Math.round(x), Math.round(y), Math.round(w), hpH);
  g.fillStyle = "#22c55e"; g.fillRect(Math.round(x), Math.round(y), Math.round(w * Math.max(0, e.hp / e.maxHp)), hpH);
  if (e.maxShield && e.shield > 0) {
    g.fillStyle = "#38bdf8"; g.fillRect(Math.round(x), Math.round(y) - 3, Math.round(w * (e.shield / e.maxShield)), 2);
  }
  // little pixel shields at the top right of the bar: grey while Armored (gone once shredded),
  // blue while it still has shield left (gone when the shield is used up, back when it refills)
  const icons = [];
  if (e.maxShield && e.shield > 0) icons.push("#38bdf8");
  if (e.armored && !e.shredded) icons.push("#9ca3af");
  const iu = Math.max(2, Math.round(s * 0.045));                 // one icon pixel (about 10 px icons on a phone)
  let ix = Math.round(x + w) - 5 * iu + Math.round(iu * 1.5);     // rightmost icon pokes past the bar end
  const iy = Math.round(y) - 3 * iu;
  for (let k = icons.length - 1; k >= 0; k--) {
    drawShieldIcon(g, ix, iy, iu, icons[k]);
    ix -= 6 * iu;
  }
  // status pips under the sprite
  const pips = [];
  if (e.burn) pips.push(ELEMENT_COLORS.Fire);
  if (e.poison) pips.push(ELEMENT_COLORS.Poison);
  if (e.bleed) pips.push("#dc2626");
  if (now < e.slowUntil) pips.push(ELEMENT_COLORS.Ice);
  if (now < e.stunUntil) pips.push("#facc15");
  if (now < e.curseUntil) pips.push(ELEMENT_COLORS.Dark);
  const u = Math.max(3, Math.round(s * 0.09));
  pips.forEach((color, i) => {
    g.fillStyle = "#1e293b"; g.fillRect(Math.round(centre(e.x) - (pips.length * (u + 2)) / 2 + i * (u + 2)) - 1, Math.round(centre(e.y) + s * e.size * 0.45) - 1, u + 2, u + 2);
    g.fillStyle = color; g.fillRect(Math.round(centre(e.x) - (pips.length * (u + 2)) / 2 + i * (u + 2)), Math.round(centre(e.y) + s * e.size * 0.45), u, u);
  });
}

// A 5x5-pixel shield with a dark outline and a light highlight. (x, y) is its top left corner.
const SHIELD_ROWS = ["XXXXX", "XXXXX", "XXXXX", ".XXX.", "..X.."];
function drawShieldIcon(g, x, y, u, color) {
  for (const [fill, pad] of [["#1e293b", 1], [color, 0]]) {
    g.fillStyle = fill;
    SHIELD_ROWS.forEach((row, r) => {
      for (let c = 0; c < 5; c++) if (row[c] === "X") g.fillRect(x + c * u - pad, y + r * u - pad, u + 2 * pad, u + 2 * pad);
    });
  }
  g.fillStyle = "rgba(255, 255, 255, 0.6)";
  g.fillRect(x + u, y + u, u, u);
}

// Large announcement across the board (maze rating, wave clear). Pops in, holds, fades out.
function drawBigText(g, f) {
  const s = view.cell, w = s * B.cols, cy = s * B.rows * 0.4;
  const t = 1 - f.life / f.max;                               // 0 at the start, 1 at the end
  const elapsed = f.max - f.life;
  const pop = elapsed < 0.12 ? (elapsed / 0.12) * 1.25 : elapsed < 0.22 ? 1.25 - ((elapsed - 0.12) / 0.1) * 0.25 : 1;
  g.save();
  g.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
  g.translate(w / 2, cy);
  g.scale(pop, pop);
  g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
  // shrink long words so they always fit the board
  let size = Math.round(s * 1.25);
  g.font = `${Math.round((size) * 1.3)}px "VT323", "Courier New", monospace`;
  const width = g.measureText(f.text).width;
  if (width > w * 0.9) { size = Math.floor(size * (w * 0.9) / width); g.font = `${Math.round((size) * 1.3)}px "VT323", "Courier New", monospace`; }
  g.lineWidth = Math.max(4, size * 0.22); g.strokeStyle = "#1e293b";
  g.strokeText(f.text, 0, 0);
  g.fillStyle = "#1e293b"; g.fillText(f.text, size * 0.06, size * 0.06);   // hard drop shadow
  g.fillStyle = f.color; g.fillText(f.text, 0, 0);
  if (f.pre) {
    const lead = Math.max(11, Math.round(s * 0.46));
    g.font = `${Math.round((lead) * 1.3)}px "VT323", "Courier New", monospace`;
    g.lineWidth = Math.max(3, lead * 0.3); g.strokeStyle = "#ffffff";
    g.strokeText(f.pre, 0, -size * 0.85);
    g.fillStyle = "#1e293b"; g.fillText(f.pre, 0, -size * 0.85);
  }
  if (f.sub) {
    const sub = Math.max(11, Math.round(s * 0.42));
    g.font = `${Math.round((sub) * 1.3)}px "VT323", "Courier New", monospace`;
    g.lineWidth = Math.max(3, sub * 0.3); g.strokeStyle = "#ffffff";
    g.strokeText(f.sub, 0, size * 0.85);
    g.fillStyle = "#1e293b"; g.fillText(f.sub, 0, size * 0.85);
  }
  g.restore();
}

// Announcement at the top of the board when a new group starts to arrive.
function drawBanner(g) {
  const b = state.banner;
  if (!b || state.time > b.until || state.phase !== "wave") return;
  const s = view.cell, w = s * B.cols;
  const fade = Math.min(1, (b.until - state.time) * 2);
  const size = Math.max(11, Math.round(s * 0.36));
  g.globalAlpha = fade;
  g.fillStyle = "rgba(30, 41, 59, 0.88)";
  const h = size * (b.tags.length ? 2.9 : 1.8);
  g.fillRect(s * 0.3, s * 1.15, w - s * 0.6, h);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `${Math.round((size) * 1.3)}px "VT323", "Courier New", monospace`;
  g.fillText(fit(g, b.text, w - s), w / 2, s * 1.15 + size * 0.9);
  if (b.tags.length) {
    g.font = `${Math.round((Math.round(size * 0.8)) * 1.3)}px "VT323", "Courier New", monospace`;
    g.fillStyle = "#fde68a";
    g.fillText(fit(g, b.tags.join("  "), w - s), w / 2, s * 1.15 + size * 2.05);
  }
  g.globalAlpha = 1;
}

function fit(g, text, maxWidth) {
  if (g.measureText(text).width <= maxWidth) return text;
  while (text.length > 4 && g.measureText(text + "...").width > maxWidth) text = text.slice(0, -1);
  return text + "...";
}

/** Convert a pointer position (client pixels) to board coordinates, where a cell centre is a whole number. */
export function boardPoint(clientX, clientY) {
  const rect = view.canvas.getBoundingClientRect();
  return { x: (clientX - rect.left) / view.cell - 0.5, y: (clientY - rect.top) / view.cell - 0.5 };
}

/** Convert a pointer position (client pixels) to a cell, or null if it is off the board. */
export function cellAt(clientX, clientY) {
  const rect = view.canvas.getBoundingClientRect();
  const x = Math.floor((clientX - rect.left) / view.cell), y = Math.floor((clientY - rect.top) / view.cell);
  return x >= 0 && y >= 0 && x < B.cols && y < B.rows ? { x, y } : null;
}
