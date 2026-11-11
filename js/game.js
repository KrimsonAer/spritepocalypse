// =====================================================================================
// GAME - all rules and simulation. No drawing and no DOM in here.
//   state      the whole run (grid, towers, enemies, gold, hearts, wave)
//   build      blocks, towers, selling, moving
//   waves      picking random subjects, spawning groups
//   combat     targeting, the seven attack shapes, damage, status effects
// Numbers come from config.js. Tags are explained in GDD.md.
// =====================================================================================

import { CONFIG, ELEMENT_COLORS } from "./config.js";
import { loadPack, randomSubject, enemyTagsFor } from "./data.js";
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
    towers: [], enemies: [], shots: [], fx: [], spawnQueue: [], banner: null,
  });
  state.shownTier = -1;      // which layout rating word was last announced (-1 = none yet)
  state.blocks.fill(0);
  state.towerAt.clear();
  refreshPaths();
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
    caption: candidate.caption, tags: candidate.tags,
    stats: towerStats(candidate.tags),
    cd: 0.3, paid: price, usedFree,
    locked: state.phase === "wave",   // towers placed mid-wave are locked at once
    target: null, beamRamp: 1, beamAcc: 0, beamTarget: null,
    stunUntil: 0, recoil: 0, wavesAlive: 0, kills: 0,
    aura: { dmg: 1, rate: 1, range: 0, imbue: [] },
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

/** Remove a tower. Unlocked towers come back in full (free slot or gold), locked ones at the sell rate. */
export function removeTower(tower) {
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
  const sh = T.shapes[shape], rg = T.ranges[rangeTag];
  let dmg = T.baseDamage * sh.dmg * rg.dmg;
  let cd = T.baseCooldown * sh.cd;
  if (has("Rapid")) { cd *= T.rapid.cd; dmg *= T.rapid.dmg; }
  if (has("Heavy")) { cd *= T.heavy.cd; dmg *= T.heavy.dmg; }
  if (has("Weak")) dmg *= T.weakDamage;
  if (elems.includes("Physical")) dmg *= 1 + (T.physicalBonus - 1) / elems.length;
  return {
    shape, elems, rangeTag, range: rg.cells, dmg, cd,
    antiAir: has("Anti-Air") || elems.includes("Sonic"),
    holy: elems.includes("Holy"),
    crit: has("Crit"), stun: has("Stun"), slow: has("Slow"), bleed: has("Bleed"),
    knockback: has("Knockback"), shred: has("Shred"), gold: has("Gold"),
    buff: has("Buff"), haste: has("Haste"), reach: has("Reach"), heal: has("Heal"),
    color: ELEMENT_COLORS[elems[0]] || "#6b7280",
  };
}

/** Support towers boost the 8 blocks around them. Recomputed whenever towers change. */
export function refreshAuras() {
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

/** Reach of a tower in cells, including Reach auras. */
export const towerRange = (tower) => tower.stats.range + tower.aura.range;

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
      for (let k = 0; k < size; k++) {
        const drawing = pickDrawing(pack, [], used);   // 5 different drawings of the same subject
        used.add(drawing);
        plan.push({ at: t, pack, drawing, first: k === 0, size });
        t += W.spawnInterval;
      }
      t += W.groupGap;
    });
    if (bossPack) plan.push({ at: t + 1, pack: bossPack, drawing: pickDrawing(bossPack), first: true, size: 1, boss: true });
  } finally {
    state.loadingWave = false;
  }
  if (state.phase !== "build") return;
  for (const tower of state.towers) tower.locked = true;
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
  let hp = E.baseHp * hpScale;
  let speed = E.baseSpeed * speedScale;
  let size = E.size;
  if (has("Fast")) speed *= E.fastSpeed;
  if (has("Slow")) speed *= E.slowSpeed;
  if (has("Tanky")) { hp *= E.tankyHp; size *= 1.2; }
  if (has("Frail")) { hp *= E.frailHp; size *= 0.85; }
  if (has("Flying")) { hp *= E.flyingHp; speed *= E.flyingSpeed; }
  const flying = has("Flying");
  return {
    id: state.nextId++, pack, drawing, name: pack.subject.name, tags,
    kinds: tags.filter((t) => KINDS.includes(t)),
    maxHp: hp, hp, speed, size,
    maxShield: has("Shielded") ? hp * E.shieldShare : 0, shield: has("Shielded") ? hp * E.shieldShare : 0,
    flying, armored: has("Armored"), regen: has("Regen"), healer: has("Healer"), splitter: has("Splitter"),
    unstoppable: has("Unstoppable"), stealth: has("Stealth"), rich: has("Rich"), dodgy: has("Dodgy"),
    explosive: has("Explosive"),
    path: flying ? state.flyPath : state.groundPath, d: 0, x: 0, y: 0,
    lastHit: -99, slowUntil: 0, slowFactor: 1, stunUntil: 0, curseUntil: 0, rootImmuneUntil: 0, kbImmuneUntil: 0,
    burn: null, poison: null, bleed: null, shredded: false,
    healTimer: E.healerEvery, flashUntil: 0, dotAcc: 0, dotTimer: 0, dotColor: "#fff",
    lastTower: null, child: false, boss: false, dead: false,
  };
}

function spawnEnemy(entry) {
  const W = CONFIG.waves;
  const caption = entry.pack.captions[entry.drawing];
  let tags = enemyTagsFor(entry.pack.subject, caption);
  // Flying things skip the whole maze and few towers can reach them, so they are never also Tanky or Armored.
  if (tags.includes("Flying")) tags = tags.filter((t) => t !== "Tanky" && t !== "Armored");
  // Tanky enemies never heal each other (Healer): a group of them is too hard to wear down. Regen is fine.
  if (tags.includes("Tanky")) tags = tags.filter((t) => t !== "Healer");
  if (entry.boss) tags = tags.filter((t) => t !== "Frail");
  const hpScale = Math.pow(W.hpGrowth, state.wave - 1) * (entry.boss ? CONFIG.boss.hp : 1);
  const speedScale = Math.min(W.maxSpeedGrowth, Math.pow(W.speedGrowth, state.wave - 1));
  const enemy = enemyFromTags(entry.pack, entry.drawing, tags, hpScale, speedScale);
  if (entry.boss) {
    enemy.boss = true;
    enemy.size *= CONFIG.boss.size;
    enemy.tags = ["Boss", ...tags];
    sfx.boss();
  }
  // walkers take the routes in turn, so a split route gets half the enemies each
  if (!enemy.flying) enemy.path = state.groundPaths[state.routeTurn++ % state.groundPaths.length];
  const p = pathPoint(enemy.path, 0);
  enemy.x = p.x; enemy.y = p.y;
  state.enemies.push(enemy);
  if (entry.first && CONFIG.look.groupBanner) {
    state.banner = { text: entry.boss ? `BOSS: ${enemy.name}` : `${entry.size} x ${enemy.name}`, tags, until: state.time + (entry.boss ? 5 : 3.5) };
  }
}

function endWave() {
  for (const tower of state.towers) {
    tower.wavesAlive++;
    if (tower.stats.shape !== "Support") continue;
    if (tower.stats.gold) {
      state.gold += CONFIG.run.goldSupportPerWave;
      floatText(tower.x, tower.y - 0.3, `+${CONFIG.run.goldSupportPerWave}`, "#ca8a04");
    }
    if (tower.stats.heal && tower.wavesAlive % CONFIG.run.healEveryWaves === 0 && state.hearts < CONFIG.run.hearts) {
      state.hearts++;
      floatText(tower.x, tower.y - 0.3, "+1 heart", "#e11d48");
    }
  }
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
  for (const enemy of state.enemies) updateEnemy(enemy, dt);
  for (const tower of state.towers) updateTower(tower, dt);
  updateShots(dt);
  state.enemies = state.enemies.filter((e) => !e.dead);

  if (state.hearts <= 0) {
    state.phase = "over";
    sfx.gameOver();
  } else if (!state.spawnQueue.length && !state.enemies.length) {
    endWave();
  }
}

function updateEnemy(e, dt) {
  const now = state.time;
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
  if (e.regen && e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * E.regenShare * dt);
  if (e.maxShield && e.shield < e.maxShield && now - e.lastHit > E.shieldDelay) {
    e.shield = Math.min(e.maxShield, e.shield + e.maxShield * E.shieldRegen * dt);
  }
  if (e.healer) {
    e.healTimer -= dt;
    if (e.healTimer <= 0) {
      e.healTimer = E.healerEvery;
      let healed = false;
      for (const o of state.enemies) {
        if (o === e || o.dead || o.hp >= o.maxHp) continue;
        if (Math.hypot(o.x - e.x, o.y - e.y) > E.healerRange) continue;
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * E.healerShare);
        healed = true;
      }
      if (healed) state.fx.push({ kind: "ring", x: e.x, y: e.y, r: E.healerRange, color: "#22c55e", life: 0.4, max: 0.4 });
    }
  }
  // movement
  if (now < e.stunUntil) return;
  const speed = e.speed * (now < e.slowUntil ? e.slowFactor : 1);
  e.d += speed * dt;
  const p = pathPoint(e.path, e.d);
  e.x = p.x; e.y = p.y;
  if (e.d >= e.path.len) {
    e.dead = true;
    const cost = e.boss ? CONFIG.boss.leakHearts : 1;
    state.hearts -= cost;
    floatText(B.home.x, B.home.y - 0.4, `-${cost}`, "#e11d48", 1.2);
    sfx.leak();
  }
}

// Can this tower affect this enemy at all? (Flying needs Anti-Air or Sonic, Stealth needs to be close.)
function canAffect(tower, e, dist) {
  if (e.dead) return false;
  if (e.flying && !tower.stats.antiAir) return false;
  if (e.stealth && !tower.stats.holy && dist > E.stealthReveal) return false;
  return true;
}

function enemiesInRange(tower, range) {
  const list = [];
  for (const e of state.enemies) {
    const dist = Math.hypot(e.x - tower.x, e.y - tower.y);
    if (dist <= range && e.y > -0.6 && canAffect(tower, e, dist)) list.push(e);
  }
  return list;
}

// Target the enemy closest to getting home.
function pickTarget(tower) {
  let best = null, bestLeft = Infinity;
  for (const e of enemiesInRange(tower, towerRange(tower))) {
    const left = e.path.len - e.d;
    if (left < bestLeft) { bestLeft = left; best = e; }
  }
  return best;
}

function updateTower(tower, dt) {
  const s = tower.stats;
  tower.recoil = Math.max(0, tower.recoil - dt * 5);
  if (state.time < tower.stunUntil) { tower.beamTarget = null; return; }

  if (s.shape === "Support") {
    // Support + Slow is a slowing field. Everything else a Support does is an aura or end-of-wave effect.
    if (s.slow) for (const e of enemiesInRange(tower, towerRange(tower))) slowEnemy(e, T.supportSlow, 0.25);
    return;
  }

  if (s.shape === "Beam") {
    const target = pickTarget(tower);
    if (!target) { tower.beamTarget = null; tower.beamRamp = 1; return; }
    if (target !== tower.beamTarget) { tower.beamTarget = target; tower.beamRamp = 1; }
    const sh = T.shapes.Beam;
    tower.beamRamp = Math.min(sh.rampMax, tower.beamRamp + sh.rampPerSec * dt);
    tower.beamAcc += dt * tower.aura.rate;
    if (tower.beamAcc >= 0.25) {
      tower.beamAcc -= 0.25;
      applyHit(tower, target, (s.dmg / s.cd) * 0.25 * tower.beamRamp, { sure: true });
      sfx.shoot(s.elems[0]);
    }
    return;
  }

  tower.cd -= dt * tower.aura.rate;
  if (tower.cd > 0) return;
  const target = pickTarget(tower);
  if (!target) { tower.cd = 0; return; }
  tower.cd = s.cd;
  tower.recoil = 1;
  sfx.shoot(s.elems[0]);

  if (s.shape === "Pulse") {
    const range = towerRange(tower);
    for (const e of enemiesInRange(tower, range)) applyHit(tower, e, s.dmg, { sure: true });
    state.fx.push({ kind: "ring", x: tower.x, y: tower.y, r: range, color: s.color, life: 0.3, max: 0.3 });
  } else if (s.shape === "Chain") {
    const sh = T.shapes.Chain;
    const hit = [target];
    let from = { x: tower.x, y: tower.y }, cur = target, dmg = s.dmg;
    for (let j = 0; ; j++) {
      state.fx.push({ kind: "zap", x1: from.x, y1: from.y, x2: cur.x, y2: cur.y, color: s.color, life: 0.18, max: 0.18 });
      applyHit(tower, cur, dmg, { sure: j > 0 });
      if (j >= sh.jumps) break;
      let next = null, nd = sh.jumpRange;
      for (const e of state.enemies) {
        if (hit.includes(e)) continue;
        const dist = Math.hypot(e.x - cur.x, e.y - cur.y);
        if (dist <= nd && canAffect(tower, e, 0)) { nd = dist; next = e; }
      }
      if (!next) break;
      from = { x: cur.x, y: cur.y };
      cur = next; hit.push(next); dmg *= sh.falloff;
    }
  } else if (s.shape === "Pierce") {
    const dist = Math.hypot(target.x - tower.x, target.y - tower.y) || 1;
    state.shots.push({
      kind: "pierce", tower, x: tower.x, y: tower.y,
      vx: ((target.x - tower.x) / dist) * T.pierceSpeed, vy: ((target.y - tower.y) / dist) * T.pierceSpeed,
      left: towerRange(tower) + 1, hit: new Set(), color: s.color,
    });
  } else {
    state.shots.push({ kind: s.shape === "Splash" ? "splash" : "single", tower, x: tower.x, y: tower.y, target, tx: target.x, ty: target.y, color: s.color });
  }
}

function updateShots(dt) {
  for (const shot of state.shots) {
    if (shot.kind === "pierce") {
      const move = T.pierceSpeed * dt;
      shot.x += shot.vx * dt; shot.y += shot.vy * dt;
      shot.left -= move;
      for (const e of state.enemies) {
        if (shot.hit.has(e) || !canAffect(shot.tower, e, 0)) continue;
        if (Math.hypot(e.x - shot.x, e.y - shot.y) <= T.shapes.Pierce.width + e.size * 0.25) {
          shot.hit.add(e);
          applyHit(shot.tower, e, shot.tower.stats.dmg, {});
        }
      }
      if (shot.left <= 0) shot.done = true;
      continue;
    }
    // homing shots keep chasing a live target, or finish at its last position
    if (shot.target && !shot.target.dead) { shot.tx = shot.target.x; shot.ty = shot.target.y; }
    const dx = shot.tx - shot.x, dy = shot.ty - shot.y;
    const dist = Math.hypot(dx, dy);
    const move = T.projectileSpeed * dt;
    if (dist > move) { shot.x += (dx / dist) * move; shot.y += (dy / dist) * move; continue; }
    shot.done = true;
    const s = shot.tower.stats;
    if (shot.kind === "splash") {
      const r = T.shapes.Splash.radius;
      state.fx.push({ kind: "ring", x: shot.tx, y: shot.ty, r, color: shot.color, life: 0.25, max: 0.25 });
      for (const e of state.enemies) {
        if (Math.hypot(e.x - shot.tx, e.y - shot.ty) <= r && canAffect(shot.tower, e, 0)) applyHit(shot.tower, e, s.dmg, { sure: e !== shot.target });
      }
    } else if (shot.target && !shot.target.dead) {
      applyHit(shot.tower, shot.target, s.dmg, {});
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
  if (e.dodgy && !opts.sure && Math.random() < E.dodgeChance) {
    floatText(e.x, e.y - 0.4, "miss", "#94a3b8", 0.7);
    return;
  }
  let total = dmg * tower.aura.dmg;
  let crit = false;
  if (s.crit && Math.random() < T.critChance) { total *= T.critMultiplier; crit = true; }
  let dealt = 0;
  for (const el of s.elems) {
    let part = total / s.elems.length;
    for (const kind of e.kinds) part *= CONFIG.resist[kind][el] ?? 1;
    if (el === "Physical" && e.armored && !e.shredded) part *= E.armoredPhysical;
    dealt += part;
  }
  if (state.time < e.curseUntil) dealt *= CONFIG.elements.Dark.curse;
  e.lastTower = tower;
  hurt(e, dealt, tower, { color: s.color, crit, ignoreShield: s.holy });
  if (e.dead) return;
  applyStatuses(tower, e, dealt);
}

function hurt(e, amount, tower, opts) {
  if (e.dead || amount <= 0) return;
  e.lastHit = state.time;
  let left = amount;
  if (e.shield > 0 && !opts.ignoreShield) {
    const soak = Math.min(e.shield, left);
    e.shield -= soak; left -= soak;
  }
  e.hp -= left;
  if (!opts.silent) {
    e.flashUntil = state.time + 0.08;
    if (CONFIG.look.damageNumbers && amount >= 0.5) {
      floatText(e.x + (Math.random() - 0.5) * 0.3, e.y - 0.35, (opts.crit ? "!" : "") + Math.round(amount), opts.color, opts.crit ? 1.25 : 0.9);
    }
    sfx.hit();
  }
  if (e.hp <= 0) killEnemy(e, tower);
}

function applyStatuses(tower, e, dealt) {
  const s = tower.stats;
  const C = CONFIG.elements;
  const now = state.time;
  for (const el of s.elems.concat(tower.aura.imbue)) {
    if (el === "Fire" && !e.kinds.includes("Fire")) {
      const dps = (dealt * C.Fire.burnShare) / C.Fire.burnTime;
      if (!e.burn || dps >= e.burn.dps) e.burn = { dps, until: now + C.Fire.burnTime, color: ELEMENT_COLORS.Fire };
    } else if (el === "Ice" && !e.kinds.includes("Ice")) {
      slowEnemy(e, C.Ice.slow, C.Ice.time);
    } else if (el === "Poison" && !e.kinds.includes("Poison") && !e.kinds.includes("Machine")) {
      const dps = (dealt * C.Poison.share) / C.Poison.time;
      const stacks = Math.min(C.Poison.maxStacks, (e.poison ? e.poison.stacks : 0) + 1);
      e.poison = { dps: Math.max(dps, e.poison ? e.poison.dps : 0), stacks, until: now + C.Poison.time, color: ELEMENT_COLORS.Poison };
    } else if (el === "Lightning") {
      if (Math.random() < C.Lightning.stunChance) stunEnemy(e, C.Lightning.stunTime);
    } else if (el === "Dark") {
      e.curseUntil = now + C.Dark.time;
    } else if (el === "Water") {
      pushEnemy(e, C.Water.knockback);
    } else if (el === "Nature" && now > e.rootImmuneUntil && !e.unstoppable) {
      stunEnemy(e, C.Nature.root);
      e.rootImmuneUntil = now + C.Nature.cooldown;
    }
  }
  if (s.stun && Math.random() < T.stunChance) stunEnemy(e, T.stunTime);
  if (s.slow) slowEnemy(e, T.slowFactor, T.slowTime);
  if (s.bleed) {
    const dps = (dealt * T.bleedShare) / T.bleedTime;
    if (!e.bleed || dps >= e.bleed.dps) e.bleed = { dps, until: now + T.bleedTime, color: "#dc2626" };
  }
  if (s.knockback) pushEnemy(e, T.knockback);
  if (s.shred) e.shredded = true;
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
  let gold = R.killGold + R.killGoldPerWave * (state.wave - 1);
  if (e.rich) gold *= R.richMultiplier;
  if (tower && tower.stats.gold) gold *= R.goldTagKillMultiplier;
  if (e.child) gold /= 3;
  if (e.boss) gold *= CONFIG.boss.gold;
  gold = Math.max(1, Math.round(gold));
  state.gold += gold;
  state.kills++;
  state.score += Math.round(e.maxHp / 10) + state.wave;
  if (tower) tower.kills++;
  floatText(e.x, e.y - 0.1, `+${gold}`, "#ca8a04", 0.85);
  state.fx.push({ kind: "pop", x: e.x, y: e.y, r: e.size * 0.6, color: "#3b4252", life: 0.25, max: 0.25 });
  burst(e.x, e.y, e.boss ? 60 : e.rich ? 12 : 5, e.rich || e.boss ? ["#facc15", "#fde68a", "#f43f5e"] : ["#facc15", "#ffffff", "#94a3b8"]);
  if (e.boss) { bigText("BOSS DOWN", `+${gold} gold`, "#f43f5e", 1.8); sfx.bossDown(); }
  sfx.kill();
  if (e.rich) sfx.coin();

  if (e.splitter) {
    for (let k = 0; k < E.splitCount; k++) {
      const tags = e.tags.filter((t) => t !== "Splitter" && t !== "Tanky");
      const child = enemyFromTags(e.pack, e.drawing, tags, 1, 1);
      child.maxHp = child.hp = e.maxHp * E.splitHp;
      child.maxShield = child.shield = 0;
      child.speed = e.speed * 1.15;
      child.size = e.size * E.splitSize;
      child.path = e.path;
      child.d = Math.max(0, e.d - 0.35 * k);
      child.child = true;
      const p = pathPoint(child.path, child.d);
      child.x = p.x; child.y = p.y;
      state.enemies.push(child);
    }
  }
  if (e.explosive) {
    state.fx.push({ kind: "ring", x: e.x, y: e.y, r: E.explodeRange, color: "#f97316", life: 0.4, max: 0.4 });
    for (const t of state.towers) {
      if (Math.hypot(t.x - e.x, t.y - e.y) <= E.explodeRange) t.stunUntil = state.time + E.explodeStun;
    }
    sfx.boom();
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
