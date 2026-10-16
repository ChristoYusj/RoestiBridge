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
    return [{ role: "system", content: p.system }, { role: "user", content: user }];
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
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey },
        body: JSON.stringify(body)
      });
      if (r.ok) {
        const j = await r.json();
        return j.choices[0].message.content || "";
      }
      if (r.status === 400 && body.response_format) { delete body.response_format; continue; }
      if (r.status === 401 || r.status === 403) {
        const detail = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
        throw new Error("API key rejected (" + r.status + ")" + (detail ? ": " + detail : ""));
      }
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
    throw new Error("Apertus endpoint unavailable");
  }

  /* Compare two texts; returns differences with numeric severity. */
  async function compare(textA, textB, langA, langB) {
    const cfg = await settings();
    if (!cfg.apiKey) throw new Error("Set your Apertus API key in the RöstiBridge options");
    const msgs = await buildMessages(textA, textB, langA, langB, cfg.explainLang);
    const langName = (await prompt()).lang_names;
    const diffs = parseDifferences(await chat(msgs, cfg));
    return diffs
      .map((d) => Object.assign({}, d, { severity: Math.min(5, Math.max(1, Math.round(Number(d.severity) || 3))) }))
      .filter((d) => d.severity >= cfg.minSeverity && !/^(no[ _-]?diff|none|same|identical)/i.test(String(d.type || "")))
      .map((d) => Object.assign(d, {
        // the prompt calls them TEXT A / TEXT B; readers know them by language
        explanation: String(d.explanation || "")
          .replace(/\bTEXT A\b/g, "the " + (langName[langA] || langA) + " version")
          .replace(/\bTEXT B\b/g, "the " + (langName[langB] || langB) + " version")
      }));
  }

  root.RBEngine = { compare, settings, parseDifferences, buildMessages, chat, DEFAULTS };
})(typeof window !== "undefined" ? window : self);
