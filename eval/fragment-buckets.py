"""Explain fragment births in existing routing predictions; never runs a model.

    py eval/fragment-buckets.py sessions.jsonl predictions.jsonl [...] --split dev --json

Main labels and input validation come from score.py. A fragment is a distinct
(gold thread, non-main predicted topic) pair, not every wrongly routed message.
The score's sum(k - 1) and non-main pair count differ if a main was never used;
both counts are reported. See the accompanying report for observational limits.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
from statistics import median
import sys
import unicodedata

import score

STOPWORDS = set('a an the and or of to for in on at with is are be it this that my your'.split())
SUBTYPES = {
    'not_recalled': 'A: existing topic absent from all observed candidate pages',
    'create_stayed': 'B: initial CREATE remained CREATE (recheck status in evidence)',
    'recheck_overturned': 'B: correct initial target changed after accepted recheck, no review',
    'wrong_not_rescued': 'B: incorrect initial decision was not rescued',
    'rule_direct': 'B: direct rule route, without a model failure fallback',
    'review_not_rescued': 'B: target appeared only on review pages, still missed',
    'later_change_unresolved': 'B: correct initial target changed; intermediate decision not recorded',
    'gold_ambiguous': 'C: source turn.ambiguous is true',
    'gold_requires_ref_ablation': 'C: score.py marks an ablated reference-dependent turn ambiguous',
    'model_fallback': 'D: recorded model failure caused a fallback',
    'clarify_fallback': 'D: CLARIFY was automatically settled',
    'oneoff_topic_reuse': 'D: a thread message reused a topic originally created for a one-off',
    'normal_open_start': 'D: valid initial CREATE, only a non-main label in hindsight',
    'no_prior_thread_topic': 'D: no prior topic for this thread existed at this step',
    'missing_trace': 'D: insufficient candidate or initial-decision trace for attribution',
}


def title_overlap(text, title):
    """Jaccard on lowercase Latin/number words and contiguous Han bigrams.

    This is a title-only lexical proxy, not semantic similarity or card content.
    """
    if not title:
        return None

    def tokens(value):
        value = unicodedata.normalize('NFKC', value).lower()
        result = set(re.findall(r'[a-z0-9]+', value)) - STOPWORDS
        for run in re.findall(r'[\u3400-\u4dbf\u4e00-\u9fff]+', value):
            result.update(run[i:i + 2] for i in range(len(run) - 1))
            if len(run) == 1:
                result.add(run)
        return result

    a, b = tokens(text), tokens(title)
    return round(len(a & b) / len(a | b), 6) if a or b else None


def observed_evidence(outcome, targets, current_id):
    row, turn = outcome['row'], outcome['turn']
    trace = row.get('trace') or {}
    initial, final = trace.get('initial') or {}, trace.get('final') or row.get('decision') or {}
    recheck, review = trace.get('recheck') or {}, trace.get('review') or {}
    candidates = trace.get('candidateIds')
    initial_ids = set(candidates or [])
    review_ids = set()
    # A page mentioned in an unattempted review is not evidence of exposure.
    if review.get('attempted'):
        details = [call for call in row.get('call_details', []) if call.get('layer') == 'review']
        if details:
            review_ids = {p for call in details if call.get('sent') for p in call.get('candidateIds', [])}
        else:
            review_ids = {p for page in review.get('pages', []) for p in page}
    reason = str(final.get('reason', ''))
    fallback = reason.startswith('router-fallback:') or bool(row.get('error') and row.get('tier') == 'rules')
    initial_target = initial.get('contextId')
    if initial.get('action') == 'KEEP' and not initial_target:
        initial_target = current_id
    initial_correct = initial.get('action') in {'EXISTING', 'KEEP', 'SWAP', 'MOUNT'} and initial_target in targets
    return {
        'ambiguous': bool(turn.get('ambiguous')),
        'score_ambiguous': outcome['ambiguous'],
        'initial': initial, 'final': final, 'recheck': recheck, 'review': review,
        'tier': row.get('tier'), 'via': row.get('via'), 'error': row.get('error'),
        'model_fallback': fallback,
        'auto_settled': bool(trace.get('autoSettled')) or reason == 'unclear-settled',
        'candidate_trace_present': isinstance(candidates, list),
        'initial_candidate_ids': sorted(initial_ids), 'review_candidate_ids': sorted(review_ids),
        'target_seen': bool(targets & (initial_ids | review_ids)),
        'target_seen_only_in_review': not bool(targets & initial_ids) and bool(targets & review_ids),
        'initial_correct': initial_correct,
    }


def classify(outcome, evidence, targets, normal_start, oneoff_reuse):
    """Exclusive buckets. Observable overlapping mechanisms remain in evidence."""
    if normal_start:
        return 'D', 'normal_open_start'
    if evidence['score_ambiguous']:
        return 'C', 'gold_ambiguous' if evidence['ambiguous'] else 'gold_requires_ref_ablation'
    if evidence['model_fallback']:
        return 'D', 'model_fallback'
    if evidence['auto_settled']:
        return 'D', 'clarify_fallback'
    if oneoff_reuse:
        return 'D', 'oneoff_topic_reuse'
    if not targets:
        return 'D', 'no_prior_thread_topic'
    row = outcome['row']
    if row.get('via') == 'rules' or row.get('tier') in {'rules', 'fast'}:
        return 'B', 'rule_direct'
    if not evidence['candidate_trace_present'] or not evidence['initial']:
        return 'D', 'missing_trace'
    if not evidence['target_seen']:
        return 'A', 'not_recalled'
    if evidence['target_seen_only_in_review']:
        return 'B', 'review_not_rescued'
    if evidence['initial_correct']:
        if evidence['recheck'].get('accepted') and not evidence['review'].get('attempted'):
            return 'B', 'recheck_overturned'
        return 'B', 'later_change_unresolved'
    if evidence['initial'].get('action') == 'CREATE' and row.get('action') == 'CREATE':
        return 'B', 'create_stayed'
    return 'B', 'wrong_not_rescued'


def features_for(turn, main, known, last_gold, last_card_request, position, candidates, mapping, threads):
    gold = turn['gold']['thread']
    title = known.get(main, {}).get('title')
    overlap = title_overlap(turn['text'], title)
    domain = threads[gold].get('domain')
    similar = [p for p in candidates if mapping.get(p) in threads and mapping[p] != gold
               and domain is not None and threads[mapping[p]].get('domain') == domain]
    return {
        'title_jaccard': overlap,
        'low_title_overlap': overlap < 0.1 if overlap is not None else None,
        'intervening_turns': position - last_gold[gold] - 1 if gold in last_gold else None,
        'topic_age_turns': position - known[main]['position'] if main in known else None,
        # card_usage records requests, not successful application or card contents.
        'card_age_turns': None,
        'turns_since_card_request': position - last_card_request[main] if main in last_card_request else None,
        'same_domain_candidate_ids': sorted(similar),
        'same_domain_candidate': bool(similar),
    }


def feature_summary(features):
    result = {'n': len(features)}
    for key in ('title_jaccard', 'intervening_turns', 'topic_age_turns', 'turns_since_card_request', 'card_age_turns'):
        values = [f[key] for f in features if f[key] is not None]
        result[key] = {'n': len(values), 'missing': len(features) - len(values),
                       'median': median(values) if values else None}
    for key in ('low_title_overlap', 'same_domain_candidate'):
        values = [f[key] for f in features if f[key] is not None]
        n = sum(values)
        result[key] = {'n': n, 'denominator': len(values), 'share': n / len(values) if values else None}
    return result


def analyze(sessions, predictions, split='dev'):
    """Validate through score.py, reuse its mapping, and walk each session in order."""
    if split not in {'dev', 'test', 'all'}:
        raise ValueError('split must be dev, test, or all')
    reference = score.evaluate(sessions, predictions, split)
    mode = reference['mode']
    selected = [s for s in sessions if split == 'all' or s['split'] == split]
    by_session = defaultdict(list)
    for row in predictions:
        by_session[row['session_id']].append(row)
    events, controls, per_session = [], [], []
    counted_threads = topic_assignments = without_main = extra_births_on_main = oneoffs = 0
    for session in selected:
        outcomes, mapping = score.score_session(session, by_session[session['session_id']], mode)
        threads = {t['id']: t for t in session['threads']}
        # The scorer intentionally uses fixed gold IDs in v0 closed mode.
        if mode == 'closed' and session.get('routing_schema') != 'routing-v1':
            mapping = {g: g for g in threads}
        main_by_gold = {g: p for p, g in mapping.items()}
        catalog = session.get('catalog', list(threads.values()) if mode == 'closed' else [])
        known = {t['id']: {'title': t.get('title'), 'position': 0, 'source': 'seed_catalog'} for t in catalog}
        visited, last_gold, last_card_request = defaultdict(set), {}, {}
        oneoff_topics, births = set(), {}
        current_id = session.get('current_id')
        session_events = []
        for position, outcome in enumerate(outcomes):
            turn, row, pred = outcome['turn'], outcome['row'], outcome['pred']
            gold = turn['gold']['thread']
            if gold is None:
                oneoffs += 1
            if gold is not None and pred not in score.SPECIAL:
                main = main_by_gold.get(gold)
                targets = visited[gold] | ({main} if main in known else set())
                targets.discard(pred)
                evidence = observed_evidence(outcome, targets, current_id)
                candidates = sorted(set(evidence['initial_candidate_ids']) | set(evidence['review_candidate_ids']))
                features = features_for(turn, main, known, last_gold, last_card_request, position, candidates, mapping, threads)
                if pred == main and main in known and outcome['scorable'] and outcome['accurate']:
                    controls.append(features)
                first = pred not in visited[gold]
                if first and visited[gold] and pred == main:
                    extra_births_on_main += 1
                if pred != main and first:
                    normal_start = (mode == 'open' and not targets and not visited[gold]
                                    and row.get('action') == 'CREATE' and outcome['kind'] == 'correct')
                    bucket, subtype = classify(outcome, evidence, targets, normal_start, pred in oneoff_topics)
                    chosen = known.get(pred, {})
                    if row.get('action') == 'CREATE':
                        chosen = {'title': (row.get('decision') or evidence['final']).get('title'), 'source': 'create_decision'}
                    event = {
                        'session_id': session['session_id'], 'split': session['split'], 'i': turn['i'],
                        'gold_thread': gold, 'gold_title': threads[gold].get('title'), 'pred': pred,
                        'main_id': main, 'main_title': known.get(main, {}).get('title'),
                        'main_title_source': known.get(main, {}).get('source'),
                        'chosen_title': chosen.get('title'), 'chosen_title_source': chosen.get('source'),
                        'text': turn['text'], 'bucket': bucket, 'subtype': subtype, 'action': row.get('action'),
                        'score_kind': outcome['kind'], 'adds_observed_topic': bool(visited[gold]),
                        'existing_thread_topic_ids': sorted(targets),
                        'candidate_titles': {p: known.get(p, {}).get('title') for p in candidates},
                        'evidence': evidence, 'features': features,
                        'message_indices': [turn['i']], 'keep_indices': [], 'other_later_indices': [],
                    }
                    births[(gold, pred)] = event
                    events.append(event)
                    session_events.append(event)
                elif pred != main:
                    event = births[(gold, pred)]
                    event['message_indices'].append(turn['i'])
                    key = 'keep_indices' if row.get('action') == 'KEEP' and current_id == pred else 'other_later_indices'
                    event[key].append(turn['i'])
                visited[gold].add(pred)
            # Only now advance state; the birth's features cannot see this turn's card call.
            if gold is not None:
                last_gold[gold] = position
            if pred not in score.SPECIAL:
                if pred not in known:
                    decision = row.get('decision') or (row.get('trace') or {}).get('final') or {}
                    known[pred] = {'title': decision.get('title') if row.get('action') == 'CREATE' else None,
                                   'position': position, 'source': 'create_decision' if row.get('action') == 'CREATE' else 'unknown'}
                    if gold is None:
                        oneoff_topics.add(pred)
                if row.get('card_usage'):
                    last_card_request[pred] = position
                current_id = pred
        k = sum(len(ps) for ps in visited.values())
        missing = sum(main_by_gold.get(g) not in ps for g, ps in visited.items())
        counted_threads += len(visited)
        topic_assignments += k
        without_main += missing
        per_session.append({
            'session_id': session['session_id'], 'counted_threads': len(visited), 'topic_assignments': k,
            'extra_topics': k - len(visited), 'fragment_count': len(session_events),
            'threads_without_observed_main': missing, 'main_by_gold': main_by_gold,
            'buckets': {b: sum(e['bucket'] == b for e in session_events) for b in 'ABCD'},
        })
    topics_per_thread = round(topic_assignments / counted_threads, 3) if counted_threads else None
    if topics_per_thread != reference['topics_per_thread']:
        raise AssertionError('Fragment count disagrees with score.py topics_per_thread')
    n = len(events)
    extra_topics = topic_assignments - counted_threads
    if n != extra_topics + without_main:
        raise AssertionError('Non-main pair accounting is inconsistent')
    bucket_counts = Counter(e['bucket'] for e in events)
    subtype_counts = Counter(e['subtype'] for e in events)
    propagation = {
        'fragment_messages': sum(len(e['message_indices']) for e in events),
        'keep_messages': sum(len(e['keep_indices']) for e in events),
        'other_later_messages': sum(len(e['other_later_indices']) for e in events),
        'normal_start_keep_messages': sum(len(e['keep_indices']) for e in events if e['subtype'] == 'normal_open_start'),
        'keep_after_other_births': sum(len(e['keep_indices']) for e in events if e['subtype'] != 'normal_open_start'),
        'by_bucket': {b: {'births': bucket_counts[b],
                         'keep_messages': sum(len(e['keep_indices']) for e in events if e['bucket'] == b)} for b in 'ABCD'},
    }
    return {
        'schema': 'fragment-buckets-v1', 'mode': mode, 'replay': reference['replay'], 'split': split,
        'sessions': reference['sessions'], 'messages': reference['messages'], 'oneoff_messages': oneoffs,
        'counted_threads': counted_threads, 'topic_assignments': topic_assignments,
        'extra_topics': extra_topics, 'fragment_count': n, 'threads_without_observed_main': without_main,
        'chronological_extra_births_on_main': extra_births_on_main,
        'topics_per_thread': topics_per_thread,
        'score_check': {'topics_per_thread': reference['topics_per_thread'], 'matches': True},
        'buckets': {b: {'n': bucket_counts[b], 'share': bucket_counts[b] / n if n else None} for b in 'ABCD'},
        'subtypes': {key: {'n': subtype_counts[key], 'share': subtype_counts[key] / n if n else None,
                          'definition': description} for key, description in SUBTYPES.items()},
        'propagation': propagation,
        'b_features': feature_summary([e['features'] for e in events if e['bucket'] == 'B']),
        'correct_controls': feature_summary(controls),
        'per_session': per_session, 'events': events,
    }


def table(results):
    lines = ['| source | mode | split | fragments | extra topics | topics/thread | A | B | C | D | later KEEP |',
             '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
    for result in results:
        cells = [f"{result['buckets'][b]['n']} ({100 * result['buckets'][b]['share']:.1f}%)"
                 if result['fragment_count'] else '0 (n/a)' for b in 'ABCD']
        label = str(result.get('source', 'predictions')).replace('|', '\\|')
        lines.append(f"| {label} | {result['mode']} | {result['split']} | {result['fragment_count']} | "
                     f"{result['extra_topics']} | {result['topics_per_thread']} | " + ' | '.join(cells)
                     + f" | {result['propagation']['keep_messages']} |")
    for result in results:
        lines.extend(['', str(result.get('source', 'predictions')), '| subtype | births |', '|---|---:|'])
        lines.extend(f"| {key} | {value['n']} |" for key, value in result['subtypes'].items() if value['n'])
        lines.append(f"Score check: {result['score_check']['topics_per_thread']}; "
                     f"threads without an observed main: {result['threads_without_observed_main']}.")
    return '\n'.join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sessions', type=Path)
    parser.add_argument('predictions', type=Path, nargs='+')
    parser.add_argument('--split', choices=('dev', 'test', 'all'), default='dev')
    parser.add_argument('--json', action='store_true', dest='as_json')
    args = parser.parse_args(argv)
    sessions = score.read_jsonl(args.sessions)
    session_hash = hashlib.sha256(args.sessions.read_bytes()).hexdigest()
    results = []
    for path in args.predictions:
        result = analyze(sessions, score.read_jsonl(path), args.split)
        result.update(source=str(path), source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                      sessions_source=str(args.sessions), sessions_sha256=session_hash)
        results.append(result)
    print(json.dumps(results, ensure_ascii=False, indent=2) if args.as_json else table(results))
    return 0


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
