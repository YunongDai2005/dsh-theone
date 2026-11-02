"""Remove recognizable host Markdown scaffolding, retaining sanitized file hints."""
import re

HEADING = re.compile(r'^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$')
REQUEST = re.compile(r'^(?:my request(?: for (?:codex|claude))?|user (?:request|message))\s*:?$', re.I)
AUTO = {'files mentioned by the user': 'files_mentioned', 'attached files': 'files_mentioned',
        'context from my ide setup': 'ide_context'}


def file_hint(line, redactor):
    heading = HEADING.match(line)
    value = heading[2] if heading else re.sub(r'^\s*[-*]\s+', '', line).strip()
    link = re.search(r'\[([^\]]+)\]\(([^\n]+)\)', value)
    if link:
        value = link[1] if re.search(r'\.[a-z0-9]{1,12}$', link[1], re.I) else link[2]
    else:
        value = re.sub(r'^(?:active file|file)\s*:\s*', '', value, flags=re.I)
        value = value.split(' (', 1)[0].split(': ', 1)[0].strip('`"\' ')
    value = re.sub(r':\d+(?::\d+)?$', '', value)
    if not re.search(r'\.[a-z0-9]{1,12}$', value, re.I): return None
    # Only a file heading, list item, link or standalone path is structural.
    if not (heading or link or re.match(r'^\s*[-*]\s+', line) or re.match(r'^(?:[A-Za-z]:[/\\]|/|~[/\\])', value)):
        return None
    name = value.replace('\\', '/').rsplit('/', 1)[-1]
    if not name: return None
    return redactor.redact(name)[:100] if redactor is not None else '[file]'


def strip_automatic(text, redactor, stats=None):
    lines, output, names = text.splitlines(), [], []
    i, removed, fence = 0, 0, None
    while i < len(lines):
        marker = re.match(r'^\s{0,3}(`{3,}|~{3,})', lines[i])
        if marker:
            if fence is None: fence = marker[1]
            elif marker[1][0] == fence[0] and len(marker[1]) >= len(fence): fence = None
            output.append(lines[i])
            i += 1
            continue
        if fence is not None:
            output.append(lines[i])
            i += 1
            continue
        heading = HEADING.match(lines[i])
        category = AUTO.get(heading[2].rstrip(':').strip().lower()) if heading else None
        if not category:
            output.append(lines[i])
            i += 1
            continue
        start, end, request = i + 1, i + 1, False
        # Canonical host blocks terminate at the request marker. Do not swallow
        # unrelated Markdown sections at the same or higher heading level.
        for j in range(start, len(lines)):
            h = HEADING.match(lines[j])
            if h and REQUEST.fullmatch(h[2]):
                end, request = j + 1, True
                break
            if h and len(h[1]) <= len(heading[1]): break
        if not request:
            # Without an explicit marker, consume only file-list structure.
            # An unheaded human paragraph is retained, even after a blank line.
            while end < len(lines):
                line = lines[end]
                h = HEADING.match(line)
                structural = file_hint(line, redactor) or (h and re.match(r'^(?:active file|open tabs)\s*:', h[2], re.I))
                if line.strip() and not structural: break
                end += 1
        for line in lines[start:end - int(request)]:
            hint = file_hint(line, redactor)
            if hint: names.append(hint)
        removed += 1
        if stats is not None:
            stats['auto_blocks:' + category] += 1
            stats['auto_request_markers'] += int(request)
        i = end
    if removed and stats is not None: stats['auto_block_users'] += 1
    return '\n'.join(output).strip(), list(dict.fromkeys(names))
