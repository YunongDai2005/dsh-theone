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
        category = "proposal" if n == 8 else "rejected" if n == 9 else "cross"
        out.append(answer(f"p{n}", "summary", "correct" if n < 6 else "wrong", category))
        out.append(answer(f"p{n}", "facts", "correct" if n < 8 else "wrong", category))
    out.append(answer("p10", "summary", "wrong", category="stale"))
    out.append(answer("p10", "facts", stale_verdict, category="stale"))
    out.append({"kind": "delivery", "verdict": delivery, "notice": False})
    out += [{"kind": "route", "gold": "t1", "offered": 2, "without": "t1", "with": "t2" if changed and n == 0 else "t1", "imports": 1} for n in range(20)]
    out.append({"kind": "session", "tokens": {"extract": 10, "answer": 5}})
    return out


class ScoreFactsTest(unittest.TestCase):
    def test_all_gates_pass_on_good_results(self):
        result = score_facts.evaluate(rows())
        self.assertTrue(result["passed"], result["gates"])
        self.assertAlmostEqual(result["strategies"]["facts"]["accuracy"], 9 / 11)
        self.assertEqual(result["paired"], {"n": 11, "facts_only": 3, "summary_only": 0})
        self.assertEqual(result["routing"]["errors"], 0)
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

    def test_unpaired_comparisons_and_empty_deliveries_do_not_pass(self):
        incomplete = [row for row in rows() if not (row.get("strategy") == "summary" and row.get("probe") == "p10")]
        self.assertFalse(score_facts.evaluate(incomplete)["gates"]["beats_summary"]["pass"])
        self.assertFalse(score_facts.evaluate([row for row in rows() if row["kind"] != "delivery"])["gates"]["proposals_shared"]["pass"])

    def test_errors_and_duplicates_block_release(self):
        for error in [
            {"kind": "error", "step": "extract", "error": "failed"},
            {"kind": "route", "gold": "t1", "offered": 1, "without": "ERROR", "with": "ERROR", "imports": 0, "error": "failed"},
            answer("p0", "facts", "correct"),
        ]:
            self.assertFalse(score_facts.evaluate(rows() + [error])["passed"])

    def test_pairs_include_session_identity(self):
        one = rows()
        two = [dict(row, session_id="other", verdict="wrong") if row.get("strategy") else dict(row, session_id="other") for row in rows()]
        self.assertEqual(score_facts.evaluate(one + two)["paired"]["n"], 22)

    def test_a_small_routing_accuracy_drop_still_blocks_release(self):
        data = [row for row in rows() if row["kind"] != "route"]
        data += [{"kind": "route", "gold": "t1", "offered": 1, "without": "t1", "with": "t2" if n == 0 else "t1", "imports": 1} for n in range(100)]
        self.assertFalse(score_facts.evaluate(data)["gates"]["routing_unchanged"]["pass"])


if __name__ == "__main__":
    unittest.main()
