// =====================================================================================
// GAME - all rules and simulation. No drawing and no DOM in here.
//   state      the whole run (grid, towers, enemies, gold, hearts, wave)
//   build      blocks, towers, selling, moving
//   waves      picking random subjects, spawning groups
//   combat     targeting, the seven attack shapes, damage, status effects
// Numbers come from config.js. Tags are explained in GDD.md.
// =====================================================================================

import { CONFIG, ELEMENT_COLORS, COMBOS, COMBO_STRONGER, COMBO_SIZE, THEMES, WORKSHOP_TRICKS } from "./config.js";
import { db, loadPack, randomSubject, enemyTagsFor, categoriesFor } from "./data.js";
import { pickDrawing } from "./search.js";
import { sfx } from "./audio.js";

const B = CONFIG.board;
const T = CONFIG.tower;
const E = CONFIG.enemy;
const SHAPES = Object.keys(T.shapes);
const ELEMENTS = Object.keys(ELEMENT_COLORS);
const RANGES = Object.keys(T.ranges);
const KINDS = Object.keys(CONFIG.resist);

export const state = {
  phase: "menu",       // menu | build | wave | over
  paused: false,
  loadingWave: false,  // true while enemy packs for the next wave are being fetched
  speed: 1,            // 1, 2 or 3
  time: 0,             // simulated seconds since the run began
  hearts: 0, gold: 0, wave: 1, score: 0, kills: 0,
  freeTowers: 0,       // free placements left
  paidTowers: 0,       // paid placements so far (drives the rising price)
  blocks: new Uint8Array(B.cols * B.rows),
  towers: [],
  towerAt: new Map(),  // cell index -> tower
  enemies: [],
  shots: [],
  fx: [],              // short-lived visuals: floating text, rings, zap lines
  groundPath: null,    // { pts, len } the main walking route for this wave
  groundPaths: [],     // one route, or two when there are equally short ways home (enemies alternate)
  routeTurn: 0,        // counts walkers so they take the routes in turn
  flyPath: null,       // { pts, len } the straight route for Flying enemies
  spawnQueue: [],      // enemies waiting to enter, sorted by time
  banner: null,        // { text, tags, until } the group announcement
  nextId: 1,
};

export const cellIndex = (x, y) => y * B.cols + x;
export const inBoard = (x, y) => x >= 0 && y >= 0 && x < B.cols && y < B.rows;
const isSpawn = (x, y) => x === B.spawn.x && y === B.spawn.y;
const isHome = (x, y) => x === B.home.x && y === B.home.y;

// ------------------------------------------------------------------------------------
// RUN
// ------------------------------------------------------------------------------------

/** Wipe everything and start a fresh run in the build phase. */
export function newRun() {
  Object.assign(state, {
    phase: "build", paused: false, loadingWave: false, time: 0,
    hearts: CONFIG.run.hearts, gold: CONFIG.run.startGold, wave: 1, score: 0, kills: 0,
    freeTowers: CONFIG.run.freeTowers, paidTowers: 0,
    towers: [], enemies: [], shots: [], fx: [], spawnQueue: [], banner: null, mines: [],
    retired: [],                          // sold or shattered towers, kept for the run-over scoreboard
    discovered: { combos: [], themes: [] },   // every combo and theme formed this run, in order
  });
  state.shownTier = -1;      // which layout rating word was last announced (-1 = none yet)
  state.blocks.fill(0);
  state.towerAt.clear();
  refreshPaths();
  refreshAuras();            // clears last run's theme outlines and combo fills (no towers left)
}

/** Price of the next tower: 0 while free placements remain. */
export function towerPrice() {
  if (state.freeTowers > 0) return 0;
  return CONFIG.run.towerCost + CONFIG.run.towerCostGrowth * state.paidTowers;
}

// ------------------------------------------------------------------------------------
// PATHS
// ------------------------------------------------------------------------------------

/**
 * Shortest 4-direction route from spawn to home through cells without blocks.
 * `extra` is an optional cell index treated as blocked (used to test a placement).
 * Returns an array of {x, y} cells, or null when the route is sealed.
 */
export function findPath(extra = -1, blocks = state.blocks) {
  const total = B.cols * B.rows;
  const prev = new Int32Array(total).fill(-1);
  const start = cellIndex(B.spawn.x, B.spawn.y);
  const goal = cellIndex(B.home.x, B.home.y);
  const queue = [start];
  prev[start] = start;
  const dirs = [[0, 1], [-1, 0], [1, 0], [0, -1]];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    if (cur === goal) break;
    const cx = cur % B.cols, cy = (cur / B.cols) | 0;
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBoard(nx, ny)) continue;
      const ni = cellIndex(nx, ny);
      if (prev[ni] !== -1 || blocks[ni] || ni === extra) continue;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (prev[goal] === -1) return null;
  const cells = [];
  for (let c = goal; ; c = prev[c]) {
    cells.push({ x: c % B.cols, y: (c / B.cols) | 0 });
    if (c === start) break;
  }
  return cells.reverse();
}

function makePath(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, len: cum[cum.length - 1] };
}

/** Position at distance d along a path (clamped to its ends). */
export function pathPoint(path, d) {
  if (d <= 0) return path.pts[0];
  if (d >= path.len) return path.pts[path.pts.length - 1];
  let i = 1;
  while (path.cum[i] < d) i++;
  const a = path.pts[i - 1], b = path.pts[i];
  const f = (d - path.cum[i - 1]) / (path.cum[i] - path.cum[i - 1]);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

// Steps to home from every open cell (-1 = cannot reach home). Walking "downhill" on this
// field always gives a shortest route, and a cell with two downhill neighbours is a fork.
function distanceField() {
  const dist = new Int32Array(B.cols * B.rows).fill(-1);
  const goal = cellIndex(B.home.x, B.home.y);
  const queue = [goal];
  dist[goal] = 0;
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    const cx = cur % B.cols, cy = (cur / B.cols) | 0;
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBoard(nx, ny)) continue;
      const ni = cellIndex(nx, ny);
      if (dist[ni] !== -1 || state.blocks[ni]) continue;
      dist[ni] = dist[cur] + 1;
      queue.push(ni);
    }
  }
  return dist;
}

// Walk from spawn to home, always stepping to a cell one step closer.
// `side` is 0 for the route that leans left at forks and 1 for the one that leans right, so the
// two routes are mirror images of each other on a mirrored maze.
//
// Not every tie is a fork. In open space "down then left" and "left then down" are the same
// trip, so both routes make the same choice there and stay together. A real fork is either two
// opposite ways on (left and right, or up and down) or two ways on that do not meet again at the corner.
function routeBy(dist, side) {
  const at = (cx, cy) => (inBoard(cx, cy) ? dist[cellIndex(cx, cy)] : -1);
  const cells = [{ x: B.spawn.x, y: B.spawn.y }];
  let x = B.spawn.x, y = B.spawn.y;
  if (at(x, y) < 0) return null;
  while (at(x, y) > 0) {
    const d = at(x, y);
    const down = at(x, y + 1) === d - 1, up = at(x, y - 1) === d - 1;
    const left = at(x - 1, y) === d - 1, right = at(x + 1, y) === d - 1;
    let dx = 0, dy = 0;
    if (down && up) {
      dy = side === 0 ? 1 : -1;                       // fork: one route goes down, the other up
    } else if (!down && !up) {
      dx = left && right ? (side === 0 ? -1 : 1) : left ? -1 : 1;   // fork if both, else the only way
    } else {
      const vy = down ? 1 : -1;
      // a sideways step is a separate corridor only if it does not rejoin at the diagonal square
      const leftIsFork = left && at(x - 1, y + vy) !== d - 2;
      const rightIsFork = right && at(x + 1, y + vy) !== d - 2;
      if (leftIsFork && rightIsFork) dx = side === 0 ? -1 : 1;
      else if (leftIsFork && side === 0) dx = -1;     // the left-leaning route takes the left corridor
      else if (rightIsFork && side === 1) dx = 1;     // the right-leaning route takes the right corridor
      // Open space: step sideways only when that heads towards the home column, so split routes
      // hug the obstacle on the way out and merge again as soon as they can. Otherwise go vertical.
      else if (left && !leftIsFork && x > B.home.x) dx = -1;
      else if (right && !rightIsFork && x < B.home.x) dx = 1;
      else dy = vy;
    }
    x += dx; y += dy;
    cells.push({ x, y });
  }
  return cells;
}

/**
 * Rebuild the routes. Enemies enter from one cell above the spawn.
 * When there are equally short ways home the route splits in two and walkers alternate:
 * one route leans left at every fork, the other leans right (see routeBy).
 */
export function refreshPaths() {
  const entry = { x: B.spawn.x, y: B.spawn.y - 1 };
  const dist = distanceField();
  const a = routeBy(dist, 0) || [B.spawn, B.home];
  const b = routeBy(dist, 1) || a;
  const same = a.length === b.length && a.every((c, i) => c.x === b[i].x && c.y === b[i].y);
  state.groundPath = makePath([entry, ...a]);
  state.groundPaths = same ? [state.groundPath] : [state.groundPath, makePath([entry, ...b])];
  state.flyPath = makePath([entry, { x: B.home.x, y: B.home.y }]);
  // Jump enemies may hop over one block, so they get their own (possibly shorter) route
  const jump = findJumpPath();
  state.jumpPath = jump && jump.length < a.length ? makePath([entry, ...jump]) : null;
}

/** Shortest route that is allowed to cross ONE block (a single hop, never two blocks in a row). */
function findJumpPath() {
  const total = B.cols * B.rows;
  const prev = new Int32Array(total * 2).fill(-1);       // state = cell * 2 + (hop used ? 1 : 0)
  const start = cellIndex(B.spawn.x, B.spawn.y) * 2;
  const home = cellIndex(B.home.x, B.home.y);
  const queue = [start];
  prev[start] = start;
  let goal = -1;
  for (let q = 0; q < queue.length; q++) {
    const st = queue[q], cell = st >> 1, used = st & 1;
    if (cell === home) { goal = st; break; }
    const cx = cell % B.cols, cy = (cell / B.cols) | 0;
    const onBlock = !!state.blocks[cell];
    for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!inBoard(nx, ny)) continue;
      const ni = cellIndex(nx, ny);
      let nu = used;
      if (state.blocks[ni]) { if (used || onBlock) continue; nu = 1; }
      const ns = ni * 2 + nu;
      if (prev[ns] !== -1) continue;
      prev[ns] = st;
      queue.push(ns);
    }
  }
  if (goal < 0) return null;
  const cells = [];
  for (let st = goal; ; st = prev[st]) { const c = st >> 1; cells.push({ x: c % B.cols, y: (c / B.cols) | 0 }); if (st === start) break; }
  return cells.reverse();
}

// ------------------------------------------------------------------------------------
// MAZE STYLE - a rating and gold bonus for mazes that stray from the "optimal" zigzag
// ------------------------------------------------------------------------------------
//
// The strongest maze is a zigzag: full-width walls with one gap, alternating left and right.
// To reward anything more daring, each lock-in rates the maze from 0 (that zigzag) to 1:
//   challenge   = how much shorter the route is than the best zigzag route (1 = a straight run)
//   originality = how little the blocks overlap any zigzag layout (1 = nothing in common)
//   score       = challenge * challengeWeight + originality * originalityWeight
// The score picks a word from CONFIG.style.tiers and pays gold in proportion.

let zigzags = null;   // cached: the zigzag layouts for this board and the longest route they give

function buildZigzags() {
  const layouts = [];
  for (const firstRow of [1, 2]) {            // walls on rows 1,3,5... or on rows 2,4,6...
    for (const firstGap of [0, B.cols - 1]) { // first gap on the left or on the right
      const blocks = new Uint8Array(B.cols * B.rows);
      let gap = firstGap;
      for (let y = firstRow; y < B.rows - 1; y += 2) {
        for (let x = 0; x < B.cols; x++) if (x !== gap) blocks[cellIndex(x, y)] = 1;
        gap = gap === 0 ? B.cols - 1 : 0;
      }
      const path = findPath(-1, blocks);
      layouts.push({ blocks, steps: path ? path.length - 1 : 0 });
    }
  }
  zigzags = { layouts, bestSteps: Math.max(...layouts.map((l) => l.steps)) };
}

/** Rate the current maze. Returns { score, challenge, originality, tier, word, gold }. */
export function mazeStyle() {
  if (!zigzags) buildZigzags();
  const S = CONFIG.style;
  const path = findPath();
  const steps = path ? path.length - 1 : 0;
  const straight = Math.abs(B.home.x - B.spawn.x) + Math.abs(B.home.y - B.spawn.y);
  const challenge = 1 - Math.min(1, Math.max(0, (steps - straight) / Math.max(1, zigzags.bestSteps - straight)));
  let overlap = 0;                             // best match against any zigzag (shared blocks / all blocks in either)
  for (const layout of zigzags.layouts) {
    let both = 0, either = 0;
    for (let i = 0; i < state.blocks.length; i++) {
      if (state.blocks[i] && layout.blocks[i]) both++;
      if (state.blocks[i] || layout.blocks[i]) either++;
    }
    overlap = Math.max(overlap, either ? both / either : 0);
  }
  const originality = 1 - overlap;
  const score = Math.min(1, challenge * S.challengeWeight + originality * S.originalityWeight);
  let tier = 0;
  S.tiers.forEach((t, i) => { if (score >= t.min) tier = i; });
  const gold = Math.round(score * (S.goldMax + S.goldMaxPerWave * (state.wave - 1)));
  return { score, challenge, originality, tier, word: S.tiers[tier].word, gold };
}

// ------------------------------------------------------------------------------------
// BUILDING
// ------------------------------------------------------------------------------------

/**
 * Place or remove a block. Build phase only. Returns { ok, msg, placed }.
 * A block is refused if it would leave no route from spawn to home.
 */
export function toggleBlock(x, y, quiet = false) {   // quiet: no error buzz (used while dragging)
  if (state.phase !== "build") return { ok: false, msg: "Blocks can only be changed between waves." };
  if (isSpawn(x, y) || isHome(x, y)) return { ok: false, msg: "That square must stay open." };
  const i = cellIndex(x, y);
  if (state.blocks[i]) {
    if (state.towerAt.has(i)) return { ok: false, msg: "Remove the tower first." };
    state.blocks[i] = 0;
    refreshPaths();
    sfx.erase();
    return { ok: true, placed: false };
  }
  if (!findPath(i)) { if (!quiet) sfx.error(); return { ok: false, msg: "That would seal the path. Enemies need a way through." }; }
  state.blocks[i] = 1;
  refreshPaths();
  sfx.block();
  return { ok: true, placed: true };
}

/**
 * Turn a searched sprite into a tower on a block.
 * `candidate` = { subject, pack, drawing, caption, tags }. Returns { ok, msg, tower }.
 */
export function placeTower(x, y, candidate) {
  if (state.phase !== "build" && state.phase !== "wave") return { ok: false, msg: "" };
  const i = cellIndex(x, y);
  if (!state.blocks[i]) return { ok: false, msg: "Towers stand on blocks. Place a block here first." };
  if (state.towerAt.has(i)) return { ok: false, msg: "That block already has a tower." };
  const price = towerPrice();
  if (price > state.gold) { sfx.error(); return { ok: false, msg: `Not enough gold. The next tower costs ${price}.` }; }
  const usedFree = state.freeTowers > 0;
  if (usedFree) state.freeTowers--; else { state.gold -= price; state.paidTowers++; }
  const tower = {
    id: state.nextId++, x, y,
    subject: candidate.subject, pack: candidate.pack, drawing: candidate.drawing,
    categories: categoriesFor(candidate.subject, candidate.caption),   // combo categories of this exact drawing
    caption: candidate.caption, tags: candidate.tags,
    stats: towerStats(candidate.tags),
    cd: 0.3, paid: price, usedFree,
    locked: state.phase === "wave",   // towers placed mid-wave are locked at once
    target: null, beamRamp: 1, beamAcc: 0, beamTarget: null,
    stunUntil: 0, recoil: 0, wavesAlive: 0, kills: 0, damage: 0,   // damage = total dealt, for the scoreboard
    aura: { dmg: 1, rate: 1, range: 0, imbue: [] },
    combos: [], combo: noCombo(),   // categories it is in a combo for, and the summed combo bonus
  };
  state.towers.push(tower);
  state.towerAt.set(i, tower);
  refreshAuras();
  sfx.place();
  return { ok: true, tower };
}

/** Gold handed back if this tower is removed right now. */
export function refundFor(tower) {
  return tower.locked ? Math.floor(tower.paid * CONFIG.run.sellRefund) : tower.paid;
}

/** Keep a record of a tower leaving the board (sold or shattered) so the run-over scoreboard can show it. */
function retire(tower) {
  if (tower.damage > 0 && state.retired) state.retired.push(tower);
}

/** Note a combo or theme formed this run (kind = "combos" or "themes"). */
function discover(kind, id) {
  if (state.discovered && !state.discovered[kind].includes(id)) state.discovered[kind].push(id);
}

/** Remove a tower. Unlocked towers come back in full (free slot or gold), locked ones at the sell rate. */
export function removeTower(tower) {
  retire(tower);
  const i = cellIndex(tower.x, tower.y);
  state.gold += refundFor(tower);
  if (!tower.locked) {
    if (tower.usedFree) state.freeTowers++; else state.paidTowers--;
  }
  state.towers.splice(state.towers.indexOf(tower), 1);
  state.towerAt.delete(i);
  refreshAuras();
  sfx.sell();
}

/** Move an unlocked tower to another free block. Returns { ok, msg }. */
export function moveTower(tower, x, y) {
  if (tower.locked) return { ok: false, msg: "This tower is locked in. Sell it to free the block." };
  const to = cellIndex(x, y);
  if (!state.blocks[to]) return { ok: false, msg: "Towers stand on blocks." };
  if (state.towerAt.has(to)) return { ok: false, msg: "That block already has a tower." };
  state.towerAt.delete(cellIndex(tower.x, tower.y));
  tower.x = x; tower.y = y;
  state.towerAt.set(to, tower);
  refreshAuras();
  sfx.place();
  return { ok: true };
}

// ------------------------------------------------------------------------------------
// TAGS -> STATS
// ------------------------------------------------------------------------------------

/** Work out what a tower does from its tags. */
export function towerStats(tags) {
  const shape = tags.find((t) => SHAPES.includes(t)) || "Single";
  let elems = tags.filter((t) => ELEMENTS.includes(t));
  if (!elems.length && shape !== "Support") elems = ["Physical"];
  const rangeTag = tags.find((t) => RANGES.includes(t)) || T.defaultRange;
  const has = (t) => tags.includes(t);
  const X = CONFIG.special;
  const sh = T.shapes[shape], rg = T.ranges[rangeTag];
  let dmg = T.baseDamage * sh.dmg * rg.dmg;
  let cd = T.baseCooldown * sh.cd;
  if (has("Rapid")) { cd *= T.rapid.cd; dmg *= T.rapid.dmg; }
  if (has("Heavy")) { cd *= T.heavy.cd; dmg *= T.heavy.dmg; }
  if (has("Weak")) dmg *= T.weakDamage;
  if (has("Burst")) { cd *= X.burstCooldown; dmg *= X.burstDamage; }
  if (has("Glass Cannon")) dmg *= X.glassDamage;
  if (elems.includes("Physical")) dmg *= 1 + (T.physicalBonus - 1) / elems.length;
  const sonic = elems.includes("Sonic");
  return {
    shape, elems, rangeTag, range: rg.cells, dmg, cd,
    // Versatile hits ground and air; Anti-Air hits ONLY air, harder; Sonic hits everything
    antiAir: has("Versatile") || has("Anti-Air") || sonic,
    airOnly: has("Anti-Air") && !sonic,
    area: ["Pulse", "Splash", "Artillery", "Sweep", "Spin"].includes(shape),   // can reach Digger enemies underground
    targeting: has("Assassin") ? "assassin" : has("Giant Slayer") ? "giant" : has("Tactical") ? "tactical" : null,
    holy: elems.includes("Holy"),
    crit: has("Crit"), stun: has("Stun"), slow: has("Slow"), bleed: has("Bleed"),
    knockback: has("Knockback"), shred: has("Shred"), gold: has("Gold"),
    buff: has("Buff"), haste: has("Haste"), reach: has("Reach"), heal: has("Heal"),
    monstrous: has("Monstrous"), burst: has("Burst"), explode: has("Explode"), timewarp: has("Timewarp"),
    tasty: has("Tasty"), magnet: has("Magnet"), sleep: has("Sleep"), confuse: has("Confuse"),
    freezeFrame: has("Freeze Frame"), echo: has("Echo"), mineLayer: has("Mine Layer"), warmup: has("Warm-up"),
    trophy: has("Trophy"), glass: has("Glass Cannon"), lucky: has("Lucky"), shatter: has("Shatter"),
    execute: has("Execute"), copycat: has("Copycat"),
    color: ELEMENT_COLORS[elems[0]] || "#6b7280",
  };
}

/** Support towers boost the 8 blocks around them. Recomputed whenever towers change. */
export function refreshAuras() {
  refreshCopycats();
  refreshCombos();
  refreshThemes();
  for (const t of state.towers) t.aura = { dmg: 1, rate: 1, range: 0, imbue: [] };
  for (const s of state.towers) {
    if (s.stats.shape !== "Support") continue;
    for (const t of state.towers) {
      if (t === s || t.stats.shape === "Support") continue;
      if (Math.abs(t.x - s.x) > 1 || Math.abs(t.y - s.y) > 1) continue;
      if (s.stats.buff) t.aura.dmg += T.buffDamage;
      if (s.stats.haste) t.aura.rate += T.hasteRate;
      if (s.stats.reach) t.aura.range = Math.min(T.reachMax, t.aura.range + T.reachBonus);
      for (const el of s.stats.elems) if (!t.aura.imbue.includes(el) && !t.stats.elems.includes(el)) t.aura.imbue.push(el);
    }
  }
}

/**
 * Copycat towers take the attack of the strongest attacking tower on the 8 blocks around them
 * (best damage per second). With nobody to copy they use their own tags.
 */
function refreshCopycats() {
  for (const t of state.towers) {
    if (!t.tags.includes("Copycat")) continue;
    let best = null, bestDps = 0;
    for (const o of state.towers) {
      if (o === t || o.tags.includes("Copycat") || o.stats.shape === "Support") continue;
      if (Math.abs(o.x - t.x) > 1 || Math.abs(o.y - t.y) > 1) continue;
      const dps = o.stats.dmg / o.stats.cd;
      if (dps > bestDps) { bestDps = dps; best = o; }
    }
    t.copying = best;
    t.stats = towerStats(best ? best.tags.concat("Copycat") : t.tags);
  }
}

// Support auras switched off by a nearby Jammer enemy.
const NO_AURA = { dmg: 1, rate: 1, range: 0, imbue: [] };
const auraOf = (tower) => (tower.jammed ? NO_AURA : tower.aura);

/** Reach of a tower in cells, including Reach auras, combo range and the Castle theme. */
export const towerRange = (tower) => tower.stats.range + auraOf(tower).range + tower.combo.range +
  (hasTheme(tower, "castle") ? THEMES.castle.n.range : 0);

// ------------------------------------------------------------------------------------
// THEMES
// ------------------------------------------------------------------------------------

const hasTheme = (tower, id) => !!(tower.themes && tower.themes.includes(id));
let themeKeys = new Set();     // groups already announced, so only NEW themes pop up

/**
 * Find every theme. For each theme, towers that belong to it link to touching towers (8 around)
 * that also belong to it AND are a different kind of thing and a different sprite. A connected
 * group with 3 or more different kinds forms the theme; every tower in the group gets it.
 */
function refreshThemes() {
  const before = new Map(state.towers.map((t) => [t, t.themes || []]));
  for (const t of state.towers) t.themes = [];
  state.themeGroups = [];
  const keys = new Set();
  for (const id of Object.keys(THEMES)) {
    const members = state.towers.filter((t) => t.subject.themes && t.subject.themes.includes(id));
    if (members.length < 3) continue;
    const seen = new Set();
    for (const start of members) {
      if (seen.has(start)) continue;
      const group = [start];
      seen.add(start);
      for (let q = 0; q < group.length; q++) {
        const a = group[q];
        for (const b of members) {
          if (seen.has(b) || Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1) continue;
          if (a.subject.kind === b.subject.kind || group.some((t) => t.subject.name === b.subject.name)) continue;   // one of each sprite
          seen.add(b); group.push(b);
        }
      }
      const kinds = new Set(group.map((t) => t.subject.kind));
      if (group.length < 3 || kinds.size < 3) continue;
      for (const t of group) t.themes.push(id);
      discover("themes", id);
      const key = id + ":" + group.map((t) => t.id).sort((p, q) => p - q).join(",");
      keys.add(key);
      state.themeGroups.push({ id, towers: group, key });
      // announce only a theme that is new here, not a group that just grew
      if (!themeKeys.has(key) && !group.some((t) => (before.get(t) || []).includes(id))) {
        const cx = group.reduce((s, t) => s + t.x, 0) / group.length, cy = group.reduce((s, t) => s + t.y, 0) / group.length;
        state.fx.push({ kind: "text", x: cx, y: cy - 0.4, text: THEMES[id].name.toUpperCase() + " THEME", color: THEMES[id].color, scale: 1, life: 1.8, max: 1.8 });
        burst(cx, cy, 14, [THEMES[id].color, "#ffffff"]);
        sfx.theme();
      }
    }
  }
  themeKeys = keys;
}

/** Start-of-wave theme work: Workshop towers draw a random trick for this wave. */
function themesStartWave() {
  for (const t of state.towers) {
    if (t.workshopTrick) { t.workshopTrick = null; t.stats = towerStats(t.copying ? t.copying.tags.concat("Copycat") : t.tags); }
    if (!hasTheme(t, "workshop") || t.stats.shape === "Support") continue;
    const options = WORKSHOP_TRICKS.filter((x) => !t.tags.includes(x));
    t.workshopTrick = options[Math.floor(Math.random() * options.length)];
    t.stats = towerStats((t.copying ? t.copying.tags.concat("Copycat") : t.tags).concat(t.workshopTrick));
    floatText(t.x, t.y - 0.45, t.workshopTrick.toUpperCase(), THEMES.workshop.color, 0.7);
  }
  for (const t of state.towers) t.farmKills = 0;
}

/** End-of-wave theme payouts: Farm harvest, Hospital hearts, School study. */
function themesEndWave() {
  for (const g of state.themeGroups || []) {
    const cx = g.towers.reduce((s, t) => s + t.x, 0) / g.towers.length, cy = g.towers.reduce((s, t) => s + t.y, 0) / g.towers.length;
    if (g.id === "farm") {
      const kills = g.towers.reduce((s, t) => s + (t.farmKills || 0), 0);
      const gold = kills * THEMES.farm.n.goldPerKill;
      if (gold) { state.gold += gold; floatText(cx, cy - 0.5, `HARVEST +${gold}`, THEMES.farm.color, 0.9); }
    }
    if (g.id === "hospital" && state.wave % 2 === 1 && state.hearts < CONFIG.run.hearts) {   // odd waves only
      // 1 heart, plus 1 more for every `healPerExtra` Heal towers in the group
      const n = THEMES.hospital.n;
      const healers = g.towers.filter((t) => t.stats.heal).length;
      const gain = n.hearts + Math.floor(healers / n.healPerExtra);
      const before = state.hearts;
      state.hearts = Math.min(CONFIG.run.hearts, state.hearts + gain);
      floatText(cx, cy - 0.5, `+${state.hearts - before} heart${state.hearts - before === 1 ? "" : "s"}`, THEMES.hospital.color, 0.9);
    }
  }
  for (const t of state.towers) if (hasTheme(t, "school")) t.study = Math.min(THEMES.school.n.max, (t.study || 0) + THEMES.school.n.perWave);
}

/** Per-frame theme effects that do not belong to a single attack: Beach tide, Winter blizzard, Garden slow, haunted spots. */
function updateThemes(dt) {
  const now = state.time;
  for (const t of state.towers) {
    if (hasTheme(t, "beach")) {
      const n = THEMES.beach.n;
      t.tideT = (t.tideT ?? n.every * Math.random()) - dt;
      if (t.tideT <= 0) {
        t.tideT = n.every;
        let any = false;
        for (const e of state.enemies) if (!e.flying && Math.hypot(e.x - t.x, e.y - t.y) <= n.radius) { e.kbImmuneUntil = 0; pushEnemy(e, n.cells); any = true; }
        if (any) state.fx.push({ kind: "ring", x: t.x, y: t.y, r: n.radius, color: THEMES.beach.color, life: 0.5, max: 0.5 });
      }
    }
    if (hasTheme(t, "winter")) {
      const n = THEMES.winter.n;
      t.blizzardT = (t.blizzardT ?? n.every * Math.random()) - dt;
      if (t.blizzardT <= 0) {
        t.blizzardT = n.every;
        let any = false;
        for (const e of state.enemies) if (Math.hypot(e.x - t.x, e.y - t.y) <= n.radius) { stunEnemy(e, n.time); any = true; }
        if (any) { state.fx.push({ kind: "ring", x: t.x, y: t.y, r: n.radius, color: "#e0f2fe", life: 0.5, max: 0.5 }); sfx.freeze(); }
      }
    }
  }
  const gardens = state.towers.filter((t) => hasTheme(t, "garden"));
  if (gardens.length) {
    const n = THEMES.garden.n;
    for (const e of state.enemies) if (!e.flying && gardens.some((t) => Math.hypot(e.x - t.x, e.y - t.y) <= n.radius)) slowEnemy(e, n.slow, 0.2);
  }
  if (state.haunts && state.haunts.length) {
    state.haunts = state.haunts.filter((h) => now < h.until);
    for (const h of state.haunts) for (const e of state.enemies) {
      if (Math.hypot(e.x - h.x, e.y - h.y) <= h.r) { e.curseMult = Math.max(e.curseMult || 0, CONFIG.elements.Dark.curse); e.curseUntil = Math.max(e.curseUntil, now + 0.3); }
    }
  }
}

// ------------------------------------------------------------------------------------
// COMBOS
// ------------------------------------------------------------------------------------

function noCombo() {
  return {
    dmg: 1, rate: 1, range: 0, crit: 0, status: 1, gold: 1, imbue: [], antiAir: false, slow: false, knockback: false, pierceArmor: false, blastProof: false,
    // stronger versions (1 or 0 = no change), see COMBO_STRONGER in config.js
    waterPush: 1, flyerDamage: 1, rootTime: 1, curseBonus: 0, poisonPower: 1, slowFactor: 1, knockback2: 1,
    strong: [],                 // categories this tower gets the stronger version of
  };
}


/**
 * Find every combo. Two towers link when they stand on neighbouring blocks (8 around), share a
 * category, and are different sprites. Each tower gets each category's bonus once.
 * New links pop a label between the two towers and play a sound.
 */
let comboMembers = new Set();   // "cat:towerId" pairs from the last refresh, so only NEW combos pop up

function refreshCombos() {
  // A tower is in a combo for EVERY category it shares with a touching tower (8 around, a different
  // sprite). So a tower can be in several combos at once, one per matching category (2026-11-12, this
  // replaced the one-combo-at-a-time lock-in). Each combo's size counts its own linked group.
  const near = (a, b) => a !== b && Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && a.subject.name !== b.subject.name;
  const fits = (t, cat) => t.categories.includes(cat) && COMBOS[cat];
  for (const t of state.towers) { t.combos = []; t.links = []; t.comboSizes = {}; }
  // Build each category's groups oldest tower first. A group never holds two of the same sprite
  // (Mark, 2026-11-12): 10 lemons around an apple make a 2-tower Food combo, not an 11-tower one. A
  // duplicate left out can still start its own group with other towers that are not in one yet.
  const oldest = state.towers.slice().sort((p, q) => p.id - q.id);
  for (const cat of Object.keys(COMBOS)) {
    const placed = new Set();
    for (const start of oldest) {
      if (placed.has(start) || !fits(start, cat)) continue;
      const group = [start], names = new Set([start.subject.name]);
      placed.add(start);
      for (let q = 0; q < group.length; q++) {
        for (const o of oldest) {
          if (placed.has(o) || names.has(o.subject.name) || !fits(o, cat) || !near(group[q], o)) continue;
          group.push(o); names.add(o.subject.name); placed.add(o);
        }
      }
      if (group.length < 2) continue;
      for (const t of group) {
        t.combos.push(cat);
        t.comboSizes[cat] = group.length;
        for (const o of group) if (near(t, o)) t.links.push({ to: o, cat });
      }
      discover("combos", cat);
    }
  }
  // keep each tower's combos in its own category order (wedge order on the block)
  for (const t of state.towers) t.combos.sort((p, q) => t.categories.indexOf(p) - t.categories.indexOf(q));
  // which combos are new since last time (for the pop-up), newest tower first
  const fresh = [];
  const members = new Set();
  for (const t of state.towers) for (const cat of t.combos) members.add(cat + ":" + t.id);
  const announced = new Set();
  for (const t of state.towers.slice().sort((p, q) => q.id - p.id)) {
    for (const cat of t.combos) {
      if (comboMembers.has(cat + ":" + t.id) || announced.has(cat + ":" + t.id)) continue;
      const partner = t.links.find((l) => l.cat === cat).to;
      announced.add(cat + ":" + t.id); announced.add(cat + ":" + partner.id);
      fresh.push({ a: t, b: partner, cat });
    }
  }
  comboMembers = members;
  for (const t of state.towers) {
    const c = noCombo();
    for (const cat of t.combos) {
      const bonus = COMBOS[cat].bonus;
      // bigger combos: number bonuses grow, on/off-only combos give extra damage instead (COMBO_SIZE in config.js)
      const extra = Math.max(0, Math.min(t.comboSizes[cat], COMBO_SIZE.maxTowers) - 2);
      const k = 1 + extra * COMBO_SIZE.bonusPerExtra;
      const chance = (p) => Math.min(COMBO_SIZE.chanceCap, p * k);
      const grows = ["dmg", "rate", "range", "crit", "status", "gold", "stunChance", "confuseChance", "pull", "markChance"].some((f) => bonus[f]);
      if (!grows) c.dmg += extra * COMBO_SIZE.damagePerExtra;
      if (bonus.dmg) c.dmg += bonus.dmg * k;
      if (bonus.rate) c.rate += bonus.rate * k;
      if (bonus.range) c.range += bonus.range * k;
      if (bonus.crit) c.crit += bonus.crit * k;
      if (bonus.status) c.status *= 1 + (bonus.status - 1) * k;
      if (bonus.gold) c.gold *= 1 + (bonus.gold - 1) * k;
      if (bonus.imbue && !c.imbue.includes(bonus.imbue)) c.imbue.push(bonus.imbue);
      for (const flag of ["antiAir", "slow", "knockback", "pierceArmor", "blastProof"]) if (bonus[flag]) c[flag] = true;
      // chance-based bonuses (Rocks, Toys, Signs): doubled if the tower already does that thing
      if (bonus.stunChance) { c.stunChance = chance(bonus.stunChance * (t.stats.stun ? 2 : 1)); if (t.stats.stun) c.strong.push(cat); }
      if (bonus.confuseChance) { c.confuseChance = chance(bonus.confuseChance * (t.stats.confuse ? 2 : 1)); if (t.stats.confuse) c.strong.push(cat); }
      if (bonus.pull) { c.pull = chance(bonus.pull * (t.stats.magnet ? 2 : 1)); if (t.stats.magnet) c.strong.push(cat); }
      if (bonus.markChance) { c.markChance = chance(bonus.markChance * (t.stats.tasty ? 2 : 1)); if (t.stats.tasty) c.strong.push(cat); }
      // Already has the effect this combo gives? Then it gets the stronger version instead.
      const X = COMBO_STRONGER, own = t.stats;
      const already = (bonus.imbue && own.elems.includes(bonus.imbue)) || (bonus.antiAir && own.antiAir) ||
        (bonus.slow && own.slow) || (bonus.knockback && own.knockback);
      if (already) {
        c.strong.push(cat);
        if (bonus.imbue === "Water") c.waterPush = X.waterPush;
        if (bonus.imbue === "Nature") c.rootTime = X.rootTime;
        if (bonus.imbue === "Dark") c.curseBonus = X.curseBonus;
        if (bonus.imbue === "Poison") c.poisonPower = X.poisonPower;
        if (bonus.antiAir) c.flyerDamage = X.flyerDamage;
        if (bonus.slow) c.slowFactor = X.slowFactor;
        if (bonus.knockback) c.knockback2 = X.knockback;
      }
    }
    t.combo = c;
  }
  for (const { a, b, cat } of fresh) {
    if (!b) continue;
    state.fx.push({ kind: "text", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 0.35, text: COMBOS[cat].name.toUpperCase() + (COMBOS[cat].mini ? " MINI COMBO" : " COMBO"), color: COMBOS[cat].color, scale: 0.85, life: 1.4, max: 1.4 });
  }
  if (fresh.length) sfx.combo();
}

// ------------------------------------------------------------------------------------
// WAVES
// ------------------------------------------------------------------------------------

/** Lock the board in, pick random subjects, and begin spawning. */
export async function startWave() {
  if (state.phase !== "build" || state.loadingWave) return;
  state.loadingWave = true;
  const W = CONFIG.waves;
  const groups = W.baseGroups + Math.floor((state.wave - 1) / W.groupsPerWaves);
  const size = W.groupSize + (W.groupSizeGrowthEvery ? Math.floor((state.wave - 1) / W.groupSizeGrowthEvery) : 0);
  const plan = [];
  try {
    const subjects = Array.from({ length: groups }, randomSubject);
    const packs = await Promise.all(subjects.map(loadPack));
    let t = 1.0;
    // boss wave: the last group becomes one boss
    const bossWave = CONFIG.boss.every > 0 && state.wave % CONFIG.boss.every === 0;
    let bossPack = null;
    if (bossWave) {
      let subject = randomSubject();
      for (let tries = 0; tries < 40 && !CONFIG.boss.allowFlying && subject.enemyTags.includes("Flying"); tries++) subject = randomSubject();
      bossPack = await loadPack(subject);
      packs.pop();
    }
    packs.forEach((pack) => {
      const used = new Set();
      // Swarm: the group arrives as many tiny copies instead of a handful
      const swarm = pack.subject.enemyTags.includes("Swarm");
      const count = swarm ? size * CONFIG.enemyX.swarmFactor : size;
      for (let k = 0; k < count; k++) {
        const drawing = pickDrawing(pack, [], used.size >= pack.count ? null : used);   // different drawings of the same subject
        used.add(drawing);
        plan.push({ at: t, pack, drawing, first: k === 0, size: count, swarm });
        t += swarm ? W.spawnInterval / CONFIG.enemyX.swarmFactor : W.spawnInterval;
      }
      t += W.groupGap;
    });
    // Digger enemies are drawn as a pile of dirt while underground
    if (subjects.some((s) => s.enemyTags.includes("Digger")) && !state.digPack) {
      const dirt = db.byName.get(CONFIG.look.diggerSprite.subject);
      if (dirt) state.digPack = await loadPack(dirt);
    }
    if (bossPack) plan.push({ at: t + 1, pack: bossPack, drawing: pickDrawing(bossPack), first: true, size: 1, boss: true });
  } finally {
    state.loadingWave = false;
  }
  if (state.phase !== "build") return;
  for (const tower of state.towers) tower.locked = true;
  themesStartWave();
  refreshPaths();
  state.spawnQueue = plan.map((p) => ({ ...p, at: state.time + p.at + (CONFIG.style.enabled ? 1.2 : 0) }));
  state.phase = "wave";
  state.waveStart = { kills: state.kills, gold: state.gold, hearts: state.hearts };

  // rate the maze and pay the style bonus
  if (CONFIG.style.enabled) {
    const style = mazeStyle();
    state.lastStyle = style;
    state.gold += style.gold;
    const hot = style.tier >= CONFIG.style.tiers.length - 4;      // the top tiers get the loud treatment
    // The rating word is only announced the first time, and again if the layout earns a different
    // word. Every other wave it is just a plain "layout bonus" line, or nothing if there is no bonus.
    const announce = style.tier !== state.shownTier;
    state.shownTier = style.tier;
    if (announce) {
      bigText(style.word + "!", style.gold ? `layout bonus +${style.gold} gold` : "no layout bonus", hot ? "#f59e0b" : "#64748b", 2.6, "Your layout is...");
    } else if (style.gold) {
      bigText("LAYOUT BONUS", `+${style.gold} gold`, "#64748b", 1.4);
    }
    if (style.gold) burst(B.cols / 2 - 0.5, B.rows * 0.4, 8 + style.tier * 4, ["#facc15", "#f59e0b", "#ffffff"]);
    if (announce) sfx.style(style.tier, CONFIG.style.tiers.length); else sfx.wave();
  } else {
    sfx.wave();
  }
}

function enemyFromTags(pack, drawing, tags, hpScale, speedScale) {
  const has = (t) => tags.includes(t);
  const X = CONFIG.enemyX;
  let hp = E.baseHp * hpScale;
  let speed = E.baseSpeed * speedScale;
  let size = E.size;
  if (has("Fast")) speed *= E.fastSpeed;
  if (has("Slow")) speed *= E.slowSpeed;
  if (has("Tanky")) { hp *= E.tankyHp; size *= 1.2; }
  if (has("Frail")) { hp *= E.frailHp; size *= 0.85; }
  if (has("Flying")) { hp *= E.flyingHp; speed *= E.flyingSpeed; }
  if (has("Pinata")) { hp *= X.pinataHp; speed *= X.pinataSpeed; }
  if (has("Decoy")) hp *= X.decoyHp;
  if (has("Transport")) speed *= X.transportSpeed;
  if (has("Cocoon")) speed *= X.cocoonSpeed;
  const flying = has("Flying") || has("Glide");
  return {
    id: state.nextId++, pack, drawing, name: pack.subject.name, tags,
    kinds: tags.filter((t) => KINDS.includes(t)),
    maxHp: hp, hp, speed, baseSpeed: speed, size, baseSize: size,
    maxShield: has("Shielded") ? hp * E.shieldShare : 0, shield: has("Shielded") ? hp * E.shieldShare : 0,
    flying, armored: has("Armored") || has("Cocoon"), regen: has("Regen"), healer: has("Healer"), splitter: has("Splitter"),
    unstoppable: has("Unstoppable"), stealth: has("Stealth"), rich: has("Rich"), dodgy: has("Dodgy"),
    explosive: has("Explosive"),
    // special enemy tags (CONFIG.enemyX)
    dash: has("Dash"), jump: has("Jump"), scary: has("Scary"), digger: has("Digger"), glide: has("Glide"),
    rally: has("Rally"), transport: has("Transport"), thief: has("Thief"), jammer: has("Jammer"), decoy: has("Decoy"),
    enrage: has("Enrage"), undying: has("Undying"), cleanse: has("Cleanse"), spiky: has("Spiky"), growing: has("Growing"),
    summoner: has("Summoner"), eggLayer: has("Egg Layer"), cocoon: has("Cocoon"), blink: has("Blink"), pinata: has("Pinata"),
    path: flying ? state.flyPath : state.groundPath, d: 0, x: 0, y: 0,
    lastHit: -99, slowUntil: 0, slowFactor: 1, stunUntil: 0, curseUntil: 0, rootImmuneUntil: 0, kbImmuneUntil: 0,
    markUntil: 0, sleepUntil: 0, sleepImmuneUntil: 0, confuseUntil: 0, confuseImmuneUntil: 0, digUntil: 0,
    dashNext: X.dashEvery, dashUntil: 0, cleanseNext: X.cleanseEvery, summonNext: X.summonEvery, summoned: 0,
    eggNext: X.eggEvery, blinkReady: 0, hatched: false, revived: false, rallied: false, underground: false,
    burn: null, poison: null, bleed: null, shredded: false, spinHits: {},
    healTimer: E.healerEvery, flashUntil: 0, dotAcc: 0, dotTimer: 0, dotColor: "#fff",
    lastTower: null, lastHitAmount: 0, child: false, boss: false, dead: false,
  };
}

function spawnEnemy(entry) {
  const W = CONFIG.waves;
  const X = CONFIG.enemyX;
  const caption = entry.pack.captions[entry.drawing];
  let tags = enemyTagsFor(entry.pack.subject, caption);
  // Flying things skip the whole maze and few towers can reach them, so they are never also Tanky or Armored.
  if (tags.includes("Flying")) tags = tags.filter((t) => t !== "Tanky" && t !== "Armored");
  // Tanky enemies never heal each other (Healer): a group of them is too hard to wear down. Regen is fine.
  if (tags.includes("Tanky")) tags = tags.filter((t) => t !== "Healer");
  if (entry.boss) tags = tags.filter((t) => !["Frail", "Swarm", "Decoy", "Pinata", "Transport"].includes(t));
  const hpScale = Math.pow(W.hpGrowth, state.wave - 1) * (entry.boss ? CONFIG.boss.hp : 1);
  const speedScale = Math.min(W.maxSpeedGrowth, Math.pow(W.speedGrowth, state.wave - 1));
  const enemy = enemyFromTags(entry.pack, entry.drawing, tags, hpScale, speedScale);
  if (entry.boss) {
    enemy.boss = true;
    enemy.size *= CONFIG.boss.size;
    enemy.baseSize = enemy.size;
    enemy.tags = ["Boss", ...tags];
    sfx.boss();
  }
  if (entry.swarm) {                                  // one of many tiny swarm copies
    enemy.maxHp = enemy.hp *= X.swarmHp;
    enemy.maxShield = enemy.shield *= X.swarmHp;
    enemy.size *= X.swarmSize; enemy.baseSize = enemy.size;
  }
  if (enemy.digger) { enemy.digUntil = state.time + X.diggerTime; enemy.underground = true; enemy.digSprite = Math.floor(Math.random() * 1e6); }
  // walkers take the routes in turn, so a split route gets half the enemies each
  enemy.route = state.routeTurn++ % state.groundPaths.length;
  if (!enemy.flying) enemy.path = enemy.jump && state.jumpPath ? state.jumpPath : state.groundPaths[enemy.route];
  const p = pathPoint(enemy.path, 0);
  enemy.x = p.x; enemy.y = p.y;
  state.enemies.push(enemy);
  if (entry.first && CONFIG.look.groupBanner) {
    state.banner = { text: entry.boss ? `BOSS: ${enemy.name}` : `${entry.size} x ${enemy.name}`, tags, until: state.time + (entry.boss ? 5 : 3.5) };
  }
}

/** Make a smaller enemy of the same kind next to a parent (Summoner minions, eggs, Transport cargo). */
/** Poisoned right now? Poison also stops healing and regeneration (anti-heal). */
function isPoisoned(e, now) {
  return !!(e.poison && e.poison.until > now);
}

function spawnChild(parent, opts) {
  const tags = parent.tags.filter((t) => !["Boss", "Summoner", "Egg Layer", "Transport", "Splitter", "Tanky", "Swarm", "Cocoon", "Undying", "Pinata", "Rally"].includes(t));
  const child = enemyFromTags(parent.pack, parent.drawing, tags, 1, 1);
  child.maxHp = child.hp = parent.maxHp * opts.hp;
  child.maxShield = child.shield = 0;
  child.speed = child.baseSpeed = parent.baseSpeed * (opts.speed ?? 1);
  child.size = child.baseSize = parent.baseSize * (opts.size ?? 0.6);
  child.flying = parent.flying && !parent.glide;
  child.path = parent.path;
  child.d = Math.max(0, parent.d - (opts.behind ?? 0.3));
  child.child = true;
  child.bossOf = parent.boss ? parent : parent.bossOf;     // splits of a boss keep the BOSS DOWN message waiting
  const p = pathPoint(child.path, child.d);
  child.x = p.x; child.y = p.y;
  state.enemies.push(child);
  return child;
}

function endWave() {
  const broken = [];
  for (const tower of state.towers) {
    tower.wavesAlive++;
    tower.warm = 0; tower.warmTime = 0;                      // Warm-up starts cold every wave
    if (tower.stats.glass && tower.wavesAlive >= CONFIG.special.glassWaves) broken.push(tower);
    if (tower.stats.shape !== "Support") continue;
    if (tower.stats.gold) {
      state.gold += CONFIG.run.goldSupportPerWave;
      floatText(tower.x, tower.y - 0.3, `+${CONFIG.run.goldSupportPerWave}`, "#ca8a04");
    }
    // Heal towers in a Hospital theme do not heal on their own: the theme pays instead (no stacking)
    if (tower.stats.heal && !hasTheme(tower, "hospital") && tower.wavesAlive % CONFIG.run.healEveryWaves === 0 && state.hearts < CONFIG.run.hearts) {
      state.hearts++;
      floatText(tower.x, tower.y - 0.3, "+1 heart", "#e11d48");
    }
  }
  themesEndWave();
  for (const tower of broken) {                                // Glass Cannon: breaks after a few waves, no refund
    retire(tower);
    state.towers.splice(state.towers.indexOf(tower), 1);
    state.towerAt.delete(cellIndex(tower.x, tower.y));
    floatText(tower.x, tower.y - 0.2, "SHATTERED", "#94a3b8", 1);
    burst(tower.x, tower.y, 16, ["#e0f2fe", "#94a3b8", "#ffffff"]);
  }
  if (broken.length) { refreshAuras(); sfx.erase(); }
  state.shots.length = 0;
  // celebrate: big banner, confetti, jingle. A wave with no leaks gets the fancier jingle.
  const w = state.waveStart || { kills: state.kills, gold: state.gold, hearts: state.hearts };
  const flawless = state.hearts >= w.hearts;
  bigText(`WAVE ${state.wave} CLEAR`, `${state.kills - w.kills} kills   +${Math.max(0, state.gold - w.gold)} gold`, flawless ? "#22c55e" : "#3b82f6", 2.4);
  for (let k = 0; k < 5; k++) burst(1 + Math.random() * (B.cols - 2), 2 + Math.random() * (B.rows - 5), 14, ["#f43f5e", "#facc15", "#22c55e", "#38bdf8", "#a855f7"]);
  sfx.waveClear(flawless);
  state.wave++;
  state.phase = "build";
}

// ------------------------------------------------------------------------------------
// SIMULATION STEP
// ------------------------------------------------------------------------------------

/** Advance the game by dt seconds. Called several times per frame at 2x and 3x speed. */
export function step(dt) {
  if (state.phase !== "wave" && state.phase !== "build") return;
  state.time += dt;
  updateFx(dt);
  if (state.phase !== "wave") return;

  while (state.spawnQueue.length && state.spawnQueue[0].at <= state.time) spawnEnemy(state.spawnQueue.shift());
  updateAuras();
  updateThemes(dt);
  for (const enemy of state.enemies) updateEnemy(enemy, dt);
  for (const tower of state.towers) updateTower(tower, dt);
  updateShots(dt);
  updateMines();
  state.enemies = state.enemies.filter((e) => !e.dead);

  if (state.hearts <= 0) {
    state.phase = "over";
    sfx.gameOver();
  } else if (!state.spawnQueue.length && !state.enemies.length) {
    endWave();
  }
}

/** Enemy effects that reach out to others every frame: Scary and Jammer on towers, Rally on enemies. */
function updateAuras() {
  const X = CONFIG.enemyX;
  const scary = state.enemies.filter((e) => e.scary && !e.dead);
  const jammers = state.enemies.filter((e) => e.jammer && !e.dead);
  const rallies = state.enemies.filter((e) => e.rally && !e.dead);
  for (const t of state.towers) {
    t.scared = !hasTheme(t, "castle") && scary.some((e) => Math.hypot(e.x - t.x, e.y - t.y) <= X.scaryRange);
    t.jammed = jammers.some((e) => Math.hypot(e.x - t.x, e.y - t.y) <= X.jammerRange);
  }
  for (const e of state.enemies) e.rallied = rallies.some((r) => r !== e && Math.hypot(r.x - e.x, r.y - e.y) <= X.rallyRange);
}

function updateEnemy(e, dt) {
  const now = state.time;
  const X = CONFIG.enemyX;
  if (e.egg) { updateEgg(e); return; }
  // damage over time
  let dot = 0;
  for (const key of ["burn", "poison", "bleed"]) {
    const s = e[key];
    if (!s) continue;
    if (now >= s.until) { e[key] = null; continue; }
    dot += s.dps * (s.stacks || 1) * dt;
    e.dotColor = s.color;
  }
  if (dot > 0) {
    e.dotAcc += dot;
    hurt(e, dot, e.lastTower, { silent: true });
    if (e.dead) return;
  }
  e.dotTimer += dt;
  if (e.dotTimer >= 0.6) {
    if (e.dotAcc >= 1) floatText(e.x, e.y - 0.35, String(Math.round(e.dotAcc)), e.dotColor, 0.75);
    e.dotAcc = 0; e.dotTimer = 0;
  }
  // self repair
  // Poison is anti-heal: a poisoned enemy cannot regenerate or be healed by a Healer
  if (e.regen && e.hp < e.maxHp && !isPoisoned(e, now)) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * E.regenShare * dt);
  if (e.maxShield && e.shield < e.maxShield && now - e.lastHit > E.shieldDelay) {
    e.shield = Math.min(e.maxShield, e.shield + e.maxShield * E.shieldRegen * dt);
  }
  if (e.healer) {
    e.healTimer -= dt;
    if (e.healTimer <= 0) {
      e.healTimer = E.healerEvery;
      let healed = false;
      for (const o of state.enemies) {
        if (o === e || o.dead || o.healer || o.hp >= o.maxHp || isPoisoned(o, now)) continue;     // Healers never heal each other; poison blocks healing
        if (now < (o.healedUntil || 0)) continue;                            // no stacking: one heal per window
        if (Math.hypot(o.x - e.x, o.y - e.y) > E.healerRange) continue;
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * E.healerShare);
        o.healedUntil = now + E.healerEvery;
        healed = true;
      }
      if (healed) state.fx.push({ kind: "ring", x: e.x, y: e.y, r: E.healerRange, color: "#22c55e", life: 0.4, max: 0.4 });
    }
  }
  // special enemy behaviours
  e.underground = e.digger && now < e.digUntil;
  if (e.underground && Math.random() < dt * 12) state.fx.push({ kind: "dirt", x: e.x + (Math.random() - 0.5) * 0.3, y: e.y + 0.2, life: 0.7, max: 0.7 });
  if (e.growing && e.size < e.baseSize * X.growMaxSize) {
    const g = e.maxHp * X.growPerSec * dt;
    e.maxHp += g; e.hp += g;
    e.size = Math.min(e.baseSize * X.growMaxSize, e.size * (1 + X.growPerSec * dt * 0.5));
  }
  if (e.cleanse && now >= e.cleanseNext) {
    e.cleanseNext = now + X.cleanseEvery;
    const had = e.burn || e.poison || e.bleed || now < e.slowUntil || now < e.curseUntil || now < e.markUntil || now < e.sleepUntil || now < e.confuseUntil;
    e.burn = e.poison = e.bleed = null;
    e.slowUntil = e.curseUntil = e.markUntil = e.sleepUntil = e.confuseUntil = 0;
    if (!e.boss) e.stunUntil = Math.min(e.stunUntil, now);
    if (had) state.fx.push({ kind: "ring", x: e.x, y: e.y, r: 0.6, color: "#e0f2fe", life: 0.35, max: 0.35 });
  }
  if (e.summoner && now >= e.summonNext) {
    e.summonNext = now + X.summonEvery;
    if (e.summoned < X.summonMax) { e.summoned++; spawnChild(e, { hp: X.summonHp, size: 0.6 }); state.fx.push({ kind: "ring", x: e.x, y: e.y, r: 0.7, color: "#7c3aed", life: 0.35, max: 0.35 }); }
  }
  if (e.eggLayer && !e.flying && now >= e.eggNext) {
    e.eggNext = now + X.eggEvery;
    const egg = spawnChild(e, { hp: X.eggHp * 0.5, size: 0.45, behind: 0.05 });
    egg.egg = true; egg.hatchAt = now + X.eggHatch; egg.speed = 0;
  }
  if (e.cocoon && !e.hatched && e.d >= e.path.len / 2) {            // hatch into a fast flyer
    e.hatched = true; e.armored = false; e.flying = true;
    e.speed = e.baseSpeed / X.cocoonSpeed * X.cocoonHatchSpeed;
    e.path = makePath([{ x: e.x, y: e.y }, { x: B.home.x, y: B.home.y }]); e.d = 0;
    burst(e.x, e.y, 12, ["#facc15", "#a3e635", "#ffffff"]);
    floatText(e.x, e.y - 0.4, "HATCHED", "#65a30d", 0.8);
  }
  if (e.glide && e.flying && e.y >= B.rows / 2) landGlider(e);
  if (e.dash && now >= e.dashNext) { e.dashNext = now + X.dashEvery; e.dashUntil = now + X.dashTime; }
  // movement
  if (now < e.stunUntil || now < e.sleepUntil) return;
  let speed = e.speed * (now < e.slowUntil ? e.slowFactor : 1);
  if (now < e.dashUntil) speed *= X.dashSpeed;
  if (e.rallied) speed *= X.rallySpeed;
  if (e.enrage) speed *= 1 + X.enrageSpeed * (1 - Math.max(0, e.hp / e.maxHp));
  const dir = now < e.confuseUntil ? -1 : 1;                       // Confuse: walks backwards
  e.d = Math.max(0, e.d + speed * dt * dir);
  const p = pathPoint(e.path, e.d);
  e.x = p.x; e.y = p.y;
  e.onBlock = !e.flying && inBoard(Math.round(e.x), Math.round(e.y)) && !!state.blocks[cellIndex(Math.round(e.x), Math.round(e.y))];
  if (e.d >= e.path.len) {
    e.dead = true;
    const cost = e.boss ? CONFIG.boss.leakHearts : 1;
    state.hearts -= cost;
    floatText(B.home.x, B.home.y - 0.4, `-${cost}`, "#e11d48", 1.2);
    if (e.thief && state.gold > 0) {                                 // Thief: steals gold too
      const stolen = Math.min(state.gold, Math.round(X.thiefBase + X.thiefPerWave * (state.wave - 1)));
      state.gold -= stolen;
      floatText(B.home.x, B.home.y - 0.9, `-${stolen} gold`, "#ca8a04", 1);
    }
    sfx.leak();
  }
}

/** Eggs sit still, then hatch into a small copy of their parent unless destroyed first. */
function updateEgg(e) {
  if (state.time < e.hatchAt) return;
  e.egg = false;
  e.speed = e.baseSpeed;
  e.maxHp = e.hp = e.maxHp * 2;
  e.size = e.baseSize = e.baseSize * 1.2;
  burst(e.x, e.y, 8, ["#fef3c7", "#ffffff"]);
}

/** Glide: lands on the nearest square of its walking route, halfway down the board. */
function landGlider(e) {
  const path = state.groundPaths[e.route] || state.groundPath;
  let best = 0, bestD = Infinity;
  path.pts.forEach((pt, i) => {
    const d = Math.hypot(pt.x - e.x, pt.y - e.y);
    if (d < bestD && pt.y >= B.rows / 2 - 1) { bestD = d; best = i; }
  });
  e.flying = false;
  e.path = path; e.d = path.cum[best];
  const p = pathPoint(path, e.d);
  e.x = p.x; e.y = p.y;
  state.fx.push({ kind: "ring", x: e.x, y: e.y, r: 0.5, color: "#94a3b8", life: 0.3, max: 0.3 });
}

// Can this tower affect this enemy at all? (Flying needs Anti-Air or Sonic, Stealth needs to be close.)
function canAffect(tower, e, dist) {
  if (e.dead) return false;
  if (e.underground && !tower.stats.area) return false;           // Digger: only area attacks reach it
  if (e.flying && !tower.stats.antiAir && !tower.combo.antiAir && !hasTheme(tower, "space")) return false;
  if (!e.flying && tower.stats.airOnly) return false;              // Anti-Air: flyers only
  if (e.stealth && !tower.stats.holy && dist > E.stealthReveal) return false;
  return true;
}

function enemiesInRange(tower, range) {
  const list = [];
  const min = tower.stats.shape === "Artillery" ? T.shapes.Artillery.minRange : 0;
  for (const e of state.enemies) {
    if (e.egg && tower.stats.airOnly) continue;
    const dist = Math.hypot(e.x - tower.x, e.y - tower.y);
    if (dist <= range && dist >= min && e.y > -0.6 && canAffect(tower, e, dist)) list.push(e);
  }
  return list;
}

// Target the enemy closest to getting home.
const SUPPORT_ENEMY = (e) => e.healer || e.rally || e.summoner || e.jammer || e.scary || e.eggLayer;
const leftOf = (e) => e.path.len - e.d;

/**
 * Choose a target. Normally the enemy closest to getting home, but Decoys pull towers without a
 * targeting tag. Assassin: lowest health. Giant Slayer: highest health. Tactical: support enemies first.
 */
function pickTarget(tower) {
  let list = enemiesInRange(tower, towerRange(tower));
  if (!list.length) return null;
  const hpOf = (e) => e.hp + e.shield;
  const mode = tower.stats.targeting;
  if (mode === "assassin") return list.reduce((a, b) => (hpOf(b) < hpOf(a) ? b : a));
  if (mode === "giant") return list.reduce((a, b) => (hpOf(b) > hpOf(a) ? b : a));
  if (mode === "tactical") { const sup = list.filter(SUPPORT_ENEMY); if (sup.length) list = sup; }
  else { const decoys = list.filter((e) => e.decoy); if (decoys.length) list = decoys; }
  return list.reduce((a, b) => (leftOf(b) < leftOf(a) ? b : a));
}

function updateTower(tower, dt) {
  const s = tower.stats;
  const X = CONFIG.special;
  const now = state.time;
  tower.recoil = Math.max(0, tower.recoil - dt * 5);
  if (now < tower.stunUntil) { tower.beamTarget = null; tower.linkTargets = null; return; }
  const rate = auraOf(tower).rate * tower.combo.rate * (tower.scared ? CONFIG.enemyX.scaryRate : 1) * (1 + (tower.warm || 0));

  if (s.shape === "Support") {
    // Support + Slow is a slowing field. Everything else a Support does is an aura or end-of-wave effect.
    if (s.slow) for (const e of enemiesInRange(tower, towerRange(tower))) slowEnemy(e, T.supportSlow, 0.25);
    return;
  }

  // timers for the "every N seconds" specials
  if (s.timewarp) tower.warpT = Math.max(0, (tower.warpT ?? 0) - dt);
  if (s.tasty) tower.tastyT = Math.max(0, (tower.tastyT ?? 0) - dt);
  if (s.freezeFrame) {
    tower.freezeT = (tower.freezeT ?? X.freezeEvery) - dt;
    if (tower.freezeT <= 0) {
      const caught = enemiesInRange(tower, towerRange(tower));
      if (caught.length) {
        tower.freezeT = X.freezeEvery;
        for (const e of caught) stunEnemy(e, X.freezeTime);
        state.fx.push({ kind: "ring", x: tower.x, y: tower.y, r: towerRange(tower), color: "#ffffff", life: 0.4, max: 0.4 });
        sfx.freeze();
      } else tower.freezeT = 0;
    }
  }
  if (s.mineLayer) {
    tower.mineT = (tower.mineT ?? 0) - dt;
    if (tower.mineT <= 0) { tower.mineT = X.mineEvery; layMine(tower); }
  }
  // queued follow-up attacks (Burst shots, Echo repeats)
  if (tower.queue && tower.queue.length) {
    for (const q of tower.queue) {
      if (now < q.at) continue;
      q.done = true;
      const target = q.target && !q.target.dead && canAffect(tower, q.target, 0) ? q.target : pickTarget(tower);
      if (target) { attack(tower, target, q.mult, false); if (q.echo) state.fx.push({ kind: "ring", x: tower.x, y: tower.y, r: 0.55, color: s.color, life: 0.25, max: 0.25 }); }
    }
    tower.queue = tower.queue.filter((q) => !q.done);
  }

  if (s.shape === "Beam" || s.shape === "Link") {
    const target = pickTarget(tower);
    if (!target) { tower.beamTarget = null; tower.linkTargets = null; tower.beamRamp = 1; return; }
    if (target !== tower.beamTarget) { tower.beamTarget = target; tower.beamRamp = 1; }
    const sh = T.shapes.Beam;
    tower.beamRamp = s.shape === "Beam" ? Math.min(sh.rampMax, tower.beamRamp + sh.rampPerSec * dt) : 1;
    tower.beamAcc += dt * rate;
    if (s.shape === "Link") {
      const L = T.shapes.Link;
      tower.linkTargets = state.enemies
        .filter((e) => e !== target && canAffect(tower, e, 0) && Math.hypot(e.x - target.x, e.y - target.y) <= L.branchRange)
        .sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))
        .slice(0, L.branches);
    }
    if (tower.beamAcc >= 0.25) {
      tower.beamAcc -= 0.25;
      const tick = (s.dmg / s.cd) * 0.25 * tower.beamRamp;
      applyHit(tower, target, tick, { sure: true });
      if (tower.linkTargets) for (const b of tower.linkTargets) applyHit(tower, b, tick * T.shapes.Link.branchShare, { sure: true });
      sfx.shoot(s.elems[0]);
    }
    return;
  }

  if (s.shape === "Spin") { updateSpin(tower, dt, rate); return; }

  tower.cd -= dt * rate;
  if (tower.cd > 0) return;
  const target = pickTarget(tower);
  if (!target) { tower.cd = 0; return; }
  tower.cd = s.cd;
  tower.recoil = 1;
  sfx.shoot(s.elems[0]);
  if (s.warmup) {                                     // Warm-up: faster the longer it keeps firing this wave
    tower.warmTime = (tower.warmTime || 0) + s.cd / rate;
    tower.warm = Math.min(1, tower.warmTime / X.warmupTime) * X.warmupMax;
  }
  tower.attacks = (tower.attacks || 0) + 1;
  const big = s.monstrous && tower.attacks % X.monstrousEvery === 0;   // Monstrous: every 10th attack is huge
  attack(tower, target, big ? X.monstrousDamage : 1, big);
  if (s.burst) {
    tower.queue = tower.queue || [];
    for (let k = 1; k < X.burstShots; k++) tower.queue.push({ at: now + k * X.burstGap, target, mult: 1 });
  }
  if (s.echo) {
    tower.queue = tower.queue || [];
    tower.queue.push({ at: now + X.echoDelay, target, mult: X.echoDamage, echo: true });
  }
  if (hasTheme(tower, "concert")) {                     // Encore: two quieter repeats
    const n = THEMES.concert.n;
    tower.queue = tower.queue || [];
    for (let k = 1; k <= n.echoes; k++) tower.queue.push({ at: now + k * n.gap, target, mult: n.share, echo: true });
  }
  if (hasTheme(tower, "kitchen") && tower.attacks % THEMES.kitchen.n.every === 0) {   // Food fight: lob a pie
    const pool = enemiesInRange(tower, towerRange(tower));
    const victim = pool[Math.floor(Math.random() * pool.length)];
    if (victim) state.shots.push({ kind: "splash", pie: true, tower, dmg: s.dmg * THEMES.kitchen.n.dmg, x: tower.x, y: tower.y, target: victim, tx: victim.x, ty: victim.y, color: "#fde68a" });
  }
}

/** One attack of a tower's shape at a target. `mult` scales its damage; `big` makes a Monstrous shot. */
function attack(tower, target, mult, big) {
  const s = tower.stats;
  const dmg = s.dmg * mult;
  if (s.shape === "Pulse") {
    const range = towerRange(tower);
    for (const e of enemiesInRange(tower, range)) applyHit(tower, e, dmg, { sure: true });
    state.fx.push({ kind: "ring", x: tower.x, y: tower.y, r: range, color: s.color, life: 0.3, max: 0.3 });
  } else if (s.shape === "Chain") {
    const sh = T.shapes.Chain;
    const hit = [target];
    let from = { x: tower.x, y: tower.y }, cur = target, d = dmg;
    for (let j = 0; ; j++) {
      state.fx.push({ kind: "zap", x1: from.x, y1: from.y, x2: cur.x, y2: cur.y, color: s.color, life: 0.18, max: 0.18 });
      applyHit(tower, cur, d, { sure: j > 0 });
      if (j >= sh.jumps) break;
      let next = null, nd = sh.jumpRange;
      for (const e of state.enemies) {
        if (hit.includes(e)) continue;
        const dist = Math.hypot(e.x - cur.x, e.y - cur.y);
        if (dist <= nd && canAffect(tower, e, 0)) { nd = dist; next = e; }
      }
      if (!next) break;
      from = { x: cur.x, y: cur.y };
      cur = next; hit.push(next); d *= sh.falloff;
    }
  } else if (s.shape === "Pierce" || s.shape === "Spread") {
    const base = Math.atan2(target.y - tower.y, target.x - tower.x);
    const n = s.shape === "Spread" ? T.shapes.Spread.pellets : 1;
    for (let k = 0; k < n; k++) {
      const a = n === 1 ? base : base + (k / (n - 1) - 0.5) * T.shapes.Spread.cone * 2;
      state.shots.push({
        kind: s.shape === "Spread" ? "pellet" : "pierce", tower, dmg, big, x: tower.x, y: tower.y,
        vx: Math.cos(a) * T.pierceSpeed, vy: Math.sin(a) * T.pierceSpeed,
        left: towerRange(tower) + (s.shape === "Spread" ? 0.3 : 1), hit: new Set(), color: s.color,
      });
    }
  } else if (s.shape === "Boomerang") {
    state.shots.push({ kind: "boomerang", tower, dmg, big, x: tower.x, y: tower.y, tx: target.x, ty: target.y, back: false, hit: new Set(), color: s.color, spin: 0 });
  } else if (s.shape === "Artillery") {
    const A = T.shapes.Artillery;
    state.shots.push({ kind: "artillery", tower, dmg, big, sx: tower.x, sy: tower.y, x: tower.x, y: tower.y, tx: target.x, ty: target.y, t: 0, flight: A.flight, color: s.color });
  } else if (s.shape === "Sweep") {
    // the whole row or column through the tower, whichever holds the target (or more enemies)
    const row = state.enemies.filter((e) => Math.abs(e.y - tower.y) < 0.5 && canAffect(tower, e, 0));
    const col = state.enemies.filter((e) => Math.abs(e.x - tower.x) < 0.5 && canAffect(tower, e, 0));
    const useRow = row.includes(target) || (!col.includes(target) && row.length >= col.length);
    for (const e of useRow ? row : col) applyHit(tower, e, dmg, { sure: true });
    state.fx.push({ kind: "sweep", row: useRow, at: useRow ? tower.y : tower.x, color: s.color, life: 0.3, max: 0.3 });
  } else {
    state.shots.push({ kind: s.shape === "Splash" ? "splash" : s.shape === "Ricochet" ? "ricochet" : "single", tower, dmg, big, x: tower.x, y: tower.y, target, tx: target.x, ty: target.y, color: s.color, bounced: false });
  }
}

/** Spin: blades orbit the tower and hit whatever they touch (each enemy at most every half second). */
function updateSpin(tower, dt, rate) {
  const S = T.shapes.Spin;
  const now = state.time;
  tower.spinAngle = ((tower.spinAngle || 0) + dt * Math.PI * 2 * S.turnsPerSec * rate) % (Math.PI * 2);
  for (let b = 0; b < S.blades; b++) {
    const a = tower.spinAngle + (b / S.blades) * Math.PI * 2;
    const bx = tower.x + Math.cos(a) * S.radius, by = tower.y + Math.sin(a) * S.radius;
    for (const e of state.enemies) {
      if (!canAffect(tower, e, 0)) continue;
      if (Math.hypot(e.x - bx, e.y - by) > 0.3 + e.size * 0.3) continue;
      if (now < (e.spinHits[tower.id] ?? -9) + S.hitEvery) continue;
      e.spinHits[tower.id] = now;
      applyHit(tower, e, tower.stats.dmg, {});
      tower.recoil = 0.5;
    }
  }
}

/** Mine Layer: drop a mine on a random walking-route square in range (a few at most per tower). */
function layMine(tower) {
  const X = CONFIG.special;
  state.mines = state.mines || [];
  if (state.mines.filter((m) => m.tower === tower).length >= X.mineMax) return;
  const spots = [];
  for (const path of state.groundPaths) for (const pt of path.pts) {
    if (pt.y < 0 || Math.hypot(pt.x - tower.x, pt.y - tower.y) > towerRange(tower)) continue;
    if (!state.mines.some((m) => m.x === pt.x && m.y === pt.y)) spots.push(pt);
  }
  if (!spots.length) return;
  const pt = spots[Math.floor(Math.random() * spots.length)];
  state.mines.push({ x: pt.x, y: pt.y, tower });
}

function updateMines() {
  if (!state.mines || !state.mines.length) return;
  const X = CONFIG.special;
  for (const m of state.mines) {
    if (!state.towers.includes(m.tower)) { m.gone = true; continue; }
    const hit = state.enemies.find((e) => !e.dead && !e.flying && Math.hypot(e.x - m.x, e.y - m.y) <= X.mineTrigger);
    if (!hit) continue;
    m.gone = true;
    for (const e of state.enemies) {
      if (!e.dead && !e.flying && Math.hypot(e.x - m.x, e.y - m.y) <= X.mineRadius) applyHit(m.tower, e, m.tower.stats.dmg * X.mineDamage, { sure: true });
    }
    state.fx.push({ kind: "ring", x: m.x, y: m.y, r: X.mineRadius, color: "#f97316", life: 0.35, max: 0.35 });
    burst(m.x, m.y, 10, ["#f97316", "#facc15", "#1e293b"]);
    sfx.boom();
  }
  state.mines = state.mines.filter((m) => !m.gone);
}

function updateShots(dt) {
  for (const shot of state.shots) {
    const s = shot.tower.stats;
    if (shot.kind === "pierce" || shot.kind === "pellet") {
      const move = T.pierceSpeed * dt;
      shot.x += shot.vx * dt; shot.y += shot.vy * dt;
      shot.left -= move;
      for (const e of state.enemies) {
        if (shot.hit.has(e) || !canAffect(shot.tower, e, 0)) continue;
        if (Math.hypot(e.x - shot.x, e.y - shot.y) <= T.shapes.Pierce.width + e.size * 0.25) {
          shot.hit.add(e);
          applyHit(shot.tower, e, shot.dmg, {});
          if (shot.kind === "pellet") { shot.done = true; break; }     // a pellet stops at its first enemy
        }
      }
      if (shot.left <= 0) shot.done = true;
      continue;
    }
    if (shot.kind === "boomerang") {
      shot.spin += dt * 18;
      const gx = shot.back ? shot.tower.x : shot.tx, gy = shot.back ? shot.tower.y : shot.ty;
      const dx = gx - shot.x, dy = gy - shot.y, dist = Math.hypot(dx, dy), move = T.projectileSpeed * 0.8 * dt;
      if (dist > move) { shot.x += (dx / dist) * move; shot.y += (dy / dist) * move; }
      else if (!shot.back) { shot.back = true; shot.hit = new Set(); }            // turn round, can hit everything again
      else { shot.done = true; continue; }
      for (const e of state.enemies) {
        if (shot.hit.has(e) || !canAffect(shot.tower, e, 0)) continue;
        if (Math.hypot(e.x - shot.x, e.y - shot.y) <= 0.35 + e.size * 0.25) { shot.hit.add(e); applyHit(shot.tower, e, shot.dmg, {}); }
      }
      continue;
    }
    if (shot.kind === "artillery") {
      shot.t += dt;
      const k = Math.min(1, shot.t / shot.flight);
      shot.x = shot.sx + (shot.tx - shot.sx) * k; shot.y = shot.sy + (shot.ty - shot.sy) * k;
      shot.lift = Math.sin(k * Math.PI) * 1.2;                                 // drawn as an arc
      if (k < 1) continue;
      shot.done = true;
      const r = T.shapes.Artillery.radius;
      state.fx.push({ kind: "ring", x: shot.tx, y: shot.ty, r, color: shot.color, life: 0.3, max: 0.3 });
      for (const e of state.enemies) if (Math.hypot(e.x - shot.tx, e.y - shot.ty) <= r && canAffect(shot.tower, e, 0)) applyHit(shot.tower, e, shot.dmg, { sure: true });
      sfx.boom();
      continue;
    }
    // homing shots keep chasing a live target, or finish at its last position
    if (shot.target && !shot.target.dead) { shot.tx = shot.target.x; shot.ty = shot.target.y; }
    const dx = shot.tx - shot.x, dy = shot.ty - shot.y;
    const dist = Math.hypot(dx, dy);
    const move = T.projectileSpeed * dt;
    if (dist > move) { shot.x += (dx / dist) * move; shot.y += (dy / dist) * move; continue; }
    shot.done = true;
    if (shot.kind === "splash") {
      const r = T.shapes.Splash.radius * (shot.big ? 1.4 : 1);
      state.fx.push({ kind: "ring", x: shot.tx, y: shot.ty, r, color: shot.color, life: 0.25, max: 0.25 });
      for (const e of state.enemies) {
        if (Math.hypot(e.x - shot.tx, e.y - shot.ty) <= r && canAffect(shot.tower, e, 0)) applyHit(shot.tower, e, shot.dmg, { sure: e !== shot.target });
      }
    } else if (shot.target && !shot.target.dead) {
      const victim = shot.target;
      applyHit(shot.tower, victim, shot.dmg, {});
      const circus = hasTheme(shot.tower, "circus") && !shot.bounced && !shot.pie;
      if ((shot.kind === "ricochet" || circus) && !shot.bounced) {             // one bounce to the nearest other enemy
        const R = T.shapes.Ricochet;
        let next = null, nd = shot.kind === "ricochet" ? R.bounceRange : THEMES.circus.n.range;
        for (const e of state.enemies) {
          if (e === victim || e.dead || !canAffect(shot.tower, e, 0)) continue;
          const d = Math.hypot(e.x - victim.x, e.y - victim.y);
          if (d < nd) { nd = d; next = e; }
        }
        const share = shot.kind === "ricochet" ? R.bounceShare : THEMES.circus.n.share;
        if (next) state.shots.push({ kind: "ricochet", tower: shot.tower, dmg: shot.dmg * share, x: victim.x, y: victim.y, target: next, tx: next.x, ty: next.y, color: shot.color, bounced: true });
      }
    }
  }
  state.shots = state.shots.filter((s) => !s.done);
}

// ------------------------------------------------------------------------------------
// DAMAGE AND STATUS EFFECTS
// ------------------------------------------------------------------------------------

/**
 * One hit from a tower on an enemy: dodge, crit, element resistances, armour, then status effects.
 * opts.sure = true means the hit cannot be dodged (pulses, beams, splash edges, chain hops).
 */
function applyHit(tower, e, dmg, opts) {
  if (e.dead) return;
  const s = tower.stats;
  const X = CONFIG.special;
  const now = state.time;
  if (e.dodgy && !opts.sure && Math.random() < E.dodgeChance) {
    floatText(e.x, e.y - 0.4, "miss", "#94a3b8", 0.7);
    return;
  }
  let total = dmg * auraOf(tower).dmg * tower.combo.dmg * (1 + (tower.trophy || 0)) * (1 + (hasTheme(tower, "school") ? tower.study || 0 : 0));
  if (hasTheme(tower, "wildwest")) {                     // Quick draw: first shot at each enemy
    e.drawnBy = e.drawnBy || new Set();
    if (!e.drawnBy.has(tower.id)) { e.drawnBy.add(tower.id); total *= THEMES.wildwest.n.dmg; floatText(e.x, e.y - 0.6, "DRAW!", THEMES.wildwest.color, 0.7); }
  }
  if (e.flying) total *= tower.combo.flyerDamage;          // Birds combo, stronger version
  if (e.flying && s.airOnly) total *= X.antiAirDamage;     // Anti-Air
  if (s.shatter && (now < e.slowUntil || now < e.stunUntil || now < e.sleepUntil)) total *= X.shatterDamage;
  if (s.targeting === "giant") total += Math.min(e.maxHp * X.giantShare, s.dmg * X.giantCap);   // Giant Slayer
  let crit = false;
  const critChance = (s.crit ? T.critChance : 0) + tower.combo.crit + (s.lucky ? X.luckyCrit : 0);
  if (critChance > 0 && Math.random() < critChance) { total *= T.critMultiplier; crit = true; }
  let dealt = 0;
  for (const el of s.elems) {
    let part = total / s.elems.length;
    for (const kind of e.kinds) part *= CONFIG.resist[kind][el] ?? 1;
    if (el === "Physical" && e.armored && !e.shredded && !tower.combo.pierceArmor) part *= E.armoredPhysical;
    dealt += part;
  }
  if (now < e.curseUntil) dealt *= e.curseMult || CONFIG.elements.Dark.curse;
  if (now < e.markUntil) dealt *= X.tastyDamage;            // Tasty mark
  e.lastTower = tower;
  hurt(e, dealt, tower, { color: s.color, crit, ignoreShield: s.holy });
  if (e.dead) return;
  if (s.execute && !e.egg && e.hp <= e.maxHp * X.executeShare) {      // Execute: finish off the nearly dead
    floatText(e.x, e.y - 0.5, "EXECUTE", "#dc2626", 0.9);
    hurt(e, e.hp + e.shield + 1, tower, { silent: true, ignoreShield: true });
    return;
  }
  applyStatuses(tower, e, dealt);
  if (hasTheme(tower, "space") && Math.random() < THEMES.space.n.chance) stunEnemy(e, THEMES.space.n.time);   // Zero gravity
  if (hasTheme(tower, "laboratory")) mutate(tower, e, dealt);
  // Spiky: a Melee tower that hits it is stunned for a moment
  if (e.spiky && s.rangeTag === "Melee" && !hasTheme(tower, "castle")) {
    tower.stunUntil = Math.max(tower.stunUntil, now + CONFIG.enemyX.spikyStun);
    tower.spiked = now + CONFIG.enemyX.spikyStun;
  }
  // Blink: a big hit makes it teleport forward
  if (e.blink && now >= e.blinkReady && dealt >= e.maxHp * CONFIG.enemyX.blinkHit) {
    e.blinkReady = now + CONFIG.enemyX.blinkCooldown;
    state.fx.push({ kind: "ring", x: e.x, y: e.y, r: 0.45, color: "#c084fc", life: 0.3, max: 0.3 });
    e.d = Math.min(e.path.len - 0.2, e.d + CONFIG.enemyX.blinkCells);
    const p = pathPoint(e.path, e.d); e.x = p.x; e.y = p.y;
    state.fx.push({ kind: "ring", x: e.x, y: e.y, r: 0.45, color: "#c084fc", life: 0.3, max: 0.3 });
  }
}

function hurt(e, amount, tower, opts) {
  if (e.dead || amount <= 0) return;
  e.lastHit = state.time;
  e.lastHitAmount = amount;
  let left = amount;
  let dealt = 0;                                            // real damage done, for the tower's scoreboard total
  if (e.shield > 0 && !opts.ignoreShield) {
    const soak = Math.min(e.shield, left);
    e.shield -= soak; left -= soak; dealt += soak;
  }
  dealt += Math.min(left, Math.max(0, e.hp));
  e.hp -= left;
  if (tower && tower.damage !== undefined) tower.damage += dealt;
  if (!opts.silent) {
    e.sleepUntil = 0;                                         // any real hit wakes a sleeper
    e.flashUntil = state.time + 0.08;
    if (CONFIG.look.damageNumbers && amount >= 0.5) {
      floatText(e.x + (Math.random() - 0.5) * 0.3, e.y - 0.35, (opts.crit ? "!" : "") + Math.round(amount), opts.color, opts.crit ? 1.25 : 0.9);
    }
    sfx.hit();
  }
  if (e.hp <= 0) {
    if (e.undying && !e.revived) {                            // Undying: gets back up once
      e.revived = true;
      e.hp = e.maxHp * CONFIG.enemyX.undyingHp;
      e.burn = e.poison = e.bleed = null;
      floatText(e.x, e.y - 0.5, "UNDYING", "#a855f7", 0.9);
      burst(e.x, e.y, 10, ["#a855f7", "#e9d5ff"]);
      return;
    }
    killEnemy(e, tower);
  }
}

function applyStatuses(tower, e, dealt) {
  const s = tower.stats;
  const C = CONFIG.elements;
  const X = CONFIG.special;
  const now = state.time;
  const m = tower.combo.status;                   // Weather combo: effects last longer
  const lentAura = auraOf(tower).imbue;
  const lent = lentAura.concat(tower.combo.imbue.filter((el) => !lentAura.includes(el)));
  for (const el of s.elems.concat(lent.filter((el) => !s.elems.includes(el)))) {
    if (el === "Fire" && !e.kinds.includes("Fire")) {
      const dps = (dealt * C.Fire.burnShare) / C.Fire.burnTime;
      if (!e.burn || dps >= e.burn.dps) e.burn = { dps, until: now + C.Fire.burnTime * m, color: ELEMENT_COLORS.Fire };
    } else if (el === "Ice" && !e.kinds.includes("Ice")) {
      slowEnemy(e, C.Ice.slow, C.Ice.time * m);
    } else if (el === "Poison" && !e.kinds.includes("Poison") && !e.kinds.includes("Machine")) {
      const dps = (dealt * C.Poison.share * tower.combo.poisonPower) / C.Poison.time;
      const stacks = Math.min(C.Poison.maxStacks, (e.poison ? e.poison.stacks : 0) + 1);
      e.poison = { dps: Math.max(dps, e.poison ? e.poison.dps : 0), stacks, until: now + C.Poison.time * m, color: ELEMENT_COLORS.Poison };
    } else if (el === "Lightning") {
      if (Math.random() < C.Lightning.stunChance) stunEnemy(e, C.Lightning.stunTime * m);
    } else if (el === "Dark") {
      // a stronger curse (Monsters combo) is kept while it lasts; a weaker one does not replace it
      const mult = C.Dark.curse + tower.combo.curseBonus;
      e.curseMult = now < e.curseUntil ? Math.max(e.curseMult || C.Dark.curse, mult) : mult;
      e.curseUntil = now + C.Dark.time * m;
    } else if (el === "Water") {
      pushEnemy(e, C.Water.knockback * tower.combo.waterPush);
    } else if (el === "Nature" && now > e.rootImmuneUntil && !e.unstoppable) {
      stunEnemy(e, C.Nature.root * m * tower.combo.rootTime);
      e.rootImmuneUntil = now + C.Nature.cooldown;
    }
  }
  if (s.stun && Math.random() < T.stunChance) stunEnemy(e, T.stunTime * m);
  if (s.slow || tower.combo.slow) slowEnemy(e, T.slowFactor * tower.combo.slowFactor, T.slowTime * m);
  if (s.bleed) {
    const dps = (dealt * T.bleedShare) / T.bleedTime;
    if (!e.bleed || dps >= e.bleed.dps) e.bleed = { dps, until: now + T.bleedTime * m, color: "#dc2626" };
  }
  if (s.knockback || tower.combo.knockback) pushEnemy(e, T.knockback * tower.combo.knockback2);
  if (tower.combo.stunChance && Math.random() < tower.combo.stunChance) stunEnemy(e, T.stunTime * m);          // Rocks combo
  if (tower.combo.confuseChance && !e.unstoppable && !e.flying && now >= e.confuseImmuneUntil && Math.random() < tower.combo.confuseChance) {   // Toys combo
    e.confuseUntil = now + X.confuseTime; e.confuseImmuneUntil = now + X.confuseTime + X.confuseImmune;
  }
  if (tower.combo.pull) pullEnemy(e, tower, tower.combo.pull);                                           // Cosmos combo
  if (tower.combo.markChance && Math.random() < tower.combo.markChance) e.markUntil = Math.max(e.markUntil, now + X.tastyTime);   // Signs combo
  if (s.shred) e.shredded = true;
  // special tags
  if (s.timewarp && !tower.warpT) { tower.warpT = X.timewarpEvery; timewarp(e); }
  if (s.tasty && !tower.tastyT) { tower.tastyT = X.tastyEvery; e.markUntil = now + X.tastyTime * m; }
  if (s.magnet) pullEnemy(e, tower, X.magnetCells);
  if (s.sleep && !e.unstoppable && now >= e.sleepImmuneUntil && Math.random() < X.sleepChance) {
    const t = X.sleepTime * m * (e.boss ? CONFIG.boss.control : 1);
    e.sleepUntil = now + t; e.sleepImmuneUntil = now + t + X.sleepImmune;
  }
  if (s.confuse && !e.unstoppable && !e.flying && now >= e.confuseImmuneUntil && Math.random() < X.confuseChance) {
    const t = X.confuseTime * m * (e.boss ? CONFIG.boss.control : 1);
    e.confuseUntil = now + t; e.confuseImmuneUntil = now + t + X.confuseImmune;
  }
}

/** Laboratory theme: a random extra effect on every hit. */
function mutate(tower, e, dealt) {
  const C = CONFIG.elements, now = state.time;
  const pick = Math.floor(Math.random() * 5);
  if (pick === 0) { const dps = (dealt * C.Fire.burnShare) / C.Fire.burnTime; if (!e.burn || dps >= e.burn.dps) e.burn = { dps, until: now + C.Fire.burnTime, color: ELEMENT_COLORS.Fire }; }
  else if (pick === 1) { const dps = (dealt * C.Poison.share) / C.Poison.time; e.poison = { dps: Math.max(dps, e.poison ? e.poison.dps : 0), stacks: Math.min(C.Poison.maxStacks, (e.poison ? e.poison.stacks : 0) + 1), until: now + C.Poison.time, color: ELEMENT_COLORS.Poison }; }
  else if (pick === 2) slowEnemy(e, C.Ice.slow, C.Ice.time);
  else if (pick === 3) { e.curseMult = Math.max(e.curseMult || 0, C.Dark.curse); e.curseUntil = now + C.Dark.time; }
  else stunEnemy(e, 0.4);
}

/** Timewarp: the enemy is sent back down the path in a flash. */
function timewarp(e) {
  if (e.unstoppable) return;
  const cells = CONFIG.special.timewarpCells * (e.boss ? CONFIG.boss.control : 1);
  state.fx.push({ kind: "ring", x: e.x, y: e.y, r: 0.5, color: "#a855f7", life: 0.4, max: 0.4 });
  e.d = Math.max(0, e.d - cells);
  const p = pathPoint(e.path, e.d); e.x = p.x; e.y = p.y;
  state.fx.push({ kind: "ring", x: e.x, y: e.y, r: 0.5, color: "#a855f7", life: 0.4, max: 0.4 });
  floatText(e.x, e.y - 0.5, "WARP", "#a855f7", 0.8);
}

/** Magnet: drags the enemy along its path towards the tower (it can pull them forwards or back). */
function pullEnemy(e, tower, cells) {
  if (e.unstoppable || state.time < e.kbImmuneUntil) return;
  if (e.boss) cells *= CONFIG.boss.control;
  const ahead = pathPoint(e.path, Math.min(e.path.len - 0.05, e.d + cells));
  const back = pathPoint(e.path, Math.max(0, e.d - cells));
  const forwards = Math.hypot(ahead.x - tower.x, ahead.y - tower.y) < Math.hypot(back.x - tower.x, back.y - tower.y);
  const fromX = e.x, fromY = e.y;
  e.d = Math.min(e.path.len - 0.05, Math.max(0, e.d + (forwards ? cells : -cells)));
  const p = pathPoint(e.path, e.d); e.x = p.x; e.y = p.y;
  e.kbImmuneUntil = state.time + T.knockbackCooldown;
  const len = Math.hypot(e.x - fromX, e.y - fromY);
  if (len > 0.01) state.fx.push({ kind: "chev", x: e.x, y: e.y, dx: (e.x - fromX) / len, dy: (e.y - fromY) / len, color: "#f472b6", life: 0.45, max: 0.45 });
}

function slowEnemy(e, factor, seconds) {
  if (e.unstoppable) return;
  if (e.boss) seconds *= CONFIG.boss.control;
  const now = state.time;
  // A stronger slow replaces a weaker one. A weaker one only lands once the current slow has worn off.
  if (now >= e.slowUntil || factor <= e.slowFactor) {
    e.slowFactor = factor;
    e.slowUntil = now + seconds;
  }
}

function stunEnemy(e, seconds) {
  if (e.unstoppable) return;
  if (e.boss) seconds *= CONFIG.boss.control;
  e.stunUntil = Math.max(e.stunUntil, state.time + seconds);
}

/**
 * Knockback shoves an enemy back down its route, the way it came, wherever the tower stands.
 * A chevron marks each shove, pointing the way the enemy was pushed.
 */
function pushEnemy(e, cells) {
  if (e.unstoppable || state.time < e.kbImmuneUntil) return;
  if (e.boss) cells *= CONFIG.boss.control;
  const fromX = e.x, fromY = e.y;
  e.d = Math.max(0, e.d - cells);
  const p = pathPoint(e.path, e.d);
  e.x = p.x; e.y = p.y;
  e.kbImmuneUntil = state.time + T.knockbackCooldown;
  const len = Math.hypot(e.x - fromX, e.y - fromY);
  if (len > 0.01) {
    state.fx.push({ kind: "chev", x: e.x, y: e.y, dx: (e.x - fromX) / len, dy: (e.y - fromY) / len, color: "#38bdf8", life: 0.45, max: 0.45 });
  }
}

function killEnemy(e, tower) {
  e.dead = true;
  const R = CONFIG.run;
  const X = CONFIG.special;
  let gold = R.killGold + R.killGoldPerWave * (state.wave - 1);
  if (e.rich) gold *= R.richMultiplier;
  if (e.pinata) gold *= CONFIG.enemyX.pinataGold;
  if (tower && tower.stats.gold) gold *= R.goldTagKillMultiplier;
  if (tower) gold *= tower.combo.gold;                 // Treasure and Townsfolk combos
  let lucky = false;
  if (tower && tower.stats.lucky && Math.random() < X.luckyGoldChance) { gold *= X.luckyGold; lucky = true; }
  let plunder = false;
  if (tower && hasTheme(tower, "pirate") && Math.random() < THEMES.pirate.n.chance) { gold *= THEMES.pirate.n.gold; plunder = true; }
  if (tower && hasTheme(tower, "farm")) tower.farmKills = (tower.farmKills || 0) + 1;
  if (tower && hasTheme(tower, "graveyard")) {
    state.haunts = state.haunts || [];
    state.haunts.push({ x: e.x, y: e.y, r: THEMES.graveyard.n.radius, until: state.time + THEMES.graveyard.n.time });
  }
  if (e.child) gold /= 3;
  if (e.boss) gold *= CONFIG.boss.gold;
  gold = Math.max(1, Math.round(gold));
  state.gold += gold;
  state.kills++;
  state.score += Math.round(e.maxHp / 10) + state.wave;
  if (tower) {
    tower.kills++;
    if (tower.stats.trophy) tower.trophy = Math.min(X.trophyMax, (tower.trophy || 0) + X.trophyPerKill);
  }
  floatText(e.x, e.y - 0.1, `+${gold}`, "#ca8a04", 0.85);
  if (lucky) floatText(e.x, e.y - 0.55, "LUCKY", "#22c55e", 0.85);
  if (plunder) floatText(e.x, e.y - 0.75, "PLUNDER!", THEMES.pirate.color, 0.85);
  state.fx.push({ kind: "pop", x: e.x, y: e.y, r: e.size * 0.6, color: "#3b4252", life: 0.25, max: 0.25 });
  const shiny = e.rich || e.boss || e.pinata || lucky || plunder;
  burst(e.x, e.y, e.boss ? 60 : e.pinata ? 30 : shiny ? 12 : 5, e.pinata ? ["#f43f5e", "#facc15", "#22c55e", "#38bdf8", "#a855f7"] : shiny ? ["#facc15", "#fde68a", "#f43f5e"] : ["#facc15", "#ffffff", "#94a3b8"]);
  const bossFamily = e.boss ? e : e.bossOf;           // the boss, or the boss a split / unloaded copy came from
  if (bossFamily) bossFamily.familyGold = (bossFamily.familyGold || 0) + gold;
  sfx.kill();
  if (shiny) sfx.coin();

  if (e.splitter) {
    for (let k = 0; k < E.splitCount; k++) spawnChild(e, { hp: E.splitHp, speed: 1.15, size: E.splitSize, behind: 0.35 * k });
  }
  if (e.transport) {                                  // Transport: unloads slower copies of itself
    const XE = CONFIG.enemyX;
    for (let k = 0; k < XE.transportSplit; k++) spawnChild(e, { hp: XE.transportChildHp, speed: XE.transportChildSpeed / XE.transportSpeed, size: 0.7, behind: 0.3 * k });
  }
  if (tower && tower.stats.explode && e.lastHitAmount > 0) {      // Explode: the victim bursts
    const dmg = e.lastHitAmount * X.explodeShare;
    state.fx.push({ kind: "ring", x: e.x, y: e.y, r: X.explodeRadius, color: "#f97316", life: 0.35, max: 0.35 });
    for (const o of state.enemies) {
      if (o === e || o.dead) continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) <= X.explodeRadius && canAffect(tower, o, 0)) hurt(o, dmg, tower, { color: "#f97316" });
    }
    sfx.boom();
  }
  if (e.explosive) {
    state.fx.push({ kind: "ring", x: e.x, y: e.y, r: E.explodeRange, color: "#f97316", life: 0.4, max: 0.4 });
    for (const t of state.towers) {
      if (Math.hypot(t.x - e.x, t.y - e.y) <= E.explodeRange && !t.combo.blastProof && !hasTheme(t, "castle")) t.stunUntil = state.time + E.explodeStun;
    }
    sfx.boom();
  }
  // BOSS DOWN only once the boss AND every split or copy that came out of it are dead
  if (bossFamily && !bossFamily.downShown && !state.enemies.some((o) => o !== e && !o.dead && (o === bossFamily || o.bossOf === bossFamily))) {
    bossFamily.downShown = true;               // an Explode chain can finish the family twice over
    bigText("BOSS DOWN", `+${bossFamily.familyGold} gold`, "#f43f5e", 1.8);
    sfx.bossDown();
  }
}

// ------------------------------------------------------------------------------------
// VISUAL EVENTS (drawn by render.js)
// ------------------------------------------------------------------------------------

export function floatText(x, y, text, color, scale = 1) {
  state.fx.push({ kind: "text", x, y, text, color, scale, life: 0.8, max: 0.8 });
}

/** A large announcement across the middle of the board (maze rating, wave clear). */
export function bigText(text, sub, color, seconds, pre = "") {   // pre: small lead-in line above the big text
  state.fx = state.fx.filter((f) => f.kind !== "big");      // only one at a time
  state.fx.push({ kind: "big", text, sub, pre, color, life: seconds, max: seconds });
}

/** A puff of little square sparks that fly out and fall, for kills and celebrations. */
export function burst(x, y, count, colors) {
  for (let k = 0; k < count; k++) {
    const angle = Math.random() * Math.PI * 2, speed = 1.5 + Math.random() * 3.5;
    const life = 0.45 + Math.random() * 0.45;
    state.fx.push({
      kind: "spark", x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 2,
      color: colors[k % colors.length], size: 0.07 + Math.random() * 0.07, life, max: life,
    });
  }
}

function updateFx(dt) {
  for (const f of state.fx) {
    f.life -= dt;
    if (f.kind === "text") f.y -= dt * 0.7;
    else if (f.kind === "spark") { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 9 * dt; }
  }
  if (state.fx.length) state.fx = state.fx.filter((f) => f.life > 0);
}
