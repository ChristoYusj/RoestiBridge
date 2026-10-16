# Technical report: RöstiBridge

- **Track:** Track 2A, UZH: Detecting Cross-Lingual Semantic Differences in Swiss Government Websites
- **Event:** Online
- **Team:** RedPandas: Christopher Yazigi, Giovanni Yazbeck, Alfredo Pio Yazbeck
- **Demo:** Firefox extension in `src/extension` (`dist/roestibridge-0.1.0.xpi`); screenshots in `docs/`

## 1. Summary

Swiss authorities publish the same page in up to four languages, and the versions do not always say the same thing: sentences are dropped, numbers or deadlines change, or "must" becomes "may". RöstiBridge brings token-level recognition of semantic differences (RSD) to the reader. It is a Firefox extension that highlights passages of an official page (federal, cantonal, RTS news, or a parliamentary PDF) whose meaning may differ from the reference language version. Hovering a highlight shows the other version's excerpt as a citation and an Apertus explanation.

The same single Apertus prompt is benchmarked on SwissGov-RSD [1]. Apertus-v1.5-70B reports difference spans, which are projected onto tokens; 3-sample self-consistency averages them. On the full dev split (504 document pairs) the official UZH scorer gives a macro token-level Spearman of **0.193** (DE 0.210, FR 0.165, IT 0.204), against 0.095 for a model-free number-mismatch baseline. On the 120-document subset used for development the gain is from 0.096 for raw single-sample spans to 0.131. The submission files in `predictions/submission/` cover all 224 documents per language in the official full-set order.

## 2. Architecture

```
 page / PDF in language X ──► extract blocks ──► find counterpart in language Y
   (content script / pdf.js)                      hreflang · switcher · /de/↔/fr/ URL
                                                  · Apertus path matching (admin.ch CMS)
                                                  · OpenParlData affair siblings (parlament.ch PDFs)
                                                  · Bing-News RSS + Apertus story matching (RTS→SRF)
             │                                              │
             └──────► background.js: chunk aligned blocks (≈3.5k chars, proportional
                      window ±4 blocks) ──► Apertus (shared/prompt.json) ──► JSON
                      {a, b, type, severity, explanation} ──► cache (storage.local)
             ◄────── highlight `a` excerpts (whitespace-agnostic matching across nodes /
                      text-layer spans) + hover card (citation `b` + explanation)
```

- **Federal vs. cantonal logic** (`shared/sites.js`):
  - Federal domains are compared with FR and DE (whichever the page is not in).
  - Bilingual cantons (BE/FR/VS/GR) are compared with the other official language.
  - Monolingual cantons are compared with their official language.
- **Robustness:** every Apertus request has a 120 s timeout and 3 retries. A failing chunk does not discard the others; the pill says "n part(s) not checked". Only complete results are cached, and errors show their reason (e.g. `invalid API key`). The options page tests the key when you save it.
- **Key handling:** the API key lives in `browser.storage.local` and is only read by the background script. Page scripts never receive it.
- **Benchmark pipeline** (`src/roestibridge`): a stdlib-only Python client (`llm.py`), span → token projection (`rsd.py`), the metric (`metrics.py`, a faithful re-implementation of the official `evaluate_predictions_admin.py` pooling) and a CLI. It reads the **same `prompt.json`** as the extension, and a unit test enforces this.

| Federal page: hover card | Parliamentary PDF: hover card |
|---|---|
| ![bag.admin.ch FR vs DE](docs/screenshot_gov_tooltip.jpg){width=48%} | ![Fedlex PDF DE vs FR](docs/screenshot_pdf_tooltip.jpg){width=48%} |


## 3. Use of Apertus

- **Model:** `swiss-ai/Apertus-v1.5-70B` (CSCS-hosted, OpenAI-compatible endpoint). `Apertus-v1.5-8B` can be selected in the options for on-prem use.
- **How it is used:** prompting-only inference with JSON output (`response_format: json_object`, with a fallback when the endpoint does not support it). Apertus is used for:
  1. difference detection with severity and explanation (core RSD);
  2. matching translated URL slugs on the new admin.ch CMS;
  3. turning an RTS headline into German search queries and deciding whether an SRF article is the same story;
  4. picking the translated sibling of a parliamentary document.
- **Prompt:** `src/extension/shared/prompt.json` (`rb-prompt-v1`). The system prompt defines what counts as a difference (omission/addition, numbers/dates, obligation/scope, legal terms, actionable nuance) and what does not (grammar, word order, free translation). It asks for exact, short excerpts.
- **Benchmark settings:** temperature 0 for the first sample and 0.7 for samples 2–3, `max_tokens` 2000, one call per document pair. Token usage (from the API) is about 0.82M prompt and 0.25M completion tokens for the 3-sample test run, about 4.9k prompt + 1.5k completion tokens per document pair (`raw_*.jsonl` → `usage`).
- **No other model is used** anywhere in the pipeline or for evaluation.

## 4. Data

- **SwissGov-RSD** [1] (`ZurichNLP/SwissGov-RSD` on Hugging Face) is downloaded at run time into `data/swissgov-rsd/` and is not committed.
- Development used a deterministic, evenly spaced **40-document subset of the dev split per language** (`--limit 40`, 120 pairs) to stay within the API budget. After freezing, the remaining dev documents were predicted with the same setting, because the UZH Q&A asks for predictions in the full-set order (224 per language).
- **The test split was never evaluated or inspected:** `evaluate --split test` exits with an error.
- Test predictions were produced once with the prompt and post-processing frozen on dev.
- The extension processes public government pages on the fly and stores nothing beyond a local cache of model answers.
- Note: the dataset's DE/FR/IT texts contain U+FFFD replacement characters in place of accented letters (e.g. `L�approvisionnement`). The prompt tells the model to copy excerpts verbatim "even if characters look garbled", and the projection treats `�` as a word character.

## 5. Evaluation

**Metric:** the official one. For each language pair, all tokens of side A and side B with gold ≠ −1 are pooled (predictions are padded or truncated to the gold length), global Spearman is computed, and the macro average is taken over EN–DE/FR/IT. Our implementation matches `scipy.stats.spearmanr` on the pooled vectors. It also matches the official `scripts/evaluate_predictions_admin.py` exactly on the full dev split (DE 0.210 / FR 0.165 / IT 0.204; Kendall's τ 0.197 / 0.154 / 0.187).

| Setup (dev subset, 40 docs/pair) | DE | FR | IT | **macro** |
|---|---|---|---|---|
| Number-mismatch baseline (no LLM) | 0.102 | 0.068 | 0.080 | 0.083 |
| Apertus-70B, 1 sample, all spans at severity/5 | 0.136 | 0.056 | 0.096 | 0.096 |
| + drop severity 1, omission/addition = 1.0 | 0.157 | 0.069 | 0.100 | 0.109 |
| + number-mismatch prior (max) | 0.159 | 0.074 | 0.104 | 0.112 |
| **+ 3 samples, averaged (submitted)** | **0.191** | **0.077** | **0.125** | **0.131** |
| *Full dev split (168 docs/pair), number baseline* | 0.132 | 0.065 | 0.087 | 0.095 |
| ***Full dev split (168 docs/pair), submitted setting, official scorer*** | **0.210** | **0.165** | **0.204** | **0.193** |

**Ablations** (no extra API calls; `python -m roestibridge.ablate`):

| Variant | Macro | Result |
|---|---|---|
| Binary span scores instead of severity | 0.095 | Worse |
| Damping long spans by length | ±0.001 | No gain |
| Paragraph-context smoothing | 0.099 | No gain |

**Error analysis (FR, 1 sample):**
- **Low precision.** Of the tokens we mark, 226 are true positives and 1,752 are false positives. Apertus over-reports "different wording, same meaning" spans at low severity, which motivated the severity ≥ 2 cut. Recall is limited too (1,119 gold-positive tokens missed): many gold differences are small structural omissions such as link labels and list items.
- **Span projection is reliable:** 376 of 382 returned excerpts were located in the token sequence.
- **FR is the weakest pair.** The FR documents are longer (461 vs 363 tokens on average for DE) and the FR texts carry the most `�` corruption.

**Extension checks.** These ran end to end in Firefox 158 (headless, WebDriver BiDi via puppeteer-core) on the packaged extension against live sites on 16 Oct 2026. Apertus-70B was used throughout. The counts vary between runs because the model is not deterministic.

| Case | Result |
|---|---|
| bfe.admin.ch/fr → DE | 3–4 highlighted, e.g. a paragraph on the IAEA General Conference that is missing in the German version |
| be.ch/fr → DE (bilingual canton) | 1 highlighted, a tone shift ("beau palmarès" vs "brillieren") |
| bag.admin.ch FR → DE | Counterpart found via Apertus slug matching (`agenda-soins-de-base` → `agenda-grundversorgung`); 0–9 differences depending on the run, mostly list items |
| ch.ch/it → DE and FR (federal: both) | 0 differences on the homepage |
| RTS Amaudruz article → SRF | SRF story found and linked ("SVP-Nationalrätin Céline Amaudruz will Bundesrätin werden"); 8–9 differences highlighted |
| parlament.ch PDF link (DE) | Redirected into the RöstiBridge viewer; FR counterpart found via OpenParlData affair 234959 (`Kinderabzug = 12'000 Franken` → `déduction pour enfants = 12 000 francs`); the tables agree (0 differences) |
| Fedlex consultation PDF (DE↔FR) | 16 differences, including articles where the French reads "Ne concerne que le texte allemand" while the German changes the provision; 10 of 16 located on the text layer (5 before the locator fallbacks) |

## 6. Limitations

- **Absolute scores are low.** This is consistent with [1], where prompted LLMs struggle on document-level cross-lingual RSD. The dev subset is small (120 pairs), so the post-processing choices may be slightly overfit.
- **Extension chunk alignment is proportional (± 4 blocks).** When a page has very different structures across languages, content outside the window can be reported as "missing". Apertus sometimes quotes the wrong side or paraphrases. The locator then tries the other excerpt and the first or last six words of the quote, which raised the Fedlex PDF from 5 to 10 of 16 located; the rest are counted as "not locatable" in the status pill.
- **Counterpart discovery depends on site conventions.**
  - The admin.ch slug matcher needs both homepages to list the page.
  - RTS→SRF depends on a third-party news search (Bing News RSS, DuckDuckGo fallback), and SRF is independent journalism, not a translation. Differences there mean coverage differences, not translation errors.
- **Language metadata:** OpenParlData labels some French parlament.ch documents as `it`. We therefore ask Apertus to pick by title rather than trusting the language field.
- **Packaging:** the extension is unsigned (temporary add-on) and uses Manifest V2 for blocking `webRequest` (PDF interception).
- **No human evaluation of the extension's highlights** was done in the time available.

## 7. Reproducibility

- `make run` (Docker, no GPU) runs four steps:
  1. unit tests;
  2. re-scoring of the shipped raw Apertus outputs for dev (exactly the numbers above, no API needed);
  3. the model-free baseline;
  4. rebuilding the submitted test predictions from the shipped raw outputs.

  With `LLM_API_KEY` set it also runs a live Apertus prediction and evaluation on `LIVE_LIMIT` dev documents per language.
- `make predict-test` regenerates the test predictions (168 × 3 calls).
- Apertus output at temperature 0 is not perfectly deterministic on the hosted endpoint. That is why the raw responses are shipped and all scores are recomputed from them.

## 8. Next steps

- **Sentence alignment before prompting.** Align with the LLM or embeddings, then ask per aligned pair. This should improve both recall and the "missing" false positives.
- **Calibrate severities per language** on dev.
- **Try 8B with more samples** for an on-prem budget.
- **Ship a signed MV3 build:** declarativeNetRequest for PDFs, plus a "report this discrepancy to the authority" button that drafts a correction request with the citation.

## License

Creative Commons Attribution 4.0 (CC-BY-4.0). pdf.js (Apache-2.0) is bundled in `src/extension/pdf/lib/` with its licence.

## References

[1] Wastl et al. *SwissGov-RSD: A Human-annotated, Cross-lingual Benchmark for Token-level Recognition of Semantic Differences Between Related Documents.* arXiv:2512.07538 / ACL 2026. https://arxiv.org/abs/2512.07538
