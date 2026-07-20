import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("defines the strict DPRA canonical event envelope", async () => {
  const schema = await json("platform/contracts/events/event-envelope.v1.schema.json");
  assert.equal(schema.additionalProperties, false);
  for (const field of ["eventId", "eventType", "eventVersion", "producer", "subject", "context", "actor", "trace", "contract", "security", "payload"]) {
    assert.ok(schema.required.includes(field), field);
  }
  assert.equal(schema.properties.eventVersion.minimum, 1);
  assert.match(schema.properties.eventType.pattern, /A-Z/);
  assert.ok(schema.properties.security.required.includes("containsFinancialData"));
  assert.ok(schema.properties.trace.required.includes("correlationId"));
});

test("publishes canonical InvoiceIssued only from D2F Gestion", async () => {
  const schema = await json("platform/contracts/events/gestion.invoice.issued.v1.schema.json");
  const specialization = schema.allOf[1].properties;
  assert.equal(specialization.eventType.const, "InvoiceIssued");
  assert.equal(specialization.eventVersion.const, 1);
  assert.equal(specialization.subject.properties.aggregateType.const, "CustomerInvoice");
  assert.equal(specialization.producer.properties.application.const, "d2f-gestion");
  assert.ok(specialization.payload.required.includes("invoiceNumber"));
  assert.ok(specialization.payload.required.includes("totals"));
  assert.ok(specialization.payload.required.includes("lines"));
  assert.ok(specialization.payload.required.includes("routing"));
  assert.equal(schema.$defs.decimal.type, "string");
});

test("defines Expense lifecycle contracts without conflating accounting", async () => {
  const [submitted, approved] = await Promise.all([
    json("platform/contracts/events/expense-submitted.v1.schema.json"),
    json("platform/contracts/events/expense-approved.v1.schema.json"),
  ]);
  assert.equal(submitted.allOf[1].properties.eventType.const, "ExpenseSubmitted");
  assert.equal(approved.allOf[1].properties.eventType.const, "ExpenseApproved");
  assert.equal(submitted.allOf[1].properties.subject.properties.aggregateType.const, "ExpenseReport");
  assert.equal(approved.allOf[1].properties.producer.properties.application.const, "d2f-expense");
  assert.ok(approved.allOf[1].properties.payload.required.includes("approvedGross"));
});

test("country availability is capability-based and versioned", async () => {
  const schema = await json("platform/contracts/capabilities/country-capabilities.v1.schema.json");
  assert.deepEqual(schema.properties.capabilities.additionalProperties.enum, ["unsupported", "preview", "qualified", "production", "suspended"]);
  assert.ok(schema.required.includes("packVersion"));
  assert.ok(schema.required.includes("effectiveFrom"));
});

test("provides an RLS-protected Outbox, Inbox and policy-driven PA routing", async () => {
  const sql = await readFile(new URL("supabase/migrations/20260720110000_platform_event_backbone.sql", root), "utf8");
  assert.match(sql, /create table if not exists public\.d2f_event_outbox/);
  assert.match(sql, /create table if not exists public\.d2f_event_inbox/);
  assert.match(sql, /primary key \(consumer, event_id\)/);
  assert.match(sql, /where published_at is null/);
  assert.match(sql, /create or replace function public\.d2f_issue_invoice_v1/);
  assert.match(sql, /event_type = 'InvoiceIssued'/);
  assert.match(sql, /d2f_canonical_event_v1/);
  assert.match(sql, /d2f_pa_connectors_one_inbound_default_idx/);
  assert.doesNotMatch(sql, /one_active_inbound/);
  assert.match(sql, /is_default_inbound and direction in \('inbound', 'both'\)/);
  assert.match(sql, /outbound_selection_source := 'client'/);
});

test("creates separated Financial projections and Expense aggregates", async () => {
  const sql = await readFile(new URL("supabase/migrations/20260720130000_financial_expense_foundation.sql", root), "utf8");
  assert.match(sql, /create table if not exists public\.d2f_financial_invoice_projections/);
  assert.match(sql, /create table if not exists public\.d2f_financial_accounting_proposals/);
  assert.match(sql, /create table if not exists public\.d2f_expense_reports/);
  assert.match(sql, /create table if not exists public\.d2f_expense_lines/);
  assert.match(sql, /create table if not exists public\.d2f_expense_receipts/);
  assert.match(sql, /Only a draft or returned report can be submitted/);
  assert.match(sql, /Only a submitted report can be decided/);
  assert.match(sql, /'ExpenseSubmitted'/);
  assert.match(sql, /'ExpenseApproved'/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /revoke all .* from anon, authenticated/g);
  assert.match(sql, /drop constraint if exists d2f_event_outbox_envelope_version_chk/);
  assert.doesNotMatch(sql, /^as \$$|^\$;$/m);
});

test("routes the legacy issue command through the atomic platform boundary", async () => {
  const [route, helper, app] = await Promise.all([
    readFile(new URL("app/rpc/route.ts", root), "utf8"),
    readFile(new URL("lib/platform/issue-invoice.ts", root), "utf8"),
    readFile(new URL("public/erp/app.js", root), "utf8"),
  ]);
  assert.match(route, /issueInvoiceAtomically\(getSupabaseAdmin\(\)/);
  assert.match(route, /tenantId: tenantIdentity\?\.tenantId/);
  assert.match(helper, /d2f_issue_invoice_v1/);
  assert.match(app, /idempotency_key: "gestion:invoice:issue:" \+ id/);
});

test("exposes usable Financial and Expenses workspaces", async () => {
  const [html, ui, route, service, shim] = await Promise.all([
    readFile(new URL("public/erp/index.html", root), "utf8"),
    readFile(new URL("public/erp/financial-expense-ui.js", root), "utf8"),
    readFile(new URL("app/rpc/route.ts", root), "utf8"),
    readFile(new URL("lib/platform/financial-expense.ts", root), "utf8"),
    readFile(new URL("public/erp/renderer/web-api-shim.js", root), "utf8"),
  ]);
  for (const page of ["financial-overview", "financial-proposals", "financial-reconciliation", "financial-rules", "expenses-overview", "expenses-reports", "expenses-capture", "expenses-approvals", "expenses-rules"]) {
    assert.match(html, new RegExp(`data-module="${page}"`));
    assert.match(html, new RegExp(`data-page="${page}"`));
  }
  assert.match(html, /expense-report-title/);
  assert.match(html, /expense-submit-selected/);
  assert.match(ui, /window\.api\.expenses\.createReport/);
  assert.match(ui, /window\.api\.expenses\.addLine/);
  assert.match(ui, /window\.api\.expenses\.submit/);
  assert.match(ui, /window\.api\.expenses\.decide/);
  assert.match(ui, /financial:recordPayment/);
  assert.match(ui, /expenses:openCapture/);
  assert.match(ui, /platform:requestActivation/);
  assert.match(ui, /fetch\("\/auth\/support"/);
  assert.match(route, /method === "financial:workspace"/);
  assert.match(route, /actorRole !== "owner"/);
  assert.match(service, /d2f_expense_submit_v1/);
  assert.match(service, /d2f_expense_decide_v1/);
  assert.match(shim, /financial: ns\("financial"\)/);
  assert.match(shim, /expenses: ns\("expenses"\)/);
});


test("separates product menus, gates optional applications and captures smartphone receipts", async () => {
  const [html, app, ui, route, service, policy, migration] = await Promise.all([
    readFile(new URL("public/erp/index.html", root), "utf8"),
    readFile(new URL("public/erp/app.js", root), "utf8"),
    readFile(new URL("public/erp/financial-expense-ui.js", root), "utf8"),
    readFile(new URL("app/rpc/route.ts", root), "utf8"),
    readFile(new URL("lib/platform/financial-expense.ts", root), "utf8"),
    readFile(new URL("lib/platform/expense-country-policy.ts", root), "utf8"),
    readFile(new URL("supabase/migrations/20260720143000_platform_applications_and_expense_capture.sql", root), "utf8"),
  ]);
  assert.match(html, /data-application="gestion"[\s\S]*D2F Gestion/);
  assert.match(html, /data-application="financial"[\s\S]*D2F Financial/);
  assert.match(html, /data-application="expenses"[\s\S]*D2F Expenses/);
  assert.match(html, /id="expense-receipt-file"[^>]*capture="environment"/);
  assert.match(html, /id="expense-receipt-drop"/);
  assert.match(app, /platform.capabilities/);
  assert.match(app, /!\["gestion", "support"\]\.includes\(application\)/);
  assert.match(html, /data-application="support"[\s\S]*D2F Support/);
  assert.match(app, /type: "d2f-open-support"/);
  assert.match(ui, /window.api.expenses.uploadReceipt/);
  assert.match(route, /d2f_tenant_applications/);
  assert.match(route, /option D2F Financial n'est pas active/);
  assert.match(route, /option D2F Expenses n'est pas active/);
  assert.match(service, /d2f-expense-receipts/);
  assert.match(service, /capture_context/);
  assert.match(service, /SHA-256/);
  assert.match(policy, /manual_review_required/);
  assert.match(migration, /primary key \(tenant_id, application\)/);
  assert.match(migration, /capture_location jsonb/);
});


test("requires governed evidence and dual approval before Country Pack publication", async () => {
  const [schema, migration, route, html, app] = await Promise.all([
    json("platform/contracts/governance/country-pack-qualification.v1.schema.json"),
    readFile(new URL("supabase/migrations/20260720160000_country_pack_governance.sql", root), "utf8"),
    readFile(new URL("app/rpc/route.ts", root), "utf8"),
    readFile(new URL("public/erp/index.html", root), "utf8"),
    readFile(new URL("public/erp/app.js", root), "utf8"),
  ]);
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes("regulatoryOwner"));
  assert.ok(schema.required.includes("technicalOwner"));
  assert.match(migration, /d2f_country_pack_evidence/);
  assert.match(migration, /d2f_country_pack_reviews/);
  assert.match(migration, /Regulatory and technical approvals are required/);
  assert.doesNotMatch(route, /new Set\(\["FR", "RS", "IT", "ES"\]\)/);
  assert.match(route, /d2f_country_pack_versions/);
  assert.match(html, /data-module="support-center"/);
  assert.match(app, /function sortedModuleRows/);
  assert.match(app, /function installSortableTables/);
});


test("provides an admin-only Country Pack qualification and publication centre", async () => {
  const [service, route, center, supportCenter, copies, styles] = await Promise.all([
    readFile(new URL("lib/country-pack-admin.ts", root), "utf8"),
    readFile(new URL("app/auth/admin/country-packs/route.ts", root), "utf8"),
    readFile(new URL("app/country-pack-center.tsx", root), "utf8"),
    readFile(new URL("app/support-center.tsx", root), "utf8"),
    readFile(new URL("app/country-pack-i18n.ts", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(route, /isPlatformAdminEmail\(session\.email\)/);
  assert.match(route, /action === "evidence"/);
  assert.match(route, /action === "review"/);
  assert.match(route, /action === "publish"/);
  assert.match(route, /updateSupportStatus/);
  assert.match(service, /verification_status === "verified"/);
  assert.match(service, /verification: \{ actor: actorEmail/);
  assert.match(service, /evidence_snapshot_hash === evidenceSnapshotHash/);
  assert.match(service, /Regulatory|réglementaire/i);
  assert.match(service, /d2f_publish_country_pack_v1/);
  assert.match(center, /country-pack-readiness/);
  assert.match(center, /\["regulatory", "technical", "security"\]/);
  assert.match(center, /disabled=\{busy \|\| !selected\.readiness\.publishable\}/);
  assert.match(supportCenter, /copy\.qualifyCountryPack/);
  assert.match(supportCenter, /view === "countryPacks"/);
  assert.match(styles, /\.country-pack-center/);
  for (const locale of ["fr", "en", "sr", "it", "es"]) assert.match(copies, new RegExp("\\b" + locale + ":"));
});

test("implements Chapters 16-18 canonical ownership and settlement invariants", async () => {
  const [model, paymentEvent, migration, route, paymentService, financeService, expensePolicy, html] = await Promise.all([
    json("platform/contracts/models/commercial-object.v1.schema.json"),
    json("platform/contracts/events/gestion.customer-payment.registered.v1.schema.json"),
    readFile(new URL("supabase/migrations/20260720170000_commercial_financial_expense_invariants.sql", root), "utf8"),
    readFile(new URL("app/rpc/route.ts", root), "utf8"),
    readFile(new URL("lib/platform/register-customer-payment.ts", root), "utf8"),
    readFile(new URL("lib/platform/financial-expense.ts", root), "utf8"),
    readFile(new URL("lib/platform/expense-country-policy.ts", root), "utf8"),
    readFile(new URL("public/erp/index.html", root), "utf8"),
  ]);
  assert.equal(model.properties.authoritativeOwner.const, "d2f-gestion");
  assert.ok(model.$defs.quote);
  assert.ok(model.$defs.payment);
  assert.ok(model.$defs.settlement);
  for (const field of ["identifiers", "taxIdentifiers", "addresses", "electronicAddresses"]) assert.ok(model.$defs.partySnapshot.required.includes(field));
  assert.equal(paymentEvent.allOf[1].properties.eventType.const, "InvoicePaymentRegistered");
  assert.equal(paymentEvent.allOf[1].properties.producer.properties.application.const, "d2f-gestion");
  assert.equal(paymentEvent.allOf[1].properties.subject.properties.aggregateType.const, "CustomerPayment");
  assert.match(migration, /d2f_financial_customer_payment_projections/);
  assert.match(migration, /d2f_financial_settlement_projections/);
  assert.match(migration, /d2f_enforce_expense_segregation_v1/);
  assert.match(migration, /drop constraint if exists d2f_financial_invoice_snapshot_hash_chk/);
  assert.match(route, /registerCustomerPaymentAtomically/);
  assert.match(paymentService, /d2f_register_customer_payment_v1/);
  assert.match(financeService, /d2f_financial_consume_customer_payment_v1/);
  assert.match(financeService, /claimant_id.*actorId/);
  assert.match(expensePolicy, /d2f_country_pack_versions/);
  assert.doesNotMatch(expensePolicy, /QUALIFIED_COUNTRIES/);
  assert.match(html, /expense-line-payment-method/);
  assert.match(html, /expense-line-personal/);
});


test("makes Expenses operational and secure for every supported country and device", async () => {
  const [migration, service, route, html, ui, styles] = await Promise.all([
    readFile(new URL("supabase/migrations/20260720180000_expenses_operational_all_countries.sql", root), "utf8"),
    readFile(new URL("lib/platform/financial-expense.ts", root), "utf8"),
    readFile(new URL("app/rpc/route.ts", root), "utf8"),
    readFile(new URL("public/erp/index.html", root), "utf8"),
    readFile(new URL("public/erp/financial-expense-ui.js", root), "utf8"),
    readFile(new URL("public/erp/styles.css", root), "utf8"),
  ]);
  for (const country of ["FR", "RS", "IT", "ES"]) assert.match(migration, new RegExp("'" + country + "'"));
  assert.match(migration, /legalThresholds.*human_validation_required/s);
  assert.match(migration, /d2f_preserve_expense_receipt_original_v1/);
  assert.match(migration, /verified_media_type/);
  assert.match(migration, /claimant_id<>p_actor_id/);
  assert.match(migration, /claimant_id=p_actor_id/);
  assert.match(service, /actorRole !== "owner".*claimant_id/s);
  assert.match(service, /verifiedReceiptMediaType/);
  assert.match(service, /createSignedUrl.*120/);
  assert.match(service, /Seul le demandeur peut ajouter un justificatif/);
  assert.match(route, /expenses:receiptAccess/);
  assert.match(html, /id="expense-mobile-reports"/);
  assert.match(html, /id="expense-claimant-filter"/);
  assert.match(html, /id="expense-receipts-list"/);
  assert.match(ui, /report.can_edit/);
  assert.match(ui, /report.can_approve/);
  assert.match(ui, /expenses:viewReceipt/);
  assert.match(styles, /.expenseMobileReports/);
  assert.match(styles, /max-width:760px/);
});


test("ships four sourced Country Packs without automatic publication", async () => {
  const countries = ["FR", "RS", "IT", "ES"];
  const schema = await json("platform/contracts/country-packs/expense-country-pack.v1.schema.json");
  assert.equal(schema.properties.automaticPublication.const, false);
  for (const country of countries) {
    const pack = await json("country-packs/" + country + "/expenses-2026.1.0.json");
    assert.equal(pack.country, country);
    assert.equal(pack.lifecycleStatus, "regulatory_review");
    assert.equal(pack.automaticPublication, false);
    assert.ok(pack.expense.rules.length >= 4);
    assert.ok(pack.sources.length >= 3);
    assert.ok(pack.sources.every((source) => /^https:\/\//.test(source.url)));
    assert.equal(pack.governance.securityApprovalRequired, true);
  }
  const migration = await readFile(new URL("supabase/migrations/20260720193000_expense_country_packs_2026_1.sql", root), "utf8");
  assert.match(migration, /Regulatory, technical and security approvals are required/);
  assert.match(migration, /Every Country Pack evidence item must be verified/);
  assert.match(migration, /Automatic Country Pack publication is forbidden/);
  assert.doesNotMatch(migration, /perform public\.d2f_publish_country_pack_v1/);
});
