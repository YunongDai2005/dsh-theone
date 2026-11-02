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


if __name__ == '__main__': unittest.main()
