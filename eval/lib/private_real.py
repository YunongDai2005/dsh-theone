"""Pure offline extraction and temporal routing-v1 construction.

All returned chat text has passed Redactor. Readers never copy source logs to disk.
Session identity is only a proxy topic label, not human-confirmed routing truth.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
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


# Tokenize XML-like wrappers without interpreting their bodies or expanding entities.
XML_TOKEN = re.compile(r'<(?P<close>/)?(?P<name>[A-Za-z_][\w:.-]*)(?=[\s/>])(?:[^>\"\x27]|\"[^\"]*\"|\x27[^\x27]*\x27)*>', re.S)
ATTACHMENT_REF = re.compile(r'(?<!\S)@(?:"([^"\n]+)"|\x27([^\x27\n]+)\x27|([^\s]+))')
PASTE_TAGS = {'pasted_content', 'pasted_text', 'file_content', 'attached_file', 'attachment'}


def host_category(name):
    name = name.lower()
    for prefix, category in (('external_codex_apps_', 'external_codex_apps'),
                             ('codex_internal_context', 'codex_internal_context'),
                             ('local-command-', 'local_command'), ('command-', 'command'), ('ide_', 'ide')):
        if name.startswith(prefix): return category
    return 'known_host' if name in {t.lower() for t in INJECTED} else None


def strip_blocks(text, stats=None):
    tokens = list(XML_TOKEN.finditer(text))
    parts, cursor, i = [], 0, 0
    removed = Counter()
    while i < len(tokens):
        token = tokens[i]
        if token.start() < cursor or token['close']:
            i += 1
            continue
        name = token['name'].lower()
        category = host_category(name)
        leading = not ''.join(parts).strip() and not text[cursor:token.start()].strip()
        if not category and (not leading or name in PASTE_TAGS):
            i += 1
            continue
        end, next_i = None, i + 1
        if token.group().rstrip().endswith('/>'):
            if category: end = token.end()
        else:
            depth = 1
            for j in range(i + 1, len(tokens)):
                other = tokens[j]
                if other['name'].lower() != name: continue
                if other['close']: depth -= 1
                elif not other.group().rstrip().endswith('/>'): depth += 1
                if depth == 0:
                    end, next_i = other.end(), j + 1
                    break
            if end is None and category: end, next_i = len(text), len(tokens)
        if end is None:
            i += 1
            continue
        parts.append(text[cursor:token.start()])
        cursor, i = end, next_i
        removed[category or 'leading_xml'] += 1
    parts.append(text[cursor:])
    if stats is not None and removed:
        stats['injection_cleaned_users'] += 1
        for category, count in removed.items(): stats['stripped_blocks:' + category] += count
    return ''.join(parts).strip()


def attachment_refs(text, redactor):
    names = []
    def replace(match):
        path = next(v for v in match.groups() if v is not None)
        if not re.search(r'[/\\]|\.[A-Za-z0-9]{1,12}$', path): return match.group()
        name = path.replace('\\', '/').rstrip('/').rsplit('/', 1)[-1]
        name = redactor.redact(name)[:100]
        if name: names.append(name)
        return ''
    rest = ATTACHMENT_REF.sub(replace, text)
    return rest, list(dict.fromkeys(names))


def clean_user(text, redactor, stats, attachment=False, hints=None):
    if SUMMARY.search(text):
        stats['excluded_summary_or_system'] += 1
        return None
    removed = Counter()
    text = strip_blocks(text, removed)
    stats.update(removed)
    if not text:
        stats['excluded_empty_or_injected'] += 1
        for category in removed:
            if category.startswith('stripped_blocks:'):
                stats['excluded_injection_only:' + category.split(':', 1)[1]] += 1
        return None
    if SUMMARY.search(text):
        stats['excluded_summary_or_system'] += 1
        return None
    text, names = attachment_refs(text, redactor)
    if names:
        stats['attachment_reference_users'] += 1
        if hints is not None: hints.extend(names)
        if not text.strip():
            stats['excluded_attachment_only'] += 1
            return None
        text = text.strip() + '\n[Attachments: ' + ', '.join(names) + ']'
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
    return {'text': text, 'has_paste': bool(paste_chars or attachment or names), 'paste_chars': paste_chars}


def clean_reply(text, redactor):
    # Full original responses never leave this call; hidden reasoning is never read.
    return redactor.summary(PASTE.sub(' [PASTE] ', strip_blocks(text)), 200).strip()


def dispatched(text):
    return bool(re.search(r'\.codex-runs|(?:\u4efb\u52a1\u8bf4\u660e|\u4efb\u52a1\u6587\u4ef6|task (?:file|brief)).{0,500}\.md|(?:^|\n)(?:you are codex|you are a coding agent|#\s*(?:task|\u4efb\u52a1)\s*[:\uff1a])', text, re.I | re.S))


def new_session(sid, source):
    return {'id': sid, 'source': source, 'messages': [], 'replies': [],
            'projects': [], 'metadata': [], 'attachment_hints': []}


def add_project(session, cwd, when, redactor):
    if not isinstance(cwd, str) or not when: return
    name = cwd.replace('\\', '/').rstrip('/').rsplit('/', 1)[-1]
    if name and name not in ('.', '..') and not re.fullmatch(r'[A-Za-z]:', name):
        # Identity uses the original leaf so two redacted names cannot collide.
        item = {'at': when, 'name': redactor.redact(name)[:100], 'key': alias(name.casefold())}
        if not session['projects'] or session['projects'][-1]['key'] != item['key']:
            session['projects'].append(item)


def add_metadata(session, value, when, kind, redactor, stats):
    if not isinstance(value, str) or not value.strip(): return
    if not when:
        stats['metadata_untimed_excluded'] += 1
        return
    text = redactor.redact(PASTE.sub(' ', strip_blocks(value)))
    text, _ = attachment_refs(text, redactor)
    text = text.strip()[:300]
    if text:
        session['metadata'].append({'at': when, 'kind': kind, 'text': text})
        stats['metadata_timed_candidates'] += 1


def finish_sessions(sessions, stats):
    out = []
    for s in sessions:
        s['messages'].sort(key=lambda x: (x['at'], x['id']))
        s['replies'].sort(key=lambda x: x['at'])
        for field in ('projects', 'metadata', 'attachment_hints'):
            s[field].sort(key=lambda x: x['at'])
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
        if kind in ('custom-title', 'summary', 'title', 'session-title') and not row.get('isSidechain'):
            sid = alias('claude:' + str(row.get('sessionId', file_key)))
            target = sessions.setdefault(sid, new_session(sid, 'claude'))
            add_metadata(target, row.get('customTitle') or row.get('summary') or row.get('title'),
                         timestamp(row.get('timestamp')), kind, redactor, stats)
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
        s = sessions.setdefault(sid, new_session(sid, 'claude'))
        add_project(s, row.get('cwd'), when, redactor)
        if kind == 'user':
            hints = []
            clean = clean_user(text, redactor, stats, attachment, hints)
            if hints: s['attachment_hints'].append({'at': when, 'names': hints})
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
    human_head = [clean for t in head if (clean := strip_blocks(t)) and not SUMMARY.search(clean)][:3]
    if any(dispatched(t) for t in human_head):
        stats['excluded_dispatched_sessions'] += 1
        stats['excluded_dispatched_users'] += len(user_rows)
        return []
    sid = alias('codex:' + str(metas[0].get('id', file_key) if metas else file_key))
    s = new_session(sid, 'codex')
    for row in records:
        if row.get('type') not in ('session_meta', 'turn_context'): continue
        p = row.get('payload', {})
        when = timestamp(row.get('timestamp') or p.get('timestamp'))
        add_project(s, p.get('cwd'), when, redactor)
        # turn_context.summary is a reasoning setting, not a conversation summary.
        if row.get('type') == 'session_meta':
            for field in ('thread_name', 'title'):
                add_metadata(s, p.get(field), when, field, redactor, stats)
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
            hints = []
            clean = clean_user(text, redactor, stats, attachment, hints)
            if hints: s['attachment_hints'].append({'at': when, 'names': hints})
            if clean: s['messages'].append({'id': alias(uid), 'at': when, **clean})
        else:
            summary = clean_reply(text, redactor)
            if summary: s['replies'].append({'at': when, 'text': summary})
    return finish_sessions([s], stats)


def deduplicate_history(sessions, stats):
    """A copied prefix is one observation, not simultaneous work in two windows.

    Prefer the earliest/shorter history deterministically. Compare source, event
    identity, timestamp AND sanitized text; ordinary repeated short replies stay.
    """
    seen, out = set(), []
    for session in sorted(sessions, key=lambda s: (s['messages'][0]['at'], s['messages'][-1]['at'], s['id'])):
        messages = []
        for message in session['messages']:
            key = (session['source'], message['id'], message['at'], message['text'])
            if key in seen:
                stats[session['source']]['shared_history_users_excluded'] += 1
            else:
                seen.add(key)
                messages.append(message)
        if messages: out.append({**session, 'messages': messages})
        else: stats[session['source']]['shared_history_empty_sessions'] += 1
    return out


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
    return {'version': 'interleave-v1', 'routing_schema': 'routing-v1', 'benchmark_revision': 'private-real-2',
            'session_id': sid, 'split': split, 'lang': 'zh', 'scenario': scenario,
            'generation': 'local-redacted-real-chat', 'source_sessions': sources,
            'threads': [{'id': t, 'title': f'Topic {n + 1}', 'description': 'Local session proxy', 'domain': 'mixed'} for n, t in enumerate(topics)],
            'catalog': catalog, 'turns': []}


def after_millisecond(when):
    return timestamp(datetime.fromisoformat(when.replace('Z', '+00:00')) + timedelta(milliseconds=1))


def card_for(session, before):
    past = [m for m in session['messages'] if m['at'] < before][:5]
    if not past: return None
    meta = [m for m in session.get('metadata', []) if m['at'] < before]
    # Use the latest observed value of each title/summary field, never its final snapshot.
    latest = {m['kind']: m for m in sorted(meta, key=lambda m: m['at'])}
    meta = list(latest.values())
    projects = [p for p in session.get('projects', []) if p['at'] < before]
    hints = [h for h in session.get('attachment_hints', []) if h['at'] < before]
    names = list(dict.fromkeys(n for h in hints for n in h['names']))[:5]
    requests = [m['text'][:240] for m in past]
    # Project labels or attachment names alone must not make an empty task informative.
    evidence = ' '.join([m['text'] for m in meta] + [t for t in requests if len(t.strip()) > 6 and not SHORT.fullmatch(t.strip())])
    evidence = re.sub(r'\[[^\]]*\]', ' ', evidence)
    words = set(re.findall(r'[A-Za-z][A-Za-z0-9_-]{2,}|[\u3400-\u9fff]', evidence.lower()))
    if len(words) < 4 or len(re.sub(r'\W', '', evidence)) < 18: return None
    project = projects[-1]['name'] if projects else ''
    parts = ([f'Project: {project}'] if project else []) + [m['text'] for m in meta] + requests
    if names: parts.append('Attachments: ' + ', '.join(names))
    title = next((m['text'] for m in meta if 'title' in m['kind'] or m['kind'] == 'thread_name'), None)
    title = title or next((t for t in requests if len(t.strip()) > 6 and not SHORT.fullmatch(t.strip())), requests[0])
    title = (project + ': ' if project else '') + title
    summary = '\n'.join(parts)[:1800]
    evidence_times = [m['at'] for m in past + meta + projects + hints]
    return {'title': title[:80], 'summary': summary, 'at': max(evidence_times),
            'source_message_count': len(past), 'metadata_count': len(meta), 'attachment_name_count': len(names)}


def card_ready_at(session):
    # A short first input can be followed by useful context before evaluation starts.
    for message in session['messages'][:5]:
        boundary = after_millisecond(message['at'])
        if card_for(session, boundary): return message['at']
    return None


def project_scope(sessions, end):
    identities = [{p['key'] for p in s.get('projects', []) if p['at'] <= end} for s in sessions]
    if any(not names for names in identities): return 'unknown'
    return 'same_project' if len(set.union(*identities)) == 1 else 'cross_project'


def make_stream(sessions, split, index):
    if not 2 <= len(sessions) <= 5 or any(len(s['messages']) < 2 for s in sessions): return None
    ready = [card_ready_at(s) for s in sessions]
    if any(t is None for t in ready): return None
    # Hold out at least one usable past request from every source. This boundary
    # stays inside their actual common lifetime; no non-overlapping windows are joined.
    start = after_millisecond(max(ready))
    end = min(s['messages'][-1]['at'] for s in sessions)
    if start >= end: return None
    cards, messages, warmup = [], [], []
    for n, s in enumerate(sessions):
        topic = f't{n + 1}'
        card = card_for(s, start)
        if card is None: return None
        cards.append(card)
        warmup.append({'at': card['at'], 'text': card['title'] + '\n' + card['summary'],
            'reply': '', 'events_before': [], 'gold': {'thread': None, 'action': 'continue',
                'refs': [], 'explicit_binding': False, 'retract': [], 'confidence': 'context_only'},
            'tags': ['warmup'], 'ambiguous': True, 'style': 'context',
            'source_message_count': card['source_message_count'], 'metadata_count': card['metadata_count'],
            'attachment_name_count': card['attachment_name_count']})
        messages.extend({**m, 'topic': topic, 'source': s['source']} for m in s['messages'] if start <= m['at'] <= end)
    if len({m['topic'] for m in messages}) != len(sessions): return None
    messages.sort(key=lambda m: (m['at'], m['topic'], m['id']))
    warmup.sort(key=lambda t: t['at'])
    for i, t in enumerate(warmup): t['i'] = i
    topics = [f't{i + 1}' for i in range(len(sessions))]
    out = header(f'private-interleave-{index:03d}', split, 'real_overlapping_sessions', topics, [], [s['id'] for s in sessions])
    out['threads'] = [{'id': topic, 'title': card['title'], 'description': card['summary'], 'domain': 'mixed'} for topic, card in zip(topics, cards)]
    out['warmup'] = warmup
    out['observation_basis'] = 'unavailable_multi_window'
    out['project_scope'] = project_scope(sessions, end)
    out['overlap_start'], out['overlap_end'] = start, end
    previous = None
    for i, m in enumerate(messages, start=len(warmup)):
        out['turns'].append({'i': i, 'at': m['at'], 'text': m['text'], 'reply': '',
            'events_before': [], 'gold': {'thread': m['topic'], 'action': 'switch' if previous != m['topic'] else 'continue',
                'refs': [], 'explicit_binding': False, 'retract': [], 'confidence': 'session_proxy'},
            'tags': tags_for(m, previous, m['topic'], None) + ['project:' + out['project_scope']], 'ambiguous': False,
            'style': 'natural', 'source': m['source'], 'source_message': m['id'], 'paste_chars': m.get('paste_chars', 0)})
        previous = m['topic']
    out['lang'] = language(''.join(m['text'] for m in messages))
    return out


def build_interleaved(sessions, max_messages=1988):
    if not 1 <= max_messages <= 2000: raise ValueError('Message budget must be 1..2000')
    insufficient = sum(len(s['messages']) >= 2 and card_ready_at(s) is None for s in sessions)
    eligible = sorted((s for s in sessions if len(s['messages']) >= 2 and card_ready_at(s) is not None), key=lambda s: (s['messages'][0]['at'], s['id']))
    all_times = sorted(m['at'] for s in eligible for m in s['messages'])
    if not all_times: return [], {'reason': 'no_eligible_sessions', 'insufficient_card_sessions': insufficient}
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
    if best is None: return [], {'reason': 'no_disjoint_temporal_split', 'insufficient_card_sessions': insufficient}
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
                    # Prefer two-source flows so a third window cannot consume
                    # the partner of another usable pair or shrink this overlap.
                    break
            if stream is None:
                excluded['no_usable_overlap_sessions'] += 1
                continue
            turns = stream['turns'][:quota[split]]
            if len({t['gold']['thread'] for t in turns}) < 2:
                excluded['cap_rejected_streams'] += 1
                continue
            stream['turns'] = turns
            selected.append(stream)
            quota[split] -= len(turns)
            grouped_ids.update(s['id'] for s in group)
            remaining = [s for s in remaining if s not in group]
    included = sum(len(s['turns']) for s in selected)
    return selected, {'cutoff_utc': cutoff, 'eligible_sessions': len(eligible), 'eligible_users': len(all_times),
        'insufficient_card_sessions': insufficient,
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
            'warmup_messages': sum(len(s.get('warmup', [])) for s in streams),
            'project_scopes': {scope: {'streams': sum(s.get('project_scope', 'unknown') == scope for s in streams),
                'messages': sum(len(s['turns']) for s in streams if s.get('project_scope', 'unknown') == scope)}
                for scope in ('same_project', 'cross_project', 'unknown')},
            'topic_counts': dict(Counter(len(s['threads']) for s in streams)),
            'start_utc': min((t['at'] for t in turns), default=None), 'end_utc': max((t['at'] for t in turns), default=None)}