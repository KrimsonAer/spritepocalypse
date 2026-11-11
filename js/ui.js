// =====================================================================================
// UI - everything the player touches: search box, cards, buttons, menus, board input.
// Works with a mouse, a keyboard and a touch screen.
//
// Board controls
//   tap an empty square     place a block (build phase only)
//   tap a bare block        place the sprite you searched for, or remove the block if none is ready
//   tap a tower             select it (shows tags, sell or remove, move)
//   tap an enemy            inspect it (shows its tags)
//   drag the sprite card    drop it on a block to place it
//   drag an unlocked tower  move it to another block
// Tags describe themselves on hover (or tap) for locked towers and for enemies.
// =====================================================================================

import { CONFIG, ELEMENT_COLORS, COMBOS } from "./config.js";
import { db, loadPack, randomSubject, towerTagsFor } from "./data.js";
import { findSubject, pickDrawing } from "./search.js";
import { state, cellIndex, newRun, startWave, toggleBlock, placeTower, removeTower, moveTower, refundFor, towerPrice } from "./game.js";
import { view, resize, cellAt, boardPoint } from "./render.js";
import { sfx, unlockAudio, soundOn, setSound } from "./audio.js";
import { TOWER_TAG_INFO, ENEMY_TAG_INFO, SUPPORT_ELEMENT_INFO } from "./taginfo.js";

const $ = (id) => document.getElementById(id);

let candidate = null;    // the searched sprite shown on the card
let armed = false;       // true once the player has clicked the card to SELECT that sprite for placing
let cardMoved = 0;       // how far the pointer travelled during a card drag (a drag is not a click)
let lastQuery = "";      // text of the last successful search (used by Reroll)
let moveMode = false;    // true after pressing Move on a selected tower
let press = null;        // pointer currently held on the board
let cardDrag = false;    // true while the sprite card is being dragged
let msgTimer = 0;
let searching = 0;       // counts searches so a slow one cannot overwrite a newer one

const HOW_TO_PLAY = [
  "Enemies walk from the red arrow at the top to the house at the bottom. Each one that gets home costs a heart.",
  "Tap squares to draw blocks and build a maze. You can never seal the path completely.",
  "Enemies take the shortest way home. If two ways are equally short, they split between them.",
  "Type any word and press SPAWN. You get the sprite closest in meaning, and its tags. Click it to select it, then tap a block.",
  "Drag across squares to draw several blocks at once. Start the drag on a block to erase.",
  "Tags decide what a tower does: its attack shape, damage type, range and extras.",
  "Your first 5 towers are free. After that towers cost gold, which you earn from kills.",
  "Until you press START WAVE you can move or remove new towers for free. After that they are locked and sell for half.",
  "Tap a locked tower or an enemy to see its tags. Hover or tap a tag to read what it does.",
  "On a PC, right click to deselect.",
  "Your layout is rated when you start a wave. The further it is from the obvious zigzag, the bigger the layout bonus every wave.",
  "Flying enemies skip the maze. Only some towers can hit them. Every few waves ends with a boss.",
];

// ------------------------------------------------------------------------------------
// SETUP
// ------------------------------------------------------------------------------------

export function initUI() {
  const canvas = $("board");

  // Keep the board fitted to its container. The score bar sits on top of the board, matches its
  // width, and grows with it so the numbers stay easy to read on any screen.
  const fit = () => {
    const st = $("stage");
    const availW = st.clientWidth - 18, availH = st.clientHeight - 18;
    const hudH = Math.max(40, Math.min(110, Math.round(Math.min(availH * 0.085, availW * 0.15))));
    const hintH = Math.round(hudH * 0.72);        // controls reminder under the board
    resize(canvas, availW, availH - hudH - hintH);
    const hint = $("hint");
    hint.style.width = canvas.style.width;
    hint.style.height = hintH + "px";
    hint.dataset.max = Math.max(13, Math.round(hudH * 0.33));
    fitHint();
    const hud = $("hud");
    hud.style.width = canvas.style.width;
    hud.style.height = hudH + "px";
    // text size follows the bar height, but never so big that icons crowd out the numbers on a narrow board
    hud.style.fontSize = Math.round(Math.min(hudH * 0.6, parseFloat(canvas.style.width) / 13)) + "px";
    fitAllStats();
  };
  new ResizeObserver(fit).observe($("stage"));
  if (document.fonts) document.fonts.ready.then(() => { fitAllStats(); fitHint(); });          // refit once the number font has loaded
  window.addEventListener("orientationchange", fit);
  fit();

  // search box
  $("search-form").addEventListener("submit", (ev) => { ev.preventDefault(); search($("search").value); });

  // typing anywhere goes to the search box (desktop convenience)
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { togglePause(); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey || overlayOpen()) return;
    if (document.activeElement !== $("search") && ev.key.length === 1 && /[a-z]/i.test(ev.key)) $("search").focus();
  });

  // wave controls
  document.querySelectorAll("[data-speed]").forEach((b) => b.addEventListener("click", () => { state.speed = Number(b.dataset.speed); sfx.click(); }));
  $("btn-pause").addEventListener("click", togglePause);
  $("btn-start").addEventListener("click", async () => {
    unlockAudio();
    clearSelection();
    await startWave().catch((err) => setMsg(err.message, true));
  });

  // menus
  $("btn-new").addEventListener("click", beginRun);
  $("btn-restart").addEventListener("click", beginRun);
  $("btn-again").addEventListener("click", beginRun);
  $("btn-resume").addEventListener("click", togglePause);
  document.querySelectorAll("[data-how]").forEach((el) => { el.innerHTML = HOW_TO_PLAY.map((p) => `<p>${p}</p>`).join(""); });
  document.querySelectorAll('[data-toggle="how"]').forEach((b) => b.addEventListener("click", () => {
    b.closest(".sheet").querySelector("[data-how]").classList.toggle("hidden");
    sfx.click();
  }));
  document.querySelectorAll("[data-sound]").forEach((b) => b.addEventListener("click", () => { unlockAudio(); setSound(!soundOn()); sfx.click(); refreshSoundButtons(); }));
  $("btn-sound").addEventListener("click", () => { unlockAudio(); setSound(!soundOn()); sfx.click(); refreshSoundButtons(); });
  refreshSoundButtons();

  // clicking the card SELECTS the searched sprite (click again to let go of it)
  $("card").addEventListener("click", (ev) => {
    if (!candidate || ev.target.closest(".card-actions") || ev.target.closest(".tag")) return;
    if (cardMoved > 8) { cardMoved = 0; return; }      // that was a drag, not a click
    setArmed(!armed);
    sfx.click();
  });

  // board input
  canvas.addEventListener("pointerdown", onBoardDown);
  canvas.addEventListener("pointermove", onBoardMove);
  canvas.addEventListener("pointerup", onBoardUp);
  canvas.addEventListener("pointercancel", () => { press = null; view.ghost = null; });
  canvas.addEventListener("pointerleave", () => { if (!press) view.hover = null; });
  // Right click (PC): let go of whatever is selected. A selected sprite first, then a selected
  // tower, an inspected enemy or a pending move. Works on the board and on the side panel.
  const deselect = (ev) => {
    ev.preventDefault();
    if (armed) { setArmed(false); sfx.click(); }
    else if (moveMode || view.selected || view.selectedEnemy) { clearSelection(); setMsg(""); sfx.click(); }
  };
  canvas.addEventListener("contextmenu", deselect);
  $("panel").addEventListener("contextmenu", (ev) => { if (!ev.target.closest("input")) deselect(ev); });

  // dragging the sprite card onto the board
  const sprite = $("card-sprite");
  sprite.addEventListener("pointerdown", (ev) => {
    if (!candidate) return;
    cardDrag = true; cardMoved = 0;
    press = null;
    cardStart = { x: ev.clientX, y: ev.clientY };
    try { sprite.setPointerCapture(ev.pointerId); } catch (err) { /* carry on without capture */ }
    view.ghost = { pack: candidate.pack, drawing: candidate.drawing, px: ev.clientX, py: ev.clientY };
  });
  sprite.addEventListener("pointermove", (ev) => {
    if (!cardDrag) return;
    cardMoved = Math.max(cardMoved, Math.hypot(ev.clientX - cardStart.x, ev.clientY - cardStart.y));
    view.ghost.px = ev.clientX; view.ghost.py = ev.clientY;
    view.hover = cellAt(ev.clientX, ev.clientY);
  });
  const endCardDrag = (ev) => {
    if (!cardDrag) return;
    cardDrag = false; view.ghost = null;
    const cell = cellAt(ev.clientX, ev.clientY);
    if (cell && candidate) tryPlace(cell);
  };
  sprite.addEventListener("pointerup", endCardDrag);
  sprite.addEventListener("pointercancel", () => { cardDrag = false; view.ghost = null; });

  // tag descriptions: hover with a mouse, tap on a touch screen
  const tags = $("card-tags");
  tags.addEventListener("pointerover", (ev) => { if (ev.pointerType === "mouse") showTip(ev.target); });
  tags.addEventListener("pointerout", (ev) => { if (ev.pointerType === "mouse") hideTip(); });
  tags.addEventListener("click", (ev) => {
    const tag = ev.target.closest(".tag.explains");
    if (tag && tipFor === tag) hideTip(); else showTip(ev.target);
  });
  document.addEventListener("pointerdown", (ev) => { if (!ev.target.closest(".tag")) hideTip(); });
}

/** Called once the sprite index has loaded: enable the menu and decorate it. */
export function onDataReady() {
  $("menu-loading").textContent = "1.4 million sprites ready.";
  $("btn-new").disabled = false;
  decorate($("menu"));
}

const overlayOpen = () => ["menu", "pause", "over"].some((id) => !$(id).classList.contains("hidden"));

let cardStart = { x: 0, y: 0 };

function refreshSoundButtons() {
  document.querySelectorAll("[data-sound]").forEach((b) => { b.textContent = `SOUND: ${soundOn() ? "ON" : "OFF"}`; });
  $("btn-sound").classList.toggle("off", !soundOn());
}

// Select or let go of the searched sprite. While selected, board taps place it and nothing else
// on the board can be picked. While not selected, towers and enemies can be tapped as normal.
function setArmed(on) {
  armed = on && !!candidate;
  view.armed = armed ? candidate : null;
  if (armed) { view.selected = null; view.selectedEnemy = null; moveMode = false; }
  showCard();
  setMsg(armed ? "Selected. Tap a block to place it." : candidate ? "Click the sprite to select it, or drag it onto a block." : "");
}

// Fill a menu's decoration strips with random sprites, different every time it opens.
function decorate(overlay) {
  overlay.querySelectorAll("[data-deco]").forEach((strip) => {
    strip.innerHTML = "";
    for (let i = 0; i < Number(strip.dataset.deco); i++) {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      c.className = "sprite";
      strip.appendChild(c);
      const subject = randomSubject();
      loadPack(subject).then((pack) => {
        c.getContext("2d").drawImage(pack.sprite(Math.floor(Math.random() * pack.count)), 0, 0);
        c.title = subject.name;
      }).catch(() => {});
    }
  });
}

function beginRun() {
  unlockAudio();
  sfx.click();
  newRun();
  candidate = null; moveMode = false; armed = false;
  view.armed = null; view.selected = null; view.selectedEnemy = null;
  ["menu", "pause", "over"].forEach((id) => $(id).classList.add("hidden"));
  seen = { hearts: state.hearts, gold: state.gold, wave: state.wave, score: state.score };   // no pops for the reset
  goldOwed = 0;
  showCard();
  setMsg("Tap squares to draw blocks. Type a word to find a tower.");
}

function togglePause() {
  if (state.phase !== "build" && state.phase !== "wave") return;
  state.paused = !state.paused;
  $("pause").classList.toggle("hidden", !state.paused);
  if (state.paused) decorate($("pause"));
  sfx.click();
}

// ------------------------------------------------------------------------------------
// SEARCH AND CARDS
// ------------------------------------------------------------------------------------

async function search(text) {
  unlockAudio();
  if (state.phase !== "build" && state.phase !== "wave") return;
  const query = text.trim();
  if (!query) return;
  const ticket = ++searching;
  setMsg("Thinking...");
  let hit = null;
  try {
    hit = await findSubject(query);
  } catch (err) {
    console.error(err);
  }
  if (ticket !== searching) return;            // a newer search has started
  if (!hit) {
    sfx.error();
    candidate = null; armed = false; view.armed = null;
    showCard();
    setMsg(`Nothing matches "${query}". Try a different word.`, true);
    return;
  }
  try {
    const pack = await loadPack(hit.subject);
    if (ticket !== searching) return;
    const drawing = pickDrawing(pack, hit.hints);
    const caption = pack.captions[drawing];
    candidate = { subject: hit.subject, pack, drawing, caption, tags: towerTagsFor(hit.subject, caption) };
    lastQuery = query;
    moveMode = false;
    view.selected = null; view.selectedEnemy = null;
    armed = false; view.armed = null;          // found, but not selected until the card is clicked
    showCard();
    sfx.found();
    setMsg("Click the sprite to select it, or drag it onto a block.");
  } catch (err) {
    setMsg(err.message, true);
  }
}

// One tag chip. Elements use their own colour, everything else is grouped by kind.
// `info` is the description shown on hover or tap, or empty for a tag that keeps its secret.
function tagChip(tag, info) {
  const shape = Object.keys(CONFIG.tower.shapes).includes(tag);
  const range = Object.keys(CONFIG.tower.ranges).includes(tag);
  const color = tag === "Boss" ? "#be123c" : ELEMENT_COLORS[tag] || (shape ? "#1e293b" : range ? "#0f766e" : "#9a3412");
  const light = ["Holy", "Lightning"].includes(tag);
  const tip = info ? ` data-tip="${info.replace(/"/g, "&quot;")}"` : "";
  return `<span class="tag${light ? " light" : ""}${info ? " explains" : ""}" style="--c:${color}"${tip}>${tag}</span>`;
}

/** Show the card for the searched sprite, the selected tower or the inspected enemy, or the empty hint. */
function showCard() {
  hideTip();
  const card = $("card");
  const enemy = !candidate && !view.selected ? view.selectedEnemy : null;
  const item = candidate || view.selected || enemy;
  card.classList.toggle("empty", !item);
  card.classList.toggle("enemy", !!enemy);
  card.classList.toggle("candidate", !!candidate);
  card.classList.toggle("selected", !!candidate && armed);
  if (!item) return;
  const g = $("card-sprite").getContext("2d");
  g.clearRect(0, 0, 16, 16);
  g.drawImage(item.pack.sprite(item.drawing), 0, 0);
  const actions = $("card-actions");
  actions.innerHTML = "";
  const button = (label, fn, cls = "") => {
    const b = document.createElement("button");
    b.type = "button"; b.className = `px-btn small ${cls}`; b.textContent = label;
    b.addEventListener("click", fn);
    actions.appendChild(b);
  };

  if (enemy) {
    $("card-name").textContent = enemy.name;
    $("card-tags").innerHTML = enemy.tags.length ? enemy.tags.map((t) => tagChip(t, ENEMY_TAG_INFO[t])).join("") : "";
    $("card-note").textContent = enemy.tags.length ? "Enemy. Hover or tap a tag to read it." : "Enemy. Nothing special about it.";
    return;
  }

  $("card-name").textContent = item.subject.name;
  if (candidate) {
    $("card-tags").innerHTML = item.tags.map((t) => tagChip(t, "")).join("");
    $("card-note").textContent = candidateNote();
    button(armed ? "SELECTED" : "SELECT", () => { setArmed(!armed); sfx.click(); }, armed ? "on" : "");
    button("REROLL", () => search(lastQuery));
    button("CANCEL", () => { candidate = null; armed = false; view.armed = null; showCard(); setMsg(""); });
  } else {
    const t = view.selected;
    // a tower explains its tags only once it is locked in
    // a Support tower's element is lent to its neighbours, so it gets its own description
    const support = t.stats.shape === "Support";
    const info = (tag) => (support && SUPPORT_ELEMENT_INFO[tag]) || TOWER_TAG_INFO[tag];
    // combos only show here, on a placed tower that is in one (never on the search card)
    const combos = (t.combos || []).map((cat) => `<span class="tag combo explains" style="--c:${COMBOS[cat].color}" data-tip="${COMBOS[cat].desc}">${COMBOS[cat].name.toUpperCase()} COMBO</span>`).join("");
    $("card-tags").innerHTML = t.tags.map((tag) => tagChip(tag, t.locked ? info(tag) : "")).join("") + combos;
    shown.selCombos = (t.combos || []).join(" ");
    $("card-note").textContent = t.locked ? `Locked in. Kills: ${t.kills}. Hover or tap a tag to read it.` : "Not locked yet. Move or remove it for free.";
    if (!t.locked) button(moveMode ? "PICK A BLOCK" : "MOVE", () => { moveMode = !moveMode; showCard(); setMsg(moveMode ? "Tap a free block to move it there." : ""); }, moveMode ? "on" : "");
    button(t.locked ? `SELL +${refundFor(t)}` : "REMOVE", () => { removeTower(t); clearSelection(); }, "danger");
  }
}

// The line under a searched sprite: its price, and whether it is selected yet.
function candidateNote() {
  const price = towerPrice();
  const cost = price === 0 ? `Free (${state.freeTowers} free left)` : `Costs ${price} gold`;
  return armed ? `${cost}. Selected: tap a block.` : `${cost}. Click to select.`;
}

function clearSelection() {
  view.selected = null; view.selectedEnemy = null; moveMode = false;
  showCard();
}

function setMsg(text, bad = false) {
  const el = $("msg");
  el.textContent = text;
  el.classList.toggle("bad", bad);
  clearTimeout(msgTimer);
  if (text) msgTimer = setTimeout(() => { el.textContent = ""; }, 4500);
}

// ---- tag description bubble ----
let tipFor = null;

function showTip(target) {
  const tag = target.closest ? target.closest(".tag.explains") : null;
  if (!tag) return;
  const tip = $("tip");
  tip.textContent = tag.dataset.tip;
  tip.classList.remove("hidden");
  const r = tag.getBoundingClientRect(), t = tip.getBoundingClientRect();
  let left = Math.min(window.innerWidth - t.width - 8, Math.max(8, r.left + r.width / 2 - t.width / 2));
  let top = r.top - t.height - 8;
  if (top < 8) top = r.bottom + 8;                     // no room above: go below
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  tipFor = tag;
}

function hideTip() {
  $("tip").classList.add("hidden");
  tipFor = null;
}

// ------------------------------------------------------------------------------------
// BOARD INPUT
// ------------------------------------------------------------------------------------

function tryPlace(cell) {
  const res = placeTower(cell.x, cell.y, candidate);
  if (!res.ok) { if (res.msg) setMsg(res.msg, true); return; }
  candidate = null; armed = false; view.armed = null;
  showCard();
  setMsg(state.phase === "build" ? "Placed. Press Enter for another one." : "Placed and locked in.");
}

// The enemy under the pointer, if any (nearest one within reach of its sprite).
function enemyAt(clientX, clientY) {
  const p = boardPoint(clientX, clientY);
  let best = null, bestD = Infinity;
  for (const e of state.enemies) {
    const lift = e.flying ? -0.18 : 0;
    const d = Math.hypot(e.x - p.x, e.y + lift - p.y);
    if (d <= Math.max(0.45, e.size * 0.6) && d < bestD) { bestD = d; best = e; }
  }
  return best;
}

function onBoardDown(ev) {
  unlockAudio();
  if (ev.pointerType === "mouse" && ev.button !== 0) return;   // only the left button builds and places
  const cell = cellAt(ev.clientX, ev.clientY);
  if (!cell) return;
  try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (err) { /* synthetic or lost pointer: carry on without capture */ }
  press = { cell, x: ev.clientX, y: ev.clientY, tower: state.towerAt.get(cellIndex(cell.x, cell.y)) || null, dragging: false };
}

// Draw or erase one block as part of a drag. Squares that cannot change are skipped silently.
function paintCell(x, y, place) {
  const i = cellIndex(x, y);
  if (state.towerAt.has(i) || !!state.blocks[i] === place) return;
  toggleBlock(x, y, true);
}

function onBoardMove(ev) {
  view.hover = cellAt(ev.clientX, ev.clientY);
  if (!press) return;
  // Dragging across squares in the build phase draws blocks. Start on an empty square to draw,
  // start on a bare block to erase. (Not while a sprite is selected or a tower is being moved.)
  if (!press.tower && !armed && !moveMode && state.phase === "build" && view.hover) {
    const c = view.hover;
    if (!press.paint && (c.x !== press.cell.x || c.y !== press.cell.y)) {
      press.paint = { place: !state.blocks[cellIndex(press.cell.x, press.cell.y)], last: press.cell };
      if (view.selected || view.selectedEnemy) clearSelection();
      paintCell(press.cell.x, press.cell.y, press.paint.place);
    }
    if (press.paint) {
      // fill in every square between the last one and this one, so a fast drag leaves no gaps
      const a = press.paint.last, n = Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y));
      for (let k = 1; k <= n; k++) paintCell(Math.round(a.x + ((c.x - a.x) * k) / n), Math.round(a.y + ((c.y - a.y) * k) / n), press.paint.place);
      press.paint.last = c;
      return;
    }
  }
  // dragging an unlocked tower starts once the pointer has moved a little
  if (!press.dragging && press.tower && !press.tower.locked && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 8) {
    press.dragging = true;
  }
  if (press.dragging) view.ghost = { pack: press.tower.pack, drawing: press.tower.drawing, px: ev.clientX, py: ev.clientY };
}

function onBoardUp(ev) {
  if (!press) return;
  const p = press;
  press = null;
  view.ghost = null;
  const cell = cellAt(ev.clientX, ev.clientY);
  if (ev.pointerType !== "mouse") view.hover = null;
  if (!cell) return;
  if (p.dragging) {
    if (cell.x !== p.tower.x || cell.y !== p.tower.y) {
      const res = moveTower(p.tower, cell.x, cell.y);
      if (!res.ok) setMsg(res.msg, true);
    }
    return;
  }
  if (p.paint) return;                         // that was a block-drawing drag
  if (cell.x !== p.cell.x || cell.y !== p.cell.y) return;
  // an enemy under the pointer is inspected, unless a sprite is selected for placing
  if (!armed && !moveMode && state.phase === "wave") {
    const enemy = enemyAt(ev.clientX, ev.clientY);
    if (enemy) {
      candidate = null;
      view.selected = null;
      view.selectedEnemy = view.selectedEnemy === enemy ? null : enemy;
      showCard();
      return;
    }
  }
  tapCell(cell);
}

function tapCell(cell) {
  if (state.phase !== "build" && state.phase !== "wave") return;
  const i = cellIndex(cell.x, cell.y);
  const tower = state.towerAt.get(i);

  if (tower) {                                   // tap a tower: select it (tap again to deselect)
    if (armed) { setMsg("That block already has a tower.", true); return; }   // a selected sprite blocks other picks
    if (moveMode) { setMsg("That block already has a tower.", true); return; }
    candidate = null; view.armed = null; view.selectedEnemy = null;
    view.selected = view.selected === tower ? null : tower;
    showCard();
    return;
  }

  if (state.blocks[i]) {                         // tap a bare block
    if (armed) { tryPlace(cell); return; }
    if (moveMode && view.selected) {
      const res = moveTower(view.selected, cell.x, cell.y);
      if (!res.ok) setMsg(res.msg, true);
      moveMode = false;
      showCard();
      return;
    }
    if (view.selected || view.selectedEnemy) { clearSelection(); return; }
    const res = toggleBlock(cell.x, cell.y);
    if (!res.ok) setMsg(res.msg, true);
    return;
  }

  // tap an empty square
  if (view.selected || view.selectedEnemy) clearSelection();
  if (state.phase !== "build") { setMsg(armed ? "Towers stand on blocks. Blocks can only be drawn between waves." : "Blocks can only be drawn between waves.", true); return; }
  const res = toggleBlock(cell.x, cell.y);
  if (!res.ok) setMsg(res.msg, true);
}

// ------------------------------------------------------------------------------------
// PER-FRAME REFRESH
// ------------------------------------------------------------------------------------

let shown = {};
// Only mention right click on devices with a mouse.
const RIGHT_CLICK_HINT = window.matchMedia && matchMedia("(pointer: fine)").matches ? " <b>RIGHT CLICK</b> to deselect." : "";
function setText(id, value) {
  if (shown[id] === value) return;
  shown[id] = value;
  $(id).textContent = value;
}

// Score bar animation state: the values last shown, gold waiting to be announced, and timers.
let seen = { hearts: 0, gold: 0, wave: 1, score: 0 };
let goldOwed = 0, goldTimer = 0, scoreTimer = 0;

// Restart a CSS animation class on an element.
function kick(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;          // force a reflow so the animation plays again
  el.classList.add(cls);
}

// A little "+25" that drifts out of a stat.
function chip(statId, text, minus = false) {
  const el = document.createElement("span");
  el.className = "chip" + (minus ? " minus" : "");
  el.textContent = text;
  $(statId).appendChild(el);
  setTimeout(() => el.remove(), 950);
}

// Long numbers shrink a little so they always fit their box.
function setStat(id, value) {
  const text = String(value);
  if (shown[id] === text) return;
  shown[id] = text;
  const el = $(id);
  el.textContent = text;
  fitStat(el);
}

// Shrink a score bar number until it fits inside its box. Measures the number (and the icon
// beside it) directly, so the floating "+N" chips never count towards the width.
function fitStat(el) {
  const box = el.closest(".stat");
  const max = box.id === "stat-wave" || box.id === "stat-score" ? 1.05 : 1.35;   // VT323 runs small, so start big
  const pad = box.clientWidth * 0.08;
  const icon = box.querySelector(".ico");
  let size = max;
  el.style.fontSize = size + "em";
  const fits = () => {
    const room = box.clientWidth - pad - (icon ? icon.getBoundingClientRect().width + 4 : 0);
    return el.getBoundingClientRect().width <= room && el.offsetHeight <= box.clientHeight;
  };
  while (size > 0.4 && !fits()) {
    size -= 0.05;
    el.style.fontSize = size + "em";
  }
}

/** Shrink the controls reminder under the board until it fits its strip. */
function fitHint() {
  const el = $("hint");
  let size = Number(el.dataset.max) || 16;
  el.style.fontSize = size + "px";
  while (size > 10 && el.scrollHeight > el.clientHeight + 1) el.style.fontSize = --size + "px";
}

/** Refit every score bar number (the bar changes size with the window). */
function fitAllStats() {
  for (const id of ["hud-hearts", "hud-gold", "hud-wave", "hud-score"]) fitStat($(id));
}

function refreshScoreBar() {
  const now = performance.now();
  setStat("hud-hearts", Math.max(0, state.hearts));
  setStat("hud-gold", state.gold);
  setStat("hud-wave", state.wave);
  setStat("hud-score", state.score);

  if (state.hearts < seen.hearts) kick($("stat-hearts"), "hurt");
  else if (state.hearts > seen.hearts) { kick($("stat-hearts"), "pop"); chip("stat-hearts", `+${state.hearts - seen.hearts}`); }

  // gold: spending shows at once, earnings are added up and announced a few times a second
  if (state.gold < seen.gold) chip("stat-gold", String(state.gold - seen.gold), true);
  else if (state.gold > seen.gold) goldOwed += state.gold - seen.gold;
  if (goldOwed > 0 && now - goldTimer > 320) {
    goldTimer = now;
    kick($("stat-gold"), "pop");
    chip("stat-gold", `+${goldOwed}`);
    sfx.tick();
    goldOwed = 0;
  }

  if (state.wave !== seen.wave) kick($("stat-wave"), "pop");
  if (state.score > seen.score && now - scoreTimer > 220) { scoreTimer = now; kick($("stat-score"), "pop"); }

  seen = { hearts: state.hearts, gold: state.gold, wave: state.wave, score: state.score };
}

/** Keep the score bar, wave controls, cards and game-over screen in step with the game. */
export function refreshUI() {
  refreshScoreBar();
  document.querySelectorAll("[data-speed]").forEach((b) => b.classList.toggle("on", Number(b.dataset.speed) === state.speed));

  const start = $("btn-start");
  const label = state.loadingWave ? "LOADING..." : state.phase === "wave" ? `WAVE ${state.wave}` : `START WAVE ${state.wave}`;
  setText("btn-start", label);
  start.disabled = state.phase !== "build" || state.loadingWave;

  // the price on the card can change while it is open (free towers used, gold spent)
  if (candidate) {
    setText("card-note", candidateNote());
  } else {
    shown["card-note"] = null;
  }
  // a selected tower can become locked when the wave starts
  if (view.selected && view.selected.locked !== shown.selLocked) { shown.selLocked = view.selected.locked; showCard(); }
  if (view.selected && !state.towers.includes(view.selected)) clearSelection();
  // a combo can form or break while a tower is open on the card (a neighbour placed, moved or sold)
  if (view.selected && (view.selected.combos || []).join(" ") !== shown.selCombos) showCard();
  if (view.selectedEnemy && view.selectedEnemy.dead) { view.selectedEnemy = null; showCard(); }

  // controls reminder under the board
  const hint = state.phase === "wave"
    ? "<b>TAP</b> a tower or an enemy to see its tags. Towers can still be bought."
    : "<b>TAP</b> or <b>DRAG</b> to draw blocks. Start on a block to erase. <b>TYPE</b> a word, <b>SELECT</b> the sprite, tap a block." + RIGHT_CLICK_HINT;
  if (shown.hint !== hint) { shown.hint = hint; $("hint").innerHTML = "<span>" + hint + "</span>"; fitHint(); }

  // incoming enemy group: covers the score bar for a few seconds
  const b = state.banner;
  const bannerKey = b && state.phase === "wave" && state.time <= b.until ? b.text : "";
  if (shown.banner !== bannerKey) {
    shown.banner = bannerKey;
    const el = $("hud-banner");
    el.classList.toggle("hidden", !bannerKey);
    if (bannerKey) {
      el.classList.toggle("boss", b.text.startsWith("BOSS"));
      $("banner-text").textContent = b.text.toUpperCase();
      $("banner-tags").textContent = b.tags.length ? b.tags.join("  ") : "nothing special";
    }
  }

  if (state.phase === "over" && $("over").classList.contains("hidden")) {
    $("over-stats").textContent = `You reached wave ${state.wave} with ${state.kills} kills. Score ${state.score}.`;
    decorate($("over"));
    $("over").classList.remove("hidden");
  }
}
