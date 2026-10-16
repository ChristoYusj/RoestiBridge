"""Recognition of semantic differences (RSD): prompt Apertus for difference spans, project them onto tokens.

The prompt lives in src/extension/shared/prompt.json so the Firefox extension and this
benchmark pipeline use the exact same instructions.
"""
from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from pathlib import Path

from .llm import chat

PROMPT_PATH = Path(__file__).resolve().parent.parent / "extension" / "shared" / "prompt.json"
PROMPT = json.loads(PROMPT_PATH.read_text(encoding="utf-8"))

_PIECE = re.compile(r"[\w�]+", re.UNICODE)
_DIGITS = re.compile(r"\d")


def pieces(text: str) -> list[str]:
    return [p.lower() for p in _PIECE.findall(text)]


def token_pieces(tokens: list[str]) -> tuple[list[str], list[int]]:
    """Flatten tokens into normalised word pieces, remembering which token each piece came from."""
    flat, owner = [], []
    for i, t in enumerate(tokens):
        for p in pieces(t):
            flat.append(p)
            owner.append(i)
    return flat, owner


def build_messages(text_a: str, text_b: str, lang_a: str, lang_b: str, explain_lang: str = "en") -> list[dict]:
    names = PROMPT["lang_names"]
    user = (PROMPT["user_template"]
            .replace("{lang_a}", names.get(lang_a, lang_a))
            .replace("{lang_b}", names.get(lang_b, lang_b))
            .replace("{explain_lang}", names.get(explain_lang, explain_lang))
            .replace("{text_a}", text_a)
            .replace("{text_b}", text_b))
    return [{"role": "system", "content": PROMPT["system"]}, {"role": "user", "content": user}]


def parse_differences(content: str) -> list[dict]:
    """Tolerant JSON parse: accepts fenced blocks, a bare list, or trailing junk."""
    s = content.strip()
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s)
    for candidate in (s, s[s.find("{"): s.rfind("}") + 1], s[s.find("["): s.rfind("]") + 1]):
        try:
            obj = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict):
            obj = obj.get("differences", [])
        if isinstance(obj, list):
            return [d for d in obj if isinstance(d, dict)]
    return []


def severity_score(d: dict) -> float:
    try:
        sev = int(round(float(d.get("severity", 3))))
    except (TypeError, ValueError):
        sev = 3
    sev = min(5, max(1, sev))
    return PROMPT["severity_to_score"][str(sev)]


def locate(span: str, flat: list[str]) -> list[tuple[int, int]]:
    """Return piece ranges [start, end) where the excerpt occurs (exact, else best fuzzy block)."""
    sp = pieces(span)
    if not sp:
        return []
    n, m = len(flat), len(sp)
    hits = [(i, i + m) for i in range(n - m + 1) if flat[i:i + m] == sp]
    if hits:
        return hits
    sm = SequenceMatcher(None, flat, sp, autojunk=False)
    blk = sm.find_longest_match(0, n, 0, m)
    if blk.size >= max(1, (m + 1) // 2) and not (blk.size == 1 and len(sp[blk.b]) <= 3):
        start = max(0, blk.a - blk.b)
        return [(start, min(n, start + m))]
    return []


# Post-processing chosen on the dev subset (see docs/ablations.md): severity-1 items are mostly
# "same meaning, different wording" noise; omissions/additions are scored as full differences.
MIN_SEVERITY = 2
FULL_TYPES = ("omission", "addition")


def project(diffs: list[dict], tokens: list[str], side: str, *, min_severity: int = MIN_SEVERITY,
            type_boost: bool = True) -> list[float]:
    flat, owner = token_pieces(tokens)
    scores = [0.0] * len(tokens)
    for d in diffs:
        span = d.get(side) or ""
        if not isinstance(span, str) or not span.strip():
            continue
        sc = severity_score(d)
        if sc * 5 < min_severity - 1e-9:
            continue
        if type_boost and str(d.get("type", "")).lower() in FULL_TYPES:
            sc = 1.0
        for s, e in locate(span, flat):
            for k in range(s, e):
                t = owner[k]
                scores[t] = max(scores[t], sc)
    return scores


def number_prior(tokens: list[str], other_text: str, weight: float = 0.5) -> list[float]:
    """Tokens holding a number that never occurs in the other version (cheap, model-free)."""
    other_nums = set(re.findall(r"\d+", other_text.replace("'", "").replace("’", "")))
    out = []
    for t in tokens:
        nums = re.findall(r"\d+", t)
        out.append(weight if nums and any(x not in other_nums for x in nums) else 0.0)
    return out


def predict_pair(item: dict, cfg: dict, lang_b: str, *, samples: int = 1, use_number_prior: bool = True) -> dict:
    """Score one SwissGov-RSD item. Returns labels for both sides plus the raw differences."""
    ta, tb = item["text_a"].split(), item["text_b"].split()
    msgs = build_messages(item.get("text_a_untokenized") or item["text_a"],
                          item.get("text_b_untokenized") or item["text_b"], "en", lang_b)
    all_a, all_b, raws, usage_tot = [0.0] * len(ta), [0.0] * len(tb), [], {"prompt_tokens": 0, "completion_tokens": 0}
    for s in range(samples):
        content, usage = chat(msgs, cfg, temperature=0.0 if s == 0 else 0.7)
        for k in usage_tot:
            usage_tot[k] += int(usage.get(k, 0) or 0)
        diffs = parse_differences(content)
        raws.append({"content": content, "differences": diffs})
        la, lb = project(diffs, ta, "a"), project(diffs, tb, "b")
        all_a = [x + y / samples for x, y in zip(all_a, la)]
        all_b = [x + y / samples for x, y in zip(all_b, lb)]
    if use_number_prior:
        all_a = [max(x, y) for x, y in zip(all_a, number_prior(ta, item["text_b"]))]
        all_b = [max(x, y) for x, y in zip(all_b, number_prior(tb, item["text_a"]))]
    return {"id": item["id"], "labels_a": all_a, "labels_b": all_b, "raw": raws, "usage": usage_tot}


def rescore(pred: dict, item: dict, *, use_number_prior: bool) -> dict:
    """Recompute token labels from stored raw model output (no API calls)."""
    ta, tb = item["text_a"].split(), item["text_b"].split()
    n = len(pred["raw"])
    la, lb = [0.0] * len(ta), [0.0] * len(tb)
    for r in pred["raw"]:
        la = [x + y / n for x, y in zip(la, project(r["differences"], ta, "a"))]
        lb = [x + y / n for x, y in zip(lb, project(r["differences"], tb, "b"))]
    if use_number_prior:
        la = [max(x, y) for x, y in zip(la, number_prior(ta, item["text_b"]))]
        lb = [max(x, y) for x, y in zip(lb, number_prior(tb, item["text_a"]))]
    return {"id": pred["id"], "labels_a": la, "labels_b": lb}
