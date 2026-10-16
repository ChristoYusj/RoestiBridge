/* Which sites are official, and which language a page should be compared against. */
(function (root) {
  const FEDERAL = ["admin.ch", "ch.ch", "parlament.ch", "fedlex.ch", "bger.ch", "bundesgericht.ch", "post.ch"];

  // Canton domains -> official languages (first = majority language).
  const CANTONS = {
    "zh.ch": ["de"], "be.ch": ["de", "fr"], "lu.ch": ["de"], "ur.ch": ["de"], "sz.ch": ["de"],
    "ow.ch": ["de"], "nw.ch": ["de"], "gl.ch": ["de"], "zg.ch": ["de"], "fr.ch": ["fr", "de"],
    "so.ch": ["de"], "bs.ch": ["de"], "bl.ch": ["de"], "baselland.ch": ["de"], "sh.ch": ["de"],
    "ar.ch": ["de"], "ai.ch": ["de"], "sg.ch": ["de"], "gr.ch": ["de", "rm", "it"], "ag.ch": ["de"],
    "tg.ch": ["de"], "ti.ch": ["it"], "vd.ch": ["fr"], "vs.ch": ["fr", "de"], "ne.ch": ["fr"],
    "ge.ch": ["fr"], "jura.ch": ["fr"], "ju.ch": ["fr"]
  };

  function matchDomain(host, list) {
    host = host.replace(/^www\./, "");
    return list.find((d) => host === d || host.endsWith("." + d)) || null;
  }

  function classify(host) {
    const fed = matchDomain(host, FEDERAL);
    if (fed) return { kind: "federal", domain: fed, official: ["de", "fr", "it", "rm"] };
    const c = matchDomain(host, Object.keys(CANTONS));
    if (c) return { kind: "canton", domain: c, official: CANTONS[c] };
    if (matchDomain(host, ["rts.ch"])) return { kind: "rts", domain: "rts.ch", official: ["fr"] };
    return null;
  }

  /* Federal: compare with French and German (whichever the page is not in).
     Bilingual cantons: the other official language(s). Monolingual: the official one. */
  function targetLanguages(info, pageLang) {
    if (!info) return [];
    if (info.kind === "federal") return ["de", "fr"].filter((l) => l !== pageLang);
    const others = info.official.filter((l) => l !== pageLang);
    if (info.official.length > 1) return others.slice(0, 1);
    return others;
  }

  root.RBSites = { classify, targetLanguages, FEDERAL, CANTONS };
})(typeof window !== "undefined" ? window : self);
