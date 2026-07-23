import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type JsonRecord = Record<string, unknown>;

function obj(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}
function txt(value: unknown) { return String(value ?? "").trim(); }
function isoDate() { return new Date().toISOString().slice(0, 10); }
function safeAscii(value: unknown) {
  return txt(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "dj").replace(/[^\x20-\x7E\n]/g, "?");
}
function csv(value: unknown) { return '"' + txt(value).replace(/"/g, '""') + '"'; }
function bytesHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const stable = Uint8Array.from(bytes);
  return bytesHex(await crypto.subtle.digest("SHA-256", stable.buffer));
}

const NBS_AUTHORITY = "National Bank of Serbia";
const NBS_SOURCE = "https://webappcenter.nbs.rs/ExchangeRateWebApp/ExchangeRate/IndexByDate?isSearchExecuted=false";
const ECB_SOURCE = "https://data.ecb.europa.eu/key-figures/ecb-interest-rates-and-exchange-rates/exchange-rates";

export async function updateExpenseWorkflow(
  supabase: SupabaseClient,
  ownerKey: string,
  actorId: string,
  inputValue: unknown,
) {
  const input = obj(inputValue);
  const id = txt(input.id || input.reportId);
  const documentType = txt(input.documentType || input.document_type || "company_expense");
  if (!["company_expense", "travel_order"].includes(documentType)) throw new Error("Type de dépense invalide");
  const current = await supabase.from("d2f_expense_reports").select("id,claimant_id,status")
    .eq("id", id).eq("owner_key", ownerKey).maybeSingle();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw new Error("Note de frais introuvable");
  if (String(current.data.claimant_id) !== actorId) throw new Error("Seul le demandeur peut modifier ce dossier");
  if (!["draft", "returned"].includes(current.data.status)) throw new Error("Ce dossier n'est plus modifiable");
  const workflow = obj(input.workflowData || input.workflow_data);
  const updated = await supabase.from("d2f_expense_reports").update({
    document_type: documentType,
    workflow_data: workflow,
    mission_report: txt(input.missionReport || input.mission_report) || null,
    business_necessity: txt(input.businessNecessity || input.business_necessity) || null,
    updated_at: new Date().toISOString(),
  }).eq("id", id).eq("owner_key", ownerKey).select("*").single();
  if (updated.error) throw new Error(updated.error.message);
  return updated.data;
}

function requiredTravelFields(workflow: JsonRecord) {
  const order = obj(workflow.order);
  const settlement = obj(workflow.settlement);
  const missing: string[] = [];
  const required: Array<[string, unknown]> = [
    ["numéro d'ordre", order.orderNumber], ["date de l'ordre", order.orderDate],
    ["voyageur", order.traveler], ["destination", order.destinationCity],
    ["pays de destination", order.destinationCountry], ["motif professionnel", order.purpose],
    ["départ", order.departureAt], ["retour", settlement.actualReturnAt || order.expectedReturnAt],
    ["moyen de transport", order.transportMode], ["itinéraire", order.route],
  ];
  for (const [label, value] of required) if (!txt(value)) missing.push(label);
  return missing;
}

export async function validateExpenseDocument(
  supabase: SupabaseClient,
  ownerKey: string,
  establishmentCountry: string,
  actorId: string,
  countryPack: { packId?: string; version?: string | null; manifestHash?: string | null; status?: string },
  inputValue: unknown,
) {
  const input = obj(inputValue);
  const id = txt(input.id || input.reportId);
  const reportResult = await supabase.from("d2f_expense_reports")
    .select("id,claimant_id,status,currency,document_type,workflow_data,mission_report,business_necessity")
    .eq("id", id).eq("owner_key", ownerKey).maybeSingle();
  if (reportResult.error) throw new Error(reportResult.error.message);
  const report = reportResult.data;
  if (!report) throw new Error("Note de frais introuvable");
  if (String(report.claimant_id) !== actorId) throw new Error("Seul le demandeur peut valider ce dossier");
  if (!["draft", "returned"].includes(report.status)) throw new Error("Ce dossier n'est plus modifiable");
  if (countryPack.status !== "qualified") throw new Error("Validation bloquée : le Country Pack Expenses applicable doit être publié");
  if (report.document_type === "travel_order") {
    const missing = requiredTravelFields(obj(report.workflow_data));
    if (!txt(report.mission_report)) missing.push("rapport de mission");
    if (!txt(report.business_necessity)) missing.push("justification de la nécessité professionnelle");
    if (missing.length) throw new Error("Complétez avant validation : " + missing.join(", "));
  }
  const linesResult = await supabase.from("d2f_expense_lines")
    .select("id,currency,original_currency,original_gross_amount,gross_amount").eq("report_id", id);
  if (linesResult.error) throw new Error(linesResult.error.message);
  if (!(linesResult.data || []).length) throw new Error("Ajoutez au moins une dépense avant validation");
  const baseCurrency = txt(report.currency).toUpperCase();
  const foreignCurrencies = [...new Set((linesResult.data || []).map((line) => txt(line.original_currency || line.currency).toUpperCase()).filter((currency) => currency && currency !== baseCurrency))];
  const rates = obj(input.rates);
  const validationDate = isoDate();
  const sourceExpected = establishmentCountry.toUpperCase() === "RS" ? "NBS" : "ECB";
  for (const foreignCurrency of foreignCurrencies) {
    const rateInput = obj(rates[foreignCurrency]);
    const rate = Number(rateInput.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Renseignez le taux officiel " + foreignCurrency + "/" + baseCurrency + " au " + validationDate);
    const source = txt(rateInput.source || sourceExpected).toUpperCase();
    const sourceUri = txt(rateInput.sourceUri || rateInput.source_uri || (source === "NBS" ? NBS_SOURCE : ECB_SOURCE));
    if (establishmentCountry.toUpperCase() === "RS" && (source !== "NBS" || !/nbs\.rs/i.test(sourceUri))) {
      throw new Error("Pour la Serbie, le taux validé doit provenir de la Banque nationale de Serbie (NBS)");
    }
    const snapshot = { rateDate: validationDate, source, authority: source === "NBS" ? NBS_AUTHORITY : "European Central Bank or local authority", sourceUri, baseCurrency, quoteCurrency: foreignCurrency, rate };
    const digest = await sha256(JSON.stringify(snapshot));
    const inserted = await supabase.from("d2f_expense_exchange_rates").upsert({
      report_id: id, rate_date: validationDate, source, source_uri: sourceUri,
      base_currency: baseCurrency, quote_currency: foreignCurrency, rate,
      snapshot_sha256: digest, raw_snapshot: snapshot, validated_at: new Date().toISOString(), validated_by: actorId,
    }, { onConflict: "report_id,rate_date,base_currency,quote_currency" });
    if (inserted.error) throw new Error(inserted.error.message);
  }
  const updated = await supabase.from("d2f_expense_reports").update({
    validated_at: new Date().toISOString(), validated_by: actorId, validation_rate_date: validationDate,
    country_pack_id: countryPack.packId || null, country_pack_version: countryPack.version || null,
    country_pack_hash: countryPack.manifestHash || null, updated_at: new Date().toISOString(),
  }).eq("id", id).eq("owner_key", ownerKey);
  if (updated.error) throw new Error(updated.error.message);
  return { id, validatedAt: new Date().toISOString(), validationRateDate: validationDate, foreignCurrencies };
}

async function exportBundle(supabase: SupabaseClient, ownerKey: string, actorId: string, actorRole: "owner" | "collaborator", id: string) {
  const reportResult = await supabase.from("d2f_expense_reports").select("*").eq("id", id).eq("owner_key", ownerKey).maybeSingle();
  if (reportResult.error) throw new Error(reportResult.error.message);
  const report = reportResult.data;
  if (!report) throw new Error("Note de frais introuvable");
  if (actorRole !== "owner" && String(report.claimant_id) !== actorId) throw new Error("Accès refusé");
  const [lines, rates, receipts] = await Promise.all([
    supabase.from("d2f_expense_lines").select("*").eq("report_id", id).order("occurred_on"),
    supabase.from("d2f_expense_exchange_rates").select("*").eq("report_id", id).order("rate_date"),
    supabase.from("d2f_expense_receipts").select("id,expense_line_id,original_filename,sha256,security_status").eq("report_id", id),
  ]);
  if (lines.error || rates.error || receipts.error) throw new Error(lines.error?.message || rates.error?.message || receipts.error?.message || "Export indisponible");
  return { report, lines: lines.data || [], rates: rates.data || [], receipts: receipts.data || [] };
}

export async function createExpenseAccountantCsv(
  supabase: SupabaseClient, ownerKey: string, actorId: string, actorRole: "owner" | "collaborator", inputValue: unknown,
) {
  const input = obj(inputValue); const id = txt(input.id || input.reportId);
  const bundle = await exportBundle(supabase, ownerKey, actorId, actorRole, id);
  const header = ["report_number","document_type","status","claimant","validation_date","country_pack","expense_date","merchant","category","business_purpose","original_currency","original_gross","report_currency","gross","tax","payment_method","fx_rate_date","fx_source","fx_rate","fx_snapshot_sha256","receipt_sha256"];
  const receipts = new Map(bundle.receipts.map((item) => [String(item.expense_line_id || ""), item]));
  const rates = new Map(bundle.rates.map((item) => [String(item.quote_currency || "").toUpperCase(), item]));
  const rows = bundle.lines.map((line) => {
    const receipt = receipts.get(String(line.id));
    const originalCurrency = txt(line.original_currency || line.currency).toUpperCase();
    const rate = rates.get(originalCurrency);
    return [
      bundle.report.report_number,bundle.report.document_type,bundle.report.status,bundle.report.claimant_name || bundle.report.claimant_id,
      bundle.report.validation_rate_date,[bundle.report.country_pack_id,bundle.report.country_pack_version].filter(Boolean).join("@"),
      line.occurred_on,line.merchant,line.category,line.business_purpose,originalCurrency,
      line.original_gross_amount || line.gross_amount,bundle.report.currency,line.gross_amount,line.tax_amount,line.payment_method,
      rate?.rate_date || "",rate?.source || "",rate?.rate || "",rate?.snapshot_sha256 || "",receipt?.sha256 || "",
    ].map(csv).join(",");
  });
  const content = [header.map(csv).join(","), ...rows].join("\r\n");
  const fileName = bundle.report.report_number + "-comptable.csv";
  const digest = await sha256(content);
  const logged = await supabase.from("d2f_expense_exports").insert({ report_id: id, export_type: "accountant", format: "csv", file_name: fileName, sha256: digest, generated_by: actorId, metadata: { countryPack: bundle.report.country_pack_id, validationRateDate: bundle.report.validation_rate_date } });
  if (logged.error) throw new Error(logged.error.message);
  return { content, fileName, mimeType: "text/csv" };
}

function wrap(value: string, max = 84) {
  const words = safeAscii(value).split(/\s+/); const lines: string[] = []; let line = "";
  for (const word of words) { const next = line ? line + " " + word : word; if (next.length > max && line) { lines.push(line); line = word; } else line = next; }
  if (line) lines.push(line); return lines;
}
export async function createExpenseDocumentPdf(
  supabase: SupabaseClient, ownerKey: string, actorId: string, actorRole: "owner" | "collaborator", inputValue: unknown,
) {
  const input = obj(inputValue); const id = txt(input.id || input.reportId); const type = txt(input.type || "travel_order");
  if (!["travel_order","travel_account","bank_reimbursement"].includes(type)) throw new Error("Type d'export invalide");
  const bundle = await exportBundle(supabase, ownerKey, actorId, actorRole, id);
  if (bundle.report.document_type !== "travel_order" && type !== "bank_reimbursement") throw new Error("Cet export est réservé aux ordres de mission");
  if (type === "bank_reimbursement" && bundle.report.status !== "approved") throw new Error("Le justificatif bancaire est disponible après approbation");
  const workflow = obj(bundle.report.workflow_data), order = obj(workflow.order), settlement = obj(workflow.settlement);
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595.28,841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(.04,.31,.72), ink = rgb(.05,.09,.15); let y = 795;
  const title = type === "travel_order" ? "NALOG ZA SLUZBENO PUTOVANJE / TRAVEL ORDER" : type === "travel_account" ? "PUTNI RACUN / TRAVEL ACCOUNT" : "BANK REIMBURSEMENT SUPPORTING FILE";
  page.drawText(title,{x:38,y,size:16,font:bold,color:blue}); y-=30;
  const entries: Array<[string,unknown]> = type === "travel_order" ? [
    ["Company",order.companyName],["Order number",order.orderNumber || bundle.report.report_number],["Order date",order.orderDate],
    ["Traveller",order.traveler || bundle.report.claimant_name],["Role",order.travelerRole],["Destination",txt(order.destinationCity)+", "+txt(order.destinationCountry)],
    ["Purpose",order.purpose],["Departure",order.departureAt],["Expected return",order.expectedReturnAt],["Transport",order.transportMode],
    ["Route",order.route],["Advance",order.advanceDescription],["Costs borne by",order.costBearer || "Company"],
  ] : type === "travel_account" ? [
    ["Report",bundle.report.report_number],["Traveller",bundle.report.claimant_name],["Actual return",settlement.actualReturnAt],
    ["Duration (hours)",settlement.durationHours],["Per diem days",settlement.perDiemDays],["Per diem",txt(settlement.perDiemRate)+" "+txt(settlement.perDiemCurrency)],
    ["Corporate card",settlement.corporateCardAmount],["Advance",settlement.advanceAmount],
    ["To reimburse RSD",settlement.reimbursementRsd],["To reimburse in foreign currency",txt(settlement.reimbursementForeign)+" "+txt(settlement.reimbursementForeignCurrency)],
    ["Report reimbursable total",bundle.report.reimbursable_amount+" "+bundle.report.currency],["Attachments",bundle.receipts.length],
    ["Exchange-rate snapshots",bundle.rates.map((rate)=>txt(rate.quote_currency)+"/"+txt(rate.base_currency)+"="+txt(rate.rate)+" · "+txt(rate.source)+" · "+txt(rate.rate_date)+" · "+txt(rate.snapshot_sha256).slice(0,16)).join(" | ") || "No foreign currency"],
    ...bundle.lines.map((line,index)=>["Expense "+(index+1),[line.occurred_on,line.merchant,txt(line.original_gross_amount || line.gross_amount)+" "+txt(line.original_currency || line.currency),"base "+txt(line.gross_amount)+" "+txt(bundle.report.currency),line.payment_method].filter(Boolean).join(" | ")] as [string,unknown]),
    ["Mission report",bundle.report.mission_report],["Business necessity",bundle.report.business_necessity],
  ] : [
    ["Report",bundle.report.report_number],["Beneficiary",bundle.report.claimant_name],["RSD account",order.rsdAccount],
    ["Foreign-currency account",order.fxAccount],["Approved amount",bundle.report.reimbursable_amount+" "+bundle.report.currency],
    ["Reimbursement RSD",settlement.reimbursementRsd],["Reimbursement foreign",txt(settlement.reimbursementForeign)+" "+txt(settlement.reimbursementForeignCurrency)],
    ["Rate evidence",bundle.rates.map((rate)=>txt(rate.quote_currency)+"/"+txt(rate.base_currency)+"="+txt(rate.rate)+" · "+txt(rate.source)+" · "+txt(rate.rate_date)+" · "+txt(rate.snapshot_sha256).slice(0,16)).join(" | ") || "No foreign currency"],
    ["Approved by",bundle.report.approver_id],["Approval date",bundle.report.decided_at],["Evidence count",bundle.receipts.length],
    ["Evidence fingerprints",bundle.receipts.map((item)=>String(item.sha256).slice(0,16)).join(", ")],
  ];
  for (const [label,value] of entries) {
    const lines = wrap(txt(value) || "-", 75); const height = Math.max(24,lines.length*11+10);
    if (y-height<45) break;
    page.drawText(safeAscii(label)+":",{x:38,y,size:8,font:bold,color:blue});
    lines.forEach((line,index)=>page.drawText(line,{x:160,y:y-index*11,size:8,font:regular,color:ink}));
    y-=height;
  }
  page.drawText("Generated by D2F Platform - validation and source snapshots are retained in the audit trail.",{x:38,y:28,size:7,font:regular,color:ink});
  const bytes = await pdf.save();
  const fileName = bundle.report.report_number + "-" + type.replace(/_/g,"-") + ".pdf";
  const digest = await sha256(bytes);
  const log = await supabase.from("d2f_expense_exports").insert({report_id:id,export_type:type,format:"pdf",file_name:fileName,sha256:digest,generated_by:actorId,metadata:{countryPack:bundle.report.country_pack_id,validationRateDate:bundle.report.validation_rate_date}});
  if (log.error) throw new Error(log.error.message);
  return { bytes, fileName, mimeType:"application/pdf" };
}
