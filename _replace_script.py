import os
import pathlib


def resolve_repo_root() -> pathlib.Path:
    script_dir = pathlib.Path(__file__).resolve().parent
    candidates: list[pathlib.Path] = []
    env_dir = os.environ.get("NEXORA_DIR")

    if env_dir:
        candidates.append(pathlib.Path(env_dir).expanduser())

    candidates.extend([
        script_dir,
        pathlib.Path.cwd(),
    ])

    tried: list[str] = []
    for candidate in candidates:
        repo_root = candidate.resolve()
        tried.append(str(repo_root))
        if (repo_root / "server" / "providers" / "abacus.ts").is_file():
            return repo_root

    raise FileNotFoundError(
        "Could not locate the Nexora repository root. "
        "Set NEXORA_DIR to the repo root or run this script from the repo. "
        f"Tried: {', '.join(tried)}"
    )


def read_required_text(path: pathlib.Path, label: str) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"{label} not found: {path}")
    return path.read_text(encoding="utf-8")


repo_root = resolve_repo_root()
fp = repo_root / "server" / "providers" / "abacus.ts"
content = read_required_text(fp, "Abacus provider file")

start_marker = "// Static model list"
end_marker = "];"
try:
    start_idx = content.index(start_marker)
except ValueError:
    raise ValueError(f"Start marker not found: {start_marker!r}")
try:
    end_idx = content.index(end_marker, start_idx) + len(end_marker)
except ValueError:
    raise ValueError(f"End marker not found after position {start_idx}: {end_marker!r}")

replacement_path = repo_root / "_replacement.txt"
replacement = read_required_text(replacement_path, "Replacement file")

new_content = content[:start_idx] + replacement + content[end_idx:]
backup_path = fp.with_suffix('.ts.bak')
fp.rename(backup_path)
print(f'Backup created: {backup_path}')
fp.write_text(new_content, encoding="utf-8")
print(f"Done. New file has {len(new_content.splitlines())} lines")
