"""Hand-labelled births, time boundaries, and score/CLI contracts."""
import copy
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import shutil
import uuid
import unittest

EVAL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EVAL))
import score

SCRIPT = EVAL / 'fragment-buckets.py'
fragment_buckets = None
if SCRIPT.exists():
    spec = importlib.util.spec_from_file_location('fragment_buckets', SCRIPT)
    fragment_buckets = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fragment_buckets)


def fixture(preds=None, mode='closed', golds=None):
    preds = preds or ['t1', 't1', 'f', 'f', 't1', 't1']
    golds = golds or ['t1'] * len(preds)
    session = {
        'session_id': 's', 'split': 'dev', 'lang': 'zh',
        'threads': [
            {'id': 't1', 'title': '数据分析岗位求职', 'description': '简历和面试', 'domain': 'job search'},
            {'id': 't2', 'title': '产品运营岗位求职', 'description': '另一份简历', 'domain': 'job search'},
        ],
        'turns': [{'i': i, 'text': '数据分析岗位面试', 'ambiguous': False, 'tags': ['explicit'],
                   'gold': {'thread': g, 'action': 'continue' if g else 'oneoff', 'refs': []}}
                  for i, g in enumerate(golds)],
    }
    known = {'t1', 't2'} if mode == 'closed' else set()
    rows = []
    for i, pred in enumerate(preds):
        candidates = sorted(known)
        action = 'CREATE' if pred not in known else 'KEEP' if i and pred == preds[i - 1] else 'SWAP'
        decision = {'action': action, 'contextId': pred}
        if action == 'CREATE':
            decision['title'] = '数据分析岗位求职' if pred in ('t1', 'a') else '新片段'
        rows.append({
            'session_id': 's', 'i': i, 'pred': pred, 'mode': mode, 'action': action,
            'replay': 'product-v1', 'tier': 'quick', 'via': 'llm', 'decision': decision,
            'trace': {'candidateIds': candidates, 'initial': dict(decision), 'final': dict(decision),
                      'recheck': {'attempted': False}, 'review': {'attempted': False, 'pages': []},
                      'autoSettled': False}, 'card_usage': [],
        })
        if pred not in score.SPECIAL:
            known.add(pred)
    return session, rows


@contextmanager
def workspace_temp():
    # Match the existing test_private_real.py workspace-temp convention.
    # TemporaryDirectory's private Windows ACL excludes the sandbox token.
    root = (EVAL / '.cache' / 'fragment-tests').resolve()
    root.mkdir(parents=True, exist_ok=True)
    path = root / ('synthetic-' + uuid.uuid4().hex)
    path.mkdir()
    try:
        yield path
    finally:
        if path.resolve().parent != root:
            raise ValueError('Unsafe synthetic fixture cleanup target')
        shutil.rmtree(path)


class FragmentBucketsTest(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(fragment_buckets, 'fragment-buckets.py must implement the offline analysis')

    def analyze(self, session, rows):
        return fragment_buckets.analyze([session], rows)

    def birth(self, session, rows):
        result = self.analyze(session, rows)
        self.assertEqual(result['fragment_count'], 1)
        return result['events'][0]

    def test_missing_existing_topic_is_a_recall_miss(self):
        s, rows = fixture()
        rows[2]['trace']['candidateIds'] = ['t2']
        event = self.birth(s, rows)
        self.assertEqual((event['bucket'], event['subtype']), ('A', 'not_recalled'))
        self.assertEqual(event['existing_thread_topic_ids'], ['t1'])

    def test_create_stays_create_even_after_recheck(self):
        s, rows = fixture()
        rows[2]['trace']['recheck'] = {'attempted': True, 'accepted': True, 'previous': 'CREATE'}
        event = self.birth(s, rows)
        self.assertEqual((event['bucket'], event['subtype']), ('B', 'create_stayed'))

    def test_correct_initial_decision_is_overturned_by_accepted_recheck(self):
        s, rows = fixture()
        rows[2]['trace']['initial'] = {'action': 'EXISTING', 'contextId': 't1'}
        rows[2]['trace']['recheck'] = {'attempted': True, 'accepted': True, 'previous': 't1'}
        self.assertEqual(self.birth(s, rows)['subtype'], 'recheck_overturned')

    def test_wrong_existing_route_not_rescued_is_separate_from_create(self):
        s, rows = fixture(preds=['t1', 't1', 't2', 't2', 't1', 't1'])
        rows[2]['trace']['recheck'] = {'attempted': True, 'accepted': False}
        self.assertEqual(self.birth(s, rows)['subtype'], 'wrong_not_rescued')

    def test_rule_direct_route_is_not_a_model_candidate_miss(self):
        s, rows = fixture()
        rows[2].update(tier='fast', via='rules')
        rows[2]['trace']['candidateIds'] = []
        event = self.birth(s, rows)
        self.assertEqual((event['bucket'], event['subtype']), ('B', 'rule_direct'))

    def test_ambiguous_annotation_is_auditable_and_precedes_fallback(self):
        s, rows = fixture()
        s['turns'][2]['ambiguous'] = True
        rows[2].update(tier='rules', error='ROUTER_INVALID_DECISION')
        event = self.birth(s, rows)
        self.assertEqual((event['bucket'], event['subtype']), ('C', 'gold_ambiguous'))
        self.assertTrue(event['evidence']['ambiguous'])
        self.assertTrue(event['evidence']['model_fallback'])

    def test_failed_request_and_clarify_settlement_have_distinct_d_subtypes(self):
        for subtype in ('model_fallback', 'clarify_fallback'):
            with self.subTest(subtype=subtype):
                s, rows = fixture()
                if subtype == 'model_fallback':
                    rows[2].update(tier='rules', error='ROUTER_INVALID_DECISION')
                else:
                    rows[2]['trace']['initial'] = {'action': 'CLARIFY'}
                    rows[2]['trace']['autoSettled'] = True
                event = self.birth(s, rows)
                self.assertEqual((event['bucket'], event['subtype']), ('D', subtype))

    def test_oneoff_does_not_add_a_thread_and_reusing_its_topic_is_separate(self):
        s, rows = fixture(golds=['t1', 't1', None, 't1', 't1', 't1'])
        event = self.birth(s, rows)
        self.assertEqual((event['i'], event['subtype']), (3, 'oneoff_topic_reuse'))
        result = self.analyze(s, rows)
        self.assertEqual(result['counted_threads'], 1)
        self.assertEqual(result['oneoff_messages'], 1)
        self.assertEqual(result['propagation']['keep_messages'], 0)

    def test_keep_propagation_excludes_birth_and_counts_later_returns_separately(self):
        s, rows = fixture(preds=['t1', 't1', 'f', 'f', 't1', 'f', 'f', 't1', 't1'])
        result = self.analyze(s, rows)
        self.assertEqual(result['fragment_count'], 1)
        self.assertEqual(result['propagation']['keep_messages'], 2)
        self.assertEqual(result['propagation']['other_later_messages'], 1)
        self.assertEqual(result['propagation']['fragment_messages'], 4)
        self.assertEqual(result['events'][0]['keep_indices'], [3, 6])

    def test_an_unmatched_thread_is_not_given_an_invented_main(self):
        s, rows = fixture(preds=['p', 'p', 'p', 'p'], mode='open', golds=['t1', 't1', 't2', 't1'])
        result = self.analyze(s, rows)
        self.assertEqual(result['extra_topics'], 0)
        self.assertEqual(result['fragment_count'], 1)
        self.assertEqual(result['threads_without_observed_main'], 1)
        self.assertIsNone(result['events'][0]['main_id'])
        self.assertEqual(result['events'][0]['subtype'], 'no_prior_thread_topic')

    def test_late_main_does_not_turn_a_correct_first_create_into_a_recall_miss(self):
        s, rows = fixture(preds=['f', 'a', 'a', 'a', 'a', 'a'], mode='open')
        event = self.birth(s, rows)
        self.assertEqual(event['main_id'], 'a')
        self.assertIsNone(event['main_title'])
        self.assertEqual(event['subtype'], 'normal_open_start')
        result = self.analyze(s, rows)
        self.assertEqual(result['extra_topics'], 1)
        self.assertEqual(result['chronological_extra_births_on_main'], 1)

    def test_legitimate_initial_topic_following_is_not_reported_as_error_propagation(self):
        s, rows = fixture(preds=['f', 'f', 'f', 'a', 'a', 'a', 'a', 'a'], mode='open')
        result = self.analyze(s, rows)
        self.assertEqual(result['propagation']['keep_messages'], 2)
        self.assertEqual(result['propagation'].get('normal_start_keep_messages'), 2)
        self.assertEqual(result['propagation'].get('keep_after_other_births'), 0)

    def test_a_prior_fragment_can_be_seen_before_the_eventual_main_exists(self):
        s, rows = fixture(preds=['f', 'g', 'a', 'a', 'a', 'a'], mode='open')
        result = self.analyze(s, rows)
        event = next(e for e in result['events'] if e['i'] == 1)
        self.assertEqual(event['existing_thread_topic_ids'], ['f'])
        self.assertEqual((event['bucket'], event['subtype']), ('B', 'create_stayed'))
        self.assertIsNone(event['main_title'])

    def test_closed_first_route_can_be_wrong_even_without_prior_thread_messages(self):
        s, rows = fixture(preds=['f', 't1', 't1', 't1'])
        event = self.birth(s, rows)
        self.assertEqual(event['subtype'], 'create_stayed')
        self.assertEqual(event['main_title'], '数据分析岗位求职')

    def test_closed_never_used_main_is_counted_but_does_not_inflate_score(self):
        s, rows = fixture(preds=['f', 'f', 'f'])
        result = self.analyze(s, rows)
        self.assertEqual((result['fragment_count'], result['extra_topics']), (1, 0))
        self.assertEqual(result['topics_per_thread'], 1.0)
        self.assertEqual(result['threads_without_observed_main'], 1)

    def test_special_routes_and_unused_gold_threads_match_score_denominator(self):
        for mode in ('open', 'closed'):
            with self.subTest(mode=mode):
                s, rows = fixture(preds=['t1', 'CLARIFY', 'f', 'ERROR', 't1', 't1'], mode=mode)
                result = self.analyze(s, rows)
                reference = score.evaluate([s], rows)
                self.assertEqual(result['topics_per_thread'], 2.0)
                self.assertEqual(result['topics_per_thread'], reference['topics_per_thread'])
                self.assertTrue(result['score_check']['matches'])
                self.assertEqual(result['fragment_count'], 1)

    def test_missing_candidate_trace_is_unknown_not_proof_of_recall_failure(self):
        s, rows = fixture()
        del rows[2]['trace']['candidateIds']
        self.assertEqual(self.birth(s, rows)['subtype'], 'missing_trace')

    def test_review_page_exposure_prevents_a_false_recall_miss(self):
        s, rows = fixture()
        rows[2]['trace']['candidateIds'] = ['t2']
        rows[2]['trace']['review'] = {'attempted': True, 'pages': [['t1']]}
        event = self.birth(s, rows)
        self.assertEqual((event['bucket'], event['subtype']), ('B', 'review_not_rescued'))
        self.assertTrue(event['evidence']['target_seen_only_in_review'])

    def test_review_with_unlogged_intermediate_result_does_not_blame_recheck(self):
        s, rows = fixture()
        rows[2]['trace']['initial'] = {'action': 'EXISTING', 'contextId': 't1'}
        rows[2]['trace']['recheck'] = {'attempted': True, 'accepted': True}
        rows[2]['trace']['review'] = {'attempted': True, 'pages': [['t2']]}
        self.assertEqual(self.birth(s, rows)['subtype'], 'later_change_unresolved')

    def test_features_use_only_prior_titles_and_card_requests_and_count_intervening_turns(self):
        s, rows = fixture()
        s['turns'][1]['gold']['thread'] = None
        rows[0]['card_usage'] = [{'layer': 'card', 'input': 10}]
        rows[2]['card_usage'] = [{'layer': 'card', 'input': 20}]
        s['turns'][2]['text'] = '数据分析岗位求职'
        event = self.birth(s, rows)
        features = event['features']
        self.assertEqual(features['title_jaccard'], 1.0)
        self.assertEqual(features['intervening_turns'], 1)
        self.assertEqual(features['turns_since_card_request'], 2)
        self.assertIsNone(features['card_age_turns'])
        self.assertEqual(features['same_domain_candidate_ids'], ['t2'])
        self.assertEqual(event['candidate_titles'], {'t1': '数据分析岗位求职', 't2': '产品运营岗位求职'})

    def test_english_and_chinese_overlap_are_deterministic_without_model_calls(self):
        self.assertEqual(fragment_buckets.title_overlap('The garden shed', 'garden shed'), 1.0)
        self.assertEqual(fragment_buckets.title_overlap('数据分析', '数据分析'), 1.0)
        self.assertEqual(fragment_buckets.title_overlap('面试时间', '跑步计划'), 0.0)
        self.assertIsNone(fragment_buckets.title_overlap('something', None))

    def test_validation_rejects_missing_duplicate_and_foreign_predictions(self):
        s, rows = fixture()
        for bad, message in [(rows[:-1], 'Missing prediction'), (rows + [rows[0]], 'Duplicate prediction'),
                             (rows + [dict(rows[0], session_id='foreign')], 'Unexpected prediction')]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.analyze(s, bad)

    def test_json_and_table_cli_accept_multiple_files_and_honor_split_without_writes(self):
        s, rows = fixture()
        other = copy.deepcopy(s)
        other.update(session_id='test-session', split='test')
        other_rows = [dict(r, session_id='test-session', pred='t1') for r in rows]
        with workspace_temp() as directory:
            root = Path(directory)
            session_path = root / 'sessions.jsonl'
            prediction_paths = [root / 'run1' / 'same.jsonl', root / 'run2' / 'same.jsonl']
            for path, data in [(session_path, [s, other])] + [(p, rows + other_rows) for p in prediction_paths]:
                path.parent.mkdir(exist_ok=True)
                path.write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in data), encoding='utf-8')
            before = {str(p): p.read_bytes() for p in root.rglob('*.jsonl')}
            command = [sys.executable, str(SCRIPT), str(session_path), *map(str, prediction_paths), '--split', 'test']
            env = dict(os.environ, PYTHONIOENCODING='utf-8')
            json_run = subprocess.run(command + ['--json'], capture_output=True, text=True, encoding='utf-8', env=env)
            self.assertEqual(json_run.returncode, 0, json_run.stderr)
            results = json.loads(json_run.stdout)
            self.assertEqual(len(results), 2)
            self.assertEqual([r['source'] for r in results], list(map(str, prediction_paths)))
            self.assertTrue(all(r['fragment_count'] == 0 and r['sessions'] == 1 for r in results))
            table_run = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', env=env)
            self.assertEqual(table_run.returncode, 0, table_run.stderr)
            self.assertIn('| A | B | C | D |', table_run.stdout)
            self.assertEqual(before, {str(p): p.read_bytes() for p in root.rglob('*.jsonl')})
            self.assertFalse(list(root.rglob('*.score.json')))


if __name__ == '__main__':
    unittest.main()
