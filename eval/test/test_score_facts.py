import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import score_facts  # noqa: E402


def answer(probe, strategy, verdict, category="cross", tokens=100):
    return {"kind": "answer", "session_id": "s", "lang": "zh", "probe": probe, "category": category, "strategy": strategy,
            "verdict": verdict, "context_tokens": tokens, "notes_chars": 0}


def rows(stale_verdict="correct", delivery="current", changed=False):
    out = []
    for n in range(10):
        out.append(answer(f"p{n}", "summary", "correct" if n < 6 else "wrong"))
        out.append(answer(f"p{n}", "facts", "correct" if n < 8 else "wrong"))
    out.append(answer("p10", "facts", stale_verdict, category="stale"))
    out.append({"kind": "delivery", "verdict": delivery, "notice": False})
    out += [{"kind": "route", "gold": "t1", "offered": 2, "without": "t1", "with": "t2" if changed and n == 0 else "t1", "imports": 1} for n in range(20)]
    out.append({"kind": "route", "gold": "t1", "offered": 1, "without": "ERROR", "with": "ERROR", "imports": 0, "error": "x"})
    out.append({"kind": "session", "tokens": {"extract": 10, "answer": 5}})
    return out


class ScoreFactsTest(unittest.TestCase):
    def test_all_gates_pass_on_good_results(self):
        result = score_facts.evaluate(rows())
        self.assertTrue(result["passed"], result["gates"])
        self.assertAlmostEqual(result["strategies"]["facts"]["accuracy"], 9 / 11)
        self.assertEqual(result["paired"], {"n": 10, "facts_only": 2, "summary_only": 0})
        self.assertEqual(result["routing"]["errors"], 1)
        self.assertEqual(result["tokens"], {"extract": 10, "answer": 5})
        self.assertIn("All gates passed.", score_facts.report(result))

    def test_each_gate_fails_on_its_own(self):
        self.assertFalse(score_facts.evaluate(rows(stale_verdict="stale"))["gates"]["stale_answers"]["pass"])
        self.assertFalse(score_facts.evaluate(rows(delivery="proposal"))["gates"]["proposals_shared"]["pass"])
        # One change in 20 offered requests is 5%, over the 2% limit.
        self.assertFalse(score_facts.evaluate(rows(changed=True))["gates"]["routing_unchanged"]["pass"])
        worse = [dict(row, verdict="wrong") if row.get("strategy") == "facts" else row for row in rows()]
        result = score_facts.evaluate(worse)
        self.assertFalse(result["gates"]["beats_summary"]["pass"])
        self.assertFalse(result["passed"])

    def test_missing_measurements_never_pass(self):
        result = score_facts.evaluate([answer("p0", "facts", "correct")])
        self.assertFalse(result["passed"])
        self.assertFalse(result["gates"]["stale_answers"]["pass"])


if __name__ == "__main__":
    unittest.main()
