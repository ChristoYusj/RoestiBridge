/* Shared Apertus engine: same prompt (shared/prompt.json) as the Python benchmark pipeline. */
(function (root) {
  const DEFAULTS = {
    apiKey: "",
    baseUrl: "https://api.inference.cscs.ch/v1",
    model: "swiss-ai/Apertus-v1.5-70B",
    explainLang: "en",
    minSeverity: 2,
    enabled: true
  };
  let PROMPT = null;
  const NATIVE = { de: "Deutsch", fr: "français", it: "italiano", rm: "rumantsch", en: "English" };
  /* "the French version" etc., in the explanation language, to replace TEXT A / TEXT B */
  const VERSION_OF = {
    en: { de: "the German version", fr: "the French version", it: "the Italian version", rm: "the Romansh version", en: "the English version" },
    de: { de: "die deutsche Fassung", fr: "die französische Fassung", it: "die italienische Fassung", rm: "die rätoromanische Fassung", en: "die englische Fassung" },
    fr: { de: "la version allemande", fr: "la version française", it: "la version italienne", rm: "la version romanche", en: "la version anglaise" },
    it: { de: "la versione tedesca", fr: "la versione francese", it: "la versione italiana", rm: "la versione romancia", en: "la versione inglese" }
  };

  async function prompt() {
    if (!PROMPT) PROMPT = await (await fetch(browser.runtime.getURL("shared/prompt.json"))).json();
    return PROMPT;
  }

  async function settings() {
    const s = await browser.storage.local.get(Object.keys(DEFAULTS));
    return Object.assign({}, DEFAULTS, s);
  }

  async function buildMessages(textA, textB, langA, langB, explainLang) {
    const p = await prompt();
    const n = p.lang_names;
    const user = p.user_template
      .split("{lang_a}").join(n[langA] || langA)
      .split("{lang_b}").join(n[langB] || langB)
      .split("{explain_lang}").join(n[explainLang] || explainLang)
      .split("{text_a}").join(textA)
      .split("{text_b}").join(textB);
    // The template only mentions the explanation language in passing, and the model tends to answer in
    // English or in the text's language. Stated explicitly for non-English choices; English stays
    // byte-identical to the frozen benchmark prompt.
    const insist = explainLang && explainLang !== "en"
      ? `\n\nIMPORTANT: write every "explanation" value in ${n[explainLang] || explainLang} (${NATIVE[explainLang] || explainLang}), `
        + `whatever the languages of TEXT A and TEXT B. Keep the "a" and "b" excerpts exactly as they appear in the texts.`
      : "";
    return [{ role: "system", content: p.system }, { role: "user", content: user + insist }];
  }

  function parseDifferences(content) {
    let s = (content || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    const cands = [s, s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1), s.slice(s.indexOf("["), s.lastIndexOf("]") + 1)];
    for (const c of cands) {
      try {
        let o = JSON.parse(c);
        if (o && !Array.isArray(o)) o = o.differences || [];
        if (Array.isArray(o)) return o.filter((d) => d && typeof d === "object");
      } catch (e) { /* try next */ }
    }
    return [];
  }

  async function chat(messages, cfg) {
    const body = { model: cfg.model, messages, temperature: 0, max_tokens: cfg.maxTokens || 2000, response_format: { type: "json_object" } };
    let lastError = "Apertus endpoint unavailable";
    for (let attempt = 0; attempt < 3; attempt++) {
      let r;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 120000);   // a hung request must not freeze the page check
      try {
        r = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
          body: JSON.stringify(body),
          signal: ctl.signal
        });
      } catch (e) {
        lastError = e.name === "AbortError" ? "Apertus request timed out" : "network error: " + e.message;
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (r.ok) {
        const j = await r.json();
        return j.choices[0].message.content || "";
      }
      if (r.status === 400 && body.response_format) { delete body.response_format; continue; }
      if (r.status === 401 || r.status === 403) {
        const detail = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
        throw new Error("API key rejected (" + r.status + ")" + (detail ? ": " + detail : ""));
      }
      lastError = "Apertus endpoint returned HTTP " + r.status;
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
    throw new Error(lastError);
  }

  /* Language-neutral normal form for "is this excerpt really absent?" checks. */
  const flat = (s) => String(s || "").toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»„]/g, '"').replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ").replace(/^[\s.,;:!?"'()\-]+|[\s.,;:!?"'()\-]+$/g, "");

  /* The model sometimes reports text that is identical in both languages (place names, datelines,
     numbers, acronyms) as missing from the other version, or quotes the same string on both sides. */
  function isSpurious(d, textA, textB) {
    const a = flat(d.a), b = flat(d.b);
    if (a && b) return a === b;
    if (a && !b) return a.length >= 3 && flat(textB).includes(a);
    if (b && !a) return b.length >= 3 && flat(textA).includes(b);
    return true;                                   // neither side quoted: nothing to show
  }

  /* Compare two texts; returns differences with numeric severity. */
  async function compare(textA, textB, langA, langB) {
    const cfg = await settings();
    if (!cfg.apiKey) throw new Error("Set your Apertus API key in the RöstiBridge options");
    const msgs = await buildMessages(textA, textB, langA, langB, cfg.explainLang);
    const versionOf = VERSION_OF[cfg.explainLang] || VERSION_OF.en;
    const diffs = parseDifferences(await chat(msgs, cfg));
    return diffs
      .map((d) => Object.assign({}, d, { severity: Math.min(5, Math.max(1, Math.round(Number(d.severity) || 3))) }))
      .filter((d) => d.severity >= cfg.minSeverity && !/^(no[ _-]?diff|none|same|identical)/i.test(String(d.type || "")))
      .filter((d) => !isSpurious(d, textA, textB))
      .map((d) => Object.assign(d, {
        // the prompt calls them TEXT A / TEXT B; readers know them by language
        explanation: String(d.explanation || "")
          .replace(/\b(?:[Tt]he |[Ll][ea] |[Dd]ie |[Dd]er |[Dd]as )?TEXT[EO]? A\b/g, versionOf[langA] || langA)
          .replace(/\b(?:[Tt]he |[Ll][ea] |[Dd]ie |[Dd]er |[Dd]as )?TEXT[EO]? B\b/g, versionOf[langB] || langB)
      }));
  }

  root.RBEngine = { compare, settings, parseDifferences, buildMessages, chat, isSpurious, DEFAULTS };
})(typeof window !== "undefined" ? window : self);
