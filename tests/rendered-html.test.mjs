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
  assert.match(html, /Vue d’ensemble/);
  assert.match(html, /Revenu mensuel/);
  assert.match(html, /Dossiers en cours/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps Supabase access server-side and ships its schema", async () => {
  const [route, client, migration, envExample] = await Promise.all([
    readFile(new URL("../app/api/dashboard/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260710150000_init_d2f_gestion.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(route, /oai-authenticated-user-email|GET\(request/);
  assert.match(client, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(client, /persistSession: false/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.clients from anon, authenticated/);
  assert.match(envExample, /SUPABASE_URL/);
  assert.doesNotMatch(new URL("../app/page.tsx", import.meta.url).pathname, /service.role/i);
});
