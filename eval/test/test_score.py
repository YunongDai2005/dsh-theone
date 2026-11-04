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
    def test_protocols_are_reported_separately_and_extra_keys_are_rejected(self):
        complete = rows(['t1', 't1', 't2', 't2', 'n1', 't1', 't2'], 'closed')
        legacy = score.evaluate([session()], complete)
        product = score.evaluate([session()], [dict(row, replay='product-v1') for row in complete])
        report = score.table([('old', legacy), ('new', product)])
        self.assertIn('### legacy-v0 (separate protocol)', report)
        self.assertIn('### product-v1 (separate protocol)', report)
        with self.assertRaisesRegex(ValueError, 'Unexpected prediction'):
            score.evaluate([session()], complete + [dict(complete[0], i=99)])
        with self.assertRaisesRegex(ValueError, 'Duplicate prediction'):
            score.score_session(session(), complete + [complete[0]], 'closed')
        with self.assertRaisesRegex(ValueError, 'Missing prediction'):
            score.score_session(session(), complete[:-1], 'closed')

    def test_missing_predictions_are_errors_including_a_whole_session(self):
        s = session()
        complete = rows(['t1', 't1', 't2', 't2', 'n1', 't1', 't2'], 'closed')
        for incomplete in (complete[:-1], []):
            with self.assertRaisesRegex(ValueError, 'Missing prediction'):
                score.evaluate([s], incomplete)

    def test_duplicate_predictions_and_mixed_replays_are_errors(self):
        complete = rows(['t1', 't1', 't2', 't2', 'n1', 't1', 't2'], 'closed')
        with self.assertRaisesRegex(ValueError, 'Duplicate prediction'):
            score.evaluate([session()], complete + [complete[0]])
        complete[0]['replay'] = 'product-v1'
        with self.assertRaisesRegex(ValueError, 'Mixed replay'):
            score.evaluate([session()], complete)

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


class BurstScoreTest(unittest.TestCase):
    def test_burst_rows_are_broken_down_and_counted_once_per_call(self):
        s = session()
        preds = ["t1", "t1", "t2", "t2", "n1", "t1", "t2"]
        rows_ = [{"session_id": "s", "i": i, "pred": p, "mode": "closed", "burst": 2 if i in (2, 3) else 1, "waited": i in (2, 3),
                  **({"usage": {"input": 10}} if i != 3 else {})} for i, p in enumerate(preds)]
        r = score.evaluate([s], rows_, "dev")
        self.assertEqual(r["by_burst"]["burst"], {"accuracy": 1.0, "n": 2})
        self.assertAlmostEqual(r["waited_share"], 2 / 7, places=3)
        self.assertAlmostEqual(r["model_calls_share"], 6 / 7, places=3)
        self.assertIn("in a burst", score.table([("x", r)]))


class MetricsScoreTest(unittest.TestCase):
    def test_calls_tiers_cache_latency_harm_and_cost_are_token_weighted(self):
        s = session()
        predictions = rows(['t1', 'n1', 't2', 'CLARIFY', 'n2', 't2', 't2'], 'closed')
        for i, row in enumerate(predictions):
            row.update(calls=0 if i == 0 else 2 if i == 6 else 1,
                       tier='fast' if i == 0 else 'recheck' if i == 6 else 'quick', latency_ms=i * 10)
        predictions[1]['usage'] = {'input': 100, 'output': 10, 'cache_hit': 90}
        predictions[6]['usage'] = {'input': 900, 'output': 20, 'cache_hit': 10}
        r = score.evaluate([s], predictions)
        self.assertEqual(r['calls_per_message'], 1.0)
        self.assertEqual(r['by_tier']['fast'], {'n': 1, 'share': 0.1429})
        self.assertEqual(r['by_tier']['quick'], {'n': 5, 'share': 0.7143})
        self.assertEqual(r['by_tier']['recheck'], {'n': 1, 'share': 0.1429})
        self.assertEqual(r['cache_hit_rate'], 0.1)
        self.assertEqual(r['latency_ms'], {'p50': 30, 'p90': 60})
        self.assertAlmostEqual(r['harm_per_100_messages'], 500 / 6, places=4)
        # Same default per-million token prices as eval/lib/llm.mjs.
        self.assertAlmostEqual(r['usd_per_1000_messages'], (900 * .30 + 100 * .006 + 30 * 1.20) / 1e6 * 1000 / 7, places=6)
        text = score.table([('measured', r)])
        for label in ['calls/msg', 'fast', 'quick', 'recheck', 'cache hit', 'p50 ms', 'p90 ms', 'harm/100', '$/1k msg']:
            self.assertIn(label, text)
        self.assertEqual(json.loads(json.dumps(r))['by_tier'], r['by_tier'])

    def test_old_predictions_never_mistake_elapsed_time_for_model_latency(self):
        predictions = rows(['t1', 't1', 't2', 't2', 'n1', 't1', 't2'], 'closed')
        for row in predictions:
            row.update(elapsed_ms=100, via='llm')
        r = score.evaluate([session()], predictions)
        for key in ['calls_per_message', 'by_tier', 'cache_hit_rate', 'latency_ms', 'usd_per_1000_messages']:
            self.assertIsNone(r[key])
        self.assertIn('–', score.table([('legacy', r)]))
        self.assertEqual(r['harm_per_100_messages'], 0)

    def test_latency_median_uses_both_middle_values_and_fast_rows_are_zero(self):
        s = session()
        s['turns'] = s['turns'][:4]
        predictions = rows(['t1', 't1', 't2', 't2'], 'closed')
        for row, delay in zip(predictions, [0, 10, 20, 30]):
            row.update(latency_ms=delay, tier='quick' if delay else 'fast', calls=bool(delay))
        r = score.evaluate([s], predictions)
        self.assertEqual(r['latency_ms'], {'p50': 15.0, 'p90': 30})


class BillingScoreTest(unittest.TestCase):
    def test_card_tokens_affect_only_the_bill(self):
        predictions = rows(['t1', 't1', 't2', 't2', 'n1', 't1', 't2'], 'closed')
        for row in predictions:
            row.update(calls=0, tier='fast', latency_ms=0)
        predictions[0]['card_usage'] = [{'input': 1000, 'output': 30, 'cache_hit': 100}]
        r = score.evaluate([session()], predictions)
        self.assertEqual(r['calls_per_message'], 0)
        self.assertIsNone(r['cache_hit_rate'])
        self.assertEqual(r['latency_ms'], {'p50': 0, 'p90': 0})
        self.assertAlmostEqual(r['usd_per_1000_messages'], .0438, places=6)
        self.assertEqual(r['usd_per_1000_messages'], r['card_usd_per_1000_messages'])

    def test_correction_learning_has_a_separate_bill(self):
        predictions = rows(['t1', 't1', 't2', 't2', 'n1', 't1', 't2'], 'closed')
        for row in predictions:
            row.update(calls=0, tier='fast', latency_ms=0)
        predictions[0]['auxiliary_usage'] = [{'layer': 'terms', 'input': 1000, 'output': 30, 'cache_hit': 100, 'latency_ms': 12}]
        r = score.evaluate([session()], predictions)
        self.assertEqual(r['calls_per_message'], 0)
        self.assertEqual(r['latency_ms'], {'p50': 0, 'p90': 0})
        self.assertAlmostEqual(r['usd_per_1000_messages'], .0438, places=6)
        self.assertEqual(r['usd_per_1000_messages'], r['auxiliary_usd_per_1000_messages'])

    def test_an_entirely_fast_run_has_zero_cost_rather_than_unknown_cost(self):
        predictions = rows(['t1', 't1', 't2', 't2', 'n1', 't1', 't2'], 'closed')
        for row in predictions:
            row.update(calls=0, tier='fast', latency_ms=0)
        r = score.evaluate([session()], predictions)
        self.assertEqual(r['usd_per_1000_messages'], 0)

class ClearFragmentsTest(unittest.TestCase):
    def test_clear_fragmentation_excludes_only_ambiguous_landings(self):
        s = session()
        s['turns'][1]['ambiguous'] = True
        r = score.evaluate([s], rows(['t1', 'extra', 't2', 't2', 'oneoff', 't1', 't2'], 'closed'))
        self.assertEqual(r['topics_per_thread'], 1.5)
        self.assertEqual(r['topics_per_thread_clear'], 1.0)
        self.assertIn('topics/thread (clear)', score.table([('fixture', r)]))

    def test_clear_fragmentation_omits_ambiguous_only_threads_and_special_predictions(self):
        s = session()
        for t in s['turns']:
            t['ambiguous'] = t['gold']['thread'] == 't2'
        r = score.evaluate([s], rows(['t1', 'ERROR', 't2', 'extra', 'oneoff', 'CLARIFY', 't2'], 'closed'))
        self.assertEqual(r['topics_per_thread'], 1.5)
        self.assertEqual(r['topics_per_thread_clear'], 1.0)
        for t in s['turns']: t['ambiguous'] = True
        self.assertIsNone(score.evaluate([s], rows(['t1'] * 7, 'closed'))['topics_per_thread_clear'])
