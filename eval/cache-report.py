"""Read-only layer telemetry and paired v0 comparison; score.py remains the source of scoring semantics."""
import argparse
from collections import defaultdict
import json
import score


def layer_usage(rows):
    calls = defaultdict(list)
    for row in rows:
        for field, fallback in [('usage_by_call', 'quick'), ('card_usage', 'card'), ('auxiliary_usage', 'terms')]:
            for call in row.get(field, []):
                calls[call.get('layer', fallback)].append(call)
    result = {}
    for layer, used in sorted(calls.items()):
        def total(key):
            return sum(c[key] for c in used) if all(isinstance(c.get(key), (int, float)) for c in used) else None
        input_tokens, cache_hit, output_tokens = total('input'), total('cache_hit'), total('output')
        result[layer] = {'calls': len(used), 'input_tokens': input_tokens, 'cache_hit_tokens': cache_hit,
                         'output_tokens': output_tokens,
                         'cache_hit_rate': cache_hit / input_tokens if input_tokens and cache_hit is not None else None,
                         'output_tokens_per_call': output_tokens / len(used) if output_tokens is not None else None}
    return result


def compare(sessions, baseline, candidate, split):
    scores = [score.evaluate(sessions, rows, split) for rows in [baseline, candidate]]
    if any(scores[0][k] != scores[1][k] for k in ['mode', 'replay']):
        raise ValueError('Baseline/candidate replay or mode mismatch')
    selected_ids = {s['session_id'] for s in sessions if split == 'all' or s['split'] == split}
    selected = [[r for r in rows if r['session_id'] in selected_ids] for rows in [baseline, candidate]]
    for rows in selected:
        if len({r.get('variant', 'none') for r in rows}) != 1:
            raise ValueError('Mixed routing variants in one prediction file')
    outcomes = []
    for rows in selected:
        grouped = defaultdict(list)
        for row in rows:
            grouped[row['session_id']].append(row)
        actual = {}
        for session in sessions:
            if session['session_id'] not in selected_ids:
                continue
            result, _ = score.score_session(session, grouped[session['session_id']], scores[0]['mode'])
            for outcome in result:
                if outcome['scorable']:
                    actual[(session['session_id'], outcome['turn']['i'])] = outcome['accurate']
        outcomes.append(actual)
    a, b = outcomes
    if a.keys() != b.keys():
        raise ValueError('Scorable pair key mismatch')
    wins = sum(b[key] and not a[key] for key in a)
    losses = sum(a[key] and not b[key] for key in a)
    return {'baseline_variant': selected[0][0].get('variant', 'none'), 'candidate_variant': selected[1][0].get('variant', 'none'),
            'split': split, 'mode': scores[0]['mode'],
            'paired': {'scorable_messages': len(a), 'candidate_only_correct': wins, 'baseline_only_correct': losses,
                       'both_correct': sum(a[key] and b[key] for key in a),
                       'both_wrong': sum(not a[key] and not b[key] for key in a),
                       'accuracy_delta': (wins - losses) / len(a) if a else None},
            'baseline': scores[0], 'candidate': scores[1],
            'layers': {'baseline': layer_usage(selected[0]), 'candidate': layer_usage(selected[1])}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('data')
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--split', choices=['dev', 'test', 'all'], default='dev')
    args = parser.parse_args()
    result = compare(score.read_jsonl(args.data), score.read_jsonl(args.baseline), score.read_jsonl(args.candidate), args.split)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
