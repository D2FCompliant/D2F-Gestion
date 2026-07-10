import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html", host: "localhost" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the D2F Gestion cockpit", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>D2F Gestion — Pilotez votre activité<\/title>/i);
  assert.match(html, /src="\/erp\/index\.html\?v=20260710-audit-credit-v1"/);
  assert.match(html, /title="D2F Gestion"/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps Supabase access server-side and ships its schema", async () => {
  const [route, client, migration, envExample, legacyHtml] = await Promise.all([
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260710150000_init_d2f_gestion.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(route, /clients|items|quotes|invoices|payments/);
  assert.match(route, /getOwnerEmail/);
  assert.match(route, /recognizedRevenueHt/);
  assert.match(route, /meta_json/);
  assert.match(client, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(client, /persistSession: false/);
  assert.ok(
    client.indexOf("D2F_OWNER_EMAIL") < client.indexOf("oai-authenticated-user-email"),
    "the configured D2F owner must take precedence over the hosting identity",
  );
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.d2f_records from anon, authenticated/);
  assert.match(envExample, /SUPABASE_URL/);
  assert.match(legacyHtml, /D2F Gestion/);
  assert.match(legacyHtml, /\/d2f-gestion-logo\.png\?v=20260710-brand-2026/);
  assert.match(legacyHtml, /© D2F Compliant d\.o\.o 2026/);
  assert.match(legacyHtml, /web-api-shim\.js/);
});

test("ships a global payment overview and complete screen translations", async () => {
  const [html, app, dashboard, ...dictionarySources] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/dashboard-ui.js", import.meta.url), "utf8"),
    ...["fr", "en", "sr", "es", "it"].map((locale) =>
      readFile(new URL(`../renderer/i18n/${locale}.json`, import.meta.url), "utf8")
    ),
  ]);

  assert.match(html, /id="p-paymentKpis"/);
  assert.match(html, /id="p-invoiceSummary"/);
  assert.match(html, /id="p-payment-status"/);
  assert.match(app, /payments\.listAll/);
  assert.match(app, /D2FReceivables\.summarize/);

  const source = [html, app, dashboard].join("\n");
  const keys = new Set([
    ...Array.from(source.matchAll(/data-i18n="([^"]+)"/g), (match) => match[1]),
    ...Array.from(source.matchAll(/\bt\(\s*["']([^"']+)["']/g), (match) => match[1]),
    ...Array.from(source.matchAll(/\btf\(\s*["']([^"']+)["']/g), (match) => match[1]),
  ]);
  for (const spec of Array.from(source.matchAll(/data-i18n-attr="([^"]+)"/g), (match) => match[1])) {
    for (const part of spec.split(";")) {
      const separator = part.indexOf(":");
      if (separator >= 0) keys.add(part.slice(separator + 1).trim());
    }
  }
  keys.delete("key.path");
  for (const key of ["payments.status.all", "payments.status.paid", "payments.status.partial", "payments.status.unpaid", "payments.status.credited"]) {
    keys.add(key);
  }

  for (const [index, locale] of ["fr", "en", "sr", "es", "it"].entries()) {
    const dictionary = JSON.parse(dictionarySources[index]);
    const missing = [...keys].filter((key) => !key.includes("${") && !(key in dictionary));
    assert.deepEqual(missing, [], `${locale} is missing screen translations: ${missing.join(", ")}`);
  }
});

test("removes issued credit notes from invoice balances", async () => {
  const source = await readFile(new URL("../public/erp/receivables.js", import.meta.url), "utf8");
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const receivables = context.D2FReceivables;
  assert.ok(receivables);

  const invoices = [
    { id: "f15", invoice_number: "F2026-0015", type: "final", status: "issued", total_ttc: 200 },
    { id: "av3", invoice_number: "AV2026-0003", type: "credit_note", status: "issued", total_ttc: -200, source_invoice_id: "f15" },
    { id: "f16", invoice_number: "F2026-0016", type: "final", status: "issued", total_ttc: 200 },
    { id: "av4", invoice_number: "AV2026-0004", type: "credit_note", status: "issued", total_ttc: -200, source_invoice_id: "f16" },
  ];
  const summary = receivables.summarize(invoices, []);
  assert.equal(summary.creditedCount, 2);
  assert.equal(summary.outstanding, 0);
  assert.equal(summary.activeRows.length, 0);
  assert.deepEqual(Array.from(summary.rows, (row) => row.paymentStatus), ["credited", "credited"]);

  const partial = receivables.buildReceivableRows([
    { id: "invoice", type: "final", status: "issued", total_ttc: 200 },
    { id: "credit", type: "credit_note", status: "issued", total_ttc: -50, source_invoice_id: "invoice" },
  ], [
    { id: "cancelled", invoice_id: "invoice", amount: 150, status: "cancelled" },
  ])[0];
  assert.equal(partial.credited, 50);
  assert.equal(partial.paid, 0);
  assert.equal(partial.remaining, 150);
});

test("ships an immutable Supabase audit trail instead of an empty web stub", async () => {
  const [route, migration, importer] = await Promise.all([
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260710173000_secure_audit_trail.sql", import.meta.url), "utf8"),
    readFile(new URL("../scripts/migrate-audit-to-supabase.py", import.meta.url), "utf8"),
  ]);
  assert.match(route, /appendAuditEvent/);
  assert.match(route, /verifyAuditEvents/);
  assert.match(route, /canonical_text/);
  assert.doesNotMatch(route, /audit:read"\) return \{ events: \[\]/);
  assert.match(migration, /append-only/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /extensions\.digest\(convert_to\(new\.canonical_text/);
  assert.match(importer, /load_and_verify/);
});
