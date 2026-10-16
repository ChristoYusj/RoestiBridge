<p align="center"><img src="src/extension/icons/icon-128.png" alt="RöstiBridge logo" width="128"></p>

# RöstiBridge

**Hack Apertus Online · Track 2A Academia Challenges · UZH: Detecting Cross-Lingual Semantic Differences in Swiss Government Websites**

RöstiBridge is a Firefox extension that shows you where the language versions of an official Swiss page do not say the same thing. It also includes the benchmark pipeline that measures the same Apertus prompt on SwissGov-RSD ([Wastl et al., 2025, arXiv:2512.07538](https://arxiv.org/abs/2512.07538)).

### Why "RöstiBridge"?

The *Röstigraben* ("rösti ditch") is the Swiss name for the cultural and language border between German- and French-speaking Switzerland. Authorities publish the same information on both sides of it, and in Italian and Romansh too, but the versions do not always say the same thing: a sentence is dropped, a deadline changes, "must" becomes "may". RöstiBridge builds a **bridge over the Röstigraben**. Whatever language you read a page in, it shows you what the other language version says differently, quoted from the official text and explained by Apertus.

| | |
|---|---|
| ![Federal page: hover card](docs/screenshot_gov_tooltip.jpg) | ![Parliament/Fedlex PDF](docs/screenshot_pdf_tooltip.jpg) |
| bag.admin.ch (FR) compared with its German page | Federal consultation PDF (DE) compared with the French PDF |

## What it does

1. **Swiss government pages (federal and cantonal), in any language version.** The extension finds the same page in the reference language and asks Apertus for meaning differences. Passages that may mean something different are highlighted.
   - Federal sites (`*.admin.ch`, `ch.ch`, `parlament.ch`, `fedlex`, …): the page is compared with French and German (whichever it is not in).
   - Bilingual cantons (BE, FR, VS, GR): the page is compared with the other official language. Monolingual cantons: the page is compared with the canton's language (for example, an English page on `zh.ch` is compared with German).
   - The counterpart page is found through `hreflang`, the language switcher or `/de/`↔`/fr/` URLs. On the new admin.ch CMS, where page slugs are translated and the switcher only works in JavaScript, Apertus matches the page path against the other language's site menu (for example `/fr/soins-palliatifs` → `/de/palliative-care`).
2. **Hover a highlight** to see:
   - the excerpt from the other language version, as a citation with a source link;
   - below it, an *inferred explanation* by Apertus of what differs and why it matters, in the language chosen in the options (EN / DE / FR / IT).
3. **RTS articles and videos.** A bar under the headline links the German (SRF) coverage of the same story. Apertus translates the headline into short search queries, the extension searches srf.ch through a news RSS feed, and Apertus picks the same story or says none matches. The bar also offers a Play SRF search link for videos. Differences between the RTS and SRF titles and text are highlighted the same way.
4. **Parliamentary PDFs opened from an official site** open in RöstiBridge's own pdf.js viewer with a text layer that can be highlighted. The other-language PDF is found in one of two ways:
   - by swapping the language in the URL (Fedlex, `/de/`↔`/fr/`, `_d.pdf`↔`_f.pdf`);
   - for parlament.ch, where each language's file has a translated name, by looking up the document's affair in the **OpenParlData API** and letting Apertus pick the translated sibling document.
5. **Only real differences are shown.** Text that is identical in both versions (place names, datelines, numbers, acronyms) is never reported as "missing", and a "difference" that quotes the same string on both sides is dropped.

Everything runs against an OpenAI-compatible endpoint (default: CSCS-hosted `swiss-ai/Apertus-v1.5-70B`; the 8B model or an on-prem vLLM endpoint can be set in the options).

## Install the extension (Firefox)

1. `about:debugging` → *This Firefox* → *Load Temporary Add-on…* → pick `src/extension/manifest.json`. Alternatively, use `dist/roestibridge-0.1.5.xpi` in Firefox Developer Edition or Nightly with `xpinstall.signatures.required=false`.
2. Click the RöstiBridge toolbar icon (or the pill on a page), paste your Apertus API key and save. The key is tested when you save it.
   - The key is kept in `browser.storage.local` and is used only in the background script, never in page scripts.
3. Open any official page, for example https://www.bag.admin.ch/fr/agenda-soins-de-base.

Developer loop: `npx web-ext run --source-dir src/extension`.

## Benchmark (SwissGov-RSD)

```bash
make run          # Docker: unit tests, re-score shipped dev outputs, number baseline, rebuild test predictions
                  # + a live Apertus run on a small dev sample when LLM_API_KEY is set
make test         # the 12 unit tests only (no Docker, no API)
make predict-test # full test-split prediction (168 docs x 3 samples) with the frozen prompt
```

Environment: `LLM_NAME`, `LLM_BASE_URL`, `LLM_API_KEY` (as in the template). `LIVE_LIMIT` sets the number of documents per language for the live run (default 5).

**Submitted predictions:** `predictions/test_70b_n3/predictions_{de,fr,it}.jsonl`. They use the `EncoderPrediction` schema of the official `evaluation/utils.py` (`id, text_a, text_b, labels_a, labels_b`). Raw Apertus outputs, with token usage, are in `raw_*.jsonl` next to them.

| Dev subset (40 docs × 3 pairs), token-level Spearman | DE | FR | IT | macro |
|---|---|---|---|---|
| Number-mismatch baseline (no model) | 0.102 | 0.068 | 0.080 | 0.083 |
| Apertus-70B, 1 sample, raw spans | 0.136 | 0.056 | 0.096 | 0.096 |
| + severity ≥ 2, omissions = 1.0, number prior | 0.159 | 0.074 | 0.104 | 0.112 |
| **+ 3-sample self-consistency (submitted)** | **0.191** | **0.077** | **0.125** | **0.131** |

The test labels were never read: `evaluate --split test` refuses to run. See [technical_report.md](technical_report.md) for the method, ablations and limitations.

## Apertus prompt

There is **one** prompt, [`src/extension/shared/prompt.json`](src/extension/shared/prompt.json) (`rb-prompt-v1`), read by both the extension and the benchmark; a unit test checks that they use the same file.

| Field | What it holds |
|---|---|
| `system` | What counts as a difference (omission/addition, numbers/dates, obligation/scope, legal terms, actionable nuance) and what does not (grammar, word order, free translation); asks for exact, short excerpts copied verbatim |
| `user_template` | TEXT A / TEXT B, their languages, and the explanation language |
| `severity_to_score` | Severity 1–5 → token score (severity 1 is dropped, omissions/additions score 1.0) |
| `lang_names` | Language names used in the prompt |

Apertus answers with JSON: `{"differences": [{"a", "b", "type", "severity", "explanation"}]}`. The benchmark runs at temperature 0 (sample 1) and 0.7 (samples 2–3), `max_tokens` 2000. Apertus is also used, with small task prompts in the extension, to match translated admin.ch URLs, to turn an RTS headline into SRF search queries and pick the same story, and to pick the translated sibling of a parliamentary PDF. No other model is used.

## Checks

| Check | Where |
|---|---|
| Span → token projection (exact spans, apostrophes, `�` characters, missing sides) | `tests/test_rsd.py` |
| Severity mapping, number-mismatch prior, JSON parsing (fenced or bare) | `tests/test_rsd.py` |
| The metric: Spearman on known values, pooling drops gold = −1 and pads predictions (as the official `evaluate_predictions_admin.py`) | `tests/test_rsd.py` |
| Extension integrity: the prompt is shared, every manifest file exists, every message has a background handler, no control characters in sources | `tests/test_rsd.py` |
| End to end in Firefox on live sites (federal, bilingual canton, RTS→SRF, parlament.ch and Fedlex PDFs) | [technical_report.md](technical_report.md) §5 |

## Samples

* **Dev outputs** (re-scored by `make run`, no API needed): [`predictions/dev_70b_n1/`](predictions/dev_70b_n1) and [`predictions/dev_70b_n3/`](predictions/dev_70b_n3), with `scores_dev.json`.
* **Test predictions** (submitted): [`predictions/test_70b_n3/`](predictions/test_70b_n3), 56 documents per language.
* **One real Apertus answer** (`predictions/dev_70b_n1/raw_fr.jsonl`, document `admin_fr_32`, EN ↔ FR). The French version adds a clause the English one leaves out:

```json
{
  "a": "Each year about 1,700 A4 pages of text are translated into Romansh.",
  "b": "Chaque année, quelque 1700 pages A4 sont traduites en romanche, deux tiers d’entre elles étant confiées à la Chancellerie d’État des Grisons.",
  "type": "number|scope",
  "severity": 4,
  "explanation": "TEXT A states the total number of pages translated annually without specifying distribution; TEXT B adds that two-thirds are sent to the cantonal chancellery, altering the scope of distribution."
}
```

* **Compare any two texts yourself** (needs `LLM_API_KEY`):

```bash
cd src && python -m roestibridge compare --a page_fr.txt --b page_de.txt --lang-a fr --lang-b de --explain en
```

## Layout

```
src/extension/      Firefox extension (MV2): background.js, content/{gov,rts,highlight,extract}.js, pdf/ viewer, options/
src/extension/shared/prompt.json   the ONE prompt used by both the extension and the benchmark
src/roestibridge/   Python pipeline: llm.py (stdlib client), rsd.py (prompt -> spans -> token scores), metrics.py, cli.py
predictions/        dev/test outputs (raw model answers + token labels)
tests/              unit tests (projection, metric parity, parsing, manifest integrity)
docs/               screenshots and the report PDF
```
