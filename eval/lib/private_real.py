"""Pure offline extraction and temporal routing-v1 construction.

All returned chat text has passed Redactor. Readers never copy source logs to disk.
Session identity is only a proxy topic label, not human-confirmed routing truth.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import re

INJECTED = ('system-reminder', 'environment_context', 'INSTRUCTIONS', 'user_instructions',
            'developer_instructions', 'turn_aborted', 'subagent_notification', 'task-notification',
            'local-command-caveat', 'local-command-stdout', 'command-name', 'command-message',
            'command-args', 'permissions', 'permissions_instructions', 'collaboration_mode',
            'skills_instructions', 'available_skills', 'app_context', 'context', 'git_status')
PASTE = re.compile(r'<(?:pasted_content|pasted_text|file_content|attached_file|attachment)\b[^>]*>.*?(?:</(?:pasted_content|pasted_text|file_content|attached_file|attachment)>|$)|```[^\n]*\n.*?(?:```|$)|\[Pasted (?:text|content)[^\]]*\]', re.I | re.S)
SUMMARY = re.compile(r'^\s*(?:This session is being continued from a previous conversation|The previous conversation was summarized|You are an AI assistant|Message Type:\s*(?:MESSAGE|FINAL_ANSWER)|\[Request interrupted by user|# AGENTS\.md instructions|<analysis>)', re.I)
SHORT = re.compile(r'^(?:ok(?:ay)?|yes|no|go|continue|next(?: step)?|done\??|thanks|sure|run it|do it|\u7ee7\u7eed|\u597d(?:\u7684)?|\u53ef\u4ee5|\u884c|\u4e0b\u4e00\u6b65|\u5bf9|\u662f|\u5f00\u59cb|\u6267\u884c|\u8dd1\u5b8c\u4e86\u5417|\u5b8c\u6210\u4e86\u5417|\u600e\u4e48\u6837(?:\u4e86)?|\u8bd5\u8bd5|\u8dd1\u4e00\u4e0b|\u5e2e\u6211\u505a)[\s.!?,\u3002\uff01\uff1f\uff0c]*$', re.I)


def alias(value):
    return hashlib.sha256(str(value).encode('utf-8')).hexdigest()[:16]


def timestamp(value):
    try:
        if isinstance(value, (int, float)):
            date = datetime.fromtimestamp(value / 1000 if value > 1e11 else value, timezone.utc)
        else:
            date = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
        return date.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    except (ValueError, TypeError, OverflowError, OSError):
        return None


def content_text(content):
    if isinstance(content, str):
        return content, False
    if not isinstance(content, list):
        return '', False
    return '\n'.join(str(b.get('text', '')) for b in content if isinstance(b, dict) and b.get('type') in ('text', 'input_text', 'output_text')), any(isinstance(b, dict) and b.get('type') in ('image', 'input_image', 'attachment') for b in content)


def strip_blocks(text):
    for tag in INJECTED:
        text = re.sub(r'<' + re.escape(tag) + r'\b[^>]*>.*?(?:</' + re.escape(tag) + r'>|$)', '', text, flags=re.I | re.S)
    return text.strip()


def clean_user(text, redactor, stats, attachment=False):
    if SUMMARY.search(text):
        stats['excluded_summary_or_system'] += 1
        return None
    text = strip_blocks(text)
    if not text:
        stats['excluded_empty_or_injected'] += 1
        return None
    # Redact before extracting even the length-only paste marker.
    text = redactor.redact(text)
    paste_chars = 0
    def paste(match):
        nonlocal paste_chars
        paste_chars += len(match.group())
        return ' [PASTE] '
    text = PASTE.sub(paste, text).strip()
    if not text.replace('[PASTE]', '').strip():
        stats['excluded_paste_only'] += 1
        return None
    if len(text) > 16000:
        stats['excluded_unbounded_text'] += 1
        return None
    return {'text': text, 'has_paste': bool(paste_chars or attachment), 'paste_chars': paste_chars}


def clean_reply(text, redactor):
    # Full original responses never leave this call; hidden reasoning is never read.
    return redactor.summary(PASTE.sub(' [PASTE] ', strip_blocks(text)), 200).strip()


def dispatched(text):
    return bool(re.search(r'\.codex-runs|(?:\u4efb\u52a1\u8bf4\u660e|\u4efb\u52a1\u6587\u4ef6|task (?:file|brief)).{0,500}\.md|(?:^|\n)(?:you are codex|you are a coding agent|#\s*(?:task|\u4efb\u52a1)\s*[:\uff1a])', text, re.I | re.S))


def finish_sessions(sessions, stats):
    out = []
    for s in sessions:
        s['messages'].sort(key=lambda x: (x['at'], x['id']))
        s['replies'].sort(key=lambda x: x['at'])
        if s['messages']:
            stats['accepted_users'] += len(s['messages'])
            stats['accepted_sessions'] += 1
            out.append(s)
    return out


def parse_claude(records, file_key, redactor, stats):
    sessions = {}
    seen = set()
    for row in records:
        kind = row.get('type')
        stats['records'] += 1
        if kind not in ('user', 'assistant'):
            stats['ignored_non_chat_record'] += 1
            continue
        if kind == 'user': stats['user_records'] += 1
        if row.get('isSidechain') or row.get('isMeta') or row.get('isCompactSummary') or row.get('isVisibleInTranscriptOnly') or row.get('sourceToolAssistantUUID'):
            stats['excluded_meta_sidechain_summary'] += kind == 'user'
            continue
        origin = row.get('origin') or {}
        origin_kind = origin.get('kind') if isinstance(origin, dict) else origin
        if kind == 'user' and (origin_kind in ('hook', 'task-notification', 'system', 'tool', 'agent') or row.get('promptSource') == 'system'):
            stats['excluded_nonhuman_origin'] += 1
            continue
        uid = row.get('uuid')
        if uid and uid in seen:
            stats['duplicate_users' if kind == 'user' else 'duplicate_replies'] += 1
            continue
        if uid: seen.add(uid)
        text, attachment = content_text(row.get('message', {}).get('content'))
        when = timestamp(row.get('timestamp'))
        if not when or not text:
            stats['excluded_tool_or_no_time'] += kind == 'user'
            continue
        sid = alias('claude:' + str(row.get('sessionId', file_key)))
        s = sessions.setdefault(sid, {'id': sid, 'source': 'claude', 'messages': [], 'replies': []})
        if kind == 'user':
            clean = clean_user(text, redactor, stats, attachment)
            if clean:
                s['messages'].append({'id': alias(uid or when + text), 'at': when, **clean})
        else:
            summary = clean_reply(text, redactor)
            if summary: s['replies'].append({'at': when, 'text': summary})
    return finish_sessions(sessions.values(), stats)


def parse_codex(records, file_key, redactor, stats):
    records = list(records)
    stats['records'] += len(records)
    metas = [r.get('payload', {}) for r in records if r.get('type') == 'session_meta']
    user_rows = [r for r in records if r.get('type') == 'response_item' and r.get('payload', {}).get('type') == 'message' and r['payload'].get('role') == 'user']
    stats['user_records'] += len(user_rows)
    for meta in metas:
        if isinstance(meta.get('source'), dict) or meta.get('thread_source') in ('subagent', 'guardian_review'):
            stats['excluded_subagent_sessions'] += 1
            stats['excluded_subagent_users'] += len(user_rows)
            return []
        if meta.get('source') == 'exec' or meta.get('originator') == 'codex_exec':
            stats['excluded_dispatched_sessions'] += 1
            stats['excluded_dispatched_users'] += len(user_rows)
            return []
    head = [content_text(r['payload'].get('content'))[0] for r in user_rows]
    human_head = [t for t in head if not SUMMARY.search(t) and strip_blocks(t)][:3]
    if any(dispatched(t) for t in human_head):
        stats['excluded_dispatched_sessions'] += 1
        stats['excluded_dispatched_users'] += len(user_rows)
        return []
    sid = alias('codex:' + str(metas[0].get('id', file_key) if metas else file_key))
    s = {'id': sid, 'source': 'codex', 'messages': [], 'replies': []}
    seen = set()
    for row in records:
        p = row.get('payload', {})
        if row.get('type') == 'event_msg' and p.get('type') == 'user_message':
            if user_rows:
                stats['ignored_event_mirror'] += 1
                continue
            p = {'type': 'message', 'role': 'user', 'content': p.get('message', '')}
        elif row.get('type') != 'response_item':
            continue
        if p.get('type') != 'message' or p.get('role') not in ('user', 'assistant'):
            continue
        text, attachment = content_text(p.get('content'))
        when = timestamp(row.get('timestamp'))
        if not text or not when:
            stats['excluded_tool_or_no_time'] += p.get('role') == 'user'
            continue
        uid = p.get('id') or alias(when + ':' + p['role'] + ':' + text)
        if uid in seen:
            stats['duplicate_users' if p['role'] == 'user' else 'duplicate_replies'] += 1
            continue
        seen.add(uid)
        if p['role'] == 'user':
            clean = clean_user(text, redactor, stats, attachment)
            if clean: s['messages'].append({'id': alias(uid), 'at': when, **clean})
        else:
            summary = clean_reply(text, redactor)
            if summary: s['replies'].append({'at': when, 'text': summary})
    return finish_sessions([s], stats)


def language(text):
    return 'zh' if re.search(r'[\u3400-\u9fff]', text) else 'en'


def tags_for(message, previous_topic, topic, foreground):
    tags = ['source:' + message.get('source', 'dsh'), 'lang:' + language(message['text'])]
    if SHORT.fullmatch(message['text'].strip()) or len(message['text'].strip()) <= 6:
        tags.append('short')
        if foreground is None: tags.append('short_no_foreground')
        elif foreground['topic_id'] != topic: tags.append('short_foreground_conflict')
    if previous_topic and previous_topic != topic: tags.append('switch')
    if message.get('has_paste'): tags.append('has_paste')
    return tags


def header(sid, split, scenario, topics, catalog, sources):
    return {'version': 'interleave-v1', 'routing_schema': 'routing-v1', 'benchmark_revision': 'private-real-1',
            'session_id': sid, 'split': split, 'lang': 'zh', 'scenario': scenario,
            'generation': 'local-redacted-real-chat', 'source_sessions': sources,
            'threads': [{'id': t, 'title': f'Topic {n + 1}', 'description': 'Local session proxy', 'domain': 'mixed'} for n, t in enumerate(topics)],
            'catalog': catalog, 'turns': []}


def make_stream(sessions, split, index):
    if not 2 <= len(sessions) <= 5 or any(len(s['messages']) < 2 for s in sessions): return None
    start = max(s['messages'][0]['at'] for s in sessions)
    end = min(s['messages'][-1]['at'] for s in sessions)
    if start >= end: return None
    catalog, messages, replies = [], [], []
    for n, s in enumerate(sessions):
        topic = f't{n + 1}'
        seed = s['messages'][0]
        # One warm-up prompt per topic. No future title or summary is imported.
        catalog.append({'id': topic, 'title': seed['text'][:60] or f'Topic {n + 1}',
                        'summary': seed['text'][:200], 'entities': [], 'keywords': [],
                        'lastState': 'Observed initial user request before replay.'})
        messages.extend({**m, 'topic': topic, 'source': s['source']} for m in s['messages'] if start < m['at'] <= end)
        replies.extend({**r, 'topic_id': topic} for r in s['replies'] if r['at'] <= end)
    if len({m['topic'] for m in messages}) != len(sessions): return None
    messages.sort(key=lambda m: (m['at'], m['topic'], m['id']))
    replies.sort(key=lambda r: (r['at'], r['topic_id']))
    out = header(f'private-interleave-{index:03d}', split, 'real_overlapping_sessions', [t['id'] for t in catalog], catalog, [s['id'] for s in sessions])
    out['observation_basis'] = 'modeled_timestamp_merge'
    out['overlap_start'], out['overlap_end'] = start, end
    previous = None
    for i, m in enumerate(messages):
        visible = [r for r in replies if r['at'] < m['at']]
        foreground = visible[-1] if visible else None
        events = [{**foreground, 'id': f'fg-{i}', 'type': 'foreground'}] if foreground else []
        next_at = messages[i + 1]['at'] if i + 1 < len(messages) else end
        between = [r for r in replies if r['topic_id'] == m['topic'] and m['at'] < r['at'] < next_at]
        out['turns'].append({'i': i, 'at': m['at'], 'text': m['text'], 'reply': between[0]['text'] if between else '',
            'events_before': events, 'gold': {'thread': m['topic'], 'action': 'switch' if previous != m['topic'] else 'continue',
                'refs': [], 'explicit_binding': False, 'retract': [], 'confidence': 'session_proxy'},
            'tags': tags_for(m, previous, m['topic'], foreground), 'ambiguous': False,
            'style': 'natural', 'source': m['source'], 'source_message': m['id'], 'paste_chars': m.get('paste_chars', 0)})
        previous = m['topic']
    out['lang'] = language(''.join(m['text'] for m in messages))
    if out['turns'][0]['events_before']: out['current_id'] = out['turns'][0]['events_before'][-1]['topic_id']
    return out


def build_interleaved(sessions, max_messages=1988):
    if not 1 <= max_messages <= 2000: raise ValueError('Message budget must be 1..2000')
    eligible = sorted((s for s in sessions if len(s['messages']) >= 2), key=lambda s: (s['messages'][0]['at'], s['id']))
    all_times = sorted(m['at'] for s in eligible for m in s['messages'])
    if not all_times: return [], {'reason': 'no_eligible_sessions'}
    # Choose a temporal boundary using session intervals, never message content.
    # This sacrifices spanning sessions to guarantee source-session disjointness.
    candidates = sorted({s['messages'][-1]['at'] for s in eligible})
    best = None
    for cut in candidates:
        earlier = [s for s in eligible if s['messages'][-1]['at'] <= cut]
        later = [s for s in eligible if s['messages'][0]['at'] > cut]
        if len(earlier) < 2 or len(later) < 2: continue
        a, b = sum(len(s['messages']) for s in earlier), sum(len(s['messages']) for s in later)
        merit = min(a / 0.7, b / 0.3)
        if best is None or merit > best[0]: best = (merit, cut, earlier, later)
    if best is None: return [], {'reason': 'no_disjoint_temporal_split'}
    _, cutoff, earlier, later = best
    selected, grouped_ids = [], set()
    excluded = Counter()
    quota = {'dev': int(max_messages * 0.7), 'test': max_messages - int(max_messages * 0.7)}
    for split, pool in (('dev', earlier), ('test', later)):
        remaining = list(pool)
        while remaining and quota[split] > 0:
            seed = remaining.pop(0)
            candidates = [s for s in remaining if s['messages'][0]['at'] < seed['messages'][-1]['at'] and s['messages'][-1]['at'] > seed['messages'][0]['at']]
            group = [seed]
            stream = None
            for candidate in candidates:
                trial = make_stream(group + [candidate], split, len(selected) + 1)
                if trial:
                    group.append(candidate); stream = trial
                    if len(group) == 5: break
            if stream is None:
                excluded['no_usable_overlap_sessions'] += 1
                continue
            turns = stream['turns'][:quota[split]]
            if len({t['gold']['thread'] for t in turns}) < 2:
                excluded['cap_rejected_streams'] += 1
                continue
            stream['turns'] = turns
            # A final reply was bounded against a now omitted next turn; avoid
            # evaluating an unseen suffix by dropping that unused final reply.
            stream['turns'][-1]['reply'] = ''
            selected.append(stream)
            quota[split] -= len(turns)
            grouped_ids.update(s['id'] for s in group)
            remaining = [s for s in remaining if s not in group]
    included = sum(len(s['turns']) for s in selected)
    return selected, {'cutoff_utc': cutoff, 'eligible_sessions': len(eligible), 'eligible_users': len(all_times),
        'spanning_sessions_excluded': len(eligible) - len(earlier) - len(later),
        'spanning_users_excluded': sum(len(s['messages']) for s in eligible if s not in earlier and s not in later),
        'grouped_sessions': len(grouped_ids), 'selected_users': included,
        'not_selected_users': len(all_times) - included, 'unused_quota': quota, **excluded}


def make_gateway(s, routes, split, index):
    valid = [m for m in s['messages'] if m['route_id'] in routes and routes[m['route_id']].get('topic')]
    if not valid: return None
    raw_topics = list(dict.fromkeys(t for m in valid for t in (routes[m['route_id']]['topic'], routes[m['route_id']].get('corrected')) if t))
    ids = {t: f't{n + 1}' for n, t in enumerate(raw_topics)}
    catalog = [{'id': t, 'title': f'Historical topic {n + 1}', 'summary': 'Historical route topic; no future descriptor imported.',
                'entities': [], 'keywords': [], 'lastState': 'Unknown before this observation.'} for n, t in enumerate(ids.values())]
    out = header(f'private-gateway-{index:03d}', split, 'real_gateway_unconfirmed', list(ids.values()), catalog, [s['id']])
    out['observation_basis'] = 'gateway_prev_route_inferred'
    previous = None
    for i, m in enumerate(valid):
        route = routes[m['route_id']]
        topic = ids[route.get('corrected') or route['topic']]
        visible = [r for r in s['replies'] if r['at'] < m['at'] and r.get('route_id') in routes and routes[r['route_id']].get('topic') in ids]
        latest = visible[-1] if visible else None
        fg = {'id': f'fg-{i}', 'type': 'foreground', 'topic_id': ids[routes[latest['route_id']]['topic']], 'at': latest['at'], 'text': latest['text']} if latest else None
        confirmed = bool(route.get('corrected'))
        out['turns'].append({'i': i, 'at': m['at'], 'text': m['text'], 'reply': '', 'events_before': [fg] if fg else [],
            'gold': {'thread': topic, 'action': 'switch' if previous != topic else 'continue', 'refs': [],
                     'explicit_binding': False, 'retract': [], 'confidence': 'user_corrected' if confirmed else 'unconfirmed'},
            'ambiguous': not confirmed, 'style': 'natural', 'tags': tags_for(m, previous, topic, fg) + ['user_corrected' if confirmed else 'unconfirmed'],
            'source': 'dsh', 'source_message': m['id'], 'paste_chars': m.get('paste_chars', 0)})
        previous = topic
    out['lang'] = language(''.join(m['text'] for m in valid))
    return out



def split_gateway(session, routes, cutoff, index):
    full = make_gateway(session, routes, 'dev', index)
    if full is None: return []
    parts = []
    for split in ('dev', 'test'):
        turns = [t for t in full['turns'] if (t['at'] <= cutoff) == (split == 'dev')]
        if turns:
            parts.append({**full, 'session_id': full['session_id'] + '-' + split,
                          'split': split, 'turns': turns, 'gateway_segment': 'temporal_partition_original_order'})
    return parts


def distribution(streams):
    turns = [t for s in streams for t in s['turns']]
    return {'streams': len(streams), 'messages': len(turns), 'sources': dict(Counter(t['source'] for t in turns)),
            'tags': dict(Counter(tag for t in turns for tag in t['tags'])),
            'splits': {split: {'streams': sum(s['split'] == split for s in streams), 'messages': sum(len(s['turns']) for s in streams if s['split'] == split)} for split in ('dev', 'test')},
            'missing_foreground': sum(not t['events_before'] for t in turns),
            'topic_counts': dict(Counter(len(s['threads']) for s in streams)),
            'start_utc': min((t['at'] for t in turns), default=None), 'end_utc': max((t['at'] for t in turns), default=None)}