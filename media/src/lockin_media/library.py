"""Install the pinned starter footage and music, with separate decimal byte limits."""

import hashlib
import json
import os
import re
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor
from importlib.resources import files
from pathlib import Path
from typing import Literal

import httpx
from filelock import FileLock
from pydantic import BaseModel, Field, HttpUrl, model_validator

from .settings import Settings
from .storage import Store, file_digest, write_json

LIMITS = {"gameplay": 1_000_000_000, "music": 200_000_000}
INDEX = "installed-starter.json"


class Asset(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    kind: Literal["gameplay", "music"]
    category: str
    title: str
    creator: str
    source: HttpUrl
    license: str
    license_url: HttpUrl
    urls: list[HttpUrl] = Field(min_length=1)
    bytes: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    duration_sec: float = Field(gt=0)
    tags: list[str]
    energy: float = Field(ge=0, le=1)
    tempo: int | None = Field(default=None, gt=0)
    edition: str | None = None
    distribution_source: HttpUrl | None = None

    @model_validator(mode="after")
    def validate_media(self):
        if any(url.scheme != "https" for url in self.urls):
            raise ValueError("Download URLs must use HTTPS")
        if self.kind == "music" and self.tempo is None:
            raise ValueError("Music entries require tempo in BPM")
        return self

    @property
    def filename(self) -> str:
        extension = "mp3" if self.kind == "music" else "mp4"
        return f"starter-{self.sha256}.{extension}"


def _verified(path, asset):
    return (
        path.is_file() and path.stat().st_size == asset.bytes and file_digest(path) == asset.sha256
    )


def _download(client, asset, store):
    final = store.root / "assets" / asset.filename
    errors = []
    for url in asset.urls:
        try:
            with tempfile.TemporaryDirectory(dir=store.root / "tmp") as temp:
                part = Path(temp) / "download"
                total = 0
                sha = hashlib.sha256()
                with client.stream("GET", str(url)) as response:
                    response.raise_for_status()
                    declared = response.headers.get("Content-Length")
                    if declared is not None and int(declared) != asset.bytes:
                        raise ValueError("Wrong Content-Length")
                    with part.open("wb") as out:
                        for chunk in response.iter_bytes(65536):
                            total += len(chunk)
                            if total > asset.bytes:
                                raise ValueError("Byte limit exceeded")
                            sha.update(chunk)
                            out.write(chunk)
                if total != asset.bytes or sha.hexdigest() != asset.sha256:
                    raise ValueError("Size or SHA-256 mismatch")
                os.replace(part, final)
                return
        except (httpx.HTTPError, ValueError) as err:
            errors.append(f"{url.host}: {err}")
    raise RuntimeError(f"Could not install {asset.title}: {' | '.join(errors)}")


def install(store, assets, client):
    if len({a.id for a in assets}) != len(assets) or len({a.sha256 for a in assets}) != len(assets):
        raise ValueError("Duplicate starter asset")
    directory = store.root / "assets"
    starter_bytes = {kind: sum(a.bytes for a in assets if a.kind == kind) for kind in LIMITS}
    with FileLock(store.root / "locks" / "starter-library.lock"):
        # Include the operator's published library. Narration and model weights
        # live alongside the library but have their own storage lifecycle.
        totals = starter_bytes.copy()
        keep = {a.filename for a in assets}
        operator_files = set()
        for record in store.entries():
            name = record["file"]
            if name not in keep and name not in operator_files:
                kind = "music" if record["category"] == "music" else "gameplay"
                totals[kind] += (directory / name).stat().st_size
            operator_files.add(name)
        for kind, size in totals.items():
            if size > LIMITS[kind]:
                raise ValueError(f"{kind} library would exceed {LIMITS[kind]} bytes")

        index = store.root / INDEX
        published = {r["file"] for r in json.loads(index.read_text())} if index.exists() else set()
        obsolete = []
        for path in directory.glob("starter-*"):
            if not re.fullmatch(r"starter-[a-f0-9]{64}\.(mp3|mp4)", path.name):
                continue
            if path.name in keep or path.name in operator_files:
                continue
            if path.name in published:
                obsolete.append(path)
            else:
                path.unlink()

        pending = [a for a in assets if not _verified(directory / a.filename, a)]
        required = sum(a.bytes for a in pending)
        if shutil.disk_usage(store.root / "tmp").free < required:
            raise ValueError(f"Library update needs {required} free bytes to stage incoming files")
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda a: _download(client, a, store), pending))
        records = [
            {
                **a.model_dump(mode="json", exclude={"urls", "sha256"}, exclude_none=True),
                "file": a.filename,
            }
            for a in assets
        ]
        write_json(store.root / INDEX, records)
        for path in obsolete:
            path.unlink()
    return {
        "downloaded": len(pending),
        "verified": len(assets) - len(pending),
        "starter_bytes": starter_bytes,
    }


def install_starter():
    manifest = files("lockin_media").joinpath("starter-library.json")
    assets = [Asset.model_validate(item) for item in json.loads(manifest.read_text())]
    with httpx.Client(
        follow_redirects=True,
        timeout=httpx.Timeout(60, connect=12),
        headers={"Accept-Encoding": "identity", "User-Agent": "LockIN-media-library/1"},
    ) as client:
        return install(Store(Settings().data_dir), assets, client)


if __name__ == "__main__":
    print(json.dumps(install_starter(), indent=2))
