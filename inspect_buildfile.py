"""Local, non-executing QNX buildfile scope inspector; deliberately not mkifs."""
from __future__ import annotations
import argparse
import copy
import hashlib
import html
import json
import re
import sys
from pathlib import Path

VERSION = "0.1.3"
MAX_BYTES = 1024 * 1024
MAX_LINES = 10000
MAX_RECORDS = 2000
MAX_ATTRIBUTES = 80
MAX_STATE_CHARS = 8192
LIMITS = [
    "Declaration inspection only; not QNX compiler validation or proof an image boots.",
    "No host-file lookup, include loading, environment expansion, scripts, filters or commands.",
    "Attribute provenance records explicit declarations, not all mkifs defaults or side effects.",
    "Repeated targets cover literal explicit targets only; emitted paths and directory contents are unresolved.",
    "Backslash escapes/continuations outside inline data and include processing stop inspection.",
    "The physical attribute stops inspection: QNX 8 documents it as not implemented; no boot mode is inferred.",
    "Inline contents are opaque; script/bootstrap semantics and executable availability are not validated.",
    "Input lines use LF, CRLF or CR; other Unicode/control separators do not start declarations.",
    "Inline hashes join opaque body lines with LF and omit the final line ending; they are not emitted-file hashes.",
    "Inspection stops at 2,000 records, 80 distinct declared attributes, or 8,192 inherited attribute characters.",
]

class Unsupported(ValueError):
    pass

def comment_free(line: str) -> str:
    quoted = False
    for i, char in enumerate(line):
        if char == '"':
            quoted = not quoted
        if char == "#" and not quoted and (i == 0 or line[i - 1].isspace()):
            return line[:i]
    return line

def tokens(value: str) -> list[str]:
    """Tokenize spaces outside double quotes. Escapes deliberately unsupported."""
    if "\\" in value:
        raise Unsupported("Backslash escape or continuation outside inline data")
    out, buf, quoted = [], [], False
    for char in value:
        if char == '"':
            quoted = not quoted
        elif char.isspace() and not quoted:
            if buf:
                out.append("".join(buf))
                buf = []
        else:
            buf.append(char)
    if quoted:
        raise Unsupported("Unclosed quoted text")
    if buf:
        out.append("".join(buf))
    return out

def separate_attributes(line: str) -> tuple[str, str]:
    if not line.startswith("["):
        return "", line
    quoted = False
    for i, char in enumerate(line[1:], 1):
        if char == '"':
            quoted = not quoted
        if char == "]" and not quoted:
            rest = line[i + 1:].strip()
            if rest.startswith("["):
                raise Unsupported("Multiple attribute groups on one declaration")
            return line[1:i], rest
    raise Unsupported("Unclosed attribute group")

def attributes(value: str, line: int) -> list[tuple[str, dict]]:
    result = []
    for token in tokens(value):
        conditional = token.startswith("?")
        if conditional:
            token = token[1:]
        if token.startswith(("+", "-")):
            key, val = token[1:], token[0] == "+"
        elif "=" in token:
            key, val = token.split("=", 1)
        else:
            raise Unsupported("Attribute without a boolean sign or equals sign")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise Unsupported("Unsupported attribute name")
        result.append((key, {"value": val, "line": line, "conditional": conditional}))
    return result

def apply_attributes(state: dict, changes: list[tuple[str, dict]]) -> dict:
    result = copy.deepcopy(state)
    for key, value in changes:
        if not value["conditional"] or key not in result:
            result[key] = value
    return result

def separate_file(spec: str) -> tuple[str, str | None]:
    quoted = False
    for i, char in enumerate(spec):
        if char == '"':
            quoted = not quoted
        if char == "=" and not quoted:
            return spec[:i].strip(), spec[i + 1:].strip()
    return spec.strip(), None

def one_token(text: str) -> str:
    words = tokens(text)
    if len(words) != 1:
        raise Unsupported("Expected one literal or quoted file reference")
    return words[0]

def unescaped_closing_brace(text: str) -> bool:
    escaped = False
    for char in text:
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "}":
            return True
    return False

def inspect_bytes(data: bytes, label: str = "<input>") -> dict:
    if len(data) > MAX_BYTES:
        raise ValueError("Input exceeds 1 MiB")
    source = data.decode("utf-8")
    # str.splitlines() also splits Unicode/control separators. That can turn
    # comment text into declarations and rewrite supposedly opaque inline data.
    # Use universal newline boundaries only, retaining empty input/EOF counts.
    lines = re.split(r"\r\n|\r|\n", source) if source else []
    if source.endswith(("\n", "\r")):
        lines.pop()
    if len(lines) > MAX_LINES:
        raise ValueError("Input exceeds 10,000 lines")
    report = {
        "tool": "QNX Buildfile Scope Inspector", "version": VERSION,
        "source": label, "source_sha256": hashlib.sha256(data).hexdigest(),
        "input_lines": len(lines), "inspection_complete": True,
        "qnx_validation_performed": False, "limits": LIMITS,
        "directives": [], "entries": [], "diagnostics": [],
    }
    state, inline, body, stop = {}, None, [], False

    def issue(line: int, message: str) -> None:
        report["inspection_complete"] = False
        report["diagnostics"].append({
            "line": line, "code": "INSPECTION_STOPPED",
            "message": message + "; subsequent declarations not interpreted. This is not a QNX compiler verdict."
        })

    for number, raw in enumerate(lines, 1):
        if inline is not None:
            if raw.strip() == "}":
                inline["end_line"] = number
                inline["inline_body_lines"] = len(body)
                inline["inline_body_sha256"] = hashlib.sha256("\n".join(body).encode()).hexdigest()
                inline["inline_complete"] = True
                report["entries"].append(inline)
                inline, body = None, []
            elif unescaped_closing_brace(raw):
                issue(number, "Non-standalone unescaped closing brace in inline data")
                stop = True
                break
            else:
                body.append(raw)
            continue
        line = comment_free(raw).strip()
        if not line:
            continue
        try:
            if "\\" in line:
                raise Unsupported("Backslash escape or continuation outside inline data")
            attr_text, spec = separate_attributes(line)
            changes = attributes(attr_text, number)
            effective = apply_attributes(state, changes)
            if "physical" in effective:
                raise Unsupported("QNX 8 documents the physical attribute as not implemented; no boot mode inferred")
            if len(report["entries"]) + len(report["directives"]) >= MAX_RECORDS:
                raise Unsupported("Record limit reached")
            if len(effective) > MAX_ATTRIBUTES or sum(len(k) + len(str(v["value"])) for k, v in effective.items()) > MAX_STATE_CHARS:
                raise Unsupported("Declared attribute state limit reached")
            if not spec:
                state = effective
                report["directives"].append({
                    "line": number, "changes": dict(changes),
                    "effective_declared_attributes": copy.deepcopy(state),
                })
                continue
            if effective.get("include", {}).get("value") is True:
                raise Unsupported("Include requires external content; no file is opened")
            left, right = separate_file(spec)
            left = one_token(left)
            if right is not None and not right:
                raise Unsupported("Empty right side in file declaration")
            entry = {
                "line": number, "end_line": number,
                "declaration": spec, "target_expression": left if right is not None else None,
                "host_expression": left if right is None else right,
                "effective_declared_attributes": effective,
                "filesystem_resolution": "not performed",
            }
            if right == "{":
                is_script = effective.get("script", {}).get("value") is True
                is_boot = "virtual" in effective
                entry["kind"] = ("inline_ambiguous" if is_script and is_boot else
                                 "inline_script" if is_script else
                                 "inline_bootstrap" if is_boot else "inline_data")
                entry["host_expression"] = None
                entry["inline_complete"] = False
                inline, body = entry, []
                continue
            if right is not None:
                entry["host_expression"] = one_token(right)
                if "{" in right and "$" not in right:
                    raise Unsupported("Inline opening brace must occupy its own content boundary")
            declared_type = effective.get("type", {}).get("value", "file")
            if declared_type == "link":
                entry["kind"] = "symlink"
                entry["link_expression"] = entry["host_expression"]
                entry["host_expression"] = None
            else:
                entry["kind"] = "external_reference" if declared_type == "file" else "declared_" + str(declared_type)
            report["entries"].append(entry)
        except Unsupported as exc:
            issue(number, str(exc))
            stop = True
            break
    if inline is not None:
        if not stop:
            issue(inline["line"], "Unterminated inline block")
        inline["inline_body_lines"] = len(body)
        inline["inline_body_sha256"] = hashlib.sha256("\n".join(body).encode()).hexdigest()
        report["entries"].append(inline)
    report["final_declared_attributes"] = state
    groups = {}
    for entry in report["entries"]:
        target = entry["target_expression"]
        attrs = entry["effective_declared_attributes"]
        if target is None or any(c in target for c in "$\\"):
            continue
        # Absence is not a string value: a literal prefix/mount can itself be
        # "<implicit>". JSON null preserves that distinction in the report.
        context = tuple(str(attrs[k]["value"]) if k in attrs else None for k in ("prefix", "mount"))
        if any(c is not None and ("$" in c or "\\" in c) for c in context):
            continue
        groups.setdefault((target, context), []).append(entry)
    report["repeated_literal_targets"] = [
        {"target_expression": target, "prefix_mount_context": context,
         "lines": [e["line"] for e in entries],
         "dupignore_declarations": [
             e["effective_declared_attributes"].get("dupignore", {"value": False, "line": None})
             for e in entries],
         "meaning": "Repeated declared spelling/context; no emitted-path collision or winner is asserted."}
        for (target, context), entries in groups.items() if len(entries) > 1
    ]
    report["summary"] = {
        "entries": len(report["entries"]), "global_directives": len(report["directives"]),
        "inline_blocks": sum(e["kind"].startswith("inline_") for e in report["entries"]),
        "repeated_literal_groups": len(report["repeated_literal_targets"]),
        "stop_diagnostics": len(report["diagnostics"]),
    }
    return report

def html_report(report: dict) -> str:
    esc = lambda x: html.escape(str(x), quote=True)
    rows = []
    for e in report["entries"]:
        attrs = "; ".join(
            f"{k}={v['value']} (line {v['line']})"
            for k, v in e["effective_declared_attributes"].items())
        rows.append("<tr><td>" + esc(e["line"]) + "–" + esc(e["end_line"]) +
                    "</td><td>" + esc(e["kind"]) + "</td><td><code>" +
                    esc(e["declaration"]) + "</code></td><td>" + esc(attrs) + "</td></tr>")
    diagnostics = "".join("<li>" + esc(d["message"]) + " (line " +
                          esc(d["line"]) + ")</li>" for d in report["diagnostics"])
    limits = "".join("<li>" + esc(x) + "</li>" for x in report["limits"])
    return """<!doctype html><html lang="en"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QNX buildfile declarations</title><style>
body{font:16px system-ui;max-width:1400px;margin:2rem auto;padding:0 1rem;color:#17313d;background:#f8faf9}
h1{line-height:1.2}code{white-space:pre-wrap;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;font-size:14px;background:white}
td,th{padding:.7rem;border:1px solid #bcc9ce;vertical-align:top;text-align:left}
td:last-child{min-width:250px}p,li{line-height:1.5}.scroll{overflow:auto}
</style><h1>Buildfile declaration map</h1><p>""" + esc(report["source"]) + """</p><p>
Status: """ + ("Inspection complete for supported subset" if report["inspection_complete"] else "Partial inspection — stopped") + """.
QNX compiler/image validation: not performed.</p><p>SHA-256: <code>""" + esc(report["source_sha256"]) + """</code></p>
<details open><summary>What this report can and cannot show</summary><ul>""" + limits + """</ul></details>
<ul>""" + diagnostics + """</ul><div class="scroll"><table><thead><tr><th>Lines</th><th>Kind</th><th>Declaration</th><th>Declared attributes and provenance</th></tr></thead><tbody>""" + "".join(rows) + """</tbody></table></div></html>"""

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--json", type=Path, help="Write JSON to a NEW file; otherwise stdout")
    parser.add_argument("--html", type=Path, help="Write a self-contained report to a NEW file")
    args = parser.parse_args(argv)
    try:
        with args.input.open("rb") as stream:
            data = stream.read(MAX_BYTES + 1)
        report = inspect_bytes(data, args.input.name)
        outputs = [p for p in (args.json, args.html) if p]
        if len({str(p.absolute()) for p in outputs}) != len(outputs):
            raise ValueError("Output paths must differ")
        if any(p.exists() or p.is_symlink() for p in outputs):
            raise ValueError("Refusing to overwrite an existing output")
        if args.json:
            with args.json.open("x", encoding="utf-8") as stream:
                json.dump(report, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
        else:
            print(json.dumps(report, ensure_ascii=False, indent=2))
        if args.html:
            with args.html.open("x", encoding="utf-8") as stream:
                stream.write(html_report(report))
        return 0 if report["inspection_complete"] else 2
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"Inspection failed: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
