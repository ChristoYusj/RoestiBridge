<p align="center"><img src="track_2a/src/extension/icons/icon-128.png" alt="RöstiBridge logo" width="128"></p>

# RöstiBridge — Hack Apertus 2026 · Track 2A · UZH: Cross-Lingual Semantic Differences

**Team RedPandas** — Christopher Yazigi, Giovanni Yazbeck, Alfredo Pio Yazbeck

A bridge over the *Röstigraben*: a Firefox extension that highlights where the language versions of an official Swiss
page (federal, cantonal, RTS news, parliamentary PDFs) do not say the same thing, with the other version quoted and the
difference explained by Apertus. The same Apertus prompt is benchmarked on SwissGov-RSD (macro token-level Spearman
**0.131** on the dev subset, against 0.083 for a model-free baseline).

➡ **Project:** [`track_2a/`](track_2a) · [README](track_2a/README.md) · [technical report](track_2a/technical_report.md)
([PDF](track_2a/docs/RedPandas_RoestiBridge_Report.pdf)) · [prompt](track_2a/src/extension/shared/prompt.json)
· [extension](track_2a/dist)

```bash
cd track_2a && make run      # Docker; needs no key to reproduce the scores (LLM_API_KEY adds a live Apertus run)
```

Licence: see [LICENSE](LICENSE).
