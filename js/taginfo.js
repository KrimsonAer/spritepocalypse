// =====================================================================================
// TAG DESCRIPTIONS - the short text shown when a tag is hovered or tapped.
// Deliberately no numbers: the player learns how strong things are by watching.
// Shown for towers once they are locked in, and for enemies.
// =====================================================================================

export const TOWER_TAG_INFO = {
  // shape
  Single: "Fires one shot at one enemy.",
  Splash: "Fires a shot that bursts and hits everything near the impact.",
  AoE: "Pulses, hitting every enemy within its range at once.",
  Pierce: "Fires a straight shot that passes through every enemy in its line.",
  Chain: "Zaps one enemy, then the zap hops to others nearby, weaker each hop.",
  Beam: "Holds a steady beam on one enemy that grows stronger the longer it stays on them.",
  Support: "Does not attack. Helps the towers on the blocks around it, or helps you directly.",
  // element
  Physical: "Plain damage. Hits hard, but armour soaks it up.",
  Magic: "Magic damage. Strong against ghostly things.",
  Fire: "Sets enemies alight so they keep burning for a while.",
  Ice: "Chills enemies, slowing them down.",
  Poison: "Poisons enemies. The poison builds up with every hit.",
  Lightning: "Sometimes jolts an enemy, stopping it for a moment.",
  Holy: "Cuts straight through shields and can always see hidden enemies.",
  Dark: "Curses enemies so they take more damage from everything.",
  Water: "Washes enemies a little way away from this tower.",
  Nature: "Roots enemies to the spot for a moment.",
  Sonic: "Sound reaches everything, including flying enemies.",
  // range
  Melee: "Only reaches the squares right next to it, but hits hardest.",
  Short: "Short reach, strong hits.",
  Mid: "Medium reach.",
  Long: "Long reach, lighter hits.",
  // specials
  "Anti-Air": "Can hit flying enemies.",
  Rapid: "Attacks very quickly, with lighter hits.",
  Heavy: "Attacks slowly, with very heavy hits.",
  Crit: "Sometimes lands a critical hit for much more damage.",
  Stun: "Sometimes stuns an enemy, stopping it for a moment.",
  Slow: "Slows the enemies it hits. On a Support tower, slows everything inside its range.",
  Bleed: "Leaves enemies bleeding, taking extra damage over time.",
  Knockback: "Shoves enemies directly away from this tower. That can push them forwards, so place it with care.",
  Shred: "Strips armour off the enemies it hits, for good.",
  Gold: "Earns extra gold. Attackers earn more from their kills, Supports pay out after every wave.",
  Buff: "Neighbouring towers hit harder.",
  Haste: "Neighbouring towers attack faster.",
  Reach: "Neighbouring towers can reach further.",
  Heal: "Gives a heart back every few waves.",
  Toy: "It is a toy. It does not hit very hard.",
};

export const ENEMY_TAG_INFO = {
  Fast: "Moves quickly.",
  Slow: "Moves slowly.",
  Tanky: "Has a lot of health.",
  Frail: "Has very little health.",
  Armored: "Armour soaks up Physical damage.",
  Flying: "Flies straight over the maze. Only Anti-Air and Sonic towers can hit it.",
  Shielded: "Has a shield that must be broken first, and that refills if it is left alone.",
  Regen: "Heals itself over time.",
  Healer: "Heals the enemies around it.",
  Splitter: "Splits into smaller copies when it dies.",
  Unstoppable: "Cannot be slowed, stunned, rooted or pushed.",
  Stealth: "Hard to see. Towers can only hit it up close.",
  Rich: "Drops much more gold.",
  Dodgy: "Sometimes dodges shots and zaps.",
  Explosive: "Explodes when it dies, stunning nearby towers.",
  Ethereal: "Ghostly. Physical damage barely touches it, Magic and Holy hurt it more.",
  Machine: "A machine. Weak to Lightning and Water, immune to Poison.",
  Fire: "Made of fire. Shrugs off Fire, hates Water and Ice.",
  Ice: "Made of ice. Shrugs off Ice, hates Fire.",
  Water: "A water thing. Shrugs off Water, hates Lightning.",
  Lightning: "Charged. Shrugs off Lightning.",
  Holy: "Holy. Shrugs off Holy, hurt more by Dark.",
  Dark: "A dark thing. Shrugs off Dark, hates Holy.",
  Poison: "Poisonous. Almost immune to Poison, hurt more by Fire.",
  Nature: "A plant or wooden thing. Shrugs off Nature, hates Fire.",
  Boss: "A boss. Far bigger and tougher than anything else in the wave, and costs more hearts if it gets home.",
};
