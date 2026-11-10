// =====================================================================================
// SEARCH - turns whatever the player typed into the closest subject in the atlas.
//
// Order of attempts (first hit wins):
//   1. a hand-written synonym ("kitty" -> cat)
//   2. the exact subject name ("wizard hat")
//   3. a subject at the end of the phrase, earlier words become drawing hints
//      ("giant spider" -> subject "spider", prefer drawings captioned "giant")
//   4. subjects whose main (last) word is the typed word ("tree" -> any "... tree")
//   5. subjects containing every typed word, then any typed word
//   6. the same again after fixing typos word by word ("wizrd" -> "wizard")
//   7. the closest name by spelling, if it is close enough
// Returns null when nothing is close, and the UI asks for a different word.
// =====================================================================================

import { CONFIG, CAPTION_ELEMENTS } from "./config.js";
import { db } from "./data.js";

/** Lowercase, strip punctuation, collapse spaces. */
export function normalise(text) {
  return text.toLowerCase().replace(/[^a-z0-9'\- ]+/g, " ").replace(/\s+/g, " ").trim();
}

function singulars(w) {
  const out = [];
  if (w.endsWith("ies") && w.length > 4) out.push(w.slice(0, -3) + "y");
  if (w.endsWith("es") && w.length > 3) out.push(w.slice(0, -2));
  if (w.endsWith("s") && w.length > 3) out.push(w.slice(0, -1));
  return out;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

// Prefer the names with the fewest words (closest to what was typed), random among ties.
function pickShortest(list) {
  let min = Infinity;
  for (const s of list) min = Math.min(min, s.words.length);
  return pick(list.filter((s) => s.words.length === min));
}

function exact(phrase) {
  if (db.byName.has(phrase)) return db.byName.get(phrase);
  const words = phrase.split(" ");
  for (const s of singulars(words[words.length - 1])) {
    const alt = words.slice(0, -1).concat(s).join(" ");
    if (db.byName.has(alt)) return db.byName.get(alt);
  }
  return null;
}

function lookup(map, word) {
  if (map.has(word)) return map.get(word);
  for (const s of singulars(word)) if (map.has(s)) return map.get(s);
  return null;
}

function matchWords(words) {
  const phrase = words.join(" ");
  // 1. synonym
  if (db.aliases[phrase] && db.byName.has(db.aliases[phrase])) return { subject: db.byName.get(db.aliases[phrase]), hints: [] };
  // 2. exact name
  let s = exact(phrase);
  if (s) return { subject: s, hints: [] };
  // 3. subject at the end of the phrase, then anywhere in it
  for (let i = 1; i < words.length; i++) {
    s = exact(words.slice(i).join(" "));
    if (s) return { subject: s, hints: words.slice(0, i) };
  }
  for (let len = words.length - 1; len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      s = db.byName.get(words.slice(i, i + len).join(" "));
      if (s) return { subject: s, hints: words.slice(0, i).concat(words.slice(i + len)) };
    }
  }
  // 4. subjects whose head word is the typed head word
  const head = words[words.length - 1];
  const rest = words.slice(0, -1);
  const headed = lookup(db.byHead, head);
  if (headed) {
    const all = headed.filter((x) => rest.every((w) => x.words.includes(w)));
    if (all.length) return { subject: pickShortest(all), hints: [] };
    return { subject: pickShortest(headed), hints: rest };
  }
  // 5. subjects containing every typed word, then the rarest typed word
  const lists = words.map((w) => lookup(db.byWord, w)).filter(Boolean);
  if (lists.length === words.length) {
    const all = lists[0].filter((x) => lists.every((l) => l.includes(x)));
    if (all.length) return { subject: pickShortest(all), hints: [] };
  }
  if (lists.length) {
    lists.sort((a, b) => a.length - b.length);
    const known = new Set(lists[0][0].words);
    return { subject: pickShortest(lists[0]), hints: words.filter((w) => !known.has(w)) };
  }
  return null;
}

/** Levenshtein edit distance, stopping early once it passes `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Fix a single mistyped word against every word used in subject names.
function fixWord(word) {
  if (db.byWord.has(word) || word.length < 3) return word;
  const max = word.length <= 4 ? 1 : 2;
  let best = null, bestD = max + 1;
  for (const candidate of db.byWord.keys()) {
    const d = editDistance(word, candidate, bestD - 1);
    if (d < bestD) { bestD = d; best = candidate; if (d === 1) break; }
  }
  return best || word;
}

/**
 * Find the closest subject for a typed phrase.
 * Returns { subject, hints } or null. `hints` are leftover words used to choose a drawing.
 */
export async function findSubject(text) {
  const phrase = normalise(text);
  if (!phrase) return null;
  const words = phrase.split(" ");
  let hit = matchWords(words);
  if (hit) return hit;
  // 6. closest in MEANING, not in spelling ("satan" is a demon, not a satay skewer)
  if (CONFIG.semantic.enabled) {
    const state = await semantic.loading;        // waits for the model the first time
    if (state === "ready") {
      const best = (await semanticTop(phrase, 1))[0];
      return best && best.score >= CONFIG.semantic.minScore ? { subject: best.subject, hints: [] } : null;
    }
  }
  // Only reached when the meaning model could not load (offline): fall back to spelling.
  // 7. fix typos word by word and try again
  const fixed = words.map(fixWord);
  if (fixed.join(" ") !== phrase) {
    hit = matchWords(fixed);
    if (hit) return hit;
  }
  // 7. closest whole name by spelling
  let best = null, bestScore = 0;
  for (const s of db.subjects) {
    const longer = Math.max(s.name.length, phrase.length);
    const d = editDistance(phrase, s.name, Math.floor(longer * (1 - CONFIG.search.fuzzyMinScore)));
    const score = 1 - d / longer;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return bestScore >= CONFIG.search.fuzzyMinScore ? { subject: best, hints: [] } : null;
}

// ------------------------------------------------------------------------------------
// MEANING SEARCH
// A small language model runs in the player's browser (free, no server, no API key) and turns
// the typed text into a vector. data/embeddings.bin holds the same kind of vector for every
// subject name, built once by tools/embed.html. The closest vector is the closest meaning.
// The model is about 23 MB, downloaded once and then cached by the browser.
// ------------------------------------------------------------------------------------

const semantic = {
  loading: Promise.resolve("off"),   // resolves to "ready", "failed" or "off"
  extractor: null,                   // the model
  vectors: null,                     // Int8Array, count x dim, unit vectors scaled by 127
  dim: 0,
};

/** Start loading the model and the subject vectors in the background. Call once at boot. */
export function initSemantic() {
  if (!CONFIG.semantic.enabled) return semantic.loading;
  semantic.loading = (async () => {
    try {
      const [buf, lib] = await Promise.all([
        fetch("data/embeddings.bin").then((r) => { if (!r.ok) throw new Error("no embeddings file"); return r.arrayBuffer(); }),
        import(/* the library is loaded from a CDN on purpose, see GDD */ CONFIG.semantic.library),
      ]);
      const [count, dim] = new Uint32Array(buf, 0, 2);
      if (count !== db.subjects.length) throw new Error("embeddings are out of date, re-run tools/embed.html");
      semantic.vectors = new Int8Array(buf, 8);
      semantic.dim = dim;
      lib.env.allowLocalModels = false;
      semantic.extractor = await lib.pipeline("feature-extraction", CONFIG.semantic.model);
      return "ready";
    } catch (err) {
      console.warn("Meaning search unavailable, falling back to spelling:", err.message);
      return "failed";
    }
  })();
  return semantic.loading;
}

/** The k subjects closest in meaning to the text, best first: [{ subject, score }] with score from -1 to 1. */
export async function semanticTop(text, k = 5) {
  if ((await semantic.loading) !== "ready") return [];
  const out = await semantic.extractor(text, { pooling: "mean", normalize: true });
  const q = out.data, dim = semantic.dim, V = semantic.vectors;
  const best = [];
  for (let i = 0; i < db.subjects.length; i++) {
    let dot = 0;
    const o = i * dim;
    for (let j = 0; j < dim; j++) dot += q[j] * V[o + j];
    const score = dot / 127;
    if (best.length < k || score > best[best.length - 1].score) {
      best.push({ subject: db.subjects[i], score });
      best.sort((a, b) => b.score - a.score);
      if (best.length > k) best.pop();
    }
  }
  return best;
}

/**
 * Choose which drawing of a subject to use. Hint words ("giant", "frost") prefer drawings
 * whose caption mentions them; an element word also accepts its synonyms (frost = frozen = icy).
 * `avoid` is a set of drawing indexes to skip when possible (used to give 5 different drawings).
 */
export function pickDrawing(pack, hints = [], avoid = null) {
  let pool = [];
  if (hints.length) {
    const wanted = hints.map((h) => {
      for (const list of Object.values(CAPTION_ELEMENTS)) if (list.includes(h)) return list;
      return [h];
    });
    for (let i = 0; i < pack.count; i++) {
      const cap = pack.captions[i];
      if (wanted.every((alts) => alts.some((w) => cap.includes(w)))) pool.push(i);
    }
  }
  if (!pool.length) for (let i = 0; i < pack.count; i++) pool.push(i);
  if (avoid) {
    const fresh = pool.filter((i) => !avoid.has(i));
    if (fresh.length) pool = fresh;
  }
  return pick(pool);
}
