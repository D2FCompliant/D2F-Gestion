import fr from "../../renderer/i18n/fr.json";
import en from "../../renderer/i18n/en.json";
import es from "../../renderer/i18n/es.json";
import it from "../../renderer/i18n/it.json";
import sr from "../../renderer/i18n/sr.json";
import rejectionReasons from "../../Electron/resources/rejection-reasons.xp-z12-012.v1.2.json";
import { getOwnerEmail, getSupabaseAdmin, SupabaseConfigurationError } from "../../lib/supabase/server";
import { createDocumentPdf, pdfBytesToBase64 } from "../../lib/document-pdf";
import { createUblDocument, textToBase64 } from "../../lib/ubl";
import { getIntegration, listTransmissions, saveIntegration, testIntegration, transmitIntegration, type IntegrationType } from "../../lib/integrations";
import { readAppSession, renewedSession, sessionCookie } from "../../lib/auth/server";
import { accountAllowsApplication, getAccountById, memberFor } from "../../lib/saas/accounts";
import { validateEstablishmentIdentifier } from "../../lib/company-identifiers";
import { preflightInvoice } from "../../lib/country-compliance";

export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
type Entity = "clients" | "items" | "quotes" | "invoices" | "payments" | "inbound";

const dictionaries: Record<string, unknown> = { fr, en, es, it, sr };
const entities = new Set<Entity>(["clients", "items", "quotes", "invoices", "payments", "inbound"]);

function reply(result: unknown, status = 200, headers?: HeadersInit) {
  return Response.json({ ok: status < 400, ...(status < 400 ? { result } : { error: result }) }, { status, headers: { "cache-control": "no-store", ...headers } });
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

function safeFileName(input: unknown, fallback: string) {
  const normalized = String(input || fallback).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

const COMPLIANCE_BUCKET = "d2f-compliance-evidence";
const COMPLIANCE_MAX_BYTES = 10 * 1024 * 1024;
const COMPLIANCE_CATEGORIES = new Set([
  "process_documentation", "order_contract", "delivery_service_proof", "invoice_tax",
  "payment_bank", "control_report", "correction_credit_note", "tax_return", "other",
]);
const COMPLIANCE_EXTENSIONS = new Set(["pdf", "xml", "json", "csv", "txt", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg", "webp", "eml"]);

function base64Bytes(value: string) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function sha256Bytes(bytes: Uint8Array) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

function complianceProfile(countryValue: unknown) {
  const country = String(countryValue || "").trim().toUpperCase().slice(0, 2);
  if (country === "FR") return {
    country, code: "FR_PAF", requiresPaf: true, retentionYears: 10,
    label: "France — dossier PAF et pièces justificatives",
    explanation: "La PAF documente les contrôles et relie l'opération, la commande, la livraison ou prestation, la facture et le paiement. Elle est présentée à l'administration sur demande ; elle n'est pas jointe à chaque facture.",
    checklist: ["process_documentation", "order_contract", "delivery_service_proof", "invoice_tax", "payment_bank", "control_report"],
  };
  if (country === "IT") return {
    country, code: "IT_CONSERVAZIONE", requiresPaf: false, retentionYears: 10,
    label: "Italie — conservazione elettronica a norma",
    explanation: "Le flux SdI et la conservation électronique conforme remplacent la logique documentaire française. Les pièces commerciales complémentaires restent utiles au contrôle.",
    checklist: ["order_contract", "delivery_service_proof", "invoice_tax", "payment_bank"],
  };
  if (country === "ES") return {
    country, code: "ES_SIF_VERIFACTU", requiresPaf: false, retentionYears: 10,
    label: "Espagne — registres SIF / VERI*FACTU",
    explanation: "Les registres doivent garantir intégrité, conservation, accessibilité, lisibilité, traçabilité et inaltérabilité. Ce n'est pas la PAF française.",
    checklist: ["invoice_tax", "control_report", "correction_credit_note", "payment_bank"],
  };
  if (country === "RS") return {
    country, code: "RS_SEF_STORAGE", requiresPaf: false, retentionYears: 10,
    label: "Serbie — conservation SEF / intermédiaire d'information",
    explanation: "Les factures du secteur privé sont conservées dans SEF ou chez l'intermédiaire habilité. Les pièces complémentaires peuvent être conservées ici sans être transmises avec chaque facture.",
    checklist: ["order_contract", "delivery_service_proof", "invoice_tax", "payment_bank"],
  };
  return {
    country: country || "—", code: "GENERIC_AUDIT_TRAIL", requiresPaf: false, retentionYears: 10,
    label: "Contrôles et preuves — règles locales à qualifier",
    explanation: "Le principe d'authenticité, d'intégrité et de lisibilité existe dans l'Union européenne, mais le nom PAF et les modalités de conservation dépendent du pays.",
    checklist: ["process_documentation", "order_contract", "delivery_service_proof", "invoice_tax", "payment_bank"],
  };
}

function complianceDocuments(company: JsonRecord) {
  return Array.isArray(company.compliance_documents) ? company.compliance_documents.map(object) : [];
}

async function ensureComplianceBucket() {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.getBucket(COMPLIANCE_BUCKET);
  if (!error) return;
  const created = await supabase.storage.createBucket(COMPLIANCE_BUCKET, {
    public: false,
    fileSizeLimit: COMPLIANCE_MAX_BYTES,
  });
  if (created.error && !/already exists|duplicate/i.test(created.error.message || "")) throw created.error;
}

async function complianceOwnerPrefix(ownerEmail: string) {
  return (await sha256Hex(ownerEmail.toLowerCase())).slice(0, 32);
}

async function listComplianceEvidence(ownerEmail: string) {
  const company = await getCompany(ownerEmail);
  const documents = complianceDocuments(company)
    .map(({ storage_path: _storagePath, ...document }) => document)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  const categories = new Set(documents.filter((document) => document.status !== "voided").map((document) => String(document.category || "other")));
  return { documents, profile: complianceProfile(company.country), coveredCategories: [...categories] };
}

async function uploadComplianceEvidence(ownerEmail: string, input: JsonRecord) {
  const filename = safeFileName(input.filename || input.name, "preuve.pdf");
  const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() || "" : "";
  if (!COMPLIANCE_EXTENSIONS.has(extension)) throw new Error("Format non admis. Utilisez PDF, XML, JSON, CSV, Word, Excel, image ou EML.");
  const contentBase64 = String(input.contentBase64 || input.content_base64 || "");
  if (!contentBase64) throw new Error("Le fichier est vide");
  const bytes = base64Bytes(contentBase64);
  if (!bytes.length || bytes.length > COMPLIANCE_MAX_BYTES) throw new Error("La pièce doit être comprise entre 1 octet et 10 Mo");
  const category = COMPLIANCE_CATEGORIES.has(String(input.category || "")) ? String(input.category) : "other";
  const company = await getCompany(ownerEmail);
  const id = crypto.randomUUID();
  const ownerPrefix = await complianceOwnerPrefix(ownerEmail);
  const storagePath = `${ownerPrefix}/${id}/${filename}`;
  const mimeType = String(input.mimeType || input.mime_type || "application/octet-stream").slice(0, 160);
  const sha256 = await sha256Bytes(bytes);
  await ensureComplianceBucket();
  const supabase = getSupabaseAdmin();
  const uploaded = await supabase.storage.from(COMPLIANCE_BUCKET).upload(storagePath, bytes, { contentType: mimeType, upsert: false });
  if (uploaded.error) throw uploaded.error;
  const document = {
    id, filename, mime_type: mimeType, size: bytes.length, sha256, category,
    description: String(input.description || "").trim().slice(0, 1000),
    related_document: String(input.related_document || input.relatedDocument || "").trim().slice(0, 160),
    document_date: String(input.document_date || input.documentDate || today()).slice(0, 10),
    country: String(company.country || "").toUpperCase(),
    storage_path: storagePath, integrity_status: "sealed",
    archive_status: "not_archived", created_at: new Date().toISOString(),
  };
  try {
    await saveCompany(ownerEmail, { ...company, compliance_documents: [document, ...complianceDocuments(company)] });
  } catch (error) {
    await supabase.storage.from(COMPLIANCE_BUCKET).remove([storagePath]).catch(() => undefined);
    throw error;
  }
  const { storage_path: _storagePath, ...safeDocument } = document;
  return safeDocument;
}

async function complianceDocument(ownerEmail: string, id: string) {
  const company = await getCompany(ownerEmail);
  const document = complianceDocuments(company).find((item) => String(item.id || "") === id);
  if (!document) throw new Error("Pièce de conformité introuvable");
  return { company, document };
}

async function downloadComplianceEvidence(ownerEmail: string, id: string) {
  const { document } = await complianceDocument(ownerEmail, id);
  const downloaded = await getSupabaseAdmin().storage.from(COMPLIANCE_BUCKET).download(String(document.storage_path || ""));
  if (downloaded.error) throw downloaded.error;
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const actualHash = await sha256Bytes(bytes);
  if (actualHash !== String(document.sha256 || "")) throw new Error("Contrôle d'intégrité échoué : la pièce ne correspond plus à son empreinte d'origine");
  return {
    ok: true,
    fileName: String(document.filename || "preuve"),
    mimeType: String(document.mime_type || "application/octet-stream"),
    downloadBase64: bytesBase64(bytes),
  };
}

async function deleteComplianceEvidence(ownerEmail: string, id: string) {
  const { company, document } = await complianceDocument(ownerEmail, id);
  if (document.status === "voided") return { ok: true, id, status: "voided" };
  const updated = complianceDocuments(company).map((item) => String(item.id || "") === id ? {
    ...item,
    status: "voided",
    voided_at: new Date().toISOString(),
  } : item);
  await saveCompany(ownerEmail, { ...company, compliance_documents: updated });
  return { ok: true, id, status: "voided" };
}

async function archiveComplianceEvidence(ownerEmail: string, id: string) {
  const { company, document } = await complianceDocument(ownerEmail, id);
  if (document.status === "voided") throw new Error("Une pièce annulée ne peut pas être versée au SAE");
  const archive = await getIntegration(getSupabaseAdmin(), ownerEmail, "archive").catch(() => null);
  if (!archive?.enabled || !archive?.configured) throw new Error("Configurez et activez d'abord le SAE dans la fiche Entreprise");
  const downloaded = await getSupabaseAdmin().storage.from(COMPLIANCE_BUCKET).download(String(document.storage_path || ""));
  if (downloaded.error) throw downloaded.error;
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const actualHash = await sha256Bytes(bytes);
  if (actualHash !== String(document.sha256 || "")) throw new Error("Archivage bloqué : l'empreinte SHA-256 de la pièce est invalide");
  const result = await transmitIntegration(getSupabaseAdmin(), ownerEmail, "archive", {
    documentId: id,
    documentNumber: String(document.related_document || document.filename || id),
    content: bytes,
    contentType: String(document.mime_type || "application/octet-stream"),
    metadata: { source: "compliance_evidence", category: document.category, sha256: document.sha256, file_name: document.filename },
  });
  const updated = complianceDocuments(company).map((item) => String(item.id || "") === id ? {
    ...item,
    archive_status: "archived",
    archived_at: new Date().toISOString(),
    archive_provider: result.provider,
    archive_remote_id: result.remote_id,
  } : item);
  await saveCompany(ownerEmail, { ...company, compliance_documents: updated });
  return { ok: true, id, status: result.status || "submitted", provider: result.provider || "SAE" };
}

async function exportComplianceManifest(ownerEmail: string) {
  const company = await getCompany(ownerEmail);
  const profile = complianceProfile(company.country);
  const documents = complianceDocuments(company).map(({ storage_path: _storagePath, ...document }) => document);
  const manifest = {
    generated_at: new Date().toISOString(),
    company: { legal_name: company.legal_name || company.name, legal_id: company.legal_id, vat_id: company.vat_id, country: company.country },
    profile,
    integrity: "SHA-256",
    document_count: documents.length,
    documents,
  };
  const filename = `dossier-controle-${safeFileName(company.legal_id || company.name, "entreprise")}-${today()}.json`;
  return { ok: true, fileName: filename, mimeType: "application/json", downloadBase64: textToBase64(JSON.stringify(manifest, null, 2)) };
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
    const peppol = normalizePeppolEndpoint(raw.peppol_endpoint_scheme, raw.peppol_endpoint_id);
    normalized.name = String(raw.name || "").trim();
    normalized.customer_type = String(raw.customer_type || "B2C");
    normalized.country = String(raw.country || "FR").toUpperCase();
    normalized.postal_code = String(raw.postal_code || raw.postal || "");
    normalized.postal = normalized.postal_code;
    normalized.vat_subject = raw.vat_subject === 0 || raw.vat_subject === "0" ? 0 : 1;
    normalized.peppol_endpoint_scheme = peppol.scheme;
    normalized.peppol_endpoint_id = peppol.endpointId;
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
      if (normalized.type === "credit_note") {
        normalized.total_ht = -Math.abs(numberValue(normalized.total_ht));
        normalized.total_tva = -Math.abs(numberValue(normalized.total_tva));
        normalized.total_ttc = -Math.abs(numberValue(normalized.total_ttc));
        normalized.amount_due = -Math.abs(numberValue(raw.amount_due || normalized.total_ttc));
      } else {
        normalized.amount_due = numberValue(raw.amount_due || normalized.total_ttc);
      }
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
  const records = (data || []).map((row) => ({ ...object(row.data), id: row.id, created_at: row.created_at, updated_at: row.updated_at }));
  if (!['quotes', 'invoices'].includes(entity)) return records;
  const clientIds = [...new Set(records.map((record) => String(record.client_id || "")).filter(Boolean))];
  if (!clientIds.length) return records;
  const { data: clients, error: clientError } = await supabase.from("d2f_records").select("id,data")
    .eq("owner_email", ownerEmail).eq("entity", "clients").in("id", clientIds);
  if (clientError) throw clientError;
  const clientNames = new Map((clients || []).map((row) => [String(row.id), String(object(row.data).name || object(row.data).legal_name || "")]));
  return records.map((record) => ({ ...record, client_name: String(record.client_name || clientNames.get(String(record.client_id || "")) || "") }));
}

async function getRecord(ownerEmail: string, entity: Entity, id: string) {
  if (!id) return null;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("d2f_records").select("id,data,created_at,updated_at")
    .eq("owner_email", ownerEmail).eq("entity", entity).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const record = { ...object(data.data), id: data.id, created_at: data.created_at, updated_at: data.updated_at };
  if (["quotes", "invoices"].includes(entity) && record.client_id && !record.client_name) {
    const client = await getRecord(ownerEmail, "clients", String(record.client_id));
    record.client_name = String(client?.name || client?.legal_name || "");
  }
  return record;
}

async function saveRecord(ownerEmail: string, entity: Entity, input: JsonRecord) {
  const supabase = getSupabaseAdmin();
  const id = String(input.id || crypto.randomUUID());
  const { data: occupied, error: occupiedError } = await supabase.from("d2f_records").select("owner_email").eq("id", id).maybeSingle();
  if (occupiedError) throw occupiedError;
  if (occupied && String(occupied.owner_email) !== ownerEmail) throw new Error("Identifiant déjà utilisé par une autre entreprise");
  const previous = await getRecord(ownerEmail, entity, id);
  const candidate = { ...(previous || {}), ...input, id };
  if (["quotes", "invoices"].includes(entity) && candidate.client_id && !candidate.client_name) {
    const client = await getRecord(ownerEmail, "clients", String(candidate.client_id));
    candidate.client_name = String(client?.name || client?.legal_name || "");
  }
  const normalized = normalizeRecord(entity, candidate);
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
  delete company._integrations;
  delete company._transmissions;
  delete company._saas_account;
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

async function saveCompany(ownerEmail: string, input: JsonRecord, validateIdentity = false) {
  const supabase = getSupabaseAdmin();
  const previous = await getCompany(ownerEmail);
  const candidate = { ...previous, ...input };
  if (validateIdentity) validateEstablishmentIdentifier(candidate.country, candidate.legal_id);
  const { data: rawRow } = await supabase.from("d2f_company").select("data").eq("owner_email", ownerEmail).maybeSingle();
  const hidden = object(rawRow?.data);
  const company = {
    ...candidate,
    ...(hidden._integrations ? { _integrations: hidden._integrations } : {}),
    ...(hidden._transmissions ? { _transmissions: hidden._transmissions } : {}),
    ...(hidden._saas_account ? { _saas_account: hidden._saas_account } : {}),
    id: "1",
  };
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

function invoiceType(invoice: JsonRecord) {
  return String(invoice.type || invoice.kind || "final").trim().toLowerCase();
}

function invoiceStatus(invoice: JsonRecord) {
  return String(invoice.status || invoice.state || "draft").trim().toLowerCase();
}

function creditSourceId(creditNote: JsonRecord) {
  const direct = creditNote.source_invoice_id || creditNote.sourceInvoiceId;
  if (direct) return String(direct);
  const meta = { ...jsonObject(creditNote.meta_json), ...object(creditNote.meta) };
  const source = object(meta.source);
  if (source.invoice_id || source.invoiceId) return String(source.invoice_id || source.invoiceId);
  const links = Array.isArray(creditNote.links_from) ? creditNote.links_from : [];
  const link = links.map(object).find((item) => String(item.link_type || "").toLowerCase() === "credit_of");
  return link?.to_invoice_id ? String(link.to_invoice_id) : "";
}

function invoiceGrossAmount(invoice: JsonRecord) {
  const totalTtc = Math.max(0, numberValue(invoice.total_ttc));
  const prepaid = invoiceType(invoice) === "final" ? Math.max(0, numberValue(invoice.prepaid_amount)) : 0;
  if (totalTtc > 0) return Math.max(0, round2(totalTtc - prepaid));
  return Math.max(0, round2(numberValue(invoice.amount_due)));
}

function paymentSignedAmount(payment: JsonRecord) {
  if (String(payment.status || "posted").toLowerCase() === "cancelled") return 0;
  const amount = Math.abs(numberValue(payment.amount));
  return String(payment.direction || "in").toLowerCase() === "out" ? -amount : amount;
}

function receivableRows(invoices: JsonRecord[], payments: JsonRecord[]) {
  const creditsBySource = new Map<string, number>();
  for (const creditNote of invoices) {
    if (invoiceType(creditNote) !== "credit_note" || invoiceStatus(creditNote) !== "issued") continue;
    const sourceId = creditSourceId(creditNote);
    if (!sourceId) continue;
    creditsBySource.set(sourceId, round2((creditsBySource.get(sourceId) || 0) + Math.abs(numberValue(creditNote.total_ttc || creditNote.amount_due))));
  }
  const paidByInvoice = new Map<string, number>();
  for (const payment of payments) {
    const invoiceId = String(payment.invoice_id || payment.invoiceId || "");
    if (!invoiceId) continue;
    paidByInvoice.set(invoiceId, round2((paidByInvoice.get(invoiceId) || 0) + paymentSignedAmount(payment)));
  }
  return invoices
    .filter((invoice) => invoiceStatus(invoice) === "issued" && invoiceType(invoice) !== "credit_note")
    .map((invoice) => {
      const id = String(invoice.id || "");
      const grossDue = invoiceGrossAmount(invoice);
      const credited = Math.min(grossDue, Math.max(0, creditsBySource.get(id) || 0));
      const netDue = Math.max(0, round2(grossDue - credited));
      const paid = Math.max(0, round2(paidByInvoice.get(id) || 0));
      const remaining = Math.max(0, round2(netDue - paid));
      return { invoice, grossDue, credited, netDue, paid, remaining };
    });
}

async function savePaymentRecord(ownerEmail: string, input: JsonRecord) {
  const invoiceId = String(input.invoice_id || input.invoiceId || "");
  if (!invoiceId) throw new Error("Facture manquante pour le paiement");
  const invoice = await getRecord(ownerEmail, "invoices", invoiceId);
  if (!invoice || invoiceStatus(invoice) !== "issued" || invoiceType(invoice) === "credit_note") {
    throw new Error("Le paiement doit être rattaché à une facture émise");
  }
  const direction = String(input.direction || "in").toLowerCase();
  const status = String(input.status || "posted").toLowerCase();
  if (direction !== "out" && status !== "cancelled") {
    const [invoices, payments] = await Promise.all([
      listRecords(ownerEmail, "invoices"),
      listRecords(ownerEmail, "payments"),
    ]);
    const otherPayments = payments.filter((payment) => String(payment.id || "") !== String(input.id || ""));
    const row = receivableRows(invoices, otherPayments).find((candidate) => String(candidate.invoice.id || "") === invoiceId);
    if (!row || row.remaining <= .001) throw new Error("Cette facture ne présente plus de solde à encaisser");
    const requested = Math.abs(numberValue(input.amount));
    if (requested > row.remaining + .001) {
      throw new Error(`Le paiement dépasse le solde restant de ${row.remaining.toFixed(2)} EUR`);
    }
  }
  return saveRecord(ownerEmail, "payments", input);
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
  const rows = receivableRows(invoices, payments);
  const paymentTotal = round2(payments.reduce((sum, payment) => sum + paymentSignedAmount(payment), 0));
  const paid = rows.filter((row) => row.netDue > .001 && row.paid + .001 >= row.netDue).length;
  const credited = rows.filter((row) => row.credited > .001 && row.netDue <= .001).length;
  const waiting = rows.filter((row) => row.remaining > .001).length;
  const deposits = rows.filter((row) => invoiceType(row.invoice) === "deposit");
  const depositsTotal = round2(deposits.reduce((sum, row) => sum + row.netDue, 0));
  const depositsPaid = round2(deposits.reduce((sum, row) => sum + Math.min(row.netDue, row.paid), 0));
  const byMethod = Object.entries(payments.reduce<Record<string, number>>((acc, payment) => {
    const amount = paymentSignedAmount(payment);
    if (!amount) return acc;
    const method = String(payment.method || "other");
    acc[method] = round2((acc[method] || 0) + amount);
    return acc;
  }, {})).map(([method, total]) => ({ method, total }));
  return {
    ok: true,
    currency: "EUR",
    ca_recognized_ht: recognizedRevenueHt(invoices),
    deposits: { total_ttc: depositsTotal, issued_ttc: depositsTotal, paid_ttc: depositsPaid, waiting_ttc: round2(depositsTotal - depositsPaid), overdue_ttc: 0 },
    quotes: { counts: { draft: quoteCounts.draft || 0, sent: quoteCounts.sent || 0, accepted: quoteCounts.accepted || 0, rejected: quoteCounts.rejected || 0, done: (quoteCounts.sent || 0) + (quoteCounts.accepted || 0) + (quoteCounts.rejected || 0) }, amounts: quoteAmounts, amounts_ht: quoteAmounts },
    invoices: { issued: rows.length, paid, credited, waiting },
    payments: { total: paymentTotal, by_method: byMethod },
  };
}

async function dashboardMetrics(ownerEmail: string, yearInput: unknown) {
  const year = numberValue(yearInput) || new Date().getFullYear();
  const [company, invoices, payments] = await Promise.all([getCompany(ownerEmail), listRecords(ownerEmail, "invoices"), listRecords(ownerEmail, "payments")]);
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  const issued = invoices.filter((item) => item.status === "issued" && String(item.date || "").startsWith(String(year)));
  const yearPayments = payments.filter((item) => String(item.date || "").startsWith(String(year)));
  const cashMonthly = months.map((ym) => ({ ym, cash_deposit: 0, cash_final: 0, cash_total: round2(yearPayments.filter((item) => String(item.date || "").startsWith(ym)).reduce((sum, item) => sum + paymentSignedAmount(item), 0)) }));
  let running = 0;
  const cashCumulative = cashMonthly.map((item) => ({ ym: item.ym, cash_cum: running = round2(running + item.cash_total) }));
  const meta = object(company.meta);
  const annualTarget = numberValue(company.annual_target_ht || meta.annual_target_ht) || null;
  const targetCumulative = months.map((ym, index) => ({ ym, target_cum: annualTarget ? round2(annualTarget * (index + 1) / 12) : 0 }));
  const cashTotal = round2(yearPayments.reduce((sum, item) => sum + paymentSignedAmount(item), 0));
  const finalRevenue = recognizedRevenueHt(invoices, String(year));
  const depositRevenue = round2(issued.filter((item) => item.type === "deposit").reduce((sum, item) => sum + numberValue(item.total_ttc), 0));
  return {
    ok: true, currency: "EUR", year,
    target: { annual_target_ht: annualTarget, pct_of_target_cash_ytd: annualTarget ? Math.min(1, cashTotal / annualTarget) : 0, cash_ytd: cashTotal, remaining_to_target: annualTarget ? Math.max(0, annualTarget - cashTotal) : null },
    ytd: { recognized: { ca_recognized_ht_ytd: finalRevenue }, cash: { cash_deposit_ytd: 0, cash_final_ytd: cashTotal, cash_total_ytd: cashTotal }, revenue_issued: { revenue_deposit_ytd: depositRevenue, revenue_final_ytd: finalRevenue, revenue_total_ytd: round2(finalRevenue + depositRevenue) } },
    series: { cash_monthly: cashMonthly, cash_cumulative: cashCumulative, target_cumulative: targetCumulative, recognized_ht_monthly: months.map((ym) => ({ ym, recognized_ht: recognizedRevenueHt(invoices, ym) })) },
  };
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hmacSha256Hex(secret: string, value: string) {
  if (!secret) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function isMutationMethod(method: string) {
  const [, action = ""] = method.split(":");
  return [
    "save", "upsert", "create", "update", "record", "remove", "delete", "importCsv", "duplicate",
    "setStatus", "issue", "createFromQuote", "createDeposit", "createCreditNote", "setInboundConfig",
    "setConformityConfig", "saveConfig", "setLogo", "clearLogo", "accept", "reject", "dispute",
    "send", "sendInvoice", "sendNow", "archive", "importFile", "uploadEvidence", "deleteEvidence", "archiveEvidence",
  ].includes(action);
}

function auditEntityType(method: string) {
  const namespace = method.split(":")[0] || "application";
  return ({ clients: "client", items: "item", quotes: "quote", invoices: "invoice", payments: "payment" } as Record<string, string>)[namespace] || namespace;
}

function auditEntityId(method: string, args: unknown[], result: unknown) {
  const resultObject = object(result);
  const input = object(first(args));
  if (method.startsWith("company:")) return "1";
  return String(resultObject.id || input.id || input.invoice_id || input.invoiceId || input.quote_id || input.quoteId || idFrom(first(args)) || "");
}

function auditPayload(method: string, args: unknown[], result: unknown) {
  const input = object(first(args));
  const output = object(result);
  const forbidden = /password|secret|token|smtp|base64|content|logo/i;
  const fields = Object.keys(input).filter((key) => !forbidden.test(key)).sort();
  return {
    method,
    fields,
    status: String(output.status || input.status || ""),
    document_number: String(output.invoice_number || output.number || input.invoice_number || input.number || ""),
    invoice_id: String(output.invoice_id || input.invoice_id || input.invoiceId || ""),
    amount: input.amount == null ? null : numberValue(input.amount),
  };
}

async function appendAuditEvent(ownerEmail: string, actorEmail: string, method: string, args: unknown[], result: unknown) {
  const supabase = getSupabaseAdmin();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: previous, error: previousError } = await supabase
      .from("d2f_audit_events")
      .select("seq,hash")
      .eq("owner_email", ownerEmail)
      .order("seq", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previousError) throw previousError;
    const seq = numberValue(previous?.seq) + 1;
    const prevHash = previous?.hash ? String(previous.hash) : null;
    const core = {
      ts: new Date().toISOString(),
      seq,
      actor: actorEmail,
      action: method.replace(":", "."),
      entityType: auditEntityType(method),
      entityId: auditEntityId(method, args, result),
      refs: {},
      payload: auditPayload(method, args, result),
      prev_hash: prevHash,
      app: { surface: "web", version: "2026.07" },
    };
    const canonicalText = JSON.stringify(core);
    const hash = await sha256Hex(canonicalText);
    const hmac = await hmacSha256Hex(process.env.D2F_AUDIT_HMAC_SECRET || "", canonicalText);
    const event = { ...core, hash, ...(hmac ? { hmac } : {}) };
    const { error } = await supabase.from("d2f_audit_events").insert({
      owner_email: ownerEmail,
      seq,
      event_time: core.ts,
      actor: core.actor,
      action: core.action,
      entity_type: core.entityType,
      entity_id: core.entityId,
      prev_hash: prevHash,
      hash,
      hmac,
      canonical_text: canonicalText,
      event,
    });
    if (!error) return event;
    if (error.code !== "23505" && error.code !== "P0001") throw error;
  }
  throw new Error("Impossible d’ajouter l’événement à la piste d’audit");
}

async function readAuditEvents(ownerEmail: string, input: JsonRecord) {
  const supabase = getSupabaseAdmin();
  const sinceSeq = Math.max(0, Math.floor(numberValue(input.sinceSeq)));
  const limit = Math.max(1, Math.min(500, Math.floor(numberValue(input.limit) || 500)));
  const { data, error } = await supabase
    .from("d2f_audit_events")
    .select("seq,event")
    .eq("owner_email", ownerEmail)
    .gt("seq", sinceSeq)
    .order("seq", { ascending: true })
    .limit(limit);
  if (error) throw error;
  const events = (data || []).map((row) => object(row.event));
  const nextSinceSeq = events.length ? numberValue(events[events.length - 1].seq) : sinceSeq;
  return { ok: true, events, entries: events, nextSinceSeq };
}

async function verifyAuditEvents(ownerEmail: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("d2f_audit_events")
    .select("seq,prev_hash,hash,hmac,canonical_text,event")
    .eq("owner_email", ownerEmail)
    .order("seq", { ascending: true })
    .limit(10000);
  if (error) throw error;
  let previousHash: string | null = null;
  let previousSeq = 0;
  let hmacVerified = 0;
  const secret = process.env.D2F_AUDIT_HMAC_SECRET || "";
  for (const [index, row] of (data || []).entries()) {
    const seq = numberValue(row.seq);
    if (seq !== previousSeq + 1) return { ok: false, index, error: "seq broken" };
    if ((row.prev_hash || null) !== previousHash) return { ok: false, index, error: "chain broken" };
    if (await sha256Hex(String(row.canonical_text || "")) !== row.hash) return { ok: false, index, error: "hash mismatch" };
    const event = object(row.event);
    if (String(event.hash || "") !== String(row.hash || "")) return { ok: false, index, error: "event mismatch" };
    if (row.hmac) {
      if (!secret || await hmacSha256Hex(secret, String(row.canonical_text || "")) !== row.hmac) {
        return { ok: false, index, error: "hmac mismatch" };
      }
      hmacVerified += 1;
    }
    previousHash = String(row.hash || "");
    previousSeq = seq;
  }
  return { ok: true, count: previousSeq, entries: previousSeq, last_seq: previousSeq, last_hash: previousHash, hmac_verified: hmacVerified };
}

function previewResult(method: string) {
  if (method === "company:get") return defaultCompany();
  if (method === "dashboard:get") return { ok: true, quotes: { counts: {}, amounts: {}, amounts_ht: {} }, invoices: { issued: 0, paid: 0, waiting: 0 }, payments: { total: 0, by_method: [] }, deposits: {} };
  if (method === "dashboard:metrics") return { ok: true, year: new Date().getFullYear(), target: {}, ytd: { cash: {}, recognized: {}, revenue_issued: {} }, series: { cash_monthly: [], cash_cumulative: [], target_cumulative: [], recognized_ht_monthly: [] } };
  if (method.endsWith(":list") || method === "payments:listAll") return [];
  if (method.endsWith(":get") || method.endsWith(":getFull")) return null;
  return undefined;
}

async function documentBundle(ownerEmail: string, entity: "quotes" | "invoices", id: string) {
  const document = await getRecord(ownerEmail, entity, id);
  if (!document) throw new Error(entity === "quotes" ? "Devis introuvable" : "Facture introuvable");
  const seller = await getCompany(ownerEmail);
  const buyer = await getRecord(ownerEmail, "clients", String(document.client_id || ""));
  if (!buyer) throw new Error("Le client associé au document est introuvable");
  const lines = Array.isArray(document.lines) ? document.lines.map(object) : [];
  return { document, seller, buyer, lines };
}

async function exportDocumentPdf(ownerEmail: string, entity: "quotes" | "invoices", args: unknown[]) {
  const id = idFrom(first(args));
  const locale = String(args[1] || object(first(args)).locale || "fr").slice(0, 2);
  const bundle = await documentBundle(ownerEmail, entity, id);
  const config = object(args[2]);
  const sellerOverride = entity === "quotes" ? object(args[3]) : object(config.sellerOverride);
  const seller = { ...bundle.seller, ...sellerOverride };
  const bytes = await createDocumentPdf({ kind: entity === "quotes" ? "quote" : "invoice", document: bundle.document, lines: bundle.lines, seller, buyer: bundle.buyer, locale });
  const number = bundle.document.invoice_number || bundle.document.number || bundle.document.id;
  const fileName = `${safeFileName(number, entity === "quotes" ? "devis" : "facture")}.pdf`;

  const archive = await getIntegration(getSupabaseAdmin(), ownerEmail, "archive").catch(() => null);
  let archiveResult: unknown = null;
  if (archive?.enabled && archive?.configured) {
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    archiveResult = await transmitIntegration(getSupabaseAdmin(), ownerEmail, "archive", { documentId: id, documentNumber: String(number || ""), content: body, contentType: "application/pdf", metadata: { file_name: fileName, locale, source: "pdf_export" } });
  }
  return { ok: true, path: fileName, filePath: fileName, fileName, mimeType: "application/pdf", downloadBase64: pdfBytesToBase64(bytes), archive: archiveResult };
}

async function exportInvoiceUbl(ownerEmail: string, input: unknown) {
  const id = idFrom(input);
  const bundle = await documentBundle(ownerEmail, "invoices", id);
  if (invoiceStatus(bundle.document) !== "issued") throw new Error("La facture doit être émise avant l'export UBL");
  const preflight = preflightInvoice({ ...bundle, mode: "peppol" });
  if (!preflight.ok) {
    const details = preflight.errors.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
    throw new Error(`Export PEPPOL bloqué — informations obligatoires manquantes :\n${details}`);
  }
  const frenchDomestic = String(bundle.seller.country || "").toUpperCase() === "FR" && String(bundle.buyer.country || "").toUpperCase() === "FR";
  const xml = createUblDocument({ ...bundle, profile: frenchDomestic ? "fr-cius" : "peppol" });
  const number = bundle.document.invoice_number || bundle.document.id;
  const fileName = `${safeFileName(number, "facture")}.xml`;
  return { ok: true, xml, filename: fileName, fileName, mimeType: "application/xml", downloadBase64: textToBase64(xml) };
}

function peppolText(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const item = object(value);
  return String(item.value || item.id || item.text || item.name || "").trim();
}

function normalizePeppolEndpoint(schemeValue: unknown, endpointValue: unknown) {
  let scheme = String(schemeValue || "").trim();
  let endpointId = String(endpointValue || "").trim();
  let candidate = endpointId;
  if (/^iso6523-actorid-upis$/i.test(scheme)) candidate = `${scheme}:${endpointId}`;
  if (/^iso6523-actorid-upis:/i.test(candidate)) {
    candidate = candidate.replace(/^iso6523-actorid-upis:{1,2}/i, "");
    scheme = "";
  }
  const parts = candidate.split(":").filter(Boolean);
  if (parts.length > 1 && (/^\d{4}$/.test(parts[0]) || !scheme)) {
    scheme = parts.shift() || scheme;
    endpointId = parts.join(":");
  }
  return { scheme, endpointId };
}

function peppolCards(payload: unknown) {
  if (Array.isArray(payload)) return payload.map(object);
  const root = object(payload);
  const candidates = [root.matches, root.businessCards, root.business_cards, root.entities, root.results, root.items];
  const list = candidates.find(Array.isArray);
  return Array.isArray(list) ? list.map(object) : [];
}

function normalizePeppolCard(card: JsonRecord) {
  const participant = object(card.participantID || card.participantId || card.participant_identifier || card.participant);
  const rawParticipant = peppolText(participant) || peppolText(card.participantID || card.participantId || card.participant_identifier || card.participant);
  const value = peppolText(participant.value || participant.id) || rawParticipant;
  const normalizedEndpoint = normalizePeppolEndpoint(peppolText(participant.scheme || participant.schemeID || participant.scheme_id), value);
  const { scheme, endpointId } = normalizedEndpoint;
  const entities = Array.isArray(card.entities) ? card.entities.map(object) : [];
  const firstEntity = entities[0] || object(card.entity);
  const names = Array.isArray(firstEntity.names) ? firstEntity.names.map(object) : [];
  const name = peppolText(card.name || card.entityName || firstEntity.name || names[0]);
  const country = String(card.country || firstEntity.countryCode || firstEntity.country || "").toUpperCase().slice(0, 2);
  return { scheme, endpointId, participant: scheme && endpointId ? `${scheme}:${endpointId}` : rawParticipant, name, country };
}

async function lookupPeppolDirectory(input: JsonRecord) {
  const country = String(input.country || "").trim().toUpperCase().slice(0, 2);
  const normalizedEndpoint = normalizePeppolEndpoint(input.scheme || input.endpointScheme, input.endpointId || input.endpoint_id);
  const { scheme, endpointId } = normalizedEndpoint;
  const query = String(input.query || input.legalId || input.legal_id || input.vatId || input.vat_id || input.name || "").trim();
  if (!query && !endpointId) throw new Error("Indiquez un nom, un identifiant légal, un numéro de TVA ou un identifiant PEPPOL");
  const url = new URL("https://directory.peppol.eu/search/1.0/json");
  if (scheme && endpointId) url.searchParams.set("participant", `iso6523-actorid-upis::${scheme}:${endpointId}`);
  else url.searchParams.set("q", query || endpointId);
  if (country) url.searchParams.set("country", country);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "D2F-Gestion/1.0" }, signal: controller.signal });
    if (!response.ok) throw new Error(`Annuaire PEPPOL indisponible (${response.status})`);
    const text = await response.text();
    if (!text.trim()) return { ok: true, found: false, results: [], source: "Peppol Directory" };
    const payload = JSON.parse(text) as unknown;
    const results = peppolCards(payload).map(normalizePeppolCard).filter((item) => item.endpointId && item.scheme).slice(0, 20);
    return { ok: true, found: results.length > 0, results, source: "Peppol Directory", directoryUrl: `https://directory.peppol.eu/public/menuitem-search?q=${encodeURIComponent(query || endpointId)}` };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Le délai de réponse de l’annuaire PEPPOL est dépassé");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function reportingBoolean(value: unknown) {
  return value === true || value === 1 || String(value || "").toLowerCase() === "true" || String(value || "") === "1";
}

function reportingPeriod(input: JsonRecord) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const start = String(input.periodStart || input.period_start || monthStart).slice(0, 10);
  const end = String(input.periodEnd || input.period_end || monthEnd).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error("Période réglementaire invalide");
  return { start, end };
}

function regulatoryProfile(country: string) {
  const profiles: Record<string, JsonRecord> = {
    FR: { country: "FR", code: "FR_PA", titleKey: "reporting.profile.fr.title", summaryKey: "reporting.profile.fr.summary", title: "France — Facturation électronique et e-reporting" },
    RS: { country: "RS", code: "RS_SEF", titleKey: "reporting.profile.rs.title", summaryKey: "reporting.profile.rs.summary", title: "Serbie — SEF, TVA électronique et fiscalisation" },
    IT: { country: "IT", code: "IT_SDI", titleKey: "reporting.profile.it.title", summaryKey: "reporting.profile.it.summary", title: "Italie — SdI et transmissions fiscales" },
    ES: { country: "ES", code: "ES_AEAT", titleKey: "reporting.profile.es.title", summaryKey: "reporting.profile.es.summary", title: "Espagne — AEAT, VERI*FACTU et SII" },
  };
  return profiles[country] || { country, code: "GENERIC", titleKey: "reporting.profile.default.title", summaryKey: "reporting.profile.default.summary", title: "Déclarations nationales à qualifier" };
}

function transmissionIsRegulatory(item: JsonRecord) {
  const receipt = object(item.receipt);
  const metadata = object(receipt.metadata);
  return String(metadata.kind || "") === "regulatory_reporting";
}

async function conformitySummary(ownerEmail: string, periodInput: JsonRecord = {}) {
  const [company, invoices, payments, clients, inbound, connector, allTransmissions] = await Promise.all([
    getCompany(ownerEmail),
    listRecords(ownerEmail, "invoices"),
    listRecords(ownerEmail, "payments"),
    listRecords(ownerEmail, "clients"),
    listRecords(ownerEmail, "inbound"),
    getIntegration(getSupabaseAdmin(), ownerEmail, "pa").catch(() => ({})),
    listTransmissions(getSupabaseAdmin(), ownerEmail).catch(() => []),
  ]);
  const companyData = object(company);
  const connectorData = object(connector);
  const invoiceRecords = invoices.map(object);
  const paymentRecords = payments.map(object);
  const clientRecords = clients.map(object);
  const inboundRecords = inbound.map(object);
  const country = String(companyData.country || "").trim().toUpperCase().slice(0, 2) || "FR";
  const profile = regulatoryProfile(country);
  const config = object(companyData.conformity);
  const period = reportingPeriod(periodInput);
  const inPeriod = (record: JsonRecord) => {
    const date = String(record.date || record.document_date || record.created_at || "").slice(0, 10);
    return Boolean(date && date >= period.start && date <= period.end);
  };
  const clientById = new Map<string, JsonRecord>(clientRecords.map((client) => [String(client.id || ""), client]));
  const customer = (invoice: JsonRecord): JsonRecord => clientById.get(String(invoice.client_id || "")) || {};
  const customerCountry = (invoice: JsonRecord) => String(customer(invoice).country || invoice.buyer_country || country).toUpperCase().slice(0, 2);
  const customerType = (invoice: JsonRecord) => String(customer(invoice).customer_type || invoice.customer_type || "B2B").toUpperCase();
  const issued = invoiceRecords.filter((invoice) => invoiceStatus(invoice) === "issued" && inPeriod(invoice));
  const postedPayments = paymentRecords.filter((payment) => !["cancelled", "voided"].includes(String(payment.status || "posted").toLowerCase()) && inPeriod(payment));
  const domestic = issued.filter((invoice) => customerCountry(invoice) === country);
  const international = issued.filter((invoice) => customerCountry(invoice) !== country);
  const b2c = issued.filter((invoice) => customerType(invoice) === "B2C");
  const domesticB2b = domestic.filter((invoice) => customerType(invoice) !== "B2C");
  const creditNotes = issued.filter((invoice) => invoiceType(invoice) === "credit_note");
  const foreignInbound = inboundRecords.filter((record) => inPeriod(record) && String(record.supplier_country || record.country || country).toUpperCase().slice(0, 2) !== country);
  const regulatoryTransmissions = (Array.isArray(allTransmissions) ? allTransmissions.map(object) : []).filter(transmissionIsRegulatory);
  const adapterReady = Boolean(
    connectorData.enabled && connectorData.configured && connectorData.last_test_status === "ok" &&
    connectorData.reporting_enabled && connectorData.reporting_adapter_qualified && connectorData.reporting_submit_path &&
    connectorData.reporting_adapter_contract === "D2F_REGULATORY_BATCH_V1" &&
    String(connectorData.country || "").toUpperCase() === country
  );
  const readyState = adapterReady ? "ready" : "review";
  const obligation = (id: string, count: number, state = readyState, candidates: JsonRecord[] = []) => ({
    id, count, state, candidate_ids: candidates.map((item) => String(item.id || "")).filter(Boolean),
  });
  let obligations: JsonRecord[] = [];
  if (country === "FR") {
    const cashVat = reportingBoolean(config.vat_on_collections);
    const b2cPayments = postedPayments.filter((payment) => b2c.some((invoice) => String(invoice.id) === String(payment.invoice_id || payment.invoiceId)));
    const otherCashPayments = postedPayments.filter((payment) => !b2c.some((invoice) => String(invoice.id) === String(payment.invoice_id || payment.invoiceId)));
    obligations = [
      obligation("fr_structured_invoice_data_8_9", domesticB2b.length, readyState, domesticB2b),
      obligation("fr_transaction_data_10_1", international.length, readyState, international),
      obligation("fr_payment_data_10_2", cashVat ? otherCashPayments.length : 0, cashVat ? readyState : "not_applicable", otherCashPayments),
      obligation("fr_b2c_transactions_10_3", b2c.length, reportingBoolean(config.emits_b2c) ? readyState : "not_applicable", b2c),
      obligation("fr_b2c_payments_10_4", cashVat ? b2cPayments.length : 0, cashVat && reportingBoolean(config.emits_b2c) ? readyState : "not_applicable", b2cPayments),
    ];
  } else if (country === "RS") {
    obligations = [
      obligation("rs_sef_sales", domesticB2b.length, readyState, domesticB2b),
      obligation("rs_fiscal_receipts", b2c.length, reportingBoolean(config.retail_fiscalization) ? "external" : "review", b2c),
      obligation("rs_foreign_vat_records", international.length + foreignInbound.length, readyState, [...international, ...foreignInbound]),
      obligation("rs_aggregate_vat", issued.length + foreignInbound.length, readyState, [...issued, ...foreignInbound]),
    ];
  } else if (country === "IT") {
    obligations = [
      obligation("it_sdi_invoices", domestic.length, readyState, domestic),
      obligation("it_corrispettivi", b2c.length, "external", b2c),
      obligation("it_cross_border", international.length + foreignInbound.length, readyState, [...international, ...foreignInbound]),
    ];
  } else if (country === "ES") {
    const verifactu = String(config.spain_mode || "VERIFACTU").toUpperCase() === "VERIFACTU";
    const sii = reportingBoolean(config.spain_sii);
    obligations = [
      obligation("es_verifactu_records", issued.length, verifactu ? readyState : "external", issued),
      obligation("es_sii_books", sii ? issued.length + inboundRecords.filter(inPeriod).length : 0, sii ? readyState : "not_applicable", [...issued, ...inboundRecords.filter(inPeriod)]),
      obligation("es_cancellation_records", creditNotes.length, verifactu ? readyState : "external", creditNotes),
    ];
  } else {
    obligations = [obligation("generic_country_profile", issued.length, "review", issued)];
  }
  const sent = regulatoryTransmissions.filter((item) => !["error", "rejected", "failed"].includes(String(item.status || "").toLowerCase())).length;
  const error = regulatoryTransmissions.filter((item) => ["error", "rejected", "failed"].includes(String(item.status || "").toLowerCase())).length;
  const summary = {
    ready: obligations.filter((item) => item.state === "ready").reduce((sum, item) => sum + numberValue(item.count), 0),
    review: obligations.filter((item) => ["review", "external"].includes(String(item.state))).reduce((sum, item) => sum + numberValue(item.count), 0),
    sent,
    error,
  };
  return {
    ok: true,
    profile,
    period,
    configuration: { ready: adapterReady, connector_tested: connectorData.last_test_status === "ok", adapter_enabled: Boolean(connectorData.reporting_enabled), adapter_qualified: Boolean(connectorData.reporting_adapter_qualified) },
    obligations,
    summary,
    transmissions: regulatoryTransmissions,
    package: {
      schema: "D2F_REGULATORY_BATCH_V1",
      generated_at: new Date().toISOString(),
      company: { legal_name: companyData.legal_name || companyData.name, legal_id: companyData.legal_id, vat_id: companyData.vat_id, country },
      period,
      profile: String(profile.code || "GENERIC"),
      obligations,
      records: {
        invoices: issued.map((invoice) => ({ id: invoice.id, number: invoice.invoice_number || invoice.number, date: invoice.date, type: invoiceType(invoice), customer_country: customerCountry(invoice), customer_type: customerType(invoice), total_ht: invoice.total_ht, total_tva: invoice.total_tva, total_ttc: invoice.total_ttc })),
        payments: postedPayments.map((payment) => ({ id: payment.id, invoice_id: payment.invoice_id || payment.invoiceId, date: payment.date, amount: payment.amount, method: payment.method })),
        inbound: foreignInbound.map((record) => ({ id: record.id, number: record.doc_number || record.invoice_number, date: record.date || record.document_date, supplier_country: record.supplier_country || record.country })),
      },
    },
  };
}

async function saveTransmissionIntegration(ownerEmail: string, args: unknown[]) {
  const payload = object(first(args));
  const type = String(payload.type || payload.integration_type || "") as IntegrationType;
  if (!["pa", "archive", "email"].includes(type)) throw new Error("Type de connecteur invalide");
  return saveIntegration(getSupabaseAdmin(), ownerEmail, type, payload);
}

function expectedEInvoiceProfile(countryValue: unknown) {
  const country = String(countryValue || "").trim().toUpperCase();
  return ({ FR: "FR_PA", RS: "RS_SEF", IT: "IT_SDI", ES: "ES_VERIFACTU" } as Record<string, string>)[country] || "GENERIC_EN16931";
}

async function validatedNationalConnector(ownerEmail: string) {
  const [company, config] = await Promise.all([
    getCompany(ownerEmail),
    getIntegration(getSupabaseAdmin(), ownerEmail, "pa"),
  ]);
  const country = String(company.country || "").trim().toUpperCase();
  const expectedProfile = expectedEInvoiceProfile(country);
  if (!config.enabled || !config.configured) throw new Error("Configurez le connecteur national et testez-le avant tout envoi");
  if (String(config.country || "").toUpperCase() !== country || String(config.channel_profile || "") !== expectedProfile) {
    throw new Error(`Le connecteur enregistré ne correspond pas au pays ${country || "déclaré"}. Enregistrez le profil ${expectedProfile}.`);
  }
  if (config.last_test_status !== "ok") throw new Error("Le connecteur doit réussir un test technique avant tout envoi");
  return { company, config, country, expectedProfile };
}

async function dispatch(ownerEmail: string, method: string, args: unknown[], tenantIdentity?: { country: string; identifier: string }) {
  if (method === "i18n:load") {
    const localeArg = object(first(args));
    const locale = String(localeArg.locale || first(args) || "fr").toLowerCase().slice(0, 2);
    return dictionaries[locale] || fr;
  }
  if (method === "xpReject:load" || method === "rejectionReasons:load") return rejectionReasons;
  if (method === "company:get") return getCompany(ownerEmail);
  if (method === "company:save") {
    const payload = object(first(args));
    const identity = validateEstablishmentIdentifier(payload.country, payload.legal_id);
    if (tenantIdentity && (identity.country !== tenantIdentity.country || identity.identifier !== tenantIdentity.identifier)) {
      throw new Error("Le pays et l’identifiant de la fiche Entreprise doivent rester ceux de l’établissement inscrit. Créez un autre espace D2F pour un autre établissement.");
    }
    return saveCompany(ownerEmail, payload, true);
  }
  if (method === "company:setLogo") {
    const company = await getCompany(ownerEmail);
    const input = object(first(args));
    const logoDataUrl = String(input.dataUrl || input.data_url || first(args) || "");
    if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(logoDataUrl)) throw new Error("Le logo doit être une image PNG, JPEG ou WebP");
    if (logoDataUrl.length > 3_000_000) throw new Error("Le logo dépasse la taille maximale de 2 Mo");
    return saveCompany(ownerEmail, { ...company, logo_data_url: logoDataUrl, logo_path: "" });
  }
  if (method === "company:clearLogo") {
    const company = await getCompany(ownerEmail);
    return saveCompany(ownerEmail, { ...company, logo_data_url: "", logo_path: "" });
  }
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
  if (method === "conformity:listEvidence") return listComplianceEvidence(ownerEmail);
  if (method === "conformity:uploadEvidence") return uploadComplianceEvidence(ownerEmail, object(first(args)));
  if (method === "conformity:downloadEvidence") return downloadComplianceEvidence(ownerEmail, idFrom(first(args)));
  if (method === "conformity:deleteEvidence") return deleteComplianceEvidence(ownerEmail, idFrom(first(args)));
  if (method === "conformity:archiveEvidence") return archiveComplianceEvidence(ownerEmail, idFrom(first(args)));
  if (method === "conformity:exportEvidenceManifest") return exportComplianceManifest(ownerEmail);
  if (method === "dashboard:get") return dashboard(ownerEmail);
  if (method === "dashboard:metrics") return dashboardMetrics(ownerEmail, object(first(args)).year);
  if (method === "directory:lookupPeppol") return lookupPeppolDirectory(object(first(args)));
  if (method === "conformity:invoicePreflight") {
    const payload = object(first(args));
    const bundle = await documentBundle(ownerEmail, "invoices", idFrom(payload));
    const requestedMode = String(payload.mode || "national");
    const mode = requestedMode === "pdf" || requestedMode === "peppol" ? requestedMode : "national";
    return preflightInvoice({ ...bundle, mode });
  }
  if (method === "quotes:exportPdf") return exportDocumentPdf(ownerEmail, "quotes", args);
  if (method === "invoices:exportPdf") return exportDocumentPdf(ownerEmail, "invoices", args);
  if (method === "invoices:exportUbl") return exportInvoiceUbl(ownerEmail, first(args));

  if (method === "connections:get") {
    const type = String(object(first(args)).type || "pa") as IntegrationType;
    if (!["pa", "archive", "email"].includes(type)) throw new Error("Type de connecteur invalide");
    return getIntegration(getSupabaseAdmin(), ownerEmail, type);
  }
  if (method === "connections:save") return saveTransmissionIntegration(ownerEmail, args);
  if (method === "connections:test") {
    const type = String(object(first(args)).type || "pa") as IntegrationType;
    if (!["pa", "archive", "email"].includes(type)) throw new Error("Type de connecteur invalide");
    return testIntegration(getSupabaseAdmin(), ownerEmail, type);
  }
  if (method === "connections:listTransmissions") return listTransmissions(getSupabaseAdmin(), ownerEmail);
  if (method === "conformity:openQueue") {
    const transmissions = await listTransmissions(getSupabaseAdmin(), ownerEmail);
    return (Array.isArray(transmissions) ? transmissions.map(object) : []).filter(transmissionIsRegulatory);
  }
  if (method === "connections:sendInvoice") {
    const payload = object(first(args));
    const connector = await validatedNationalConnector(ownerEmail);
    const bundle = await documentBundle(ownerEmail, "invoices", idFrom(payload));
    if (invoiceStatus(bundle.document) !== "issued") throw new Error("La facture doit être émise avant transmission au réseau national");
    const preflight = preflightInvoice({ ...bundle, mode: "national" });
    if (!preflight.ok) {
      const details = preflight.errors.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
      throw new Error(`Transmission nationale bloquée — contrôle pays incomplet :\n${details}`);
    }
    if (connector.country === "IT") throw new Error("L’envoi SdI direct exige le format FatturaPA et une recette avec le canal choisi. Ce connecteur n’est pas encore autorisé à transmettre un UBL comme FatturaPA.");
    if (connector.country === "ES") throw new Error("VERI*FACTU exige des registres AEAT spécifiques et ne correspond pas à l’envoi d’une facture UBL. Configurez un prestataire certifiant le flux avant activation.");
    const xml = createUblDocument({ ...bundle, profile: connector.country === "FR" ? "fr-cius" : connector.country === "RS" ? "sef" : "en16931" });
    return transmitIntegration(getSupabaseAdmin(), ownerEmail, "pa", { documentId: String(bundle.document.id || ""), documentNumber: String(bundle.document.invoice_number || ""), content: xml, contentType: "application/xml", metadata: { format: "UBL-2.1", standard: "EN16931", channel_profile: connector.expectedProfile, country: connector.country } });
  }
  if (method === "conformity:rebuildPeriod") {
    const prepared = await conformitySummary(ownerEmail, object(first(args)));
    return { ...prepared, message: "Période réglementaire préparée à partir des données de l’entreprise" };
  }
  if (method === "conformity:sendNow") {
    const connector = await validatedNationalConnector(ownerEmail);
    if (!connector.config.reporting_enabled || !connector.config.reporting_submit_path) throw new Error("Configurez le chemin API de l’adaptateur réglementaire dans la fiche Entreprise");
    if (!connector.config.reporting_adapter_qualified || connector.config.reporting_adapter_contract !== "D2F_REGULATORY_BATCH_V1") {
      throw new Error("Transmission bloquée : la recette métier de l’adaptateur réglementaire n’est pas validée pour ce pays");
    }
    const prepared = await conformitySummary(ownerEmail, object(first(args)));
    if (!prepared.configuration.ready) throw new Error("Transmission bloquée : le connecteur réglementaire n’est pas prêt");
    if (prepared.summary.ready < 1) throw new Error("Aucun dossier prêt à transmettre pour cette période");
    const batchNumber = `REG-${connector.country}-${prepared.period.start}-${prepared.period.end}`;
    const sent = await transmitIntegration(getSupabaseAdmin(), ownerEmail, "pa", {
      documentNumber: batchNumber,
      content: JSON.stringify(prepared.package),
      contentType: "application/json",
      path: String(connector.config.reporting_submit_path),
      metadata: { kind: "regulatory_reporting", profile: connector.expectedProfile, period: prepared.period, schema: "D2F_REGULATORY_BATCH_V1", summary: prepared.summary },
    });
    return { ...sent, profile: prepared.profile, summary: prepared.summary, message: `Lot ${batchNumber} remis à l’adaptateur réglementaire ${connector.config.provider_name || connector.expectedProfile}` };
  }
  if (method === "email:send") {
    const payload = object(first(args));
    const config = await getIntegration(getSupabaseAdmin(), ownerEmail, "email").catch(() => null);
    if (!config?.enabled || !config?.configured) return { ok: true, requiresClientMail: true, to: payload.to, subject: payload.subject, text: payload.text };
    return transmitIntegration(getSupabaseAdmin(), ownerEmail, "email", { documentNumber: String(payload.attachmentName || ""), content: JSON.stringify(payload), contentType: "application/json", metadata: { to: payload.to } });
  }

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
    if (entity === "payments" && ["save", "upsert", "create", "update", "record"].includes(action)) {
      return savePaymentRecord(ownerEmail, object(first(args)));
    }
    if (["save", "upsert", "create", "update", "record"].includes(action)) {
      const input = object(first(args));
      if (input.id && (entity === "quotes" || entity === "invoices")) {
        const current = await getRecord(ownerEmail, entity, String(input.id));
        if (current && String(current.status || "draft").toLowerCase() !== "draft") {
          throw new Error(entity === "quotes"
            ? "Seul un devis brouillon peut être modifié"
            : "Seule une facture brouillon peut être modifiée");
        }
      }
      return saveRecord(ownerEmail, entity, input);
    }
    if (["remove", "delete"].includes(action)) {
      const id = idFrom(first(args));
      if (entity === "quotes" || entity === "invoices") {
        const current = await getRecord(ownerEmail, entity, id);
        if (current && String(current.status || "draft").toLowerCase() !== "draft") {
          throw new Error(entity === "quotes"
            ? "Seul un devis brouillon peut être supprimé"
            : "Seule une facture brouillon peut être supprimée");
        }
      }
      return removeRecord(ownerEmail, entity, id);
    }
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
      const currentStatus = String(source.status || "draft").toLowerCase();
      const nextStatus = String(args[1] || object(first(args)).status || "").toLowerCase();
      const allowedTransitions: Record<string, string[]> = {
        draft: ["sent", "accepted", "rejected"],
        sent: ["accepted", "rejected"],
        accepted: [],
        rejected: [],
        cancelled: [],
      };
      if (!allowedTransitions[currentStatus]?.includes(nextStatus)) {
        throw new Error(`Transition de devis interdite : ${currentStatus} → ${nextStatus}`);
      }
      return saveRecord(ownerEmail, "quotes", { ...source, status: nextStatus });
    }
    if (entity === "invoices" && action === "issue") {
      const id = idFrom(first(args));
      const source = await getRecord(ownerEmail, "invoices", id);
      if (!source) throw new Error("Facture introuvable");
      const allInvoices = await listRecords(ownerEmail, "invoices");
      const isCreditNote = invoiceType(source) === "credit_note";
      const count = allInvoices.filter((item) => item.status === "issued" && (invoiceType(item) === "credit_note") === isCreditNote).length + 1;
      const prefix = isCreditNote ? "AV" : "F";
      return saveRecord(ownerEmail, "invoices", { ...source, status: "issued", invoice_number: source.invoice_number || `${prefix}${new Date().getFullYear()}-${String(count).padStart(4, "0")}`, issued_at: new Date().toISOString() });
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
      return saveRecord(ownerEmail, "invoices", { ...source, id: crypto.randomUUID(), source_invoice_id: source.id, source_invoice_number: source.invoice_number || source.number || source.id, invoice_number: "", type: "credit_note", status: "draft", total_ht: -Math.abs(numberValue(source.total_ht)), total_tva: -Math.abs(numberValue(source.total_tva)), total_ttc: -Math.abs(numberValue(source.total_ttc)) });
    }
    if (entity === "payments" && action === "sumByInvoice") {
      const id = idFrom(first(args));
      const payments = await listRecords(ownerEmail, "payments", { invoiceId: id });
      return round2(payments.reduce((sum, payment) => sum + numberValue(payment.amount), 0));
    }
    if (entity === "inbound" && action === "importFile") {
      const payload = object(first(args));
      const filename = String(payload.filename || "document");
      return saveRecord(ownerEmail, "inbound", { id: crypto.randomUUID(), filename, file_name: filename, mime: String(payload.mimeType || payload.mime || "application/octet-stream"), raw_base64: String(payload.contentBase64 || ""), raw_text: String(payload.text || ""), status: "received", received_at: new Date().toISOString(), supplier_name: String(payload.supplier_name || ""), invoice_number: String(payload.invoice_number || filename.replace(/\.[^.]+$/, "")), date: String(payload.date || today()), total_ttc: numberValue(payload.total_ttc) });
    }
    if (entity === "inbound" && ["accept", "reject", "dispute"].includes(action)) {
      const id = idFrom(first(args));
      const source = await getRecord(ownerEmail, "inbound", id);
      if (!source) throw new Error("Facture fournisseur introuvable");
      const status = action === "accept" ? "accepted" : action === "reject" ? "rejected" : "disputed";
      return saveRecord(ownerEmail, "inbound", { ...source, ...object(first(args)), id, status, decided_at: new Date().toISOString() });
    }
    if (entity === "inbound" && action === "exportXml") {
      const record = await getRecord(ownerEmail, "inbound", idFrom(first(args)));
      if (!record) throw new Error("Facture fournisseur introuvable");
      const rawText = String(record.raw_text || "");
      if (!rawText.trim().startsWith("<")) throw new Error("Le document reçu ne contient pas de XML exportable");
      const fileName = `${safeFileName(record.filename || record.invoice_number, "facture-fournisseur")}.xml`;
      return { ok: true, fileName, filePath: fileName, mimeType: "application/xml", downloadBase64: textToBase64(rawText) };
    }
    if (entity === "inbound" && action === "exportPdf") {
      const record = await getRecord(ownerEmail, "inbound", idFrom(first(args)));
      if (!record) throw new Error("Facture fournisseur introuvable");
      const company = await getCompany(ownerEmail);
      const supplier = { legal_name: record.supplier_name || record.supplier || "Fournisseur", country: record.supplier_country || "FR", vat_id: record.supplier_vat_id || "" };
      const totalTtc = numberValue(record.total_ttc || record.amount_due);
      const bytes = await createDocumentPdf({ kind: "invoice", document: { ...record, invoice_number: record.invoice_number || record.filename, total_ht: record.total_ht || totalTtc, total_tva: record.total_tva || 0, total_ttc: totalTtc, amount_due: totalTtc }, lines: Array.isArray(record.lines) && record.lines.length ? record.lines.map(object) : [{ description: record.description || record.filename || "Facture fournisseur", quantity: 1, unit_price_ht: record.total_ht || totalTtc, tva_percent: 0 }], seller: supplier, buyer: company, locale: object(first(args)).locale || "fr" });
      const fileName = `${safeFileName(record.invoice_number || record.filename, "facture-fournisseur")}.pdf`;
      return { ok: true, fileName, filePath: fileName, mimeType: "application/pdf", downloadBase64: pdfBytesToBase64(bytes) };
    }
  }
  if (method === "audit:path") return { ok: true, logPath: "Supabase • piste d’audit sécurisée" };
  if (method === "audit:read") return readAuditEvents(ownerEmail, object(first(args)));
  if (method === "audit:verify") return verifyAuditEvents(ownerEmail);
  if (method.startsWith("files:")) throw new Error("Cette fonction doit être exécutée par le navigateur");
  if (method.startsWith("inbound:") || method.startsWith("connections:") || method.startsWith("conformity:")) return { ok: true };
  throw new Error(`Méthode web non prise en charge : ${method}`);
}

export async function POST(request: Request) {
  const appSession = await readAppSession(request);
  const ownerEmail = appSession?.ownerKey || getOwnerEmail(request);
  if (!ownerEmail) return reply("Authentification requise", 401);
  let refreshedCookie = "";
  let tenantIdentity: { country: string; identifier: string } | undefined;
  if (appSession) {
    const account = await getAccountById(appSession.tenantId);
    const member = account ? memberFor(account, appSession.userId, appSession.email) : null;
    if (!account || !member) return reply("Accès entreprise révoqué", 403);
    if (!accountAllowsApplication(account)) return reply("Abonnement inactif — validation du virement requise", 402);
    tenantIdentity = { country: account.country.toUpperCase(), identifier: account.companyIdentifier.toUpperCase() };
    const refreshed = renewedSession({
      userId: appSession.userId,
      email: appSession.email,
      fullName: appSession.fullName,
      tenantId: account.id,
      ownerKey: account.ownerKey,
      role: member.role,
    });
    refreshedCookie = await sessionCookie(refreshed, request);
  }
  const responseHeaders = refreshedCookie ? { "set-cookie": refreshedCookie } : undefined;
  let method = "";
  try {
    const body = object(await request.json());
    method = String(body.method || "");
    const args = Array.isArray(body.args) ? body.args : [];
    if (!method || !method.includes(":")) return reply("Méthode RPC invalide", 400, responseHeaders);
    const result = await dispatch(ownerEmail, method, args, tenantIdentity);
    if (isMutationMethod(method)) await appendAuditEvent(ownerEmail, appSession?.email || ownerEmail, method, args, result);
    return reply(result, 200, responseHeaders);
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      const fallback = previewResult(method);
      if (fallback !== undefined) return reply(fallback, 200, responseHeaders);
      return reply("Supabase n’est pas encore configuré", 503, responseHeaders);
    }
    return reply(error instanceof Error ? error.message : "Erreur RPC", 500, responseHeaders);
  }
}
