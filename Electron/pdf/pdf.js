"use strict";

const fs = require("node:fs");
const PDFDocument = require("pdfkit");

/**
 * PDF exports for quotes & invoices (FR/EN/SR/ES/IT).
 * - PDFKit based, deterministic layout
 * - Configurable branding (logo/colors)
 * - Minimal "mandatory expectations" validation before render
 * - Adds VAT mode notice (VAT/REVERSE_CHARGE/EXEMPT/NO_VAT) + payment terms/IBAN/BIC
 *
 * Includes:
 * - Quote acceptance block (signature PDF or electronic signature)
 * - Centered table alignment (prevents right shift)
 * - Invoice CGV block (paginated) + issuer bank details
 *
 * ⚠️ IMPORTANT (Serbian Cyrillic):
 * PDFKit core fonts (Helvetica) do NOT support Cyrillic well.
 * If your SR translations are in Cyrillic, you must embed a font (e.g. Noto Sans).
 */

const SUPPORTED_LOCALES = ["fr", "en", "sr", "es", "it"];

const DEFAULTS = {
  locale: "fr",
  currency: "EUR",
  page: { size: "A4", margin: 48 },
  branding: {
    primaryColor: "#111827",
    accentColor: "#2563eb",
    fontSize: 10,
    logoMaxWidth: 140,
    showLogo: true,
  },
  fonts: {
    regularPath: "",
    boldPath: "",
    regularName: "APP_REGULAR",
    boldName: "APP_BOLD",
  },
  table: {
    showDiscount: true,
    showLineTotal: true,
  },
  quote: {
    signMode: "PDF",
    placeCity: "",
  },
  invoice: {
    requireBankDetails: false,
    requireCgv: true,
    includeCgv: true, // ✅ plus clair : includeCgv = true par défaut
  },
  texts: {
    footerFr: "Merci pour votre confiance.",
    footerEn: "Thank you for your business.",
    footerSr: "Hvala na poverenju.",
    footerEs: "Gracias por su confianza.",
    footerIt: "Grazie per la vostra fiducia.",

    reverseChargeFr: "TVA due par le preneur (autoliquidation).",
    reverseChargeEn: "VAT to be accounted for by the customer (reverse charge).",
    reverseChargeSr: "PDV obračunava kupac (prenos poreske obaveze).",
    reverseChargeEs: "IVA a cargo del cliente (inversión del sujeto pasivo).",
    reverseChargeIt: "IVA a carico del cliente (reverse charge).",

    exemptFr: "Opération exonérée de TVA.",
    exemptEn: "VAT exempt supply.",
    exemptSr: "Oslobođeno od PDV-a.",
    exemptEs: "Operación exenta de IVA.",
    exemptIt: "Operazione esente IVA.",

    noVatFr: "Hors champ / sans TVA.",
    noVatEn: "No VAT applies.",
    noVatSr: "Bez PDV-a.",
    noVatEs: "No aplica IVA.",
    noVatIt: "Nessuna IVA applicabile.",

    cgvTitleFr: "Conditions générales de vente (CGV)",
    cgvTextFr: `CONDITIONS GÉNÉRALES DE VENTE
D2F Compliant d.o.o.
...`,
    cgvTitleEn: "Terms & Conditions",
    cgvTextEn: "",
    cgvTitleSr: "Opšti uslovi",
    cgvTextSr: "",
    cgvTitleEs: "Términos y condiciones",
    cgvTextEs: "",
    cgvTitleIt: "Termini e condizioni",
    cgvTextIt: "",
  },
};

const I18N = {
  fr: {
    quoteTitle: "DEVIS",
    invoiceTitle: "FACTURE",
    date: "Date",
    number: "N°",
    seller: "Vendeur",
    buyer: "Acheteur",
    vatId: "TVA",
    legalId: "SIRET/ID",
    lines: "Détails",
    desc: "Désignation",
    qty: "Qté",
    unit: "Unité",
    unitPrice: "PU HT",
    discount: "Remise",
    vat: "TVA",
    lineTotal: "Total HT",
    totalHt: "Total HT",
    totalVat: "Total TVA",
    totalTtc: "Total TTC",
    prepaid: "Acompte",
    due: "Net à payer",
    paymentTerms: "Conditions",
    payment: "Paiement",
    iban: "IBAN",
    bic: "BIC",
    vatMode: "Régime TVA",
    quoteConditions: "Conditions du devis",
    validUntil: "Valable jusqu'au",
    validityDays: "Durée de validité",
    paymentText: "Conditions de paiement",
    days: "jours",

    reverseCharge: "Autoliquidation",
    exempt: "Exonération",
    noVat: "Hors TVA",

    acceptanceTitle: "Bon pour accord",
    acceptanceText:
      "Je soussigné(e), {buyer_name}, accepte le devis {quote_number} et m’engage à régler la somme indiquée.\nFait à {city}, le {date}.",
    signatureLabel: "Signature",
    signModePdf: "Signature manuscrite sur PDF",
    signModeEsign: "Signature électronique",

    // ✅ NEW
    depositsTitle: "Détail des acomptes",
    depositLine: "Acompte {number} du {date}",
  },

  en: {
    quoteTitle: "QUOTATION",
    invoiceTitle: "INVOICE",
    date: "Date",
    number: "No.",
    seller: "Seller",
    buyer: "Buyer",
    vatId: "VAT",
    legalId: "Company ID",
    lines: "Lines",
    desc: "Description",
    qty: "Qty",
    unit: "Unit",
    unitPrice: "Unit price (excl. VAT)",
    discount: "Discount",
    vat: "VAT",
    lineTotal: "Line total (excl. VAT)",
    totalHt: "Subtotal",
    totalVat: "VAT total",
    totalTtc: "Total",
    prepaid: "Prepaid",
    due: "Amount due",
    paymentTerms: "Terms",
    payment: "Payment",
    iban: "IBAN",
    bic: "BIC",
    vatMode: "VAT mode",
    quoteConditions: "Quotation terms",
    validUntil: "Valid until",
    validityDays: "Validity",
    paymentText: "Payment terms",
    days: "days",

    reverseCharge: "Reverse charge",
    exempt: "Exempt",
    noVat: "No VAT",

    acceptanceTitle: "Acceptance",
    acceptanceText:
      "I, {buyer_name}, accept quotation {quote_number} and agree to pay the stated amount.\nSigned in {city} on {date}.",
    signatureLabel: "Signature",
    signModePdf: "Signature on PDF",
    signModeEsign: "Electronic signature",

    // ✅ NEW
    depositsTitle: "Deposit invoices",
    depositLine: "Deposit {number} dated {date}",
  },

  sr: {
    quoteTitle: "PONUDA",
    invoiceTitle: "FAKTURA",
    date: "Datum",
    number: "Br.",
    seller: "Prodavac",
    buyer: "Kupac",
    vatId: "PIB/PDV",
    legalId: "Matični/ID",
    lines: "Stavke",
    desc: "Opis",
    qty: "Kol.",
    unit: "Jedinica",
    unitPrice: "Cena bez PDV-a",
    discount: "Popust",
    vat: "PDV",
    lineTotal: "Iznos bez PDV-a",
    totalHt: "Međuzbir",
    totalVat: "Ukupno PDV",
    totalTtc: "Ukupno",
    prepaid: "Avans",
    due: "Za uplatu",
    paymentTerms: "Uslovi",
    payment: "Plaćanje",
    iban: "IBAN",
    bic: "BIC",
    vatMode: "PDV režim",
    quoteConditions: "Uslovi ponude",
    validUntil: "Važi do",
    validityDays: "Rok važenja",
    paymentText: "Uslovi plaćanja",
    days: "dana",

    reverseCharge: "Prenos poreske obaveze",
    exempt: "Oslobođeno",
    noVat: "Bez PDV-a",

    acceptanceTitle: "Prihvatanje ponude",
    acceptanceText:
      "Ja, {buyer_name}, prihvatam ponudu {quote_number} i obavezujem se da platim navedeni iznos.\nPotpisano u {city} dana {date}.",
    signatureLabel: "Potpis",
    signModePdf: "Potpis na PDF-u",
    signModeEsign: "Elektronski potpis",

    // ✅ NEW
    depositsTitle: "Avansne fakture",
    depositLine: "Avans {number} ({date})",
  },

  es: {
    quoteTitle: "PRESUPUESTO",
    invoiceTitle: "FACTURA",
    date: "Fecha",
    number: "Nº",
    seller: "Vendedor",
    buyer: "Comprador",
    vatId: "IVA",
    legalId: "ID empresa",
    lines: "Líneas",
    desc: "Descripción",
    qty: "Cant.",
    unit: "Unidad",
    unitPrice: "Precio (sin IVA)",
    discount: "Descuento",
    vat: "IVA",
    lineTotal: "Total línea (sin IVA)",
    totalHt: "Subtotal",
    totalVat: "Total IVA",
    totalTtc: "Total",
    prepaid: "Anticipo",
    due: "Importe a pagar",
    paymentTerms: "Condiciones",
    payment: "Pago",
    iban: "IBAN",
    bic: "BIC",
    vatMode: "Régimen IVA",
    quoteConditions: "Condiciones del presupuesto",
    validUntil: "Válido hasta",
    validityDays: "Validez",
    paymentText: "Condiciones de pago",
    days: "días",

    reverseCharge: "Inversión del sujeto pasivo",
    exempt: "Exento",
    noVat: "Sin IVA",

    acceptanceTitle: "Aceptación",
    acceptanceText:
      "Yo, {buyer_name}, acepto el presupuesto {quote_number} y me comprometo a pagar el importe indicado.\nFirmado en {city} el {date}.",
    signatureLabel: "Firma",
    signModePdf: "Firma en PDF",
    signModeEsign: "Firma electrónica",

    // ✅ NEW
    depositsTitle: "Anticipos",
    depositLine: "Anticipo {number} ({date})",
  },

  it: {
    quoteTitle: "PREVENTIVO",
    invoiceTitle: "FATTURA",
    date: "Data",
    number: "N.",
    seller: "Venditore",
    buyer: "Acquirente",
    vatId: "IVA",
    legalId: "ID azienda",
    lines: "Righe",
    desc: "Descrizione",
    qty: "Q.tà",
    unit: "Unità",
    unitPrice: "Prezzo (escl. IVA)",
    discount: "Sconto",
    vat: "IVA",
    lineTotal: "Totale riga (escl. IVA)",
    totalHt: "Imponibile",
    totalVat: "Totale IVA",
    totalTtc: "Totale",
    prepaid: "Acconto",
    due: "Da pagare",
    paymentTerms: "Condizioni",
    payment: "Pagamento",
    iban: "IBAN",
    bic: "BIC",
    vatMode: "Regime IVA",
    quoteConditions: "Condizioni del preventivo",
    validUntil: "Valido fino al",
    validityDays: "Validità",
    paymentText: "Condizioni di pagamento",
    days: "giorni",

    reverseCharge: "Reverse charge",
    exempt: "Esente",
    noVat: "Senza IVA",

    acceptanceTitle: "Accettazione",
    acceptanceText:
      "Io, {buyer_name}, accetto il preventivo {quote_number} e mi impegno a pagare l’importo indicato.\nFirmato a {city} il {date}.",
    signatureLabel: "Firma",
    signModePdf: "Firma su PDF",
    signModeEsign: "Firma elettronica",

    // ✅ NEW
    depositsTitle: "Acconti",
    depositLine: "Acconto {number} ({date})",
  },
};

function normalizeSpaces(str) {
  return String(str ?? "").replace(/[\u202F\u00A0]/g, " ");
}

function intlLocale(locale) {
  const l = String(locale || "fr").toLowerCase().split(/[-_]/)[0];
  if (l === "fr") return "fr-FR";
  if (l === "en") return "en-GB";
  if (l === "sr") return "sr-RS";
  if (l === "es") return "es-ES";
  if (l === "it") return "it-IT";
  return "fr-FR";
}

function money(x, currency = "EUR", locale = "fr") {
  const v = Math.round((Number(x) || 0) * 100) / 100;
  const loc = intlLocale(locale);
  const cur = String(currency || "EUR").toUpperCase();

  try {
    const out = new Intl.NumberFormat(loc, {
      style: "currency",
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);

    return normalizeSpaces(out);
  } catch {
    return `${v.toFixed(2)} ${cur}`;
  }
}

function safeStr(x) {
  return normalizeSpaces(String(x ?? "").trim());
}

function requireFilled(label, value) {
  if (!safeStr(value)) {
    const err = new Error(label);
    err.code = "PDF_MISSING_REQUIRED";
    throw err;
  }
}

function pickByLocale(map, locale, fallback = "fr") {
  if (!map || typeof map !== "object") return "";
  const l = resolveLocale(locale);
  return safeStr(map[l] ?? map[fallback] ?? "");
}

function resolveCgvTitle({ locale, config }) {
  const t1 = pickByLocale(config?.cgv?.title_i18n, locale);
  if (t1) return t1;

  const t2 = safeStr(config?.cgv?.title);
  if (t2) return t2;

  if (locale === "fr") return safeStr(config?.texts?.cgvTitleFr);
  if (locale === "sr") return safeStr(config?.texts?.cgvTitleSr);
  if (locale === "es") return safeStr(config?.texts?.cgvTitleEs);
  if (locale === "it") return safeStr(config?.texts?.cgvTitleIt);
  return safeStr(config?.texts?.cgvTitleEn);
}

function resolveCgvText({ locale, config, seller }) {
  const sellerI18n = pickByLocale(seller?.cgv_text_i18n, locale);
  if (sellerI18n) return sellerI18n;

  const legacy = safeStr(seller?.cgv_text);
  if (legacy) return legacy;

  const cfgI18n = pickByLocale(config?.cgv?.text_i18n, locale);
  if (cfgI18n) return cfgI18n;

  const cfgText = safeStr(config?.cgv?.text);
  if (cfgText) return cfgText;

  if (locale === "fr") return safeStr(config?.texts?.cgvTextFr);
  if (locale === "sr") return safeStr(config?.texts?.cgvTextSr);
  if (locale === "es") return safeStr(config?.texts?.cgvTextEs);
  if (locale === "it") return safeStr(config?.texts?.cgvTextIt);
  return safeStr(config?.texts?.cgvTextEn);
}

function validateMandatory({ docType, seller, buyer, docMeta, lines, config, locale }) {
  requireFilled("PDF: seller.legal_name requis", seller?.legal_name);
  requireFilled("PDF: seller.country requis", seller?.country);

  requireFilled("PDF: buyer.name requis", buyer?.name);
  requireFilled("PDF: buyer.country requis", buyer?.country);

  requireFilled(`PDF: ${docType}.date requis`, docMeta?.date);
  requireFilled(`PDF: ${docType}.number requis`, docMeta?.number);

  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error("PDF: au moins une ligne est requise");
  }
  for (const [i, l] of lines.entries()) {
    requireFilled(`PDF: ligne ${i + 1} description requise`, l.description);
    const qty = Number(l.quantity);

    if (!Number.isFinite(qty) || qty === 0) {
      throw new Error(`PDF: ligne ${i + 1} quantité invalide`);
    }
}
  if (docType === "invoice" && config?.invoice?.requireBankDetails) {
    requireFilled("PDF: seller.iban requis", seller?.iban || seller?.bank?.iban);
    requireFilled("PDF: seller.bic requis", seller?.bic || seller?.bank?.bic);
  }

  if (docType === "invoice" && config?.invoice?.requireCgv) {
    const cgv = resolveCgvText({ locale: resolveLocale(locale), config, seller });
    requireFilled("PDF: CGV requises (texte vide)", cgv);
  }
}

function resolveLocale(locale) {
  const base = String(locale || "fr").toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(base) ? base : "fr";
}

function deepMerge(a, b) {
  if (!b) return JSON.parse(JSON.stringify(a));
  const out = Array.isArray(a) ? [...a] : { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v)) out[k] = deepMerge(a?.[k] || {}, v);
    else out[k] = v;
  }
  return out;
}

function safeNum(x, def = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

function loadLogoToFit(doc, logoPath, x, y, maxW, maxH) {
  if (!logoPath) return false;
  try {
    if (!fs.existsSync(logoPath)) return false;
    doc.image(logoPath, x, y, { fit: [maxW, maxH] });
    return true;
  } catch {
    return false;
  }
}

// ---- Font support (optional) ----
function ensureFonts(doc, config) {
  const fp = config?.fonts || {};
  const regularPath = safeStr(fp.regularPath);
  const boldPath = safeStr(fp.boldPath);
  const regularName = safeStr(fp.regularName) || "APP_REGULAR";
  const boldName = safeStr(fp.boldName) || "APP_BOLD";

  const hasRegular = regularPath && fs.existsSync(regularPath);
  const hasBold = boldPath && fs.existsSync(boldPath);

  if (hasRegular) {
    try {
      doc.registerFont(regularName, regularPath);
    } catch {}
  }
  if (hasBold) {
    try {
      doc.registerFont(boldName, boldPath);
    } catch {}
  }

  return {
    regular: hasRegular ? regularName : "Helvetica",
    bold: hasBold ? boldName : "Helvetica-Bold",
  };
}

function computeLine(line) {
  const qty = safeNum(line.quantity, 0);
  const pu = safeNum(line.unit_price_ht, 0);
  const remise = safeNum(line.remise_percent, 0);
  const tvaPct = safeNum(line.tva_percent, 0);

  const gross = qty * pu;
  const net = gross * (1 - remise / 100);
  const ht = Math.round(net * 100) / 100;
  const tva = Math.round(ht * (tvaPct / 100) * 100) / 100;
  return { ht, tva };
}

function computeTotals(lines) {
  let ht = 0;
  let tva = 0;

  for (const l of lines) {
    const t = computeLine(l);
    ht += t.ht;
    tva += t.tva;
  }

  ht = Math.round(ht * 100) / 100;
  tva = Math.round(tva * 100) / 100;

  return {
    total_ht: ht,
    total_tva: tva,
    total_ttc: Math.round((ht + tva) * 100) / 100,
  };
}

function vatModeLabel({ locale, i18n, vat_effective }) {
  const m = String(vat_effective || "").toUpperCase();
  if (!m) return null;

  if (m === "VAT") return i18n.vat;
  if (m === "REVERSE_CHARGE") return i18n.reverseCharge || (locale === "fr" ? "Autoliquidation" : "Reverse charge");
  if (m === "EXEMPT") return i18n.exempt || (locale === "fr" ? "Exonération" : "Exempt");
  if (m === "NO_VAT") return i18n.noVat || (locale === "fr" ? "Hors TVA" : "No VAT");
  if (m === "AUTO") return null;

  return m;
}

function vatNoticeText({ locale, config, vat_effective }) {
  const m = String(vat_effective || "").toUpperCase();

  if (m === "REVERSE_CHARGE") {
    if (locale === "fr") return config.texts.reverseChargeFr;
    if (locale === "sr") return config.texts.reverseChargeSr;
    if (locale === "es") return config.texts.reverseChargeEs;
    if (locale === "it") return config.texts.reverseChargeIt;
    return config.texts.reverseChargeEn;
  }

  if (m === "EXEMPT") {
    if (locale === "fr") return config.texts.exemptFr;
    if (locale === "sr") return config.texts.exemptSr;
    if (locale === "es") return config.texts.exemptEs;
    if (locale === "it") return config.texts.exemptIt;
    return config.texts.exemptEn;
  }

  if (m === "NO_VAT") {
    if (locale === "fr") return config.texts.noVatFr;
    if (locale === "sr") return config.texts.noVatSr;
    if (locale === "es") return config.texts.noVatEs;
    if (locale === "it") return config.texts.noVatIt;
    return config.texts.noVatEn;
  }

  return "";
}

function drawPartyBox(doc, { x, y, w, title, party, config, fonts }) {
  const { branding } = config;

  doc.lineWidth(1).strokeColor("#e5e7eb").roundedRect(x, y, w, 82, 6).stroke();

  doc.fillColor(branding.primaryColor);
  doc.fontSize(10).font(fonts.bold).text(title, x + 10, y + 8);
  doc.fontSize(9).font(fonts.regular);

  const lines = [];
  if (party?.legal_name) lines.push(safeStr(party.legal_name));
  if (party?.name && !party?.legal_name) lines.push(safeStr(party.name));

  const addr = [
    safeStr(party?.street),
    safeStr(party?.street2),
    [safeStr(party?.postal_code), safeStr(party?.city)].filter(Boolean).join(" "),
    safeStr(party?.country),
  ].filter(Boolean);

  lines.push(...addr);

  const ids = [];
  if (party?.vat_id) ids.push(`TVA: ${safeStr(party.vat_id)}`);
  if (party?.legal_id) ids.push(`ID: ${safeStr(party.legal_id)}`);
  if (ids.length) lines.push(ids.join(" • "));

  doc.text(lines.join("\n"), x + 10, y + 26, { width: w - 20 });
}

function addHeader({ doc, locale, i18n, seller, buyer, docTitle, docMeta, config, vat_effective, fonts }) {
  const { margin } = config.page;
  const { branding } = config;

  const top = margin;
  const left = margin;
  const right = doc.page.width - margin;

  doc.fillColor(branding.primaryColor);
  doc.fontSize(18).font(fonts.bold);

  let headerTop = top;
  if (branding.showLogo && seller?.logo_path) {
    const ok = loadLogoToFit(doc, seller.logo_path, left, top, branding.logoMaxWidth, 60);
    if (ok) headerTop = top + 66;
  }

  doc.fontSize(22).text(docTitle, left, top, { align: "right" });

  doc.fontSize(10).font(fonts.regular);

  const metaY = headerTop;
  const metaW = 240;
  const metaX = right - metaW;

  doc.lineWidth(1).strokeColor(branding.accentColor).roundedRect(metaX, metaY, metaW, 66, 6).stroke();

  doc.fillColor(branding.primaryColor).text(`${i18n.number}: ${safeStr(docMeta.number)}`, metaX + 10, metaY + 10);
  doc.text(`${i18n.date}: ${safeStr(docMeta.date)}`, metaX + 10, metaY + 26);

  const vatLabel = vatModeLabel({ locale, i18n, vat_effective });
  if (vatLabel) doc.text(`${i18n.vatMode}: ${vatLabel}`, metaX + 10, metaY + 42);

  const boxY = metaY + 84;
  const colGap = 16;
  const colW = (right - left - colGap) / 2;

  drawPartyBox(doc, { x: left, y: boxY, w: colW, title: i18n.seller, party: seller, config, fonts });
  drawPartyBox(doc, { x: left + colW + colGap, y: boxY, w: colW, title: i18n.buyer, party: buyer, config, fonts });

  const notice = vatNoticeText({ locale, config, vat_effective });
  if (notice) {
    doc.fontSize(9).fillColor("#374151").text(notice, left, boxY + 90, { width: right - left });
    doc.fillColor(branding.primaryColor);
    doc.y = boxY + 104;
  } else {
    doc.y = boxY + 92;
  }
}

function drawTableHeader(doc, { x, y, widths, labels, config, fonts }) {
  const { branding } = config;
  doc.fillColor("#ffffff");
  doc.rect(x, y, widths.reduce((a, b) => a + b, 0), 22).fill(branding.accentColor);

  doc.fillColor("#ffffff");
  doc.fontSize(9).font(fonts.bold);

  let cx = x;
  for (let i = 0; i < labels.length; i++) {
    doc.text(labels[i], cx + 6, y + 6, { width: widths[i] - 12 });
    cx += widths[i];
  }

  doc.fillColor(branding.primaryColor);
  doc.font(fonts.regular);
}

function drawLinesTable(doc, { locale, i18n, lines, currency, config, fonts }) {
  const { margin } = config.page;
  const left = margin;
  const right = doc.page.width - margin;

  const availableW = right - left;

  const showDiscount = !!config.table?.showDiscount;
  const showLineTotal = !!config.table?.showLineTotal;

  const W = {
    qty: 44,
    unit: 40,
    unitPrice: 76,
    discount: 56,
    vat: 44,
    lineTotal: 86,
  };

  let fixed =
    W.qty +
    W.unit +
    W.unitPrice +
    W.vat +
    (showDiscount ? W.discount : 0) +
    (showLineTotal ? W.lineTotal : 0);

  const minDesc = 160;
  let descW = availableW - fixed;

  if (descW < minDesc) {
    const deficit = minDesc - descW;

    const reducibles = [
      { key: "lineTotal", min: 70, enabled: showLineTotal },
      { key: "unitPrice", min: 62, enabled: true },
      { key: "discount", min: 45, enabled: showDiscount },
      { key: "vat", min: 38, enabled: true },
      { key: "unit", min: 34, enabled: true },
      { key: "qty", min: 40, enabled: true },
    ];

    let remaining = deficit;
    for (const r of reducibles) {
      if (!r.enabled) continue;
      const cur = W[r.key];
      const can = Math.max(0, cur - r.min);
      const take = Math.min(can, remaining);
      W[r.key] = cur - take;
      remaining -= take;
      if (remaining <= 0) break;
    }

    fixed =
      W.qty +
      W.unit +
      W.unitPrice +
      W.vat +
      (showDiscount ? W.discount : 0) +
      (showLineTotal ? W.lineTotal : 0);

    descW = availableW - fixed;
  }

  const widths = [
    descW,
    W.qty,
    W.unit,
    W.unitPrice,
    ...(showDiscount ? [W.discount] : []),
    W.vat,
    ...(showLineTotal ? [W.lineTotal] : []),
  ];

  const labels = [
    i18n.desc,
    i18n.qty,
    i18n.unit,
    i18n.unitPrice,
    ...(showDiscount ? [i18n.discount] : []),
    i18n.vat,
    ...(showLineTotal ? [i18n.lineTotal] : []),
  ];

  const tableW = widths.reduce((a, b) => a + b, 0);
  const tableX = left + Math.max(0, (availableW - tableW) / 2);

  let y = doc.y + 16;

  drawTableHeader(doc, { x: tableX, y, widths, labels, config, fonts });
  y += 26;

  doc.fontSize(9).font(fonts.regular);

  for (const l of lines) {
    const desc = safeStr(l.description);
    const qty = safeNum(l.quantity, 0);
    const unit = safeStr(l.unit_code || "—");
    const pu = money(l.unit_price_ht, currency, locale);
    const disc = `${safeNum(l.remise_percent, 0).toFixed(2).replace(/\.00$/, "")}%`;
    const vat = `${safeNum(l.tva_percent, 0).toFixed(2)}%`;
    const lt = computeLine(l);
    const lineTotal = money(lt.ht, currency, locale);

    const rowH = Math.max(18, doc.heightOfString(desc, { width: widths[0] - 12 }) + 8);

    if (y + rowH > doc.page.height - config.page.margin - 160) {
      doc.addPage();
      y = config.page.margin;
      drawTableHeader(doc, { x: tableX, y, widths, labels, config, fonts });
      y += 26;
    }

    doc
      .lineWidth(1)
      .strokeColor("#e5e7eb")
      .rect(tableX, y - 2, widths.reduce((a, b) => a + b, 0), rowH)
      .stroke();

    let cx = tableX;

    doc.fillColor("#111827");
    doc.text(desc, cx + 6, y + 4, { width: widths[0] - 12 });
    cx += widths[0];

    doc.text(String(qty.toFixed(2)).replace(/\.00$/, ""), cx + 6, y + 4, {
      width: widths[1] - 12,
      align: "right",
    });
    cx += widths[1];

    doc.text(unit, cx + 6, y + 4, { width: widths[2] - 12, align: "right" });
    cx += widths[2];

    doc.text(pu, cx + 6, y + 4, { width: widths[3] - 12, align: "right" });
    cx += widths[3];

    if (showDiscount) {
      doc.text(disc, cx + 6, y + 4, { width: widths[4] - 12, align: "right" });
      cx += widths[4];
    }

    const vatW = showDiscount ? widths[5] : widths[4];
    doc.text(vat, cx + 6, y + 4, { width: vatW - 12, align: "right" });
    cx += vatW;

    if (showLineTotal) {
      const totalW = widths[widths.length - 1];
      doc.text(lineTotal, cx + 6, y + 4, { width: totalW - 12, align: "right" });
      cx += totalW;
    }

    y += rowH;
  }

  doc.y = y + 6;
}

function drawTotalsBlock(doc, { locale, i18n, totals, prepaidAmount, currency, config, fonts }) {
  const { margin } = config.page;
  const right = doc.page.width - margin;

  const boxW = 260;
  const x = right - boxW;
  let y = doc.y + 12;

  doc.lineWidth(1).strokeColor("#e5e7eb").roundedRect(x, y, boxW, prepaidAmount > 0 ? 98 : 78, 6).stroke();
  doc.fontSize(10).font(fonts.regular);

  const rows = [
    [i18n.totalHt, money(totals.total_ht, currency, locale)],
    [i18n.totalVat, money(totals.total_tva, currency, locale)],
    [i18n.totalTtc, money(totals.total_ttc, currency, locale)],
  ];

  if (prepaidAmount > 0) {
    rows.push([i18n.prepaid, `- ${money(prepaidAmount, currency, locale)}`]);
    const due = Math.max(0, Math.round((totals.total_ttc - prepaidAmount) * 100) / 100);
    rows.push([i18n.due, money(due, currency, locale)]);
  }

  let cy = y + 10;
  for (const [label, value] of rows) {
    doc.fillColor("#111827").font(fonts.regular).text(label, x + 12, cy, { width: 140 });
    doc.font(fonts.bold).text(value, x + 12, cy, { width: boxW - 24, align: "right" });
    cy += 16;
  }

  doc.font(fonts.regular);
  doc.y = y + (prepaidAmount > 0 ? 110 : 90);
}

// ✅ NEW: detail of deposit invoices (for final invoice)
function drawDepositsBlock(doc, { locale, i18n, deposits, currency, config, fonts }) {
  if (!Array.isArray(deposits) || deposits.length === 0) return;

  const { margin } = config.page;
  const left = margin;
  const right = doc.page.width - margin;
  const width = right - left;

  let y = doc.y + 6;

  const ensureSpace = (needed) => {
    if (y + needed > doc.page.height - margin - 80) {
      doc.addPage();
      y = margin;
    }
  };

  ensureSpace(90);

  doc.font(fonts.bold).fontSize(10).fillColor("#111827").text(i18n.depositsTitle || "Acomptes", left, y);
  y += 12;

  doc.font(fonts.regular).fontSize(9).fillColor("#374151");

  // mini header line
  doc.text("—".repeat(30), left, y);
  y += 8;

  for (const d of deposits) {
    ensureSpace(16);

    const num = safeStr(d.invoice_number || d.number || d.id || "");
    const date = safeStr(d.date || "").slice(0, 10);
    const amt = money(safeNum(d.total_ttc, 0), currency, locale);

    const template = safeStr(i18n.depositLine || "");
    const label = template
      ? template.replace("{number}", num || "—").replace("{date}", date || "—")
      : `${num} (${date})`;

    doc.text(label, left, y, { width: width - 90 });
    doc.font(fonts.bold).text(amt, right - 90, y, { width: 90, align: "right" });
    doc.font(fonts.regular);

    y += 14;
  }

  doc.fillColor("#111827");
  doc.y = y + 4;
}

function drawPaymentBlock(doc, { i18n, seller, bank, config, fonts }) {
  const paymentTerms = safeStr(seller?.payment_terms || seller?.payment_text || "");
  const iban = safeStr(bank?.iban || seller?.iban);
  const bic = safeStr(bank?.bic || seller?.bic);
  const bankLabel = safeStr(bank?.label || seller?.bank_label || "");

  if (!paymentTerms && !iban && !bic && !bankLabel) return;

  const { margin } = config.page;
  const left = margin;
  const right = doc.page.width - margin;

  let y = doc.y + 8;

  doc.fontSize(10).font(fonts.bold).fillColor("#111827").text(i18n.payment, left, y);
  y += 14;

  doc.fontSize(9).font(fonts.regular).fillColor("#374151");

  if (paymentTerms) {
    doc.text(`${i18n.paymentTerms}: ${paymentTerms}`, left, y, { width: right - left });
    y += 14;
  }

  if (bankLabel) {
    doc.text(bankLabel, left, y, { width: right - left });
    y += 14;
  }

  if (iban) {
    doc.text(`${i18n.iban}: ${iban}`, left, y, { width: right - left });
    y += 14;
  }

  if (bic) {
    doc.text(`${i18n.bic}: ${bic}`, left, y, { width: right - left });
    y += 14;
  }

  doc.fillColor("#111827");
  doc.y = y;
}

function drawQuoteConditionsBlock(doc, { locale, i18n, payload, config, fonts }) {
  const validUntil = safeStr(payload?.valid_until);
  const validityDays = payload?.validity_days;
  const paymentText = safeStr(payload?.payment_text);

  if (!validUntil && validityDays == null && !paymentText) return;

  const { margin } = config.page;
  const left = margin;
  const right = doc.page.width - margin;

  let y = doc.y + 10;
  const blockH = 72;

  if (y + blockH > doc.page.height - margin - 80) {
    doc.addPage();
    y = margin;
  }

  doc.lineWidth(1).strokeColor("#e5e7eb").roundedRect(left, y, right - left, blockH, 8).stroke();

  doc.fillColor("#111827").font(fonts.bold).fontSize(10).text(i18n.quoteConditions, left + 12, y + 10);

  doc.font(fonts.regular).fontSize(9).fillColor("#374151");

  let ly = y + 28;

  if (validUntil) {
    doc.text(`${i18n.validUntil}: ${validUntil}`, left + 12, ly, { width: right - left - 24 });
    ly += 14;
  }

  if (validityDays != null) {
    doc.text(`${i18n.validityDays}: ${String(validityDays)} ${i18n.days}`, left + 12, ly, {
      width: right - left - 24,
    });
    ly += 14;
  }

  if (paymentText) {
    doc.text(`${i18n.paymentText}: ${paymentText}`, left + 12, ly, { width: right - left - 24 });
  }

  doc.fillColor("#111827");
  doc.y = y + blockH + 6;
}

function drawAcceptanceBlock(doc, { i18n, buyer, meta, config, sign_mode = "PDF", place_city = "", fonts }) {
  const { margin } = config.page;
  const left = margin;
  const right = doc.page.width - margin;

  let y = doc.y + 14;
  const blockH = 140;

  const footerH = 48;
  const bottomPad = 10;
  const maxY = doc.page.height - margin - footerH - bottomPad;

  if (y + blockH > maxY) {
    doc.addPage();
    y = margin;
  }

  doc.lineWidth(1).strokeColor("#e5e7eb").roundedRect(left, y, right - left, blockH, 8).stroke();

  doc.fillColor("#111827").font(fonts.bold).fontSize(11).text(i18n.acceptanceTitle, left + 12, y + 10);

  doc.font(fonts.regular).fontSize(9).fillColor("#374151");

  const buyerName = safeStr(buyer?.legal_name || buyer?.name || "");
  const text = safeStr(i18n.acceptanceText || "")
    .replace("{buyer_name}", buyerName || "________________")
    .replace("{quote_number}", safeStr(meta?.number) || "__________")
    .replace("{city}", safeStr(place_city) || "__________")
    .replace("{date}", safeStr(meta?.date) || "__________");

  doc.text(text, left + 12, y + 30, { width: right - left - 24 });

  const signLabel =
    String(sign_mode || "PDF").toUpperCase() === "ESIGN" ? i18n.signModeEsign : i18n.signModePdf;

  doc.fillColor("#6b7280").fontSize(8).font(fonts.regular).text(signLabel, left + 12, y + 92);

  doc.fillColor("#111827").font(fonts.bold).fontSize(9).text(i18n.signatureLabel, right - 180, y + 92);

  doc.lineWidth(1).strokeColor("#d1d5db").rect(right - 180, y + 110, 168, 34).stroke();

  doc.fillColor("#111827");
  doc.y = y + blockH + 6;
}

function drawCgvBlock(doc, { locale, config, seller, fonts }) {
  const { margin } = config.page;
  const left = margin;
  const right = doc.page.width - margin;
  const width = right - left;

  const title = resolveCgvTitle({ locale, config });
  const text = resolveCgvText({ locale, config, seller });
  if (!safeStr(text)) return;

  const ensureSpace = (needed) => {
    if (doc.y + needed > doc.page.height - margin - 40) {
      doc.addPage();
      doc.y = margin;
    }
  };

  ensureSpace(140);

  doc.font(fonts.bold).fontSize(10).fillColor("#111827").text(title, left, doc.y);
  doc.moveDown(0.6);

  doc.font(fonts.regular).fontSize(8.5).fillColor("#374151");

  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  for (const raw of lines) {
    const line = normalizeSpaces(raw);

    if (!safeStr(line)) {
      ensureSpace(12);
      doc.moveDown(0.4);
      continue;
    }

    const h = doc.heightOfString(line, { width });
    ensureSpace(h + 4);
    doc.text(line, left, doc.y, { width, align: "left" });
    doc.moveDown(0.15);
  }

  doc.fillColor("#111827");
  doc.moveDown(0.4);
}

function drawFooter(doc, { locale, config, fonts }) {
  const { margin } = config.page;
  const { texts } = config;

  const footerBase =
    locale === "fr"
      ? texts.footerFr
      : locale === "sr"
      ? texts.footerSr
      : locale === "es"
      ? texts.footerEs
      : locale === "it"
      ? texts.footerIt
      : texts.footerEn;

  const footer =
    locale === "fr"
      ? `${safeStr(texts.legalNoticeFr || "")}\n${safeStr(footerBase || "")}`.trim()
      : locale === "sr"
      ? `${safeStr(texts.legalNoticeSr || "")}\n${safeStr(footerBase || "")}`.trim()
      : locale === "es"
      ? `${safeStr(texts.legalNoticeEs || "")}\n${safeStr(footerBase || "")}`.trim()
      : locale === "it"
      ? `${safeStr(texts.legalNoticeIt || "")}\n${safeStr(footerBase || "")}`.trim()
      : `${safeStr(texts.legalNoticeEn || "")}\n${safeStr(footerBase || "")}`.trim();

  const y = doc.page.height - margin - 48;

  doc.fontSize(8).font(fonts.regular).fillColor("#6b7280").text(footer, margin, y, {
    width: doc.page.width - margin * 2,
    align: "center",
  });
}

function normalizeExportInput({ seller, buyer, lines, meta, docType, locale, config, vat_effective, deposits }) {
  const l = resolveLocale(locale);
  const merged = deepMerge(DEFAULTS, config || {});
  merged.locale = l;

  const currency = safeStr(meta?.currency) || safeStr(merged.currency) || safeStr(seller?.currency) || "EUR";

  return {
    locale: l,
    i18n: I18N[l] || I18N.fr,
    config: merged,
    currency,
    seller: seller || {},
    buyer: buyer || {},
    lines: (lines || []).map((x) => ({
      description: safeStr(x.description),
      quantity: safeNum(x.quantity, 0),
      unit_price_ht: safeNum(x.unit_price_ht, 0),
      tva_percent: safeNum(x.tva_percent, 0),
      unit_code: safeStr(x.unit_code || "C62"),
      remise_percent: safeNum(x.remise_percent, 0),
    })),
    meta: {
      number: safeStr(meta?.number),
      date: safeStr(meta?.date),
      currency,
    },
    docType,
    vat_effective: safeStr(vat_effective || ""),

    // NEW: deposits to display
    deposits: Array.isArray(deposits) ? deposits : [],

    bank: {
      iban: safeStr(seller?.bank?.iban) || safeStr(merged?.bank?.iban),
      bic: safeStr(seller?.bank?.bic) || safeStr(merged?.bank?.bic),
      label: safeStr(seller?.bank?.bank_name) || safeStr(merged?.bank?.label) || "",
      holder: safeStr(seller?.bank?.holder) || "",
      extra: safeStr(seller?.bank?.extra) || "",
    },
  };
}

async function buildPdfBuffer(payload) {
  const { locale, i18n, config, seller, buyer, lines, meta, docType, vat_effective } = payload;

  validateMandatory({ docType, seller, buyer, docMeta: meta, lines, config, locale });

  const doc = new PDFDocument({
    size: config.page.size,
    margin: config.page.margin,
    autoFirstPage: true,
  });

  const fonts = ensureFonts(doc, config);

  const chunks = [];
  doc.on("data", (d) => chunks.push(d));

  const title = docType === "invoice" ? i18n.invoiceTitle : i18n.quoteTitle;

  addHeader({
    doc,
    locale,
    i18n,
    seller,
    buyer,
    docTitle: title,
    docMeta: meta,
    config,
    vat_effective,
    fonts,
  });

  drawLinesTable(doc, { locale, i18n, lines, currency: payload.currency, config, fonts });

  const totals = computeTotals(lines);
  const prepaidAmount = docType === "invoice" ? safeNum(payload.prepaid_amount, 0) : 0;

  drawTotalsBlock(doc, { locale, i18n, totals, prepaidAmount, currency: payload.currency, config, fonts });

  // NEW: show deposit details under totals if any
  if (docType === "invoice" && prepaidAmount > 0 && Array.isArray(payload.deposits) && payload.deposits.length > 0) {
    drawDepositsBlock(doc, {
      locale,
      i18n,
      deposits: payload.deposits,
      currency: payload.currency,
      config,
      fonts,
    });
  }

  drawPaymentBlock(doc, { i18n, seller, bank: payload.bank, config, fonts });

  if (docType === "quote") {
    drawQuoteConditionsBlock(doc, { locale, i18n, payload, config, fonts });
    drawAcceptanceBlock(doc, {
      i18n,
      buyer,
      meta,
      config,
      sign_mode: payload.sign_mode || config?.quote?.signMode || "PDF",
      place_city: payload.place_city || config?.quote?.placeCity || "",
      fonts,
    });
  }

  // FIX: includeCgv logique (ton code était inversé)
  const includeCgv =
    docType === "invoice"
      ? config?.invoice?.includeCgv !== false // par défaut true
      : config?.quote?.includeCgv === true;  // sur devis seulement si demandé

  if (includeCgv) {
    drawCgvBlock(doc, { locale, config, seller, fonts });
  }

  drawFooter(doc, { locale, config, fonts });

  doc.end();
  await new Promise((resolve) => doc.on("end", resolve));
  return Buffer.concat(chunks);
}

async function exportQuotePdf({ seller, buyer, quote, lines, locale, config }) {
  const payload = normalizeExportInput({
    seller,
    buyer,
    lines,
    meta: { number: quote?.number || quote?.id, date: quote?.date, currency: quote?.currency },
    docType: "quote",
    locale,
    config,
    vat_effective: quote?.vat_effective || quote?.vat_mode || "",
  });

  payload.sign_mode = safeStr(quote?.sign_mode || "") || undefined; // "PDF" | "ESIGN"
  payload.place_city = safeStr(quote?.place_city || "") || undefined;

  payload.valid_until = safeStr(quote?.valid_until || "");
  payload.validity_days = quote?.validity_days == null ? null : safeNum(quote.validity_days, null);
  payload.payment_text = safeStr(quote?.payment_text || "");

  return buildPdfBuffer(payload);
}

async function exportInvoicePdf({ seller, buyer, invoice, lines, deposits, locale, config }) {
  const payload = normalizeExportInput({
    seller,
    buyer,
    lines,
    meta: { number: invoice?.invoice_number || invoice?.id, date: invoice?.date, currency: invoice?.currency },
    docType: "invoice",
    locale,
    config,
    vat_effective: invoice?.vat_effective || invoice?.vat_mode || "",
    deposits, 
  });

  payload.prepaid_amount = safeNum(invoice?.prepaid_amount, 0);
  return buildPdfBuffer(payload);
}

module.exports = {
  exportQuotePdf,
  exportInvoicePdf,
};
