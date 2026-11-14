// =====================================================================================
// SPRITEPOCALYPSE - TUNABLES
// Every number that shapes how the game plays lives in this one file.
// Change a value, save, refresh the browser. Nothing here needs a rebuild.
// Distances are in grid cells, times are in seconds, unless a comment says otherwise.
// =====================================================================================

export const CONFIG = {
  // ---------------------------------------------------------------- BOARD
  board: {
    cols: 9,                 // grid width in cells
    rows: 13,                // grid height in cells
    spawn: { x: 4, y: 0 },   // enemy entry cell (top centre)
    home: { x: 4, y: 12 },   // cell the player defends (bottom centre)
  },

  // ---------------------------------------------------------------- RUN / ECONOMY
  run: {
    hearts: 10,              // lives at the start of a run; one enemy reaching home costs 1
    startGold: 0,            // gold at the start of a run
    freeTowers: 5,           // towers that cost nothing (the "5 base towers")
    towerCost: 50,           // price of the first paid tower
    towerCostGrowth: 10,     // each paid tower bought adds this much to the next price
    sellRefund: 0.5,         // share of the price paid that comes back when a locked tower is sold
    killGold: 5,             // gold for a normal kill
    killGoldPerWave: 0.5,    // extra gold per kill for each wave after the first
    richMultiplier: 3,       // gold multiplier for enemies tagged Rich
    goldTagKillMultiplier: 2,// gold multiplier when the killing tower has the Gold tag
    goldSupportPerWave: 15,  // gold a "Support + Gold" tower pays at the end of every wave
    healEveryWaves: 3,       // a "Support + Heal" tower restores 1 heart every N waves it survives
  },

  // ---------------------------------------------------------------- MAZE STYLE BONUS
  // Each time START WAVE is pressed the maze is rated from 0 (the "optimal" zigzag of full-width
  // walls with alternating gaps) to 1 (nothing like it). A word is shown and gold is paid.
  style: {
    enabled: true,
    challengeWeight: 0,      // share from a shorter route than the best zigzag (0 since 2026-11-13: long mazes are fine)
    originalityWeight: 0.5,  // share that comes from blocks that do not overlap any zigzag layout
    featuresWeight: 0.5,     // share that comes from un-zigzag features (the four below ADDED UP, capped at 1)
    // Each feature scores 0..1: the share of blocks (or path squares) showing it, divided by `full`
    // (the share that counts as "all the way"). A pure zigzag scores 0 on all four.
    features: {
      thickWalls: { full: 0.4 },   // blocks that are part of a filled 2x2 square (walls 2+ deep)
      diagonals:  { full: 0.4 },   // blocks touching another block only corner to corner
      wideGaps:   { full: 0.5 },   // path squares with open squares at their sides (openings 2+ wide)
      splitPaths: { full: 0.5 },   // path squares enemies could route around (forks, loops, islands)
    },
    goldMax: 60,             // gold for a perfect score in wave 1
    goldMaxPerWave: 10,      // the perfect-score payout grows by this much every wave
    // The word shown for each score band. `min` is the lowest score that earns the word.
    tiers: [
      { min: 0.0, word: "EASY MODE" },
      { min: 0.08, word: "BORING" },
      { min: 0.18, word: "LAME" },
      { min: 0.3, word: "STANDARD" },
      { min: 0.42, word: "NORMAL" },
      { min: 0.55, word: "COOL" },
      { min: 0.68, word: "AWESOME" },
      { min: 0.8, word: "CHALLENGING" },
      { min: 0.92, word: "HARDCORE" },
    ],
  },

  // ---------------------------------------------------------------- WAVES
  waves: {
    baseGroups: 4,           // groups in wave 1 (4 groups of 5 = 20 enemies)
    groupsPerWaves: 2,       // one more group every N waves
    groupSize: 5,            // enemies per group, all the same subject, each a different drawing
    groupSizeGrowthEvery: 3, // +1 enemy per group every N waves (0 = never)
    spawnInterval: 0.9,      // gap between enemies inside a group
    groupGap: 2.6,           // extra pause between groups
    hpGrowth: 1.25,          // enemy health multiplier per wave (compounding)
    speedGrowth: 1.01,       // enemy speed multiplier per wave (compounding)
    maxSpeedGrowth: 1.6,     // cap on the speed multiplier
  },

  // ---------------------------------------------------------------- BOSSES
  // On a boss wave the last group is replaced by one boss: a single big sprite with the
  // tags of its subject, far more health, and less patience for being stunned or shoved.
  boss: {
    every: 5,                // a boss arrives every N waves (0 = never)
    hp: 10,                  // health, as a multiple of a normal enemy of that subject and wave
    size: 1.9,               // drawn size multiplier
    gold: 10,                // kill reward multiplier
    leakHearts: 3,           // hearts lost if the boss reaches home
    control: 0.5,            // multiplier on slow, stun and root time and on knockback distance
    allowFlying: false,      // false = bosses are never picked from Flying subjects
  },

  // ---------------------------------------------------------------- ENEMY BASE STATS
  enemy: {
    baseHp: 60,              // health of a plain enemy in wave 1
    baseSpeed: 1.3,          // cells per second of a plain enemy
    size: 0.8,               // drawn size, as a share of one cell
    // Tag effects. Each tag is explained in GDD.md.
    fastSpeed: 1.6,          // Fast: speed multiplier
    slowSpeed: 0.6,          // Slow: speed multiplier
    tankyHp: 2.5,            // Tanky: health multiplier
    frailHp: 0.5,            // Frail: health multiplier
    flyingHp: 0.5,           // Flying: health multiplier (they skip the maze, so they are softer)
    flyingSpeed: 0.7,        // Flying: speed multiplier (a straight line is short, so they fly slower)
    armoredPhysical: 0.5,    // Armored: Physical damage multiplier
    shieldShare: 0.4,        // Shielded: shield size as a share of max health
    shieldDelay: 3,          // Shielded: seconds without damage before the shield refills
    shieldRegen: 0.2,        // Shielded: share of the shield refilled per second
    regenShare: 0.025,       // Regen: share of max health healed per second
    healerEvery: 3,          // Healer: seconds between heal pulses (was 2)
    healerRange: 1.6,        // Healer: pulse radius
    healerShare: 0.04,       // Healer: share of max health restored to each enemy in the pulse (was 0.08)
    // Heals do not stack: an enemy healed by any Healer cannot be healed again for healerEvery seconds.
    // Healers never heal other Healers.
    splitCount: 2,           // Splitter: children spawned on death
    splitHp: 0.35,           // Splitter: child health as a share of the parent max health
    splitSize: 0.6,          // Splitter: child size multiplier
    dodgeChance: 0.25,       // Dodgy: chance to avoid a projectile or zap (pulses and beams always hit)
    stealthReveal: 1.9,      // Stealth: towers can only affect it within this range (Holy ignores this)
    explodeRange: 1.7,       // Explosive: radius of the blast that stuns towers on death
    explodeStun: 2.5,        // Explosive: seconds towers are stunned
  },

  // ---------------------------------------------------------------- TOWER BASE STATS
  tower: {
    baseDamage: 12,          // damage per hit before any tag multipliers
    baseCooldown: 1.0,       // seconds between attacks before any tag multipliers
    // Shape: how the attack is delivered.          dmg = damage multiplier, cd = cooldown multiplier
    shapes: {
      Single: { dmg: 1.0, cd: 1.0 },                // one projectile, one target
      Splash: { dmg: 0.7, cd: 1.3, radius: 1.1 },   // projectile that bursts on impact
      Pulse: { dmg: 0.55, cd: 1.2 },                // pulse that hits everything in range of the tower
      Pierce: { dmg: 0.75, cd: 1.2, width: 0.45 },  // straight shot through every enemy in its line
      Chain: { dmg: 0.6, cd: 1.1, jumps: 3, jumpRange: 2.2, falloff: 0.7 }, // zap that hops between enemies
      Beam: { dmg: 0.9, cd: 1.0, rampPerSec: 0.5, rampMax: 3.0 },           // continuous, grows on one target
      Support: { dmg: 0, cd: 1.0 },                 // no attack, helps neighbours or the economy
      // attack patterns (added 2026-11-11)
      Link: { dmg: 0.8, cd: 1.0, branches: 2, branchRange: 2, branchShare: 0.5 },   // beam that branches to nearby enemies
      Spin: { dmg: 0.4, cd: 1.0, blades: 3, radius: 1.2, turnsPerSec: 0.8, hitEvery: 0.5 }, // orbiting blades
      Boomerang: { dmg: 0.7, cd: 1.4 },             // flies out to the target spot and back, hitting both ways
      Ricochet: { dmg: 1.0, cd: 1.0, bounceRange: 2.5, bounceShare: 0.7 },          // one bounce to a second enemy
      Artillery: { dmg: 1.1, cd: 1.6, radius: 1.4, minRange: 1.5, flight: 0.9 },    // lobbed, cannot hit close
      Spread: { dmg: 0.35, cd: 1.2, pellets: 5, cone: 0.45 },                       // 5 pellets in a cone (radians)
      Sweep: { dmg: 0.8, cd: 2.0 },                 // hits every enemy in its whole row or column
    },
    // Range: reach in cells, and the damage multiplier that pays for a short reach.
    ranges: {
      Melee: { cells: 1.6, dmg: 1.7 },
      Short: { cells: 2.4, dmg: 1.3 },
      Mid: { cells: 3.4, dmg: 1.0 },
      Long: { cells: 4.8, dmg: 0.8 },
    },
    defaultRange: "Short",   // used when a tower has no range tag (some Support towers)
    physicalBonus: 1.25,     // Physical hits harder to make up for armour and having no status effect
    rapid: { cd: 0.45, dmg: 0.5 },   // Rapid: fires faster for less
    heavy: { cd: 2.0, dmg: 2.6 },    // Heavy: fires slower for much more
    weakDamage: 0.5,         // Weak: damage multiplier (deliberately weak, mostly toys)
    critChance: 0.2,         // Crit: chance per hit
    critMultiplier: 3,       // Crit: damage multiplier
    stunChance: 0.15,        // Stun: chance per hit
    stunTime: 0.7,           // Stun: seconds
    slowFactor: 0.65,        // Slow: enemy speed multiplier
    slowTime: 2,             // Slow: seconds
    bleedShare: 0.4,         // Bleed: extra damage over time, as a share of the hit
    bleedTime: 3,            // Bleed: seconds
    knockback: 0.9,          // Knockback: cells pushed back along the path
    knockbackCooldown: 1.5,  // Knockback: seconds before the same enemy can be pushed again
    // Support auras apply to the 8 blocks around the support tower.
    buffDamage: 0.3,         // Buff: +30% damage to each neighbour (stacks)
    hasteRate: 0.25,         // Haste: +25% attack speed to each neighbour (stacks)
    reachBonus: 1,           // Reach: +1 cell of range to each neighbour
    reachMax: 2,             // Reach: most bonus range a tower can collect
    supportSlow: 0.7,        // Support + Slow: speed multiplier for enemies inside its range
    projectileSpeed: 9,      // cells per second for normal shots
    pierceSpeed: 14,         // cells per second for Pierce shots
  },

  // ---------------------------------------------------------------- SPECIAL TOWER TAGS (added 2026-11-11)
  special: {
    antiAirDamage: 2,        // Anti-Air: damage multiplier against flyers (it can only target flyers)
    giantShare: 0.03,        // Giant Slayer: extra damage = this share of the target's max health
    giantCap: 3,             // Giant Slayer: that extra is capped at this many times the tower's normal hit (bosses)
    monstrousEvery: 10,      // Monstrous: every Nth attack is a big one
    monstrousDamage: 4,      // Monstrous: damage multiplier of the big attack
    burstShots: 3, burstGap: 0.12, burstDamage: 0.4, burstCooldown: 2.2,   // Burst
    explodeShare: 0.5, explodeRadius: 1.2,   // Explode: share of the killing hit dealt around the victim
    timewarpEvery: 8, timewarpCells: 2.5,    // Timewarp: every N seconds the next hit sends the enemy back
    tastyEvery: 6, tastyTime: 4, tastyDamage: 1.3,   // Tasty: mark, how long, damage taken while marked
    magnetCells: 0.5,        // Magnet: pull towards the tower per hit (same cooldown as knockback)
    sleepTime: 3, sleepChance: 0.35, sleepImmune: 6,      // Sleep: until hit again or time runs out
    confuseTime: 1.5, confuseChance: 0.25, confuseImmune: 5,   // Confuse: walks backwards
    freezeEvery: 10, freezeTime: 1,           // Freeze Frame: stops every enemy in range
    echoDelay: 0.5, echoDamage: 0.5,          // Echo: each attack repeats once
    mineEvery: 5, mineMax: 3, mineDamage: 2, mineRadius: 1, mineTrigger: 0.4,  // Mine Layer
    warmupMax: 0.6, warmupTime: 20,           // Warm-up: up to +60% attack speed after 20 s of firing, resets each wave
    trophyPerKill: 0.01, trophyMax: 0.5,      // Trophy: +1% damage per kill, up to +50%
    glassDamage: 2, glassWaves: 3,            // Glass Cannon: double damage, breaks after 3 waves
    luckyCrit: 0.1, luckyGoldChance: 0.2, luckyGold: 3,   // Lucky
    shatterDamage: 1.5,       // Shatter: damage multiplier against slowed or stopped enemies
    executeShare: 0.05,       // Execute: kills enemies left under this share of their max health
  },

  // ---------------------------------------------------------------- ELEMENT STATUS EFFECTS
  elements: {
    Fire: { burnShare: 0.5, burnTime: 3 },                    // burn: share of the hit dealt again over time
    Ice: { slow: 0.6, time: 2 },                              // chill: speed multiplier and seconds
    Poison: { share: 0.7, time: 5, maxStacks: 5 },            // poison: stacking damage over time
    Lightning: { stunChance: 0.2, stunTime: 0.4 },            // stagger: short stun
    Dark: { curse: 1.25, time: 3 },                           // curse: enemy takes more damage
    Water: { knockback: 0.3 },                                // splash: small push back
    Nature: { root: 0.5, cooldown: 3 },                       // root: brief hold, then immune for a while
    // Armored only halves Physical damage; every other element ignores it. Sonic and Anti-Air can hit Flying.
    // Holy ignores Shielded and Stealth.
  },

  // Damage multiplier by enemy kind (row) and damage element (column). Missing = 1.
  resist: {
    Fire: { Fire: 0.25, Ice: 1.5, Water: 2, Nature: 0.5 },
    Ice: { Ice: 0.25, Fire: 2 },
    Water: { Water: 0.25, Lightning: 2, Fire: 0.5 },
    Lightning: { Lightning: 0.25 },
    Holy: { Holy: 0.25, Dark: 1.5 },
    Dark: { Dark: 0.25, Holy: 2, Poison: 0.5 },
    Poison: { Poison: 0.1, Fire: 1.5 },
    Nature: { Nature: 0.25, Fire: 2, Poison: 1.5, Water: 0.5 },
    Machine: { Lightning: 2, Water: 1.5, Poison: 0.1 },
    Ethereal: { Physical: 0.25, Magic: 1.5, Holy: 1.5, Poison: 0.25 },
  },

  // ---------------------------------------------------------------- SPECIAL ENEMY TAGS (added 2026-11-11)
  enemyX: {
    dashEvery: 4, dashTime: 0.6, dashSpeed: 3,
    scaryRange: 1.5, scaryRate: 0.7,          // Scary: nearby towers attack at 70% speed
    diggerTime: 6,                            // Digger: underground (only area attacks reach it)
    rallyRange: 1.6, rallySpeed: 1.25,
    transportSpeed: 1.5, transportSplit: 3, transportChildSpeed: 0.7, transportChildHp: 0.35,
    thiefBase: 15, thiefPerWave: 2,           // Thief: gold stolen if it reaches home
    jammerRange: 1.5,                         // Jammer: Support auras off for towers this close
    enrageSpeed: 0.6,                         // Enrage: up to +60% speed at low health
    undyingHp: 0.3,                           // Undying: revives once with this share of health
    cleanseEvery: 4,
    spikyStun: 0.5,                           // Spiky: Melee towers that hit it are stunned
    growPerSec: 0.04, growMaxSize: 1.6,       // Growing: +4% max health a second
    summonEvery: 5, summonMax: 4, summonHp: 0.25,
    eggEvery: 4, eggHatch: 4, eggHp: 0.3,     // Egg Layer
    cocoonSpeed: 0.5, cocoonHatchSpeed: 1.6,  // Cocoon: slow and armoured, hatches into a fast flyer halfway
    blinkCells: 1.5, blinkHit: 0.15, blinkCooldown: 3,   // Blink: teleports forward after a big hit
    swarmFactor: 3, swarmHp: 0.25, swarmSize: 0.6,       // Swarm: 3x as many, each 25% health
    pinataSpeed: 1.4, pinataHp: 0.5, pinataGold: 5,
    decoyHp: 0.5,
  },

  // ---------------------------------------------------------------- SEARCH BOX
  search: {
    maxTags: 5,              // most tags a tower or enemy can show
    fuzzyMinScore: 0.62,     // 0..1, how close a typo has to be before it counts as a match (offline fallback only)
  },

  // ---------------------------------------------------------------- MEANING SEARCH
  // When the typed words are not literally in any sprite name, a small language model running
  // in the browser finds the sprite closest in meaning. If you change `model`, rebuild
  // data/embeddings.bin with tools/embed.html (same model there).
  semantic: {
    enabled: true,
    model: "Xenova/bge-small-en-v1.5",
    library: "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2",
    minScore: 0.6,           // -1..1, below this the word counts as "nothing matches" (this model rarely scores under 0.55)
  },

  // ---------------------------------------------------------------- LOOK AND SOUND
  look: {
    paper: "#fbfdff",        // graph paper colour
    lineMinor: "#d6e6f7",    // thin graph lines
    lineMajor: "#9fc3ea",    // cell lines
    pencil: "#3b4252",       // block outline
    pencilFill: "#c9ced8",   // block shading
    damageNumbers: true,     // floating damage numbers
    groupBanner: true,       // name and tags of each enemy group as it starts to arrive
    pathPreview: true,
    // Digger enemies are drawn as one of these drawings while underground (tools/sprite_sheet.py shows the numbers)
    diggerSprite: { subject: "dirt pile", drawings: [1, 7, 8, 10, 12, 13, 14, 19] },       // dotted line showing the route enemies will take (build phase)
  },
  audio: {
    volume: 0.25,            // master volume, 0..1
  },
};

// Colours used for tags, projectiles and damage numbers.
// =====================================================================================
// COMBOS
// Two towers of the same category on neighbouring blocks (all 8 around, diagonals too) form a combo.
// Both get that category's bonus once, however long the chain. The same sprite twice does not count
// (two "husky" towers), but different sprites of a category do (a husky and a poodle).
// Which sprites belong to which category is decided in tools/classify.py (CATEGORY_CLASSES).
//
// Bonus fields (any mix):
//   dmg: +share of damage       rate: +share of attack speed     range: +cells of reach
//   crit: +crit chance           status: x duration of slows, stuns, burns, poison, curses
//   gold: x gold from its kills  imbue: element effect added to its hits
//   antiAir: can hit flyers       slow / knockback: its hits slow / shove enemies
//   pierceArmor: Armored does not halve its Physical damage    blastProof: Explosive enemies cannot stun it
// `desc` is what players read when they inspect a tower in a combo. No numbers, by design.
// =====================================================================================
export const COMBOS = {
  food:      { name: "Food",      color: "#f97316", bonus: { dmg: 0.25 },          desc: "Well fed: these towers hit harder." },
  desserts:  { name: "Desserts",  color: "#f472b6", bonus: { slow: true },         desc: "Sugar crash: their hits slow enemies down.", strong: "Sugar crash: their slows are much stronger." },
  drinks:    { name: "Drinks",    color: "#38bdf8", bonus: { rate: 0.25 },         desc: "Caffeinated: these towers attack faster." },
  weapons:   { name: "Weapons",   color: "#94a3b8", bonus: { crit: 0.15 },         desc: "Armed: more critical hits." },
  ranged:    { name: "Ranged",    color: "#a16207", bonus: { range: 1 },           desc: "Spotters: these towers reach further." },
  armour:    { name: "Armour",    color: "#64748b", bonus: { blastProof: true },   desc: "Braced: exploding enemies cannot stun these towers." },
  land:      { name: "Land Animals", color: "#84cc16", bonus: { rate: 0.2 },      desc: "Pack hunters: these towers attack faster." },
  sea:       { name: "Sea Creatures", color: "#0ea5e9", bonus: { imbue: "Water" }, desc: "Tidal: their hits knock enemies back down the path.", strong: "Tidal: their water knocks enemies much further back." },
  birds:     { name: "Birds",     color: "#facc15", bonus: { antiAir: true },      desc: "Flock: these towers can hit flying enemies.", strong: "Flock: these towers hit flying enemies much harder." },
  bugs:      { name: "Bugs",      color: "#65a30d", bonus: { imbue: "Poison" },    desc: "Swarm: their hits poison enemies.", strong: "Swarm: their poison is much stronger." },
  monsters:  { name: "Monsters",  color: "#7c3aed", bonus: { imbue: "Dark" },      desc: "Horde: their hits curse enemies so they take more damage.", strong: "Horde: their curses are much stronger." },
  fighters:  { name: "Fighters",  color: "#dc2626", bonus: { dmg: 0.25 },          desc: "Squad: these towers hit harder." },
  magic:     { name: "Arcane",    color: "#14b8a6", bonus: { pierceArmor: true },  desc: "Spellbound: armour does not soften their hits." },
  townsfolk: { name: "Townsfolk", color: "#eab308", bonus: { rate: 0.15, gold: 1.25 }, desc: "Community: these towers attack a little faster and earn more gold." },
  plants:    { name: "Plants",    color: "#16a34a", bonus: { imbue: "Nature" },    desc: "Overgrown: their hits root enemies for a moment.", strong: "Overgrown: their roots hold much longer." },
  machines:  { name: "Machines",  color: "#475569", bonus: { rate: 0.25 },         desc: "Networked: these towers attack faster." },
  music:     { name: "Music",     color: "#ec4899", bonus: { range: 1 },           desc: "Band: these towers reach further." },
  clothing:  { name: "Clothing",  color: "#c084fc", bonus: { dmg: 0.15 },          desc: "Dressed up: these towers hit a little harder." },
  treasure:  { name: "Treasure",  color: "#fbbf24", bonus: { gold: 1.75 },         desc: "Hoard: their kills earn much more gold." },
  buildings: { name: "Buildings", color: "#b45309", bonus: { range: 1 },           desc: "Lookout: these towers reach further." },
  vehicles:  { name: "Vehicles",  color: "#ef4444", bonus: { knockback: true },    desc: "Ramming: their hits knock enemies back down the path.", strong: "Ramming: they knock enemies much further back." },
  weather:   { name: "Weather",   color: "#06b6d4", bonus: { status: 1.5 },        desc: "Storm front: their slows, burns, poisons and stuns last longer." },
  household: { name: "Household", color: "#a3a3a3", bonus: { dmg: 0.15 },         desc: "Handy: these towers hit a little harder." },
  // added 2026-11-12
  cosmos:    { name: "Cosmos",    color: "#4338ca", bonus: { pull: 0.4 },           desc: "Gravity: their hits pull enemies towards them.", strong: "Gravity: their hits pull enemies much harder." },
  rocks:     { name: "Rocks",     color: "#78716c", bonus: { stunChance: 0.12 },    desc: "Rock solid: their hits sometimes stun.", strong: "Rock solid: their hits stun much more often." },
  sports:    { name: "Sports",    color: "#0891b2", bonus: { rate: 0.15, range: 0.5 }, desc: "Training: these towers attack a little faster and reach a little further." },
  toys:      { name: "Toys",      color: "#f472b6", bonus: { confuseChance: 0.15 }, desc: "Playtime: their hits sometimes send enemies wandering backwards.", strong: "Playtime: their hits confuse enemies much more often." },
  symbols:   { name: "Signs",     color: "#eab308", bonus: { markChance: 0.2 },     desc: "Marked: their hits sometimes mark enemies to take extra damage.", strong: "Marked: their hits mark enemies much more often." },
};

// MINI COMBOS (2026-11-12). Families of variants of one thing (fire slime, ice slime, slime...) form a
// mini combo on top of the normal ones: same rules (touching, one of each sprite, +N size), but a
// smaller version of the parent combo's bonus. A sprite is in a family when its name IS the family
// word or ends with it ("fire slime" -> slime). Drawn as the parent's colour with white stripes.
export const MINI_COMBO = {
  share: 0.5,           // fraction of the parent's number bonuses (0.5 = half)
  flagDamage: 0.1,      // parents with only on/off bonuses (Water, anti-air...) give this much extra damage instead
};
// [family word, display name, parent combo, also match names that START with the word ("ghost cat")]
const MINI_FAMILIES = [
  ["ghost", "Ghosts", "monsters", true],
  ["slime", "Slimes", "monsters"], ["golem", "Golems", "monsters"], ["dragon", "Dragons", "monsters"], ["elemental", "Elementals", "monsters"],
  ["knight", "Knights", "fighters"], ["warrior", "Warriors", "fighters"],
  ["sword", "Swords", "weapons"], ["axe", "Axes", "weapons"], ["hammer", "Hammers", "weapons"],
  ["bow", "Bows", "ranged"], ["pistol", "Pistols", "ranged"], ["rifle", "Rifles", "ranged"], ["crossbow", "Crossbows", "ranged"], ["bomb", "Bombs", "ranged"],
  ["wand", "Wands", "magic"], ["staff", "Staffs", "magic"], ["orb", "Orbs", "magic"], ["tome", "Tomes", "magic"], ["amulet", "Amulets", "magic"], ["crystal", "Crystals", "magic"],
  ["armor", "Armor", "armour"], ["helmet", "Helmets", "armour"], ["gauntlet", "Gauntlets", "armour"], ["shield", "Shields", "armour"],
  ["boots", "Boots", "clothing"], ["hat", "Hats", "clothing"], ["robe", "Robes", "clothing"], ["mask", "Masks", "clothing"],
  ["pizza", "Pizzas", "food"], ["soup", "Soups", "food"], ["egg", "Eggs", "food"], ["pie", "Pies", "desserts"],
  ["mushroom", "Mushrooms", "plants"], ["cactus", "Cacti", "plants"], ["truck", "Trucks", "vehicles"], ["car", "Cars", "vehicles"],
  ["cat", "Cats", "land"], ["fish", "Fish", "sea"], ["crown", "Crowns", "treasure"], ["drum", "Percussion", "music"], ["ore", "Ores", "rocks"],
];
/** Half of a combo's bonus, as mini combos use it (on/off-only combos give a little damage instead). */
export function miniBonus(parent) {
  const p = COMBOS[parent], bonus = {};
  for (const [k, v] of Object.entries(p.bonus)) {
    if (typeof v !== "number") continue;
    bonus[k] = k === "status" || k === "gold" ? 1 + (v - 1) * MINI_COMBO.share : v * MINI_COMBO.share;
  }
  if (!Object.keys(bonus).length) bonus.dmg = MINI_COMBO.flagDamage;
  return bonus;
}

// NAME PAIRS (2026-11-13): two different things that share a name (kiwi bird + kiwi fruit). A pair is a
// mini combo that only forms when BOTH sides are in the group; each tower then gets half of the OTHER
// side's main combo bonus (the kiwi bird gets half the Food bonus, the kiwi fruit half the Birds bonus).
// [id word, display name, side A names, side B names]
export const NAME_PAIRS = [
  ["kiwi", "Kiwi", ["kiwi bird"], ["kiwi fruit", "kiwi half", "kiwi vine"]],
  ["bat", "Bat", ["fruit bat", "cave bat"], ["baseball bat", "cricket bat"]],
  ["crane", "Crane", ["crane bird", "origami crane"], ["crane truck"]],
  ["seal", "Seal", ["harbor seal", "elephant seal", "harp seal"], ["seal stamp"]],
  ["mouse", "Mouse", ["field mouse", "pet mouse"], ["computer mouse"]],
  ["club", "Club", ["golf club", "caveman club"], ["club sandwich"]],
  ["bass", "Bass", ["bass fish"], ["bass guitar", "bass drum", "double bass"]],
  ["pitcher", "Pitcher", ["pitcher"], ["pitcher plant"]],
  ["squash", "Squash", ["butternut squash"], ["squash racket"]],
  ["pike", "Pike", ["pike fish"], ["pike"]],
  ["cricket", "Cricket", ["cricket insect"], ["cricket bat", "cricket ball"]],
  ["plane", "Plane", ["hand plane"], ["propeller plane"]],
  ["fan", "Fan", ["electric fan", "ceiling fan", "folding hand fan"], ["fan palm", "sea fan coral"]],
  ["tank", "Tank", ["army tank"], ["fish tank", "tank top"]],
  ["kite", "Kite", ["kite"], ["kite shield"]],
  ["bow", "Bow", ["bow and arrow", "composite bow"], ["bow tie", "hair bow ribbon"]],
  ["star", "Star", ["star"], ["star fruit"]],
  ["spring", "Spring", ["coil spring"], ["spring roll"]],
  ["organ", "Organ", ["pipe organ"], ["organ pipe cactus"]],
];
for (const [word, name, a, b] of NAME_PAIRS) {
  COMBOS["pair:" + word] = {
    name, color: "#e879f9", bonus: {}, mini: true, pair: true, sides: [a, b],
    desc: "Name pair: each side gets half of the other side's combo bonus.",
  };
}
/** Name-pair ids ("pair:kiwi") a sprite name is part of. */
export function namePairsOf(name) {
  return NAME_PAIRS.filter(([, , a, b]) => a.includes(name) || b.includes(name)).map(([word]) => "pair:" + word);
}

const MINI_EXCLUDE = new Set(["violin bow", "crate of fish", "jar of slime", "jar of eyeballs", "ghost orchid", "ghost mushroom",
  "oil drum", "metal oil drum"]);
// Extra members whose names do not match the family word (bongo drums, djembe...)
const MINI_EXTRA = {
  "mini:drum": ["bongo drums", "tabla drums", "drum set", "djembe", "cajon", "tambourine", "gong"],
};
for (const [word, name, parent] of MINI_FAMILIES) {
  const p = COMBOS[parent], bonus = {};
  for (const [k, v] of Object.entries(p.bonus)) {
    if (typeof v !== "number") continue;
    bonus[k] = k === "status" || k === "gold" ? 1 + (v - 1) * MINI_COMBO.share : v * MINI_COMBO.share;
  }
  const flagOnly = !Object.keys(bonus).length;
  if (flagOnly) bonus.dmg = MINI_COMBO.flagDamage;
  COMBOS["mini:" + word] = {
    name, color: p.color, bonus, mini: true, parent, word,
    desc: flagOnly ? `Mini ${p.name} combo: these towers hit ${Math.round(MINI_COMBO.flagDamage * 100)}% harder.`
                   : `Mini ${p.name} combo: ${Math.round(MINI_COMBO.share * 100)}% of the ${p.name} bonus. ${p.desc}`,
  };
}
/** Every mini combo id ("mini:slime") a sprite name belongs to (a ghost cat is a Ghost AND a Cat). */
export function miniFamiliesOf(name) {
  if (MINI_EXCLUDE.has(name)) return [];
  const out = MINI_FAMILIES.filter(([word, , , prefix]) => name === word || name.endsWith(" " + word) || (prefix && name.startsWith(word + " ")))
    .map(([word]) => "mini:" + word);
  for (const [id, names] of Object.entries(MINI_EXTRA)) if (names.includes(name) && !out.includes(id)) out.push(id);
  return out;
}

// Bigger combos. A combo of 3, 4 or 5 linked towers gives each tower in it a bigger bonus.
// Number bonuses (damage, speed, range, crit, gold, Weather's longer effects, chance bonuses) grow by
// bonusPerExtra of the normal bonus for every tower past 2: 0.5 = 3 towers x1.5, 4 towers x2 ... 15 towers x7.5.
// On/off bonuses (Water, Poison, anti-air, armour piercing...) can't grow, so those combos give
// damagePerExtra extra damage per tower past 2 instead (0.1 = +10% at 3 towers, +30% at 5).
export const COMBO_SIZE = {
  maxTowers: 15,         // towers past this count add nothing more (the card shows COMBO +2 up to +15)
  bonusPerExtra: 0.5,
  damagePerExtra: 0.1,
  chanceCap: 0.9,        // chance bonuses (stun, confuse, pull, mark) never go above this
};

// Stronger versions. When a tower ALREADY has the effect a combo would give it (a hawk can already
// hit flyers, a fish already has Water), it gets a stronger version of that effect instead.
// `strong` in COMBOS above is what players read in that case.
export const COMBO_STRONGER = {
  waterPush: 2,            // Sea Creatures: Water knockback distance multiplier
  flyerDamage: 1.5,        // Birds: damage multiplier against Flying enemies
  rootTime: 2,             // Plants: root duration multiplier
  curseBonus: 0.25,        // Monsters: added to the curse damage multiplier (1.25 becomes 1.5)
  poisonPower: 1.6,        // Bugs: poison damage multiplier
  slowFactor: 0.7,         // Desserts: slow factor multiplier (smaller = slower enemies)
  knockback: 1.6,          // Vehicles: Knockback distance multiplier
};

// =====================================================================================
// THEMES (added 2026-11-12)
// Places where things are found together. 3 or more towers of a theme that touch (8 around) and
// are 3 or more DIFFERENT kinds of thing (chef + oven + pressure cooker, not oven + oven + oven) form
// the theme. Every tower in it gets the theme bonus, on top of any combo. Members: tools/themes.py.
// Theme bonuses are deliberately odder than combo bonuses. Numbers for each are in `n`.
// =====================================================================================
export const THEMES = {
  kitchen:    { name: "Kitchen",    color: "#f97316", n: { every: 4, dmg: 1.0, radius: 1.2 },  desc: "Food fight: every few attacks also lobs a pie at a random enemy in range." },
  farm:       { name: "Farm",       color: "#84cc16", n: { goldPerKill: 3 },                  desc: "Harvest: at the end of every wave, pays extra gold for every kill these towers made." },
  graveyard:  { name: "Graveyard",  color: "#7c3aed", n: { radius: 0.9, time: 5 },             desc: "Haunting: enemies they kill leave a haunted spot that curses anything walking through it." },
  pirate:     { name: "Pirate",     color: "#a16207", n: { chance: 0.25, gold: 5 },           desc: "Plunder: kills sometimes drop a whole chest of gold." },
  circus:     { name: "Circus",     color: "#ec4899", n: { share: 0.7, range: 2.5 },           desc: "Juggling act: their shots bounce on to another enemy." },
  hospital:   { name: "Hospital",   color: "#ef4444", n: { hearts: 1, healPerExtra: 2 },      desc: "Triage: gives you back a heart at the end of every other wave, more with more healers in it." },
  castle:     { name: "Castle",     color: "#64748b", n: { range: 1 },                        desc: "Fortress: nothing can stun or frighten these towers, and they see further." },
  beach:      { name: "Beach",      color: "#0ea5e9", n: { every: 10, radius: 2, cells: 1 },   desc: "High tide: every so often a wave washes nearby enemies back down the path." },
  space:      { name: "Space",      color: "#1e40af", n: { chance: 0.25, time: 1 },            desc: "Zero gravity: hits sometimes float enemies off the ground, and these towers can hit flyers." },
  workshop:   { name: "Workshop",   color: "#b45309", n: {},                                   desc: "Tinkering: every wave each tower bolts on a random extra trick for that wave." },
  garden:     { name: "Garden",     color: "#16a34a", n: { radius: 1.3, slow: 0.6 },           desc: "Overgrowth: enemies near these towers get tangled and slowed." },
  wildwest:   { name: "Wild West",  color: "#d97706", n: { dmg: 3 },                          desc: "Quick draw: the first shot at every enemy hits three times as hard." },
  laboratory: { name: "Laboratory", color: "#22d3ee", n: {},                                   desc: "Mutation: every hit adds a random effect: burn, poison, slow, curse or stun." },
  winter:     { name: "Winter",     color: "#bae6fd", n: { every: 8, radius: 2, time: 1.5 },   desc: "Blizzard: every so often freezes the enemies around these towers." },
  school:     { name: "School",     color: "#facc15", n: { perWave: 0.03, max: 0.6 },          desc: "Studying: these towers get a little stronger for every wave they spend together." },
  roman:      { name: "Roman",      color: "#9f1239", n: { share: 0.15 },                     desc: "Thumbs down: enemies these towers bring below 15% health are finished off on the spot." },
  concert:    { name: "Orchestra",  color: "#a855f7", n: { echoes: 2, share: 0.35, gap: 0.25 }, desc: "Encore: every attack is repeated twice more, quieter." },
};
// Workshop tricks a tower can draw at the start of a wave.
export const WORKSHOP_TRICKS = ["Burst", "Echo", "Explode", "Lucky", "Shatter", "Execute", "Monstrous"];

export const ELEMENT_COLORS = {
  Physical: "#6b7280", Magic: "#a855f7", Fire: "#f97316", Ice: "#38bdf8", Poison: "#84cc16",
  Lightning: "#facc15", Holy: "#fde68a", Dark: "#7c3aed", Water: "#3b82f6", Nature: "#22c55e", Sonic: "#f472b6",
};

// Words in a drawing's caption that add an element to that particular drawing.
// "flaming sword" drawn from the "sword" subject gains Fire on top of the sword's own tags.
export const CAPTION_ELEMENTS = {
  Fire: ["flaming", "burning", "fiery", "flame", "flames", "molten", "lava", "smoldering", "ember", "blazing", "scorched", "fire"],
  Ice: ["frozen", "frosted", "frost", "frosty", "icy", "snow-covered", "snowy", "ice-covered", "ice", "snow"],
  Magic: ["enchanted", "magical", "glowing", "arcane", "mystic", "runes", "shimmering", "magic"],
  Dark: ["cursed", "haunted", "shadowy", "ghostly", "undead", "shadow"],
  Holy: ["blessed", "holy", "divine", "angelic", "radiant", "halo"],
  Poison: ["poisonous", "toxic", "venomous", "rotten", "moldy", "slimy", "poison"],
  Lightning: ["electric", "sparking", "charged", "crackling", "lightning", "electrified"],
  Nature: ["mossy", "overgrown", "blooming", "leafy", "moss", "vines"],
  Water: ["wet", "soaked", "dripping", "bubbly", "waterlogged"],
};
