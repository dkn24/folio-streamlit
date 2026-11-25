export default function (component) {
  const root = component.parentElement.querySelector(".folio-root");
  if (!root) return;
  if (root.folio) {
    root.folio.receive(component);
    return;
  }
  const s = {
    data: component.data,
    component,
    route: routeFrom(location.hash),
    last: "#discover",
    spot: 0,
    limit: 9,
    sort: "default",
    layout: localGet("layout", "grid"),
    font: localGet("font", 20),
    theme: localGet("theme", "Paper"),
    shelf: localGet("shelf", {}),
    papers: new Map(),
    editions: new Map(Object.entries(component.data.bundled)),
    results: new Map(),
    failures: new Set(),
    searching: new Set(),
    readingJobs: new Map(),
    readError: new Map(),
    syncLabel: "Saved on this device",
    code: localGet("code", "") || makeSecret(),
    syncing: false,
    paperMissing: false,
  };
  localSet("code", s.code);
  const queue = [],
    watch = new AbortController();
  let busy = null,
    serial = 0,
    toastTimer,
    syncTimer,
    positionTimer,
    restoring = false;
  s.searchKey = (q, src) => src + "|" + q.toLowerCase().trim();
  s.resultsFor = (q, src) => s.results.get(s.searchKey(q, src));
  function register(p) {
    if (validPaper(p) && !s.papers.has(p.id)) s.papers.set(p.id, p);
  }
  s.data.catalogue.forEach(register);
  Object.values(s.shelf)
    .filter(validEntry)
    .forEach((e) => register(e.paper));
  function request(kind, args) {
    return new Promise((resolve, reject) => {
      queue.push({
        event: { id: Date.now() + "-" + ++serial, kind, ...args },
        resolve,
        reject,
      });
      pump();
    });
  }
  function pump() {
    if (busy || !queue.length) return;
    busy = queue.shift();
    s.component.setTriggerValue("request", busy.event);
  }
  function receive(c) {
    s.component = c;
    const r = c.data.reply;
    if (busy && r?.id === busy.event.id) {
      const job = busy;
      busy = null;
      if (r.error) job.reject(Error(r.error));
      else job.resolve(r.value);
      queueMicrotask(pump);
    }
  }
  root.folio = { receive };
  function msg(t) {
    const o = root.querySelector(".notice");
    if (o) {
      o.textContent = t;
      o.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (o.hidden = true), 2700);
    }
  }
  function save() {
    if (!localSet("shelf", s.shelf))
      s.syncLabel = "Browser storage is full · export a backup";
    if (s.data.shared) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(sync, 1500);
    }
  }
  function change(p, fn) {
    const e = s.shelf[p.id] || blank(p);
    fn(e);
    s.shelf[p.id] = e;
    save();
  }
  const synced = new Map();
  async function sync() {
    if (!s.data.shared || s.syncing) return;
    s.syncing = true;
    const code = s.code;
    try {
      const dirty = Object.values(s.shelf)
        .filter((e) => synced.get(e.paper.id) !== signature(e))
        .slice(0, 24);
      const out = await request("sync", { code, entries: dirty });
      if (code !== s.code) return;
      for (const e of out.filter(validEntry)) {
        s.shelf[e.paper.id] = merge(s.shelf[e.paper.id], e);
        synced.set(e.paper.id, signature(e));
        register(e.paper);
      }
      localSet("shelf", s.shelf);
      s.syncLabel = "Synced across devices";
      if (s.route.page === "library") render();
      if (
        Object.values(s.shelf).some(
          (e) => synced.get(e.paper.id) !== signature(e),
        )
      )
        syncTimer = setTimeout(sync, 300);
    } catch {
      s.syncLabel = "Saved locally · sync pending";
      syncTimer = setTimeout(sync, 30000);
    } finally {
      s.syncing = false;
    }
  }
  function signature(e) {
    return e.savedAt + "/" + e.readAt;
  }
  async function lookup(q, source, force = false) {
    if (!q) return;
    const key = s.searchKey(q, source);
    if (s.searching.has(key) || (!force && s.results.has(key))) return;
    s.searching.add(key);
    s.failures.delete(key);
    render();
    try {
      let r = await cacheGet("search:" + key);
      if (r) {
        s.results.set(key, r);
        r.papers.forEach(register);
      }
      if (force || !r || Date.now() - r.at > 21600000) {
        r = await request("search", { q, source });
        r.at = Date.now();
        s.results.set(key, r);
        r.papers.forEach((p) => {
          register(p);
          cachePut("p:" + p.id, p);
        });
        cachePut("search:" + key, r);
      }
    } catch {
      s.failures.add(key);
    } finally {
      s.searching.delete(key);
      if (s.route.page !== "paper") render();
    }
  }
  function viewport() {
    return root.closest('[data-testid="stMain"]') || document.scrollingElement;
  }
  function move(y) {
    viewport().scrollTo({ top: y, behavior: "instant" });
  }
  function capture() {
    if (restoring || s.route.page !== "paper") return;
    const p = s.papers.get(s.route.id),
      ed = s.editions.get(p?.id);
    if (!p || !isFull(ed) || s.shelf[p.id]?.reading.status === "finished")
      return;
    const nodes = [...root.querySelectorAll("[data-section]")];
    if (!nodes.length) return;
    const line = 120;
    let i = 0;
    for (let k = 0; k < nodes.length; k++) {
      if (nodes[k].getBoundingClientRect().top <= line) i = k;
      else break;
    }
    const rect = nodes[i].getBoundingClientRect(),
      fraction = Math.min(
        1,
        Math.max(0, (line - rect.top) / Math.max(1, rect.height)),
      ),
      ratio = (i + fraction) / nodes.length;
    change(p, (e) => {
      e.readAt = stamp(e.readAt);
      e.reading.position = { section: i, fraction, ratio, edition: ed.format };
      e.reading.progress = Math.max(
        e.reading.progress,
        Math.min(99, Math.round(100 * ratio)),
      );
    });
    const pct = s.shelf[p.id].reading.progress;
    root.querySelector("#pct").textContent = pct + "% read";
    root.querySelector(".reading-line i").style.width = pct + "%";
  }
  function restore() {
    const p = s.shelf[s.route.id]?.reading.position;
    if (!p?.ratio || p.edition !== s.editions.get(s.route.id)?.format) return;
    const n = root.querySelector(
      '[data-section="' + Math.floor(p.section) + '"]',
    );
    if (n) {
      restoring = true;
      const rect = n.getBoundingClientRect();
      move(viewport().scrollTop + rect.top + rect.height * p.fraction - 120);
      requestAnimationFrame(() => {
        restoring = false;
      });
    }
  }
  async function loadPaper(id) {
    let p = s.papers.get(id);
    if (!p) {
      p = await cacheGet("p:" + id);
      if (s.route.id !== id) return;
      if (p) register(p);
      else {
        s.paperMissing = true;
        render();
        return;
      }
    }
    if (!s.shelf[id] || s.shelf[id].reading.status === "unread")
      change(p, (e) => {
        e.reading.status = "reading";
        e.readAt = stamp(e.readAt);
      });
    if (!s.editions.has(id) && !s.readingJobs.has(id)) {
      s.readingJobs.set(id, "Finding reader text…");
      render();
      try {
        let ed = await cacheGet("ed:" + id);
        if (!storedEd(ed)) {
          ed = await request("edition", { paper: p });
          if (isFull(ed)) cachePut("ed:" + id, ed);
        }
        s.editions.set(id, ed);
      } catch {
        s.editions.set(id, overview(p));
      } finally {
        s.readingJobs.delete(id);
      }
    }
    if (s.route.id === id) {
      render();
      requestAnimationFrame(restore);
    }
  }
  async function pdf(file) {
    const p = s.papers.get(s.route.id);
    if (!p || s.readingJobs.has(p.id)) return;
    s.readingJobs.set(p.id, "Reflowing PDF…");
    s.readError.delete(p.id);
    render();
    try {
      let args = { paper: p };
      if (file) {
        if (file.size > 16000000) throw Error("Choose a PDF under 16 MB.");
        args.file = await new Promise((yes, no) => {
          const fr = new FileReader();
          fr.onload = () => yes(fr.result.split(",")[1]);
          fr.onerror = no;
          fr.readAsDataURL(file);
        });
      }
      const ed = await request(file ? "import" : "pdf", args);
      s.editions.set(p.id, ed);
      await cachePut("ed:" + p.id, ed);
    } catch (e) {
      s.readError.set(p.id, e.message || "Unable to read the PDF.");
    } finally {
      s.readingJobs.delete(p.id);
      if (s.route.id === p.id) render();
    }
  }
  function refresh() {
    const r = s.route;
    if (r.page === "paper") loadPaper(r.id);
    if (r.page === "discover" && r.topic) lookup(r.topic, "Open indexes");
    if (r.page === "search") lookup(r.q, r.source);
    if (r.page === "for-you")
      lookup(recommend(s.data.catalogue, s.shelf).top, "Open indexes");
  }
  function navigate(hash) {
    if (hash === location.hash) return;
    location.hash = hash;
  }
  function applyRoute() {
    if (!root.isConnected) {
      watch.abort();
      return;
    }
    clearTimeout(positionTimer);
    capture();
    if (s.route.page !== "paper") s.last = s.hash || "#discover";
    s.hash = location.hash;
    s.route = routeFrom(s.hash);
    s.sort = s.route.page === "library" ? "recent" : "default";
    s.limit = 9;
    s.paperMissing = false;
    render();
    move(0);
    refresh();
  }
  function render() {
    const r = s.route;
    const main =
      r.page === "paper"
        ? reader(s)
        : r.page === "library"
          ? library(s)
          : r.page === "for-you"
            ? forYou(s)
            : r.page === "search"
              ? searchPage(s)
              : discover(s);
    root.className = "folio-root" + (r.page === "paper" ? " in-reader" : "");
    root.innerHTML =
      '<header class="site-header"><div class="width header-inner"><a class="brand" href="#discover" aria-label="Folio home">' +
      brand() +
      '</a><nav class="desktop-nav">' +
      nav(r.page) +
      '</nav><button class="header-search" data-act="search" aria-label="Search papers">' +
      icon("find") +
      " Search papers… <kbd>/</kbd></button></div></header>" +
      main +
      (r.page !== "paper"
        ? '<footer class="width">Folio · Research reading room</footer>'
        : "") +
      '<nav class="mobile-nav">' +
      nav(r.page) +
      '</nav><dialog aria-label="Folio settings or search"></dialog><output class="notice" hidden></output><input type="file" hidden data-file="pdf" accept=".pdf,application/pdf"><input type="file" hidden data-file="backup" accept=".json,application/json">';
  }
  function dialog(kind) {
    const d = root.querySelector("dialog");
    d.innerHTML = dialogMarkup(s, kind);
    if (!d.open) d.showModal();
    d.querySelector("input[name=q]")?.focus();
  }
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act,
      v = b.dataset.value,
      r = s.route,
      p = s.papers.get(b.dataset.id || r.id);
    if (a === "save" && p) {
      change(p, (x) => {
        x.saved = !x.saved;
        x.savedAt = stamp(x.savedAt);
      });
      render();
      msg(s.shelf[p.id].saved ? "Saved to your library" : "Bookmark removed");
    } else if (a === "spot-next" || a === "spot-back") {
      s.spot = (s.spot + (a === "spot-next" ? 1 : 2)) % 3;
      render();
    } else if (a === "topic") {
      const pg =
        r.page === "search"
          ? "search"
          : r.page === "library"
            ? "library"
            : "discover";
      navigate(
        routeUrl(pg, {
          topic: r.page === "search" && !r.q ? "" : v,
          status: r.status,
          q: r.page === "search" ? r.q || v : "",
          source:
            pg === "search" && r.source === "Google Scholar" ? r.source : "",
        }),
      );
    } else if (a === "layout") {
      s.layout = v;
      localSet("layout", v);
      render();
    } else if (a === "more") {
      s.limit += 12;
      render();
    } else if (a === "back") navigate(s.last);
    else if (a === "search" || a === "library-options" || a === "appearance")
      dialog(a);
    else if (a === "close") root.querySelector("dialog").close();
    else if (a === "quick") {
      root.querySelector("dialog").close();
      navigate(routeUrl("search", { q: v }));
    } else if (a === "retry-search") lookup(r.q || r.topic, r.source, true);
    else if (a === "section") {
      const n = root.querySelector('[data-section="' + Number(v) + '"]');
      b.closest("details")?.removeAttribute("open");
      if (n) {
        n.scrollIntoView({ block: "start" });
        capture();
      }
    } else if (a === "finish" && p) {
      change(p, (x) => {
        const done = x.reading.status === "finished";
        x.reading = {
          status: done ? "reading" : "finished",
          progress: done ? 0 : 100,
          position: done ? start() : x.reading.position,
        };
        x.readAt = stamp(x.readAt);
      });
      render();
      move(0);
    } else if (a === "pdf") pdf();
    else if (a === "import-pdf")
      root.querySelector('[data-file="pdf"]').click();
    else if (a === "import-shelf")
      root.querySelector('[data-file="backup"]').click();
    else if (a === "font" || a === "theme") {
      capture();
      if (a === "font") {
        s.font = Math.max(16, Math.min(28, s.font + Number(v)));
        localSet("font", s.font);
      } else {
        s.theme = v;
        localSet("theme", v);
      }
      render();
      restore();
      dialog("appearance");
    } else if (a === "export") {
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                format: "folio-library-v1",
                entries: Object.values(s.shelf).filter(meaningful),
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "folio-library.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } else if (a === "copy-key") {
      try {
        await navigator.clipboard.writeText(s.code);
        root.querySelector(".dialog-message").textContent =
          "Private library key copied.";
      } catch {
        const el = document.createElement("input");
        el.readOnly = true;
        el.value = s.code;
        root.querySelector(".dialog-message").replaceChildren(el);
        el.select();
      }
    }
  });
  root.addEventListener("submit", (e) => {
    const f = e.target.closest("form");
    if (!f) return;
    e.preventDefault();
    const vals = new FormData(f);
    if (f.dataset.form === "search") {
      const q = String(vals.get("q") || "").trim();
      if (!q) return;
      root.querySelector("dialog[open]")?.close();
      navigate(
        routeUrl("search", {
          q,
          source:
            vals.get("source") === "Google Scholar" ? "Google Scholar" : "",
        }),
      );
    } else if (f.dataset.form === "pair") {
      const key = String(vals.get("code") || "").trim();
      if (!/^[\w-]{43}$/.test(key)) {
        root.querySelector(".dialog-message").textContent =
          "Enter the full library key.";
        return;
      }
      s.code = key;
      localSet("code", key);
      synced.clear();
      root.querySelector("dialog").close();
      sync();
    }
  });
  root.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.change === "sort") {
      s.sort = t.value;
      render();
    }
    if (!t.files?.length) return;
    if (t.dataset.file === "pdf") pdf(t.files[0]);
    else if (t.dataset.file === "backup") {
      try {
        const file = t.files[0];
        if (file.size > 12000000) throw Error();
        const data = JSON.parse(await file.text());
        if (
          data.format !== "folio-library-v1" ||
          !Array.isArray(data.entries) ||
          !data.entries.every(validEntry)
        )
          throw Error();
        for (const x of data.entries) {
          s.shelf[x.paper.id] = merge(s.shelf[x.paper.id], x);
          register(x.paper);
        }
        save();
        render();
        msg("Backup imported.");
      } catch {
        msg("Choose a valid Folio backup.");
      }
    }
  });
  const options = { signal: watch.signal };
  window.addEventListener("hashchange", applyRoute, options);
  document.addEventListener(
    "keydown",
    (e) => {
      if (
        e.key === "/" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName) &&
        root.isConnected
      ) {
        e.preventDefault();
        dialog("search");
      }
    },
    options,
  );
  viewport().addEventListener(
    "scroll",
    () => {
      if (s.route.page === "paper" && !restoring) {
        clearTimeout(positionTimer);
        positionTimer = setTimeout(capture, 180);
      }
    },
    { passive: true, signal: watch.signal },
  );
  window.addEventListener("pagehide", capture, options);
  window.addEventListener(
    "storage",
    (e) => {
      if (e.key === "folio.st.v1.shelf" && e.newValue) {
        try {
          for (const x of Object.values(JSON.parse(e.newValue)).filter(
            validEntry,
          )) {
            s.shelf[x.paper.id] = merge(s.shelf[x.paper.id], x);
            register(x.paper);
          }
          if (s.route.page !== "paper") render();
        } catch {}
      }
    },
    options,
  );
  render();
  if (s.data.shared && s.route.page === "paper") {
    sync().finally(refresh);
  } else {
    refresh();
    if (s.data.shared) sync();
  }
  receive(component);
}
