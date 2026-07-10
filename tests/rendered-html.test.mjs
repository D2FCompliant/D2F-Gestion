import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.match(html, /src="\/erp\/index\.html\?v=20260710-payments-i18n"/);
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
  assert.match(app, /paymentInvoiceStatus/);

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
  for (const key of ["payments.status.all", "payments.status.paid", "payments.status.partial", "payments.status.unpaid"]) {
    keys.add(key);
  }

  for (const [index, locale] of ["fr", "en", "sr", "es", "it"].entries()) {
    const dictionary = JSON.parse(dictionarySources[index]);
    const missing = [...keys].filter((key) => !key.includes("${") && !(key in dictionary));
    assert.deepEqual(missing, [], `${locale} is missing screen translations: ${missing.join(", ")}`);
  }
});
