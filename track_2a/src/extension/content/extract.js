/* Text-block extraction and language-counterpart discovery (works on live and fetched documents). */
(function () {
  const BLOCK_SEL = "h1,h2,h3,h4,p,li,dt,dd,td,th,blockquote,figcaption";
  const MAIN_SEL = ["main", "[role=main]", "#main-content", "#content", "#main", "article", ".main-content", ".content"];
  const SKIP = "nav,header,footer,aside,script,style,noscript,form,[role=navigation],.breadcrumb,.rb-tip,.rb-pill";
  const LANG_WORDS = {
    de: ["de", "deutsch", "german", "allemand", "tedesco"],
    fr: ["fr", "français", "francais", "french", "französisch", "francese"],
    it: ["it", "italiano", "italian", "italienisch", "italien"],
    rm: ["rm", "rumantsch", "romansh", "rätoromanisch", "romanche"],
    en: ["en", "english", "englisch", "anglais", "inglese"]
  };

  function mainRoot(doc) {
    for (const s of MAIN_SEL) {
      const el = doc.querySelector(s);
      if (el && el.textContent.trim().length > 200) return el;
    }
    return doc.body;
  }

  function blocks(doc) {
    const root = mainRoot(doc);
    const out = [];
    root.querySelectorAll(BLOCK_SEL).forEach((el) => {
      if (el.closest(SKIP)) return;
      if (el.querySelector(BLOCK_SEL)) return;              // keep leaf blocks only
      const t = el.textContent.replace(/\s+/g, " ").trim();
      if (t.length >= 3) out.push(t);
    });
    return out;
  }

  function pageLang(doc) {
    const l = (doc.documentElement.getAttribute("lang") || "").toLowerCase().slice(0, 2);
    if (l) return l;
    const m = location.pathname.match(/\/(de|fr|it|rm|en)(\/|$)/);
    return m ? m[1] : "de";
  }

  /* Find the URL of the same page in `lang`. */
  function counterpartUrl(doc, lang, baseUrl) {
    const abs = (h) => { try { return new URL(h, baseUrl).href; } catch (e) { return null; } };
    const alt = doc.querySelector(`link[rel=alternate][hreflang^="${lang}"]`);
    if (alt) return abs(alt.getAttribute("href"));
    const tagged = doc.querySelector(`a[hreflang^="${lang}"], a[lang^="${lang}"]`);
    if (tagged && tagged.getAttribute("href")) return abs(tagged.getAttribute("href"));
    const words = LANG_WORDS[lang] || [lang];
    for (const a of doc.querySelectorAll("a[href]")) {
      const label = (a.textContent + " " + (a.getAttribute("title") || "") + " " + (a.getAttribute("aria-label") || "")).trim().toLowerCase();
      if (words.includes(label) || words.includes(a.textContent.trim().toLowerCase())) {
        const h = abs(a.getAttribute("href"));
        if (h && !h.startsWith("javascript")) return h;
      }
    }
    // URL pattern fallback: /de/ <-> /fr/
    const u = new URL(baseUrl);
    const swapped = u.pathname.replace(/\/(de|fr|it|rm|en)(\/|$)/, `/${lang}$2`);
    if (swapped !== u.pathname) { u.pathname = swapped; return u.href; }
    if (u.searchParams.has("lang")) { u.searchParams.set("lang", lang); return u.href; }
    return null;
  }

  window.RBExtract = { blocks, pageLang, counterpartUrl, mainRoot };
})();
