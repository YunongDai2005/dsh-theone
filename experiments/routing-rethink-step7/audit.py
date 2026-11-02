"""Audit saved step6b predictions with the checked-out scorer. audit-before.json was captured before step7 fixes."""
import argparse, json, sys
from collections import defaultdict, Counter
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'eval'))
import score
root = Path(__file__).resolve().parents[2]
data = root / 'eval/data/interleave-v1/sessions.jsonl'
sessions = score.read_jsonl(data)
args = argparse.ArgumentParser(description=__doc__)
args.add_argument('--out', default='experiments/routing-rethink-step7/audit-current.json')
output = root / args.parse_args().out
if output.exists(): raise SystemExit('Refusing to overwrite audit: ' + str(output))
report = {}
for split in ['dev', 'test']:
    for variant in ['full', 'drop-bindings']:
        path = root / f'eval/data/interleave-v1/predictions/step6b-real-{split}-deepseek-v4.1-flash-{variant}.jsonl'
        rows = score.read_jsonl(path)
        grouped = defaultdict(list)
        for r in rows: grouped[r['session_id']].append(r)
        details, counts = [], defaultdict(Counter)
        for s in sessions:
            if s['split'] != split: continue
            outcomes, mapping = score.score_session(s, grouped[s['session_id']], 'open')
            for o in outcomes:
                t, r = o['turn'], o['row']
                c = counts[s['scenario']]
                c['total'] += 1
                c['raw_inaccurate'] += not o['accurate']
                c['strict_n'] += t['gold']['thread'] is not None and not t['ambiguous']
                c['strict_wrong'] += t['gold']['thread'] is not None and not t['ambiguous'] and not o['accurate']
                c['ambiguous'] += t['ambiguous']
                c['oneoff'] += t['gold']['thread'] is None
                c['kind_' + o['kind']] += 1
                candidates = (r.get('trace') or {}).get('candidateIds', [])
                details.append({'session_id': s['session_id'], 'scenario': s['scenario'], 'i': t['i'],
                    'text': t['text'], 'gold': t['gold']['thread'], 'ambiguous': t['ambiguous'],
                    **{k:o[k] for k in ['pred', 'mapped', 'kind', 'accurate']},
                    'reason': r.get('decision', {}).get('reason'), 'calls': r.get('logical_calls'),
                    'candidates': candidates, 'events': r.get('events', []),
                    'current_before': r.get('state_before', {}).get('current_id'),
                    'current_after': r.get('state_after', {}).get('current_id')})
        report[f'{split}-{variant}'] = {'path': path.relative_to(root).as_posix(),
            'counts': dict(counts), 'score': score.evaluate(sessions, rows, split), 'rows': details}
        print(split, variant, json.dumps(dict(counts)))
output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
