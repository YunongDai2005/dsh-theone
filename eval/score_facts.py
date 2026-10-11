"""Score shared-facts results from eval/run-facts.mjs and check the gates for releasing the feature.

    python eval/score_facts.py eval/data/interleave-v1/facts/deepseek-flash.jsonl [--json]

Rows are JSONL with a `kind`: answer (one per probe and strategy, already judged), delivery (each
line the facts strategy sent), route (one request routed with and without facts offered) and
session (token totals). Standard library only, so it runs unchanged in a Kaggle notebook.

Gates, all on the facts strategy:
  beats_summary      more probes right than with a summary of the other topic
  stale_answers      under 5% of the probes asked after a value changed are answered with the old value
  proposals_shared   no unconfirmed value is ever delivered to another topic
  routing_unchanged  under 2% changed, routing accuracy not lower, under 1% routing errors
"""
from __future__ import annotations

import json
import math
import sys
from collections import Counter, defaultdict

STRATEGIES = ["single", "own", "summary", "facts", "oracle"]
CATEGORIES = ["cross", "stale", "proposal", "rejected", "accepted"]
VERDICTS = ["correct", "stale", "proposal", "missing", "wrong"]
LIMITS = {"stale_answers": 0.05, "routing_changed": 0.02, "routing_errors": 0.01}


def read_jsonl(path):
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def wilson(hits, n, z=1.96):
    """95% interval for a proportion; (0, 1) when there is nothing to measure."""
    if not n:
        return (0.0, 1.0)
    p = hits / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (max(0.0, centre - half), min(1.0, centre + half))


def rate(hits, n):
    return hits / n if n else None


def evaluate(rows):
    answers = [row for row in rows if row["kind"] == "answer"]
    deliveries = [row for row in rows if row["kind"] == "delivery"]
    routes = [row for row in rows if row["kind"] == "route"]
    sessions = [row for row in rows if row["kind"] == "session"]
    errors = sum(row["kind"] == "error" for row in rows)
    identities = Counter((row.get("session_id", ""), row["probe"], row["strategy"]) for row in answers)
    duplicates = sum(count - 1 for count in identities.values())

    strategies = {}
    for strategy in [name for name in STRATEGIES if any(row["strategy"] == name for row in answers)]:
        own = [row for row in answers if row["strategy"] == strategy]
        verdicts = Counter(row["verdict"] for row in own)
        by_category = {}
        for category in CATEGORIES:
            items = [row for row in own if row["category"] == category]
            if items:
                by_category[category] = {"n": len(items), "accuracy": rate(sum(row["verdict"] == "correct" for row in items), len(items))}
        by_lang = {}
        for lang in sorted({row.get("lang", "?") for row in own}):
            items = [row for row in own if row.get("lang", "?") == lang]
            by_lang[lang] = rate(sum(row["verdict"] == "correct" for row in items), len(items))
        stale_probes = [row for row in own if row["category"] == "stale"]
        strategies[strategy] = {
            "n": len(own),
            "accuracy": rate(verdicts["correct"], len(own)),
            "interval": wilson(verdicts["correct"], len(own)),
            "verdicts": {name: verdicts[name] for name in VERDICTS},
            "categories": by_category,
            "langs": by_lang,
            # Probes asked after the value changed, answered with the value from before.
            "stale_answers": rate(sum(row["verdict"] == "stale" for row in stale_probes), len(stale_probes)),
            "stale_probes": len(stale_probes),
            # Probes answered with a value that was only ever proposed or was turned down.
            "proposal_answers": rate(verdicts["proposal"], len(own)),
            "context_tokens": rate(sum(row["context_tokens"] for row in own), len(own)),
            "notes_chars": rate(sum(row.get("notes_chars", 0) for row in own), len(own)),
        }

    # The same probe under two strategies: where exactly do facts and summaries differ?
    paired = None
    by_probe = defaultdict(dict)
    for row in answers:
        by_probe[(row.get("session_id", ""), row["probe"])][row["strategy"]] = row["verdict"] == "correct"
    both = [item for item in by_probe.values() if "facts" in item and "summary" in item]
    if both:
        paired = {"n": len(both), "facts_only": sum(item["facts"] and not item["summary"] for item in both),
                  "summary_only": sum(item["summary"] and not item["facts"] for item in both)}

    delivered = Counter(row["verdict"] for row in deliveries)
    imported = Counter(row["verdict"] for row in deliveries if not row.get("notice"))
    valid = [row for row in routes if "error" not in row]
    offered = [row for row in valid if row["offered"]]
    routing = {
        "requests": len(routes), "errors": len(routes) - len(valid), "offered": len(offered),
        "changed": rate(sum(row["with"] != row["without"] for row in offered), len(offered)),
        "accuracy_without": rate(sum(row["without"] == row["gold"] for row in valid), len(valid)),
        "accuracy_with": rate(sum(row["with"] == row["gold"] for row in valid), len(valid)),
        "imports_per_request": rate(sum(row["imports"] for row in offered), len(offered)),
    }
    tokens = Counter()
    for row in sessions:
        tokens.update(row.get("tokens", {}))

    facts, summary = strategies.get("facts"), strategies.get("summary")
    gates = {}
    if facts and summary:
        complete_pairs = len(both) == facts["n"] == summary["n"] and duplicates == 0
        gates["beats_summary"] = {"value": f"{facts['accuracy']:.3f} vs {summary['accuracy']:.3f} ({len(both)} paired)",
                                   "pass": complete_pairs and paired["facts_only"] > paired["summary_only"]}
    if facts:
        stale = facts["stale_answers"]
        gates["stale_answers"] = {"value": "no stale probes" if stale is None else f"{stale:.3f} of {facts['stale_probes']}",
                                  "pass": stale is not None and stale < LIMITS["stale_answers"]}
        proposal_probes = sum(facts["categories"].get(category, {}).get("n", 0) for category in ("proposal", "rejected"))
        # "unknown" is a value found nowhere in the thread's timeline: reported, but it was never proposed there.
        gates["proposals_shared"] = {"value": f"{delivered['proposal']} proposals, {delivered['unknown']} unknown of {sum(delivered.values())} lines; {proposal_probes} proposal/rejection probes",
                                     "pass": bool(sum(imported.values())) and proposal_probes > 0 and delivered["proposal"] == 0}
    if routes:
        changed = routing["changed"]
        # A routing answer that fails validation is cached like any other, so it fails again on a rerun:
        # a few are tolerated (TheOne falls back to its rules), as long as they stay rare.
        error_rate = routing["errors"] / routing["requests"]
        gates["routing_unchanged"] = {"value": ("nothing offered" if changed is None else f"{changed:.3f} of {len(offered)} changed") + f", {routing['errors']} errors",
                                      "pass": changed is not None and changed < LIMITS["routing_changed"] and error_rate < LIMITS["routing_errors"]
                                      and routing["accuracy_with"] >= routing["accuracy_without"]}
    return {"strategies": strategies, "paired": paired, "deliveries": dict(delivered), "imported": dict(imported),
            "routing": routing, "tokens": dict(tokens), "gates": gates,
            "errors": errors + routing["errors"], "duplicate_answers": duplicates,
            "passed": errors == 0 and duplicates == 0 and bool(gates) and all(gate["pass"] for gate in gates.values()) and len(gates) == 4}


def fmt(value, digits=3):
    return "—" if value is None else f"{value:.{digits}f}"


def report(result):
    lines = ["| strategy | n | accuracy | 95% interval | stale | proposal | missing | wrong | context tokens |", "|---|---|---|---|---|---|---|---|---|"]
    for name, item in result["strategies"].items():
        v = item["verdicts"]
        lines.append(f"| {name} | {item['n']} | {fmt(item['accuracy'])} | {fmt(item['interval'][0])}–{fmt(item['interval'][1])} | {v['stale']} | {v['proposal']} | {v['missing']} | {v['wrong']} | {fmt(item['context_tokens'], 0)} |")
    lines += ["", "Accuracy by probe category:", "", "| strategy | " + " | ".join(CATEGORIES) + " |", "|---|" + "---|" * len(CATEGORIES)]
    for name, item in result["strategies"].items():
        cells = [f"{fmt(item['categories'][c]['accuracy'])} ({item['categories'][c]['n']})" if c in item["categories"] else "—" for c in CATEGORIES]
        lines.append(f"| {name} | " + " | ".join(cells) + " |")
    if result["paired"]:
        p = result["paired"]
        lines += ["", f"Same probes, facts vs summary: facts alone right {p['facts_only']}, summary alone right {p['summary_only']} (of {p['n']})."]
    if result["deliveries"]:
        lines += ["", "Delivered lines: " + ", ".join(f"{k} {v}" for k, v in sorted(result["deliveries"].items()))]
    r = result["routing"]
    if r["requests"]:
        lines += ["", f"Routing: {r['requests']} requests ({r['errors']} errors), facts offered for {r['offered']}; topic changed by offering facts: {fmt(r['changed'])}; "
                  f"accuracy without {fmt(r['accuracy_without'])}, with {fmt(r['accuracy_with'])}; imports per request {fmt(r['imports_per_request'], 2)}"]
    if result["tokens"]:
        lines += ["", "Input tokens spent: " + ", ".join(f"{k} {v}" for k, v in result["tokens"].items())]
    lines += ["", "| gate | value | pass |", "|---|---|---|"]
    for name, gate in result["gates"].items():
        lines.append(f"| {name} | {gate['value']} | {'yes' if gate['pass'] else 'NO'} |")
    if result["errors"] or result["duplicate_answers"]:
        lines += ["", f"Incomplete/invalid measurements: {result['errors']} errors, {result['duplicate_answers']} duplicate answers."]
    lines += ["", "All gates passed." if result["passed"] else "Gates not passed: keep shared facts off by default."]
    return "\n".join(lines)


def main(argv):
    paths = [arg for arg in argv if not arg.startswith("--")]
    if not paths:
        print(__doc__)
        return 2
    result = evaluate([row for path in paths for row in read_jsonl(path)])
    print(json.dumps(result, ensure_ascii=False, indent=2) if "--json" in argv else report(result))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
