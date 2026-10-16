"""Token-level Spearman as in ZurichNLP/SwissGov-RSD scripts/evaluate_predictions_admin.py:
per language, pool all tokens of side A and side B (unless B is all -1), drop gold == -1,
pad/truncate predictions to gold length with 0.0, global Spearman; macro-average over languages."""
from __future__ import annotations


def _ranks(xs: list[float]) -> list[float]:
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        avg = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = avg
        i = j + 1
    return ranks


def spearman(x: list[float], y: list[float]) -> float:
    rx, ry = _ranks(x), _ranks(y)
    n = len(x)
    if n < 2:
        return float("nan")
    mx, my = sum(rx) / n, sum(ry) / n
    cov = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    vx = sum((a - mx) ** 2 for a in rx) ** 0.5
    vy = sum((b - my) ** 2 for b in ry) ** 0.5
    return cov / (vx * vy) if vx and vy else float("nan")


def _fit(pred: list[float], n: int) -> list[float]:
    pred = list(pred)[:n]
    return pred + [0.0] * (n - len(pred))


def pooled(preds: dict[str, dict], gold_items: list[dict]) -> tuple[list[float], list[float]]:
    P, G = [], []
    for g in gold_items:
        p = preds.get(g["id"])
        if p is None:
            continue
        for side in ("a", "b"):
            gl = g[f"labels_{side}"]
            if side == "b" and all(v == -1 for v in gl):
                continue
            pl = _fit(p[f"labels_{side}"], len(gl))
            for pv, gv in zip(pl, gl):
                if gv != -1:
                    P.append(float(pv))
                    G.append(float(gv))
    return P, G


def score_language(preds: dict[str, dict], gold_items: list[dict]) -> float:
    P, G = pooled(preds, gold_items)
    return spearman(P, G)
