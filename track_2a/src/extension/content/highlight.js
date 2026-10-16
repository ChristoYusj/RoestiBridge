/* Highlighting of difference excerpts + hover card + status pill. Shared by gov, RTS and PDF views. */
(function () {
  /* Hover-card wording follows the "Explanations in" setting (setLang). */
  const UI = {
    en: { lang: { de: "German", fr: "French", it: "Italian", rm: "Romansh", en: "English" }, version: (l) => `${l} version`,
      missing: (l) => `Not present in the ${l} version`, source: "source", expl: "Inferred explanation", diff: "difference",
      types: { omission: "omission", addition: "addition", number: "number", scope: "scope", term: "term", nuance: "nuance" } },
    de: { lang: { de: "Deutsch", fr: "Französisch", it: "Italienisch", rm: "Rätoromanisch", en: "Englisch" }, version: (l) => `Fassung ${l}`,
      missing: (l) => `Fehlt in der Fassung ${l}`, source: "Quelle", expl: "Abgeleitete Erklärung", diff: "Unterschied",
      types: { omission: "Auslassung", addition: "Ergänzung", number: "Zahl", scope: "Tragweite", term: "Begriff", nuance: "Nuance" } },
    fr: { lang: { de: "allemand", fr: "français", it: "italien", rm: "romanche", en: "anglais" }, version: (l) => `Version ${l}`,
      missing: (l) => `Absent de la version ${l}`, source: "source", expl: "Explication déduite", diff: "différence",
      types: { omission: "omission", addition: "ajout", number: "chiffre", scope: "portée", term: "terme", nuance: "nuance" } },
    it: { lang: { de: "tedesco", fr: "francese", it: "italiano", rm: "romancio", en: "inglese" }, version: (l) => `Versione ${l}`,
      missing: (l) => `Assente nella versione ${l}`, source: "fonte", expl: "Spiegazione dedotta", diff: "differenza",
      types: { omission: "omissione", addition: "aggiunta", number: "numero", scope: "portata", term: "termine", nuance: "sfumatura" } }
  };
  let ui = UI.en;
  const langLabel = (l) => ui.lang[l] || l;
  function setLang(l) { ui = UI[l] || UI.en; }
  const norm = (s) => s.replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»„]/g, '"').replace(/\s+/g, " ").toLowerCase();

  function textNodes(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !n.parentElement.closest("script,style,noscript,.rb-tip,.rb-pill,mark.rb-mark") && n.nodeValue.trim()
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    const out = [];
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }

  /* Wrap every occurrence of `needle` in <mark>. Matching ignores ALL whitespace and quote style,
     so it works across inline tags and across pdf.js text-layer spans (which carry no spaces). */
  function highlight(root, needle, data) {
    const nodes = textNodes(root);
    let flat = "";
    const map = [];          // flat index -> [node, offset]
    for (const n of nodes) {
      const v = n.nodeValue;
      for (let i = 0; i < v.length; i++) {
        if (/\s/.test(v[i])) continue;
        flat += v[i];
        map.push([n, i]);
      }
    }
    const hay = norm(flat), pin = norm(needle).replace(/ /g, "");
    if (pin.length < 3) return 0;
    let idx = hay.indexOf(pin), count = 0;
    const ranges = [];
    while (idx !== -1 && count < 3) {
      ranges.push([idx, idx + pin.length - 1]);
      idx = hay.indexOf(pin, idx + pin.length);
      count++;
    }
    // wrap from last to first so earlier offsets stay valid
    for (const [s, e] of ranges.reverse()) wrapRange(map, s, e, data);
    return ranges.length;
  }

  function wrapRange(map, s, e, data) {
    const segs = new Map();
    for (let k = s; k <= e; k++) {
      const [n, off] = map[k];
      const seg = segs.get(n) || [off, off];
      seg[0] = Math.min(seg[0], off); seg[1] = Math.max(seg[1], off);
      segs.set(n, seg);
    }
    for (const [n, [a, b]] of [...segs.entries()].reverse()) {
      if (!n.parentNode) continue;
      const range = document.createRange();
      range.setStart(n, a); range.setEnd(n, b + 1);
      const mark = document.createElement("mark");
      mark.className = "rb-mark rb-sev" + data.severity;
      mark.dataset.rb = data.id;
      try { range.surroundContents(mark); } catch (err) { /* partial overlap with existing mark */ }
    }
  }

  let tip = null;
  const registry = {};

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.className = "rb-tip";
    tip.setAttribute("role", "tooltip");
    document.documentElement.appendChild(tip);
    tip.addEventListener("mouseleave", () => (tip.style.display = "none"));
    return tip;
  }

  function esc(s) { return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function show(mark) {
    const items = registry[mark.dataset.rb];
    if (!items) return;
    const t = ensureTip();
    t.innerHTML = items.map((d) => `
      <div class="rb-entry">
        <div class="rb-head"><span class="rb-badge rb-sev${d.severity}">${esc(ui.types[String(d.type || "").toLowerCase()] || d.type || ui.diff)} · ${d.severity}/5</span>
          <span class="rb-lang">${esc(ui.version(langLabel(d.lang)))}</span></div>
        ${d.b ? `<div class="rb-cite" lang="${esc(d.lang)}">“${esc(d.b)}”</div>`
              : `<div class="rb-cite rb-missing">${esc(ui.missing(langLabel(d.lang)))}</div>`}
        ${d.source ? `<a class="rb-src" href="${esc(d.source)}" target="_blank" rel="noopener">${esc(ui.source)} ↗</a>` : ""}
        <div class="rb-expl"><b>${esc(ui.expl)}</b> <span class="rb-ai">Apertus</span><br>${esc(d.explanation)}</div>
      </div>`).join("");
    const r = mark.getBoundingClientRect();
    t.style.display = "block";
    const top = r.bottom + window.scrollY + 6;
    const left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - 380);
    t.style.top = top + "px";
    t.style.left = Math.max(8, left) + "px";
  }

  document.addEventListener("mouseover", (e) => {
    const m = e.target.closest && e.target.closest("mark.rb-mark");
    if (m) show(m);
    else if (tip && !e.target.closest(".rb-tip")) tip.style.display = "none";
  });

  /* Apply a list of differences ({a,b,explanation,severity,type,lang,source}) under root. */
  function apply(root, diffs) {
    let shown = 0;
    diffs.forEach((d, i) => {
      const id = "d" + Object.keys(registry).length + "_" + i;
      const a = typeof d.a === "string" ? d.a : "", b = typeof d.b === "string" ? d.b : "";
      const mark = (text, entry) => { registry[id] = [entry]; return highlight(root, text, { id, severity: d.severity }) > 0; };
      // 1) the excerpt as quoted
      if (a && mark(a, d)) { shown++; return; }
      // 2) the model quoted the two sides the wrong way round: the "other" excerpt is on this page
      if (b && mark(b, Object.assign({}, d, { a: b, b: a }))) { shown++; return; }
      // 3) long excerpts that were paraphrased slightly: anchor on their first / last words
      for (const part of anchors(a)) if (mark(part, d)) { shown++; return; }
      delete registry[id];
    });
    return shown;
  }

  /* First and last 6-word windows of a long excerpt (each at least 20 characters), so a slightly
     paraphrased quote still lands on the right passage instead of being dropped. */
  function anchors(text) {
    const w = text.split(/\s+/).filter(Boolean);
    if (w.length < 8) return [];
    return [w.slice(0, 6).join(" "), w.slice(-6).join(" ")].filter((s) => s.length >= 20);
  }

  let pill = null;
  function status(html, state) {
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "rb-pill";
      document.documentElement.appendChild(pill);
      pill.addEventListener("click", (e) => {
        if (e.target.closest(".rb-x")) pill.remove();
        else if (e.target.closest(".rb-logo")) pill.classList.toggle("rb-collapsed");
      });
    }
    pill.dataset.state = state || "info";
    pill.innerHTML = `<span class="rb-logo" title="Show / hide details">RöstiBridge</span>`
      + `<span class="rb-msg">${state === "busy" ? '<span class="rb-spin"></span>' : ""}${html}</span>`
      + `<button class="rb-x" type="button" title="Close" aria-label="Close">×</button>`;
    return pill;
  }

  window.RBHighlight = { apply, status, highlight, registry, esc, setLang };
})();
