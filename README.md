# QNX Buildfile Scope Inspector — local prototype

Read a QNX buildfile as text and inspect which declared attributes reach each top-level file entry. Every attribute carries its source line. Inline data, bootstrap and script blocks stay opaque, so their configuration headers or commands cannot accidentally change the outer attribute state.

This original, AI-assisted prototype is private and has not been registered, submitted or reviewed by the QNX competition. It does not contain the SDK or an OS image.

## Run

Python 3.11 or newer, standard library only. No install or service.

```sh
python3 inspect_buildfile.py sample.build --json new-report.json --html new-report.html
python3 -m unittest -v test_inspector
```

Outputs must be new files. A completed inspection exits 0; unsupported syntax, partial input, input limits or I/O failures exit 2. Exit 0 is not a QNX compiler success. Open the HTML file locally; it contains no JavaScript, remote assets or network requests.

## Scope

The inspector handles literal/quoted references, a single attribute group, conditional declarations, top-level global versus file-specific attributes, opaque multiline inline files, and symbolic-link declarations. Repeated explicit target spellings are grouped with their declared prefix/mount context and dupignore provenance; no final image path or winning file is asserted.

Includes and header backslash escapes/continuations stop inspection. The `physical` attribute also stops inspection: QNX 8 documents it as not implemented, so the inspector does not classify its contents as data, script or a usable bootstrap. Variables are retained without reading the environment. Host files, directory imports, filters, links and commands are never followed or executed. Unknown attribute names are retained as declarations, not validated. Limits are 1 MiB, 10,000 input lines, 2,000 records, 80 distinct declared attributes and 8,192 inherited attribute characters.

A report does not establish full grammar compliance, binary availability, image construction, bootability, deadlock diagnosis, security, performance or contest eligibility. QNX mkifs comparison has not been run; the official utility requires an appropriate license.

## Evidence and provenance

New synthetic tests exercise scope isolation, opaque data, partial/unsupported syntax, absent external reads, path uncertainty, HTML escaping and refusal to overwrite. They are local parser tests, not QNX tests or model calls.

The separate private evidence receipt records a read-only run on an external author's pinned QNX 8 recipe, with manual line-based expectations. The recipe is authored by Deniz Eren, carries GPL-3.0-or-later in its header, and is not bundled in this source directory. No OS binaries or original project scripts are downloaded or executed. Any later redistribution of that source requires its attribution/license obligations to be handled separately.

Primary technical references:
- [QNX 8 buildfile syntax](https://qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.building/topic/buildfiles/buildfile_syntax.html)
- [QNX 8 mkifs](https://qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.utilities/topic/m/mkifs.html)
- [QNX 8 script files](https://qnx.com/developers/docs/8.0/com.qnx.doc.neutrino.building/topic/buildfiles/nto_script.html)
- [Pinned external recipe](https://github.com/Deniz-Eren/workspace/blob/d71f233ffffec0db977fcbf0ba650e61de6e777b/emulation/qnx800/image/parts/ifs.build)

Original implementation: MIT. The external recipe is not covered by this project's license. No claim of QNX affiliation, official validation or third-party endorsement.
