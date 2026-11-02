"""Hand-counted fictional routing labels, with no real conversation fixtures."""
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import score
path = ROOT / 'score-private-real.py'
diagnostic = None
if path.exists():
    spec = importlib.util.spec_from_file_location('private_score', path)
    diagnostic = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(diagnostic)


def fixture():
    session = {'session_id': 'fiction', 'routing_schema': 'routing-v1', 'split': 'dev',
               'threads': [{'id': 'a'}, {'id': 'b'}], 'catalog': [{'id': 'a'}, {'id': 'b'}],
               'project_scope': 'same_project', 'turns': []}
    for i, g in enumerate(['a', 'a', 'a', 'b', 'b', 'b']):
        session['turns'].append({'i': i, 'gold': {'thread': g}, 'ambiguous': False,
                                'tags': ['short'] if i == 2 else ['switch'] if i == 3 else []})
    rows = [{'session_id': 'fiction', 'i': i, 'pred': p, 'mode': 'open'}
            for i, p in enumerate(['p', 'p', 'q', 'q', 'q', 'r'])]
    return session, rows


class PrivateScoreTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(diagnostic, 'read-only private diagnostic is missing')

    def test_seeded_and_new_labels_use_one_global_assignment_per_stream(self):
        s, rows = fixture()
        result = diagnostic.evaluate([s], rows)
        self.assertEqual((result['all']['correct'], result['all']['n']), (4, 6))
        self.assertEqual((result['short']['correct'], result['short']['n']), (0, 1))
        self.assertEqual((result['switch']['correct'], result['switch']['n']), (1, 1))
        self.assertEqual(result['by_project']['same_project']['all']['n'], 6)
        self.assertEqual(result['by_project']['cross_project']['all']['n'], 0)

    def test_unseeded_format_agrees_with_existing_open_score(self):
        s, rows = fixture()
        s['catalog'] = []
        outcomes, mapping = score.score_session(s, rows, 'open')
        self.assertEqual(sum(o['accurate'] for o in outcomes), 4)
        self.assertEqual(diagnostic.evaluate([s], rows)['all']['correct'], 4)

    def test_unconfirmed_and_warmup_never_inflate_mapping_or_accuracy(self):
        s, rows = fixture()
        s['warmup'] = [{'i': 100, 'gold': {'thread': 'a'}}]
        for t in s['turns']: t['ambiguous'] = True
        result = diagnostic.evaluate([s], rows)
        self.assertEqual(result['all']['n'], 0)
        self.assertIsNone(result['all']['accuracy'])
        self.assertEqual(result['excluded_ambiguous'], 6)

    def test_errors_and_clarifications_are_incorrect_not_new_labels(self):
        s, rows = fixture()
        rows[0]['pred'], rows[1]['pred'] = 'ERROR', 'CLARIFY'
        result = diagnostic.evaluate([s], rows)
        self.assertEqual((result['all']['correct'], result['all']['n']), (2, 6))

    def test_prediction_key_mismatch_is_rejected(self):
        s, rows = fixture()
        for bad in (rows[:-1], rows + [rows[0]], rows + [{'session_id': 'other', 'i': 0, 'pred': 'p'}]):
            with self.assertRaises(ValueError): diagnostic.evaluate([s], bad)


    def test_pure_subtopics_have_zero_mixing_but_visible_fragmentation(self):
        s, rows = fixture()
        for row, pred in zip(rows, ['p', 'p', 'q', 'r', 'r', 'r']): row['pred'] = pred
        result = diagnostic.evaluate([s], rows)
        self.assertEqual(result['cross_session_mixing']['mixed'], 0)
        self.assertEqual(result['cross_session_mixing']['n'], 6)
        self.assertEqual(result['fragmentation']['topic_count_histogram'], {'1': 1, '2': 1})
        self.assertEqual(result['fragmentation']['mean_topics_per_source'], 1.5)
        self.assertEqual(result['all']['correct'], 5)

    def test_majority_mixing_ties_and_special_predictions_are_distinct(self):
        s, rows = fixture()
        result = diagnostic.evaluate([s], rows)
        self.assertEqual(result['cross_session_mixing']['mixed'], 1)
        self.assertEqual(result['cross_session_mixing']['unresolved'], 0)
        for row in rows: row['pred'] = 'p'
        result = diagnostic.evaluate([s], rows)
        self.assertEqual(result['cross_session_mixing']['unresolved'], 6)
        self.assertEqual(result['cross_session_mixing']['mixed'], 0)
        rows[0]['pred'] = 'ERROR'
        rows[1]['pred'] = 'CLARIFY'
        result = diagnostic.evaluate([s], rows)
        self.assertEqual(result['cross_session_mixing']['invalid'], 2)
        self.assertEqual(result['cross_session_mixing']['mixed'], 1)
        self.assertEqual(result['fragmentation']['topic_count_histogram'], {'1': 2})

    def test_switch_uses_past_ownership_and_requires_reusing_an_existing_source_topic(self):
        s, rows = fixture()
        for t, g in zip(s['turns'], ['a', 'a', 'b', 'b', 'a', 'b']): t['gold']['thread'] = g
        for i, t in enumerate(s['turns']): t['tags'] = ['switch'] if i in (2, 4, 5) else []
        for row, p in zip(rows, ['p', 'p', 'q', 'q', 'r', 'q']): row['pred'] = p
        result = diagnostic.evaluate([s], rows)
        self.assertEqual((result['switch_routing']['correct'], result['switch_routing']['n']), (2, 3))
        self.assertEqual(result['switch_routing']['by_visit']['returning']['correct'], 1)
        self.assertEqual(result['switch_routing']['by_visit']['returning']['n'], 2)
        # The new r is a pure A topic retrospectively, but was an unnecessary split on return.
        self.assertEqual(result['cross_session_mixing']['mixed'], 0)

    def test_switch_cannot_be_rescued_by_future_majority_or_unchanged_topic(self):
        s, rows = fixture()
        for t, g in zip(s['turns'], ['a', 'b', 'b', 'b', 'a', 'a']): t['gold']['thread'] = g
        for i, t in enumerate(s['turns']): t['tags'] = ['switch'] if i in (1, 4) else []
        for row, p in zip(rows, ['p', 'p', 'p', 'p', 'q', 'q']): row['pred'] = p
        result = diagnostic.evaluate([s], rows)
        self.assertEqual(result['switch_routing']['correct'], 1)
        self.assertEqual(result['switch_routing']['n'], 2)

    def test_macro_mean_and_median_do_not_weight_by_stream_length(self):
        s, rows = fixture()
        small = {'session_id': 'small', 'split': 'dev', 'turns': [{'i': 0, 'gold': {'thread': 'c'}, 'tags': []}]}
        result = diagnostic.evaluate([s, small], rows + [{'session_id': 'small', 'i': 0, 'pred': 'z'}])
        self.assertEqual(result['all']['correct'], 5)
        self.assertEqual(result['all']['n'], 7)
        self.assertAlmostEqual(result['stream_accuracy']['mean'], 5 / 6, places=6)
        self.assertAlmostEqual(result['stream_accuracy']['median'], 5 / 6, places=6)
        self.assertEqual(result['stream_accuracy']['n'], 2)

    def test_ambiguous_predecessor_makes_switch_unassessable_without_bridging_gap(self):
        s, rows = fixture()
        s['turns'][2]['ambiguous'] = True
        result = diagnostic.evaluate([s], rows)
        self.assertEqual(result['switch_routing']['n'], 1)
        self.assertEqual(result['switch_routing']['unassessable'], 1)
        self.assertEqual(result['switch_routing']['correct'], 0)
        for t in s['turns']: t['ambiguous'] = True
        result = diagnostic.evaluate([s], rows)
        self.assertIsNone(result['stream_accuracy']['mean'])
        self.assertIsNone(result['cross_session_mixing']['rate'])
        self.assertIsNone(result['fragmentation']['mean_topics_per_source'])


if __name__ == '__main__': unittest.main()
