"use strict";

const { XMLParser } = require("fast-xml-parser");

function safeArr(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function pickText(x) {
  if (x == null) return "";
  if (typeof x === "string" || typeof x === "number") return String(x);
  if (typeof x === "object" && "#text" in x) return String(x["#text"]);
  return "";
}

function parseXml(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true, // simplifies UBL/CII node access
    parseTagValue: false,
    trimValues: true,
  });
  return parser.parse(xml);
}

function normalizeUbl(doc) {
  // expected: Invoice
  const inv = doc?.Invoice || doc?.InvoiceType || doc?.InvoiceDocument || null;
  if (!inv) throw new Error("UBL: root Invoice introuvable");

  const cbc = inv; // with removeNSPrefix, cbc:ID becomes ID etc.

  const invoice_number = pickText(cbc.ID);
  const issue_date = pickText(cbc.IssueDate);
  const currency = pickText(cbc.DocumentCurrencyCode) || "EUR";

  const sellerParty =
    inv?.AccountingSupplierParty?.Party ||
    inv?.AccountingSupplierParty?.Party?.PartyLegalEntity ||
    inv?.AccountingSupplierParty ||
    null;

  const buyerParty =
    inv?.AccountingCustomerParty?.Party ||
    inv?.AccountingCustomerParty?.Party?.PartyLegalEntity ||
    inv?.AccountingCustomerParty ||
    null;

  const seller = {
    legal_name: pickText(sellerParty?.PartyLegalEntity?.RegistrationName) || pickText(sellerParty?.PartyName?.Name),
    vat_id: pickText(sellerParty?.PartyTaxScheme?.CompanyID),
    legal_id: pickText(sellerParty?.PartyLegalEntity?.CompanyID),
    country: pickText(sellerParty?.PostalAddress?.Country?.IdentificationCode),
    street: pickText(sellerParty?.PostalAddress?.StreetName),
    street2: pickText(sellerParty?.PostalAddress?.AdditionalStreetName),
    postal_code: pickText(sellerParty?.PostalAddress?.PostalZone),
    city: pickText(sellerParty?.PostalAddress?.CityName),
  };

  const buyer = {
    name: pickText(buyerParty?.PartyLegalEntity?.RegistrationName) || pickText(buyerParty?.PartyName?.Name),
    vat_id: pickText(buyerParty?.PartyTaxScheme?.CompanyID),
    legal_id: pickText(buyerParty?.PartyLegalEntity?.CompanyID),
    country: pickText(buyerParty?.PostalAddress?.Country?.IdentificationCode),
    street: pickText(buyerParty?.PostalAddress?.StreetName),
    street2: pickText(buyerParty?.PostalAddress?.AdditionalStreetName),
    postal_code: pickText(buyerParty?.PostalAddress?.PostalZone),
    city: pickText(buyerParty?.PostalAddress?.CityName),
  };

  const lines = safeArr(inv?.InvoiceLine).map((l) => {
    const qty = Number(pickText(l?.InvoicedQuantity)) || 0;
    const unit_code = l?.InvoicedQuantity?.["@_unitCode"] || "";
    const unit_price_ht = Number(pickText(l?.Price?.PriceAmount)) || 0;
    const description = pickText(l?.Item?.Description) || pickText(l?.Item?.Name);

    // VAT percent in UBL can be nested; we take a best-effort
    const tva_percent =
      Number(pickText(l?.Item?.ClassifiedTaxCategory?.Percent)) ||
      Number(pickText(l?.TaxTotal?.TaxSubtotal?.TaxCategory?.Percent)) ||
      0;

    return {
      description,
      quantity: qty,
      unit_code: String(unit_code || "C62"),
      unit_price_ht,
      tva_percent,
    };
  });

  // Totals best-effort
  const total_ht =
    Number(pickText(inv?.LegalMonetaryTotal?.TaxExclusiveAmount)) ||
    0;
  const total_tva =
    Number(pickText(inv?.TaxTotal?.TaxAmount)) ||
    0;
  const total_ttc =
    Number(pickText(inv?.LegalMonetaryTotal?.TaxInclusiveAmount)) ||
    (total_ht + total_tva);

  return {
    invoice_number,
    issue_date,
    currency,
    seller,
    buyer,
    lines,
    totals: { total_ht, total_tva, total_ttc },
  };
}

function normalizeCii(doc) {
  const cii = doc?.CrossIndustryInvoice || doc?.CrossIndustryInvoiceType || null;
  if (!cii) throw new Error("CII: root CrossIndustryInvoice introuvable");

  const header = cii?.ExchangedDocument || {};
  const invoice_number = pickText(header?.ID);
  const issue_date =
    pickText(header?.IssueDateTime?.DateTimeString) ||
    pickText(header?.IssueDateTime?.DateTime?.DateTimeString) ||
    "";

  const trade = cii?.SupplyChainTradeTransaction || {};
  const agr = trade?.ApplicableHeaderTradeAgreement || {};
  const del = trade?.ApplicableHeaderTradeDelivery || {};
  const set = trade?.ApplicableHeaderTradeSettlement || {};

  const currency = pickText(set?.InvoiceCurrencyCode) || "EUR";

  const seller = {
    legal_name: pickText(agr?.SellerTradeParty?.Name),
    vat_id: pickText(agr?.SellerTradeParty?.SpecifiedTaxRegistration?.ID),
    legal_id: pickText(agr?.SellerTradeParty?.ID),
    country: pickText(agr?.SellerTradeParty?.PostalTradeAddress?.CountryID),
    street: pickText(agr?.SellerTradeParty?.PostalTradeAddress?.LineOne),
    postal_code: pickText(agr?.SellerTradeParty?.PostalTradeAddress?.PostcodeCode),
    city: pickText(agr?.SellerTradeParty?.PostalTradeAddress?.CityName),
  };

  const buyer = {
    name: pickText(agr?.BuyerTradeParty?.Name),
    vat_id: pickText(agr?.BuyerTradeParty?.SpecifiedTaxRegistration?.ID),
    legal_id: pickText(agr?.BuyerTradeParty?.ID),
    country: pickText(agr?.BuyerTradeParty?.PostalTradeAddress?.CountryID),
    street: pickText(agr?.BuyerTradeParty?.PostalTradeAddress?.LineOne),
    postal_code: pickText(agr?.BuyerTradeParty?.PostalTradeAddress?.PostcodeCode),
    city: pickText(agr?.BuyerTradeParty?.PostalTradeAddress?.CityName),
  };

  const lines = safeArr(trade?.IncludedSupplyChainTradeLineItem).map((li) => {
    const prod = li?.SpecifiedTradeProduct || {};
    const agrLine = li?.SpecifiedLineTradeAgreement || {};
    const delLine = li?.SpecifiedLineTradeDelivery || {};
    const setLine = li?.SpecifiedLineTradeSettlement || {};

    const description = pickText(prod?.Name) || pickText(prod?.Description);
    const qty =
      Number(pickText(delLine?.BilledQuantity)) ||
      0;
    const unit_code = delLine?.BilledQuantity?.["@_unitCode"] || "C62";

    const unit_price_ht =
      Number(pickText(agrLine?.NetPriceProductTradePrice?.ChargeAmount)) ||
      0;

    const tva_percent =
      Number(pickText(setLine?.ApplicableTradeTax?.RateApplicablePercent)) || 0;

    return {
      description,
      quantity: qty,
      unit_code: String(unit_code || "C62"),
      unit_price_ht,
      tva_percent,
    };
  });

  const total_ht =
    Number(pickText(set?.SpecifiedTradeSettlementHeaderMonetarySummation?.TaxBasisTotalAmount)) || 0;
  const total_tva =
    Number(pickText(set?.SpecifiedTradeSettlementHeaderMonetarySummation?.TaxTotalAmount)) || 0;
  const total_ttc =
    Number(pickText(set?.SpecifiedTradeSettlementHeaderMonetarySummation?.GrandTotalAmount)) || (total_ht + total_tva);

  return {
    invoice_number,
    issue_date,
    currency,
    seller,
    buyer,
    lines,
    totals: { total_ht, total_tva, total_ttc },
  };
}

function normalizeXmlToCanonical({ format, xml }) {
  const doc = parseXml(xml);

  if (format === "UBL") return normalizeUbl(doc);
  if (format === "CII") return normalizeCii(doc);

  throw new Error(`Format non supporté en normalisation: ${format}`);
}

module.exports = { normalizeXmlToCanonical };
