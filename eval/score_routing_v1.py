"""Additional metrics for the opt-in routing-v1 event protocol. No v0 defaults change."""
import json
from collections import Counter, defaultdict

def rate(values):
    return round(sum(values) / len(values), 4) if values else None

def evaluate_routing(sessions, rows, score_session, ablation_rows=None):
    schemas = {s.get("routing_schema") for s in sessions}
    if schemas != {"routing-v1"}:
        raise ValueError("Score routing-v1 separately from other schemas")
    variants = {r.get("state_ablation", "none") for r in rows}
    if len(variants) > 1:
        raise ValueError("Mixed state ablation predictions")
    if any(r.get("routing_schema") != "routing-v1" for r in rows):
        raise ValueError("routing-v1 requires event-aware predictions")
    indexed = {(r["session_id"], r["i"]): r for r in rows}
    outcomes = {}
    for s in sessions:
        selected = [indexed[(s["session_id"], t["i"])] for t in s["turns"]]
        mode = selected[0].get("mode", "closed")
        scored, _ = score_session(s, selected, mode)
        outcomes.update({(s["session_id"], o["turn"]["i"]): o for o in scored})
    bound, applied, unsupported = [], [], 0
    fast, large, recall, missing, page_hits, page_count = [], [], [], 0, [], 0
    next_ok, following_ok, applied_corrections, absent_corrections = [], [], 0, 0
    retracted = {key: Counter() for key in ("card", "keywords", "facts")}
    exclusions, source_leaks = [], []
    event_status = Counter()
    restart_ok = []
    for s in sessions:
        sid = s["session_id"]
        for pos, t in enumerate(s["turns"]):
            r = indexed[(sid, t["i"])]
            ok = outcomes[(sid, t["i"])]["accurate"]
            strict = not t.get("ambiguous") and t["gold"]["thread"] is not None
            if t["gold"].get("explicit_binding") and strict:
                bound.append(ok)
                binding = r.get("binding") or {}
                unsupported += bool(binding.get("unsupported"))
                if binding.get("applied"):
                    applied.append(ok)
                    if r.get("calls") == 0 and r.get("logical_calls") == 0: fast.append(ok)
            for event in r.get("events", []):
                event_status[event.get("status", "missing")] += 1
                if event.get("type") == "restart" and event.get("status") == "applied" and strict:
                    restart_ok.append(ok)
            if len(s.get("catalog", [])) > 16 and t["gold"]["thread"] is not None:
                large.append(ok)
                trace = r.get("trace") or {}
                candidates = trace.get("candidateIds")
                if not isinstance(candidates, list) or not candidates:
                    missing += 1
                else:
                    recall.append(t["gold"]["thread"] in candidates[:16])
                    pages = [call for call in r.get("call_details", []) if call.get("layer") == "review"]
                    page_count += len(pages)
                    all_ids = set(candidates)
                    for page in pages: all_ids.update(page.get("candidateIds", []))
                    page_hits.append(t["gold"]["thread"] in all_ids)
            corrections = [e for e in t.get("events_before", []) if e["type"] == "correction"]
            if corrections:
                done = {e["id"] for e in r.get("events", []) if e.get("type") == "correction" and e.get("status") == "applied"}
                applied_corrections += sum(e["id"] in done for e in corrections)
                absent_corrections += sum(e["id"] not in done for e in corrections)
                if all(e["id"] in done for e in corrections):
                    if strict: next_ok.append(ok)
                    for later in s["turns"][pos:]:
                        if later is not t and any(e["type"] == "correction" for e in later.get("events_before", [])): break
                        if not later.get("ambiguous") and later["gold"]["thread"] is not None:
                            following_ok.append(outcomes[(sid, later["i"])]["accurate"])
            for target in t["gold"].get("retract", []):
                old = indexed.get((sid, target["turn_i"]), {})
                before = old.get("state_after")
                after = r.get("state_before")
                topic_id = old.get("pred") if target["from_topic_id"] == "$routed" else target["from_topic_id"]
                original = next(x for x in s["turns"] if x["i"] == target["turn_i"])
                wrong_route = old.get("pred") == topic_id and not outcomes[(sid, original["i"])]["accurate"]
                find = lambda snap: next((topic for topic in (snap or {}).get("topics", []) if topic["id"] == topic_id), None)
                previous, current = find(before), find(after)
                if wrong_route and isinstance((after or {}).get("active_sources"), list):
                    source_leaks.append(any(source.get("turn_i") == target["turn_i"] and source.get("context_id") == topic_id
                                            and source.get("valid") is False for event in after["active_sources"]
                                            for source in event.get("sources", [])))
                if wrong_route and after is not None:
                    exclusions.append(any(x.get("turn_i") == target["turn_i"] and x.get("context_id") == topic_id for x in after.get("excluded", [])))
                for surface, counter in retracted.items():
                    counter["n"] += 1
                    if not wrong_route:
                        counter["not_misrouted"] += 1
                        continue
                    if previous is None or current is None or surface not in previous or surface not in current:
                        counter["missing_snapshot"] += 1
                        continue
                    contains = lambda value: any(marker in json.dumps(value, ensure_ascii=False) for marker in target.get("markers", []))
                    if not contains(previous[surface]):
                        counter["not_learned"] += 1
                        continue
                    counter["observed"] += 1
                    counter["stale"] += contains(current[surface])
    groups = defaultdict(list)
    for s in sessions:
        if s.get("pair"):
            pair = s["pair"]
            key = (s["session_id"], pair["turn_i"])
            groups[pair["id"]].append((s, outcomes[key]))
    complete = [pair for pair in groups.values() if len(pair) == 2 and
                len({s["pair"]["side"] for s, _ in pair}) == 2]
    both = [all(o["accurate"] for _, o in group) for group in complete]
    changed = [group[0][1]["pred"] != group[1][1]["pred"] for group in complete]
    paired_ok = [o["accurate"] for group in complete for _, o in group]
    paired = {"complete_pairs": len(complete), "incomplete_pairs": len(groups) - len(complete),
              "accuracy": rate(paired_ok), "both_correct_rate": rate(both), "prediction_changed_rate": rate(changed),
              "ablation": None}
    if ablation_rows is not None:
        # The main scorer checks complete keys, duplicate rows, and protocol/mode
        # consistency before entering here. Never zip files by row order.
        other = evaluate_routing(sessions, ablation_rows, score_session)
        if variants != {"none"} or other["state_ablation"] != "drop-bindings":
            raise ValueError("Ablation comparison requires full none vs drop-bindings")
        subtract = lambda a, b: round(a - b, 4) if a is not None and b is not None else None
        paired["ablation"] = {"accuracy_delta": subtract(paired["accuracy"], other["pairs"]["accuracy"]),
                             "both_correct_delta": subtract(paired["both_correct_rate"], other["pairs"]["both_correct_rate"]),
                             "full_accuracy": paired["accuracy"], "ablated_accuracy": other["pairs"]["accuracy"]}
    return {
        "state_ablation": next(iter(variants), "none"),
        "explicit_binding": {"n": len(bound), "accuracy": rate(bound), "applied": len(applied),
                             "applied_accuracy": rate(applied), "unsupported": unsupported,
                             "zero_call_applied": len(fast), "zero_call_accuracy": rate(fast)},
        "correction_recovery": {"applied_events": applied_corrections, "missing_events": absent_corrections,
                                "next_n": len(next_ok), "next_accuracy": rate(next_ok),
                                "following_n": len(following_ok), "following_accuracy": rate(following_ok)},
        "retraction": {key: {**{k: counts[k] for k in ("n", "observed", "stale", "missing_snapshot", "not_learned", "not_misrouted")},
                            "stale_rate": round(counts["stale"] / counts["observed"], 4) if counts["observed"] else None}
                       for key, counts in retracted.items()},
        "retraction_sources": {"observed": len(source_leaks), "leaky": sum(source_leaks), "leak_rate": rate(source_leaks)},
        "retraction_exclusion": {"observed": len(exclusions), "excluded_rate": rate(exclusions)},
        "large_catalog": {"n": len(large), "observed": len(recall), "missing_trace": missing,
                          "recall_at_16": rate(recall), "recall_after_review": rate(page_hits),
                          "review_pages": page_count, "accuracy": rate(large)},
        "restart": {"n": len(restart_ok), "accuracy": rate(restart_ok)},
        "event_status": dict(event_status), "pairs": paired,
    }
