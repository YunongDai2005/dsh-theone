"""Fictional fixtures for attachment stripping and balanced temporal fragments."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'lib'))
import private_real as pipeline
from private_real_redact import Redactor


def source(name, minutes):
    epoch = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return {'id': name, 'source': 'codex', 'messages': [
        {'id': name + str(n), 'at': pipeline.timestamp(epoch + timedelta(minutes=n)),
         'text': 'Invented telescope mount planning and lens alignment.', 'has_paste': False}
        for n in minutes], 'replies': [], 'metadata': [], 'projects': [], 'attachment_hints': []}


class AutomaticBlockTests(unittest.TestCase):
    def test_file_block_keeps_only_redacted_basenames_and_real_request(self):
        stats, hints = Counter(), []
        text = ('# Files mentioned by the user:\n\n'
                '## design.md (D:/fiction/private/design.md)\n'
                'Automatically supplied attachment description.\n'
                '## nobody@example.invalid.txt (C:/Users/Fiction/nobody@example.invalid.txt)\n'
                'Attachment content must not become a routing request.\n'
                '## My request:\nCompare the fictional lens designs.')
        result = pipeline.clean_user(text, Redactor(), stats, hints=hints)
        self.assertNotIn('Automatically', result['text'])
        self.assertNotIn('Attachment content', result['text'])
        self.assertNotIn('Files mentioned', result['text'])
        self.assertNotIn('D:/fiction', result['text'])
        self.assertNotIn('nobody@', result['text'])
        self.assertIn('Compare the fictional lens designs.', result['text'])
        self.assertIn('design.md', hints)
        self.assertTrue(result['has_paste'])
        self.assertEqual(stats['auto_blocks:files_mentioned'], 1)
        self.assertEqual(stats['auto_block_users'], 1)

    def test_attachment_only_is_excluded_but_card_hints_survive(self):
        stats, hints = Counter(), []
        result = pipeline.clean_user('# Files mentioned by the user:\n- [lens.md](D:/fiction/lens.md)',
                                     Redactor(), stats, hints=hints)
        self.assertIsNone(result)
        self.assertEqual(hints, ['lens.md'])
        self.assertEqual(stats['excluded_attachment_only'], 1)

    def test_ide_context_and_request_wrapper_are_removed_without_eating_human_sections(self):
        stats = Counter()
        text = ('# Context from my IDE setup:\n## Active file: D:/fiction/lens.py\n'
                '## Open tabs:\n- mirror.py: D:/fiction/mirror.py\n'
                '## My request for Codex:\nPlan a fictional telescope.\n'
                '# Constraints\nKeep the tripod portable.')
        result = pipeline.clean_user(text, Redactor(), stats)
        self.assertNotIn('Open tabs', result['text'])
        self.assertNotIn('D:/fiction', result['text'])
        self.assertIn('# Constraints', result['text'])
        self.assertIn('Keep the tripod portable.', result['text'])
        self.assertEqual(stats['auto_blocks:ide_context'], 1)

    def test_attachment_examples_inside_fences_are_not_host_blocks(self):
        stats = Counter()
        text = ('Explain this imaginary format.\n```text\n# Files mentioned by the user:\n'
                '- [demo.md](D:/fiction/demo.md)\n## My request:\nExample only.\n```\n'
                'Keep the explanation brief.')
        result = pipeline.clean_user(text, Redactor(), stats)
        self.assertEqual(stats['auto_block_users'], 0)
        self.assertNotIn('demo.md', result['text'])
        self.assertIn('Keep the explanation brief.', result['text'])

    def test_attachment_clues_do_not_turn_a_paste_only_request_into_human_text(self):
        stats = Counter()
        text = ('# Files mentioned by the user:\n- [lens.md](D:/fiction/lens.md)\n'
                '## My request:\n```text\nImaginary file body.\n```')
        self.assertIsNone(pipeline.clean_user(text, Redactor(), stats))
        self.assertEqual(stats['excluded_paste_only'], 1)

    def test_attachment_only_prefixes_do_not_hide_a_dispatched_task(self):
        rows = [{'type': 'session_meta', 'payload': {'id': 'fiction', 'source': 'vscode'}}]
        prompts = ['# Files mentioned by the user:\n- [lens.md](D:/fiction/lens.md)'] * 3
        prompts.append('Read task file fiction.md and execute the assigned work.')
        for i, prompt in enumerate(prompts):
            rows.append({'type': 'response_item', 'timestamp': f'2026-01-01T00:0{i}:00Z',
                         'payload': {'type': 'message', 'role': 'user', 'content': prompt}})
        stats = Counter()
        self.assertEqual(pipeline.parse_codex(rows, 'fixture', Redactor(), stats), [])
        self.assertEqual(stats['excluded_dispatched_sessions'], 1)

    def test_unheaded_request_after_file_list_and_ordinary_markdown_survive(self):
        text = ('Prior human sentence.\n# Files mentioned by the user:\n'
                '- [lens.md](D:/fiction/lens.md)\n\nCompare the imaginary designs.')
        result = pipeline.clean_user(text, Redactor(), Counter())
        self.assertIn('Prior human sentence.', result['text'])
        self.assertIn('Compare the imaginary designs.', result['text'])
        ordinary = '# Notes\nThe heading Files mentioned by the user is discussed here.'
        self.assertEqual(pipeline.clean_user(ordinary, Redactor(), Counter())['text'], ordinary)


class BalancedStreamTests(unittest.TestCase):
    def test_rejects_one_way_switch_even_with_balanced_counts(self):
        sessions = [source('a', [0, *range(2, 12), 40]), source('b', [1, *range(12, 22), 41]),
                    source('c', [100, *range(102, 122, 2)]), source('d', [101, *range(103, 123, 2)])]
        streams, _ = pipeline.build_interleaved(sessions)
        self.assertFalse(any(set(s['source_sessions']) == {'a', 'b'} for s in streams))

    def test_long_sources_form_bounded_disjoint_fragments_with_real_switches(self):
        sessions = [source('a', range(0, 102, 2)), source('b', range(1, 103, 2)),
                    source('c', range(200, 232, 2)), source('d', range(201, 233, 2))]
        streams, info = pipeline.build_interleaved(sessions)
        self.assertGreaterEqual(len([s for s in streams if s['split'] == 'dev']), 2)
        self.assertTrue(any(s['split'] == 'test' for s in streams))
        seen = set()
        for s in streams:
            turns = s['turns']
            self.assertLessEqual(len(turns), 40)
            counts = Counter(t['gold']['thread'] for t in turns)
            self.assertTrue(all(n >= 5 and n / len(turns) >= .2 for n in counts.values()))
            self.assertGreaterEqual(sum('switch' in t['tags'] for t in turns), 3)
            self.assertNotIn('switch', turns[0]['tags'])
            self.assertTrue(all(w['at'] < s['overlap_start'] for w in s['warmup']))
            for t in turns:
                key = (t['source'], t['source_message'], t['at'])
                self.assertNotIn(key, seen)
                seen.add(key)
        dev = {v for s in streams if s['split'] == 'dev' for v in s['source_sessions']}
        test = {v for s in streams if s['split'] == 'test' for v in s['source_sessions']}
        self.assertTrue(dev.isdisjoint(test))
        again, _ = pipeline.build_interleaved(list(reversed(sessions)))
        self.assertEqual(streams, again)

    def test_simultaneous_source_events_cannot_manufacture_switches(self):
        sessions = [source('a', range(0, 20)), source('b', range(0, 20)),
                    source('c', range(100, 130, 2)), source('d', range(101, 131, 2))]
        streams, _ = pipeline.build_interleaved(sessions)
        self.assertFalse(any(set(s['source_sessions']) == {'a', 'b'} for s in streams))

    def test_budget_cannot_truncate_a_stream_below_balance_requirements(self):
        sessions = [source('a', range(0, 30, 2)), source('b', range(1, 31, 2)),
                    source('c', range(100, 130, 2)), source('d', range(101, 131, 2))]
        streams, _ = pipeline.build_interleaved(sessions, max_messages=30)
        self.assertLessEqual(sum(len(s['turns']) for s in streams), 30)
        for s in streams:
            counts = Counter(t['gold']['thread'] for t in s['turns'])
            self.assertTrue(all(n >= 5 for n in counts.values()))


if __name__ == '__main__': unittest.main()
