"""Dev-only post-processing ablations over stored raw outputs (no API calls)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from . import metrics, rsd
from .cli import LANGS, load, subsample


def line_owner(untok: str, tokens: list[str]) -> list[int]:
    """Map each token to the index of the source line it came from (via word pieces)."""
    flat, owner = rsd.token_pieces(tokens)
    line_of_piece, li = [], 0
    for li, line in enumerate(untok.split("\n")):
        line_of_piece += [li] * len(rsd.pieces(line))
    out = [0] * len(tokens)
    for k, t in enumerate(owner):
        out[t] = line_of_piece[min(k, len(line_of_piece) - 1)] if line_of_piece else 0
    return out


def variant(item, raw, side, *, ctx=0.0, binary=False, prior=True, type_boost=False):
    toks = item[f"text_{side}"].split()
    diffs = []
    for r in raw["raw"]:
        for d in r["differences"]:
            d = dict(d)
            if binary:
                d["severity"] = 5
            if type_boost and str(d.get("type", "")).lower() in ("omission", "addition"):
                d["severity"] = 5
            diffs.append(d)
    sc = rsd.project(diffs, toks, side)
    if ctx:
        lo = line_owner(item.get(f"text_{side}_untokenized") or "", toks)
        hot = {lo[i] for i, v in enumerate(sc) if v > 0}
        sc = [v if v > 0 else (ctx if lo[i] in hot else 0.0) for i, v in enumerate(sc)]
    if prior:
        other = item["text_b" if side == "a" else "text_a"]
        sc = [max(x, y) for x, y in zip(sc, rsd.number_prior(toks, other))]
    return sc


def main(pred_dir: str) -> None:
    pred_dir = Path(pred_dir)
    cfg = json.loads((pred_dir / "run_config.json").read_text(encoding="utf-8"))
    data = {}
    for lang in LANGS:
        items = subsample(load("dev", lang), cfg.get("limit"))
        raw = {json.loads(x)["id"]: json.loads(x) for x in (pred_dir / f"raw_{lang}.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()}
        data[lang] = (items, raw)
    grid = {
        "base": {}, "binary": {"binary": True}, "type_boost": {"type_boost": True},
        "ctx0.1": {"ctx": 0.1}, "ctx0.1+type": {"ctx": 0.1, "type_boost": True}, "no_prior": {"prior": False},
    }
    for name, kw in grid.items():
        per = {}
        for lang, (items, raw) in data.items():
            preds = {it["id"]: {"labels_a": variant(it, raw[it["id"]], "a", **kw), "labels_b": variant(it, raw[it["id"]], "b", **kw)}
                     for it in items if it["id"] in raw}
            per[lang] = round(metrics.score_language(preds, items), 4)
        print(f"{name:14s} {per}  macro={sum(per.values())/3:.4f}")


if __name__ == "__main__":
    main(sys.argv[1])
