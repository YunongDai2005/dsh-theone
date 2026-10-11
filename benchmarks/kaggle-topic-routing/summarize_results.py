"""Summarize actual Kaggle run traces; never use scripted harness traces."""
import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

from theone_topic_routing import CASES, normalize


def summarize(run_dir):
    parents = list(run_dir.glob("theone-routing-decisions-run*.json"))
    if len(parents) != 1:
        raise ValueError(f"Expected one parent trace in {run_dir}")
    parent = json.loads(parents[0].read_text())
    if parent["state"] != "BENCHMARK_TASK_RUN_STATE_COMPLETED":
        raise ValueError("Parent run did not complete")
    model = parent["modelVersion"]["slug"]
    if "harness" in model:
        raise ValueError("Mock controls are not model results")
    by_message = {c["message"]: c for c in CASES}
    rows, groups, seen = [], defaultdict(list), set()
    for path in run_dir.glob("topic-routing-case-run*.json"):
        run = json.loads(path.read_text())
        assert run["state"] == "BENCHMARK_TASK_RUN_STATE_COMPLETED"
        assert run["modelVersion"]["slug"] == model
        assert len(run["conversations"]) == 1
        requests = run["conversations"][0]["requests"]
        assert len(requests) == 1
        request = requests[0]
        contents = request["contents"]
        prompt = "".join(p.get("text", "") for c in contents
                         if c.get("role") == "CONTENT_ROLE_USER" for p in c["parts"])
        payload = json.loads(prompt.split("\nInput:\n", 1)[1])
        case = by_message[payload["current_user_message"]]
        assert case["id"] not in seen
        seen.add(case["id"])
        assert payload["recent_conversation"] == case["history"]
        assert set(payload) == {"topic_catalog", "recent_conversation", "current_user_message"}
        actual = "".join(p.get("text", "") for c in contents
                         if c.get("role") == "CONTENT_ROLE_ASSISTANT" for p in c["parts"])
        score = run["results"][0]["numericResult"].get("value", 0.0)
        assert score == float(normalize(actual) == normalize(case["expected"]))
        metrics = request["metrics"]
        cost = sum(int(metrics.get(k, 0)) for k in
                   ("inputTokensCostNanodollars", "outputTokensCostNanodollars")) / 1e9
        rows.append({"model": model, "case": case["id"], "group": case["group"],
                     "expected": case["expected"], "actual": actual, "score": score,
                     "input_tokens": metrics.get("inputTokens", 0),
                     "output_tokens": metrics.get("outputTokens", 0),
                     "recorded_cost_usd": cost})
        groups[case["group"]].append(score)
    assert seen == {c["id"] for c in CASES}
    accuracy = sum(r["score"] for r in rows) / len(rows)
    assert abs(accuracy - parent["results"][0]["numericResult"].get("value", 0)) < 1e-12
    summary = {"model": model, "run_id": run_dir.name, "task_version": 1,
               "start_utc": parent["startTime"], "end_utc": parent["endTime"],
               "n": len(rows), "correct": int(sum(r["score"] for r in rows)),
               "accuracy": accuracy,
               "recorded_cost_usd": sum(r["recorded_cost_usd"] for r in rows),
               "groups": {g: {"correct": int(sum(s)), "n": len(s)} for g, s in groups.items()},
               "failures": [{"case": r["case"], "expected": r["expected"], "actual": r["actual"]}
                            for r in rows if not r["score"]]}
    return summary, sorted(rows, key=lambda r: r["case"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("run_dirs", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    summaries, rows = [], []
    for run_dir in args.run_dirs:
        summary, cases = summarize(run_dir)
        summaries.append(summary)
        rows.extend(cases)
    (args.output / "results.json").write_text(json.dumps(summaries, indent=2) + "\n")
    with (args.output / "cases.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps(summaries, indent=2))
