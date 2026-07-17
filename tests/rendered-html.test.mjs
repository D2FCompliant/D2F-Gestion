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
  assert.match(shell, /src="\/erp\/index\.html\?v=20260717-support-sync-v215"/);
  assert.match(shell, /title="D2F Gestion"/);
});

test("ships a touch-first smartphone layout", async () => {
  const [styles, app, shellStyles, html] = await Promise.all([
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /styles\.css\?v=20260717-support-sync-v215/);
  assert.match(html, /app\.js\?v=20260717-support-sync-v215/);
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

test("makes the quote deposit unit explicit with no preset value", async () => {
  const [html, app, styles, shell, pkg] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../app/session-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(html, /class="depositModeOption"[\s\S]*?quotes\.deposit_percent[\s\S]*?quotes\.deposit_amount_ttc/);
  assert.match(html, /id="q-deposit-value"[^>]*min="0\.01"[^>]*max="100"/);
  assert.doesNotMatch(html, /id="q-deposit-value"[^>]*value=/);
  assert.match(app, /function syncQuoteDepositModeUi/);
  assert.match(app, /syncQuoteDepositModeUi\(\{ clearValue: true \}\)/);
  assert.match(styles, /\.depositModeOption input:checked \+ span/);
  assert.match(shell, /app-build-badge">v2\.1\.5/);
  assert.equal(JSON.parse(pkg).version, "2.1.5");
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
  assert.match(html, /id="clientsListCount"/);
  assert.match(html, /id="clientsList" class="list clientList"/);
  assert.match(app, /function renderClientList/);
  assert.match(app, /clients\.list\.no_endpoint/);
  assert.match(styles, /\.clientListItem\{[\s\S]*?flex:0 0 auto/);
  assert.match(styles, /page\[data-page="clients"\][\s\S]*?grid-template-columns:minmax\(350px,390px\)/);
});

test("uses independent company columns and compact disclosure sections", async () => {
  const [html, styles] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /class="companySettingsColumns"/);
  assert.match(html, /class="companyPrimaryStack"/);
  assert.match(html, /class="companySecondaryStack"/);
  assert.match(html, /<details class="card companyTermsCard companyDisclosureCard">/);
  assert.match(html, /<details class="card integrationCard companyDisclosureCard" id="company-einvoice-card">/);
  assert.match(html, /id="company-reporting-card"/);
  assert.match(html, /<details class="card integrationCard companyArchiveCard companyDisclosureCard">/);
  assert.match(html, /id="co-meta-json" rows="3"/);
  assert.match(html, /id="co-cgv-text" rows="4"/);
  assert.doesNotMatch(html, /companyOverviewGrid|companyOperationsGrid/);
  assert.match(styles, /\.companySettingsColumns\{[\s\S]*?grid-template-columns:minmax\(0,1\.08fr\) minmax\(360px,\.92fr\)/);
  assert.match(styles, /\.companyPrimaryStack,[\s\S]*?flex-direction:column/);
  assert.match(styles, /\.companyDisclosureCard\[open\] > \.companySectionSummary::after\{ content:"−"; \}/);
  assert.match(styles, /\.companyPrimaryStack,[\s\S]*?display:contents/);
  assert.match(styles, /page\[data-page="company"\] \.companyBrandingCard \.upload\{[\s\S]*?flex-direction:row/);
});

test("uses country-aware regulatory workspaces and fails closed without a qualified adapter", async () => {
  const [html, app, route, integrations, styles, ...dictionarySources] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/integrations.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
    ...["fr", "en", "sr", "it", "es"].map((locale) => readFile(new URL(`../renderer/i18n/${locale}.json`, import.meta.url), "utf8")),
  ]);
  assert.match(html, /id="company-reporting-card"/);
  assert.match(html, /id="cf-obligations"/);
  assert.match(html, /id="cf-transmissions"/);
  assert.match(html, /id="cf-review-dialog"/);
  assert.match(html, /data-reporting-filter="review"/);
  assert.match(html, /id="cf-pa-reporting-submit-path"/);
  assert.doesNotMatch(html, /id="cf-scope"|id="cf-kpi-flux8"|id="cf-ai-chat"/);
  assert.match(app, /REPORTING_PROFILE_UI/);
  assert.match(app, /cfLoadOperationalReport/);
  assert.match(app, /function cfRenderReviewDialog/);
  assert.match(app, /data-reporting-candidate-id/);
  assert.match(app, /cfOpenReportingCandidate/);
  assert.match(route, /fr_structured_invoice_data_8_9/);
  assert.match(route, /fr_b2c_payments_10_4/);
  assert.match(route, /rs_foreign_vat_records/);
  assert.match(route, /it_cross_border/);
  assert.match(route, /es_verifactu_records/);
  assert.match(route, /D2F_REGULATORY_BATCH_V1/);
  assert.match(route, /candidates: candidates\.map\(candidateSummary\)/);
  assert.match(route, /Transmission bloquée : la recette métier/);
  assert.doesNotMatch(route, /const flux8 = issued\.filter|const flux9 = issued\.filter|type: "e-reporting"/);
  assert.match(integrations, /reporting_adapter_qualified/);
  assert.match(styles, /\.reportingKpis/);
  assert.match(styles, /\.reportingReviewDialog/);
  assert.match(styles, /\.reportingReviewCandidate/);
  for (const source of dictionarySources) {
    const dictionary = JSON.parse(source);
    assert.ok(dictionary["reporting.profile.fr.title"]);
    assert.ok(dictionary["reporting.profile.rs.title"]);
    assert.ok(dictionary["reporting.obligation.rs_foreign_vat_records.description"]);
    assert.ok(dictionary["reporting.review.step.open_documents"]);
    assert.ok(dictionary["reporting.review.open_invoice"]);
  }
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
  assert.match(config, /"D2F_MONTHLY_PRICE_EUR": "29"/);
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
  assert.match(shell, /ACCÈS D2F GESTION/);
  assert.match(shell, /confirmTransfer/);
  assert.match(shell, /Confirmer reçu \+/);
  assert.match(accounts, /currentPeriodStart && account\.subscription\.currentPeriodEnd/);
  assert.match(accounts, /account\.subscription\.status !== "payment_declared"/);
  assert.match(signup, /acceptPaymentTerms/);
  assert.match(subscription, /body\.confirmTransfer !== true/);
});

test("shows a dynamic official regulatory watch only for supported establishment countries", async () => {
  const [shell, watch, portal, identifiers, styles] = await Promise.all([
    readFile(new URL("../app/session-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/regulatory-watch.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/portal-i18n.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/company-identifiers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /className="auth-regulatory"/);
  assert.match(shell, /regulatoryCountries.map/);
  assert.match(shell, /window.setInterval/);
  assert.match(shell, /aria-live="polite"/);
  assert.doesNotMatch(shell, /option value="DE"|option value="OTHER"/);
  assert.doesNotMatch(portal, /Germany|Allemagne|Nemačka|Germania|Alemania/);
  assert.ok(watch.includes('regulatoryCountries = ["FR", "RS", "IT", "ES"]'));
  assert.ok(watch.includes("economie.gouv.fr/tout-savoir-sur-la-facturation-electronique"));
  assert.ok(watch.includes("efaktura.gov.rs/vest/en/8335"));
  assert.ok(watch.includes("agenziaentrate.gov.it/web_app_entrate/fatturazione_elettronica"));
  assert.ok(watch.includes("agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu"));
  assert.equal(Array.from(watch.matchAll(/officialSource: "/g)).length, 5);
  assert.ok(identifiers.includes('SUPPORTED_ESTABLISHMENT_COUNTRIES = ["FR", "RS", "IT", "ES"]'));
  assert.ok(identifiers.includes('if (!isSupportedEstablishmentCountry(country)) throw new Error'));
  assert.ok(styles.includes('.regulatory-countries{ display:grid; grid-template-columns:repeat(4'));
  assert.ok(styles.includes('@media (max-width:620px){') && styles.includes('.auth-regulatory{ grid-column:1 / -1;'));
});

test("shows monthly and annual tariffs before establishment registration in every portal language", async () => {
  const [page, shell, styles, portal, auth, envExample] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/session-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/portal-i18n.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(page, /publicBillingConfig\(\)/);
  assert.match(page, /annualAmountEur/);
  assert.match(shell, /className="pricing-card"/);
  assert.match(shell, /formatPortalPrice\(monthlyPriceEur, locale\)/);
  assert.match(shell, /formatPortalPrice\(annualPriceEur, locale\)/);
  assert.match(shell, /billingTerm === "annual"/);
  assert.match(styles, /\.pricing-card\s*\{/);
  assert.match(styles, /\.pricing-card ul \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.equal(Array.from(portal.matchAll(/pricingPlan: "/g)).length, 5);
  assert.equal(Array.from(portal.matchAll(/pricingCommitment: "/g)).length, 5);
  assert.match(portal, /2 utilisateurs inclus/);
  assert.match(portal, /2 users included/);
  assert.match(portal, /2 korisnika uključena/);
  assert.match(portal, /2 utenti inclusi/);
  assert.match(portal, /2 usuarios incluidos/);
  assert.match(auth, /D2F_MONTHLY_PRICE_EUR \|\| "29"/);
  assert.match(auth, /D2F_ANNUAL_PRICE_EUR \|\| "290"/);
  assert.match(envExample, /D2F_MONTHLY_PRICE_EUR=29/);
  assert.match(envExample, /D2F_ANNUAL_PRICE_EUR=290/);
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
  assert.match(app, /\["quotes:accept", "quotes:reject"\]\.includes\(actionId\)/);
  assert.match(app, /return \["quotes:accept", "quotes:reject"\]/);
  assert.match(route, /draft: \["sent", "accepted", "rejected"\]/);
  assert.match(route, /sent: \["accepted", "rejected"\]/);
  assert.match(route, /Transition de devis interdite/);
});

test("supports click and drop CSV history imports for quotes and invoices", async () => {
  const [html, app, route, styles] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="documentCsvImportFile" type="file" accept="\.csv/);
  assert.match(html, /id="documentCsvDropzone"/);
  assert.match(app, /case "quotes:importCsv"/);
  assert.match(app, /case "invoices:importCsv"/);
  assert.match(app, /dropzone\.ondrop/);
  assert.match(app, /documentRowsFromCsv/);
  assert.match(route, /Historical CSV imports are deliberately read-only/);
  assert.match(route, /historical_import: true/);
  assert.match(styles, /\.documentCsvDropzone\{/);
});

test("keeps every command once in an adaptive desktop and mobile action bar", async () => {
  const [html, app, styles, portalStyles] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const action of ["clients:new", "clients:importCsv", "items:new", "quotes:new", "invoices:new", "inbound:refresh", "inbound:import"]) {
    assert.equal(Array.from(html.matchAll(new RegExp(`data-action="${action}"`, "g"))).length, 0, `${action} is duplicated outside the toolbar`);
  }
  for (const action of ["payments:record", "company:chooseLogo", "company:clearLogo"]) {
    assert.equal(Array.from(html.matchAll(new RegExp(`data-action="${action}"`, "g"))).length, 1, `${action} must have one contextual entry point`);
  }

  assert.match(app, /function toolbarDirectActionIds\(moduleKey\)/);
  assert.match(app, /className = "toolbarMore"/);
  assert.match(app, /className = "toolbarMore__menu"/);
  assert.match(styles, /D2F 2026 light interface/);
  assert.match(styles, /\.toolbarMore__menu\s*\{/);
  assert.match(styles, /@media \(max-width:760px\)[\s\S]*\.toolbarMore__text\{ display:none; \}/);
  assert.match(portalStyles, /D2F 2026 light portal/);
  assert.match(portalStyles, /\.account-bar\{[\s\S]*background:#fff;/);
  const navigation = html.match(/<nav class="nav" id="navModules">([\s\S]*?)<\/nav>/)?.[1] || "";
  assert.doesNotMatch(navigation, /[🏢📊👥🧩📝🧾💳📥🚀✅📜]/u);
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
  assert.match(app, /peppol_directory_checked_at: new Date\(\)\.toISOString\(\)/);
  assert.match(app, /clients\.peppol\.verified_saved/);
  assert.match(app, /conformity\.invoicePreflight/);
  assert.match(route, /directory:lookupPeppol/);
  assert.match(route, /function normalizePeppolEndpoint/);
  assert.match(route, /iso6523-actorid-upis:\{1,2\}/);
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
  assert.equal(receivables.effectiveDueDate({ date: "2026-07-01", due_date: "2026-07-20" }, {}), "2026-07-20");
  assert.equal(receivables.effectiveDueDate({ date: "2026-07-01" }, { payment_term: "NET_15" }), "2026-07-16");
  assert.equal(receivables.effectiveDueDate({ date: "2026-07-01" }, { payment_term: "DUE_ON_RECEIPT", payment_days: 10 }), "2026-07-11");
  assert.equal(receivables.effectiveDueDate({ date: "2026-07-01" }, {}), "");

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

test("stores country-aware PAF evidence with integrity and archive handoff", async () => {
  const [html, app, route, shim, styles, ...dictionaries] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/renderer/web-api-shim.js", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
    ...["fr", "en", "it", "es", "sr"].map((locale) => readFile(new URL(`../renderer/i18n/${locale}.json`, import.meta.url), "utf8")),
  ]);
  assert.match(html, /id="cf-evidence-vault"/);
  assert.match(html, /id="cf-evidence-add"/);
  assert.match(html, /id="cf-evidence-export"/);
  assert.match(app, /conformity\.listEvidence/);
  assert.match(app, /conformity\.archiveEvidence/);
  assert.match(route, /d2f-compliance-evidence/);
  assert.match(route, /sha256Bytes/);
  assert.match(route, /actualHash !== String\(document\.sha256/);
  assert.match(route, /status: "voided"/);
  assert.match(route, /source: "compliance_evidence"/);
  assert.match(shim, /pickEvidence/);
  assert.match(styles, /\.complianceEvidenceItem/);
  for (const dictionary of dictionaries) {
    assert.match(dictionary, /"conformity\.evidence\.title"/);
    assert.match(dictionary, /"conformity\.evidence\.profile\.fr_paf\.label"/);
  }
});


test("keeps client activation under D2F control and supports one reviewed trial", async () => {
  const [accounts, adminRoute, shell, auth, signup, envExample, workerConfig] = await Promise.all([
    readFile(new URL("../lib/saas/accounts.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/admin/companies/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/session-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/signup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.cloudflare.jsonc", import.meta.url), "utf8"),
  ]);
  assert.match(adminRoute, /isPlatformAdminEmail/);
  assert.match(adminRoute, /body\.status === "trial"/);
  assert.match(accounts, /requestedStatus: "active" \| "suspended" \| "trial"/);
  assert.match(accounts, /addUtcDays\(periodStart, TRIAL_DAYS - 1\)/);
  assert.match(accounts, /requestTrialAccess/);
  assert.match(accounts, /selectBillingTerm/);
  assert.match(accounts, /addUtcYear/);
  assert.match(accounts, /prefillCompanyProfile/);
  assert.match(accounts, /Une période d’essai ou d’abonnement a déjà été accordée/);
  assert.match(shell, /className="admin-request-button"/);
  assert.match(shell, /window\.setInterval\(refreshRequests, 60000\)/);
  assert.match(shell, /Accorder 14 jours d’essai/);
  assert.match(shell, /className="signup-payment-card"/);
  assert.match(shell, /linkedin\.com\/in\/d2fcompliant11030\/recent-activity\/all/);
  assert.match(shell, /https:\/\/d2fcompliant\.com/);
  assert.match(shell, /Demander mes 14 jours d’essai/);
  assert.match(shell, /Démarrer l’essai demandé/);
  assert.match(auth, /RS35160600000229522419/);
  assert.match(auth, /DBDBRSBG/);
  assert.match(signup, /billing: publicBillingConfig\(\)/);
  assert.match(envExample, /D2F_BILLING_IBAN=RS35160600000229522419/);
  assert.match(envExample, /D2F_ANNUAL_PRICE_EUR=290/);
  assert.match(workerConfig, /"D2F_BILLING_BIC": "DBDBRSBG"/);
  assert.match(workerConfig, /"D2F_ANNUAL_PRICE_EUR": "290"/);
});

test("provides a decision-ready dashboard, monthly revenue and ticket actions", async () => {
  const [route, dashboard, styles, shell, identifiers, validationRoute, signup, erpApp] = await Promise.all([
    readFile(new URL("../app/rpc/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/dashboard-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../app/session-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/company-identifiers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/validate-identifier/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/signup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
  ]);
  assert.match(route, /recognized_ht_monthly/);
  assert.match(route, /creditSourceId\(invoice\)/);
  assert.match(route, /outstanding_ttc/);
  assert.match(route, /overdue_count/);
  assert.match(route, /effectiveDueDate/);
  assert.match(route, /missing_due_count/);
  assert.match(route, /conversion_rate/);
  assert.match(dashboard, /recognizedSeries/);
  assert.match(dashboard, /fetchSupportDashboard/);
  assert.match(dashboard, /data-support-ticket/);
  assert.match(dashboard, /const openTickets = supportTickets\.filter/);
  assert.match(dashboard, /support\?\.isAdmin \? mt\("viewQueue"\)/);
  assert.match(dashboard, /dashSupportSummary/);
  assert.match(dashboard, /data-support-filter/);
  assert.match(dashboard, /d2f-support-updated/);
  assert.match(dashboard, /refreshDashboard\(\{ force: true \}\)/);
  assert.match(dashboard, /_supportTicketFilter === "closed"/);
  assert.match(dashboard, /const closedTickets = supportTickets\.filter/);
  assert.match(dashboard, /data-open-module="payments"/);
  assert.match(styles, /Management cockpit/);
  assert.match(styles, /\.dashManagementGrid/);
  assert.match(styles, /\.dashSupportSummary/);
  assert.match(styles, /\.dashSupportFilters/);
  assert.match(shell, /d2f-open-support/);
  assert.match(shell, /initialTicketId=\{supportTicketId\}/);
  assert.match(shell, /onChanged=\{notifySupportChanged\}/);
  assert.match(shell, /type: "d2f-support-updated"/);
  assert.match(identifiers, /function frenchSiretValid/);
  assert.match(identifiers, /function serbianPibValid/);
  assert.match(identifiers, /function italianPartitaIvaValid/);
  assert.match(identifiers, /function italianCodiceFiscaleValid/);
  assert.match(identifiers, /function spanishNifValid/);
  assert.match(validationRoute, /recherche-entreprises\.api\.gouv\.fr/);
  assert.match(validationRoute, /closed_establishment/);
  assert.match(signup, /validateEstablishmentIdentifier/);
  assert.match(erpApp, /due_date: \$\("i-due-date"\)/);
  assert.match(erpApp, /invoices\.error\.due_date_required/);
  assert.match(erpApp, /applyInvoiceClientPaymentDefaults/);
});

test("provides tenant-scoped support tickets with guided level-1 triage and tracked notifications", async () => {
  const [migration, workflowMigration, support, route, center, i18n, shell, styles, envExample, workerConfig] = await Promise.all([
    readFile(new URL("../supabase/migrations/20260717140000_support_tickets.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260717160000_support_dashboard_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/support.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/auth/support/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/support-center.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/support-i18n.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/session-shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.cloudflare.jsonc", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /create sequence if not exists public\.d2f_support_ticket_seq/);
  assert.match(migration, /create table if not exists public\.d2f_support_tickets/);
  assert.match(migration, /create table if not exists public\.d2f_support_messages/);
  assert.match(migration, /create table if not exists public\.d2f_support_notifications/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.d2f_support_tickets from anon, authenticated/);
  assert.match(workflowMigration, /ticket_scope/);
  assert.match(workflowMigration, /request_type/);
  assert.match(support, /\.eq\("owner_email", session\.ownerKey\)/);
  assert.match(support, /String\(ticket\.tenant_id \|\| ""\) !== session\.tenantId/);
  assert.match(support, /_support_tickets/);
  assert.match(support, /isPlatformAdminEmail\(session\.email\)/);
  assert.match(support, /support@d2fcompliant\.com/);
  assert.match(support, /D2F_SUPPORT_MAIL_WEBHOOK_URL/);
  assert.match(support, /Assistant D2F niveau 1/);
  assert.match(support, /quoteContext && actionContext \? "quote_actions"/);
  assert.match(support, /Inutile de recharger la page/);
  assert.match(support, /Le parcours actuel centralise ces actions dans Exports/);
  assert.doesNotMatch(support, /Pré-diagnostic niveau 1 : rechargez la page/);
  assert.match(support, /generativeAiConfigured: false/);
  assert.match(route, /readAppSession/);
  assert.match(route, /createSupportTicket/);
  assert.match(route, /addSupportMessage/);
  assert.match(route, /reanalyzeSupportTicket/);
  assert.match(route, /updateSupportStatus/);
  assert.match(center, /className="support-center"/);
  assert.match(center, /D2F COMPLIANT · VERSION 2\.1\.5/);
  assert.match(center, /copy\.adminTitle/);
  assert.match(center, /copy\.newInternalTicket/);
  assert.match(center, /supportApi\("PATCH"/);
  assert.match(center, /action: "reanalyze"/);
  assert.match(center, /copy\.reanalyze/);
  assert.match(center, /onChanged\(\)/);
  assert.match(center, /name="contactEmail"/);
  assert.match(center, /name="ticketScope"/);
  assert.match(center, /name="requestType"/);
  assert.match(shell, /className="support-header-button"/);
  assert.match(shell, /window\.setInterval\(refreshSupport, 60000\)/);
  assert.match(styles, /\.support-layout\{ min-height:0; display:grid; grid-template-columns:360px/);
  assert.match(styles, /\.support-reanalyze/);
  assert.match(styles, /@media\(max-width:680px\)/);
  assert.equal(Array.from(i18n.matchAll(/title: "(?:Support D2F|D2F Support|D2F podrška|Supporto D2F|Soporte D2F)"/g)).length, 5);
  assert.match(envExample, /D2F_SUPPORT_EMAIL=support@d2fcompliant\.com/);
  assert.match(workerConfig, /"D2F_SUPPORT_EMAIL": "support@d2fcompliant\.com"/);
});

test("provides a translated workflow companion on every application module", async () => {
  const [html, app, styles, ...dictionarySources] = await Promise.all([
    readFile(new URL("../public/erp/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/erp/styles.css", import.meta.url), "utf8"),
    ...["fr", "en", "sr", "it", "es"].map((locale) => readFile(new URL("../renderer/i18n/" + locale + ".json", import.meta.url), "utf8")),
  ]);
  assert.match(html, /id="workflowCompanionToggle"/);
  assert.match(html, /id="workflowCompanionPanel"/);
  assert.match(app, /const WORKFLOW_GUIDES = \{/);
  assert.match(app, /function renderWorkflowCompanion\(moduleKey\)/);
  assert.match(app, /initWorkflowCompanion\(\)/);
  assert.match(app, /renderWorkflowCompanion\(cur\)/);
  for (const moduleName of ["company", "dashboard", "clients", "items", "quotes", "invoices", "payments", "inbound", "exports", "conformity", "audit"]) {
    assert.match(app, new RegExp("\\n  " + moduleName + ": \\{"));
  }
  assert.match(styles, /\.workflowCompanionToggle\{/);
  assert.match(styles, /\.workflowCompanionPanel\{/);
  assert.match(styles, /@media \(max-width:760px\)[\s\S]*\.workflowCompanionPanel/);
  for (const source of dictionarySources) {
    const dictionary = JSON.parse(source);
    assert.ok(dictionary["companion.open"]);
    assert.ok(dictionary["companion.conformity.step2"]);
    assert.ok(dictionary["companion.audit.expected"]);
  }
});
