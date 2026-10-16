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
  await browser.storage.local.set(out);
  document.getElementById("msg").textContent = "Saved";
  setTimeout(() => (document.getElementById("msg").textContent = ""), 1500);
});
