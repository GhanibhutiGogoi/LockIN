import hashlib
import json
import os
import tempfile
from pathlib import Path


def digest(value) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def file_digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".partial-")
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream, indent=2, ensure_ascii=False, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


class Store:
    def __init__(self, root: Path):
        self.root = root
        for folder in ("assets", "cache", "voices", "library", "review", "tmp", "locks"):
            (root / folder).mkdir(parents=True, exist_ok=True)

    def voice(self, voice_id: str) -> dict:
        path = self.root / "voices" / f"{voice_id}.json"
        if not path.exists():
            raise ValueError(f"Create reference voice first: lockin-media create-voice {voice_id}")
        entry = json.loads(path.read_text())
        audio = self.root / "voices" / entry["file"]
        if audio.parent.resolve() != (self.root / "voices").resolve() or not audio.is_file():
            raise ValueError("Reference audio is missing or outside the voices directory")
        return {**entry, "path": audio, "sha256": file_digest(audio)}

    def entries(self) -> list[dict]:
        entries = []
        for path in sorted((self.root / "library").glob("*.json")):
            entry = json.loads(path.read_text())
            asset = self.root / "assets" / entry["file"]
            if asset.parent.resolve() == (self.root / "assets").resolve() and asset.is_file():
                entries.append(entry)
        return entries

    def starter(self, kind: str) -> list[dict]:
        index = self.root / "installed-starter.json"
        if not index.exists():
            return []
        result = []
        for entry in json.loads(index.read_text()):
            if entry["kind"] == kind and (self.root / "assets" / entry["file"]).is_file():
                meta = {k: v for k, v in entry.items() if k not in {"file", "kind", "category"}}
                result.append({**meta, "type": entry["category"], "url": f"assets/{entry['file']}"})
        return result

    def gameplay(self) -> list[dict]:
        return [
            {
                "id": e["id"],
                "type": e["category"],
                "energy": e["energy"],
                "url": f"assets/{e['file']}",
            }
            for e in self.entries()
            if e["category"] not in {"broll", "music"}
        ] + self.starter("gameplay")
