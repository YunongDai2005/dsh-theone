import importlib.util
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
path = Path(__file__).resolve().parents[1] / 'cache-report.py'
spec = importlib.util.spec_from_file_location('cache_report', path)
report = importlib.util.module_from_spec(spec) if path.exists() else None
if report:
    spec.loader.exec_module(report)

class CacheReportTest(unittest.TestCase):
    def test_layers_weight_cache_by_tokens_and_keep_missing_usage_unknown(self):
        self.assertTrue(callable(getattr(report, 'layer_usage', None)))
        rows = [{'usage_by_call': [{'layer': 'quick', 'input': 10, 'cache_hit': 8, 'output': 2},
                                  {'layer': 'quick', 'input': 30, 'cache_hit': 10, 'output': 3}],
                 'card_usage': [{'input': 20, 'cache_hit': 5, 'output': 7}],
                 'auxiliary_usage': [{'layer': 'terms', 'input': 2}]}]
        result = report.layer_usage(rows)
        self.assertEqual(result['quick']['cache_hit_rate'], 18 / 40)
        self.assertEqual(result['quick']['output_tokens'], 5)
        self.assertEqual(result['card']['output_tokens'], 7)
        self.assertIsNone(result['terms']['cache_hit_rate'])
        self.assertIsNone(result['terms']['output_tokens'])

    def test_pairing_uses_official_scorable_outcomes_and_rejects_missing_or_mixed_runs(self):
        self.assertTrue(callable(getattr(report, 'compare', None)))
        sessions = [{'session_id': 's', 'split': 'dev', 'lang': 'en', 'threads': [{'id': 'a'}, {'id': 'b'}],
                     'turns': [{'i': 0, 'text': 'A plan', 'tags': [], 'gold': {'thread': 'a', 'refs': [], 'action': 'MOUNT'}}, {'i': 1, 'text': 'B plan', 'tags': [], 'gold': {'thread': 'b', 'refs': [], 'action': 'SWAP'}}]}]
        def row(i, pred, variant):
            return {'session_id': 's', 'i': i, 'pred': pred, 'mode': 'closed', 'replay': 'product-v1', 'variant': variant}
        baseline = [row(0, 'a', 'none'), row(1, 'a', 'none')]
        candidate = [row(0, 'b', 'compact'), row(1, 'b', 'compact')]
        result = report.compare(sessions, baseline, candidate, 'dev')
        self.assertEqual(result['paired']['scorable_messages'], 2)
        self.assertEqual(result['paired']['baseline_only_correct'], 1)
        self.assertEqual(result['paired']['candidate_only_correct'], 1)
        self.assertEqual(result['paired']['accuracy_delta'], 0)
        with self.assertRaisesRegex(ValueError, 'Missing prediction'):
            report.compare(sessions, baseline, candidate[:1], 'dev')
        with self.assertRaisesRegex(ValueError, 'variant'):
            report.compare(sessions, baseline, [candidate[0], baseline[1]], 'dev')

if __name__ == '__main__':
    unittest.main()
