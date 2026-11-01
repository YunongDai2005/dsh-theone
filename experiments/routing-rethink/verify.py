"""Independent consistency checks for the research artifacts; no model or network.
Run after analyze.py and source-probes.mjs: py -B experiments/routing-rethink/verify.py
"""
import ast
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / 'results'
REPORT = ROOT / 'docs/design/routing-rethink.zh.md'

def read(path):
    return path.read_text(encoding='utf-8-sig')

def jsonl(path):
    return [json.loads(line) for line in read(path).splitlines() if line.strip()]

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    raw = jsonl(ROOT / 'eval/data/interleave-v0/sessions.jsonl')
    analysis = json.loads(read(OUT / 'analysis.json'))
    probes = json.loads(read(OUT / 'source-probes.json'))
    report = read(REPORT)
    phase = read(HERE / 'phase1-before-code.md')
    section = phase[phase.index('## 读代码前的独立路线'):phase.index('## 后续证据')].strip()
    assert section in report, 'Frozen hypotheses changed or omitted'
    assert sha(HERE / 'phase1-before-code.md') == '58bef889295cfad5e4efd18a881b3ecfba8551f7bbe8c87d0472c6c87696bf5b'
    assert '\ufffd' not in report
    assert '待读码、检查评测语义' not in report
    assert '1,564.33' in report
    assert analysis['data_sha256'] == sha(ROOT / 'eval/data/interleave-v0/sessions.jsonl')
    expected = {(s['session_id'], t['i']) for s in raw for t in s['turns']}
    assert len(expected) == sum(len(s['turns']) for s in raw)
    predictions = []
    for name, splits in analysis['baselines'].items():
        rows = jsonl(OUT / (name + '.jsonl'))
        keys = [(r['session_id'], r['i']) for r in rows]
        assert len(keys) == len(set(keys)) and set(keys) == expected, name
        assert all(r['pred'] not in (None, 'ERROR', 'CLARIFY') for r in rows), name
        predictions.append(name)
        for split, result in splits.items():
            source = [t for s in raw if s['split'] == split for t in s['turns']]
            strict = [t for t in source if not t['ambiguous'] and t['gold']['thread'] is not None]
            assert result['messages'] == len(source)
            assert result['strict_n'] == len(strict)
            assert sum(result['strict_outcomes'].values()) == len(strict)
            counts = Counter(result['strict_outcomes'])
            pollution = counts['wrong_existing'] + counts['merged_new']
            weighted = (3 * pollution + counts['spurious_new'] + counts['error'] + counts['clarify']) / len(strict)
            assert round(weighted,4) == result['weighted_error']
            assert pollution == result['pollution_count']
            if name not in ('closed-oracle','open-oracle'):
                assert f"{result['accuracy']*100:.2f}%" in report
                assert f"{result['pollution_rate']*100:.2f}%" in report
    for split in ('dev','test'):
        sessions = [s for s in raw if s['split']==split]
        turns = [t for s in sessions for t in s['turns']]
        p = analysis['profile'][split]
        assert p['sessions'] == len(sessions)
        assert p['turns'] == len(turns)
        assert p['ambiguous'] == sum(t['ambiguous'] for t in turns)
        assert p['strict_thread'] == sum(not t['ambiguous'] and t['gold']['thread'] is not None for t in turns)
        implicit = [t for t in turns if t['style']=='implicit' and not t['ambiguous']]
        assert all(t['gold']['action']=='continue' for t in implicit)
        for row in analysis['matched_history'][split].values():
            assert sum(s['correct'] for s in row['per_session']) == row['correct']
            assert sum(s['n'] for s in row['per_session']) == row['n']
            assert f"{100*row['correct']/row['n']:.2f}%" in report
    eligible = [v for v in analysis['selective']['dev_curve'] if v['accepted']>=30 and v['precision']>=.99]
    chosen = max(eligible,key=lambda v:v['accepted'])['margin']
    assert chosen == analysis['selective']['chosen_margin'] == analysis['selective']['test']['margin']
    diagnostics = jsonl(OUT / 'diagnostic-rows.jsonl')
    assert {(r['session_id'],r['i']) for r in diagnostics} == expected
    gold = {(s['session_id'],t['i']):t['gold']['thread'] for s in raw for t in s['turns']}
    assert all(r['gold']==gold[r['session_id'],r['i']] for r in diagnostics)
    assert probes['payloadParity'] == 2 * len(expected)
    assert all(v['correct']==0 for v in probes['fastPath'].values())
    for path,digest in probes['hashes'].items():
        assert sha(ROOT / path) == digest, path
    for key,v in probes['prefixes'].items():
        assert 0<=v['cacheable_tokens']<=v['tokens']
        assert abs(v['average_tokens'] - v['tokens']/v['requests']) < 1e-9
        if '/total/' in key:
            assert f"{100*v['reusable_share']:.2f}%" in report
            assert f"{v['estimated_miss_tokens']:.2f}" in report
    linked = []
    deferred = []
    for document in [REPORT, HERE / 'README.md']:
        for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)',read(document)):
            if target.startswith(('http:','https:','#')):
                continue
            path = (document.parent / target.split('#')[0]).resolve()
            if path == OUT / 'verification.json':
                deferred.append(path)
            else:
                assert path.exists(), str(path)
            linked.append(str(path.relative_to(ROOT)))
    for path in HERE.glob('*.py'):
        ast.parse(read(path),filename=str(path))
    record = dict(status='passed', sessions=len(raw), messages=len(expected),
                  prediction_files=len(predictions), prediction_rows=len(expected)*len(predictions),
                  source_dist_payload_comparisons=probes['payloadParity'],
                  checked_source_hashes=len(probes['hashes']), local_links=len(linked),
                  checks=['raw denominators and manifest','complete unique prediction keys',
                          'strict weighted loss arithmetic','matched-history totals',
                          'dev-only threshold selection','prefix estimate arithmetic',
                          'report percentage consistency','source file hashes',
                          'frozen initial hypotheses','local artifact links','Python syntax'],
                  scripts={p.name:sha(p) for p in HERE.glob('*') if p.suffix in ('.py','.mjs')},
                  report_sha256=sha(REPORT))
    (OUT / 'verification.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    assert all(path.exists() for path in deferred)
    print(json.dumps(record,ensure_ascii=False,indent=2))

if __name__ == '__main__':
    main()
