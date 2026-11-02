"""Offline, conservative redaction. Counters never retain matched values."""
from collections import Counter
import re

PLACEHOLDER = re.compile(r'\[(?:KEY|BEARER|JWT|HEX|BASE64|CREDENTIAL|EMAIL|PHONE|PRIVATE_KEY|URL_AUTH):[^\]]+\]')


def bucket(length):
    for bound in (16, 32, 64, 128, 256, 1024):
        if length < bound:
            return f'lt{bound}'
    return 'ge1024'


class Redactor:
    """Sanitize whole strings before any excerpt is taken or any data is written."""
    def __init__(self):
        self.counts = Counter()
        self.rules = [
            ('private_key', re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)', re.S)),
            ('bearer', re.compile(r'\bBearer\s+[A-Za-z0-9._~+/-]+=*', re.I)),
            ('key', re.compile(r'(?<![\w])(?:oc_sk_|sk-ant-|sk-|ghp_|gho_|github_pat_|xox[abpr]-)[A-Za-z0-9_-]{8,}')),
            ('key', re.compile(r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b')),
            ('jwt', re.compile(r'\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b')),
            ('url_auth', re.compile(r'(?<=://)[^\s/@]+:[^\s/@]+@')),
            ('email', re.compile(r'(?<![\w.+-])[A-Za-z0-9.!#$%&\x27*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+')),
            ('phone', re.compile(r'(?<!\d)(?:\+?86[- ]?)?1[3-9]\d[- ]?\d{4}[- ]?\d{4}(?!\d)')),
            ('phone', re.compile(r'(?<!\w)\+\d{1,3}[ -]?(?:\(\d{2,4}\)|\d{2,4})[ -]?\d{3,4}[ -]?\d{3,4}(?!\d)')),
            ('phone', re.compile(r'(?<!\d)\(\d{3}\)[ -]?\d{3}[ -]\d{4}(?!\d)')),
            ('phone', re.compile(r'(?<!\d)\d{3}-\d{3}-\d{4}(?!\d)')),
            ('hex', re.compile(r'(?<![A-Za-z0-9])[A-Fa-f0-9]{32,}(?![A-Za-z0-9])')),
            ('base64', re.compile(r'(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{40,}={0,2}(?![A-Za-z0-9+/_-])')),
        ]
        self.assignment = re.compile(
            r'(?P<head>(?:[\x27\"]?)(?:password|passwd|pwd|(?:api[_-]?)?key|(?:access[_-]|refresh[_-]|auth[_-])?token|secret|client_secret|authorization|\u5bc6\u7801|\u53e3\u4ee4|\u5bc6\u94a5)(?:[\x27\"]?)\s*(?:=|:|\uff1a|\u4e3a|\u662f)\s*)'
            r'(?P<value>\"[^\"\n]*\"|\x27[^\x27\n]*\x27|[^\s,;&<>\}\]]+)', re.I)
        self.home = re.compile(r'(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s\x27\"<>]+|/(?:home|Users)/[^/\s\x27\"<>]+)', re.I)

    def redact(self, value):
        if not isinstance(value, str):
            raise TypeError('Redactor accepts text only')
        # Hide existing placeholders to make repeated checks idempotent. The
        # sentinels deliberately cannot look like long credentials.
        saved = []
        def protect(match):
            saved.append(match.group())
            return '\u0001' + str(len(saved) - 1) + '\u0002'
        text = PLACEHOLDER.sub(protect, value)
        def replace(kind, raw):
            self.counts[kind] += 1
            saved.append(f'[{kind.upper()}:{bucket(len(raw))}]')
            return '\u0001' + str(len(saved) - 1) + '\u0002'
        for kind, pattern in self.rules[:5]:
            text = pattern.sub(lambda m, k=kind: replace(k, m.group()), text)
        def assignment(match):
            raw = match['value']
            if '\u0001' in raw or raw.startswith('['):
                return match.group()
            return match['head'] + replace('credential', raw)
        text = self.assignment.sub(assignment, text)
        for kind, pattern in self.rules[5:]:
            text = pattern.sub(lambda m, k=kind: replace(k, m.group()), text)
        def home(_):
            self.counts['home'] += 1
            return '~'
        text = self.home.sub(home, text)
        return re.sub('\u0001(\\d+)\u0002', lambda m: saved[int(m[1])], text)

    def summary(self, value, limit=200):
        return self.redact(value)[:limit]