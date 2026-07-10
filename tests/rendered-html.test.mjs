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
  assert.match(html, /src="\/erp\/index\.html"/);
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
