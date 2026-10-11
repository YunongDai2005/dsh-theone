"""Offline harness checks, never real model evaluation or contest evidence."""
import contextlib
import io
import json
from collections import Counter

import kaggle_benchmarks as kbench
import theone_topic_routing as bench


class ScriptedLLM(kbench.LLMChat):
    def __init__(self, name, replies):
        super().__init__(name=name)
        self.replies = iter(replies)
        self.calls = 0

    def prompt(self, message, **kwargs):
        self.calls += 1
        return next(self.replies)


assert len(bench.CASES) == 36
assert len({item["id"] for item in bench.CASES}) == 36
assert set(Counter(item["group"] for item in bench.CASES).values()) == {6}
for item in bench.CASES:
    payload = json.loads(bench.build_prompt(item).split("\nInput:\n", 1)[1])
    assert set(payload) == {"topic_catalog", "recent_conversation", "current_user_message"}
    assert item["expected"] in {"t104", "t287", "t593", "NEW", "CLARIFY"}
assert bench.normalize(" t104 \n") == "T104"
assert bench.normalize("t104 because...") != "T104"
assert bench.normalize("```t104```") != "T104"

results = {}
for name, replies, expected in [
    ("harness-oracle", [c["expected"] for c in bench.CASES], 1.0),
    ("harness-negative", ["INVALID"] * 36, 0.0),
    ("harness-half", [c["expected"] if i % 2 else "INVALID" for i, c in enumerate(bench.CASES)], 0.5),
]:
    scripted = ScriptedLLM(name, replies)
    with contextlib.redirect_stdout(io.StringIO()):
        run = bench.topic_routing.run(llm=scripted)
    assert run.result == expected, (name, run.result, expected)
    assert scripted.calls == 36, (name, scripted.calls)
    results[name] = run.result

print(json.dumps({
    "offline_harness_only": True,
    "real_model_requests": 0,
    "cases": len(bench.CASES),
    "groups": dict(Counter(c["group"] for c in bench.CASES)),
    "control_scores": results,
}, indent=2))
