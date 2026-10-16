const DEFAULTS = { apiKey: "", baseUrl: "https://api.inference.cscs.ch/v1", model: "swiss-ai/Apertus-v1.5-70B", explainLang: "en", minSeverity: 2, enabled: true };
const ids = Object.keys(DEFAULTS);

browser.storage.local.get(ids).then((s) => {
  const v = Object.assign({}, DEFAULTS, s);
  for (const k of ids) {
    const el = document.getElementById(k);
    if (el.type === "checkbox") el.checked = !!v[k]; else el.value = v[k];
  }
});

document.getElementById("save").addEventListener("click", async () => {
  const out = {};
  for (const k of ids) {
    const el = document.getElementById(k);
    out[k] = el.type === "checkbox" ? el.checked : k === "minSeverity" ? Number(el.value) : el.value.trim();
  }
  // tolerate a pasted .env line or an "Authorization: Bearer …" value
  out.apiKey = out.apiKey.replace(/^(LLM_API_KEY\s*=\s*|Authorization:\s*)?(Bearer\s+)?/i, "").replace(/^["']|["']$/g, "");
  await browser.storage.local.set(out);
  const msg = document.getElementById("msg");
  msg.style.color = "#555";
  msg.textContent = "Saved, testing the key…";
  const r = await browser.runtime.sendMessage({ type: "testKey" });
  msg.style.color = r && r.ok ? "#2a7a2a" : "#a3170c";
  msg.textContent = r && r.ok ? `Saved, key works with ${r.model}` : `Saved, but the endpoint refused: ${(r && r.error) || "no answer"}`;
});
