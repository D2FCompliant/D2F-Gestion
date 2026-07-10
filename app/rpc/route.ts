import fr from "../../renderer/i18n/fr.json";
import en from "../../renderer/i18n/en.json";
import es from "../../renderer/i18n/es.json";
import it from "../../renderer/i18n/it.json";
import sr from "../../renderer/i18n/sr.json";
import rejectionReasons from "../../Electron/resources/rejection-reasons.xp-z12-012.v1.2.json";
import { getOwnerEmail, getSupabaseAdmin, SupabaseConfigurationError } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
type Entity = "clients" | "items" | "quotes" | "invoices" | "payments" | "inbound";

const dictionaries: Record<string, unknown> = { fr, en, es, it, sr };
const entities = new Set<Entity>(["clients", "items", "quotes", "invoices", "payments", "inbound"]);

function reply(result: unknown, status = 200) {
  return Response.json({ ok: status < 400, ...(status < 400 ? { result } : { error: result }) }, { status, headers: { "cache-control": "no-store" } });
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function jsonObject(value: unknown): JsonRecord {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return object(JSON.parse(value));
  } catch {
    return {};
  }
}

function first(args: unknown[]) {
  return args[0];
}

function idFrom(value: unknown) {
  if (typeof value === "string") return value;
  const valueObject = object(value);
  return String(valueObject.id || valueObject.quoteId || valueObject.invoiceId || valueObject.paymentId || "");
}

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function defaultCompany() {
  return {
    id: "1",
    name: "",
    legal_name: "",
    legal_id: "",
    vat_id: "",
    country: "FR",
    currency: "EUR",
    meta_json: "{}",
  };
}

function normalizeRecord(entity: Entity, raw: JsonRecord) {
  const normalized = { ...raw };
  if (entity === "items") {
    normalized.name = String(raw.name || raw.label || "").trim();
    normalized.label = normalized.name;
    normalized.ref = String(raw.ref || "").trim();
    normalized.unit_code = String(raw.unit_code || "C62");
    normalized.unit_price_ht = numberValue(raw.unit_price_ht);
    normalized.tva_percent = numberValue(raw.tva_percent ?? 20);
    normalized.active = raw.active === false || raw.active === 0 || raw.active === "0" ? 0 : 1;
    normalized.item_type = String(raw.item_type || "SERVICE");
  }
  if (entity === "clients") {
    normalized.name = String(raw.name || "").trim();
    normalized.customer_type = String(raw.customer_type || "B2C");
    normalized.country = String(raw.country || "FR").toUpperCase();
    normalized.postal_code = String(raw.postal_code || raw.postal || "");
    normalized.postal = normalized.postal_code;
    normalized.vat_subject = raw.vat_subject === 0 || raw.vat_subject === "0" ? 0 : 1;
  }
  if (entity === "quotes" || entity === "invoices") {
    const lines = Array.isArray(raw.lines) ? raw.lines.map((line, index) => {
      const item = object(line);
      const quantity = numberValue(item.quantity || 1);
      const unitPrice = numberValue(item.unit_price_ht);
      const discount = numberValue(item.remise_percent);
      const lineTotal = round2(quantity * unitPrice * (1 - discount / 100));
      return { ...item, id: String(item.id || crypto.randomUUID()), position: index, quantity, unit_price_ht: unitPrice, remise_percent: discount, total_ht: lineTotal };
    }) : [];
    const totalHt = lines.length ? round2(lines.reduce((sum, line) => sum + numberValue(line.total_ht), 0)) : numberValue(raw.total_ht);
    const totalTva = lines.length ? round2(lines.reduce((sum, line) => sum + numberValue(line.total_ht) * numberValue(line.tva_percent) / 100, 0)) : numberValue(raw.total_tva);
    normalized.lines = lines;
    normalized.date = String(raw.date || today());
    normalized.currency = String(raw.currency || "EUR");
    normalized.status = String(raw.status || "draft");
    normalized.total_ht = totalHt;
    normalized.total_tva = totalTva;
    normalized.total_ttc = round2(totalHt + totalTva);
    if (entity === "invoices") {
      normalized.type = String(raw.type || "final");
      normalized.amount_due = numberValue(raw.amount_due || normalized.total_ttc);
    }
  }
  if (entity === "payments") {
    normalized.date = String(raw.date || today());
    normalized.amount = numberValue(raw.amount);
    normalized.method = String(raw.method || "bank_transfer");
    normalized.status = String(raw.status || "posted");
    normalized.direction = String(raw.direction || "in");
    normalized.invoice_id = String(raw.invoice_id || raw.invoiceId || "");
  }
  return normalized;
}

function searchText(data: JsonRecord) {
  return [data.name, data.label, data.ref, data.number, data.invoice_number, data.email, data.vat_id, data.description]
    .filter(Boolean).join(" ").toLowerCase().slice(0, 2000);
}

async function listRecords(ownerEmail: string, entity: Entity, query: JsonRecord = {}) {
  const supabase = getSupabaseAdmin();
  let request = supabase.from("d2f_records").select("id,data,created_at,updated_at")
    .eq("owner_email", ownerEmail).eq("entity", entity).order("updated_at", { ascending: false }).limit(500);
  const q = String(query.q || query.term || "").trim();
  if (q) request = request.ilike("search_text", `%${q}%`);
  if (entity === "payments" && (query.invoiceId || query.invoice_id)) {
    request = request.eq("parent_id", String(query.invoiceId || query.invoice_id));
  }
  const { data, error } = await request;
  if (error) throw error;
  return (data || []).map((row) => ({ ...object(row.data), id: row.id, created_at: row.created_at, updated_at: row.updated_at }));
}

async function getRecord(ownerEmail: string, entity: Entity, id: string) {
  if (!id) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("d2f_records").select("id,data,created_at,updated_at")
    .eq("owner_email", ownerEmail).eq("entity", entity).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? { ...object(data.data), id: data.id, created_at: data.created_at, updated_at: data.updated_at } : null;
}

async function saveRecord(ownerEmail: string, entity: Entity, input: JsonRecord) {
  const supabase = getSupabaseAdmin();
  const id = String(input.id || crypto.randomUUID());
  const previous = await getRecord(ownerEmail, entity, id);
  const normalized = normalizeRecord(entity, { ...(previous || {}), ...input, id });
  delete normalized.owner_email;
  const row = {
    id,
    owner_email: ownerEmail,
    entity,
    search_text: searchText(normalized),
    status: String(normalized.status || ""),
    document_number: String(normalized.invoice_number || normalized.number || ""),
    document_date: normalized.date ? String(normalized.date).slice(0, 10) : null,
    parent_id: String(normalized.invoice_id || normalized.client_id || normalized.quote_id || "") || null,
    data: normalized,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from("d2f_records").upsert(row, { onConflict: "id" }).select("id,data,created_at,updated_at").single();
  if (error) throw error;
  return { ...object(data.data), id: data.id, created_at: data.created_at, updated_at: data.updated_at };
}

async function removeRecord(ownerEmail: string, entity: Entity, id: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("d2f_records").delete().eq("owner_email", ownerEmail).eq("entity", entity).eq("id", id);
  if (error) throw error;
  return { ok: true, id };
}

async function getCompany(ownerEmail: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("d2f_company").select("data,created_at,updated_at").eq("owner_email", ownerEmail).maybeSingle();
  if (error) throw error;
  if (!data) return defaultCompany();
  const company = object(data.data);
  const meta = { ...jsonObject(company.meta_json), ...object(company.meta) };
  const useCaseMeta = jsonObject(company.use_case_meta_json);
  const conformity = { ...object(useCaseMeta.conformity), ...object(company.conformity) };
  return {
    ...defaultCompany(),
    ...company,
    meta,
    conformity,
    annual_target_ht: numberValue(company.annual_target_ht ?? meta.annual_target_ht),
    created_at: data.created_at,
    updated_at: data.updated_at,
  };
}

async function saveCompany(ownerEmail: string, input: JsonRecord) {
  const supabase = getSupabaseAdmin();
  const previous = await getCompany(ownerEmail);
  const company = { ...previous, ...input, id: "1" };
  delete company.owner_email;
  const { data, error } = await supabase.from("d2f_company").upsert({ owner_email: ownerEmail, data: company, updated_at: new Date().toISOString() }, { onConflict: "owner_email" }).select("data,created_at,updated_at").single();
  if (error) throw error;
  return { ...object(data.data), created_at: data.created_at, updated_at: data.updated_at };
}

function groupCount(records: JsonRecord[], field: string) {
  return records.reduce<Record<string, number>>((acc, item) => {
    const key = String(item[field] || "other");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function recognizedRevenueHt(invoices: JsonRecord[], datePrefix = "") {
  const byId = new Map(invoices.map((invoice) => [String(invoice.id || ""), invoice]));
  return round2(invoices.reduce((sum, invoice) => {
    if (invoice.status !== "issued") return sum;
    if (datePrefix && !String(invoice.date || "").startsWith(datePrefix)) return sum;
    if (invoice.type === "final") return sum + numberValue(invoice.total_ht);
    if (invoice.type !== "credit_note") return sum;
    const source = byId.get(String(invoice.source_invoice_id || ""));
    return source?.type === "final" ? sum + numberValue(invoice.total_ht) : sum;
  }, 0));
}

async function dashboard(ownerEmail: string) {
  const [quotes, invoices, payments] = await Promise.all([
    listRecords(ownerEmail, "quotes"), listRecords(ownerEmail, "invoices"), listRecords(ownerEmail, "payments"),
  ]);
  const quoteCounts = groupCount(quotes, "status");
  const quoteAmounts = quotes.reduce<Record<string, number>>((acc, quote) => {
    const key = String(quote.status || "draft");
    acc[key] = round2((acc[key] || 0) + numberValue(quote.total_ht));
    return acc;
  }, {});
  const issued = invoices.filter((invoice) => invoice.status === "issued");
  const paymentTotal = round2(payments.reduce((sum, payment) => sum + (payment.direction === "out" ? -1 : 1) * numberValue(payment.amount), 0));
  const paidByInvoice = payments.reduce<Record<string, number>>((acc, payment) => {
    const id = String(payment.invoice_id || "");
    acc[id] = round2((acc[id] || 0) + numberValue(payment.amount));
    return acc;
  }, {});
  const paid = issued.filter((invoice) => numberValue(paidByInvoice[String(invoice.id)]) + .001 >= numberValue(invoice.amount_due || invoice.total_ttc)).length;
  const deposits = issued.filter((invoice) => invoice.type === "deposit");
  const depositsTotal = round2(deposits.reduce((sum, invoice) => sum + numberValue(invoice.total_ttc), 0));
  const depositsPaid = round2(deposits.reduce((sum, invoice) => sum + Math.min(numberValue(invoice.total_ttc), numberValue(paidByInvoice[String(invoice.id)])), 0));
  const byMethod = Object.entries(payments.reduce<Record<string, number>>((acc, payment) => {
    const method = String(payment.method || "other");
    acc[method] = round2((acc[method] || 0) + numberValue(payment.amount));
    return acc;
  }, {})).map(([method, total]) => ({ method, total }));
  return {
    ok: true,
    currency: "EUR",
    ca_recognized_ht: recognizedRevenueHt(invoices),
    deposits: { total_ttc: depositsTotal, issued_ttc: depositsTotal, paid_ttc: depositsPaid, waiting_ttc: round2(depositsTotal - depositsPaid), overdue_ttc: 0 },
    quotes: { counts: { draft: quoteCounts.draft || 0, sent: quoteCounts.sent || 0, accepted: quoteCounts.accepted || 0, rejected: quoteCounts.rejected || 0, done: (quoteCounts.sent || 0) + (quoteCounts.accepted || 0) + (quoteCounts.rejected || 0) }, amounts: quoteAmounts, amounts_ht: quoteAmounts },
    invoices: { issued: issued.length, paid, waiting: Math.max(0, issued.length - paid) },
    payments: { total: paymentTotal, by_method: byMethod },
  };
}

async function dashboardMetrics(ownerEmail: string, yearInput: unknown) {
  const year = numberValue(yearInput) || new Date().getFullYear();
  const [company, invoices, payments] = await Promise.all([getCompany(ownerEmail), listRecords(ownerEmail, "invoices"), listRecords(ownerEmail, "payments")]);
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  const issued = invoices.filter((item) => item.status === "issued" && String(item.date || "").startsWith(String(year)));
  const yearPayments = payments.filter((item) => String(item.date || "").startsWith(String(year)));
  const cashMonthly = months.map((ym) => ({ ym, cash_deposit: 0, cash_final: 0, cash_total: round2(yearPayments.filter((item) => String(item.date || "").startsWith(ym)).reduce((sum, item) => sum + numberValue(item.amount), 0)) }));
  let running = 0;
  const cashCumulative = cashMonthly.map((item) => ({ ym: item.ym, cash_cum: running = round2(running + item.cash_total) }));
  const meta = object(company.meta);
  const annualTarget = numberValue(company.annual_target_ht || meta.annual_target_ht) || null;
  const targetCumulative = months.map((ym, index) => ({ ym, target_cum: annualTarget ? round2(annualTarget * (index + 1) / 12) : 0 }));
  const cashTotal = round2(yearPayments.reduce((sum, item) => sum + numberValue(item.amount), 0));
  const finalRevenue = recognizedRevenueHt(invoices, String(year));
  const depositRevenue = round2(issued.filter((item) => item.type === "deposit").reduce((sum, item) => sum + numberValue(item.total_ttc), 0));
  return {
    ok: true, currency: "EUR", year,
    target: { annual_target_ht: annualTarget, pct_of_target_cash_ytd: annualTarget ? Math.min(1, cashTotal / annualTarget) : 0, cash_ytd: cashTotal, remaining_to_target: annualTarget ? Math.max(0, annualTarget - cashTotal) : null },
    ytd: { recognized: { ca_recognized_ht_ytd: finalRevenue }, cash: { cash_deposit_ytd: 0, cash_final_ytd: cashTotal, cash_total_ytd: cashTotal }, revenue_issued: { revenue_deposit_ytd: depositRevenue, revenue_final_ytd: finalRevenue, revenue_total_ytd: round2(finalRevenue + depositRevenue) } },
    series: { cash_monthly: cashMonthly, cash_cumulative: cashCumulative, target_cumulative: targetCumulative, recognized_ht_monthly: months.map((ym) => ({ ym, recognized_ht: recognizedRevenueHt(invoices, ym) })) },
  };
}

function previewResult(method: string) {
  if (method === "company:get") return defaultCompany();
  if (method === "dashboard:get") return { ok: true, quotes: { counts: {}, amounts: {}, amounts_ht: {} }, invoices: { issued: 0, paid: 0, waiting: 0 }, payments: { total: 0, by_method: [] }, deposits: {} };
  if (method === "dashboard:metrics") return { ok: true, year: new Date().getFullYear(), target: {}, ytd: { cash: {}, recognized: {}, revenue_issued: {} }, series: { cash_monthly: [], cash_cumulative: [], target_cumulative: [], recognized_ht_monthly: [] } };
  if (method.endsWith(":list") || method === "payments:listAll") return [];
  if (method.endsWith(":get") || method.endsWith(":getFull")) return null;
  return undefined;
}

async function dispatch(ownerEmail: string, method: string, args: unknown[]) {
  if (method === "i18n:load") {
    const localeArg = object(first(args));
    const locale = String(localeArg.locale || first(args) || "fr").toLowerCase().slice(0, 2);
    return dictionaries[locale] || fr;
  }
  if (method === "xpReject:load" || method === "rejectionReasons:load") return rejectionReasons;
  if (method === "company:get") return getCompany(ownerEmail);
  if (method === "company:save") return saveCompany(ownerEmail, object(first(args)));
  if (method === "company:getInboundConfig") return object((await getCompany(ownerEmail)).inbound);
  if (method === "company:setInboundConfig") {
    const company = await getCompany(ownerEmail);
    return saveCompany(ownerEmail, { ...company, inbound: object(first(args)).inbound || first(args) });
  }
  if (method === "company:getConformityConfig" || method === "conformity:getConfig") return object((await getCompany(ownerEmail)).conformity);
  if (method === "company:setConformityConfig" || method === "conformity:saveConfig") {
    const company = await getCompany(ownerEmail);
    return saveCompany(ownerEmail, { ...company, conformity: object(first(args)).conformity || first(args) });
  }
  if (method === "dashboard:get") return dashboard(ownerEmail);
  if (method === "dashboard:metrics") return dashboardMetrics(ownerEmail, object(first(args)).year);

  const [namespace, action] = method.split(":");
  const entity = namespace as Entity;
  if (entities.has(entity)) {
    if (action === "list" || (entity === "payments" && action === "listAll")) return listRecords(ownerEmail, entity, object(first(args)));
    if (action === "get") return getRecord(ownerEmail, entity, idFrom(first(args)));
    if (action === "getFull") {
      const record = await getRecord(ownerEmail, entity, idFrom(first(args)));
      if (!record) return null;
      const lines = Array.isArray(record.lines) ? record.lines : [];
      if (entity === "quotes") return { quote: record, lines };
      if (entity === "invoices") return { invoice: record, lines };
      return record;
    }
    if (["save", "upsert", "create", "update", "record"].includes(action)) return saveRecord(ownerEmail, entity, object(first(args)));
    if (["remove", "delete"].includes(action)) return removeRecord(ownerEmail, entity, idFrom(first(args)));
    if (entity === "clients" && action === "importCsv") {
      const rows = Array.isArray(object(first(args)).rows) ? object(first(args)).rows as unknown[] : [];
      return { imported: (await Promise.all(rows.map((row) => saveRecord(ownerEmail, "clients", object(row))))).length };
    }
    if (entity === "items" && action === "duplicate") {
      const source = await getRecord(ownerEmail, "items", idFrom(first(args)));
      if (!source) throw new Error("Article introuvable");
      return saveRecord(ownerEmail, "items", { ...source, id: crypto.randomUUID(), ref: `${source.ref || ""}-COPIE`, name: `${source.name || source.label || "Article"} — copie` });
    }
    if (entity === "quotes" && action === "setStatus") {
      const id = idFrom(first(args));
      const source = await getRecord(ownerEmail, "quotes", id);
      if (!source) throw new Error("Devis introuvable");
      return saveRecord(ownerEmail, "quotes", { ...source, status: String(args[1] || object(first(args)).status || "draft") });
    }
    if (entity === "invoices" && action === "issue") {
      const id = idFrom(first(args));
      const source = await getRecord(ownerEmail, "invoices", id);
      if (!source) throw new Error("Facture introuvable");
      const count = (await listRecords(ownerEmail, "invoices")).filter((item) => item.status === "issued").length + 1;
      return saveRecord(ownerEmail, "invoices", { ...source, status: "issued", invoice_number: source.invoice_number || `F-${new Date().getFullYear()}-${String(count).padStart(4, "0")}`, issued_at: new Date().toISOString() });
    }
    if (entity === "invoices" && action === "createFromQuote") {
      const quote = await getRecord(ownerEmail, "quotes", idFrom(first(args)));
      if (!quote) throw new Error("Devis introuvable");
      return saveRecord(ownerEmail, "invoices", { ...quote, id: crypto.randomUUID(), quote_id: quote.id, number: undefined, invoice_number: "", status: "draft", type: "final" });
    }
    if (entity === "invoices" && action === "createDeposit") {
      const payload = object(first(args));
      return saveRecord(ownerEmail, "invoices", { ...payload, id: crypto.randomUUID(), type: "deposit", status: "draft" });
    }
    if (entity === "invoices" && action === "createCreditNote") {
      const source = await getRecord(ownerEmail, "invoices", idFrom(first(args)));
      if (!source) throw new Error("Facture introuvable");
      return saveRecord(ownerEmail, "invoices", { ...source, id: crypto.randomUUID(), source_invoice_id: source.id, invoice_number: "", type: "credit_note", status: "draft", total_ht: -Math.abs(numberValue(source.total_ht)), total_tva: -Math.abs(numberValue(source.total_tva)), total_ttc: -Math.abs(numberValue(source.total_ttc)) });
    }
    if (entity === "payments" && action === "sumByInvoice") {
      const id = idFrom(first(args));
      const payments = await listRecords(ownerEmail, "payments", { invoiceId: id });
      return round2(payments.reduce((sum, payment) => sum + numberValue(payment.amount), 0));
    }
  }
  if (method === "audit:path") return { path: "Supabase / d2f_records" };
  if (method === "audit:read") return { events: [], nextSeq: 0 };
  if (method === "audit:verify") return { ok: true, storage: "supabase" };
  if (method.startsWith("files:") || method.includes("exportPdf") || method.includes("exportUbl") || method.startsWith("email:")) {
    throw new Error("Cette fonction de fichier ou d’envoi nécessite encore un service serveur dédié dans la version web.");
  }
  if (method.startsWith("inbound:") || method.startsWith("connections:") || method.startsWith("conformity:")) return { ok: true };
  throw new Error(`Méthode web non prise en charge : ${method}`);
}

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return reply("Authentification requise", 401);
  let method = "";
  try {
    const body = object(await request.json());
    method = String(body.method || "");
    const args = Array.isArray(body.args) ? body.args : [];
    if (!method || !method.includes(":")) return reply("Méthode RPC invalide", 400);
    return reply(await dispatch(ownerEmail, method, args));
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      const fallback = previewResult(method);
      if (fallback !== undefined) return reply(fallback);
      return reply("Supabase n’est pas encore configuré", 503);
    }
    return reply(error instanceof Error ? error.message : "Erreur RPC", 500);
  }
}
