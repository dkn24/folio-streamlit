const navLinks = [
  ["discover", "Discover", "compass"],
  ["library", "My library", "library"],
  ["for-you", "For you", "spark"],
];
const statusLabels = [
  ["all", "All papers"],
  ["reading", "Reading"],
  ["later", "Saved for later"],
  ["finished", "Finished"],
];
const spotIds = ["attention", "waves", "morphogenesis"];
function statusMatch(e, f) {
  return f === "all"
    ? meaningful(e)
    : f === "later"
      ? e.saved && e.reading.status === "unread"
      : e.reading.status === f;
}
function nav(page) {
  return navLinks
    .map(
      ([id, label, im]) =>
        `<a href="#${id}" class="${page === id ? "active" : ""}" ${page === id ? 'aria-current="page"' : ""}>${icon(im)}${label}</a>`,
    )
    .join("");
}
function intro(title, description, aside = "") {
  return `<div class="intro"><div><h1>${enc(title)}</h1>${description ? `<p>${enc(description)}</p>` : ""}</div>${aside}</div>`;
}
function topicBar(state, current) {
  return `<div class="topics" aria-label="Filter by topic">${["", ...state.data.topics].map((t) => `<button type="button" data-act="topic" data-value="${attr(t)}" aria-pressed="${current === t}" class="topic ${current === t ? "on" : ""}">${icon(topicArts[t] || "layers", 15)}${enc(t || "All topics")}</button>`).join("")}</div>`;
}
function sortTools(state, mode) {
  const options =
    mode === "library"
      ? [
          ["recent", "Recently active"],
          ["new", "Newest first"],
          ["old", "Oldest first"],
          ["title", "Title A–Z"],
        ]
      : [
          ["default", mode === "discover" ? "Curated order" : "Relevance"],
          ["new", "Newest first"],
          ["old", "Oldest first"],
          ["title", "Title A–Z"],
        ];
  return `<div class="collection-tools"><label class="sort">${icon("settings", 15)}<select aria-label="Sort papers" data-change="sort">${options.map(([v, l]) => `<option value="${v}" ${state.sort === v ? "selected" : ""}>${l}</option>`).join("")}</select>${icon("down", 13)}</label>
   <div class="view-pick">${["grid", "list"].map((v) => `<button data-act="layout" data-value="${v}" aria-label="${v === "grid" ? "Grid" : "List"} view" aria-pressed="${state.layout === v}">${icon(v, 16)}</button>`).join("")}</div></div>`;
}
function saveButton(p, saved, cls) {
  const label = (saved ? "Unsave " : "Save ") + p.title;
  return `<button class="${cls} ${saved ? "is-saved" : ""}" aria-label="${attr(label)}" title="${saved ? "Remove bookmark" : "Save to library"}" data-act="save" data-id="${attr(p.id)}" aria-pressed="${!!saved}">${icon("mark", 17, !!saved)}</button>`;
}
function feature(s) {
  const i = s.spot,
    p = s.data.catalogue.find((p) => p.id === spotIds[i]),
    a = p.id === "attention" ? "attention" : cover(p);
  const title =
    p.id === "attention" ? "Attention Is <em>All You Need</em>" : enc(p.title);
  return `<section class="feature feature-${a}" aria-label="Paper spotlight" aria-roledescription="carousel">
   <img class="hero-art" src="app/static/art/${a}.webp" alt="" fetchpriority="high"><div class="shade"></div>
   <div class="feature-copy"><div class="kicker"><i></i>Paper spotlight</div><h2 class="${p.title.length > 50 ? "long" : ""}"><a href="${paperUrl(p)}">${title}</a></h2>
   <p class="feature-byline">${enc(shortAuthors(p))}<span>·</span>${enc(p.year)}</p><p class="feature-desc">${enc(p.id === "attention" ? "The paper that introduced the Transformer and reshaped how machines understand language." : p.description)}</p>
   <div class="hero-actions"><a class="read-button" href="${paperUrl(p)}">${icon("book")}${s.shelf[p.id]?.reading.status === "reading" ? "Continue reading" : "Read paper"}</a>${saveButton(p, s.shelf[p.id]?.saved, "hero-save")}</div></div>
   <div class="carousel"><span><b>0${i + 1}</b> / 03</span><button data-act="spot-back" aria-label="Previous spotlight">${icon("left", 16)}</button><button data-act="spot-next" aria-label="Next spotlight">${icon("right", 16)}</button></div></section>`;
}
function card(p, s, opts = {}) {
  const e = s.shelf[p.id],
    a = cover(p),
    progress = e?.reading.progress || 0;
  const trail =
    opts.progress && e
      ? `<div class="card-status">${e.reading.status === "finished" ? icon("check", 15) + "Finished" : e.reading.status === "reading" ? `<span class="mini-track"><i style="width:${Math.min(100, Math.max(0, progress))}%"></i></span>${Math.round(progress)}% read` : icon("mark", 14) + "Saved for later"}</div>`
      : "";
  return `<article class="paper-card color-${a}"><div class="cover"><a href="${paperUrl(p)}" tabindex="-1" aria-label="Read ${attr(p.title)}"><img loading="lazy" src="app/static/art/${a}.webp" alt=""></a>${saveButton(p, e?.saved, "bookmark")}</div>
 <div class="card-body"><div class="card-meta"><span class="subject"><i></i>${enc(p.topics[0] || "Research")}</span>${p.year ? `<span>·</span><span>${enc(p.year)}</span>` : ""}</div>
 <h3><a href="${paperUrl(p)}">${enc(p.title)}</a></h3><p class="byline">${enc(shortAuthors(p))}</p>
 ${opts.reason ? `<div class="card-status">${icon("spark", 14)}<span>Related to <i>${enc(opts.reason)}</i></span></div>` : ""}${trail}</div></article>`;
}
function empty(title, body, action = "", href = "#discover") {
  return `<div class="empty"><div class="empty-icon">${icon("book", 26)}</div><h3>${enc(title)}</h3><p>${enc(body)}</p>${action ? `<a class="btn primary" href="${attr(href)}">${enc(action)}</a>` : ""}</div>`;
}
function grid(s, list, opts = {}) {
  const cards = list
    .slice(0, s.limit)
    .map((p) =>
      card(p, s, { progress: opts.progress, reason: opts.reasons?.get(p.id) }),
    )
    .join("");
  return `<div class="paper-grid ${s.layout === "list" ? "list-view" : ""}">${cards}</div>${list.length > s.limit ? `<div class="more-row"><button class="btn subtle" data-act="more">Show more papers <span>(${list.length - s.limit})</span></button></div>` : ""}`;
}
function discover(s) {
  const t = s.route.topic,
    seed = s.data.catalogue.filter(
      (p) => (t || p.id !== "attention") && (!t || p.topics.includes(t)),
    );
  const result = s.resultsFor(t, "Open indexes");
  const list = order(
    unique([
      ...seed,
      ...(result?.papers || []).filter(
        (p) => t && (p.topics.includes(t) || matches(p, t)),
      ),
    ]),
    s.sort,
  );
  const resume = Object.values(s.shelf)
    .filter((e) => e.reading.status === "reading")
    .sort((a, b) => b.readAt - a.readAt)[0];
  return `<main id="folio-main" class="width page">${intro("Discover", "Explore research papers and find your next read.")}${feature(s)}
 ${resume ? `<a class="resume" href="${paperUrl(resume.paper)}"><strong>${icon("book")}Continue reading</strong><span class="resume-title">${enc(resume.paper.title)}</span><small>${Math.round(resume.reading.progress)}%</small>${icon("right", 14)}</a>` : ""}
 <section class="collection"><div class="section-head"><h2>Browse papers</h2>${sortTools(s, "discover")}</div>${topicBar(s, t)}${grid(s, list)}${t ? resultNote(s, t, "Open indexes") : ""}</section></main>`;
}
function resultNote(s, q, source) {
  const key = s.searchKey(q, source),
    r = s.resultsFor(q, source);
  if (!q) return "";
  if (s.searching.has(key))
    return '<p class="index-note" role="status">Searching research indexes…</p>';
  if (s.failures.has(key))
    return `<p class="index-note" role="status">${r ? "Showing cached results." : "Live search is temporarily unavailable."} <button class="text-btn" data-act="retry-search">Retry search</button></p>`;
  return r
    ? `<p class="index-note">${r.providers.length ? "Results from " + enc(r.providers.join(", ")) : ""}</p>`
    : "";
}
function library(s) {
  const f = s.route.status,
    t = s.route.topic,
    all = Object.values(s.shelf).filter(meaningful);
  const list = order(
    all
      .filter((e) => statusMatch(e, f) && (!t || e.paper.topics.includes(t)))
      .sort(
        (a, b) => Math.max(b.readAt, b.savedAt) - Math.max(a.readAt, a.savedAt),
      )
      .map((e) => e.paper),
    s.sort,
  );
  return `<main id="folio-main" class="width page subpage">${intro("My library", "Your saved papers and reading progress.", `<button class="btn subtle library-options" data-act="library-options">${icon("settings", 16)}Library settings</button>`)}
 <div class="shelf-tabs" aria-label="Reading status">${statusLabels.map(([key, label]) => `<a href="${attr(routeUrl("library", { status: key, topic: t }))}" class="${f === key ? "active" : ""}">${label}<small>${all.filter((e) => statusMatch(e, key)).length}</small></a>`).join("")}</div>
 <div class="lib-tools"><span class="sync-label">${icon("cloud", 15)}${enc(s.syncLabel)}</span>${all.length ? sortTools(s, "library") : ""}</div>
 ${all.length ? topicBar(s, t) : ""}${list.length ? grid(s, list, { progress: true }) : empty(all.length ? "No papers in this view" : "Your shelf is ready", all.length ? "Try a different status or topic." : "Bookmark a paper to save it for later. Open one to start tracking your place.", all.length ? "See all papers" : "Discover papers", all.length ? "#library" : "#discover")}</main>`;
}
function forYou(s) {
  const base = recommend(s.data.catalogue, s.shelf),
    remote = s.resultsFor(base.top, "Open indexes");
  const rec = recommend(
    [...s.data.catalogue, ...(remote?.papers || [])],
    s.shelf,
  );
  return `<main class="width page subpage" id="folio-main">${intro("For you", rec.personal ? "Papers selected from the topics and ideas in your library." : "Read or save a paper to start shaping your recommendations.")}
 <h2 class="rec-heading">${icon("spark", 22)}${rec.personal ? "Recommended papers" : "A few places to start"}</h2>${rec.top ? `<p class="rec-topic">Your strongest reading interest is <b>${enc(rec.top)}</b>.</p>` : ""}
 ${
   rec.items.length
     ? grid(
         s,
         rec.items.map((x) => x.p),
         { reasons: new Map(rec.items.map((x) => [x.p.id, x.reason])) },
       )
     : empty(
         "You’re all caught up",
         "Discover another topic to find more papers.",
         "Explore topics",
       )
 }</main>`;
}
function searchForm(s, modal = false) {
  const r = s.route,
    q = modal ? "" : r.q;
  return `<form data-form="search" class="search-form">${icon("find", 20)}<input type="search" name="q" maxlength="200" required autocomplete="off" value="${attr(q)}" placeholder="Paper title, author, DOI, or topic" aria-label="Search query">
 ${s.data.scholar ? `<select name="source" aria-label="Research index"><option ${r.source !== "Google Scholar" ? "selected" : ""}>Open indexes</option><option ${r.source === "Google Scholar" ? "selected" : ""}>Google Scholar</option></select>` : ""}<button class="btn primary" type="submit">Search</button></form>`;
}
function searchPage(s) {
  const r = s.route,
    result = s.resultsFor(r.q, r.source),
    local = unique([
      ...s.data.catalogue,
      ...Object.values(s.shelf).map((e) => e.paper),
    ]).filter((p) => r.q && matches(p, r.q));
  const list = order(
    unique([...local, ...(result?.papers || [])]).filter(
      (p) => !r.topic || p.topics.includes(r.topic),
    ),
    s.sort,
  );
  return `<main class="width page subpage" id="folio-main">${intro("Search papers", "")}${searchForm(s)}${r.q ? `<div class="search-meta">${resultNote(s, r.q, r.source)}<a class="source-link" href="https://scholar.google.com/scholar?q=${encodeURIComponent(r.q)}" target="_blank" rel="noreferrer">Search on Google Scholar${icon("external", 13)}</a></div>` : ""}
 <div class="section-head"><h2>${r.q ? "Results" : "Browse by topic"}</h2>${r.q ? sortTools(s, "search") : ""}</div>${topicBar(s, r.topic)}
 ${list.length ? grid(s, list) : s.searching.has(s.searchKey(r.q, r.source)) ? "" : empty(r.q ? "No matching papers" : "What would you like to read?", r.q ? "Try a shorter title, a broader topic, or a different author." : "Choose a topic above or search by title.")}</main>`;
}
function linkTo(url, text, cls = "source-link") {
  const u = safeLink(url);
  return u
    ? `<a class="${cls}" href="${attr(u)}" target="_blank" rel="noreferrer">${enc(text)}${icon("external", 13)}</a>`
    : "";
}
function reader(s) {
  const p = s.papers.get(s.route.id);
  if (!p)
    return `<main class="width page" id="folio-main">${empty("Finding this paper", s.paperMissing ? "This paper hasn’t been cached on this device. Search for its title or DOI." : "Looking in your library and cached results.", s.paperMissing ? "Search papers" : "", routeUrl("search"))}</main>`;
  const e = s.shelf[p.id],
    ed = s.editions.get(p.id) || overview(p),
    loading = s.readingJobs.has(p.id),
    finished = e?.reading.status === "finished",
    pct = Math.round(e?.reading.progress || 0);
  const hasFull = isFull(ed),
    toc = ed.sections
      .map(
        (sec, i) =>
          `<button data-act="section" data-value="${i}" class="toc-link">${enc(sec.title)}</button>`,
      )
      .join("");
  const status = finished ? "Finished reading" : "Reading progress is saved";
  return `<main id="folio-main" class="reader theme-${s.theme.toLowerCase()}">
 <div class="reader-tools"><div class="width reader-tools-inner"><button class="back" data-act="back">${icon("left", 16)}Back to papers</button><div class="reader-controls"><span id="pct">${pct}% read</span>${saveButton(p, e?.saved, "reader-icon")}<button class="reader-icon type" data-act="appearance" aria-label="Reading appearance">Aa</button></div></div><div class="reading-line"><i style="width:${pct}%"></i></div></div>
 <div class="reader-grid"><aside class="toc"><strong>${icon("list", 16)}Contents</strong><nav aria-label="Article sections">${toc || "<span>Paper details</span>"}</nav></aside><article class="article">
 <header class="article-head color-${cover(p)}"><div class="card-meta"><span class="subject"><i></i>${enc(p.topics[0] || "Research")}</span><span>·</span><span>${enc(p.year)}</span></div><h1>${enc(p.title)}</h1><p class="article-authors">${enc(p.authors.join(", ") || "Author unavailable")}</p><p class="venue">${enc(p.venue)}${p.doi ? " · DOI " + enc(p.doi) : ""}</p>
 <div class="ed-line"><span>${icon("file", 15)}${loading ? enc(s.readingJobs.get(p.id)) : enc(ed.format)}</span>${linkTo(p.htmlUrl || p.pdfUrl || p.url, "Open original")}</div></header>
 ${toc ? `<details class="mobile-toc"><summary>${icon("list", 16)}Contents${icon("down", 14)}</summary><nav>${toc}</nav></details>` : ""}
 <div class="article-text" style="font-size:${s.font}px">${ed.sections.map((sec, i) => `<section data-section="${i}"><h2>${enc(sec.title)}</h2>${sec.paragraphs.map((value) => `<p>${enc(value)}</p>`).join("")}</section>`).join("")}</div>
 ${!hasFull && !loading ? `<aside class="edition-help">${icon("book", 21)}<div><h3>Read the full paper</h3><p>Open the source edition, or reflow a text-based PDF for this screen.</p><div class="actions">${p.pdfUrl || p.arxiv ? '<button class="btn primary" data-act="pdf">Reflow linked PDF</button>' : ""}<button class="btn subtle" data-act="import-pdf">${icon("upload", 15)}Choose PDF</button>${linkTo(p.htmlUrl || p.url, "Original paper")}</div></div></aside>` : ""}
 ${s.readError.get(p.id) ? `<p class="reader-note" role="status">${enc(s.readError.get(p.id))}</p>` : ""}
 ${
   hasFull
     ? `<div class="attribution">${[
         ed.attribution,
         ed.license,
         ed.renderingNote,
       ]
         .filter(Boolean)
         .map((x) => `<p>${enc(x)}</p>`)
         .join(
           "",
         )}${linkTo(ed.source, "Source edition")} ${linkTo(ed.licenseUrl, "Licence")}</div>`
     : ""
 }
 <div class="finish-row"><span>${icon("book", 16)}${status}</span><button data-act="finish" class="btn primary">${icon(finished ? "book" : "check", 16)}${finished ? "Read again" : "Mark as finished"}</button></div></article></div></main>`;
}
function dialogMarkup(s, kind) {
  const close = `<button class="icon-btn" data-act="close" aria-label="Close dialog">${icon("close", 18)}</button>`;
  if (kind === "search")
    return `<div class="dialog-top"><h2>Search papers</h2>${close}</div>${searchForm(s, true)}<div data-suggestions><p class="dialog-label">Browse a topic</p><div class="quick-topics">${s.data.topics.map((t) => `<button data-act="quick" data-value="${attr(t)}">${enc(t)}</button>`).join("")}</div></div>`;
  if (kind === "appearance")
    return `<div class="dialog-top"><h2>Reading appearance</h2>${close}</div><div class="pref-row"><span>Text size</span><div><button class="small-btn" data-act="font" data-value="-2" aria-label="Smaller text" ${s.font <= 16 ? "disabled" : ""}>−</button><b>${s.font}</b><button class="small-btn" data-act="font" data-value="2" aria-label="Larger text" ${s.font >= 28 ? "disabled" : ""}>+</button></div></div><p class="dialog-label">Page colour</p><div class="quick-topics">${["Paper", "White", "Night"].map((t) => `<button data-act="theme" data-value="${t}" aria-pressed="${s.theme === t}" class="swatch s-${t.toLowerCase()}">${t}</button>`).join("")}</div>`;
  return `<div class="dialog-top"><h2>Library settings</h2>${close}</div><p class="dialog-label">Library backup</p><p>Export your saved papers and reading positions. Importing a backup merges it into this library.</p><div class="actions"><button class="btn subtle" data-act="export">Export backup</button><button class="btn subtle" data-act="import-shelf">Import backup</button></div>
 ${s.data.shared ? `<hr><p class="dialog-label">Connect another device</p><p>Use your private library key on your other device to sync. Anyone with the key can access this library.</p><div class="actions"><button class="btn subtle" data-act="copy-key">Copy my library key</button></div><form data-form="pair" class="pair-form"><input name="code" type="password" autocomplete="off" required placeholder="Library key from your other device" aria-label="Library key"><button class="btn primary">Connect</button></form>` : ""}<div role="status" class="dialog-message"></div>`;
}
