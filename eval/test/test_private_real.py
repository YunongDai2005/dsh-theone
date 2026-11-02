"""Synthetic-only privacy and extraction tests. No real chat fixtures."""
import importlib
import json
from pathlib import Path
import sys
import unittest
from collections import Counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
try:
    redact_module = importlib.import_module('private_real_redact')
except ModuleNotFoundError:
    redact_module = None
try:
    pipeline = importlib.import_module('private_real')
except ModuleNotFoundError:
    pipeline = None


def at(n):
    return f'2026-01-01T00:{n:02d}:00.000Z'


def session(name, times, source='claude'):
    return {'id': name, 'source': source, 'messages': [
        {'id': name + str(n), 'at': at(n), 'text': f'Invented {name} telescope planning item {n}',
         'has_paste': False, 'paste_chars': 0} for n in times], 'replies': [],
            'projects': [{'at': at(times[0]), 'name': 'fictional-' + name, 'key': name}],
            'metadata': [], 'attachment_hints': []}


class RedactionTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(redact_module, 'redaction implementation is missing')
        self.r = redact_module.Redactor()

    def test_provider_token_families_never_survive(self):
        for prefix in ('oc_' + 'sk_', 'sk' + '-', 'sk-ant' + '-', 'ghp' + '_',
                       'gho' + '_', 'github_pat' + '_', 'xoxb' + '-', 'xoxa' + '-',
                       'xoxp' + '-', 'xoxr' + '-'):
            secret = prefix + 'FAKEONLY7z' * 6
            with self.subTest(family=prefix):
                result = self.r.redact('value ' + secret)
                self.assertNotIn(secret, result)
                self.assertIn('[KEY:', result)
        secret = 'AK' + 'IA' + 'Z7' * 8
        self.assertNotIn(secret, self.r.redact(secret))

    def test_bearer_jwt_hex_and_base64_are_redacted(self):
        examples = [('Bearer ' + 'FAKEonly17' * 5, 'BEARER'),
                    ('.'.join(('eyJ' + 'a' * 25, 'eyJ' + 'b' * 25, 'c' * 43)), 'JWT'),
                    ('ab12' * 12, 'HEX'), ('ZmFrZV9PTkxZXzE3' * 4 + '==', 'BASE64')]
        for value, label in examples:
            result = self.r.redact(value)
            self.assertNotIn(value, result)
            self.assertIn('[' + label + ':', result)

    def test_assignments_short_secrets_quotes_and_url_credentials(self):
        cases = ['password=not-a-real-password', 'token="synthetic value"',
                 'api_key: "made_up"', '{"access_token":"invented"}',
                 'https://demo:pretend@example.invalid/path',
                 '\u5bc6\u7801\uff1a\u4ec5\u4f9b\u6d4b\u8bd5']
        for value in cases:
            self.assertNotEqual(value, self.r.redact(value))

    def test_email_phone_and_home_paths(self):
        result = self.r.redact('nobody@example.invalid +86 139 0000 1234 +1 (202) 555-0199 '
                               'C:\\Users\\ExampleUser\\work /home/example/work /Users/example/work')
        self.assertNotIn('nobody@', result)
        self.assertNotIn('139', result)
        self.assertNotIn('555', result)
        self.assertNotIn('ExampleUser', result)
        self.assertEqual(result.count('~/work'), 2)
        self.assertIn('~\\work', result)

    def test_escaped_home_and_local_international_phone(self):
        home = 'C:' + chr(92) * 2 + 'Users' + chr(92) * 2 + 'ExampleUser' + chr(92) * 2 + 'work'
        phone = '202' + '-555-0199'
        result = self.r.redact(home + ' ' + phone)
        self.assertNotIn('ExampleUser', result)
        self.assertNotIn(phone, result)

    def test_idempotent_and_preserves_ordinary_text(self):
        text = 'Invented task: adjust the lantern to 42 cm.'
        self.assertEqual(text, self.r.redact(text))
        once = self.r.redact('token=' + 'PretendOnly9' * 5)
        counts = dict(self.r.counts)
        self.assertEqual(once, self.r.redact(once))
        self.assertEqual(counts, dict(self.r.counts))

    def test_sanitize_before_truncation(self):
        secret = 'sk' + '-' + 'FAKEONLY8' * 60
        result = self.r.summary('Intro ' + secret, 200)
        self.assertLessEqual(len(result), 200)
        self.assertNotIn('FAKEONLY8', result)
        self.assertGreater(self.r.counts['key'], 0)


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(pipeline, 'private extraction implementation is missing')
        self.r = redact_module.Redactor()
        self.stats = Counter()

    def test_paste_blocks_removed_but_user_sentence_preserved(self):
        value = 'Please compare these. <pasted_content>invented pasted body</pasted_content>\n```txt\nfictional log\n```'
        clean = pipeline.clean_user(value, self.r, self.stats)
        self.assertIn('Please compare these.', clean['text'])
        self.assertNotIn('invented pasted body', clean['text'])
        self.assertNotIn('fictional log', clean['text'])
        self.assertTrue(clean['has_paste'])
        self.assertGreater(clean['paste_chars'], 0)

    def test_system_injection_compaction_and_paste_only_are_not_human_messages(self):
        for value in ('<system-reminder>synthetic system</system-reminder>',
                      '<environment_context>invented settings</environment_context>',
                      'This session is being continued from a previous conversation that ran out of context. invented',
                      '# AGENTS.md instructions for /fictional\n<INSTRUCTIONS>synthetic</INSTRUCTIONS>',
                      '<pasted_content>only pasted data</pasted_content>',
                      '[Request interrupted by user]'):
            self.assertIsNone(pipeline.clean_user(value, self.r, self.stats))

    def test_injected_block_does_not_erase_adjacent_human_text(self):
        result = pipeline.clean_user('<system-reminder>invented injection</system-reminder>Move the blue lantern.', self.r, self.stats)
        self.assertEqual(result['text'], 'Move the blue lantern.')

    def test_claude_tool_meta_sidechain_duplicate_and_summary_filters(self):
        def row(uid, content, **extra):
            return {'type': 'user', 'uuid': uid, 'sessionId': 'fiction', 'timestamp': at(1),
                    'message': {'role': 'user', 'content': content}, **extra}
        rows = [row('u1', 'Plan an imaginary garden.'), row('u1', 'Plan an imaginary garden.'),
                row('u2', [{'type': 'tool_result', 'content': 'invented tool output'}]),
                row('u3', 'injected', isMeta=True), row('u4', 'agent message', isSidechain=True),
                row('u5', 'synthetic summary', isCompactSummary=True)]
        sessions = pipeline.parse_claude(rows, 'file1', self.r, self.stats)
        self.assertEqual(sum(len(s['messages']) for s in sessions), 1)
        self.assertEqual(sessions[0]['messages'][0]['text'], 'Plan an imaginary garden.')

    def test_claude_hook_origin_is_never_a_human_prompt(self):
        rows = [{'type': 'user', 'uuid': 'hook', 'sessionId': 'fiction', 'timestamp': at(1),
                 'origin': {'kind': 'hook'}, 'message': {'role': 'user', 'content': 'Invented hook output.'}}]
        self.assertEqual(pipeline.parse_claude(rows, 'file1', self.r, self.stats), [])

    def test_codex_event_mirror_is_not_counted_twice_and_subagents_are_excluded(self):
        rows = [{'type': 'session_meta', 'payload': {'id': 'fiction', 'source': 'vscode'}},
                {'type': 'event_msg', 'timestamp': at(1), 'payload': {'type': 'user_message', 'message': 'Plan an imaginary canal.'}},
                {'type': 'response_item', 'timestamp': at(1), 'payload': {'type': 'message', 'role': 'user',
                    'content': [{'type': 'input_text', 'text': 'Plan an imaginary canal.'}]}}]
        result = pipeline.parse_codex(rows, 'file1', self.r, self.stats)
        self.assertEqual(len(result[0]['messages']), 1)
        for origin in ({'subagent': {'spawn': {}}}, 'exec'):
            rows[0]['payload']['source'] = origin
            self.assertEqual(pipeline.parse_codex(rows, 'file1', self.r, Counter()), [])

    def test_dispatched_task_excludes_whole_session(self):
        records = [{'type': 'session_meta', 'payload': {'id': 'fiction', 'source': 'vscode'}},
                   {'type': 'response_item', 'timestamp': at(1), 'payload': {'type': 'message', 'role': 'user',
                    'content': [{'type': 'input_text', 'text': 'Read .codex-runs/task.md and implement the assigned brief.'}]}},
                   {'type': 'response_item', 'timestamp': at(2), 'payload': {'type': 'message', 'role': 'user',
                    'content': [{'type': 'input_text', 'text': 'continue'}]}}]
        self.assertEqual(pipeline.parse_codex(records, 'file1', self.r, self.stats), [])

    def test_interleave_omits_simulated_foreground_and_replies(self):
        a, b = session('a', [0, 4, 8]), session('b', [1, 5, 9], 'codex')
        a['replies'] = [{'at': at(3), 'text': 'Earlier fictional answer.'}]
        b['replies'] = [{'at': at(2), 'text': 'Other fictional answer.'}]
        stream = pipeline.make_stream([a, b], 'dev', 1)
        self.assertEqual([t['at'] for t in stream['turns']], [at(4), at(5), at(8)])
        self.assertTrue(all(t['events_before'] == [] and t['reply'] == '' for t in stream['turns']))
        self.assertNotIn('current_id', stream)
        self.assertEqual(stream['observation_basis'], 'unavailable_multi_window')

    def test_warmup_is_unseeded_past_only_and_includes_multiple_requests(self):
        self.assertIsNone(pipeline.make_stream([session('a', [0, 1]), session('b', [3, 4])], 'dev', 1))
        a, b = session('a', [0, 1, 2, 3, 4, 5, 8]), session('b', [6, 7, 9])
        a['messages'][5]['text'] = 'Sixth request must not be included in the card.'
        a['messages'][-1]['text'] = 'Future invented subject must never be in warmup.'
        a['metadata'] = [{'at': at(2), 'kind': 'title', 'text': 'Fictional lantern plan'},
                         {'at': at(7), 'kind': 'summary', 'text': 'Future metadata forbidden'}]
        stream = pipeline.make_stream([a, b], 'dev', 2)
        self.assertEqual(stream['catalog'], [])
        self.assertTrue(stream.get('warmup'))
        text = json.dumps(stream['warmup'])
        self.assertIn('planning item 4', text)
        self.assertIn('Fictional lantern plan', text)
        self.assertIn('fictional-a', text)
        self.assertNotIn('Sixth request', text)
        self.assertNotIn('Future', text)
        self.assertTrue(all(t['at'] < stream['overlap_start'] for t in stream['warmup']))
        self.assertTrue(all(t['at'] >= stream['overlap_start'] for t in stream['turns']))
        self.assertLess(max(t['i'] for t in stream['warmup']), min(t['i'] for t in stream['turns']))
        self.assertTrue(all(t['gold']['thread'] is None for t in stream['warmup']))
        self.assertFalse(any(t['title'].startswith('Topic ') for t in stream['threads']))

    def test_insufficient_cards_are_excluded_and_counted(self):
        a, b = session('a', [0, 3, 5]), session('b', [1, 4, 6])
        for m in a['messages']: m['text'] = 'ok'
        self.assertIsNone(pipeline.make_stream([a, b], 'dev', 1))
        streams, info = pipeline.build_interleaved([a, b, session('c', [20, 22, 24]), session('d', [21, 23, 25])])
        self.assertEqual(info.get('insufficient_card_sessions'), 1)

    def test_card_can_start_after_a_short_first_prompt_without_future_leak(self):
        a, b = session('a', [0, 2, 6]), session('b', [1, 3, 7])
        a['messages'][0]['text'] = 'ok'
        stream = pipeline.make_stream([a, b], 'dev', 1)
        self.assertIsNotNone(stream)
        self.assertTrue(all(t['at'] > at(2) for t in stream['turns']))

    def test_project_scope_compares_directory_identity_and_reports_unknown(self):
        a, b = session('a', [0, 3, 5]), session('b', [1, 4, 6])
        self.assertEqual(pipeline.make_stream([a, b], 'dev', 1).get('project_scope'), 'cross_project')
        b['projects'] = a['projects']
        self.assertEqual(pipeline.make_stream([a, b], 'dev', 1).get('project_scope'), 'same_project')
        b['projects'] = []
        self.assertEqual(pipeline.make_stream([a, b], 'dev', 1).get('project_scope'), 'unknown')

    def test_host_prefixes_nested_and_generic_leading_xml_are_removed(self):
        for tag in ('external_codex_apps_open_page', 'codex_internal_context', 'environment_context',
                    'user_instructions', 'command-invented', 'local-command-invented', 'ide_selection', 'future_host'):
            with self.subTest(tag=tag):
                block = f'<{tag} source="fiction > only"><{tag}>nested fixture</{tag}>injected fixture</{tag}>'
                self.assertIsNone(pipeline.clean_user(block, self.r, self.stats))
                result = pipeline.clean_user(block + '\nPlan an imaginary observatory.', self.r, self.stats)
                self.assertEqual(result['text'], 'Plan an imaginary observatory.')
        result = pipeline.clean_user('Plan the observatory. <ide_selection>hidden</ide_selection>', self.r, self.stats)
        self.assertEqual(result['text'], 'Plan the observatory.')
        self.assertTrue(any(k.startswith('stripped_blocks:') for k in self.stats))

    def test_injection_counts_distinguish_removed_blocks_from_excluded_messages(self):
        pipeline.clean_user('<external_codex_apps_demo>fixture</external_codex_apps_demo>Plan the fictional telescope.', self.r, self.stats)
        pipeline.clean_user('<external_codex_apps_demo>fixture</external_codex_apps_demo>', self.r, self.stats)
        self.assertEqual(self.stats['stripped_blocks:external_codex_apps'], 2)
        self.assertEqual(self.stats['excluded_injection_only:external_codex_apps'], 1)

    def test_summary_after_injection_and_unclosed_known_host_are_excluded(self):
        self.assertIsNone(pipeline.clean_user('<environment_context>fiction</environment_context>This session is being continued from a previous conversation.', self.r, self.stats))
        self.assertIsNone(pipeline.clean_user('<codex_internal_context>unfinished host block', self.r, self.stats))

    def test_only_attachment_paths_are_not_eval_messages_and_hints_are_basenames(self):
        records = [
            {'type': 'user', 'uuid': 'a', 'sessionId': 'fiction', 'timestamp': at(0), 'cwd': 'D:/lab/observatory',
             'message': {'content': '@"D:/private/fake plan.md" @./notes.txt'}},
            {'type': 'user', 'uuid': 'b', 'sessionId': 'fiction', 'timestamp': at(1), 'cwd': 'D:/lab/observatory',
             'message': {'content': 'Compare the invented telescope plans.'}},
        ]
        out = pipeline.parse_claude(records, 'file', self.r, self.stats)[0]
        self.assertEqual(len(out['messages']), 1)
        self.assertEqual(self.stats['excluded_attachment_only'], 1)
        self.assertEqual(out['attachment_hints'][0]['names'], ['fake plan.md', 'notes.txt'])
        self.assertNotIn('D:/private', json.dumps(out))
        result = pipeline.clean_user('Compare @"D:/private/notes.txt" carefully.', self.r, self.stats)
        self.assertNotIn('D:/private', result['text'])
        self.assertIn('notes.txt', result['text'])

    def test_windows_project_leaf_is_casefolded_and_attachments_lose_directories(self):
        a = pipeline.new_session('a', 'codex')
        b = pipeline.new_session('b', 'codex')
        pipeline.add_project(a, 'D:' + chr(92) + 'fiction' + chr(92) + 'OBSERVATORY', at(0), self.r)
        pipeline.add_project(b, '/fiction/observatory/', at(0), self.r)
        self.assertEqual(a['projects'][0]['key'], b['projects'][0]['key'])
        hints = []
        value = '@"D:' + chr(92) + 'fiction' + chr(92) + 'lens.md"'
        self.assertIsNone(pipeline.clean_user(value, self.r, self.stats, hints=hints))
        self.assertEqual(hints, ['lens.md'])

    def test_dispatch_filter_ignores_removed_host_task_descriptions(self):
        rows = [{'type': 'session_meta', 'payload': {'id': 'fiction', 'source': 'vscode'}},
                {'type': 'response_item', 'timestamp': at(0), 'payload': {'type': 'message', 'role': 'user',
                  'content': '<codex_internal_context>task file: fiction.md</codex_internal_context>Plan the fictional telescope mount.'}}]
        self.assertEqual(len(pipeline.parse_codex(rows, 'file', self.r, self.stats)), 1)

    def test_claude_untimed_title_never_enters_a_card(self):
        rows = [{'type': 'custom-title', 'sessionId': 'fiction', 'customTitle': 'Untimed future title'},
                {'type': 'summary', 'sessionId': 'fiction', 'timestamp': at(0), 'summary': 'Timed fictional history'},
                {'type': 'user', 'uuid': 'u', 'sessionId': 'fiction', 'timestamp': at(1),
                 'cwd': 'D:/lab/observatory', 'message': {'content': 'Compare invented telescope mount designs.'}}]
        out = pipeline.parse_claude(rows, 'file', self.r, self.stats)[0]
        self.assertEqual([m['text'] for m in out.get('metadata', [])], ['Timed fictional history'])
        self.assertEqual(self.stats['metadata_untimed_excluded'], 1)
        self.assertEqual(out['projects'][0]['name'], 'observatory')

    def test_codex_meta_project_and_timestamped_title_are_sanitized(self):
        rows = [{'type': 'session_meta', 'timestamp': at(0), 'payload': {'id': 'fiction', 'source': 'vscode',
                  'cwd': 'C:/Users/Fictional/private/observatory', 'thread_name': 'Plan for nobody@example.invalid'}},
                {'type': 'response_item', 'timestamp': at(1), 'payload': {'type': 'message', 'role': 'user',
                  'content': [{'type': 'input_text', 'text': 'Compare invented telescope mount designs.'}]}}]
        out = pipeline.parse_codex(rows, 'file', self.r, self.stats)[0]
        self.assertEqual(out.get('projects', [{}])[0].get('name'), 'observatory')
        self.assertTrue(out.get('metadata'))
        self.assertNotIn('nobody@', json.dumps(out))
        self.assertNotIn('Fictional/private', json.dumps(out))

    def test_copied_history_cannot_create_fake_parallel_source_sessions(self):
        self.assertTrue(hasattr(pipeline, 'deduplicate_history'))
        original, fork = session('original', [0, 2, 4]), session('fork', [0, 2, 8])
        fork['messages'][:2] = [dict(m) for m in original['messages'][:2]]
        stats = {'claude': Counter(), 'codex': Counter()}
        cleaned = pipeline.deduplicate_history([fork, original], stats)
        by_id = {s['id']: s for s in cleaned}
        self.assertEqual([m['at'] for m in by_id['original']['messages']], [at(0), at(2), at(4)])
        self.assertEqual([m['at'] for m in by_id['fork']['messages']], [at(8)])
        self.assertIsNone(pipeline.make_stream(cleaned, 'dev', 1))
        self.assertEqual(stats['claude']['shared_history_users_excluded'], 2)
        self.assertEqual(len(fork['messages']), 3)

    def test_pair_first_grouping_retains_two_flows_from_four_overlapping_windows(self):
        sessions = [session('a', range(0, 29, 4)), session('b', range(1, 30, 4)),
                    session('c', range(2, 31, 4)), session('d', range(3, 32, 4)),
                    session('e', range(40, 57, 2)), session('f', range(41, 58, 2))]
        streams, _ = pipeline.build_interleaved(sessions)
        self.assertEqual(sum(s['split'] == 'dev' for s in streams), 2)
        self.assertEqual(sum(s['split'] == 'test' for s in streams), 1)
        self.assertEqual(len({x for s in streams for x in s['source_sessions']}), 6)

    def test_split_has_no_session_or_time_leak_and_cap_is_global(self):
        sessions = [session('a', range(0, 23, 2)), session('b', range(1, 24, 2)),
                    session('c', range(30, 53, 2)), session('d', range(31, 54, 2))]
        streams, info = pipeline.build_interleaved(sessions, max_messages=40)
        self.assertLessEqual(sum(len(s['turns']) for s in streams), 40)
        dev = [s for s in streams if s['split'] == 'dev']
        test = [s for s in streams if s['split'] == 'test']
        self.assertTrue(dev and test)
        self.assertLess(max(t['at'] for s in dev for t in s['turns']), min(t['at'] for s in test for t in s['turns']))
        self.assertTrue(set(x for s in dev for x in s['source_sessions']).isdisjoint(x for s in test for x in s['source_sessions']))

    def test_dsh_corrections_override_but_unconfirmed_are_not_strict(self):
        s = session('gateway', [0, 1, 2], 'dsh')
        for n, m in enumerate(s['messages']): m['route_id'] = str(n)
        s['replies'] = [{'at': at(0), 'text': 'Fictional visible reply.', 'route_id': '0'}]
        routes = {'0': {'topic': 'a', 'corrected': None}, '1': {'topic': 'b', 'corrected': 'a'},
                  '2': {'topic': 'b', 'corrected': None}}
        result = pipeline.make_gateway(s, routes, 'dev', 1)
        self.assertEqual(result['turns'][0]['gold']['confidence'], 'unconfirmed')
        self.assertTrue(result['turns'][0]['ambiguous'])
        self.assertFalse(result['turns'][1]['ambiguous'])
        self.assertEqual(result['turns'][0]['gold']['thread'], result['turns'][1]['gold']['thread'])
        self.assertEqual(len(result['turns']), 3)

    def test_gateway_partition_preserves_order_and_temporal_boundary(self):
        self.assertTrue(hasattr(pipeline, 'split_gateway'), 'temporal gateway adapter is missing')
        s = session('gateway', [0, 2, 4], 'dsh')
        for n, message in enumerate(s['messages']): message['route_id'] = str(n)
        routes = {str(n): {'topic': 'topic', 'corrected': None} for n in range(3)}
        streams = pipeline.split_gateway(s, routes, at(2), 1)
        self.assertEqual([(x['split'], len(x['turns'])) for x in streams], [('dev', 2), ('test', 1)])
        self.assertEqual([t['at'] for x in streams for t in x['turns']], [at(0), at(2), at(4)])

    def test_short_is_scored_and_has_tags(self):
        a, b = session('a', [0, 3, 5]), session('b', [1, 4, 6])
        a['messages'][1]['text'] = 'ok'
        stream = pipeline.make_stream([a, b], 'dev', 1)
        self.assertIn('short', stream['turns'][0]['tags'])
        self.assertFalse(stream['turns'][0]['ambiguous'])
        self.assertIn('switch', stream['turns'][1]['tags'])
        self.assertIn('lang:en', stream['turns'][0]['tags'])



from contextlib import contextmanager


@contextmanager
def private_temp(dir):
    # Python 3.14 TemporaryDirectory uses a restrictive Windows ACL that does
    # not admit this sandbox token. Ordinary workspace mkdir inherits its ACL.
    import shutil
    import uuid
    root = Path(dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    path = root / ('synthetic-test-' + uuid.uuid4().hex[:12])
    path.mkdir()
    try:
        yield path
    finally:
        if path.resolve().parent != root:
            raise ValueError('Unsafe synthetic fixture cleanup target')
        shutil.rmtree(path)

class StorageTests(unittest.TestCase):
    def setUp(self):
        import importlib.util
        path = Path(__file__).resolve().parents[1] / 'generate-private-real.py'
        self.assertTrue(path.exists(), 'offline generator is missing')
        spec = importlib.util.spec_from_file_location('private_generator', path)
        self.g = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.g)

    def test_write_guard_rejects_public_directory_and_existing_file(self):
        import contextlib
        root = self.g.PRIVATE_ROOT
        root.mkdir(parents=True, exist_ok=True)
        with private_temp(dir=root) as temp:
            p = Path(temp) / 'test.json'
            self.g.write_private(p, {'safe': 'invented'})
            with self.assertRaises(FileExistsError): self.g.write_private(p, {})
            with self.assertRaises(ValueError): self.g.write_private(root.parent / 'public.json', {})

    def test_readonly_dsh_joins_gateway_user_not_worker_copy(self):
        import contextlib
        import sqlite3
        from compression import zstd
        with private_temp(dir=self.g.PRIVATE_ROOT) as temp:
            home = Path(temp)
            base = home / '.dsh'
            (base / 'sessions').mkdir(parents=True)
            (base / 'theone').mkdir()
            db = base / 'theone/contexts.db'
            c = sqlite3.connect(db)
            c.executescript('CREATE TABLE routing_events(message_id TEXT, gateway_id TEXT, decision TEXT, status TEXT, created_at TEXT); CREATE TABLE route_details(message_id TEXT, corrected_to TEXT, corrected_at INTEGER);')
            c.execute('INSERT INTO routing_events VALUES(?,?,?,?,?)', ('u1', 'gateway', json.dumps({'contextId':'topic'}), 'done', at(1)))
            c.execute('INSERT INTO route_details VALUES(?,?,?)', ('u1', 'fixed', 10))
            c.commit(); c.close()
            for sid, kind in [('gateway', 'user'), ('worker', 'theone-context')]:
                rows = [{'type':'session','id':sid,'delegationDepth':0},
                        {'type':'user/message','seq':1,'time':1767225660000,'data':{'id':'u1','role':'user','source':{'kind':kind},'content':[{'type':'text','text':'Invented clock project.'}]}},
                        {'type':'assistant/message','seq':2,'time':1767225670000,'data':{'message':{'id':'reply1','role':'assistant','content':[{'type':'text','text':'A fictional reply.'}]}}}]
                (base / 'sessions' / (sid + '.jsonl.zstd')).write_bytes(zstd.compress(b'\n'.join(json.dumps(r).encode() for r in rows)))
            before = db.read_bytes()
            stats = Counter()
            sessions, routes = self.g.read_dsh(home, redact_module.Redactor(), stats)
            self.assertEqual(sum(len(s['messages']) for s in sessions), 1)
            self.assertEqual(routes['u1']['corrected'], 'fixed')
            self.assertEqual(db.read_bytes(), before)
            self.assertFalse(Path(str(db) + '-wal').exists())

    def test_writer_redacts_before_any_bytes_reach_disk(self):
        with private_temp(dir=self.g.PRIVATE_ROOT) as temp:
            target = temp / 'redaction.json'
            fake = 'sk' + '-' + 'SYNTHETIC8' * 6
            self.g.write_private(target, {'nested': [{'text': fake}]})
            self.assertNotIn(fake, target.read_text(encoding='utf-8'))
            self.assertIn('[KEY:', target.read_text(encoding='utf-8'))

    def test_codex_index_is_timestamped_and_filtered_at_card_boundary(self):
        self.assertTrue(hasattr(self.g, 'read_codex_index'))
        with private_temp(dir=self.g.PRIVATE_ROOT) as temp:
            (temp / '.codex').mkdir()
            rows = [{'id': 'fiction', 'thread_name': 'Past fictional telescope title', 'updated_at': at(0)},
                    {'id': 'fiction', 'thread_name': 'Future title cannot appear', 'updated_at': at(5)},
                    {'id': 'fiction', 'thread_name': 'Unknown date title'}]
            (temp / '.codex/session_index.jsonl').write_text('\n'.join(json.dumps(r) for r in rows), encoding='utf-8')
            item = session('fiction', [1, 3, 6], 'codex')
            item['id'] = pipeline.alias('codex:fiction')
            stats = Counter()
            self.g.read_codex_index(temp, [item], redact_module.Redactor(), stats)
            card = pipeline.card_for(item, at(3))
            self.assertIn('Past fictional', card['title'])
            self.assertNotIn('Future title', json.dumps(card))
            self.assertEqual(stats['metadata_untimed_excluded'], 1)

    def test_wal_snapshot_is_not_silently_ignored(self):
        import contextlib
        with private_temp(dir=self.g.PRIVATE_ROOT) as temp:
            home = Path(temp)
            folder = home / '.dsh/theone'
            folder.mkdir(parents=True)
            (folder / 'contexts.db').write_bytes(b'synthetic non-database')
            (folder / 'contexts.db-wal').write_bytes(b'synthetic pending transaction')
            with self.assertRaises(ValueError): self.g.read_dsh(home, redact_module.Redactor(), Counter())


if __name__ == '__main__':
    unittest.main()
