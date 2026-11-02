"""Content-free diagnostics for source separation, fragmentation and causal returns."""
from collections import Counter, defaultdict
from statistics import mean, median

SPECIAL = {'ERROR', 'CLARIFY'}


def ratio(a, b):
    return round(a / b, 6) if b else None


def majority(counts):
    """Strict majority; tied or plural-only topics have no defensible owner."""
    if not counts: return None
    label, n = counts.most_common(1)[0]
    return label if n * 2 > sum(counts.values()) else None


def source_metrics(session, rows, turns):
    topics, touched = defaultdict(Counter), defaultdict(set)
    valid = {t['i'] for t in turns}
    for t in turns:
        gold, pred = t['gold']['thread'], rows[t['i']]['pred']
        touched[gold]  # Include sources whose predictions are all invalid.
        if pred not in SPECIAL:
            topics[pred][gold] += 1
            touched[gold].add(pred)
    owners = {p: majority(c) for p, c in topics.items()}
    mixing = Counter(n=len(turns))
    for t in turns:
        gold, pred = t['gold']['thread'], rows[t['i']]['pred']
        if pred in SPECIAL: mixing['invalid'] += 1
        elif owners[pred] is None: mixing['unresolved'] += 1
        elif owners[pred] != gold: mixing['mixed'] += 1
    mixing['minority_impurity'] = sum(sum(c.values()) - max(c.values()) for c in topics.values())
    fragmentation = {'topic_counts': [len(v) for v in touched.values()],
                     'owned_topic_counts': [sum(owner == g for owner in owners.values()) for g in touched]}
    history, seen_sources = defaultdict(Counter), set()
    switch, visits = Counter(), {'first': Counter(), 'returning': Counter()}
    previous = None
    for t in session['turns']:
        if t['i'] not in valid:
            previous = None  # Never bridge an excluded predecessor.
            continue
        gold, pred = t['gold']['thread'], rows[t['i']]['pred']
        if 'switch' in t.get('tags', []):
            bucket = visits['returning' if gold in seen_sources else 'first']
            switch['n'] += 1
            bucket['n'] += 1
            if previous is None or previous[1] in SPECIAL:
                switch['unassessable'] += 1
                bucket['unassessable'] += 1
            else:
                held = {p for p, c in history.items() if majority(c) == gold}
                destination_ok = pred in held or (not held and pred not in history)
                ok = (pred not in SPECIAL and pred != previous[1] and gold != previous[0] and destination_ok)
                switch['correct'] += int(ok)
                bucket['correct'] += int(ok)
        if pred not in SPECIAL: history[pred][gold] += 1
        seen_sources.add(gold)
        previous = gold, pred
    return {'mixing': dict(mixing), 'fragmentation': fragmentation,
            'switch': dict(switch), 'visits': {k: dict(v) for k, v in visits.items()}}


def summarize(results):
    """Aggregate counts, plus equal-weight per-stream accuracy and diagnostic rates."""
    mixing, switch = Counter(), Counter()
    visits = {'first': Counter(), 'returning': Counter()}
    counts, owned = [], []
    for r in results:
        mixing.update(r['metrics']['mixing'])
        switch.update(r['metrics']['switch'])
        for k in visits: visits[k].update(r['metrics']['visits'][k])
        counts.extend(r['metrics']['fragmentation']['topic_counts'])
        owned.extend(r['metrics']['fragmentation']['owned_topic_counts'])
    def switch_bucket(c):
        return {**{k: c[k] for k in ('correct', 'n', 'unassessable')}, 'accuracy': ratio(c['correct'], c['n'])}
    def stats(values):
        return {'n': len(values), 'mean': round(mean(values), 6) if values else None,
                'median': round(median(values), 6) if values else None}
    mixing_rates = [r['metrics']['mixing'].get('mixed', 0) / r['n'] for r in results if r['n']]
    switch_rates = [r['metrics']['switch'].get('correct', 0) / r['metrics']['switch']['n']
                    for r in results if r['metrics']['switch'].get('n')]
    return {
        'cross_session_mixing': {**{k: mixing[k] for k in ('mixed', 'n', 'unresolved', 'invalid', 'minority_impurity')},
            'rate': ratio(mixing['mixed'], mixing['n']), 'by_stream': stats(mixing_rates)},
        'fragmentation': {'source_instances': len(counts), 'mean_topics_per_source': round(mean(counts), 6) if counts else None,
            'median_topics_per_source': median(counts) if counts else None, 'max_topics_per_source': max(counts, default=None),
            'split_source_instances': sum(n > 1 for n in counts),
            'topic_count_histogram': {str(k): v for k, v in sorted(Counter(counts).items())},
            'owned_topic_count_histogram': {str(k): v for k, v in sorted(Counter(owned).items())}},
        'switch_routing': {**switch_bucket(switch), 'by_visit': {k: switch_bucket(v) for k, v in visits.items()},
            'by_stream': stats(switch_rates)},
        'stream_accuracy': stats([r['correct'] / r['n'] for r in results if r['n']]),
    }
