"""RöstiBridge CLI: SwissGov-RSD predictions + evaluation, and ad-hoc text comparison.

  python -m roestibridge download
  python -m roestibridge predict  --split dev --limit 40 [--langs de,fr,it] [--workers 8]
  python -m roestibridge evaluate --split dev --pred predictions/dev/<model>
  python -m roestibridge baseline --split dev
  python -m roestibridge compare  --a a.txt --b b.txt --lang-a fr --lang-b de
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import metrics, rsd
from .llm import LLMError, chat, config_from_env

ROOT = Path(__file__).resolve().parents[2]           # track_2a/
DATA = ROOT / "data" / "swissgov-rsd"
HF = "https://huggingface.co/datasets/ZurichNLP/SwissGov-RSD/resolve/main/data/{lang}/{split}_{lang}.jsonl"
LANGS = ["de", "fr", "it"]


def load(split: str, lang: str) -> list[dict]:
    p = DATA / f"{split}_{lang}.jsonl"
    if not p.exists():
        download([lang], [split])
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


def subsample(items: list[dict], limit: int | None) -> list[dict]:
    if not limit or limit >= len(items):
        return items
    step = len(items) / limit
    return [items[int(i * step)] for i in range(limit)]


def download(langs=LANGS, splits=("dev", "test")) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for lang in langs:
        for split in splits:
            p = DATA / f"{split}_{lang}.jsonl"
            if p.exists() and p.stat().st_size > 0:
                continue
            print(f"downloading {split}_{lang} ...", file=sys.stderr)
            urllib.request.urlretrieve(HF.format(lang=lang, split=split), p)


def model_slug(cfg: dict) -> str:
    return cfg["model"].replace("/", "__")


def cmd_predict(a) -> None:
    cfg = config_from_env()
    if not cfg["api_key"]:
        sys.exit("LLM_API_KEY is not set")
    out_dir = Path(a.out or ROOT / "predictions" / a.split / model_slug(cfg))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "run_config.json").write_text(json.dumps({
        "model": cfg["model"], "base_url": cfg["base_url"], "prompt_version": rsd.PROMPT["version"],
        "split": a.split, "limit": a.limit, "samples": a.samples, "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }, indent=2), encoding="utf-8")
    for lang in a.langs.split(","):
        items = subsample(load(a.split, lang), a.limit)
        raw_path = out_dir / f"raw_{lang}.jsonl"
        done = set()
        if raw_path.exists():
            done = {json.loads(x)["id"] for x in raw_path.read_text(encoding="utf-8").splitlines() if x.strip()}
        todo = [it for it in items if it["id"] not in done]
        print(f"[{lang}] {len(items)} items, {len(todo)} to run", file=sys.stderr)
        with ThreadPoolExecutor(a.workers) as ex, raw_path.open("a", encoding="utf-8") as fh:
            futs = {ex.submit(rsd.predict_pair, it, cfg, lang, samples=a.samples): it["id"] for it in todo}
            for i, f in enumerate(as_completed(futs), 1):
                try:
                    r = f.result()
                except LLMError as e:
                    print(f"  {futs[f]} FAILED: {e}", file=sys.stderr)
                    continue
                fh.write(json.dumps(r, ensure_ascii=False) + "\n")
                fh.flush()
                if i % 10 == 0:
                    print(f"  {i}/{len(todo)}", file=sys.stderr)
        write_labels(out_dir, lang, items, use_number_prior=True)


def write_labels(out_dir: Path, lang: str, items: list[dict], *, use_number_prior: bool) -> dict:
    raw = {}
    raw_path = out_dir / f"raw_{lang}.jsonl"
    if raw_path.exists():
        for x in raw_path.read_text(encoding="utf-8").splitlines():
            if x.strip():
                r = json.loads(x)
                raw[r["id"]] = r
    preds = {}
    with (out_dir / f"predictions_{lang}.jsonl").open("w", encoding="utf-8") as fh:
        for it in items:
            if it["id"] in raw:
                p = rsd.rescore(raw[it["id"]], it, use_number_prior=use_number_prior)
            else:  # missing -> all zeros, so the file always covers every item
                p = {"id": it["id"], "labels_a": [0.0] * len(it["text_a"].split()),
                     "labels_b": [0.0] * len(it["text_b"].split())}
            preds[it["id"]] = p
            # same schema as EncoderPrediction in ZurichNLP/SwissGov-RSD evaluation/utils.py
            fh.write(json.dumps({"id": p["id"], "text_a": it["text_a"], "text_b": it["text_b"],
                                 "labels_a": p["labels_a"], "labels_b": p["labels_b"]}, ensure_ascii=False) + "\n")
    return preds


def cmd_evaluate(a) -> None:
    if a.split == "test":
        sys.exit("refusing to evaluate on the test split (challenge rule: test labels are not used)")
    pred_dir = Path(a.pred)
    cfg = json.loads((pred_dir / "run_config.json").read_text(encoding="utf-8"))
    res = {}
    for variant, prior in (("llm_only", False), ("llm+number_prior", True)):
        per = {}
        for lang in LANGS:
            if not (pred_dir / f"raw_{lang}.jsonl").exists():
                continue
            items = subsample(load(a.split, lang), cfg.get("limit"))
            preds = write_labels(pred_dir, lang, items, use_number_prior=prior)
            per[lang] = round(metrics.score_language(preds, items), 4)
        per["macro"] = round(sum(per.values()) / len(per), 4) if per else None
        res[variant] = per
    print(json.dumps(res, indent=2))
    (pred_dir / f"scores_{a.split}.json").write_text(json.dumps(res, indent=2), encoding="utf-8")


def cmd_relabel(a) -> None:
    """Rewrite predictions_<lang>.jsonl from stored raw outputs with the current post-processing (no API calls, no gold)."""
    pred_dir = Path(a.pred)
    cfg = json.loads((pred_dir / "run_config.json").read_text(encoding="utf-8"))
    for lang in LANGS:
        if (pred_dir / f"raw_{lang}.jsonl").exists():
            items = subsample(load(cfg["split"], lang), cfg.get("limit"))
            write_labels(pred_dir, lang, items, use_number_prior=True)
            print(f"relabelled {lang}: {len(items)} items", file=sys.stderr)


def cmd_baseline(a) -> None:
    if a.split == "test":
        sys.exit("refusing to evaluate on the test split")
    per = {}
    for lang in LANGS:
        items = subsample(load(a.split, lang), a.limit)
        preds = {it["id"]: {"labels_a": rsd.number_prior(it["text_a"].split(), it["text_b"]),
                            "labels_b": rsd.number_prior(it["text_b"].split(), it["text_a"])} for it in items}
        per[lang] = round(metrics.score_language(preds, items), 4)
    per["macro"] = round(sum(per.values()) / 3, 4)
    print(json.dumps({"number_prior_only": per}, indent=2))


def cmd_compare(a) -> None:
    cfg = config_from_env()
    ta = Path(a.a).read_text(encoding="utf-8")
    tb = Path(a.b).read_text(encoding="utf-8")
    content, usage = chat(rsd.build_messages(ta, tb, a.lang_a, a.lang_b, a.explain), cfg)
    print(json.dumps({"differences": rsd.parse_differences(content), "usage": usage}, ensure_ascii=False, indent=2))


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(prog="roestibridge")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("download")
    p = sub.add_parser("predict")
    p.add_argument("--split", default="dev", choices=["dev", "test"])
    p.add_argument("--langs", default="de,fr,it")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--samples", type=int, default=1)
    p.add_argument("--out")
    e = sub.add_parser("evaluate")
    e.add_argument("--split", default="dev")
    e.add_argument("--pred", required=True)
    rl = sub.add_parser("relabel")
    rl.add_argument("--pred", required=True)
    b = sub.add_parser("baseline")
    b.add_argument("--split", default="dev")
    b.add_argument("--limit", type=int, default=None)
    c = sub.add_parser("compare")
    c.add_argument("--a", required=True)
    c.add_argument("--b", required=True)
    c.add_argument("--lang-a", default="fr")
    c.add_argument("--lang-b", default="de")
    c.add_argument("--explain", default="en")
    a = ap.parse_args(argv)
    if a.cmd == "download":
        download()
    else:
        {"predict": cmd_predict, "evaluate": cmd_evaluate, "relabel": cmd_relabel, "baseline": cmd_baseline, "compare": cmd_compare}[a.cmd](a)


if __name__ == "__main__":
    main()
