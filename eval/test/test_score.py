import itertools
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import baselines  # noqa: E402
import score  # noqa: E402


def session():
    """Two threads and a one-off; t2 starts at turn 2."""
    texts = [("t1", "new"), ("t1", "continue"), ("t2", "new"), ("t2", "continue"), (None, "oneoff"), ("t1", "switch"), ("t2", "switch")]
    return {"session_id": "s", "split": "dev", "lang": "en", "threads": [{"id": "t1", "title": "Garden shed", "description": "", "goal": ""},
            {"id": "t2", "title": "Tax return", "description": "", "goal": ""}],
            "turns": [{"i": i, "text": f"m{i}", "gold": {"thread": g, "action": a, "refs": []}, "style": "explicit", "tags": ["explicit"], "ambiguous": False}
                      for i, (g, a) in enumerate(texts)]}


def rows(preds, mode):
    return [{"session_id": "s", "i": i, "pred": p, "mode": mode} for i, p in enumerate(preds)]


class ScoreTest(unittest.TestCase):
    def test_oracle_is_perfect_in_both_modes(self):
        s = session()
        for mode in ("closed", "open"):
            r = score.evaluate([s], [row for row in baselines.route(s, "oracle", mode)], "dev")
            self.assertEqual((r["accuracy"], r["weighted_error"], r["oneoff_into_topic"]), (1.0, 0.0, 0.0))

    def test_open_labels_are_matched_and_pollution_is_counted(self):
        s = session()
        # The system names its topics differently and lets t2's first message into t1's topic.
        r = score.evaluate([s], rows(["a", "a", "a", "b", "b", "a", "b"], "open"), "dev")
        self.assertEqual(r["outcomes"]["merged_new"], 1)
        # t2's next message opens its own topic: t2's context is now split in two.
        self.assertEqual(r["outcomes"]["spurious_new"], 1)
        self.assertEqual(r["outcomes"]["oneoff_into_topic"], 1)
        self.assertAlmostEqual(r["accuracy"], 5 / 6, places=4)
        self.assertAlmostEqual(r["weighted_error"], (3 + 1) / 6, places=4)

    def test_closed_mode_counts_new_topics_and_clarifications(self):
        s = session()
        r = score.evaluate([s], rows(["t1", "n1", "t2", "CLARIFY", "n2", "t2", "t2"], "closed"), "dev")
        self.assertEqual(r["outcomes"], {"correct": 3, "spurious_new": 1, "clarify": 1, "oneoff_isolated": 1, "wrong_existing": 1})
        self.assertAlmostEqual(r["weighted_error"], (1 + 1 + 3) / 6, places=4)

    def test_hungarian_matches_brute_force(self):
        weights = [[3, 1, 0, 2], [2, 4, 1, 0], [0, 2, 5, 1]]
        best = max(sum(weights[i][p[i]] for i in range(3)) for p in itertools.permutations(range(4), 3))
        match = score.hungarian(weights)
        self.assertEqual(sum(weights[i][j] for i, j in match.items()), best)


if __name__ == "__main__":
    unittest.main()
