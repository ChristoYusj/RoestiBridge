/* PDF viewer for parliamentary documents: render with pdf.js, find the other-language PDF, highlight differences. */
import * as pdfjsLib from "./lib/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = browser.runtime.getURL("pdf/lib/pdf.worker.min.mjs");

const params = new URLSearchParams(location.search);
const file = params.get("file");
const $ = (id) => document.getElementById(id);
const state = (t) => ($("state").textContent = t);

$("name").textContent = decodeURIComponent(file.split("/").pop().split("?")[0]);
$("orig").href = file + (file.includes("?") ? "&" : "?") + "rb=off";

const LANG_CODES = { de: ["de", "d", "deu", "ger"], fr: ["fr", "f", "fra", "fre"], it: ["it", "i", "ita"] };

/* Parliament PDFs encode the language in the path or file name: /de/ , _d.pdf , -f.pdf , lang=fr ... */
function guessLang(url) {
  const u = url.toLowerCase();
  for (const [l, codes] of Object.entries(LANG_CODES)) {
    for (const c of codes) {
      if (new RegExp(`[/_\\-.=]${c}([/_\\-.]|\\.pdf|$)`).test(u)) return l;
    }
  }
  return null;
}

function candidates(url, from, to) {
  const out = new Set();
  const pairs = [[from, to], [from[0], to[0]], [from.toUpperCase(), to.toUpperCase()], [from[0].toUpperCase(), to[0].toUpperCase()]];
  const seps = (a, b) => [[`/${a}/`, `/${b}/`], [`_${a}.`, `_${b}.`], [`-${a}.`, `-${b}.`], [`=${a}`, `=${b}`], [`_${a}_`, `_${b}_`], [`-${a}-`, `-${b}-`]];
  for (const [a, b] of pairs) {
    // all occurrences at once first (e.g. Fedlex: /fr/pdf-a/...-fr-pdf-a.pdf), then one pattern at a time
    let all = url;
    for (const [pa, pb] of seps(a, b)) all = all.split(pa).join(pb);
    out.add(all);
    for (const [pa, pb] of seps(a, b)) if (url.includes(pa)) out.add(url.split(pa).join(pb));
  }
  return [...out].filter((u) => u !== url);
}

async function load(url) {
  const r = await fetch(url, { credentials: "omit" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const ct = r.headers.get("content-type") || "";
  const buf = await r.arrayBuffer();
  if (!/pdf/i.test(ct) && new TextDecoder().decode(buf.slice(0, 5)) !== "%PDF-") throw new Error("not a PDF");
  return pdfjsLib.getDocument({ data: buf }).promise;
}

/* Block-ish text per page: join text items, break on vertical gaps. */
async function pageBlocks(pdf, maxPages = 12) {
  const blocks = [];
  for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    let cur = "", lastY = null;
    for (const it of tc.items) {
      const y = it.transform ? it.transform[5] : null;
      const gap = lastY !== null && y !== null && Math.abs(lastY - y) > 14;
      // paragraph break after a sentence end; tables/lists: break on any line change once the block is long
      if ((gap && /[.:;!?]$/.test(cur.trim())) || (lastY !== y && cur.length > 400) || cur.length > 1200) { blocks.push(cur.trim()); cur = ""; }
      cur += it.str + (it.hasEOL ? " " : "");
      lastY = y;
    }
    if (cur.trim()) blocks.push(cur.trim());
  }
  return blocks.map((b) => b.replace(/\s+/g, " ")).filter((b) => b.length > 2);
}

async function render(pdf) {
  const root = $("pages");
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1.4 });
    const wrap = document.createElement("div");
    wrap.className = "page";
    wrap.style.width = vp.width + "px"; wrap.style.height = vp.height + "px";
    wrap.style.setProperty("--scale-factor", vp.scale);
    const canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    const tl = document.createElement("div");
    tl.className = "textLayer";
    wrap.append(canvas, tl);
    root.append(wrap);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    await new pdfjsLib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport: vp }).render();
  }
}

async function compareWith(mine, myLang, otherUrl, knownLang) {
  state("loading the other version…");
  const other = await load(otherUrl);
  const otherLang = knownLang || guessLang(otherUrl) || (myLang === "de" ? "fr" : "de");
  state(`comparing ${myLang.toUpperCase()} ↔ ${otherLang.toUpperCase()} with Apertus…`);
  const res = await browser.runtime.sendMessage({
    type: "compareBlocks", blocksA: mine, blocksB: await pageBlocks(other), langA: myLang, langB: otherLang, cacheKey: file + ">" + otherUrl
  });
  if (res.error) { state(res.error); return; }
  const diffs = res.differences.map((d) => Object.assign({}, d, { lang: otherLang, source: otherUrl }));
  const n = RBHighlight.apply($("pages"), diffs);
  state(`${n} of ${diffs.length} differences located vs ${otherLang.toUpperCase()}`);
}

(async function main() {
  state("rendering…");
  let pdf;
  try { pdf = await load(file); } catch (e) { state("could not load PDF: " + e.message); return; }
  await render(pdf);
  const mine = await pageBlocks(pdf);
  const myLang = guessLang(file) || "de";
  $("go").onclick = () => $("other").value && compareWith(mine, myLang, $("other").value).catch((e) => state(e.message));
  const st = await browser.runtime.sendMessage({ type: "settings" });
  RBHighlight.setLang(st.explainLang);
  if (!st.hasKey) { state("set your Apertus key in the add-on options"); return; }
  const target = myLang === "de" ? "fr" : "de";
  state("looking for the " + target.toUpperCase() + " version…");
  for (const c of candidates(file, myLang, target)) {
    try {
      const r = await fetch(c, { method: "HEAD", credentials: "omit" });
      if (r.ok) { $("other").value = c; await compareWith(mine, myLang, c); return; }
    } catch (e) { /* try next */ }
  }
  state("asking OpenParlData + Apertus for the " + target.toUpperCase() + " version…");
  const found = await browser.runtime.sendMessage({ type: "findPdfCounterpart", url: file, langA: myLang, langB: target });
  if (found && found.url) { $("other").value = found.url; await compareWith(mine, myLang, found.url, target); return; }
  state("no " + target.toUpperCase() + " version found automatically" + (found && found.reason ? ` (${found.reason})` : "") + " — paste its URL above");
})();
