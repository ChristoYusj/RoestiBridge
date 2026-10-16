/* Highlighting of difference excerpts + hover card + status pill. Shared by gov, RTS and PDF views. */
(function () {
  const LANG_LABEL = { de: "German", fr: "French", it: "Italian", rm: "Romansh", en: "English" };
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
        <div class="rb-head"><span class="rb-badge rb-sev${d.severity}">${esc(d.type || "difference")} · ${d.severity}/5</span>
          <span class="rb-lang">${esc(LANG_LABEL[d.lang] || d.lang)} version</span></div>
        ${d.b ? `<blockquote class="rb-cite" lang="${esc(d.lang)}">“${esc(d.b)}”</blockquote>`
              : `<blockquote class="rb-cite rb-missing">Not present in the ${esc(LANG_LABEL[d.lang] || d.lang)} version</blockquote>`}
        ${d.source ? `<a class="rb-src" href="${esc(d.source)}" target="_blank" rel="noopener">source ↗</a>` : ""}
        <div class="rb-expl"><b>Inferred explanation</b> <span class="rb-ai">Apertus</span><br>${esc(d.explanation)}</div>
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
      if (!d.a || typeof d.a !== "string") return;
      const id = "d" + Object.keys(registry).length + "_" + i;
      registry[id] = [d];
      if (highlight(root, d.a, { id, severity: d.severity })) shown++;
    });
    return shown;
  }

  let pill = null;
  function status(html, state) {
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "rb-pill";
      document.documentElement.appendChild(pill);
      pill.addEventListener("click", () => pill.classList.toggle("rb-collapsed"));
    }
    pill.dataset.state = state || "info";
    pill.innerHTML = `<span class="rb-logo">RöstiBridge</span> ${html}`;
    return pill;
  }

  window.RBHighlight = { apply, status, highlight, registry, esc };
})();
