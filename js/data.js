// =====================================================================================
// DATA - loads the subject index, the palette, and per-subject sprite packs on demand.
// The full atlas is 1.4 million sprites, so nothing is loaded until a subject is needed:
// one small file (about 75 KB) per subject, fetched the first time it is typed or spawned.
// =====================================================================================

import { CONFIG, CAPTION_ELEMENTS } from "./config.js";

const DATA_URL = "data/";

export const db = {
  subjects: [],        // [{ id, name, words, count, towerTags, enemyTags }]
  byName: new Map(),   // subject name -> subject
  byWord: new Map(),   // single word -> [subjects containing that word]
  byHead: new Map(),   // last word of the name -> [subjects]
  aliases: {},         // typed synonym -> subject name
  palette: null,       // Uint8Array, 3 bytes per colour, index 0 is transparent
  packs: new Map(),    // subject id -> Promise<pack>
};

/** Load the subject index and the global palette. Call once at boot. */
export async function loadIndex() {
  const [indexRes, palRes] = await Promise.all([fetch(DATA_URL + "subjects.json"), fetch(DATA_URL + "palette.bin")]);
  if (!indexRes.ok || !palRes.ok) throw new Error("Could not load sprite data. Run tools/build_packs.py and tools/classify.py first.");
  const index = await indexRes.json();
  db.palette = new Uint8Array(await palRes.arrayBuffer());
  db.aliases = index.aliases || {};
  index.subjects.forEach((row, id) => {
    const [name, count, t, e] = row;
    const subject = {
      id, name, count,
      words: name.split(" "),
      towerTags: t ? t.split(" ") : [],
      enemyTags: e ? e.split(" ") : [],
    };
    db.subjects.push(subject);
    db.byName.set(name, subject);
    for (const w of new Set(subject.words)) pushTo(db.byWord, w, subject);
    pushTo(db.byHead, subject.words[subject.words.length - 1], subject);
  });
}

function pushTo(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

/**
 * Load one subject's pack: every drawing of that subject plus its caption.
 * Returns { subject, count, captions[], sprite(i) -> 16x16 canvas, flash(i) -> white silhouette canvas }.
 * Packs are cached, so asking twice costs nothing.
 */
export function loadPack(subject) {
  if (!db.packs.has(subject.id)) {
    db.packs.set(subject.id, fetchPack(subject).catch((err) => { db.packs.delete(subject.id); throw err; }));
  }
  return db.packs.get(subject.id);
}

async function fetchPack(subject) {
  const res = await fetch(`${DATA_URL}packs/${subject.id}.bin`);
  if (!res.ok) throw new Error(`Missing sprite pack for "${subject.name}"`);
  const buf = await res.arrayBuffer();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const count = view.getUint32(0, true);
  const capLen = view.getUint32(4, true);
  const captions = new TextDecoder().decode(bytes.subarray(8, 8 + capLen)).split("\n");
  // Record where each sprite starts so drawings are only decoded when they are first used.
  const offsets = new Uint32Array(count);
  let p = 8 + capLen;
  for (let i = 0; i < count; i++) {
    offsets[i] = p;
    p += 1 + bytes[p] * 2 + 256;
  }
  const cache = new Array(count);
  const flashCache = new Array(count);

  function sprite(i) {
    if (cache[i]) return cache[i];
    let q = offsets[i];
    const n = bytes[q++];
    const local = new Uint16Array(n + 1);
    for (let k = 1; k <= n; k++, q += 2) local[k] = bytes[q] | (bytes[q + 1] << 8);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(16, 16);
    for (let px = 0; px < 256; px++) {
      const li = bytes[q + px];
      if (!li) continue;
      const g = local[li] * 3;
      img.data[px * 4] = db.palette[g];
      img.data[px * 4 + 1] = db.palette[g + 1];
      img.data[px * 4 + 2] = db.palette[g + 2];
      img.data[px * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return (cache[i] = canvas);
  }

  // White silhouette of a drawing, used for the hit flash.
  function flash(i) {
    if (flashCache[i]) return flashCache[i];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(sprite(i), 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 16, 16);
    return (flashCache[i] = canvas);
  }

  return { subject, count, captions, sprite, flash };
}

/** A random subject from the whole atlas. */
export function randomSubject() {
  return db.subjects[Math.floor(Math.random() * db.subjects.length)];
}

/**
 * Elements a single drawing gains from its caption ("flaming", "frozen", ...).
 * Words that are already part of the subject name do not count, the subject tags cover those.
 */
export function captionElements(subject, caption) {
  const own = new Set(subject.words);
  const words = caption.toLowerCase().split(/[^a-z\-']+/).filter((w) => w && !own.has(w));
  const found = [];
  for (const [element, list] of Object.entries(CAPTION_ELEMENTS)) {
    if (words.some((w) => list.includes(w))) found.push(element);
  }
  return found;
}

/** Tower tags for one specific drawing: the subject's tags plus any caption element, capped. */
export function towerTagsFor(subject, caption) {
  const tags = subject.towerTags.slice();
  const elements = ["Physical", "Magic", "Fire", "Ice", "Poison", "Lightning", "Holy", "Dark", "Water", "Nature", "Sonic"];
  const have = tags.filter((t) => elements.includes(t));
  for (const el of captionElements(subject, caption)) {
    if (have.includes(el) || have.length >= 2) continue;
    const at = have.length ? tags.indexOf(have[have.length - 1]) + 1 : 1;
    tags.splice(at, 0, el);
    have.push(el);
  }
  return trimTags(tags);
}

/** Enemy tags for one specific drawing: caption elements first, then the subject's tags, capped. */
export function enemyTagsFor(subject, caption) {
  const kinds = { Fire: "Fire", Ice: "Ice", Water: "Water", Lightning: "Lightning", Holy: "Holy", Dark: "Dark", Poison: "Poison", Nature: "Nature", Magic: "Shielded" };
  const tags = [];
  for (const el of captionElements(subject, caption)) if (kinds[el] && !tags.includes(kinds[el])) tags.push(kinds[el]);
  for (const t of subject.enemyTags) if (!tags.includes(t)) tags.push(t);
  return trimTags(tags);
}

// Keep at most maxTags, dropping from the end (the least defining tags come last).
function trimTags(tags) {
  return tags.length > CONFIG.search.maxTags ? tags.slice(0, CONFIG.search.maxTags) : tags;
}
