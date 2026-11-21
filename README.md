# QNX Buildfile Scope Inspector

Read a QNX buildfile as text and inspect which declared attributes reach each top-level file entry. Every attribute carries its source line. Inline data, bootstrap and script blocks stay opaque, so their configuration headers or commands cannot accidentally change the outer attribute state.

This original, AI-assisted host-tool prototype has not been registered, submitted or reviewed by the QNX competition. It does not contain the SDK or an OS image.

## Run

Python 3.11 or newer, standard library only. No install or service. Try the included original synthetic example:

```sh
python3 inspect_buildfile.py examples/scope.build --json new-report.json
```

The input contains placeholder paths and commands, so it is not a runnable QNX image. The inspector reads only the buildfile text. Its [actual saved output](examples/scope.report.json) contains 10 entries, 2 opaque inline blocks and 1 repeated-target group. The [example receipt](validation/example-receipt.json) records the real invocation, code/input/output hashes and independently specified expectations.

| Input feature | Observed result |
| --- | --- |
| Config has local `perms=0444` | The next file retains global `perms=0555`. |
| Script has local `uid=0`; its opaque body contains `uid=99` | The following file retains global `uid=7`. |
| Three `repeated` targets, one under a different prefix | Only lines 19 and 20 are grouped; no output-image collision or winning file is inferred. |
| Quoted `#`, a symbolic link and a variable expression | Literal text and declarations are retained without environment or file resolution. |

For your own buildfile and optional HTML output, replace `your.build` with your input path. You can also run the local test suite:

```sh
python3 inspect_buildfile.py your.build --json another-report.json --html new-report.html
python3 -m unittest -v test_inspector
```

Outputs must be new files. A completed inspection exits 0; unsupported syntax, partial input, input limits or I/O failures exit 2. Exit 0 is not a QNX compiler success. Open the HTML file locally; it contains no JavaScript, remote assets or network requests.

## Scope

The inspector handles literal/quoted references, a single attribute group, conditional declarations, top-level global versus file-specific attributes, opaque multiline inline files, and symbolic-link declarations. Repeated explicit target spellings are grouped with their declared prefix/mount context and dupignore provenance; no final image path or winning file is asserted.

Includes and header backslash escapes/continuations stop inspection. The `physical` attribute also stops inspection: QNX 8 documents it as not implemented, so the inspector does not classify its contents as data, script or a usable bootstrap. Variables are retained without reading the environment. Host files, directory imports, filters, links and commands are never followed or executed. Unknown attribute names are retained as declarations, not validated. Limits are 1 MiB, 10,000 input lines, 2,000 records, 80 distinct declared attributes and 8,192 inherited attribute characters.

A report does not establish full grammar compliance, binary availability, image construction, bootability, deadlock diagnosis, security, performance or contest eligibility. QNX mkifs comparison has not been run; the official utility requires an appropriate license.

## Evidence and provenance

New synthetic tests exercise scope isolation, opaque data, partial/unsupported syntax, absent external reads, path uncertainty, HTML escaping and refusal to overwrite. They are local parser tests, not QNX tests or model calls.

Version 0.1.1 passed 19 local tests on November 21, 2026 (Beijing). This includes one regression test covering four `physical` declaration forms; it is not 19 additional tests. The [validation receipt](validation/receipt.json) pins the tested code and test-file hashes, and the [actual test output](validation/tests-0.1.1.txt) is included. These are local results, not a GitHub CI run or independent review. The HTML report has static escaping checks; its visual layout has not been verified.

A separate historical version 0.1.0 receipt records a read-only run on an external author's pinned QNX 8 recipe, with manual line-based expectations: 88 entries, 6 global directives and 4 inline blocks. That external input was not rerun for 0.1.1. The recipe is authored by Deniz Eren, carries GPL-3.0-or-later in its header, and is not bundled in this source directory. No OS binaries or scripts referenced by that recipe were downloaded or executed. Any later redistribution of that source requires its attribution/license obligations to be handled separately.

Primary technical references:
- [QNX 8 buildfile syntax](https://qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.building/topic/buildfiles/buildfile_syntax.html)
- [QNX 8 mkifs](https://qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.utilities/topic/m/mkifs.html)
- [QNX 8 script files](https://qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.building/topic/buildfiles/nto_script.html)
- [Pinned external recipe](https://github.com/Deniz-Eren/workspace/blob/d71f233ffffec0db977fcbf0ba650e61de6e777b/emulation/qnx800/image/parts/ifs.build)

Original implementation: MIT. The external recipe is not covered by this project's license. No claim of QNX affiliation, official validation or third-party endorsement.
