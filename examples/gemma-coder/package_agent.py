"""Package only the frozen declarative agent files, without data or traces."""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

FILES = ("agent.yaml", "configs/sampling.yaml", "eval_config.yaml", "prompts/task.md")


def package_agent(source: Path, output: Path) -> dict:
    source = source.resolve()
    contents = {}
    for name in FILES:
        path = source / name
        if path.is_symlink() or not path.resolve().is_relative_to(source):
            raise ValueError("Agent files must stay within the source directory")
        contents[name] = path.read_bytes()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in contents.items():
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    return {"files": {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()},
            "archive_sha256": hashlib.sha256(output.read_bytes()).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(package_agent(Path(__file__).parent, args.output), indent=2))
