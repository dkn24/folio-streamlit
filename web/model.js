const enc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const words = (text) =>
  String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
function safeLink(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
}
const attr = enc;
const arts = {
  neural: "Machine learning",
  astronomy: "Physics",
  botany: "Biology",
  maths: "Mathematics",
  computing: "Computer science",
  cognition: "Cognitive science",
};
const topicArts = Object.fromEntries(
  Object.entries(arts).map(([a, t]) => [t, a]),
);
const cover = (p) => (Object.hasOwn(arts, p.art) ? p.art : "computing");
const paperUrl = (p) => "#paper/" + encodeURIComponent(p.id);
const shortAuthors = (p) =>
  p.authors.length > 2
    ? p.authors[0] + " et al."
    : p.authors.join(" & ") || "Author unavailable";
const titleKey = (p) => words(p.title).join(" ");
const meaningful = (e) => !!e && (e.saved || e.readAt > 0);
function unique(list) {
  const keys = new Set();
  return list.filter((p) => {
    const ids = [p.id, titleKey(p), p.doi?.toLowerCase()].filter(Boolean);
    if (ids.some((k) => keys.has(k))) return false;
    ids.forEach((k) => keys.add(k));
    return true;
  });
}
function matches(p, q) {
  const all = words(
    [
      p.title,
      ...p.authors,
      p.year,
      p.venue,
      ...p.topics,
      ...(p.keywords || []),
      p.description,
      p.doi,
      p.arxiv,
    ].join(" "),
  ).join(" ");
  return words(q).every((w) => all.includes(w));
}
function order(papers, value) {
  if (!value || ["default", "recent"].includes(value)) return papers;
  return [...papers].sort((a, b) =>
    value === "title"
      ? a.title.localeCompare(b.title)
      : value === "old"
        ? Number(a.year || 0) - Number(b.year || 0)
        : Number(b.year || 0) - Number(a.year || 0),
  );
}
const start = () => ({ section: 0, fraction: 0, ratio: 0, edition: "" });
const blank = (paper) => ({
  paper,
  saved: false,
  savedAt: 0,
  readAt: 0,
  reading: { status: "unread", progress: 0, position: start() },
});
const stamp = (t) => Math.max(Date.now(), t + 1);
function merge(a, b) {
  if (!a) return b;
  return {
    paper: b.paper,
    saved: b.savedAt > a.savedAt ? b.saved : a.saved,
    savedAt: Math.max(a.savedAt, b.savedAt),
    reading: b.readAt > a.readAt ? b.reading : a.reading,
    readAt: Math.max(a.readAt, b.readAt),
  };
}
const stop = new Set(
  "the and for from about based using with that have their study through paper networks between".split(
    " ",
  ),
);
const tags = (p) =>
  new Set(
    [
      ...(p.keywords || []),
      ...words(p.title).filter((w) => w.length > 3 && !stop.has(w)),
    ].map((w) => w.toLowerCase()),
  );
function recommend(papers, shelf) {
  const signals = Object.values(shelf)
    .filter(meaningful)
    .map((e) => ({
      p: e.paper,
      t: tags(e.paper),
      w:
        (e.saved ? 2 : 0) +
        (e.reading.status === "finished"
          ? 5
          : e.reading.status === "reading"
            ? 2 + e.reading.progress / 40
            : 0),
    }));
  const seen = new Set(signals.map((s) => titleKey(s.p))),
    interests = new Map();
  for (const s of signals)
    for (const t of s.p.topics) interests.set(t, (interests.get(t) || 0) + s.w);
  const items = unique(papers)
    .filter((p) => !seen.has(titleKey(p)))
    .map((p, i) => {
      const its = tags(p);
      let score = 0,
        best = 0,
        reason = "";
      for (const s of signals) {
        const shared = p.topics.filter((t) => s.p.topics.includes(t)).length,
          related = [...s.t].filter((t) => its.has(t)).length;
        const n = (shared * 3 + related * 4) * s.w;
        score += n;
        if (n > best) {
          best = n;
          reason = s.p.title;
        }
      }
      return { p, i, score, reason };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i);
  return {
    items,
    top: [...interests].sort((a, b) => b[1] - a[1])[0]?.[0] || "",
    personal: signals.length > 0,
  };
}
function localGet(key, fallback) {
  try {
    return (
      JSON.parse(localStorage.getItem("folio.st.v1." + key) || "null") ??
      fallback
    );
  } catch {
    return fallback;
  }
}
function localSet(key, value) {
  try {
    localStorage.setItem("folio.st.v1." + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
const memory = new Map();
let dbPromise;
function database() {
  return (dbPromise ||= new Promise((resolve) => {
    try {
      const req = indexedDB.open("folio-streamlit-cache", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("objects");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}
async function cacheGet(k) {
  if (memory.has(k)) return memory.get(k);
  const db = await database();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const req = db.transaction("objects").objectStore("objects").get(k);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}
async function cachePut(k, v) {
  if (memory.size > 100) memory.delete(memory.keys().next().value);
  memory.set(k, v);
  const db = await database();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction("objects", "readwrite");
      tx.objectStore("objects").put(v, k);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    } catch {
      resolve();
    }
  });
}
function makeSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function validPaper(p) {
  return (
    p &&
    typeof p.id === "string" &&
    p.id.length > 0 &&
    p.id.length <= 360 &&
    !["__proto__", "prototype", "constructor"].includes(p.id) &&
    typeof p.title === "string" &&
    p.title.length > 0 &&
    Array.isArray(p.authors) &&
    Array.isArray(p.topics)
  );
}
function validEntry(e) {
  return (
    validPaper(e?.paper) &&
    typeof e.saved === "boolean" &&
    Number.isFinite(e.savedAt) &&
    Number.isFinite(e.readAt) &&
    e.reading &&
    ["unread", "reading", "finished"].includes(e.reading.status) &&
    Number.isFinite(e.reading.progress) &&
    e.reading.position &&
    Number.isFinite(e.reading.position.ratio)
  );
}
function overview(p) {
  const sections = [];
  if (p.abstract)
    sections.push({ title: "Abstract", paragraphs: [p.abstract] });
  if (p.overview?.length)
    sections.push({ title: "Editorial overview", paragraphs: p.overview });
  if (!sections.length && (p.snippet || p.description))
    sections.push({
      title: "Index excerpt",
      paragraphs: [p.snippet || p.description],
    });
  return {
    format: sections[0]?.title || "Paper details",
    sections,
    source: p.url,
  };
}
const isFull = (ed) => ed?.format === "Full text" || ed?.format === "PDF text";
const storedEd = (ed) =>
  Array.isArray(ed?.sections) &&
  ed.sections.every(
    (s) => typeof s.title === "string" && Array.isArray(s.paragraphs),
  );
function routeFrom(hash) {
  const [path, query = ""] = (hash || "#discover").slice(1).split("?");
  const ps = new URLSearchParams(query);
  let id = "";
  try {
    if (path.startsWith("paper/")) id = decodeURIComponent(path.slice(6));
  } catch {}
  return {
    page: id
      ? "paper"
      : ["library", "for-you", "search"].includes(path)
        ? path
        : "discover",
    id,
    topic: ps.get("topic") || "",
    q: ps.get("q") || "",
    status: ps.get("status") || "all",
    source: ps.get("source") || "Open indexes",
  };
}
function routeUrl(page, params = {}) {
  const ps = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v && v !== "all"),
  );
  return "#" + page + (ps.size ? "?" + ps : "");
}
const glyphs = {
  book: '<path d="M3 4c4-.4 6.6.7 9 2.8C14.4 4.7 17.2 3.6 21 4v14.4c-3.7-.3-6.6.6-9 2.6-2.4-2-5.3-2.9-9-2.6z"/><path d="M12 7v14"/>',
  compass:
    '<circle cx="12" cy="12" r="9"/><path d="m16 8-2.8 5.2L8 16l2.8-5.2z"/>',
  library:
    '<rect x="3" y="4" width="4" height="16" rx=".6"/><rect x="8.5" y="4" width="3.2" height="16" rx=".6"/><path d="m13.5 5.4 3.2-.9 4.5 14.8-3.3 1z"/>',
  spark:
    '<path d="m13 3 1.9 5.2L20 10l-5.1 1.8L13 17l-1.8-5.2L6 10l5.2-1.8zM5 15l.9 2.1L8 18l-2.1.9L5 21l-.9-2.1L2 18l2.1-.9z"/>',
  find: '<circle cx="10.5" cy="10.5" r="6.8"/><path d="m16 16 4.7 4.7"/>',
  mark: '<path d="M6.5 3.5h11v17L12 17l-5.5 3.5z"/>',
  layers:
    '<path d="m2 8 10-5 10 5-10 5zM3 12.5l9 4.5 9-4.5M3 17l9 4.5 9-4.5"/>',
  neural:
    '<rect x="9" y="2.5" width="6" height="5" rx=".8"/><rect x="2" y="16" width="6" height="5" rx=".8"/><rect x="16" y="16" width="6" height="5" rx=".8"/><path d="M12 8v4H5v4m7-4h7v4"/>',
  astronomy:
    '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(55 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-45 12 12)"/><circle cx="12" cy="12" r="1"/>',
  botany:
    '<path d="M20 4c-9-1-15 3-15 9 0 4 5 7 9 4 4-2 5-8 6-13zM4 21l10-11"/>',
  maths: '<path d="M19 4H5l8 8-8 8h14"/>',
  computing:
    '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="m6 9 3 3-3 3m5 0h4"/>',
  cognition:
    '<path d="M12 19V5c-1-4-6-2-6 1-4-1-5 5-2 7-2 4 3 7 5 5 1 3 3 2 3 1zm0 0c1 3 4 2 5 0 4 1 6-4 3-6 3-4 0-7-2-7-1-4-5-4-6-1"/><path d="M6 9l2 2m10-1-2 2"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m5 9 7 7 7-7"/>',
  grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>',
  settings:
    '<path d="M3 7h5m4 0h9M3 17h10m4 0h4"/><circle cx="10" cy="7" r="2"/><circle cx="15" cy="17" r="2"/>',
  close: '<path d="m5 5 14 14M19 5 5 19"/>',
  external: '<path d="M13 4h7v7m0-7L10 14"/><path d="M10 5H5v14h14v-5"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  file: '<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 13h8M8 16h6"/>',
  cloud:
    '<path d="M6 18a5 5 0 0 1-.4-10 6.7 6.7 0 0 1 13-1 5.5 5.5 0 0 1-.5 11z"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  link: '<path d="m11 8 2-2a5 5 0 0 1 7 7l-3 3m-4 0-2 2a5 5 0 0 1-7-7l3-3m2 6 6-6"/>',
};
function icon(name, size = 17, filled = false) {
  return (
    '<svg aria-hidden="true" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 24 24" fill="' +
    (filled ? "currentColor" : "none") +
    '" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' +
    (glyphs[name] || "") +
    "</svg>"
  );
}
function brand() {
  return '<svg aria-hidden="true" viewBox="0 0 36 36" width="34" height="34"><path fill="currentColor" d="M2 5.7c5.6-.4 10.3 1.4 14.2 5.1v19.5C12.3 27.1 7.3 25.4 2 25.8zM19.2 10.8C23.5 7 28.4 5.4 34 5.7v20.1c-5.3-.4-10.6 1.5-14.8 4.5z"/><path d="M6.1 10.8c2.2.3 4.7 1.2 6.7 2.5m-6.7 1.5c2.2.3 4.7 1.3 6.7 2.6m10.2-4c2-1.3 4.5-2.2 6.7-2.6m-6.7 6.6c2-1.4 4.5-2.3 6.7-2.6" stroke="#f6f7e9" fill="none" stroke-width="1.3"/></svg><span>Folio</span>';
}
