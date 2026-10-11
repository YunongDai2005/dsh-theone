"""Routing baselines for InterleaveBench that need no model, in the same prediction format as run-router.mjs.

    python eval/baselines.py eval/data/interleave-v0/sessions.jsonl

  oracle         the gold thread (checks the scorer: every metric should be perfect)
  single         one topic for everything: the plain single-session chat
  always_new     every message gets a fresh topic: no context, no pollution
  stay           closed: keep the previous topic, choosing by keywords only for the first message
  bm25           keyword match against each topic's title, description and the messages routed there;
                 below a threshold the current topic is kept (open mode: a long message starts a new one)
"""
from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter
from pathlib import Path


def tokens(text):
    """English words and Chinese character pairs, lowercased."""
    text = text.lower()
    words = re.findall(r"[a-z0-9][a-z0-9_.+#-]+", text)
    for run in re.findall(r"[一-鿿]+", text):
        words += [run] if len(run) == 1 else [run[k:k + 2] for k in range(len(run) - 1)]
    return words


class BM25:
    def __init__(self, k1=1.2, b=0.75):
        self.docs, self.k1, self.b = {}, k1, b

    def add(self, key, text):
        self.docs.setdefault(key, Counter()).update(tokens(text))

    def scores(self, query):
        if not self.docs:
            return {}
        n, avg = len(self.docs), sum(sum(d.values()) for d in self.docs.values()) / len(self.docs)
        df = Counter(term for d in self.docs.values() for term in d)
        result = {}
        for key, doc in self.docs.items():
            length, total = sum(doc.values()), 0.0
            for term in set(tokens(query)):
                if term in doc:
                    idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
                    tf = doc[term]
                    total += idf * tf * (self.k1 + 1) / (tf + self.k1 * (1 - self.b + self.b * length / (avg or 1)))
            result[key] = total
        return result


def route(session, system, mode, threshold=1.5, new_min_tokens=6):
    rows, current, created = [], None, 0
    index = BM25()
    if mode == "closed":
        for thread in session["threads"]:
            index.add(thread["id"], f"{thread['title']} {thread['description']} {thread['goal']}")
    for turn in session["turns"]:
        text = turn["text"]
        if system == "oracle":
            gold = turn["gold"]["thread"]
            if gold is None:
                created += 1
            pred = gold if gold else f"oneoff{created}"
        elif system == "single":
            pred = "p1"
        elif system == "always_new":
            created += 1
            pred = f"p{created}"
        else:
            ranked = sorted(index.scores(text).items(), key=lambda item: -item[1])
            best = ranked[0] if ranked else (None, 0.0)
            if system == "stay" and current is not None:
                pred = current
            elif best[0] is not None and (best[1] >= threshold or current is None and mode == "closed"):
                pred = best[0]
            elif mode == "open" and (current is None or len(tokens(text)) >= new_min_tokens):
                created += 1
                pred = f"p{created}"
            else:
                pred = current
            index.add(pred, text)
        current = pred
        refs = turn["gold"]["refs"] if system == "oracle" else []
        rows.append({"session_id": session["session_id"], "i": turn["i"], "mode": mode, "policy": system, "pred": pred, "refs": refs})
    return rows


SYSTEMS = {"closed": ["oracle", "stay", "bm25"], "open": ["oracle", "single", "always_new", "bm25"]}


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    data = Path(argv[1])
    sessions = [json.loads(line) for line in data.read_text(encoding="utf-8").splitlines() if line.strip()]
    out = data.parent / "predictions"
    out.mkdir(exist_ok=True)
    for mode, systems in SYSTEMS.items():
        for system in systems:
            rows = [row for session in sessions for row in route(session, system, mode)]
            path = out / f"{mode}-{system}.jsonl"
            path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
            print(f"{path} ({len(rows)} messages)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
