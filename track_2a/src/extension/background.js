/* Background: cross-origin fetches, Apertus calls (key never reaches page scripts), cache, PDF interception. */
const MAX_CHARS = 16000;   // per page side, keeps one page ~3-5 API calls
const CHUNK_CHARS = 3500;

async function hash(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function chunkPairs(blocksA, blocksB) {
  const chunks = [];
  let total = 0, start = 0, size = 0;
  const cut = [];
  for (let i = 0; i < blocksA.length && total < MAX_CHARS; i++) {
    size += blocksA[i].length; total += blocksA[i].length;
    if (size >= CHUNK_CHARS) { cut.push([start, i + 1]); start = i + 1; size = 0; }
  }
  const endA = Math.min(blocksA.length, cut.length ? Math.max(cut[cut.length - 1][1], start) : blocksA.length);
  if (start < endA) cut.push([start, endA]);
  const r = blocksB.length / Math.max(1, blocksA.length);
  for (const [i, j] of cut) {
    const bi = Math.max(0, Math.floor(i * r) - 4), bj = Math.min(blocksB.length, Math.ceil(j * r) + 4);
    chunks.push({ a: blocksA.slice(i, j).join("\n"), b: blocksB.slice(bi, bj).join("\n") });
  }
  return chunks;
}

async function compareBlocks(msg) {
  const cfg = await RBEngine.settings();
  const key = "cache:" + (await hash([msg.cacheKey, msg.langA, msg.langB, cfg.model, cfg.explainLang, msg.blocksA.join("|").length].join("~")));
  const hit = await browser.storage.local.get(key);
  if (hit[key]) return { differences: hit[key], cached: true };
  const chunks = chunkPairs(msg.blocksA, msg.blocksB);
  const out = [];
  // small concurrency to be gentle with the shared endpoint
  for (let k = 0; k < chunks.length; k += 3) {
    const part = await Promise.all(chunks.slice(k, k + 3).map((c) => RBEngine.compare(c.a, c.b, msg.langA, msg.langB)));
    part.forEach((d) => out.push(...d));
  }
  await browser.storage.local.set({ [key]: out });
  return { differences: out, cached: false, chunks: chunks.length };
}

async function fetchText(url) {
  const r = await fetch(url, { credentials: "omit", redirect: "follow" });
  return { ok: r.ok, status: r.status, url: r.url, contentType: r.headers.get("content-type") || "", text: r.ok ? await r.text() : "" };
}

const decodeEntities = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/* SRF's own search is rendered client-side, so look the story up through a news-search RSS feed
   restricted to srf.ch (Bing News), with DuckDuckGo HTML as a fallback. */
/* Try the most specific query first, then broader ones, until enough candidates are found. */
async function srfSearch(queries) {
  const list = (Array.isArray(queries) ? queries : [queries]).filter(Boolean);
  const all = [], seen = new Set();
  for (const q of list) {
    for (const r of (await srfSearchOne(q)).results) if (!seen.has(r.url)) { seen.add(r.url); all.push(r); }
    if (all.length >= 4) break;
  }
  return { results: all.slice(0, 8), searchUrl: "https://www.srf.ch/suche?q=" + encodeURIComponent(list[0] || "") };
}

async function srfSearchOne(query) {
  const results = [], seen = new Set();
  const add = (url, title) => {
    if (!/^https:\/\/www\.srf\.ch\/(news|kultur|wissen|sport|meteo|play|audio)\//.test(url) || seen.has(url)) return;
    seen.add(url);
    results.push({ url, title: decodeEntities(title || "").trim().slice(0, 180) });
  };
  try {
    const rss = await fetchText("https://www.bing.com/news/search?format=rss&setlang=de&mkt=de-CH&q=" + encodeURIComponent("site:srf.ch " + query));
    for (const item of rss.text.split("<item>").slice(1)) {
      const t = (item.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
      const l = (item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
      const u = (decodeEntities(l).match(/[?&]url=([^&]+)/) || [])[1];
      if (u) add(decodeURIComponent(u), t);
    }
  } catch (e) { /* fall through */ }
  if (results.length < 2) {
    try {
      const ddg = await fetchText("https://html.duckduckgo.com/html/?q=" + encodeURIComponent("site:srf.ch " + query));
      const re = /uddg=([^&"]+)[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(ddg.text))) add(decodeURIComponent(m[1]), m[2].replace(/<[^>]+>/g, ""));
    } catch (e) { /* ignore */ }
  }
  return { results: results.slice(0, 6), searchUrl: "https://www.srf.ch/suche?q=" + encodeURIComponent(query) };
}

async function germanQuery(title) {
  const cfg = await RBEngine.settings();
  const msgs = [
    { role: "system", content: "You translate Swiss news headlines. Answer with JSON only." },
    { role: "user", content: 'Translate this RTS (French) headline into German. Then give 3 short news-search queries for finding the same story on SRF, from most to least specific; each query is 1-3 words, proper names (people, places, organisations) first, no punctuation. JSON: {"title_de": "...", "queries": ["...", "...", "..."]}\n\nHeadline: ' + title }
  ];
  const content = await RBEngine.chat(msgs, cfg);
  try {
    const j = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
    j.queries = (Array.isArray(j.queries) ? j.queries : [j.keywords || j.title_de]).map((q) => String(q).replace(/[,;:"«»]/g, " ").trim()).filter(Boolean);
    return j;
  } catch (e) { return { title_de: "", queries: [title] }; }
}

/* Ask Apertus which SRF candidate covers the same story as the RTS headline (or none). */
async function pickSameStory(titleFr, candidates) {
  if (!candidates.length) return { index: -1 };
  const cfg = await RBEngine.settings();
  const content = await RBEngine.chat([
    { role: "system", content: "You match Swiss news stories across languages. Answer with JSON only." },
    { role: "user", content: `RTS headline (French): ${titleFr}\n\nSRF articles (German):\n` + candidates.map((c, i) => `${i + 1}. ${c.title}`).join("\n") +
      '\n\nWhich SRF article reports the SAME specific event (same actors, same news)? A merely related topic does not count. If none clearly matches, answer 0. JSON: {"number": <number or 0>}' }
  ], cfg);
  try { return { index: Number(JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).number) - 1 }; } catch (e) { return { index: -1 }; }
}

/* Sites with translated slugs and a JS-only language switcher (new admin.ch CMS): list the page
   paths found on both language homepages and let Apertus pick the counterpart of this path. */
function orderedPaths(html, lang) {
  const re = new RegExp(`["'](/${lang}/[a-z0-9][a-z0-9-/]*)["'#?]`, "g");
  const out = [];
  let m;
  while ((m = re.exec(html))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

async function findCounterpart(msg) {
  const u = new URL(msg.url);
  const [ha, hb] = await Promise.all([fetchText(`${u.origin}/${msg.langA}`), fetchText(`${u.origin}/${msg.langB}`)]);
  const a = orderedPaths(ha.text + (msg.pageHtml || ""), msg.langA), b = orderedPaths(hb.text, msg.langB);
  if (!b.length) return { url: null };
  const idx = a.indexOf(u.pathname.replace(/\/$/, ""));
  const lo = idx < 0 ? 0 : Math.max(0, idx - 40);
  const cands = b.slice(lo, lo + 120);
  const cfg = await RBEngine.settings();
  const content = await RBEngine.chat([
    { role: "system", content: "You match pages across language versions of a Swiss government website. Answer with JSON only." },
    { role: "user", content: `The URL slug "${u.pathname}" (${msg.langA}, page title "${msg.title || ""}") was translated into ${msg.langB}. ` +
      `Below are numbered ${msg.langB} URL slugs of the same website. Translate the slug's words and pick the number of the slug with the same meaning.\n\n` +
      cands.map((c, i) => `${i + 1}. ${c}`).join("\n") + `\n\nJSON: {"number": <number>, "confidence": "high|low"}` }
  ], cfg);
  let path = null;
  try {
    const j = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
    path = cands[Number(j.number) - 1] || null;
  } catch (e) { /* ignore */ }
  if (!path) return { url: null };
  return { url: u.origin + path };
}

/* parlament.ch names each language's PDF differently (/centers/documents/de/<German title>.pdf).
   OpenParlData links all documents of an affair, so: file name -> affair -> sibling docs -> Apertus picks the translation. */
const OPD = "https://api.openparldata.ch/v1/docs";
async function findPdfCounterpart(msg) {
  const name = decodeURIComponent(msg.url.split("?")[0].split("/").pop()).replace(/\.pdf$/i, "");
  const probe = await (await fetch(`${OPD}?body_key=CHE&limit=5&name=${encodeURIComponent(name.slice(0, 60))}`)).json();
  const hit = (probe.data || []).find((d) => d.affair_id);
  if (!hit) return { url: null, reason: "document not found in OpenParlData" };
  const sib = await (await fetch(`${OPD}?affair_id=${hit.affair_id}&limit=200`)).json();
  const cands = (sib.data || []).filter((d) => d.name && d.name !== hit.name && /pdf/i.test((d.format || "") + d.url)).slice(0, 80);
  if (!cands.length) return { url: null, reason: "no sibling documents" };
  const cfg = await RBEngine.settings();
  const content = await RBEngine.chat([
    { role: "system", content: "You match parliamentary documents across languages. Answer with JSON only." },
    { role: "user", content: `Document (${msg.langA}): "${name}"\n\nWhich of these documents is its ${msg.langB} translation (the same document, not a related one)?\n` +
      cands.map((d, i) => `${i + 1}. ${d.name}`).join("\n") + '\n\nJSON: {"number": <number or 0 if none>}' }
  ], cfg);
  let i = -1;
  try { i = Number(JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)).number) - 1; } catch (e) { /* ignore */ }
  if (i < 0 || !cands[i]) return { url: null, reason: "no translation listed" };
  return { url: cands[i].url, name: cands[i].name, affair: hit.affair_id };
}

browser.runtime.onMessage.addListener((msg) => {
  const run = {
    findCounterpart: () => findCounterpart(msg),
    openOptions: () => browser.runtime.openOptionsPage().then(() => ({})),
    compareBlocks: () => compareBlocks(msg),
    fetchText: () => fetchText(msg.url),
    srfSearch: () => srfSearch(msg.query),
    germanQuery: () => germanQuery(msg.title),
    pickSameStory: () => pickSameStory(msg.title, msg.candidates),
    findPdfCounterpart: () => findPdfCounterpart(msg),
    settings: () => RBEngine.settings().then((s) => ({ enabled: s.enabled, hasKey: !!s.apiKey, explainLang: s.explainLang }))
  }[msg.type];
  if (!run) return undefined;
  return run().catch((e) => ({ error: String(e.message || e) }));
});

/* Parliamentary PDFs opened from an official site -> open in the RöstiBridge PDF viewer. */
function isOfficial(u) {
  try { return !!RBSites.classify(new URL(u).hostname); } catch (e) { return false; }
}
browser.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.type !== "main_frame" || d.method !== "GET") return {};
    const ct = (d.responseHeaders.find((h) => h.name.toLowerCase() === "content-type") || {}).value || "";
    const looksPdf = /application\/pdf/i.test(ct) || /\.pdf(\?|$)/i.test(d.url);
    if (!looksPdf) return {};
    if (!(isOfficial(d.url) || (d.originUrl && isOfficial(d.originUrl)))) return {};
    if (/[?&]rb=off\b/.test(d.url)) return {};
    return { redirectUrl: browser.runtime.getURL("pdf/viewer.html") + "?file=" + encodeURIComponent(d.url) };
  },
  { urls: ["*://*.ch/*", "*://*.swiss/*"], types: ["main_frame"] },
  ["blocking", "responseHeaders"]
);
