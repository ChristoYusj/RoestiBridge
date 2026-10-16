/* RTS: link the German (SRF) coverage of the same story and flag where title/text diverge. */
(async function () {
  if (window.top !== window) return;
  const h1 = document.querySelector("article h1, main h1, h1");
  if (!h1 || h1.textContent.trim().length < 15) return;      // not an article/video page
  const st = await browser.runtime.sendMessage({ type: "settings" });
  if (!st || !st.enabled) return;
  const isVideo = /\/play\/|\/video\//.test(location.pathname) || !!document.querySelector("video");
  const title = h1.textContent.replace(/\s+/g, " ").trim();
  const esc = RBHighlight.esc;

  const bar = document.createElement("div");
  bar.className = "rb-rtsbar";
  bar.innerHTML = `<span class="rb-logo">RöstiBridge</span> looking for the German version on SRF…`;
  h1.insertAdjacentElement("afterend", bar);
  if (!st.hasKey) { bar.innerHTML = `<span class="rb-logo">RöstiBridge</span> set your Apertus key in the add-on options`; return; }

  const q = await browser.runtime.sendMessage({ type: "germanQuery", title });
  const queries = (q && q.queries && q.queries.length) ? q.queries : [title];
  const playUrl = "https://www.playsrf.ch/de/suche?query=" + encodeURIComponent(queries[0]);
  const found = await browser.runtime.sendMessage({ type: "srfSearch", queries });
  const cands = (found && found.results) || [];
  const pick = await browser.runtime.sendMessage({ type: "pickSameStory", title, candidates: cands });
  const best = pick && pick.index >= 0 ? cands[pick.index] : null;
  const searchLink = `<a href="${esc((found && found.searchUrl) || playUrl)}" target="_blank" rel="noopener">more on SRF</a>`;
  const videoLink = isVideo ? ` · <a href="${esc(playUrl)}" target="_blank" rel="noopener">Play SRF video search</a>` : "";
  if (!best) {
    bar.innerHTML = `<span class="rb-logo">RöstiBridge</span> 🇩🇪 ${q && q.title_de ? "<i>" + esc(q.title_de) + "</i> — " : ""}no direct SRF match · ${searchLink}${videoLink}`;
    return;
  }
  bar.innerHTML = `<span class="rb-logo">RöstiBridge</span> 🇩🇪 German version: <a href="${esc(best.url)}" target="_blank" rel="noopener">${esc(best.title || best.url)}</a> · ${searchLink}${videoLink} <span class="rb-dim">comparing…</span>`;

  const page = await browser.runtime.sendMessage({ type: "fetchText", url: best.url });
  if (!page || !page.ok) return;
  const doc = new DOMParser().parseFromString(page.text, "text/html");
  const theirs = RBExtract.blocks(doc);
  const mine = RBExtract.blocks(document);
  const res = await browser.runtime.sendMessage({ type: "compareBlocks", blocksA: mine, blocksB: theirs, langA: "fr", langB: "de", cacheKey: location.href + ">" + best.url });
  const dim = bar.querySelector(".rb-dim");
  if (res.error) { dim.textContent = res.error; return; }
  const diffs = res.differences.map((d) => Object.assign({}, d, { lang: "de", source: best.url }));
  const n = RBHighlight.apply(RBExtract.mainRoot(document), diffs);
  RBHighlight.apply(h1.parentElement, diffs.filter((d) => title.toLowerCase().includes(String(d.a || "").toLowerCase())));
  dim.textContent = `${n} differences flagged (title + text)`;
})();
