import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type JsonRecord = Record<string, unknown>;
type ExportLocale = "fr" | "en" | "sr" | "it" | "es";

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
const NBS_SOURCE = "https://webappcenter.nbs.rs/ExchangeRateWebApp/ExchangeRate/CurrentMiddleRate";
const ECB_SOURCE = "https://data.ecb.europa.eu/key-figures/ecb-interest-rates-and-exchange-rates/exchange-rates";

function exportLocale(countryValue: unknown): ExportLocale {
  return ({ FR: "fr", RS: "sr", IT: "it", ES: "es" } as Record<string, ExportLocale>)[txt(countryValue).toUpperCase()] || "en";
}

const exportText: Record<ExportLocale, Record<string, string>> = {
  fr: {
    report_number:"numéro_note", document_type:"type_document", status:"statut", claimant:"demandeur", validation_date:"date_validation", country_pack:"country_pack",
    expense_date:"date_dépense", merchant:"commerçant", category:"catégorie", business_purpose:"motif_professionnel", original_currency:"devise_origine",
    original_gross:"ttc_origine", report_currency:"devise_comptable", gross:"ttc", tax:"taxe", payment_method:"mode_paiement", fx_rate_date:"date_taux",
    fx_source:"source_taux", fx_rate:"taux", fx_snapshot_sha256:"empreinte_taux_sha256", receipt_sha256:"empreinte_justificatif_sha256",
    accountant_suffix:"comptable", travel_order_title:"ORDRE DE MISSION", travel_account_title:"DÉCOMPTE DE MISSION", bank_title:"DOSSIER JUSTIFICATIF BANQUE",
    company:"Entreprise", order_number:"Numéro d’ordre", order_date:"Date de l’ordre", traveller:"Voyageur", role:"Fonction", destination:"Destination", purpose:"Motif",
    departure:"Départ", expected_return:"Retour prévu", transport:"Transport", route:"Itinéraire", advance:"Avance", costs_borne_by:"Frais supportés par",
    report:"Note", actual_return:"Retour effectif", duration:"Durée (heures)", perdiem_days:"Jours de per diem", perdiem:"Per diem", corporate_card:"Carte entreprise",
    reimburse_rsd:"À rembourser en RSD", reimburse_fx:"À rembourser en devise", reimbursable_total:"Total remboursable", attachments:"Pièces jointes",
    rate_snapshots:"Preuves de taux", expense:"Dépense", mission_report:"Rapport de mission", business_necessity:"Nécessité professionnelle",
    beneficiary:"Bénéficiaire", rsd_account:"Compte RSD", fx_account:"Compte en devise", approved_amount:"Montant approuvé", rate_evidence:"Preuves de taux",
    approved_by:"Approuvé par", approval_date:"Date d’approbation", evidence_count:"Nombre de preuves", evidence_fingerprints:"Empreintes des preuves",
    no_fx:"Aucune devise étrangère", company_value:"Entreprise", footer:"Généré par D2F Platform — les validations et preuves de source sont conservées dans la piste d’audit.",
  },
  en: {
    report_number:"report_number", document_type:"document_type", status:"status", claimant:"claimant", validation_date:"validation_date", country_pack:"country_pack",
    expense_date:"expense_date", merchant:"merchant", category:"category", business_purpose:"business_purpose", original_currency:"original_currency",
    original_gross:"original_gross", report_currency:"report_currency", gross:"gross", tax:"tax", payment_method:"payment_method", fx_rate_date:"fx_rate_date",
    fx_source:"fx_source", fx_rate:"fx_rate", fx_snapshot_sha256:"fx_snapshot_sha256", receipt_sha256:"receipt_sha256",
    accountant_suffix:"accounting", travel_order_title:"TRAVEL ORDER", travel_account_title:"TRAVEL ACCOUNT", bank_title:"BANK REIMBURSEMENT SUPPORTING FILE",
    company:"Company", order_number:"Order number", order_date:"Order date", traveller:"Traveller", role:"Role", destination:"Destination", purpose:"Purpose",
    departure:"Departure", expected_return:"Expected return", transport:"Transport", route:"Route", advance:"Advance", costs_borne_by:"Costs borne by",
    report:"Report", actual_return:"Actual return", duration:"Duration (hours)", perdiem_days:"Per diem days", perdiem:"Per diem", corporate_card:"Corporate card",
    reimburse_rsd:"To reimburse RSD", reimburse_fx:"To reimburse in foreign currency", reimbursable_total:"Report reimbursable total", attachments:"Attachments",
    rate_snapshots:"Exchange-rate snapshots", expense:"Expense", mission_report:"Mission report", business_necessity:"Business necessity",
    beneficiary:"Beneficiary", rsd_account:"RSD account", fx_account:"Foreign-currency account", approved_amount:"Approved amount", rate_evidence:"Rate evidence",
    approved_by:"Approved by", approval_date:"Approval date", evidence_count:"Evidence count", evidence_fingerprints:"Evidence fingerprints",
    no_fx:"No foreign currency", company_value:"Company", footer:"Generated by D2F Platform — validation and source snapshots are retained in the audit trail.",
  },
  sr: {
    report_number:"broj_izveštaja", document_type:"vrsta_dokumenta", status:"status", claimant:"podnosilac", validation_date:"datum_potvrde", country_pack:"country_pack",
    expense_date:"datum_troška", merchant:"dobavljač", category:"kategorija", business_purpose:"poslovna_svrha", original_currency:"izvorna_valuta",
    original_gross:"izvorni_bruto", report_currency:"obračunska_valuta", gross:"bruto", tax:"porez", payment_method:"način_plaćanja", fx_rate_date:"datum_kursa",
    fx_source:"izvor_kursa", fx_rate:"kurs", fx_snapshot_sha256:"otisak_kursa_sha256", receipt_sha256:"otisak_dokaza_sha256",
    accountant_suffix:"knjigovodstvo", travel_order_title:"NALOG ZA SLUŽBENO PUTOVANJE", travel_account_title:"PUTNI RAČUN", bank_title:"DOKUMENTACIJA ZA REFUNDACIJU BANKE",
    company:"Naziv kompanije", order_number:"Broj naloga", order_date:"Datum naloga", traveller:"Putnik", role:"Funkcija", destination:"Odredište", purpose:"Svrha putovanja",
    departure:"Polazak", expected_return:"Planirani povratak", transport:"Prevoz", route:"Relacija", advance:"Akontacija", costs_borne_by:"Putne troškove snosi",
    report:"Izveštaj", actual_return:"Stvarni povratak", duration:"Trajanje (sati)", perdiem_days:"Broj dnevnica", perdiem:"Dnevnica", corporate_card:"Plaćeno karticom",
    reimburse_rsd:"Za isplatu RSD", reimburse_fx:"Za isplatu u devizi", reimbursable_total:"Ukupno za isplatu", attachments:"Broj priloga",
    rate_snapshots:"Dokazi o kursu", expense:"Trošak", mission_report:"Izveštaj sa službenog puta", business_necessity:"Obrazloženje poslovne potrebe",
    beneficiary:"Korisnik", rsd_account:"Dinarski račun", fx_account:"Devizni račun", approved_amount:"Odobreni iznos", rate_evidence:"Dokaz o kursu",
    approved_by:"Odobrio", approval_date:"Datum odobrenja", evidence_count:"Broj dokaza", evidence_fingerprints:"Otisci dokaza",
    no_fx:"Nema strane valute", company_value:"Kompanija", footer:"Generisano u D2F Platform — potvrde i dokazi o izvorima čuvaju se u revizorskom tragu.",
  },
  it: {
    report_number:"numero_nota", document_type:"tipo_documento", status:"stato", claimant:"richiedente", validation_date:"data_convalida", country_pack:"country_pack",
    expense_date:"data_spesa", merchant:"fornitore", category:"categoria", business_purpose:"motivo_professionale", original_currency:"valuta_originale",
    original_gross:"lordo_originale", report_currency:"valuta_contabile", gross:"lordo", tax:"imposta", payment_method:"metodo_pagamento", fx_rate_date:"data_cambio",
    fx_source:"fonte_cambio", fx_rate:"cambio", fx_snapshot_sha256:"impronta_cambio_sha256", receipt_sha256:"impronta_giustificativo_sha256",
    accountant_suffix:"contabile", travel_order_title:"ORDINE DI MISSIONE", travel_account_title:"RENDICONTO DI MISSIONE", bank_title:"FASCICOLO GIUSTIFICATIVO BANCA",
    company:"Impresa", order_number:"Numero ordine", order_date:"Data ordine", traveller:"Viaggiatore", role:"Funzione", destination:"Destinazione", purpose:"Motivo",
    departure:"Partenza", expected_return:"Rientro previsto", transport:"Trasporto", route:"Itinerario", advance:"Anticipo", costs_borne_by:"Spese a carico di",
    report:"Nota", actual_return:"Rientro effettivo", duration:"Durata (ore)", perdiem_days:"Giorni di diaria", perdiem:"Diaria", corporate_card:"Carta aziendale",
    reimburse_rsd:"Da rimborsare in RSD", reimburse_fx:"Da rimborsare in valuta", reimbursable_total:"Totale rimborsabile", attachments:"Allegati",
    rate_snapshots:"Prove dei cambi", expense:"Spesa", mission_report:"Relazione di missione", business_necessity:"Necessità professionale",
    beneficiary:"Beneficiario", rsd_account:"Conto RSD", fx_account:"Conto in valuta", approved_amount:"Importo approvato", rate_evidence:"Prova del cambio",
    approved_by:"Approvato da", approval_date:"Data approvazione", evidence_count:"Numero prove", evidence_fingerprints:"Impronte delle prove",
    no_fx:"Nessuna valuta estera", company_value:"Impresa", footer:"Generato da D2F Platform — convalide e prove delle fonti sono conservate nella pista di audit.",
  },
  es: {
    report_number:"numero_informe", document_type:"tipo_documento", status:"estado", claimant:"solicitante", validation_date:"fecha_validacion", country_pack:"country_pack",
    expense_date:"fecha_gasto", merchant:"proveedor", category:"categoria", business_purpose:"motivo_profesional", original_currency:"moneda_original",
    original_gross:"bruto_original", report_currency:"moneda_contable", gross:"bruto", tax:"impuesto", payment_method:"modo_pago", fx_rate_date:"fecha_cambio",
    fx_source:"fuente_cambio", fx_rate:"cambio", fx_snapshot_sha256:"huella_cambio_sha256", receipt_sha256:"huella_justificante_sha256",
    accountant_suffix:"contable", travel_order_title:"ORDEN DE VIAJE", travel_account_title:"LIQUIDACIÓN DE VIAJE", bank_title:"EXPEDIENTE JUSTIFICATIVO BANCARIO",
    company:"Empresa", order_number:"Número de orden", order_date:"Fecha de orden", traveller:"Viajero", role:"Cargo", destination:"Destino", purpose:"Motivo",
    departure:"Salida", expected_return:"Regreso previsto", transport:"Transporte", route:"Itinerario", advance:"Anticipo", costs_borne_by:"Gastos a cargo de",
    report:"Informe", actual_return:"Regreso efectivo", duration:"Duración (horas)", perdiem_days:"Días de dieta", perdiem:"Dieta", corporate_card:"Tarjeta de empresa",
    reimburse_rsd:"A reembolsar en RSD", reimburse_fx:"A reembolsar en divisa", reimbursable_total:"Total reembolsable", attachments:"Adjuntos",
    rate_snapshots:"Pruebas del tipo de cambio", expense:"Gasto", mission_report:"Informe de viaje", business_necessity:"Necesidad profesional",
    beneficiary:"Beneficiario", rsd_account:"Cuenta RSD", fx_account:"Cuenta en divisa", approved_amount:"Importe aprobado", rate_evidence:"Prueba del cambio",
    approved_by:"Aprobado por", approval_date:"Fecha de aprobación", evidence_count:"Número de pruebas", evidence_fingerprints:"Huellas de las pruebas",
    no_fx:"Sin moneda extranjera", company_value:"Empresa", footer:"Generado por D2F Platform — las validaciones y pruebas de origen se conservan en la pista de auditoría.",
  },
};

function exportTranslator(countryValue: unknown) {
  const locale = exportLocale(countryValue);
  const dictionary = exportText[locale];
  return { locale, t: (key: string) => dictionary[key] || exportText.en[key] || key };
}

function exchangeRateConvention(rate: JsonRecord, reportCurrency: unknown) {
  const accountingCurrency = txt(reportCurrency).toUpperCase();
  const base = txt(rate.base_currency).toUpperCase();
  const quote = txt(rate.quote_currency).toUpperCase();
  // Versions before 3.4.4 stored the column names in reverse while the numeric
  // value already meant "one foreign unit in accounting currency".
  return base === accountingCurrency && quote && quote !== accountingCurrency
    ? { foreignCurrency: quote, accountingCurrency: base, rate: rate.rate }
    : { foreignCurrency: base, accountingCurrency: quote, rate: rate.rate };
}

function exchangeRateEvidence(rate: JsonRecord, reportCurrency: unknown) {
  const convention = exchangeRateConvention(rate, reportCurrency);
  return "1 " + convention.foreignCurrency + " = " + txt(convention.rate) + " " + convention.accountingCurrency
    + " · " + txt(rate.source) + " · " + txt(rate.rate_date) + " · " + txt(rate.snapshot_sha256).slice(0, 16);
}

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
  const accountingCurrency = txt(report.currency).toUpperCase();
  const foreignCurrencies = [...new Set((linesResult.data || []).map((line) => txt(line.original_currency || line.currency).toUpperCase()).filter((currency) => currency && currency !== accountingCurrency))];
  const rates = obj(input.rates);
  const validationDate = isoDate();
  const sourceExpected = establishmentCountry.toUpperCase() === "RS" ? "NBS" : "ECB";
  for (const foreignCurrency of foreignCurrencies) {
    const rateInput = obj(rates[foreignCurrency]);
    const rate = Number(rateInput.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Renseignez le taux officiel : 1 " + foreignCurrency + " = … " + accountingCurrency + " au " + validationDate);
    const source = txt(rateInput.source || sourceExpected).toUpperCase();
    const sourceUri = txt(rateInput.sourceUri || rateInput.source_uri || (source === "NBS" ? NBS_SOURCE : ECB_SOURCE));
    if (establishmentCountry.toUpperCase() === "RS" && (source !== "NBS" || !/nbs\.rs/i.test(sourceUri))) {
      throw new Error("Pour la Serbie, le taux validé doit provenir de la Banque nationale de Serbie (NBS)");
    }
    const snapshot = {
      rateDate: validationDate,
      source,
      authority: source === "NBS" ? NBS_AUTHORITY : "European Central Bank or local authority",
      sourceUri,
      baseCurrency: foreignCurrency,
      quoteCurrency: accountingCurrency,
      rate,
      convention: `1 ${foreignCurrency} = ${rate} ${accountingCurrency}`,
    };
    const digest = await sha256(JSON.stringify(snapshot));
    const inserted = await supabase.from("d2f_expense_exchange_rates").upsert({
      report_id: id, rate_date: validationDate, source, source_uri: sourceUri,
      base_currency: foreignCurrency, quote_currency: accountingCurrency, rate,
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
  const { locale, t } = exportTranslator(input.establishmentCountry);
  const bundle = await exportBundle(supabase, ownerKey, actorId, actorRole, id);
  const header = ["report_number","document_type","status","claimant","validation_date","country_pack","expense_date","merchant","category","business_purpose","original_currency","original_gross","report_currency","gross","tax","payment_method","fx_rate_date","fx_source","fx_rate","fx_snapshot_sha256","receipt_sha256"].map(t);
  const receipts = new Map(bundle.receipts.map((item) => [String(item.expense_line_id || ""), item]));
  const rates = new Map(bundle.rates.map((item) => {
    const convention = exchangeRateConvention(item, bundle.report.currency);
    return [convention.foreignCurrency, item];
  }));
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
  const fileName = bundle.report.report_number + "-" + t("accountant_suffix") + ".csv";
  const digest = await sha256(content);
  const logged = await supabase.from("d2f_expense_exports").insert({ report_id: id, export_type: "accountant", format: "csv", file_name: fileName, sha256: digest, generated_by: actorId, metadata: { countryPack: bundle.report.country_pack_id, validationRateDate: bundle.report.validation_rate_date, locale } });
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
  const { locale, t } = exportTranslator(input.establishmentCountry);
  if (!["travel_order","travel_account","bank_reimbursement"].includes(type)) throw new Error("Type d'export invalide");
  const bundle = await exportBundle(supabase, ownerKey, actorId, actorRole, id);
  if (bundle.report.document_type !== "travel_order" && type !== "bank_reimbursement") throw new Error("Cet export est réservé aux ordres de mission");
  if (type === "bank_reimbursement" && bundle.report.status !== "approved") throw new Error("Le justificatif bancaire est disponible après approbation");
  const workflow = obj(bundle.report.workflow_data), order = obj(workflow.order), settlement = obj(workflow.settlement);
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595.28,841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(.04,.31,.72), ink = rgb(.05,.09,.15); let y = 795;
  const title = type === "travel_order" ? t("travel_order_title") : type === "travel_account" ? t("travel_account_title") : t("bank_title");
  page.drawText(title,{x:38,y,size:16,font:bold,color:blue}); y-=30;
  const entries: Array<[string,unknown]> = type === "travel_order" ? [
    [t("company"),order.companyName],[t("order_number"),order.orderNumber || bundle.report.report_number],[t("order_date"),order.orderDate],
    [t("traveller"),order.traveler || bundle.report.claimant_name],[t("role"),order.travelerRole],[t("destination"),txt(order.destinationCity)+", "+txt(order.destinationCountry)],
    [t("purpose"),order.purpose],[t("departure"),order.departureAt],[t("expected_return"),order.expectedReturnAt],[t("transport"),order.transportMode],
    [t("route"),order.route],[t("advance"),order.advanceDescription],[t("costs_borne_by"),order.costBearer || t("company_value")],
  ] : type === "travel_account" ? [
    [t("report"),bundle.report.report_number],[t("traveller"),bundle.report.claimant_name],[t("actual_return"),settlement.actualReturnAt],
    [t("duration"),settlement.durationHours],[t("perdiem_days"),settlement.perDiemDays],[t("perdiem"),txt(settlement.perDiemRate)+" "+txt(settlement.perDiemCurrency)],
    [t("corporate_card"),settlement.corporateCardAmount],[t("advance"),settlement.advanceAmount],
    [t("reimburse_rsd"),settlement.reimbursementRsd],[t("reimburse_fx"),txt(settlement.reimbursementForeign)+" "+txt(settlement.reimbursementForeignCurrency)],
    [t("reimbursable_total"),bundle.report.reimbursable_amount+" "+bundle.report.currency],[t("attachments"),bundle.receipts.length],
    [t("rate_snapshots"),bundle.rates.map((rate)=>exchangeRateEvidence(rate,bundle.report.currency)).join(" | ") || t("no_fx")],
    ...bundle.lines.map((line,index)=>[t("expense")+" "+(index+1),[line.occurred_on,line.merchant,txt(line.original_gross_amount || line.gross_amount)+" "+txt(line.original_currency || line.currency),"base "+txt(line.gross_amount)+" "+txt(bundle.report.currency),line.payment_method].filter(Boolean).join(" | ")] as [string,unknown]),
    [t("mission_report"),bundle.report.mission_report],[t("business_necessity"),bundle.report.business_necessity],
  ] : [
    [t("report"),bundle.report.report_number],[t("beneficiary"),bundle.report.claimant_name],[t("rsd_account"),order.rsdAccount],
    [t("fx_account"),order.fxAccount],[t("approved_amount"),bundle.report.reimbursable_amount+" "+bundle.report.currency],
    [t("reimburse_rsd"),settlement.reimbursementRsd],[t("reimburse_fx"),txt(settlement.reimbursementForeign)+" "+txt(settlement.reimbursementForeignCurrency)],
    [t("rate_evidence"),bundle.rates.map((rate)=>exchangeRateEvidence(rate,bundle.report.currency)).join(" | ") || t("no_fx")],
    [t("approved_by"),bundle.report.approver_id],[t("approval_date"),bundle.report.decided_at],[t("evidence_count"),bundle.receipts.length],
    [t("evidence_fingerprints"),bundle.receipts.map((item)=>String(item.sha256).slice(0,16)).join(", ")],
  ];
  for (const [label,value] of entries) {
    const lines = wrap(txt(value) || "-", 75); const height = Math.max(24,lines.length*11+10);
    if (y-height<45) break;
    page.drawText(safeAscii(label)+":",{x:38,y,size:8,font:bold,color:blue});
    lines.forEach((line,index)=>page.drawText(line,{x:160,y:y-index*11,size:8,font:regular,color:ink}));
    y-=height;
  }
  page.drawText(safeAscii(t("footer")),{x:38,y:28,size:7,font:regular,color:ink});
  const bytes = await pdf.save();
  const fileName = bundle.report.report_number + "-" + type.replace(/_/g,"-") + ".pdf";
  const digest = await sha256(bytes);
  const log = await supabase.from("d2f_expense_exports").insert({report_id:id,export_type:type,format:"pdf",file_name:fileName,sha256:digest,generated_by:actorId,metadata:{countryPack:bundle.report.country_pack_id,validationRateDate:bundle.report.validation_rate_date,locale}});
  if (log.error) throw new Error(log.error.message);
  return { bytes, fileName, mimeType:"application/pdf" };
}
