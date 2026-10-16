# Predictions

**For judging, use `submission/`.** Everything else is the evidence behind the numbers in the report.

| Folder | What it is |
|---|---|
| `submission/` | **The submitted predictions.** `RoestiBridge_Apertus-70B_admin_{de,fr,it}.jsonl.jsonl`, 224 documents per language (dev + test) in the official full-set order and `EncoderPrediction` schema. Score with `python -m scripts.evaluate_predictions_admin <path>/RoestiBridge_Apertus-70B_admin_ --split test`. |
| `test_70b_n3/` | Test split (56 docs/lang), Apertus-70B, 3 samples: the raw model answers behind `submission/`. |
| `dev_70b_n3_full/` | Full dev split (168 docs/lang), same setting. Official scorer: DE 0.210, FR 0.165, IT 0.204 (macro 0.193). |
| `dev_70b_n3/` | The 40-docs-per-language dev subset used during development (macro 0.131). |
| `dev_70b_n1/`, `test_70b_n1/` | Single-sample runs (temperature 0), kept for the ablation in the report. |

Each run folder has `raw_<lang>.jsonl` (Apertus' JSON answers and token usage), `predictions_<lang>.jsonl` (token labels) and `run_config.json`. `make run` rebuilds `submission/` from the raw answers without API calls and checks that it matches.
