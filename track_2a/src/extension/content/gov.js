/* Swiss federal and cantonal sites: compare this page with its other official language version(s). */
(async function () {
  const info = RBSites.classify(location.hostname);
  if (!info || window.top !== window) return;
  const st = await browser.runtime.sendMessage({ type: "settings" });
  if (!st || !st.enabled) return;

  const lang = RBExtract.pageLang(document);
  const targets = RBSites.targetLanguages(info, lang);
  if (!targets.length) return;
  const mine = RBExtract.blocks(document);
  if (mine.join(" ").length < 150) return;      // nothing substantial to compare
  if (!st.hasKey) {
    const pill = RBHighlight.status("set your Apertus key in the add-on options to check translations (click)", "warn");
    pill.addEventListener("click", () => browser.runtime.sendMessage({ type: "openOptions" }));
    return;
  }

  RBHighlight.status(`checking against ${targets.map((t) => t.toUpperCase()).join(" + ")}…`, "busy");
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
    }
    if (!doc) { summary.push(`${t.toUpperCase()}: no version found`); continue; }
    const theirs = RBExtract.blocks(doc);
    const res = await browser.runtime.sendMessage({ type: "compareBlocks", blocksA: mine, blocksB: theirs, langA: lang, langB: t, cacheKey: location.href + ">" + page.url });
    if (res.error) { summary.push(`${t.toUpperCase()}: ${RBHighlight.esc(res.error)}`); continue; }
    const diffs = res.differences.map((d) => Object.assign({}, d, { lang: t, source: page.url }));
    const n = RBHighlight.apply(root, diffs);
    summary.push(`<a href="${RBHighlight.esc(page.url)}">${t.toUpperCase()}</a>: ${n} flagged`);
  }
  RBHighlight.status(summary.join(" · "), "done");
})();
