#!/usr/bin/env python3
"""Idempotent D2F Gestion SQLite -> Supabase migration."""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any


ENTITY_TABLES = ("clients", "items", "quotes", "invoices", "payments")


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def open_source(path: Path) -> sqlite3.Connection:
    uri = f"file:{urllib.parse.quote(str(path.resolve()))}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def has_table(connection: sqlite3.Connection, table: str) -> bool:
    return connection.execute(
        "select 1 from sqlite_master where type='table' and name=?", (table,)
    ).fetchone() is not None


def rows(connection: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    if not has_table(connection, table):
        return []
    return [dict(row) for row in connection.execute(f'select * from "{table}"')]


def json_value(value: Any, fallback: Any) -> Any:
    if value is None or value == "":
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def serializable(record: dict[str, Any]) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for key, value in record.items():
        if isinstance(value, (bytes, bytearray, memoryview)):
            output[f"{key}_base64"] = base64.b64encode(bytes(value)).decode("ascii")
        else:
            output[key] = value
    return output


def timestamp(value: Any) -> str:
    if value:
        text = str(value).strip().replace(" ", "T")
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = dt.datetime.fromisoformat(text)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.astimezone(dt.timezone.utc).isoformat()
        except ValueError:
            pass
    return dt.datetime.now(dt.timezone.utc).isoformat()


def date_value(value: Any) -> str | None:
    if value and re.match(r"^\d{4}-\d{2}-\d{2}", str(value)):
        return str(value)[:10]
    return None


def search_text(data: dict[str, Any]) -> str:
    fields = (
        "name", "label", "ref", "number", "invoice_number", "email",
        "vat_id", "description", "filename", "source_name", "doc_number",
    )
    return " ".join(str(data.get(field) or "") for field in fields).lower()[:2000]


def index_by(items: list[dict[str, Any]], field: str) -> dict[str, list[dict[str, Any]]]:
    indexed: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        indexed[str(item.get(field) or "")].append(serializable(item))
    return indexed


def build_records(connection: sqlite3.Connection, owner: str) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, int]]:
    source = {table: rows(connection, table) for table in ENTITY_TABLES}
    source["inbound_documents"] = rows(connection, "inbound_documents")
    quote_lines = index_by(rows(connection, "quote_lines"), "quote_id")
    invoice_lines = index_by(rows(connection, "invoice_lines"), "invoice_id")
    invoice_links_from = index_by(rows(connection, "invoice_links"), "from_invoice_id")
    invoice_links_to = index_by(rows(connection, "invoice_links"), "to_invoice_id")
    inbound_invoices = {str(item.get("document_id")): serializable(item) for item in rows(connection, "inbound_invoices")}
    inbound_events = index_by(rows(connection, "inbound_events"), "document_id")
    client_names = {str(item.get("id")): str(item.get("name") or "") for item in source["clients"]}

    company_rows = rows(connection, "company")
    company = serializable(company_rows[0]) if company_rows else {"id": "1"}
    company["id"] = "1"
    company["smtp_password"] = ""
    company["logo_path"] = None

    records: list[dict[str, Any]] = []
    counts: dict[str, int] = {}

    for entity in ENTITY_TABLES:
        counts[entity] = len(source[entity])
        for raw in source[entity]:
            data = serializable(raw)
            identifier = str(data.get("id") or "")
            if not identifier:
                raise ValueError(f"{entity}: record without id")
            if entity == "items":
                data["label"] = data.get("name") or ""
            if entity == "quotes":
                data["lines"] = quote_lines.get(identifier, [])
                data["client_name"] = client_names.get(str(data.get("client_id") or ""), "")
            if entity == "invoices":
                data["lines"] = invoice_lines.get(identifier, [])
                data["links_from"] = invoice_links_from.get(identifier, [])
                data["links_to"] = invoice_links_to.get(identifier, [])
                data["client_name"] = client_names.get(str(data.get("client_id") or ""), "")
                data["source_quote_id"] = data.get("quote_id")
            if entity == "payments":
                data["date"] = data.get("date") or data.get("payment_date")

            records.append({
                "id": identifier,
                "owner_email": owner,
                "entity": entity,
                "search_text": search_text(data),
                "status": str(data.get("status") or ""),
                "document_number": str(data.get("invoice_number") or data.get("number") or ""),
                "document_date": date_value(data.get("date")),
                "parent_id": str(data.get("invoice_id") or data.get("client_id") or data.get("quote_id") or "") or None,
                "data": data,
                "created_at": timestamp(data.get("created_at")),
                "updated_at": timestamp(data.get("updated_at") or data.get("created_at")),
            })

    counts["inbound"] = len(source["inbound_documents"])
    for raw in source["inbound_documents"]:
        data = serializable(raw)
        identifier = str(data.get("id") or "")
        canonical_raw = inbound_invoices.get(identifier)
        canonical = None
        if canonical_raw:
            canonical = {
                **canonical_raw,
                "seller": json_value(canonical_raw.get("seller_json"), {}),
                "buyer": json_value(canonical_raw.get("buyer_json"), {}),
                "totals": json_value(canonical_raw.get("totals_json"), {}),
                "lines": json_value(canonical_raw.get("lines_json"), []),
            }
        totals = canonical.get("totals", {}) if canonical else {}
        seller = canonical.get("seller", {}) if canonical else {}
        meta = json_value(data.get("meta_json"), {})
        data.update({
            "status": str(data.get("status") or "received").lower(),
            "direction": "IN",
            "canonical": canonical,
            "events": inbound_events.get(identifier, []),
            "supplier_name": seller.get("name") or seller.get("legal_name") or seller.get("party_name"),
            "doc_number": canonical.get("invoice_number") if canonical else None,
            "doc_date": canonical.get("issue_date") if canonical else None,
            "currency": (canonical.get("currency") if canonical else None) or "EUR",
            "total_ttc": totals.get("grand_total") or totals.get("payable_amount") or totals.get("amount_due") or totals.get("total_ttc") or 0,
            "reject_reason": meta.get("response_reason") or meta.get("reject_reason"),
            "reject_code": meta.get("response_code") or meta.get("reject_code"),
            "errors": json_value(data.get("errors_json"), {}),
            "warnings": json_value(data.get("warnings_json"), {}),
        })
        records.append({
            "id": identifier,
            "owner_email": owner,
            "entity": "inbound",
            "search_text": search_text(data),
            "status": str(data.get("status") or ""),
            "document_number": str(data.get("doc_number") or ""),
            "document_date": date_value(data.get("doc_date")),
            "parent_id": None,
            "data": data,
            "created_at": timestamp(data.get("received_at")),
            "updated_at": timestamp(data.get("received_at")),
        })

    company_row = {
        "owner_email": owner,
        "data": company,
        "created_at": timestamp(company.get("created_at")),
        "updated_at": timestamp(company.get("updated_at") or company.get("created_at")),
    }
    return company_row, records, counts


def request_json(url: str, key: str, method: str = "GET", body: Any = None, prefer: str | None = None) -> Any:
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    payload = None
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            content = response.read()
            return json.loads(content) if content else None
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase returned HTTP {error.code}: {detail[:500]}") from error


def migrate(base_url: str, key: str, owner: str, company: dict[str, Any], records: list[dict[str, Any]]) -> None:
    api = base_url.rstrip("/") + "/rest/v1"
    request_json(
        f"{api}/d2f_company?on_conflict=owner_email",
        key,
        method="POST",
        body=[company],
        prefer="resolution=merge-duplicates,return=minimal",
    )
    for start in range(0, len(records), 50):
        request_json(
            f"{api}/d2f_records?on_conflict=id",
            key,
            method="POST",
            body=records[start : start + 50],
            prefer="resolution=merge-duplicates,return=minimal",
        )

    owner_filter = urllib.parse.quote(owner, safe="")
    company_check = request_json(f"{api}/d2f_company?select=owner_email&owner_email=eq.{owner_filter}", key)
    record_check = request_json(f"{api}/d2f_records?select=id,entity&owner_email=eq.{owner_filter}&limit=1000", key)
    if len(company_check or []) != 1 or len(record_check or []) != len(records):
        raise RuntimeError(
            f"Verification failed: company={len(company_check or [])}, records={len(record_check or [])}/{len(records)}"
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, default=Path(".env.local"))
    parser.add_argument("--owner", default="owner@d2f.local")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    env = read_env(args.env_file)
    url = env.get("SUPABASE_URL", "")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    connection = open_source(args.source)
    try:
        integrity = connection.execute("pragma quick_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"SQLite integrity check failed: {integrity}")
        company, records, counts = build_records(connection, args.owner)
    finally:
        connection.close()

    print("Source verified:", ", ".join(f"{name}={count}" for name, count in counts.items()))
    print(f"Prepared company=1, records={len(records)}, owner={args.owner}")
    if not args.apply:
        print("Dry run only; use --apply to write to Supabase.")
        return 0

    migrate(url, key, args.owner, company, records)
    print(f"Migration complete and verified: company=1, records={len(records)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"Migration failed: {error}", file=sys.stderr)
        raise SystemExit(1)
