"""Bounded-lifetime script reuse; the on-disk cache lives with local recap data."""

import json
from time import time

from filelock import FileLock

from .script_writer import Draft, write_script
from .storage import digest, write_json
from .timing import annotate, stage

PROMPT_VERSION = 3


def cached_script(store, writer, request, catalog):
    if not writer.cache_seconds:
        annotate(script_cache_hit=False)
        return write_script(writer, request, catalog)
    config = writer.model_dump(exclude={"api_key", "cache_seconds"})
    config["model"] = writer.effective_model
    key = digest(
        [
            PROMPT_VERSION,
            config,
            writer.api_key.get_secret_value(),
            request.model_dump(),
            catalog if writer.select_assets else {},
        ]
    )
    path = store.root / "cache" / f"script-{key}.json"
    lock = FileLock(store.root / "locks" / f"script-{key}.lock", timeout=200)
    with stage("script_queue"):
        lock.acquire()
    try:
        try:
            fresh = time() - path.stat().st_mtime < writer.cache_seconds
        except FileNotFoundError:
            fresh = False
        if fresh:
            try:
                result = json.loads(path.read_text(encoding="utf-8"))
                draft = Draft.model_validate(result)
                if len(draft.quiz) != request.variant.quiz_count:
                    raise ValueError("Cached quiz count differs")
            except (ValueError, KeyError, OSError):
                path.unlink(missing_ok=True)
            else:
                annotate(
                    script_cache_hit=True, configured_model=writer.effective_model or "CLI default"
                )
                return result
        annotate(script_cache_hit=False)
        result = write_script(writer, request, catalog)
        write_json(path, result)
        # Bound disk use without retaining another copy of source text.
        with FileLock(store.root / "locks" / "script-prune.lock", timeout=5):
            entries = []
            for entry in path.parent.glob("script-*.json"):
                try:
                    entries.append((entry.stat().st_mtime, entry))
                except FileNotFoundError:
                    continue
            for _, old in sorted(entries)[:-128]:
                old.unlink(missing_ok=True)
        return result
    finally:
        lock.release()
