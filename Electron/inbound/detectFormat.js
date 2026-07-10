// inbound/detectFormat.js
"use strict";

function sniffXmlKind(xml) {
  const s = String(xml || "").slice(0, 5000); // suffit pour lire le root
  const upper = s.toUpperCase();

  // CII / UNCEFACT (CrossIndustryInvoice)
  if (upper.includes("CROSSINDUSTRYINVOICE") || upper.includes("UN:UNECE:UNCEFACT")) return "CII";

  // UBL Invoice / CreditNote
  if (upper.includes("<INVOICE") || upper.includes(":INVOICE") || upper.includes("OASIS:NAMES:SPECIFICATION:UBL")) return "UBL";

  return "UNKNOWN";
}

function detectFormat({ filename = "", contentType = "", payload }) {
  const fn = String(filename).toLowerCase();
  const ct = String(contentType).toLowerCase();

  // PDF -> Factur-X potentiel
  if (fn.endsWith(".pdf") || ct.includes("pdf")) return "FACTUR-X";

  // XML -> sniff
  if (fn.endsWith(".xml") || ct.includes("xml")) {
    const xml = Buffer.isBuffer(payload) ? payload.toString("utf8") : String(payload || "");
    return sniffXmlKind(xml);
  }

  return "UNKNOWN";
}

module.exports = { detectFormat };
