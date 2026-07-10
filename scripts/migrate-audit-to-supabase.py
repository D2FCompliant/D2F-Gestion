#!/usr/bin/env python3
"""Verify and append the legacy D2F JSONL audit chain to Supabase."""

from __future__ import annotations

import argparse
import hashlib
import json
import ssl
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path
from typing import Any


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def ssl_context() -> ssl.SSLContext:
    try:
        import certifi  # type: ignore

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        system_bundle = Path("/etc/ssl/cert.pem")
        return ssl.create_default_context(cafile=str(system_bundle) if system_bundle.exists() else None)


def request_json(
    url: str,
    key: str,
    method: str = "GET",
    body: Any = None,
    prefer: str | None = None,
) -> Any:
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    payload = None
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    request = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=60, context=ssl_context()) as response:
            content = response.read()
            return json.loads(content) if content else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase returned HTTP {error.code}: {detail[:500]}") from error


def canonical_text(event: dict[str, Any]) -> str:
    core = {key: value for key, value in event.items() if key not in {"hash", "hmac"}}
    return json.dumps(core, ensure_ascii=False, separators=(",", ":"))


def load_and_verify(path: Path) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    previous_hash: str | None = None
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        event = json.loads(line)
        expected_seq = len(events) + 1
        if event.get("seq") != expected_seq:
            raise ValueError(f"Audit sequence error at line {index + 1}")
        if event.get("prev_hash") != previous_hash:
            raise ValueError(f"Audit chain error at line {index + 1}")
        computed_hash = hashlib.sha256(canonical_text(event).encode("utf-8")).hexdigest()
        if computed_hash != event.get("hash"):
            raise ValueError(f"Audit hash error at line {index + 1}")
        events.append(event)
        previous_hash = event["hash"]
    return events


def select_owner(api: str, key: str, explicit_owner: str | None) -> str:
    if explicit_owner:
        return explicit_owner.strip().lower()
    records = request_json(f"{api}/d2f_records?select=owner_email&limit=1000", key) or []
    counts = Counter(str(record.get("owner_email") or "") for record in records)
    counts.pop("", None)
    if not counts:
        raise RuntimeError("No populated D2F owner found in Supabase")
    return counts.most_common(1)[0][0]


def row(owner: str, event: dict[str, Any]) -> dict[str, Any]:
    return {
        "owner_email": owner,
        "seq": event["seq"],
        "event_time": event["ts"],
        "actor": str(event.get("actor") or "system"),
        "action": str(event.get("action") or ""),
        "entity_type": str(event.get("entityType") or ""),
        "entity_id": str(event.get("entityId") or ""),
        "prev_hash": event.get("prev_hash"),
        "hash": event["hash"],
        "hmac": event.get("hmac"),
        "canonical_text": canonical_text(event),
        "event": event,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--owner")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    events = load_and_verify(args.source)
    env = read_env(args.env_file)
    base_url = env.get("SUPABASE_URL", "").rstrip("/")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base_url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    api = f"{base_url}/rest/v1"
    print(f"Verified local audit chain: {len(events)} events")
    if not args.apply:
        print("Dry run only; use --apply to append verified events to Supabase.")
        return 0

    owner = select_owner(api, key, args.owner)

    owner_filter = urllib.parse.quote(owner, safe="")
    existing = request_json(
        f"{api}/d2f_audit_events?select=seq,hash&owner_email=eq.{owner_filter}&order=seq.asc&limit=10000",
        key,
    ) or []
    for stored, event in zip(existing, events):
        if int(stored.get("seq") or 0) != event["seq"] or stored.get("hash") != event["hash"]:
            raise RuntimeError("Supabase audit history does not match the verified local prefix")
    if len(existing) > len(events):
        print(f"Supabase already contains {len(existing)} events, including newer web activity.")
        return 0

    for event in events[len(existing):]:
        request_json(
            f"{api}/d2f_audit_events",
            key,
            method="POST",
            body=row(owner, event),
            prefer="return=minimal",
        )
    print(f"Audit migration complete: {len(events)} events stored in Supabase")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Audit migration failed: {error}")
        raise SystemExit(1)
