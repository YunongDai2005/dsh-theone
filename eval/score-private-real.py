#!/usr/bin/env python3
"""Read-only diagnostic: one-to-one labels, ignoring seeded topic semantics.

Only aggregate counts are printed. No data, predictions, or existing scores are
changed. Short/switch and project breakdowns reuse each stream's full assignment.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import sys
from score import hungarian, read_jsonl, SPECIAL

PRIVATE_ROOT = Path(__file__).resolve().parent / 'data/private-real'


def private_input(value):
    path = Path(value).resolve()
    if not path.is_relative_to(PRIVATE_ROOT.resolve()) or not path.is_file():
        raise ValueError('Expected an existing private input file')
    return path


def evaluate(sessions, predictions, split='dev'):
    if split not in ('dev', 'test', 'all'): raise ValueError('Invalid split')
    known = {s['session_id']: {t['i'] for t in s['turns']} for s in sessions}
    if len(known) != len(sessions): raise ValueError('Duplicate session')
    if any(len(known[s['session_id']]) != len(s['turns']) for s in sessions):
        raise ValueError('Duplicate input')
    selected = [s for s in sessions if split == 'all' or s['split'] == split]
    if not selected: raise ValueError('Empty selected split')
    by_session, seen = defaultdict(dict), set()
    for row in predictions:
        sid, i = row['session_id'], row['i']
        if (sid, i) in seen or sid not in known or i not in known[sid]:
            raise ValueError('Duplicate or unexpected prediction')
        if not isinstance(row.get('pred'), str) or not row['pred']:
            raise ValueError('Missing prediction value')
        seen.add((sid, i))
        by_session[sid][i] = row
    if any(set(by_session[s['session_id']]) != known[s['session_id']] for s in selected):
        raise ValueError('Missing prediction')
    counts = defaultdict(lambda: [0, 0])
    excluded = 0
    scopes = ('same_project', 'cross_project', 'unknown')
    def accumulate(prefix, turn, ok):
        for label in ('all', 'short', 'switch'):
            if label == 'all' or label in turn.get('tags', []):
                counts[(prefix, label)][0] += int(ok)
                counts[(prefix, label)][1] += 1
    for session in selected:
        rows = by_session[session['session_id']]
        turns = []
        for turn in session['turns']:
            row = rows[turn['i']]
            ambiguous = turn.get('ambiguous', False) or turn['gold'].get('confidence') == 'unconfirmed' or (
                turn['gold'].get('requires_user_ref', False) and row.get('state_ablation', 'none') != 'none')
            if ambiguous: excluded += 1
            elif turn['gold']['thread'] is not None: turns.append(turn)
        golds = sorted({t['gold']['thread'] for t in turns})
        preds = sorted({rows[t['i']]['pred'] for t in turns} - SPECIAL)
        overlap = Counter((t['gold']['thread'], rows[t['i']]['pred']) for t in turns)
        match = hungarian([[overlap[g, p] for p in preds] for g in golds])
        mapping = {preds[j]: golds[i] for i, j in match.items()}
        scope = session.get('project_scope', 'unknown')
        if scope not in scopes: scope = 'unknown'
        for turn in turns:
            ok = mapping.get(rows[turn['i']]['pred']) == turn['gold']['thread']
            accumulate('total', turn, ok)
            accumulate(scope, turn, ok)
    def bucket(prefix):
        result = {}
        for label in ('all', 'short', 'switch'):
            correct, n = counts[prefix, label]
            result[label] = {'correct': correct, 'n': n, 'accuracy': round(correct / n, 6) if n else None}
        return result
    return {'method': 'one_to_one_hungarian_all_topic_ids', 'mapping_basis': 'all_confirmed_scored_turns_per_stream',
            'split': split, 'sessions': len(selected), 'excluded_ambiguous': excluded,
            **bucket('total'), 'by_project': {scope: bucket(scope) for scope in scopes}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('data')
    parser.add_argument('predictions')
    parser.add_argument('--split', choices=('dev', 'test', 'all'), default='dev')
    args = parser.parse_args(argv)
    try:
        result = evaluate(read_jsonl(private_input(args.data)), read_jsonl(private_input(args.predictions)), args.split)
        print(json.dumps(result, ensure_ascii=True, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error_type': type(error).__name__,
                          'detail': 'Check private paths, split and prediction keys; no raw content logged.'}))
        return 1


if __name__ == '__main__': sys.exit(main())
