#!/usr/bin/env python3
"""Generate a private routing benchmark without network, credentials, or subprocesses.

Python 3.14 supplies compression.zstd for the read-only DSH log adapter.
Run with -B. All outputs must be below eval/data/private-real/; existing files
are never replaced. Only aggregate counters are printed, including on errors.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
import argparse
import hashlib
import json
import re
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / 'lib'))
from private_real_redact import Redactor
from private_real import (alias, timestamp, content_text, clean_user, clean_reply,
                          parse_claude, parse_codex, build_interleaved, split_gateway, distribution)

PRIVATE_ROOT = Path(__file__).resolve().parent / 'data/private-real'


def private_path(path):
    path = Path(path).resolve()
    if not path.is_relative_to(PRIVATE_ROOT.resolve()) or path == PRIVATE_ROOT.resolve():
        raise ValueError('Output must be inside eval/data/private-real')
    return path


def sanitize_tree(value, redactor):
    if isinstance(value, str): return redactor.redact(value)
    if isinstance(value, list): return [sanitize_tree(v, redactor) for v in value]
    if isinstance(value, dict): return {redactor.redact(str(k)): sanitize_tree(v, redactor) for k, v in value.items()}
    return value


def write_private(path, value, jsonl=False):
    path = private_path(path)
    # A second boundary check protects against future adapters forgetting to
    # sanitize a field. Only sanitized serialized bytes reach the filesystem.
    safe = sanitize_tree(value, Redactor())
    body = ('\n'.join(json.dumps(v, ensure_ascii=False) for v in safe) if jsonl else json.dumps(safe, ensure_ascii=False, indent=2)) + '\n'
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as handle:
        handle.write(body)


def jsonl_records(path, stats):
    try:
        with path.open(encoding='utf-8-sig') as handle:
            for line in handle:
                try:
                    value = json.loads(line)
                    if isinstance(value, dict): yield value
                    else: stats['non_object_records'] += 1
                except (ValueError, UnicodeError):
                    stats['malformed_records'] += 1
    except (OSError, UnicodeError):
        stats['unreadable_files'] += 1


def read_dsh(home, redactor, stats):
    base = Path(home) / '.dsh'
    db = base / 'theone/contexts.db'
    if not db.exists():
        stats['missing_database'] += 1
        return [], {}
    wal = Path(str(db) + '-wal')
    if wal.exists() and wal.stat().st_size:
        # immutable=1 cannot include WAL. Fail instead of silently treating a
        # stale main database as the latest correction state, or touching SHM.
        raise ValueError('DSH has a nonempty WAL; a consistent read-only snapshot is required')
    c = sqlite3.connect(db.as_uri() + '?mode=ro&immutable=1', uri=True)
    try:
        c.execute('PRAGMA query_only=ON')
        rows = c.execute('SELECT r.message_id,r.gateway_id,r.decision,r.status,r.created_at,d.corrected_to,d.corrected_at FROM routing_events r LEFT JOIN route_details d ON d.message_id=r.message_id').fetchall()
    finally:
        c.close()
    routes = {}
    for mid, gid, decision, status, created, corrected, corrected_at in rows:
        try: topic = json.loads(decision).get('contextId')
        except (ValueError, AttributeError):
            stats['invalid_route_decision'] += 1
            continue
        routes[mid] = {'topic': topic, 'gateway': gid, 'corrected': corrected, 'at': timestamp(created), 'corrected_at': timestamp(corrected_at) if corrected_at else None}
        stats['routes'] += 1
        stats['corrected_routes'] += bool(corrected)
    gateways = {r['gateway'] for r in routes.values()}
    try:
        from compression import zstd
    except ImportError:
        raise ValueError('DSH requires Python 3.14 compression.zstd') from None
    sessions = []
    for path in sorted((base / 'sessions').rglob('*.zstd')):
        stats['files'] += 1
        raw = zstd.decompress(path.read_bytes())
        try: records = json.loads(raw)
        except ValueError: records = [json.loads(line) for line in raw.splitlines() if line.strip()]
        del raw
        if not isinstance(records, list) or not records:
            stats['invalid_session_shape'] += 1
            continue
        head = records[0]
        sid = head.get('id')
        stats['all_user_events'] += sum(r.get('type') == 'user/message' for r in records)
        if sid not in gateways or head.get('delegationDepth', 0):
            stats['non_gateway_sessions'] += 1
            continue
        s = {'id': alias('dsh:' + str(sid)), 'source': 'dsh', 'messages': [], 'replies': []}
        seen, current = set(), None
        for row in records:
            d = row.get('data', {})
            when = timestamp(row.get('time'))
            if not when: continue
            if row.get('type') == 'user/message':
                stats['gateway_user_events'] += 1
                if d.get('source', {}).get('kind') != 'user':
                    stats['excluded_injected_or_forwarded'] += 1
                    continue
                current = None
                mid = d.get('id')
                if mid not in routes or routes[mid]['gateway'] != sid:
                    stats['excluded_unrouted_users'] += 1
                    continue
                if mid in seen:
                    stats['duplicate_users'] += 1
                    continue
                seen.add(mid)
                text, attachment = content_text(d.get('content'))
                clean = clean_user(text, redactor, stats, attachment)
                if clean:
                    s['messages'].append({'id': alias(mid), 'route_id': mid, 'at': when, **clean})
                    current = mid
            elif row.get('type') == 'assistant/message' and current:
                m = d.get('message', {})
                text, _ = content_text(m.get('content'))
                if text:
                    summary = clean_reply(text, redactor)
                    if summary: s['replies'].append({'at': when, 'text': summary, 'route_id': current})
        s['messages'].sort(key=lambda m: (m['at'], m['id']))
        s['replies'].sort(key=lambda m: m['at'])
        if s['messages']: sessions.append(s)
    stats['accepted_users'] = sum(len(s['messages']) for s in sessions)
    stats['accepted_sessions'] = len(sessions)
    return sessions, routes


def topic_drift(sessions):
    pairs = explicit = lexical = 0
    def tokens(text):
        english = re.findall(r'[a-z][a-z0-9_-]{2,}', text.lower())
        han = re.findall(r'[\u3400-\u9fff]+', text)
        return set(english + [part[i:i + 2] for part in han for i in range(len(part) - 1)])
    for s in sessions:
        for a, b in zip(s['messages'], s['messages'][1:]):
            pairs += 1
            explicit += bool(re.search(r'\u6362\u4e2a\u8bdd\u9898|\u53e6\u5916\u4e00\u4ef6\u4e8b|\u987a\u4fbf\u95ee|\u53e6\u5916\u95ee|unrelated question|different topic', b['text'], re.I))
            x, y = tokens(a['text']), tokens(b['text'])
            if len(x) >= 10 and len(y) >= 10 and len(x & y) / len(x | y) < 0.03: lexical += 1
    return {'adjacent_pairs': pairs, 'explicit_topic_change_cues': explicit, 'low_lexical_overlap_pairs': lexical,
            'interpretation': 'Heuristic audit flags only; neither is a validated topic-change rate.'}


def generate(home, out, max_messages=2000):
    if not 10 <= max_messages <= 2000: raise ValueError('Budget must be 10..2000')
    out = private_path(out)
    if out.exists(): raise FileExistsError('Use a new output directory')
    redactor = Redactor()
    stats = {k: Counter() for k in ('claude', 'codex', 'dsh')}
    all_sessions = []
    manifest = []
    for source, pattern, folder, parser in (
            ('claude', '*/*.jsonl', '.claude/projects', parse_claude),
            ('codex', '**/*.jsonl', '.codex/sessions', parse_codex)):
        files = sorted((Path(home) / folder).glob(pattern))
        stats[source]['files'] = len(files)
        for path in files:
            before = path.stat()
            parsed = parser(jsonl_records(path, stats[source]), alias(str(path)), redactor, stats[source])
            all_sessions.extend(parsed)
            after = path.stat()
            stats[source]['files_changed_during_read'] += (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns)
            manifest.append({'source': source, 'file': alias(str(path)), 'bytes': before.st_size, 'mtime_ns': before.st_mtime_ns})
    # Relocated Claude logs may repeat the same human message in several files.
    merged = {}
    for s in all_sessions:
        target = merged.setdefault(s['id'], {**s, 'messages': [], 'replies': []})
        target['messages'].extend(s['messages']); target['replies'].extend(s['replies'])
    for s in merged.values():
        unique = {m['id']: m for m in s['messages']}
        stats[s['source']]['cross_file_duplicates'] += len(s['messages']) - len(unique)
        s['messages'] = sorted(unique.values(), key=lambda m: (m['at'], m['id']))
        reps = {(r['at'], r['text']): r for r in s['replies']}
        s['replies'] = sorted(reps.values(), key=lambda r: r['at'])
    all_sessions = list(merged.values())
    for source in ('claude', 'codex'):
        stats[source]['unique_users'] = sum(len(s['messages']) for s in all_sessions if s['source'] == source)
        stats[source]['unique_sessions'] = sum(s['source'] == source for s in all_sessions)
    dsh_sessions, routes = read_dsh(home, redactor, stats['dsh'])
    dsh_n = sum(len(s['messages']) for s in dsh_sessions)
    if dsh_n >= max_messages: raise ValueError('Gateway history exceeds the budget; choose a documented temporal subset')
    interleaved, split_info = build_interleaved(all_sessions, max_messages=max_messages - dsh_n)
    if not interleaved or {s['split'] for s in interleaved} != {'dev', 'test'}:
        raise ValueError('Not enough overlapping sessions for disjoint dev/test')
    gateway = []
    cutoff = split_info['cutoff_utc']
    for i, s in enumerate(dsh_sessions):
        gateway.extend(split_gateway(s, routes, cutoff, i + 1))
    summary = {'generated_utc': datetime.now(timezone.utc).isoformat(), 'max_messages': max_messages,
        'sources': {k: dict(v) for k, v in stats.items()}, 'redactions': dict(redactor.counts),
        'redaction_scope': 'Accepted candidate user text and visible assistant text, before dataset selection; tool/system bodies not scanned.',
        'interleaved': distribution(interleaved), 'gateway': distribution(gateway), 'split': split_info,
        'topic_drift': topic_drift(all_sessions), 'total_messages': sum(len(s['turns']) for s in interleaved + gateway)}
    assert summary['total_messages'] <= max_messages
    write_private(out / 'interleaved.jsonl', interleaved, jsonl=True)
    write_private(out / 'gateway.jsonl', gateway, jsonl=True)
    write_private(out / 'stats.json', summary)
    write_private(out / 'source-manifest.json', manifest)
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default=str(PRIVATE_ROOT / 'corpus-v1'))
    parser.add_argument('--max-messages', type=int, default=2000)
    args = parser.parse_args(argv)
    try:
        summary = generate(Path.home(), args.out, args.max_messages)
        print(json.dumps(summary, ensure_ascii=True, indent=2))
        return 0
    except Exception as error:
        # Exception messages from parsers can contain source text or paths.
        print(json.dumps({'status': 'failed', 'error_type': type(error).__name__,
                          'detail': 'No raw exception or chat content logged. Check source format, WAL state, output freshness and temporal coverage.'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())