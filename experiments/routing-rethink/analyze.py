"""Offline routing research. No network, model client, subprocess, or credential access.
Run: py -B experiments/routing-rethink/analyze.py
All writes are confined to this script's directory. Gold-assisted diagnostics are
explicitly separate from self-fed baselines; dev alone selects the margin.
"""
from __future__ import annotations
import sys
sys.dont_write_bytecode = True
import hashlib
import importlib.util
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATA = ROOT / 'eval/data/interleave-v0/sessions.jsonl'
OUT = HERE / 'results'
GRID = [0, 1, 2, 3, 4, 6, 8, 10, 12]

def module(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    obj = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

base = module('routing_rethink_baselines', 'eval/baselines.py')
score = module('routing_rethink_score', 'eval/score.py')

def save(name, value):
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def rate(n, d):
    return n / d if d else None

def profile(sessions):
    turns = [t for s in sessions for t in s['turns']]
    strict = [t for t in turns if not t['ambiguous'] and t['gold']['thread'] is not None]
    styles = {}
    for style in sorted({t['style'] for t in turns}):
        items = [t for t in turns if t['style'] == style]
        styles[style] = dict(total=len(items), ambiguous=sum(t['ambiguous'] for t in items),
                            strict_thread=sum(not t['ambiguous'] and t['gold']['thread'] is not None for t in items))
    return dict(sessions=len(sessions), turns=len(turns), strict_thread=len(strict),
                oneoff=sum(t['gold']['thread'] is None for t in turns),
                ambiguous=sum(t['ambiguous'] for t in turns),
                styles=styles, actions=dict(Counter(t['gold']['action'] for t in strict)),
                languages=dict(Counter(s['lang'] for s in sessions)),
                threads=dict(Counter(len(s['threads']) for s in sessions)),
                tagged_twin=sum('twin' in t['tags'] for t in strict),
                refs=sum(bool(t['gold']['refs']) for t in strict),
                assistant_fields=sum('assistant' in t for t in turns),
                timestamps=sum(any(k in t for k in ('timestamp', 'time', 'sent_at')) for t in turns),
                text_chars=dict(min=min(len(t['text']) for t in turns), max=max(len(t['text']) for t in turns)))

def features(text):
    return set(base.tokens(text))

def overlap(a, b):
    return len(a & b) / math.sqrt(len(a) * len(b)) if a and b else 0.0

def diagnostic_rows(session):
    """Only previous gold labels update memory; current gold is used after prediction.
    Closed catalog title + description are supplied by the benchmark's thread plans.
    One-offs do not update task memory; this is an oracle-isolation assumption.
    """
    static, history = base.BM25(), base.BM25()
    for thread in session['threads']:
        text = thread['title'] + ' ' + thread['description']
        static.add(thread['id'], text)
        history.add(thread['id'], text)
    prior = []
    current = None
    seen = set()
    rows = []
    for t in session['turns']:
        ranks = {}
        query = features(t['text'])
        for name, index in [('static', static), ('history', history)]:
            ranks[name] = sorted(index.scores(t['text']).items(), key=lambda x: (-x[1], x[0]))
        episode = defaultdict(float)
        for old in prior:
            episode[old['gold']] = max(episode[old['gold']], overlap(query, old['features']))
        ranks['episode'] = sorted(episode.items(), key=lambda x: (-x[1], x[0]))
        best_id, best_score = ranks['history'][0]
        second_score = ranks['history'][1][1] if len(ranks['history']) > 1 else 0
        gold = t['gold']['thread']
        row = dict(session_id=session['session_id'], split=session['split'], lang=session['lang'],
                   i=t['i'], text=t['text'], gold=gold, style=t['style'], action=t['gold']['action'],
                   ambiguous=t['ambiguous'], existing=gold in seen if gold else False,
                   current=current, best=best_id, score=best_score, margin=best_score-second_score,
                   previous_task_correct=gold is not None and current == gold,
                   previous_message_correct=gold is not None and bool(t['i']) and session['turns'][t['i']-1]['gold']['thread'] == gold)
        for name, ranked in ranks.items():
            row[name + '_rank'] = next((i+1 for i, (key, _) in enumerate(ranked) if key == gold), None)
            row[name + '_positive'] = bool(ranked and ranked[0][1] > 0)
            row[name + '_best'] = ranked[0][0] if ranked and ranked[0][1] > 0 else None
        row['prior_window_hits'] = {str(k): gold is not None and any(p['gold'] == gold for p in prior[-k:]) for k in (1, 2, 4, 8, 12)}
        rows.append(row)
        if gold is not None:
            history.add(gold, t['text'])
            prior.append(dict(gold=gold, features=query))
            current = gold
            seen.add(gold)
    return rows

def diagnostic_summary(rows):
    strict = [r for r in rows if not r['ambiguous'] and r['gold'] is not None]
    existing = [r for r in strict if r['existing']]
    def subset(items):
        out = dict(n=len(items), previous_task=sum(r['previous_task_correct'] for r in items),
                   previous_message=sum(r['previous_message_correct'] for r in items))
        for name in ('static', 'history', 'episode'):
            out[name] = dict(top1=sum(r[name + '_best'] == r['gold'] for r in items),
                            zero_score=sum(not r[name + '_positive'] for r in items),
                            recall={str(k): sum(r[name + '_positive'] and r[name + '_rank'] is not None and r[name + '_rank'] <= k for r in items) for k in (1, 2, 3)})
        out['prior_task_message_window'] = {str(k): sum(r['prior_window_hits'][str(k)] for r in items) for k in (1, 2, 4, 8, 12)}
        return out
    return dict(all_strict=subset(strict), existing=subset(existing),
                by_style={style: subset([r for r in strict if r['style'] == style]) for style in sorted({r['style'] for r in strict})},
                existing_by_lang={lang: subset([r for r in existing if r['lang'] == lang]) for lang in ('zh', 'en')})

def selective(rows, margin):
    eligible = [r for r in rows if not r['ambiguous']]
    accepted = [r for r in eligible if r['score'] > 0 and r['margin'] >= margin]
    correct = sum(r['best'] == r['gold'] for r in accepted)
    errors = [r for r in accepted if r['best'] != r['gold']]
    return dict(margin=margin, eligible=len(eligible), accepted=len(accepted), correct=correct,
                coverage=rate(len(accepted), len(eligible)), precision=rate(correct, len(accepted)),
                wrong_thread=sum(r['gold'] is not None for r in errors), oneoff_into_task=sum(r['gold'] is None for r in errors),
                errors=[{k:r[k] for k in ('session_id', 'i', 'text', 'gold', 'best', 'style', 'margin')} for r in errors])

def self_fed_scores(sessions):
    output = {}
    for mode, systems in base.SYSTEMS.items():
        for system in systems:
            name = mode + '-' + system
            rows = [r for s in sessions for r in base.route(s, system, mode)]
            (OUT / (name + '.jsonl')).write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
            output[name] = {}
            for split in ('dev', 'test'):
                result = score.evaluate(sessions, rows, split)
                counts = Counter()
                for s in sessions:
                    if s['split'] != split:
                        continue
                    own = [r for r in rows if r['session_id'] == s['session_id']]
                    outcomes, _ = score.score_session(s, own, mode)
                    counts.update(o['kind'] for o in outcomes if not o['turn']['ambiguous'] and o['turn']['gold']['thread'] is not None)
                n = sum(counts.values())
                result['strict_outcomes'] = dict(counts)
                result['strict_n'] = n
                result['pollution_count'] = counts['wrong_existing'] + counts['merged_new']
                result['pollution_rate'] = rate(result['pollution_count'], n)
                result['loss_sensitivity'] = {str(cost): (cost * result['pollution_count'] + counts['spurious_new'] + counts['clarify'] + counts['error']) / n for cost in (1, 3, 10)}
                output[name][split] = result
    return output

def matched_history(sessions):
    """Same closed catalog/policy; only previous assignment memory differs.
    Both arms are given oracle one-off isolation. This is a diagnostic control,
    not a deployable router and not a causal comparison against the LLM.
    """
    results = {}
    for split in ('dev', 'test'):
        results[split] = {}
        for memory in ('gold', 'self'):
            good = n = 0
            per_session = []
            for session in [s for s in sessions if s['split'] == split]:
                index = base.BM25()
                for t in session['threads']:
                    index.add(t['id'], t['title'] + ' ' + t['description'])
                current = None
                session_good = session_n = 0
                for t in session['turns']:
                    gold = t['gold']['thread']
                    if gold is None:
                        continue
                    ranked = sorted(index.scores(t['text']).items(), key=lambda x: (-x[1], x[0]))
                    pred = ranked[0][0] if ranked[0][1] > 0 else current or ranked[0][0]
                    if not t['ambiguous']:
                        session_good += pred == gold
                        session_n += 1
                    assigned = gold if memory == 'gold' else pred
                    index.add(assigned, t['text'])
                    current = assigned
                n += session_n
                good += session_good
                per_session.append(dict(session_id=session['session_id'], correct=session_good, n=session_n))
            results[split][memory] = dict(correct=good, n=n, accuracy=rate(good,n), per_session=per_session)
    return results


def validate(sessions):
    assert len({s['session_id'] for s in sessions}) == len(sessions)
    assert {s['split'] for s in sessions} == {'dev', 'test'}
    for s in sessions:
        assert [t['i'] for t in s['turns']] == list(range(len(s['turns'])))
        ids = {t['id'] for t in s['threads']}
        assert len(ids) == len(s['threads'])
        for t in s['turns']:
            assert t['gold']['thread'] is None or t['gold']['thread'] in ids
            assert set(t['gold']['refs']) <= ids
            assert isinstance(t['ambiguous'], bool) and isinstance(t['text'], str) and t['text'].strip()
    # Prefix invariance: appending future turns cannot change any earlier diagnostic.
    for s in sessions:
        cut = len(s['turns']) // 2
        assert diagnostic_rows({**s, 'turns': s['turns'][:cut]}) == diagnostic_rows(s)[:cut]
    return dict(unique_session_ids=True, turn_indexes=True, gold_and_ref_integrity=True,
                diagnostic_future_prefix_invariance=True, sessions_checked=len(sessions))

def main():
    sessions = score.read_jsonl(DATA)
    OUT.mkdir(exist_ok=True)
    checks = validate(sessions)
    manifest = json.loads((DATA.parent / 'manifest.json').read_text(encoding='utf-8'))
    profiles = {split: profile([s for s in sessions if s['split'] == split]) for split in ('dev', 'test')}
    assert sum(p['turns'] for p in profiles.values()) == manifest['messages']
    assert sum(p['ambiguous'] for p in profiles.values()) == manifest['ambiguous']
    dev_text = {t['text'].strip().lower() for s in sessions if s['split']=='dev' for t in s['turns']}
    test_text = {t['text'].strip().lower() for s in sessions if s['split']=='test' for t in s['turns']}
    shared = dev_text & test_text
    checks['cross_split_shared_unique_texts'] = len(shared)
    checks['test_turns_with_dev_text'] = sum(t['text'].strip().lower() in dev_text for s in sessions if s['split']=='test' for t in s['turns'])
    checks['manifest_reconciles'] = True
    rows = [r for s in sessions for r in diagnostic_rows(s)]
    dev_rows = [r for r in rows if r['split']=='dev']
    # Selection is dev-only and frozen before applying to test; all curve candidates retained.
    curve = [selective(dev_rows, m) for m in GRID]
    eligible = [c for c in curve if c['accepted'] >= 30 and c['precision'] >= .99]
    chosen = max(eligible, key=lambda c: c['accepted'])['margin'] if eligible else None
    selection = dict(target='dev precision >= 0.99, accepted >= 30; maximize coverage; exploratory only',
                     history='previous gold assignments; not end-to-end', chosen_margin=chosen, dev_curve=curve,
                     test=selective([r for r in rows if r['split']=='test'], chosen) if chosen is not None else None)
    result = dict(data_sha256=hashlib.sha256(DATA.read_bytes()).hexdigest(), checks=checks, profile=profiles,
                  diagnostics={split:diagnostic_summary([r for r in rows if r['split']==split]) for split in ('dev','test')},
                  selective=selection, matched_history=matched_history(sessions), baselines=self_fed_scores(sessions))
    for name in ('closed-oracle', 'open-oracle'):
        for split in ('dev', 'test'):
            assert result['baselines'][name][split]['accuracy'] == 1
            assert result['baselines'][name][split]['weighted_error'] == 0
    checks['oracle_accuracy_and_loss'] = True
    save('analysis.json', result)
    (OUT / 'diagnostic-rows.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False) + '\n' for r in rows), encoding='utf-8')
    print(json.dumps(dict(profile=profiles, checks=checks, chosen_margin=chosen,
                         baselines={n:{s:{k:v[k] for k in ('accuracy','pollution_rate','topics_per_thread','weighted_error','strict_n')} for s,v in splits.items()} for n,splits in result['baselines'].items()}), ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
