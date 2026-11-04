import copy
import hashlib
import json
import os
import sys
import unittest
from unittest.mock import patch
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import score

def turn(i, topic='a', binding=False, retract=None):
    return {'i': i, 'text': 'ok', 'at': f'2026-09-01T00:00:0{i}Z', 'ambiguous': False, 'tags': [],
            'gold': {'thread': topic, 'action': 'continue', 'refs': [], 'explicit_binding': binding, 'retract': retract or []}}

def corpus():
    return [{'session_id': 's', 'routing_schema': 'routing-v1', 'split': 'dev', 'lang': 'en',
             'threads': [{'id': 'a'}, {'id': 'b'}], 'catalog': [{'id': 'a'}, {'id': 'b'}],
             'turns': [turn(0, 'b', True), turn(1, 'b')]}]

def predictions():
    return [{'session_id': 's', 'i': i, 'mode': 'closed', 'replay': 'product-v1', 'routing_schema': 'routing-v1',
             'state_ablation': 'none', 'pred': p, 'calls': 0, 'binding': {'applied': False, 'unsupported': ['reply_to']},
             'trace': {'candidateIds': ['a', 'b']}} for i, p in enumerate(['a', 'b'])]

class RoutingV1ScoreTest(unittest.TestCase):
    def test_explicit_binding_reports_accuracy_and_unsupported_coverage_separately(self):
        r = score.evaluate(corpus(), predictions())['routing_v1']['explicit_binding']
        self.assertEqual(r['n'], 1)
        self.assertEqual(r['accuracy'], 0)
        self.assertEqual(r['unsupported'], 1)
        self.assertEqual(r['applied'], 0)
        self.assertIsNone(r['applied_accuracy'])

    def test_seeded_catalog_ids_cannot_be_remapped_to_hide_a_wrong_route_in_open_mode(self):
        s = corpus()
        s[0]['turns'] = s[0]['turns'][:1]
        rows = predictions()[:1]
        for row in rows: row['mode'] = 'open'
        r = score.evaluate(s, rows)
        self.assertEqual(r['accuracy'], 0)
        self.assertEqual(r['routing_v1']['explicit_binding']['accuracy'], 0)

    def test_large_catalog_recall_distinguishes_search_misses_from_missing_telemetry(self):
        s = corpus()
        s[0]['catalog'] = [{'id': 'a'}, {'id': 'b'}] + [{'id': f'c{i}'} for i in range(22)]
        rows = predictions()
        rows[0]['trace']['candidateIds'] = ['a']
        rows[1]['trace'] = None
        r = score.evaluate(s, rows)['routing_v1']['large_catalog']
        self.assertEqual(r['n'], 2)
        self.assertEqual(r['observed'], 1)
        self.assertEqual(r['recall_at_16'], 0)
        self.assertEqual(r['missing_trace'], 1)

    def test_correction_recovery_checks_only_the_wrong_topic_and_observed_surfaces(self):
        s = corpus()
        s[0]['turns'][1]['events_before'] = [{'id': 'c', 'type': 'correction', 'turn_i': 0, 'target_topic_id': 'b'}]
        s[0]['turns'][1]['gold']['retract'] = [{'turn_i': 0, 'from_topic_id': 'a', 'markers': ['POISON']}]
        rows = predictions()
        rows[0]['state_after'] = {'topics': [{'id': 'a', 'card': 'POISON', 'keywords': ['POISON'], 'facts': []}]}
        rows[1]['events'] = [dict(s[0]['turns'][1]['events_before'][0], status='applied')]
        rows[1]['state_before'] = {'topics': [
            {'id': 'a', 'card': 'clean', 'keywords': ['POISON'], 'facts': []},
            {'id': 'b', 'card': 'POISON', 'keywords': ['POISON'], 'facts': ['POISON']}],
            'excluded': [{'turn_i': 0, 'context_id': 'a'}]}
        r = score.evaluate(s, rows)['routing_v1']
        self.assertEqual(r['correction_recovery']['next_accuracy'], 1)
        self.assertEqual(r['retraction']['card']['observed'], 1)
        self.assertEqual(r['retraction']['card']['stale_rate'], 0)
        self.assertEqual(r['retraction']['keywords']['stale_rate'], 1)
        self.assertIsNone(r['retraction']['facts']['stale_rate'])

    def test_missing_snapshots_never_count_as_clean_retraction(self):
        s = corpus()
        s[0]['turns'][1]['gold']['retract'] = [{'turn_i': 0, 'from_topic_id': 'a', 'markers': ['POISON']}]
        r = score.evaluate(s, predictions())['routing_v1']['retraction']
        self.assertEqual(r['card']['missing_snapshot'], 1)
        self.assertIsNone(r['card']['stale_rate'])

    def test_owner_pairs_and_ablation_are_joined_by_keys_not_file_order(self):
        a, b = corpus()[0], copy.deepcopy(corpus()[0])
        b['session_id'] = 'other'
        a['turns'] = [turn(0, 'a', True)]
        b['turns'] = [turn(0, 'b', True)]
        a['pair'] = {'id': 'p', 'side': 'a', 'kind': 'foreground', 'turn_i': 0}
        b['pair'] = dict(a['pair'], side='b')
        rows = [dict(predictions()[0], pred='a'), dict(predictions()[0], session_id='other', pred='b')]
        ablated = [dict(row, pred='a', state_ablation='drop-bindings') for row in reversed(rows)]
        r = score.evaluate([a, b], rows, ablation_predictions=ablated)['routing_v1']['pairs']
        self.assertEqual(r['complete_pairs'], 1)
        self.assertEqual(r['both_correct_rate'], 1)
        self.assertEqual(r['ablation']['accuracy_delta'], 0.5)
        self.assertEqual(r['ablation']['both_correct_delta'], 1)
        with self.assertRaisesRegex(ValueError, 'Missing prediction'):
            score.evaluate([a, b], rows, ablation_predictions=ablated[:-1])

    def test_mixed_state_ablations_and_incomplete_pairs_are_not_silent_successes(self):
        rows = predictions()
        rows[1]['state_ablation'] = 'drop-bindings'
        with self.assertRaisesRegex(ValueError, 'ablation'):
            score.evaluate(corpus(), rows)
        s = corpus()
        s[0]['pair'] = {'id': 'p', 'side': 'a', 'kind': 'foreground', 'turn_i': 0}
        r = score.evaluate(s, predictions())['routing_v1']['pairs']
        self.assertEqual(r['incomplete_pairs'], 1)
        self.assertIsNone(r['both_correct_rate'])

    def test_v0_scores_are_bit_identical_on_all_available_original_predictions(self):
        base = Path(__file__).resolve().parents[2]
        fixture = json.loads(Path(__file__).with_name('fixtures').joinpath('v0-score-baseline.json').read_text(encoding='utf-8'))
        data = base / 'eval/data/interleave-v0/sessions.jsonl'
        self.assertEqual(hashlib.sha256(data.read_bytes()).hexdigest(), fixture['corpus_sha256'])
        sessions = score.read_jsonl(data)
        checked = 0
        for record in fixture['records']:
            path = base / record['path']
            if not path.exists(): continue
            checked += 1
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), record['prediction_sha256'])
            with patch.dict(os.environ, {"EVAL_PRICES": fixture["prices"]}):
                result = score.evaluate(sessions, score.read_jsonl(path), record['split'])
            result.pop('topics_per_thread_clear')  # New additive metric; every original field/hash stays identical.
            raw = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()
            self.assertEqual(hashlib.sha256(raw).hexdigest(), record['score_sha256'])
            self.assertEqual(result, record['score'])
        if not checked: self.skipTest('Local ignored v0 prediction files are not present')


    def test_ablation_can_select_dev_from_files_containing_both_splits(self):
        dev = corpus()[0]
        test = copy.deepcopy(dev)
        test['session_id'] = 'test-session'
        test['split'] = 'test'
        full = predictions() + [dict(row, session_id='test-session') for row in predictions()]
        ablated = [dict(row, state_ablation='drop-bindings') for row in full]
        self.assertEqual(score.evaluate([dev, test], full, 'dev', ablation_predictions=ablated)['sessions'], 1)


    def test_retraction_detects_invalid_source_in_another_topics_paraphrased_card(self):
        s = corpus()
        s[0]['turns'][1]['gold']['retract'] = [{'turn_i': 0, 'from_topic_id': 'a', 'markers': ['POISON']}]
        rows = predictions()
        rows[1]['state_before'] = {'topics': [], 'active_sources': [
            {'stream': 'topic:third', 'kind': 'applyCard', 'sources': [
                {'turn_i': 0, 'context_id': 'a', 'valid': False}]}]}
        r = score.evaluate(s, rows)['routing_v1']['retraction_sources']
        self.assertEqual(r['observed'], 1)
        self.assertEqual(r['leaky'], 1)
        self.assertEqual(r['leak_rate'], 1)


class Step7ScoreTest(unittest.TestCase):
    def test_fresh_label_for_seeded_topic_is_spurious_not_correct(self):
        s = corpus()[0]
        rows = predictions()
        rows[0]['pred'] = 'invented'
        o, _ = score.score_session(s, rows, 'open')
        self.assertFalse(o[0]['accurate'])
        self.assertEqual(o[0]['kind'], 'spurious_new')

    def test_oneoff_isolation_is_correct_but_does_not_enter_thread_accuracy(self):
        s = corpus()[0]
        s['turns'][0]['gold']['thread'] = None
        rows = predictions()
        rows[0]['pred'] = 'temporary'
        o, _ = score.score_session(s, rows, 'open')
        self.assertTrue(o[0]['accurate'])
        self.assertEqual(o[0]['kind'], 'oneoff_isolated')
        self.assertEqual(score.evaluate([s], rows)['accuracy'], 1)
        rows[0]['pred'] = 'ERROR'
        self.assertFalse(score.score_session(s, rows, 'open')[0][0]['accurate'])

    def test_ambiguous_large_catalog_targets_do_not_lower_identifiable_recall(self):
        s = corpus()[0]
        s['catalog'] += [{'id': f'c{i}'} for i in range(22)]
        s['turns'][0]['ambiguous'] = True
        rows = predictions()
        rows[0]['trace']['candidateIds'] = ['a']
        r = score.evaluate([s], rows)['routing_v1']['large_catalog']
        self.assertEqual(r['n'], 1)
        self.assertEqual(r['ambiguous_n'], 1)
        self.assertEqual(r['recall_at_16'], 1)

    def test_drop_user_refs_is_a_supported_ablation_comparison(self):
        full = predictions()
        other = [dict(r, state_ablation='drop-user-refs') for r in full]
        r = score.evaluate(corpus(), full, ablation_predictions=other)
        self.assertEqual(r['routing_v1']['pairs']['ablation']['state_ablation'], 'drop-user-refs')

    def test_reference_dependent_conflicts_are_separate_from_unmarked_accuracy(self):
        s = corpus()
        s[0]['turns'][0]['gold']['requires_user_ref'] = True
        full = score.evaluate(s, predictions())
        other = [dict(r, state_ablation='drop-user-refs') for r in predictions()]
        ablated = score.evaluate(s, other)
        self.assertEqual(full['accuracy'], 0.5)
        self.assertEqual(ablated['accuracy'], 1)
        self.assertEqual(ablated['routing_v1']['by_scenario']['unspecified']['ambiguous_n'], 1)

    def test_pair_ablation_delta_uses_the_same_identifiable_pairs_on_both_sides(self):
        a, b = corpus()[0], copy.deepcopy(corpus()[0])
        b['session_id'] = 'other'
        a['turns'] = [turn(0, 'a', True)]
        b['turns'] = [turn(0, 'b', True)]
        a['pair'] = {'id': 'p', 'side': 'a', 'kind': 'foreground', 'turn_i': 0}
        b['pair'] = dict(a['pair'], side='b')
        a['turns'][0]['gold']['requires_user_ref'] = True
        b['turns'][0]['gold']['requires_user_ref'] = True
        rows = [dict(predictions()[0], pred='a'), dict(predictions()[0], session_id='other', pred='b')]
        other = [dict(r, pred='a', state_ablation='drop-user-refs') for r in rows]
        r = score.evaluate([a,b], rows, ablation_predictions=other)['routing_v1']['pairs']['ablation']
        self.assertEqual(r['comparable_pairs'], 0)
        self.assertIsNone(r['accuracy_delta'])

if __name__ == '__main__':
    unittest.main()
