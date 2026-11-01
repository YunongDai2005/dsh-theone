"""Read-only logged-policy analysis. No model client, subprocess, credentials, or globbing.

The counterfactual changes one decision on the baseline's realized history.
It deliberately does NOT pretend to replay the resulting alternative history.
"""
from __future__ import annotations
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import random
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / 'eval'))
from score import score_session, COST

DATA = ROOT / 'eval/data/interleave-v0'
SEED = 20261101
ITERATIONS = 10000
PRICES = (0.30, 0.006, 1.20)
POLICY = {
    'id': 'loss-evidence-v1',
    'scope': 'suppression-only on logged baseline histories',
    'keep': ['nonempty catalog and viable conflicting evidence', 'nonempty catalog and CREATE split risk'],
    'skip': ['empty catalog', 'CLARIFY without distinguishing evidence'],
    'accuracy_lower_pp': -0.5, 'pollution_upper_pp': 0.2, 'harm_upper_per100': 0.2,
    'short_chars': 16, 'long_return_intervening_turns': 10,
    'bootstrap': {'unit': 'conversation', 'iterations': ITERATIONS, 'seed': SEED},
    'prices_usd_per_million': PRICES,
}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read_jsonl(path):
    with Path(path).open(encoding='utf-8') as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_json(path, value, exclusive=False):
    with Path(path).open('x' if exclusive else 'w', encoding='utf-8', newline='\n') as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
        handle.write('\n')


def prediction_path(mode, split):
    if mode not in ('open', 'closed') or split not in ('dev', 'test'):
        raise ValueError('Only the four explicitly authorized baseline files are allowed')
    return DATA / 'predictions' / f'product-v1-{mode}-{split}-cards-deepseek-v4.1-flash.jsonl'


def join_keys(sessions, rows):
    expected = {(s['session_id'], t['i']) for s in sessions for t in s['turns']}
    if len(expected) != sum(len(s['turns']) for s in sessions):
        raise ValueError('Duplicate input key')
    indexed = {(r['session_id'], r['i']): r for r in rows}
    if len(indexed) != len(rows) or set(indexed) != expected:
        raise ValueError('Missing, duplicate, or unexpected prediction key')
    return indexed


def settled_target(decision, current, catalog):
    action = decision['action']
    if action == 'CREATE':
        return 'CREATE'
    if action != 'CLARIFY':
        return decision.get('contextId') or 'ERROR'
    if decision.get('reason') in ('ROUTER_MODEL_MISSING', 'correction-unclear'):
        return 'CLARIFY'
    offered = list(dict.fromkeys(x for x in decision.get('relatedIds', []) if x in catalog))
    if current and current in offered:
        return current
    return (offered[0] if offered else current if current in catalog else None) or 'CREATE'


def candidate_status(gold, candidates, catalog, mapping, seen, mode):
    if gold is None:
        return 'oneoff'
    if mode == 'open' and gold not in seen:
        return 'new_task'
    correct_ids = {topic for topic in catalog if mapping.get(topic) == gold}
    if not correct_ids:
        return 'catalog_absent'
    return 'hit' if correct_ids.intersection(candidates) else 'selection_miss'


def route_kind(target, gold, mode, held, seen):
    fresh = target == 'CREATE' or (target not in ('CLARIFY', 'ERROR') and not held.get(target))
    if gold is None:
        return 'oneoff_isolated' if fresh or target in ('CLARIFY', 'ERROR') else 'oneoff_into_topic'
    if target in ('CLARIFY', 'ERROR'):
        return target.lower()
    if fresh:
        return 'correct' if mode == 'open' and gold not in seen else 'spurious_new'
    majority = max(held[target], key=held[target].get)
    return 'correct' if majority == gold else 'merged_new' if gold not in seen else 'wrong_existing'


def keep_recheck(initial, candidates, evidence):
    if not candidates:
        return False, 'empty-catalog'
    if evidence.get('contextId') in candidates and evidence.get('terms') and evidence['contextId'] != initial.get('contextId'):
        return True, 'conflicting-evidence'
    if initial['action'] == 'CREATE':
        return True, 'split-risk'
    return False, 'no-discriminating-evidence'


def cost(usage):
    return ((usage.get('input', 0) - usage.get('cache_hit', 0)) * PRICES[0]
            + usage.get('cache_hit', 0) * PRICES[1] + usage.get('output', 0) * PRICES[2]) / 1e6


@lru_cache(maxsize=8)
def draws(n, iterations, seed):
    rng = random.Random(seed)
    return [tuple(rng.randrange(n) for _ in range(n)) for _ in range(iterations)]


def percentile(sorted_values, q):
    position = (len(sorted_values) - 1) * q
    low = math.floor(position)
    high = math.ceil(position)
    return sorted_values[low] + (sorted_values[high] - sorted_values[low]) * (position - low)


def cluster_interval(pairs, scale=100, iterations=ITERATIONS, seed=SEED):
    denominator = sum(b for _, b in pairs)
    base = {'estimate': None, 'ci95': None, 'clusters': len(pairs),
            'contributing_clusters': sum(b > 0 for _, b in pairs)}
    if not denominator:
        return base
    values = []
    for indices in draws(len(pairs), iterations, seed):
        den = sum(pairs[i][1] for i in indices)
        if den:
            values.append(scale * sum(pairs[i][0] for i in indices) / den)
    values.sort()
    return {**base, 'estimate': round(scale * sum(a for a, _ in pairs) / denominator, 6),
            'ci95': [round(percentile(values, q), 6) for q in (0.025, 0.975)],
            'valid_resamples': len(values)}


def metric(records, session_ids, numerator, denominator=lambda r: 1, scale=100):
    totals = {sid: [0, 0] for sid in session_ids}
    for r in records:
        totals[r['session']][0] += numerator(r)
        totals[r['session']][1] += denominator(r)
    return cluster_interval(list(totals.values()), scale=scale)


def outcome_summary(records, session_ids):
    strict = [r for r in records if r['strict']]
    counts = Counter()
    for r in strict:
        counts['corrected'] += not r['initial_ok'] and r['final_ok']
        counts['regressed'] += r['initial_ok'] and not r['final_ok']
        counts['both_correct'] += r['initial_ok'] and r['final_ok']
        counts['both_wrong'] += not r['initial_ok'] and not r['final_ok']
        counts['same_target'] += r['initial_target'] == r['final_target']
        counts['changed_wrong_to_wrong'] += not r['initial_ok'] and not r['final_ok'] and r['initial_target'] != r['final_target']
    return {'n': len(records), 'strict_n': len(strict), **dict(counts),
            'all_same_target': sum(r['initial_target'] == r['final_target'] for r in records),
            'ambiguous_n': sum(r['ambiguous'] for r in records),
            'oneoff_n': sum(r['gold'] is None for r in records),
            'initial_correct': sum(r['initial_ok'] for r in strict), 'final_correct': sum(r['final_ok'] for r in strict),
            'accuracy_delta_pp': metric(strict, session_ids, lambda r: r['final_ok'] - r['initial_ok']),
            'pollution_delta_pp': metric(strict, session_ids, lambda r: r['final_pollution'] - r['initial_pollution']),
            'harm_delta_per100': metric(strict, session_ids, lambda r: r['final_harm'] - r['initial_harm']),
            'raw_initial_correct': sum(r['raw_initial_ok'] for r in strict),
            'all_labelled_corrected': sum(not r['initial_ok'] and r['final_ok'] for r in records if r['gold'] is not None),
            'all_labelled_regressed': sum(r['initial_ok'] and not r['final_ok'] for r in records if r['gold'] is not None),
            'oneoff_before_into_topic': sum(r['initial_kind'] == 'oneoff_into_topic' for r in records),
            'oneoff_after_into_topic': sum(r['final_kind'] == 'oneoff_into_topic' for r in records)}


def call_summary(records, session_ids):
    keys = ('route_calls', 'recheck_calls', 'all_calls', 'input', 'output', 'cache_hit',
            'recheck_input', 'recheck_output', 'recheck_cache_hit', 'all_tokens', 'recheck_tokens',
            'route_ms', 'recheck_ms', 'elapsed_ms', 'total_usd', 'recheck_usd')
    result = {key: round(sum(r[key] for r in records), 6) for key in keys}
    result.update({
        'recheck_call_share_pct': metric(records, session_ids, lambda r: r['recheck_calls'], lambda r: r['route_calls']),
        'recheck_token_share_pct_including_cards': metric(records, session_ids, lambda r: r['recheck_tokens'], lambda r: r['all_tokens']),
        'recheck_time_share_pct_routing': metric(records, session_ids, lambda r: r['recheck_ms'], lambda r: r['route_ms']),
        'recheck_usd_per1000_messages': metric(records, session_ids, lambda r: r['recheck_usd'], scale=1000),
        'recheck_ms_per_message': metric(records, session_ids, lambda r: r['recheck_ms'], scale=1),
    })
    return result


def analyze_group(sessions, rows, mode):
    indexed = join_keys(sessions, rows)
    session_ids = [s['session_id'] for s in sessions]
    records, misses, shadow, audit = [], [], [], Counter()
    for session in sessions:
        sid = session['session_id']
        ordered = [indexed[(sid, t['i'])] for t in session['turns']]
        official, mapping = score_session(session, ordered, mode)
        if mode == 'closed':
            mapping = {t['id']: t['id'] for t in session['threads']}
        catalog = [t['id'] for t in session['threads']] if mode == 'closed' else []
        held = defaultdict(Counter)
        if mode == 'closed':
            for topic in catalog:
                held[topic][topic] = 1000000
        current, seen, last = session.get('current_id'), set(), {}
        domains = {t['id']: t['domain'] for t in session['threads']}
        domain_counts = Counter(domains.values())
        previous_gold = None
        for turn, row, original in zip(session['turns'], ordered, official):
            trace, gold = row['trace'], turn['gold']['thread']
            initial, final, recheck = trace['initial'], trace['final'], trace['recheck']
            assert not any(key in turn for key in ('replyTo', 'reply_to', 'requestId', 'steering')), 'Binding metadata needs evaluation, not a hardcoded abstention'
            candidates = trace['candidateIds']
            assert row['replay'] == 'product-v1' and row['mode'] == mode and row['policy'] == 'theone'
            assert len(set(candidates)) == len(candidates) and set(candidates) <= set(catalog)
            assert row['pred'] == (final.get('contextId') or 'CLARIFY')
            assert not trace['review']['attempted'], 'Unobserved review counterfactual requires a different protocol'
            assert row['calls'] == len(row['usage_by_call'])
            assert row['logical_calls'] == len(row['call_details'])
            if len(catalog) <= 16 and row['tier'] != 'fast':
                assert set(candidates) == set(catalog), 'Unexpected incomplete small catalog'
            for call in row['usage_by_call'] + row.get('card_usage', []) + row.get('auxiliary_usage', []):
                assert all(isinstance(call.get(k), (int, float)) and call[k] >= 0 for k in ('input', 'output', 'cache_hit', 'latency_ms'))
                assert call['cache_hit'] <= call['input']
            for key in ('input', 'output', 'cache_hit'):
                assert row['usage'][key] == sum(c[key] for c in row['usage_by_call'])
            fin_target = settled_target(final, current, catalog)
            ini_target = settled_target(initial, current, catalog)
            # A failed first call/fallback is the observed result, not an effect of rechecking.
            if not recheck['attempted']:
                ini_target = fin_target
            def accurate(target):
                if gold is None or target in ('CLARIFY', 'ERROR'):
                    return False
                if target == 'CREATE':
                    if final['action'] == 'CREATE':
                        return mapping.get(final['contextId']) == gold
                    return mode == 'open' and gold not in seen
                return mapping.get(target) == gold
            initial_kind = route_kind(ini_target, gold, mode, held, seen)
            final_kind = route_kind(fin_target, gold, mode, held, seen)
            assert final_kind == original['kind'] and accurate(fin_target) == original['accurate']
            keep, reason = keep_recheck(initial, candidates, recheck)
            skipped = recheck['attempted'] and not keep
            status = candidate_status(gold, candidates, catalog, mapping, seen, mode)
            prefix_mapping = {topic: max(bag, key=bag.get) for topic, bag in held.items() if bag}
            prefix_status = candidate_status(gold, candidates, catalog, prefix_mapping, seen, mode)
            gap = turn['i'] - last[gold] - 1 if gold in last else None
            calls = row['usage_by_call']
            rcalls = [c for c in calls if c['layer'] == 'recheck']
            all_calls = calls + row.get('card_usage', []) + row.get('auxiliary_usage', [])
            r = {'session': sid, 'i': turn['i'], 'gold': gold, 'strict': gold is not None and not turn['ambiguous'],
                 'ambiguous': turn['ambiguous'], 'initial_target': ini_target, 'final_target': fin_target,
                 'initial_ok': int(accurate(ini_target)), 'final_ok': int(accurate(fin_target)),
                 'raw_initial_ok': int(initial['action'] != 'CLARIFY' and accurate(ini_target)),
                 'initial_kind': initial_kind, 'final_kind': final_kind,
                 'initial_pollution': int(initial_kind in ('wrong_existing', 'merged_new')),
                 'final_pollution': int(final_kind in ('wrong_existing', 'merged_new')),
                 'initial_harm': COST.get(initial_kind, 0), 'final_harm': COST.get(final_kind, 0),
                 'rechecked': recheck['attempted'], 'trigger': recheck.get('trigger', 'none'),
                 'skip': skipped, 'policy_reason': reason,
                 'status': status, 'prefix_status': prefix_status, 'catalog_size': len(catalog), 'k': len(candidates),
                 'short': len(turn['text'].strip()) <= POLICY['short_chars'],
                 'implicit': turn.get('style') == 'implicit',
                 'same_domain': gold is not None and domain_counts[domains[gold]] > 1,
                 'same_domain_switch': gold is not None and previous_gold is not None and gold != previous_gold and domains[gold] == domains[previous_gold],
                 'long_return': gap is not None and gap >= POLICY['long_return_intervening_turns'],
                 'route_calls': len(calls), 'recheck_calls': len(rcalls), 'all_calls': len(all_calls),
                 'input': sum(c['input'] for c in calls), 'output': sum(c['output'] for c in calls),
                 'cache_hit': sum(c['cache_hit'] for c in calls),
                 'recheck_input': sum(c['input'] for c in rcalls), 'recheck_output': sum(c['output'] for c in rcalls),
                 'recheck_cache_hit': sum(c['cache_hit'] for c in rcalls),
                 'all_tokens': sum(c['input'] + c['output'] for c in all_calls),
                 'recheck_tokens': sum(c['input'] + c['output'] for c in rcalls),
                 'route_ms': sum(c['latency_ms'] for c in calls), 'recheck_ms': sum(c['latency_ms'] for c in rcalls),
                 'elapsed_ms': row['elapsed_ms'], 'total_usd': sum(cost(c) for c in all_calls),
                 'recheck_usd': sum(cost(c) for c in rcalls), 'tier': row['tier']}
            records.append(r)
            audit['auto_settled'] += trace['autoSettled']
            audit['recheck_accepted'] += bool(recheck.get('accepted'))
            audit['transport_errors'] += bool(row.get('error'))
            audit['hypothetical_create_changed_to_existing'] += ini_target == 'CREATE' and fin_target != 'CREATE'
            audit['hypothetical_novel_create'] += ini_target == 'CREATE' and fin_target != 'CREATE' and gold is not None and gold not in seen and mode == 'open'
            audit['candidate_set_complete'] += set(candidates) == set(catalog)
            audit['review_attempted'] += trace['review']['attempted']
            if r['strict'] and status in ('selection_miss', 'catalog_absent'):
                misses.append({'session': sid, 'i': turn['i'], 'gold': gold, 'status': status,
                               'final_correct': bool(r['final_ok']), 'catalog_size': len(catalog), 'prefix_status': prefix_status,
                               'correct_canonical_ids': sorted(k for k,v in mapping.items() if v == gold),
                               'catalog_contains_gold_prefix_owner': any(bag and max(bag, key=bag.get) == gold for bag in held.values())})
            if skipped or (recheck['attempted'] and ini_target != fin_target):
                shadow.append({'session': sid, 'i': turn['i'], 'trigger': r['trigger'], 'shadow_keep': keep, 'reason': reason,
                               'strict': r['strict'], 'initial_correct': bool(r['initial_ok']), 'final_correct': bool(r['final_ok']),
                               'same_target': ini_target == fin_target, 'initial_kind': initial_kind, 'final_kind': final_kind})
            if final.get('contextId'):
                if final['action'] == 'CREATE':
                    assert final['contextId'] not in catalog
                    catalog.append(final['contextId'])
                current = final['contextId']
            if gold is not None:
                seen.add(gold)
                last[gold] = turn['i']
                previous_gold = gold
                if row['pred'] not in ('CLARIFY', 'ERROR'):
                    held[row['pred']][gold] += 1
    strict = [r for r in records if r['strict']]
    rechecked = [r for r in records if r['rechecked']]
    skipped = [r for r in records if r['skip']]
    def recall(part):
        counts = Counter(r['status'] for r in part)
        eligible = [r for r in part if r['status'] in ('hit', 'selection_miss')]
        prefix_eligible = [r for r in part if r['prefix_status'] in ('hit', 'selection_miss')]
        return {'strict_n': len(part), 'status_counts': dict(counts), 'eligible_n': len(eligible),
                'recall_at_cap16_pct': metric(eligible, session_ids, lambda r: r['status'] == 'hit'),
                'prefix_status_counts': dict(Counter(r['prefix_status'] for r in part)),
                'prefix_eligible_n': len(prefix_eligible),
                'prefix_recall_at_cap16_pct': metric(prefix_eligible, session_ids, lambda r: r['prefix_status'] == 'hit'),
                'k_min': min((r['k'] for r in part), default=None), 'k_max': max((r['k'] for r in part), default=None)}
    recall_groups = {'all': recall(strict)}
    for key in ('short', 'implicit', 'same_domain', 'same_domain_switch', 'long_return'):
        recall_groups[key] = recall([r for r in strict if r[key]])
    for label, low, high in [('0', 0, 0), ('1-4', 1, 4), ('5-8', 5, 8), ('9-16', 9, 16), ('>16', 17, math.inf)]:
        recall_groups[f'catalog_{label}'] = recall([r for r in strict if low <= r['catalog_size'] <= high])
    policy_stats = {
        'id': POLICY['id'], 'skipped_rechecks': len(skipped), 'remaining_rechecks': len(rechecked) - len(skipped),
        'skip_reasons': dict(Counter(r['policy_reason'] for r in skipped)),
        'accuracy_delta_pp': metric(strict, session_ids, lambda r: (r['initial_ok'] - r['final_ok']) if r['skip'] else 0),
        'pollution_delta_pp': metric(strict, session_ids, lambda r: (r['initial_pollution'] - r['final_pollution']) if r['skip'] else 0),
        'harm_delta_per100': metric(strict, session_ids, lambda r: (r['initial_harm'] - r['final_harm']) if r['skip'] else 0),
        'all_labelled_accuracy_delta_pp': metric([r for r in records if r['gold'] is not None], session_ids, lambda r: (r['initial_ok'] - r['final_ok']) if r['skip'] else 0),
        'all_labelled_pollution_delta_pp': metric([r for r in records if r['gold'] is not None], session_ids, lambda r: (r['initial_pollution'] - r['final_pollution']) if r['skip'] else 0),
        'saved_calls': sum(r['recheck_calls'] for r in skipped),
        'saved_tokens': sum(r['recheck_tokens'] for r in skipped),
        'saved_usd': sum(r['recheck_usd'] for r in skipped),
        'saved_usd_per1000': metric(records, session_ids, lambda r: r['recheck_usd'] if r['skip'] else 0, scale=1000),
        'total_cost_reduction_pct': metric(records, session_ids, lambda r: r['recheck_usd'] if r['skip'] else 0, lambda r: r['total_usd']),
        'avoided_serial_ms_per_message': metric(records, session_ids, lambda r: r['recheck_ms'] if r['skip'] else 0, scale=1),
        'skipped_subset': outcome_summary(skipped, session_ids),
    }
    policy_stats['numeric_gate_pass'] = (policy_stats['accuracy_delta_pp']['ci95'][0] >= POLICY['accuracy_lower_pp']
        and policy_stats['pollution_delta_pp']['ci95'][1] <= POLICY['pollution_upper_pp']
        and policy_stats['harm_delta_per100']['ci95'][1] <= POLICY['harm_upper_per100'])
    return {
        'mode': mode, 'sessions': len(sessions), 'messages': len(records), 'strict_messages': len(strict),
        'baseline': {'correct': sum(r['final_ok'] for r in strict), 'accuracy_pct': metric(strict, session_ids, lambda r: r['final_ok']),
                     'harm_per100': metric(strict, session_ids, lambda r: r['final_harm']),
                     'pollution_pct': metric(strict, session_ids, lambda r: r['final_pollution'])},
        'audit': dict(audit), 'tiers': dict(Counter(r['tier'] for r in records)),
        'catalog_sizes': dict(sorted(Counter(r['catalog_size'] for r in records).items())),
        'recheck': {'all_messages': outcome_summary(records, session_ids), 'attempted': outcome_summary(rechecked, session_ids),
                    'by_trigger': {trigger: {**outcome_summary([r for r in rechecked if r['trigger'] == trigger], session_ids),
                                  'costs': call_summary([r for r in rechecked if r['trigger'] == trigger], session_ids)}
                                   for trigger in ('create', 'clarify', 'evidence-conflict')},
                    'costs': call_summary(records, session_ids)},
        'candidate_recall': recall_groups, 'candidate_misses': misses, 'policy': policy_stats, 'shadow_records': shadow,
        'fast_path': {'observed_hits': sum(r['tier'] == 'fast' for r in records), 'explicit_binding_eligible': 0,
                      'paired_fast_vs_model_n': 0, 'quality_noninferiority': 'unproven: no observed binding metadata'},
    }


def frozen_files():
    files = [HERE / name for name in ('analyze.py', 'probe.mjs', 'bindings.mjs', 'protocol.md')]
    files += [ROOT / name for name in ('eval/score.py', 'src/routing-policy.ts', 'src/routing-evidence.ts',
              'src/history-catalog.ts', 'src/routing-shadow.ts', 'src/index.ts', 'eval/lib/product-replay.mjs')]
    return {str(p.relative_to(ROOT)).replace('\\', '/'): digest(p) for p in files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('dev', 'freeze', 'test'))
    args = parser.parse_args()
    if args.phase == 'freeze':
        dev = json.loads((HERE / 'dev-results.json').read_text(encoding='utf-8'))
        assert dev['analysis_sha256'] == digest(__file__)
        write_json(HERE / 'freeze.json', {'frozen_at_utc': datetime.now(timezone.utc).isoformat(), 'policy': POLICY,
            'files': frozen_files(), 'dev_results_sha256': digest(HERE / 'dev-results.json'),
            'dev_inputs': dev['inputs'], 'test_prediction_reads_before_freeze': 0}, exclusive=True)
        print('Frozen dev-selected loss-evidence-v1 before reading test predictions.')
        return
    split = args.phase
    if split == 'test':
        freeze = json.loads((HERE / 'freeze.json').read_text(encoding='utf-8'))
        assert freeze['files'] == frozen_files(), 'Frozen analysis or rule has changed'
        assert freeze['dev_results_sha256'] == digest(HERE / 'dev-results.json')
        for path, expected in freeze['dev_inputs'].items():
            assert digest(ROOT / path) == expected, 'Dev evidence changed after freezing'
        # Reserve before any test prediction read; a second evaluation requires a NEW protocol.
        write_json(HERE / 'test-evaluation-started.json', {'started_at_utc': datetime.now(timezone.utc).isoformat(),
            'freeze_sha256': digest(HERE / 'freeze.json')}, exclusive=True)
    elif (HERE / 'freeze.json').exists():
        raise ValueError('Dev rule is frozen; do not retune it after test')
    sessions = [s for s in read_jsonl(DATA / 'sessions.jsonl') if s['split'] == split]
    sources = [DATA / 'sessions.jsonl'] + [prediction_path(mode, split) for mode in ('open', 'closed')]
    result = {'split': split, 'generated_at_utc': datetime.now(timezone.utc).isoformat(), 'policy': POLICY,
              'analysis_sha256': digest(__file__), 'inputs': {str(p.relative_to(ROOT)).replace('\\', '/'): digest(p) for p in sources},
              'groups': {mode: analyze_group(sessions, read_jsonl(prediction_path(mode, split)), mode) for mode in ('open', 'closed')}}
    write_json(HERE / f'{split}-results.json', result, exclusive=split == 'test')
    for mode, group in result['groups'].items():
        print(json.dumps({'mode': mode, 'split': split, 'messages': group['messages'], 'baseline': group['baseline'],
                          'recheck': group['recheck']['attempted'], 'policy': group['policy'],
                          'misses': len(group['candidate_misses'])}, ensure_ascii=False))


if __name__ == '__main__':
    main()