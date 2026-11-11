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
    challengeWeight: 0.6,    // share of the score that comes from a shorter route than the best zigzag
    originalityWeight: 0.4,  // share that comes from blocks that do not overlap any zigzag layout
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
    healerEvery: 2,          // Healer: seconds between heal pulses
    healerRange: 1.6,        // Healer: pulse radius
    healerShare: 0.08,       // Healer: share of max health restored to each enemy in the pulse
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

  // ---------------------------------------------------------------- ELEMENT STATUS EFFECTS
  elements: {
    Fire: { burnShare: 0.5, burnTime: 3 },                    // burn: share of the hit dealt again over time
    Ice: { slow: 0.6, time: 2 },                              // chill: speed multiplier and seconds
    Poison: { share: 0.7, time: 5, maxStacks: 5 },            // poison: stacking damage over time
    Lightning: { stunChance: 0.2, stunTime: 0.4 },            // stagger: short stun
    Dark: { curse: 1.25, time: 3 },                           // curse: enemy takes more damage
    Water: { knockback: 0.3 },                                // splash: small push back
    Nature: { root: 0.5, cooldown: 3 },                       // root: brief hold, then immune for a while
    // Magic and Sonic ignore Armored. Sonic and Anti-Air can hit Flying. Holy ignores Shielded and Stealth.
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
    pathPreview: true,       // dotted line showing the route enemies will take (build phase)
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
  magic:     { name: "Magic",     color: "#a855f7", bonus: { pierceArmor: true },  desc: "Arcane: armour does not soften their hits." },
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
