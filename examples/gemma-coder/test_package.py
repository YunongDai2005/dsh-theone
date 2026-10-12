import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("package_agent", Path(__file__).with_name("package_agent.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackagingTests(unittest.TestCase):
    def test_allowlist_preserves_agent_and_omits_unrelated_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in module.FILES:
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text("frozen agent content")
            (root / "private-trace.json").write_text("must not be packaged")
            first = module.package_agent(root, root / "first.zip")
            second = module.package_agent(root, root / "second.zip")
            self.assertEqual(first, second)
            with zipfile.ZipFile(root / "first.zip") as archive:
                self.assertEqual(set(archive.namelist()), set(module.FILES))
                self.assertEqual(archive.read("agent.yaml"), b"frozen agent content")

    def test_rejects_file_symlink_outside_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "agent"
            source.mkdir()
            (root / "outside.yaml").write_text("private")
            (source / "agent.yaml").symlink_to(root / "outside.yaml")
            with self.assertRaises(ValueError):
                module.package_agent(source, root / "rejected.zip")

    def test_rejects_parent_symlink_outside_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "agent"
            source.mkdir()
            (source / "agent.yaml").write_text("agent")
            outside = root / "private-configs"
            outside.mkdir()
            (outside / "sampling.yaml").write_text("private")
            (source / "configs").symlink_to(outside, target_is_directory=True)
            with self.assertRaises(ValueError):
                module.package_agent(source, root / "rejected.zip")


if __name__ == "__main__":
    unittest.main()
