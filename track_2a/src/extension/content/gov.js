/* Swiss federal and cantonal sites: compare this page with its other official language version(s). */
(async function () {
  const info = RBSites.classify(location.hostname);
  if (!info || window.top !== window) return;
  const st = await browser.runtime.sendMessage({ type: "settings" });
  if (!st || !st.enabled) return;
  RBHighlight.setLang(st.explainLang);

  const lang = RBExtract.pageLang(document);
  const targets = RBSites.targetLanguages(info, lang);
  if (!targets.length) return;
  const mine = RBExtract.blocks(document);
  if (mine.join(" ").length < 150) return;      // nothing substantial to compare
  if (!st.hasKey) {
    const pill = RBHighlight.status("Set your Apertus key in the add-on options to check translations (click here).", "warn");
    pill.querySelector(".rb-msg").addEventListener("click", () => browser.runtime.sendMessage({ type: "openOptions" }));
    return;
  }

  RBHighlight.status(`Comparing with the ${targets.map((t) => t.toUpperCase()).join(" + ")} version…`, "busy");
  const root = RBExtract.mainRoot(document);
  const summary = [];
  for (const t of targets) {
    let url = RBExtract.counterpartUrl(document, t, location.href);
    let page = url && url !== location.href ? await browser.runtime.sendMessage({ type: "fetchText", url }) : null;
    let doc = page && page.ok ? new DOMParser().parseFromString(page.text, "text/html") : null;
    if (!doc || /404|not found|nicht gefunden|introuvable|non trouv/i.test(doc.title)) {
      // translated slugs (new admin.ch CMS): ask Apertus to match the page in the other-language menu
      const found = await browser.runtime.sendMessage({
        type: "findCounterpart", url: location.href, langA: lang, langB: t,
        title: document.title, pageHtml: document.documentElement.innerHTML.slice(0, 400000)
      });
      url = found && found.url;
      page = url ? await browser.runtime.sendMessage({ type: "fetchText", url }) : null;
      doc = page && page.ok ? new DOMParser().parseFromString(page.text, "text/html") : null;
      if (!doc) {
        const why = (found && (found.error || found.reason)) || (page ? "HTTP " + page.status : "no match");
        summary.push(`${t.toUpperCase()}: no version found (${RBHighlight.esc(why)})`);
        continue;
      }
    }
    const theirs = RBExtract.blocks(doc);
    const res = await browser.runtime.sendMessage({ type: "compareBlocks", blocksA: mine, blocksB: theirs, langA: lang, langB: t, cacheKey: location.href + ">" + page.url });
    if (res.error) { summary.push(`${t.toUpperCase()}: ${RBHighlight.esc(res.error)}`); continue; }
    const diffs = res.differences.map((d) => Object.assign({}, d, { lang: t, source: page.url }));
    const n = RBHighlight.apply(root, diffs);
    const onlyThere = diffs.filter((d) => !d.a).length;
    const lost = diffs.length - onlyThere - n;
    const extra = [onlyThere ? `${onlyThere} only in the ${t.toUpperCase()} version` : "", lost > 0 ? `${lost} not found on this page` : "",
      res.failedChunks ? `${res.failedChunks} section${res.failedChunks > 1 ? "s" : ""} not checked` : ""].filter(Boolean).join(", ");
    summary.push(`vs <a href="${RBHighlight.esc(page.url)}" target="_blank" rel="noopener">${t.toUpperCase()}</a>: `
      + `${n ? `${n} difference${n > 1 ? "s" : ""} highlighted` : "no differences highlighted"}${extra ? " (" + extra + ")" : ""}`);
  }
  RBHighlight.status(summary.join("<br>"), "done");
})();
