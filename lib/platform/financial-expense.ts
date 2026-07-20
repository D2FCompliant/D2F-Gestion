import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateExpenseLine, expenseCountryPolicy } from "./expense-country-policy";

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).trim();
}

function amount(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Montant invalide");
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function missingFoundation(error: { code?: string; message?: string } | null) {
  return Boolean(error && (
    error.code === "42P01" ||
    error.code === "PGRST202" ||
    error.code === "PGRST205" ||
    /d2f_(expense|financial)|d2f_expense_|d2f_financial_/i.test(error.message || "")
  ));
}

function throwDatabase(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (missingFoundation(error)) throw new Error("Le socle D2F Financial / Expenses doit être activé sur la base de données");
  throw new Error(error.message || "Erreur de stockage D2F Platform");
}

export async function refreshFinancialProjections(supabase: SupabaseClient, ownerKey: string) {
  const pending = await supabase
    .from("d2f_event_outbox")
    .select("event_id,event_type")
    .eq("owner_key", ownerKey)
    .in("event_type", ["InvoiceIssued", "ExpenseApproved"])
    .order("occurred_at", { ascending: true })
    .limit(200);
  throwDatabase(pending.error);
  let processed = 0;
  for (const event of pending.data || []) {
    const procedure = event.event_type === "InvoiceIssued"
      ? "d2f_financial_consume_invoice_issued_v1"
      : "d2f_financial_consume_expense_approved_v1";
    const result = await supabase.rpc(procedure, { p_event_id: event.event_id });
    throwDatabase(result.error);
    if (result.data?.status !== "already_processed") processed += 1;
  }
  return { scanned: (pending.data || []).length, processed };
}

export async function listFinancialWorkspace(supabase: SupabaseClient, ownerKey: string) {
  const [invoices, proposals] = await Promise.all([
    supabase
      .from("d2f_financial_invoice_projections")
      .select("invoice_id,invoice_number,invoice_type,issue_date,due_date,customer_id,customer_name,currency,net_amount,tax_amount,gross_amount,projected_at")
      .eq("owner_key", ownerKey)
      .order("issue_date", { ascending: false })
      .limit(200),
    supabase
      .from("d2f_financial_accounting_proposals")
      .select("id,source_type,source_id,status,currency,amount,proposal,created_at,validated_at,posted_at")
      .eq("owner_key", ownerKey)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  throwDatabase(invoices.error);
  throwDatabase(proposals.error);
  const proposalRows = proposals.data || [];
  return {
    invoices: invoices.data || [],
    proposals: proposalRows,
    summary: {
      projectedInvoices: (invoices.data || []).length,
      proposalDrafts: proposalRows.filter((item) => item.status === "draft").length,
      amountAwaitingValidation: proposalRows
        .filter((item) => item.status === "draft")
        .reduce((sum, item) => sum + Number(item.amount || 0), 0),
    },
  };
}

export async function listExpenseWorkspace(supabase: SupabaseClient, ownerKey: string) {
  const reports = await supabase
    .from("d2f_expense_reports")
    .select("id,report_number,claimant_id,claimant_name,title,currency,status,total_net,total_tax,total_gross,aggregate_version,submitted_at,decided_at,approver_id,decision_note,created_at,updated_at")
    .eq("owner_key", ownerKey)
    .order("updated_at", { ascending: false })
    .limit(200);
  throwDatabase(reports.error);

  const ids = (reports.data || []).map((report) => report.id);
  if (!ids.length) return { reports: [], lines: [], receipts: [], summary: { draft: 0, submitted: 0, approved: 0, totalApproved: 0 } };

  const [lines, receipts] = await Promise.all([
    supabase
      .from("d2f_expense_lines")
      .select("id,report_id,occurred_on,merchant,description,category,business_purpose,country,currency,net_amount,tax_amount,gross_amount,reimbursable,vat_recoverability,receipt_required,policy_result,created_at")
      .in("report_id", ids)
      .order("occurred_on", { ascending: false }),
    supabase
      .from("d2f_expense_receipts")
      .select("id,report_id,expense_line_id,original_filename,media_type,byte_size,sha256,captured_at,uploaded_by,origin,extraction_status,capture_context,capture_location,created_at")
      .in("report_id", ids)
      .order("created_at", { ascending: false }),
  ]);
  throwDatabase(lines.error);
  throwDatabase(receipts.error);

  const rows = reports.data || [];
  return {
    reports: rows,
    lines: lines.data || [],
    receipts: receipts.data || [],
    summary: {
      draft: rows.filter((item) => item.status === "draft" || item.status === "returned").length,
      submitted: rows.filter((item) => item.status === "submitted").length,
      approved: rows.filter((item) => item.status === "approved").length,
      totalApproved: rows.filter((item) => item.status === "approved").reduce((sum, item) => sum + Number(item.total_gross || 0), 0),
    },
  };
}

export async function createExpenseReport(
  supabase: SupabaseClient,
  ownerKey: string,
  tenantId: string,
  actorId: string,
  inputValue: unknown,
) {
  const input = object(inputValue);
  const title = text(input.title);
  if (title.length < 3) throw new Error("Indiquez l'objet de la note de frais");
  const currency = text(input.currency || "EUR").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Devise invalide");
  const id = crypto.randomUUID();
  const reportNumber = `NDF-${new Date().getUTCFullYear()}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const inserted = await supabase
    .from("d2f_expense_reports")
    .insert({
      id,
      owner_key: ownerKey,
      tenant_id: tenantId || ownerKey,
      report_number: reportNumber,
      claimant_id: actorId,
      claimant_name: text(input.claimantName || input.claimant_name || actorId),
      title,
      currency,
      status: "draft",
    })
    .select("*")
    .single();
  throwDatabase(inserted.error);
  return inserted.data;
}

export async function addExpenseLine(
  supabase: SupabaseClient,
  ownerKey: string,
  establishmentCountry: string,
  inputValue: unknown,
) {
  const input = object(inputValue);
  const reportId = text(input.reportId || input.report_id);
  const report = await supabase
    .from("d2f_expense_reports")
    .select("id,status,currency")
    .eq("id", reportId)
    .eq("owner_key", ownerKey)
    .maybeSingle();
  throwDatabase(report.error);
  if (!report.data) throw new Error("Note de frais introuvable");
  if (!["draft", "returned"].includes(report.data.status)) throw new Error("Cette note de frais n'est plus modifiable");

  const net = amount(input.netAmount ?? input.net_amount);
  const tax = amount(input.taxAmount ?? input.tax_amount);
  const gross = amount(input.grossAmount ?? input.gross_amount ?? net + tax);
  if (Math.abs(gross - net - tax) > 0.01) throw new Error("Le total TTC doit correspondre au montant HT augmenté de la taxe");

  const merchant = text(input.merchant);
  const description = text(input.description);
  const purpose = text(input.businessPurpose || input.business_purpose);
  if (!merchant || !description || !purpose) throw new Error("Commerçant, description et motif professionnel sont obligatoires");

  const policy = evaluateExpenseLine(establishmentCountry, input);

  const inserted = await supabase
    .from("d2f_expense_lines")
    .insert({
      report_id: reportId,
      occurred_on: text(input.occurredOn || input.occurred_on || new Date().toISOString().slice(0, 10)),
      merchant,
      description,
      category: policy.category,
      business_purpose: purpose,
      country: text(input.country).toUpperCase().slice(0, 2) || null,
      currency: text(input.currency || report.data.currency).toUpperCase(),
      net_amount: net,
      tax_amount: tax,
      gross_amount: gross,
      reimbursable: input.reimbursable == null ? null : Boolean(input.reimbursable),
      receipt_required: policy.receiptRequired,
      policy_result: policy.policyResult,
    })
    .select("*")
    .single();
  throwDatabase(inserted.error);
  return inserted.data;
}

const EXPENSE_RECEIPT_BUCKET = "d2f-expense-receipts";
const EXPENSE_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
const EXPENSE_RECEIPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

function decodeBase64(value: string) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function receiptFileName(value: unknown) {
  return text(value || "justificatif").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 180) || "justificatif";
}

async function ensureExpenseReceiptBucket(supabase: SupabaseClient) {
  const existing = await supabase.storage.getBucket(EXPENSE_RECEIPT_BUCKET);
  if (!existing.error) return;
  const created = await supabase.storage.createBucket(EXPENSE_RECEIPT_BUCKET, {
    public: false,
    fileSizeLimit: EXPENSE_RECEIPT_MAX_BYTES,
    allowedMimeTypes: [...EXPENSE_RECEIPT_TYPES],
  });
  if (created.error && !/already exists|duplicate/i.test(created.error.message || "")) throwDatabase(created.error);
}

export async function uploadExpenseReceipt(
  supabase: SupabaseClient,
  ownerKey: string,
  actorId: string,
  inputValue: unknown,
) {
  const input = object(inputValue);
  const reportId = text(input.reportId || input.report_id);
  const report = await supabase.from("d2f_expense_reports").select("id,status")
    .eq("id", reportId).eq("owner_key", ownerKey).maybeSingle();
  throwDatabase(report.error);
  if (!report.data) throw new Error("Note de frais introuvable");
  if (!["draft", "returned"].includes(report.data.status)) throw new Error("Les justificatifs ne peuvent être ajoutés qu'à une note modifiable");

  const expenseLineId = text(input.expenseLineId || input.expense_line_id) || null;
  if (expenseLineId) {
    const line = await supabase.from("d2f_expense_lines").select("id").eq("id", expenseLineId).eq("report_id", reportId).maybeSingle();
    throwDatabase(line.error);
    if (!line.data) throw new Error("La ligne de dépense ne correspond pas à cette note");
  }

  const mediaType = text(input.mimeType || input.mediaType || input.media_type).toLowerCase();
  if (!EXPENSE_RECEIPT_TYPES.has(mediaType)) throw new Error("Utilisez une photo JPEG, PNG, WebP ou un justificatif PDF");
  const content = text(input.contentBase64 || input.content_base64);
  if (!content) throw new Error("Le justificatif est vide");
  const bytes = decodeBase64(content);
  if (!bytes.length || bytes.length > EXPENSE_RECEIPT_MAX_BYTES) throw new Error("Le justificatif doit être compris entre 1 octet et 10 Mo");

  const filename = receiptFileName(input.filename || input.name);
  const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
  const ownerHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerKey.toLowerCase()))).slice(0, 32);
  const receiptId = crypto.randomUUID();
  const storageReference = [ownerHash, reportId, receiptId, filename].join("/");
  const device = object(input.deviceContext || input.device_context);
  const location = object(input.location);
  const captureContext = {
    userAgent: text(device.userAgent || device.user_agent).slice(0, 500),
    platform: text(device.platform).slice(0, 120),
    language: text(device.language).slice(0, 20),
    viewport: object(device.viewport),
  };
  const latitude = Number(location.latitude);
  const longitude = Number(location.longitude);
  const captureLocation = Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { latitude, longitude, accuracy: Number(location.accuracy) || null, consent: true }
    : {};

  await ensureExpenseReceiptBucket(supabase);
  const uploaded = await supabase.storage.from(EXPENSE_RECEIPT_BUCKET).upload(storageReference, bytes, {
    contentType: mediaType,
    upsert: false,
  });
  if (uploaded.error) throwDatabase(uploaded.error);

  const inserted = await supabase.from("d2f_expense_receipts").insert({
    id: receiptId,
    report_id: reportId,
    expense_line_id: expenseLineId,
    original_filename: filename,
    media_type: mediaType,
    byte_size: bytes.length,
    sha256,
    storage_reference: storageReference,
    captured_at: text(input.capturedAt || input.captured_at || new Date().toISOString()),
    uploaded_by: actorId,
    origin: input.origin === "smartphone_capture" ? "smartphone_capture" : "manual_upload",
    extraction_status: "not_requested",
    capture_context: captureContext,
    capture_location: captureLocation,
  }).select("id,report_id,expense_line_id,original_filename,media_type,byte_size,sha256,captured_at,uploaded_by,origin,extraction_status,capture_context,capture_location,created_at").single();
  if (inserted.error) {
    await supabase.storage.from(EXPENSE_RECEIPT_BUCKET).remove([storageReference]).catch(() => undefined);
    throwDatabase(inserted.error);
  }
  return inserted.data;
}

export async function submitExpenseReport(
  supabase: SupabaseClient,
  ownerKey: string,
  establishmentCountry: string,
  actorId: string,
  inputValue: unknown,
) {
  const input = object(inputValue);
  const reportId = text(input.id || input.reportId || input.report_id);
  const countryPolicy = expenseCountryPolicy(establishmentCountry);
  if (countryPolicy.status === "not_qualified") throw new Error("Soumission bloquée : le Country Pack " + countryPolicy.country + " n'est pas qualifié");
  const report = await supabase.from("d2f_expense_reports").select("id").eq("id", reportId).eq("owner_key", ownerKey).maybeSingle();
  throwDatabase(report.error);
  if (!report.data) throw new Error("Note de frais introuvable");
  const [requiredLines, receipts] = await Promise.all([
    supabase.from("d2f_expense_lines").select("id").eq("report_id", reportId).eq("receipt_required", true),
    supabase.from("d2f_expense_receipts").select("expense_line_id").eq("report_id", reportId),
  ]);
  throwDatabase(requiredLines.error);
  throwDatabase(receipts.error);
  const covered = new Set((receipts.data || []).map((item) => item.expense_line_id).filter(Boolean));
  const missingReceipt = (requiredLines.data || []).find((line) => !covered.has(line.id));
  if (missingReceipt) throw new Error("Ajoutez et rattachez un justificatif à chaque ligne avant la soumission");
  const { data, error } = await supabase.rpc("d2f_expense_submit_v1", {
    p_owner_key: ownerKey,
    p_report_id: reportId,
    p_actor_id: actorId,
    p_idempotency_key: text(input.idempotencyKey || input.idempotency_key || `expense:submit:${reportId}`),
    p_event_id: crypto.randomUUID(),
    p_correlation_id: crypto.randomUUID(),
  });
  throwDatabase(error);
  return data;
}

export async function decideExpenseReport(
  supabase: SupabaseClient,
  ownerKey: string,
  actorId: string,
  inputValue: unknown,
) {
  const input = object(inputValue);
  const reportId = text(input.id || input.reportId || input.report_id);
  const decision = text(input.decision);
  if (!["approved", "rejected", "returned"].includes(decision)) throw new Error("Décision invalide");
  const { data, error } = await supabase.rpc("d2f_expense_decide_v1", {
    p_owner_key: ownerKey,
    p_report_id: reportId,
    p_actor_id: actorId,
    p_decision: decision,
    p_decision_note: text(input.note || input.decisionNote || input.decision_note),
    p_idempotency_key: text(input.idempotencyKey || input.idempotency_key || `expense:decision:${decision}:${reportId}`),
    p_event_id: crypto.randomUUID(),
    p_correlation_id: crypto.randomUUID(),
  });
  throwDatabase(error);
  return data;
}
