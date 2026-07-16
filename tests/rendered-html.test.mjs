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
  assert.match(html, /Ouverture sécurisée/);
  assert.doesNotMatch(html, /<iframe[^>]+\/erp\/index\.html/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);

  const shell = await readFile(new URL("../app/session-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /src="\/erp\/index\.html\?v=20260716-documents-v10"/);
  assert.match(shell, /title="D2F Gestion"/);
});

test("ships a touch-first smartphone layout", async () => {
  const [styles, app, shellStyles, html] = await Promise.all([
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /styles\.css\?v=20260716-documents-v10/);
  assert.match(html, /app\.js\?v=20260716-documents-v10/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /position:fixed;\s*z-index:1000;\s*left:0;\s*right:0;\s*bottom:0/);
  assert.match(styles, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) !important/);
  assert.match(styles, /\.paymentsTable__row--head\{ display:none !important; \}/);
  assert.match(app, /scrollIntoView\(\{ behavior: "smooth", block: "nearest", inline: "center" \}\)/);
  assert.match(app, /data-label="\$\{esc\(t\("lines\.qty"/);
  assert.match(app, /data-label="\$\{esc\(t\("payments\.col\.invoice"/);
  assert.match(shellStyles, /\.app-session-shell \{ grid-template-rows:64px minmax\(0,1fr\); \}/);
  assert.match(shellStyles, /\.auth-brand h1 \{ font-size:27px/);
});

test("renders human-readable document lists on desktop and smartphone", async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="invoicesListCount"/);
  assert.match(html, /id="invoicesList" class="list documentList"/);
  assert.match(app, /function renderInvoiceDocumentList/);
  assert.match(app, /D2FReceivables\.buildReceivableRows/);
  assert.match(app, /payments\.col\.remaining/);
  assert.match(app, /focusDocumentEditorOnMobile\("invoices"\)/);
  assert.match(styles, /grid-template-columns:minmax\(360px,410px\) minmax\(0,1fr\)/);
  assert.match(styles, /max-height:min\(44dvh,370px\)/);
  assert.match(styles, /\.documentListItem\.is-selected/);
  assert.match(styles, /flex:0 0 auto/);
  assert.match(styles, /grid-template-rows:auto auto auto/);
  assert.match(styles, /-webkit-line-clamp:2/);
  assert.match(styles, /\.documentListClient\{[\s\S]*?min-height:18px/);
});

test("keeps Supabase access tenant-scoped and server-side", async () => {
  const [route, client, auth, accounts, migration, tenantMigration, envExample, legacyHtml] = await Promise.all([
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/supabase/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/saas/accounts.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260710150000_init_d2f_gestion.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716150000_multitenant_saas.sql", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(route, /clients|items|quotes|invoices|payments/);
  assert.match(route, /getOwnerEmail/);
  assert.match(route, /recognizedRevenueHt/);
  assert.match(route, /meta_json/);
  assert.match(route, /readAppSession/);
  assert.match(route, /accountAllowsApplication/);
  assert.match(client, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(client, /persistSession: false/);
  assert.doesNotMatch(client, /oai-authenticated-user-email/);
  assert.doesNotMatch(client, /D2F_OWNER_EMAIL/);
  assert.match(auth, /SESSION_IDLE_SECONDS = 30 \* 60/);
  assert.match(auth, /HttpOnly; SameSite=Lax; Max-Age=/);
  assert.match(auth, /isPlatformAdminEmail/);
  assert.match(accounts, /seatLimit: 2/);
  assert.match(accounts, /account\.members\.length >= account\.seatLimit/);
  assert.match(accounts, /currentPeriodEnd/);
  assert.match(accounts, /addUtcMonth/);
  assert.match(accounts, /accountAllowsApplication\(account\)/);
  assert.match(accounts, /process\.env\.D2F_DATA_OWNER_KEY \|\| process\.env\.D2F_OWNER_EMAIL/);
  assert.match(accounts, /ownerKey = lifetime \? d2fDataOwnerKey\(\) : `tenant:/);
  assert.doesNotMatch(accounts, /\.or\(`/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.d2f_records from anon, authenticated/);
  assert.match(tenantMigration, /create table if not exists public\.d2f_tenants/);
  assert.match(tenantMigration, /create table if not exists public\.d2f_tenant_members/);
  assert.match(tenantMigration, /create table if not exists public\.d2f_subscriptions/);
  assert.match(tenantMigration, /enable row level security/);
  assert.match(tenantMigration, /revoke all on public\.d2f_tenants from anon, authenticated/);
  assert.match(envExample, /SUPABASE_URL/);
  assert.match(envExample, /D2F_SESSION_SECRET/);
  assert.match(envExample, /D2F_MONTHLY_PRICE_EUR/);
  assert.match(legacyHtml, /D2F – Gestion/);
  assert.doesNotMatch(legacyHtml, /\/d2f-gestion-logo\.png\?v=20260710-brand-2026/);
  assert.match(legacyHtml, /© D2F Compliant d\.o\.o 2026/);
  assert.match(legacyHtml, /web-api-shim\.js/);
});

test("ships a branded Cloudflare gateway without exposing the Worker origin", async () => {
  const [auth, worker, gateway, config] = await Promise.all([
    readFile(new URL("../lib/auth/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../cloudflare-gateway/_worker.js", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.cloudflare.jsonc", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /D2F_PUBLIC_URL/);
  assert.match(worker, /D2F_GATEWAY_SECRET/);
  assert.match(gateway, /x-d2f-gateway/);
  assert.match(gateway, /gestion\.d2fcompliant\.org/);
  assert.match(config, /"D2F_PUBLIC_URL": "https:\/\/gestion\.d2fcompliant\.org"/);
  assert.match(config, /"D2F_OWNER_EMAIL": "contact@d2fcompliant\.org"/);
  assert.match(config, /"D2F_DATA_OWNER_KEY": "owner@d2f\.local"/);
});

test("shows one visible product brand and blocks clients until payment is verified", async () => {
  const [shell, styles, legacyHtml, accounts, signup, subscription] = await Promise.all([
    readFile(new URL("../app/session-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../lib/saas/accounts.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/signup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/subscription/route.ts", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(legacyHtml, /class="brand"/);
  assert.match(styles, /\.account-brand img \{ width:72px; height:72px/);
  assert.match(shell, /PORTAIL DE RÈGLEMENT/);
  assert.match(shell, /confirmTransfer/);
  assert.match(shell, /Confirmer reçu \+ 1 mois/);
  assert.match(accounts, /currentPeriodStart && account\.subscription\.currentPeriodEnd/);
  assert.match(accounts, /account\.subscription\.status !== "payment_declared"/);
  assert.match(signup, /acceptPaymentTerms/);
  assert.match(subscription, /body\.confirmTransfer !== true/);
});

test("scopes tenants to establishments and selects national e-invoicing profiles", async () => {
  const [portal, identifiers, accounts, signup, html, app, integrations, migration] = await Promise.all([
    readFile(new URL("../app/portal-i18n.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/company-identifiers.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/saas/accounts.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/signup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716190000_country_scoped_establishments.sql", import.meta.url), "utf8"),
  ]);
  assert.match(portal, /fr:|en:|sr:|it:|es:/);
  assert.match(portal, /SIRET de l’établissement \(14 chiffres\)/);
  assert.match(identifiers, /country === "FR" && !\/\^\\d\{14\}\$\//);
  assert.match(signup, /validateEstablishmentIdentifier/);
  assert.match(accounts, /\.eq\("country", country\)\.eq\("company_identifier", companyIdentifier\)/);
  assert.match(html, /id="company-einvoice-card"/);
  assert.match(html, /id="cf-pa-environment"/);
  assert.match(app, /RS_SEF/);
  assert.match(app, /IT_SDI/);
  assert.match(app, /ES_VERIFACTU/);
  assert.match(integrations, /last_test_status/);
  assert.match(migration, /d2f_tenants_country_company_identifier_idx/);
});

test("hydrates invoice client names from the tenant client records", async () => {
  const route = await readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8");
  assert.match(route, /const clientNames = new Map/);
  assert.match(route, /record\.client_name/);
  assert.match(route, /record\.client_id/);
  assert.match(route, /candidate\.client_name/);
  assert.match(route, /record\.client_name = String\(client\?\.name/);
  assert.match(route, /occupied\.owner_email/);
  assert.match(route, /delete company\._saas_account/);
  assert.match(route, /hidden\._saas_account/);
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

test("wires every visible command and enforces the quote lifecycle", async () => {
  const [html, app, route] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
  ]);

  const commands = new Set([
    ...Array.from(html.matchAll(/data-action="([^"]+)"/g), (match) => match[1]),
    ...Array.from(app.matchAll(/\bid:\s*"([a-z][a-zA-Z0-9_-]*:[a-zA-Z0-9:_-]+)"/g), (match) => match[1]),
    ...Array.from(app.matchAll(/dataset\.action\s*=\s*"([^"]+)"/g), (match) => match[1]),
  ]);
  const handled = new Set(Array.from(app.matchAll(/case\s+"([^"]+)"\s*:/g), (match) => match[1]));
  const missing = [...commands].filter((command) => !handled.has(command)).sort();
  assert.deepEqual(missing, [], `visible commands without a handler: ${missing.join(", ")}`);

  assert.match(html, /id="q-lifecycle-hint"/);
  assert.match(app, /case "quotes:reject"/);
  assert.match(app, /list__item--rejected/);
  assert.match(app, /\["draft", "sent"\]\.includes\(canonicalQuoteStatus/);
  assert.match(app, /if \(state\.currentModule === "quotes"\) renderToolbar\("quotes"\)/);
  assert.match(app, /setButtonDisabled\(acceptBtn, !canDecide\)/);
  assert.match(app, /setButtonDisabled\(rejectBtn, !canDecide\)/);
  assert.match(route, /draft: \["sent", "accepted", "rejected"\]/);
  assert.match(route, /sent: \["accepted", "rejected"\]/);
  assert.match(route, /Transition de devis interdite/);
});

test("country-aware structured export fails closed and client PEPPOL lookup is available", async () => {
  const [html, app, route, ubl, compliance, shim] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ubl.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/country-compliance.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/renderer/web-api-shim.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="cl-peppol-scheme"/);
  assert.match(html, /id="cl-peppol-endpoint"/);
  assert.match(html, /data-action="clients:lookupPeppol"/);
  assert.match(html, /id="ex-compliance-card"/);
  assert.match(app, /case "clients:lookupPeppol"/);
  assert.match(app, /conformity\.invoicePreflight/);
  assert.match(route, /directory:lookupPeppol/);
  assert.match(route, /Transmission nationale bloquée/);
  assert.match(shim, /directory: ns\("directory"\)/);
  assert.match(compliance, /FR-BT-49/);
  assert.match(compliance, /IT-FATTURAPA/);
  assert.match(compliance, /ES-VERIFACTU/);
  assert.match(compliance, /COUNTRY-NOT-QUALIFIED/);
  assert.match(ubl, /billing:3\.0/);
  assert.match(ubl, /urn:peppol:france:billing:cius:1\.0/);
  assert.match(ubl, /cac:BillingReference/);
  assert.doesNotMatch(ubl, /meta\.peppol_endpoint_id \|\| party\.vat_id/);
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

test("provides web-native PDFs, UBL, file handling, and connector storage", async () => {
  const [route, pdf, ubl, integrations, shim, migration] = await Promise.all([
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/document-pdf.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ubl.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/renderer/web-api-shim.js", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260716110000_integrations_and_transmissions.sql", import.meta.url), "utf8"),
  ]);
  assert.match(route, /createDocumentPdf/);
  assert.match(route, /createUblDocument/);
  assert.match(route, /connections:sendInvoice/);
  assert.doesNotMatch(route, /Cette fonction de fichier ou d.envoi nécessite encore un service serveur dédié/);
  assert.match(pdf, /PDFDocument/);
  assert.match(ubl, /urn:oasis:names:specification:ubl/);
  assert.match(integrations, /AES-GCM/);
  assert.match(integrations, /d2f_integrations/);
  assert.match(shim, /downloadBase64/);
  assert.match(shim, /type = "file"/);
  assert.match(migration, /create table if not exists public\.d2f_integrations/);
  assert.match(migration, /create table if not exists public\.d2f_transmissions/);
});
