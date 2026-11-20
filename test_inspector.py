import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from inspect_buildfile import inspect_bytes, html_report, main, MAX_BYTES

def inspect(text):
    return inspect_bytes(text.encode())

class InspectionTests(unittest.TestCase):
    def test_global_and_file_scope_do_not_leak(self):
        r = inspect("[uid=8 perms=0550]\n[uid=2] first=a\nsecond=b\n")
        a, b = r["entries"]
        self.assertEqual(a["effective_declared_attributes"]["uid"], {"value":"2","line":2,"conditional":False})
        self.assertEqual(b["effective_declared_attributes"]["uid"]["value"], "8")
        self.assertEqual(b["effective_declared_attributes"]["perms"]["line"], 1)

    def test_conditional_attributes_keep_explicit_state(self):
        r = inspect("[-optional]\n[?+optional ?uid=7]\nfile\n")
        a = r["entries"][0]["effective_declared_attributes"]
        self.assertIs(a["optional"]["value"], False)
        self.assertEqual(a["uid"]["value"], "7")
        self.assertEqual(a["optional"]["line"], 1)

    def test_inline_config_headers_are_not_attributes(self):
        r = inspect("[uid=4]\n[perms=0444] x={\n[buscfg]\n# retained data\nA=B\n}\nnext\n")
        a, b = r["entries"]
        self.assertEqual((a["kind"], a["line"], a["end_line"], a["inline_body_lines"]), ("inline_data",2,6,3))
        self.assertNotIn("buscfg", b["effective_declared_attributes"])
        self.assertNotIn("perms", b["effective_declared_attributes"])
        self.assertTrue(r["inspection_complete"])

    def test_boot_and_script_content_do_not_mutate_global_state(self):
        r = inspect("[perms=0555]\n[virtual=x86_64,bios] boot={\n[perms=0700] procnto\n}\n[+script] s={\n[uid=0] never-execute\n}\napp\n")
        self.assertEqual([e["kind"] for e in r["entries"]], ["inline_bootstrap","inline_script","external_reference"])
        self.assertEqual(r["entries"][-1]["effective_declared_attributes"]["perms"]["value"], "0555")
        self.assertNotIn("uid", r["entries"][-1]["effective_declared_attributes"])

    def test_unimplemented_physical_mode_stops_before_misclassifying_content(self):
        for declaration in (
            "[physical=raw] boot={",
            "[physical=raw +script] boot={",
            "[physical=raw virtual=x86_64,bios] boot={",
            "[physical=raw]",
        ):
            with self.subTest(declaration=declaration):
                r = inspect("[uid=4]\nknown=file\n" + declaration +
                            "\n[uid=99] opaque-content\n}\nafter=file\n")
                self.assertFalse(r["inspection_complete"])
                self.assertEqual([e["target_expression"] for e in r["entries"]], ["known"])
                self.assertEqual(r["diagnostics"][0]["line"], 3)
                self.assertIn("not implemented", r["diagnostics"][0]["message"])
                self.assertEqual(r["final_declared_attributes"]["uid"]["value"], "4")
                self.assertNotIn("physical", r["final_declared_attributes"])

    def test_escaped_inline_brace_and_hash_preserved(self):
        r = inspect("f={\n\\} # data\n}\nx\n")
        self.assertTrue(r["inspection_complete"])
        self.assertEqual(r["entries"][0]["inline_body_lines"], 1)

    def test_unclosed_inline_is_partial(self):
        r = inspect("f={\nx\n")
        self.assertFalse(r["inspection_complete"])
        self.assertFalse(r["entries"][0]["inline_complete"])

    def test_unsupported_syntax_stops_without_cascading_claims(self):
        for text in ("[uid=1][gid=2] a\nb\n", "a \\\nb\n", '"unterminated\nb\n'):
            with self.subTest(text=text):
                r = inspect(text)
                self.assertFalse(r["inspection_complete"])
                self.assertEqual(r["entries"], [])

    def test_include_does_not_open_any_file(self):
        with patch("builtins.open", side_effect=AssertionError("No external reads")):
            r = inspect("[+include] /private/unknown.build\n[uid=9]\na\n")
        self.assertFalse(r["inspection_complete"])
        self.assertEqual(r["entries"], [])
        self.assertEqual(r["final_declared_attributes"], {})

    def test_filter_variable_and_shell_text_are_never_evaluated(self):
        r = inspect('[filter="touch /tmp/DO-NOT-CREATE"] x=$PRIVATE_TOKEN\n')
        self.assertEqual(r["entries"][0]["host_expression"], "$PRIVATE_TOKEN")
        self.assertEqual(r["entries"][0]["effective_declared_attributes"]["filter"]["value"], "touch /tmp/DO-NOT-CREATE")
        self.assertEqual(r["entries"][0]["filesystem_resolution"], "not performed")

    def test_quoted_spaces_and_hash(self):
        r = inspect('[uid=4] "a # b" = "host file" # outside\n')
        self.assertEqual(r["entries"][0]["target_expression"], "a # b")
        self.assertEqual(r["entries"][0]["host_expression"], "host file")

    def test_link_target_is_not_host_file(self):
        r = inspect("[type=link] alias=program\n")
        e = r["entries"][0]
        self.assertEqual(e["kind"], "symlink")
        self.assertIsNone(e["host_expression"])
        self.assertEqual(e["link_expression"], "program")

    def test_repeated_targets_keep_provenance_without_picking_winner(self):
        r = inspect("[+dupignore]\nx=a\n[-dupignore] x=b\n[prefix=elsewhere] x=c\n")
        group = r["repeated_literal_targets"][0]
        self.assertEqual(group["lines"], [2,3])
        self.assertEqual([x["value"] for x in group["dupignore_declarations"]], [True,False])
        self.assertNotIn("winner", group)

    def test_unresolved_variables_not_grouped_as_path_collision(self):
        r = inspect("$OUT=a\n$OUT=b\n")
        self.assertEqual(r["repeated_literal_targets"], [])

    def test_size_lines_and_encoding_limits(self):
        for data in (b"x"*(MAX_BYTES+1), b"x\n"*10001, b"\xff"):
            with self.subTest(size=len(data)):
                with self.assertRaises((ValueError,UnicodeError)):
                    inspect_bytes(data)

    def test_html_escapes_hostile_names_and_has_no_active_content(self):
        r = inspect('"<img src=x onerror=alert(1)>" = h\n')
        h = html_report(r)
        self.assertIn("&lt;img", h)
        self.assertNotIn("<img", h)
        self.assertNotIn("<script", h.lower())
        self.assertIn("default-src 'none'", h)

    def test_inherited_attribute_growth_is_bounded(self):
        for text in ("".join(f"[key{i}=value]\n" for i in range(81)), "[search=" + "x"*8193 + "]\nfile\n"):
            with self.subTest(size=len(text)):
                r = inspect(text)
                self.assertFalse(r["inspection_complete"])
                self.assertIn("state limit", r["diagnostics"][0]["message"])
                self.assertLessEqual(len(r["final_declared_attributes"]), 80)

    def test_record_growth_is_bounded(self):
        r = inspect("file\n" * 2001)
        self.assertEqual(len(r["entries"]), 2000)
        self.assertFalse(r["inspection_complete"])
        self.assertIn("Record limit", r["diagnostics"][0]["message"])

    def test_cli_writes_real_reports_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            d = Path(directory); source=d/"case.build"; dest=d/"report.json"; html=d/"report.html"
            source.write_text("[uid=4]\nf=blob\n")
            self.assertEqual(main([str(source),"--json",str(dest),"--html",str(html)]), 0)
            before = dest.read_bytes()
            self.assertEqual(json.loads(before)["summary"]["entries"], 1)
            self.assertTrue(html.is_file())
            self.assertEqual(main([str(source),"--json",str(dest)]), 2)
            self.assertEqual(dest.read_bytes(), before)

if __name__ == "__main__":
    unittest.main()
