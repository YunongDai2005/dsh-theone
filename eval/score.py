"""Score routing predictions on InterleaveBench.

    python eval/score.py eval/data/interleave-v0/sessions.jsonl eval/data/interleave-v0/predictions/*.jsonl

Predictions are JSONL rows {session_id, i, pred, refs?, usage?, elapsed_ms?, mode?}. `pred` is the
topic the system chose: a thread id in closed mode, any label of the system's own in open mode, or
CLARIFY / ERROR. Standard library only, so it runs unchanged in a Kaggle notebook.
"""
from __future__ import annotations

import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

# What a wrong route costs the user: work sent into another topic's context is the worst outcome.
COST = {"correct": 0, "wrong_existing": 3, "merged_new": 3, "spurious_new": 1, "clarify": 1, "error": 1}
SPECIAL = {"CLARIFY", "ERROR"}


def read_jsonl(path):
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def hungarian(weights):
    """Maximum-weight one-to-one matching of rows to columns; returns {row: column}."""
    rows, cols = len(weights), len(weights[0]) if weights else 0
    if not rows or not cols:
        return {}
    try:
        from scipy.optimize import linear_sum_assignment
        r, c = linear_sum_assignment([[-w for w in row] for row in weights])
        return {int(a): int(b) for a, b in zip(r, c) if weights[a][b] > 0}
    except ImportError:
        pass
    n = max(rows, cols)
    cost = [[-(weights[i][j] if i < rows and j < cols else 0) for j in range(n)] for i in range(n)]
    u, v, p, way = [0] * (n + 1), [0] * (n + 1), [0] * (n + 1), [0] * (n + 1)
    for i in range(1, n + 1):
        p[0], j0 = i, 0
        minv, used = [math.inf] * (n + 1), [False] * (n + 1)
        while True:
            used[j0], i0, delta, j1 = True, p[j0], math.inf, 0
            for j in range(1, n + 1):
                if not used[j]:
                    cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
                    if cur < minv[j]:
                        minv[j], way[j] = cur, j0
                    if minv[j] < delta:
                        delta, j1 = minv[j], j
            for j in range(n + 1):
                if used[j]:
                    u[p[j]] += delta
                    v[j] -= delta
                else:
                    minv[j] -= delta
            j0 = j1
            if p[j0] == 0:
                break
        while j0:
            j1 = way[j0]
            p[j0], j0 = p[j1], j1
    match = {}
    for j in range(1, n + 1):
        i, jj = p[j] - 1, j - 1
        if i < rows and jj < cols and weights[i][jj] > 0:
            match[i] = jj
    return match


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def score_session(session, rows, mode):
    """Per-message outcomes for one session, with predicted labels mapped onto gold threads."""
    by_i = {row["i"]: row for row in rows}
    turns = session["turns"]
    gold_ids = {thread["id"] for thread in session["threads"]}
    # Open mode: the system's own labels are matched one-to-one to gold threads by overlap.
    mapping = {}
    if mode == "open":
        golds = sorted(gold_ids)
        preds = sorted({by_i[t["i"]]["pred"] for t in turns if t["i"] in by_i and by_i[t["i"]]["pred"] not in SPECIAL})
        counts = Counter((t["gold"]["thread"], by_i[t["i"]]["pred"]) for t in turns
                         if t["gold"]["thread"] and t["i"] in by_i)
        match = hungarian([[counts[(g, p)] for p in preds] for g in golds])
        mapping = {preds[j]: golds[i] for i, j in match.items()}
    to_gold = (lambda label: mapping.get(label)) if mode == "open" else (lambda label: label if label in gold_ids else None)

    # Each route is judged by what the chosen topic held so far: sending a message into a topic that is
    # mostly another thread is what pollutes context. Catalog topics (closed mode) start as their thread.
    held = defaultdict(Counter)
    if mode == "closed":
        for thread_id in gold_ids:
            held[thread_id][thread_id] = 1_000_000
    outcomes = []
    seen_gold = set()
    for t in turns:
        row = by_i.get(t["i"])
        gold = t["gold"]["thread"]
        pred = row["pred"] if row else "ERROR"
        mapped = to_gold(pred) if pred not in SPECIAL else None
        fresh = pred not in SPECIAL and not held[pred]
        if gold is None:
            kind = "oneoff_isolated" if (fresh or pred in SPECIAL) else "oneoff_into_topic"
        elif pred == "CLARIFY":
            kind = "clarify"
        elif pred == "ERROR":
            kind = "error"
        elif fresh:
            kind = "correct" if gold not in seen_gold and mode == "open" else "spurious_new"
        else:
            majority = held[pred].most_common(1)[0][0]
            kind = "correct" if majority == gold else "merged_new" if gold not in seen_gold else "wrong_existing"
        if gold is not None:
            seen_gold.add(gold)
            if pred not in SPECIAL:
                held[pred][gold] += 1
        refs = [to_gold(r) for r in (row or {}).get("refs", [])]
        accurate = gold is not None and mapped == gold
        outcomes.append({"turn": t, "row": row, "pred": pred, "mapped": mapped, "kind": kind, "accurate": accurate, "refs": refs})
    return outcomes, mapping


def bcubed(pairs):
    """B-cubed precision/recall over (gold, pred) cluster labels."""
    by_gold, by_pred = defaultdict(list), defaultdict(list)
    for index, (g, p) in enumerate(pairs):
        by_gold[g].append(index)
        by_pred[p].append(index)
    precision = recall = 0.0
    for g, p in pairs:
        same_pred, same_gold = by_pred[p], by_gold[g]
        overlap = sum(1 for k in same_pred if pairs[k][0] == g)
        precision += overlap / len(same_pred)
        recall += overlap / len(same_gold)
    n = len(pairs) or 1
    p, r = precision / n, recall / n
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def evaluate(sessions, predictions, split="dev"):
    sessions = [s for s in sessions if split == "all" or s["split"] == split]
    rows_by_session = defaultdict(list)
    for row in predictions:
        rows_by_session[row["session_id"]].append(row)
    mode = next((row.get("mode") for row in predictions if row.get("mode")), "closed")
    kinds, strict_kinds, strict, lenient = Counter(), Counter(), [0, 0], [0, 0]
    by_action, by_tag, by_lang = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    switch, refs = Counter(), [0, 0]
    fragments, merges, pairs = [], [], []
    tokens = Counter()
    latency = []
    covered = 0
    for session in sessions:
        rows = rows_by_session.get(session["session_id"], [])
        if not rows:
            continue
        covered += 1
        outcomes, _ = score_session(session, rows, mode)
        prev_gold = prev_pred = None
        topics_per_gold, golds_per_topic = defaultdict(set), defaultdict(set)
        for o in outcomes:
            t, kind, row = o["turn"], o["kind"], o["row"] or {}
            usage = row.get("usage") or {}
            tokens["input"] += usage.get("input", 0)
            tokens["output"] += usage.get("output", 0)
            tokens["cache_hit"] += usage.get("cache_hit", 0)
            tokens["calls"] += 1 if usage else 0
            tokens["messages"] += 1
            if "elapsed_ms" in row and row.get("via", "llm") == "llm":
                latency.append(row["elapsed_ms"])
            kinds[kind] += 1
            if not t["ambiguous"]:
                strict_kinds[kind] += 1
            gold = t["gold"]["thread"]
            if gold is None:
                continue
            ok = o["accurate"]
            judge = (t.get("judge") or {}).get("thread")
            if not t["ambiguous"]:
                strict[0] += ok
                strict[1] += 1
            lenient[0] += ok or (t["ambiguous"] and judge not in (None, "ambiguous", "none") and o["mapped"] == judge)
            lenient[1] += 1
            # Breakdowns use the same messages as strict accuracy.
            if not t["ambiguous"]:
                for bucket, key in ((by_action, t["gold"]["action"]), (by_lang, session["lang"])):
                    bucket[key][0] += ok
                    bucket[key][1] += 1
                for tag in t["tags"]:
                    by_tag[tag][0] += ok
                    by_tag[tag][1] += 1
            # A switch is any change of thread between consecutive thread messages.
            gold_switch = prev_gold is not None and gold != prev_gold
            pred_switch = prev_pred is not None and o["pred"] != prev_pred and o["pred"] not in SPECIAL
            switch["tp"] += gold_switch and pred_switch
            switch["fp"] += pred_switch and not gold_switch
            switch["fn"] += gold_switch and not pred_switch
            prev_gold = gold
            if o["pred"] not in SPECIAL:
                prev_pred = o["pred"]
                topics_per_gold[gold].add(o["pred"])
                golds_per_topic[o["pred"]].add(gold)
                pairs.append((f"{session['session_id']}/{gold}", f"{session['session_id']}/{o['pred']}"))
            if t["gold"]["refs"]:
                refs[1] += 1
                refs[0] += any(r in t["gold"]["refs"] for r in o["refs"] if r)
        fragments += [len(v) for v in topics_per_gold.values()]
        merges += [len(v) for v in golds_per_topic.values()]

    def rate(pair):
        return round(pair[0] / pair[1], 4) if pair[1] else None

    # Weighted error uses the same messages as strict accuracy: those a careful reader agrees on.
    thread_messages = sum(v for k, v in strict_kinds.items() if not k.startswith("oneoff"))
    weighted = sum(COST.get(k, 0) * v for k, v in strict_kinds.items() if not k.startswith("oneoff"))
    oneoffs = kinds["oneoff_isolated"] + kinds["oneoff_into_topic"]
    sp, sr, sf = prf(switch["tp"], switch["fp"], switch["fn"])
    bp, br, bf = bcubed(pairs)
    latency.sort()
    result = {
        "mode": mode, "split": split, "sessions": covered, "messages": tokens["messages"],
        "accuracy": rate(strict), "accuracy_lenient": rate(lenient),
        "weighted_error": round(weighted / thread_messages, 4) if thread_messages else None,
        "ambiguous_share": round(1 - strict[1] / lenient[1], 4) if lenient[1] else None,
        "outcomes": dict(kinds),
        "oneoff_into_topic": round(kinds["oneoff_into_topic"] / oneoffs, 4) if oneoffs else None,
        "switch": {"precision": round(sp, 4), "recall": round(sr, 4), "f1": round(sf, 4)},
        "bcubed": {"precision": round(bp, 4), "recall": round(br, 4), "f1": round(bf, 4)},
        "topics_per_thread": round(sum(fragments) / len(fragments), 3) if fragments else None,
        "threads_per_topic": round(sum(merges) / len(merges), 3) if merges else None,
        "refs_recall": rate(refs),
        "by_action": {k: rate(v) for k, v in sorted(by_action.items())},
        "by_tag": {k: rate(v) for k, v in sorted(by_tag.items())},
        "by_lang": {k: rate(v) for k, v in sorted(by_lang.items())},
        "tokens_per_message": {k: round(tokens[k] / tokens["messages"], 1) for k in ("input", "output", "cache_hit")} if tokens["messages"] else {},
        "model_calls_share": round(tokens["calls"] / tokens["messages"], 3) if tokens["messages"] else None,
        "latency_ms": {"p50": latency[len(latency) // 2], "p90": latency[int(len(latency) * 0.9)]} if latency else None,
    }
    return result


def table(results):
    """A compact markdown comparison of several systems."""
    cols = [("accuracy", "acc"), ("accuracy_lenient", "acc (lenient)"), ("weighted_error", "weighted err"),
            ("oneoff_into_topic", "one-off into topic"), ("topics_per_thread", "topics/thread"), ("threads_per_topic", "threads/topic"),
            ("refs_recall", "refs recall")]
    lines = ["| system | mode | " + " | ".join(c[1] for c in cols) + " | switch F1 | B³ F1 | input tok/msg |",
             "|---" * (len(cols) + 5) + "|"]
    for name, r in results:
        cells = ["–" if r.get(k) is None else f"{r[k]:.3f}" if isinstance(r[k], float) else str(r[k]) for k, _ in cols]
        lines.append(f"| {name} | {r['mode']} | " + " | ".join(cells)
                     + f" | {r['switch']['f1']:.3f} | {r['bcubed']['f1']:.3f} | {r['tokens_per_message'].get('input', 0):.0f} |")
    return "\n".join(lines)


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    split = "dev"
    if "--split" in argv:
        index = argv.index("--split")
        split = argv[index + 1]
        argv = argv[:index] + argv[index + 2:]
    sessions = read_jsonl(argv[1])
    results = []
    for path in argv[2:]:
        r = evaluate(sessions, read_jsonl(path), split)
        results.append((Path(path).stem, r))
        Path(path).with_suffix(".score.json").write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(table(results))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
