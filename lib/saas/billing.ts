import { createDocumentPdf } from "../document-pdf";
import { normalizedEmail, publicBillingConfig } from "../auth/server";
import { getSupabaseAdmin } from "../supabase/server";
import type { TenantAccount } from "./accounts";

type JsonRecord = Record<string, unknown>;

export type SubscriptionInvoiceReference = {
  id: string;
  number: string;
  date: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
};

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function d2fOwnerKey() {
  return normalizedEmail(process.env.D2F_DATA_OWNER_KEY || process.env.D2F_OWNER_EMAIL);
}

async function stableSuffix(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function nextInvoiceNumber(ownerKey: string, year: string) {
  const { data, error } = await getSupabaseAdmin().from("d2f_records")
    .select("document_number")
    .eq("owner_email", ownerKey)
    .eq("entity", "invoices")
    .limit(2000);
  if (error) throw error;
  const pattern = new RegExp(`^F${year}-(\\d+)$`, "i");
  const maximum = (data || []).reduce((highest, row) => {
    const match = stringValue(row.document_number).match(pattern);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `F${year}-${String(maximum + 1).padStart(4, "0")}`;
}

async function upsertRecord(ownerKey: string, entity: "clients" | "invoices" | "payments", id: string, data: JsonRecord, options: { status?: string; number?: string; date?: string; parentId?: string } = {}) {
  const now = new Date().toISOString();
  const row = {
    id,
    owner_email: ownerKey,
    entity,
    search_text: [data.name, data.legal_name, data.email, data.invoice_number, data.description, data.saas_tenant_id].map(stringValue).filter(Boolean).join(" ").toLowerCase().slice(0, 2000),
    status: options.status || stringValue(data.status),
    document_number: options.number || stringValue(data.invoice_number || data.number),
    document_date: options.date || (data.date ? stringValue(data.date).slice(0, 10) : null),
    parent_id: options.parentId || stringValue(data.invoice_id || data.client_id) || null,
    data: { ...data, id },
    updated_at: now,
  };
  const { error } = await getSupabaseAdmin().from("d2f_records").upsert(row, { onConflict: "id" });
  if (error) throw error;
}

function requiredBuyer(account: TenantAccount) {
  const profile = account.billingProfile;
  if (!profile.legalName || !profile.legalIdentifier || !profile.street || !profile.postalCode || !profile.city || !profile.country || !profile.email) {
    throw new Error(`Coordonnées de facturation incomplètes pour ${account.name} : le client doit renseigner son adresse complète avant validation du paiement`);
  }
  return {
    name: profile.legalName,
    legal_name: profile.legalName,
    legal_id: profile.legalIdentifier,
    vat_id: profile.vatId,
    street: profile.street,
    street2: profile.street2,
    postal_code: profile.postalCode,
    postal: profile.postalCode,
    city: profile.city,
    country: profile.country,
    email: profile.email,
    customer_type: "B2B",
    vat_subject: 1,
  };
}

async function sellerSnapshot(ownerKey: string) {
  const { data, error } = await getSupabaseAdmin().from("d2f_company").select("data").eq("owner_email", ownerKey).maybeSingle();
  if (error) throw error;
  const company = object(data?.data);
  const billing = publicBillingConfig();
  return {
    ...company,
    legal_name: stringValue(company.legal_name || company.name || billing.beneficiary || "D2F Compliant d.o.o."),
    legal_id: stringValue(company.legal_id || "115028819"),
    vat_id: stringValue(company.vat_id || "RS115028819"),
    street: stringValue(company.street || company.address || "RADNICKA 41/10 - SPRAT 1"),
    postal_code: stringValue(company.postal_code || company.postal || "11030"),
    city: stringValue(company.city || "BEOGRAD"),
    country: stringValue(company.country || "RS"),
    email: stringValue(company.email || process.env.D2F_OWNER_EMAIL),
    currency: "EUR",
    bank: {
      bank_name: billing.bankName,
      holder: billing.beneficiary,
      iban: billing.iban,
      bic: billing.bic,
    },
  };
}

function invoiceReference(record: JsonRecord): SubscriptionInvoiceReference {
  return {
    id: stringValue(record.id),
    number: stringValue(record.invoice_number),
    date: stringValue(record.date).slice(0, 10),
    amount: numberValue(record.total_ttc),
    periodStart: stringValue(record.subscription_period_start).slice(0, 10),
    periodEnd: stringValue(record.subscription_period_end).slice(0, 10),
  };
}

export async function generateSubscriptionInvoice(account: TenantAccount, input: { periodStart: string; periodEnd: string; actorEmail: string }) {
  const ownerKey = d2fOwnerKey();
  if (!ownerKey) throw new Error("Compte émetteur D2F non configuré");
  const buyer = requiredBuyer(account);
  const seller = await sellerSnapshot(ownerKey);
  const paymentIdentity = `${account.id}|${account.subscription.customerTransferReference}|${account.subscription.paidOn}|${account.subscription.amountEur}`;
  const suffix = await stableSuffix(paymentIdentity);
  const invoiceId = `saas-invoice-${suffix}`;
  const paymentId = `saas-payment-${suffix}`;
  const clientId = `saas-client-${account.id}`;
  const supabase = getSupabaseAdmin();
  const { data: existing, error: existingError } = await supabase.from("d2f_records").select("id,data").eq("owner_email", ownerKey).eq("entity", "invoices").eq("id", invoiceId).maybeSingle();
  if (existingError) throw existingError;
  if (existing) return invoiceReference({ ...object(existing.data), id: existing.id });

  const paidAmount = numberValue(account.subscription.amountEur);
  if (!(paidAmount > 0)) throw new Error("Montant de l’abonnement invalide");
  const domesticSerbia = stringValue(buyer.country).toUpperCase() === "RS";
  const vatRate = domesticSerbia ? 20 : 0;
  const totalHt = domesticSerbia ? round2(paidAmount / 1.2) : round2(paidAmount);
  const totalVat = round2(paidAmount - totalHt);
  const totalTtc = round2(paidAmount);
  const paidOn = account.subscription.paidOn || new Date().toISOString().slice(0, 10);
  const billingTerm = account.subscription.amountEur === publicBillingConfig().annualAmountEur ? "annual" : "monthly";
  const invoiceNumber = await nextInvoiceNumber(ownerKey, paidOn.slice(0, 4));
  const description = billingTerm === "annual"
    ? "Abonnement D2F Gestion — formule annuelle — 2 utilisateurs"
    : "Abonnement D2F Gestion — formule mensuelle — 2 utilisateurs";
  const line = { id: crypto.randomUUID(), position: 0, description, quantity: 1, unit_price_ht: totalHt, remise_percent: 0, tva_percent: vatRate, total_ht: totalHt };
  const notes = domesticSerbia
    ? "Abonnement réglé par virement bancaire. TVA serbe incluse dans le montant encaissé."
    : "Service B2B fourni depuis la Serbie. Autoliquidation / traitement fiscal par le preneur selon les règles applicables dans son pays.";
  const invoice = {
    id: invoiceId,
    invoice_number: invoiceNumber,
    type: "final",
    status: "issued",
    date: paidOn,
    due_date: paidOn,
    issued_at: new Date().toISOString(),
    currency: "EUR",
    client_id: clientId,
    client_name: buyer.legal_name,
    lines: [line],
    total_ht: totalHt,
    total_tva: totalVat,
    total_ttc: totalTtc,
    amount_due: totalTtc,
    prepaid_amount: 0,
    payment_text: `Réglée par virement le ${paidOn} — référence ${account.subscription.customerTransferReference}`,
    notes,
    vat_effective: domesticSerbia ? "STANDARD" : "REVERSE_CHARGE",
    saas_tenant_id: account.id,
    saas_billing: true,
    subscription_period_start: input.periodStart,
    subscription_period_end: input.periodEnd,
    customer_transfer_reference: account.subscription.customerTransferReference,
    d2f_bank_transfer_reference: account.subscription.bankTransferReference,
    validated_by: input.actorEmail,
    validated_at: new Date().toISOString(),
    seller_snapshot: seller,
    buyer_snapshot: buyer,
  };
  const payment = {
    id: paymentId,
    invoice_id: invoiceId,
    invoice_number: invoiceNumber,
    date: paidOn,
    amount: totalTtc,
    method: "bank_transfer",
    status: "posted",
    direction: "in",
    reference: account.subscription.customerTransferReference,
    saas_tenant_id: account.id,
    saas_billing: true,
  };
  await upsertRecord(ownerKey, "clients", clientId, { id: clientId, ...buyer, saas_tenant_id: account.id }, { status: "active" });
  await upsertRecord(ownerKey, "invoices", invoiceId, invoice, { status: "issued", number: invoiceNumber, date: paidOn, parentId: clientId });
  try {
    await upsertRecord(ownerKey, "payments", paymentId, payment, { status: "posted", date: paidOn, parentId: invoiceId });
  } catch (error) {
    await supabase.from("d2f_records").delete().eq("owner_email", ownerKey).eq("id", invoiceId);
    throw error;
  }
  return invoiceReference(invoice);
}

export async function listSubscriptionInvoices(tenantId: string) {
  const ownerKey = d2fOwnerKey();
  if (!ownerKey) return [];
  const { data, error } = await getSupabaseAdmin().from("d2f_records")
    .select("id,data")
    .eq("owner_email", ownerKey)
    .eq("entity", "invoices")
    .contains("data", { saas_tenant_id: tenantId, saas_billing: true })
    .order("document_date", { ascending: false })
    .limit(24);
  if (error) throw error;
  return (data || []).map((row) => invoiceReference({ ...object(row.data), id: row.id }));
}

export async function renderSubscriptionInvoice(tenantId: string, invoiceId: string, locale: string) {
  const ownerKey = d2fOwnerKey();
  const { data, error } = await getSupabaseAdmin().from("d2f_records")
    .select("id,data")
    .eq("owner_email", ownerKey)
    .eq("entity", "invoices")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw error;
  const invoice = object(data?.data);
  if (!data || stringValue(invoice.saas_tenant_id) !== tenantId || invoice.saas_billing !== true) throw new Error("Facture d’abonnement introuvable");
  const lines = Array.isArray(invoice.lines) ? invoice.lines.map(object) : [];
  return createDocumentPdf({
    kind: "invoice",
    document: invoice,
    lines,
    seller: object(invoice.seller_snapshot),
    buyer: object(invoice.buyer_snapshot),
    locale,
  });
}
