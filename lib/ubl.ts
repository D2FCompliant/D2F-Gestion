type JsonRecord = Record<string, unknown>;

function value(input: unknown) {
  return String(input ?? "").trim();
}

function numberValue(input: unknown) {
  const numeric = Number(input);
  return Number.isFinite(numeric) ? numeric : 0;
}

function xml(input: unknown) {
  return value(input).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function amount(input: unknown) {
  return Math.abs(numberValue(input)).toFixed(2);
}

function lineAmount(line: JsonRecord) {
  const gross = numberValue(line.quantity || 1) * numberValue(line.unit_price_ht);
  return Math.round(gross * (1 - numberValue(line.remise_percent) / 100) * 100) / 100;
}

function country(party: JsonRecord) {
  return value(party.country || "FR").toUpperCase().slice(0, 2);
}

function endpoint(party: JsonRecord) {
  const meta = party.meta && typeof party.meta === "object" ? party.meta as JsonRecord : {};
  return {
    id: value(party.peppol_endpoint_id || meta.peppol_endpoint_id),
    scheme: value(party.peppol_endpoint_scheme || meta.peppol_endpoint_scheme),
  };
}

function partyXml(tag: string, party: JsonRecord) {
  const ep = endpoint(party);
  const name = value(party.legal_name || party.name);
  return `<cac:${tag}>
    <cac:Party>
      ${ep.id ? `<cbc:EndpointID schemeID="${xml(ep.scheme)}">${xml(ep.id)}</cbc:EndpointID>` : ""}
      ${party.legal_id ? `<cac:PartyIdentification><cbc:ID>${xml(party.legal_id)}</cbc:ID></cac:PartyIdentification>` : ""}
      <cac:PostalAddress>
        <cbc:StreetName>${xml(party.street)}</cbc:StreetName>
        ${party.street2 ? `<cbc:AdditionalStreetName>${xml(party.street2)}</cbc:AdditionalStreetName>` : ""}
        <cbc:CityName>${xml(party.city)}</cbc:CityName>
        <cbc:PostalZone>${xml(party.postal_code || party.postal)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${xml(country(party))}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${party.vat_id ? `<cac:PartyTaxScheme><cbc:CompanyID>${xml(party.vat_id)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
      <cac:PartyLegalEntity><cbc:RegistrationName>${xml(name)}</cbc:RegistrationName>${party.legal_id ? `<cbc:CompanyID>${xml(party.legal_id)}</cbc:CompanyID>` : ""}</cac:PartyLegalEntity>
      ${party.email ? `<cac:Contact><cbc:ElectronicMail>${xml(party.email)}</cbc:ElectronicMail></cac:Contact>` : ""}
    </cac:Party>
  </cac:${tag}>`;
}

export function createUblDocument(input: { document: JsonRecord; lines: JsonRecord[]; seller: JsonRecord; buyer: JsonRecord; profile?: "peppol" | "fr-cius" | "sef" | "en16931" }) {
  const document = input.document;
  const lines = input.lines;
  const isCredit = value(document.type).toLowerCase() === "credit_note";
  const currency = value(document.currency || input.seller.currency || "EUR").toUpperCase();
  const number = value(document.invoice_number || document.number);
  if (!number) throw new Error("Le document doit être émis et numéroté avant l'export structuré");
  if (!value(document.date)) throw new Error("La date du document est obligatoire");
  if (!value(input.seller.legal_name || input.seller.name) || !value(input.buyer.name || input.buyer.legal_name)) throw new Error("L'émetteur et le client sont obligatoires");
  if (!lines.length) throw new Error("Au moins une ligne est obligatoire");

  const lineExtensionTotal = Math.round(lines.reduce((sum, line) => sum + lineAmount(line), 0) * 100) / 100;
  const allowancePercent = Math.min(100, Math.max(0, numberValue(document.allowance_percent)));
  const documentAllowance = document.allowance_amount == null
    ? Math.round(lineExtensionTotal * allowancePercent) / 100
    : Math.abs(numberValue(document.allowance_amount));
  const computedTotalHt = Math.round((lineExtensionTotal - documentAllowance) * 100) / 100;
  const totalHt = document.total_ht == null ? computedTotalHt : numberValue(document.total_ht);
  const taxFactor = lineExtensionTotal > 0 ? Math.max(0, Math.min(1, Math.abs(totalHt) / lineExtensionTotal)) : 1;
  const totalVat = document.total_tva == null ? lines.reduce((sum, line) => sum + lineAmount(line) * taxFactor * numberValue(line.tva_percent) / 100, 0) : numberValue(document.total_tva);
  const totalTtc = document.total_ttc == null ? totalHt + totalVat : numberValue(document.total_ttc);
  const due = document.amount_due == null ? totalTtc - numberValue(document.prepaid_amount) : numberValue(document.amount_due);
  const root = isCredit ? "CreditNote" : "Invoice";
  const lineTag = isCredit ? "CreditNoteLine" : "InvoiceLine";
  const quantityTag = isCredit ? "CreditedQuantity" : "InvoicedQuantity";
  const typeCode = isCredit ? "381" : value(document.type).toLowerCase() === "deposit" ? "386" : "380";
  const taxGroups = new Map<number, { taxable: number; tax: number }>();
  for (const line of lines) {
    const rate = numberValue(line.tva_percent);
    const taxable = lineAmount(line) * taxFactor;
    const current = taxGroups.get(rate) || { taxable: 0, tax: 0 };
    current.taxable += taxable;
    current.tax += taxable * rate / 100;
    taxGroups.set(rate, current);
  }
  const category = value(document.vat_effective).toUpperCase() === "REVERSE_CHARGE" ? "AE" : "S";
  const lineXml = lines.map((line, index) => {
    const rate = numberValue(line.tva_percent);
    const quantity = Math.abs(numberValue(line.quantity || 1));
    const unitPrice = Math.abs(numberValue(line.unit_price_ht));
    const lineDiscountPercent = Math.min(100, Math.max(0, numberValue(line.remise_percent)));
    const lineGross = Math.round(quantity * unitPrice * 100) / 100;
    const lineDiscountAmount = Math.round((lineGross - lineAmount(line)) * 100) / 100;
    const lineAllowanceXml = lineDiscountAmount > 0 ? `<cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode>
        <cbc:AllowanceChargeReason>${xml(line.remise_reason || "Remise commerciale")}</cbc:AllowanceChargeReason>
        <cbc:MultiplierFactorNumeric>${(lineDiscountPercent / 100).toFixed(4)}</cbc:MultiplierFactorNumeric>
        <cbc:Amount currencyID="${xml(currency)}">${amount(lineDiscountAmount)}</cbc:Amount>
        <cbc:BaseAmount currencyID="${xml(currency)}">${amount(lineGross)}</cbc:BaseAmount>
      </cac:AllowanceCharge>` : "";
    return `<cac:${lineTag}>
      <cbc:ID>${index + 1}</cbc:ID>
      <cbc:${quantityTag} unitCode="${xml(line.unit_code || "C62")}">${Math.abs(numberValue(line.quantity || 1))}</cbc:${quantityTag}>
      <cbc:LineExtensionAmount currencyID="${xml(currency)}">${amount(lineAmount(line))}</cbc:LineExtensionAmount>
      ${lineAllowanceXml}
      <cac:Item><cbc:Name>${xml(line.description || line.name || line.label)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${category}</cbc:ID><cbc:Percent>${rate.toFixed(2)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="${xml(currency)}">${amount(line.unit_price_ht)}</cbc:PriceAmount></cac:Price>
    </cac:${lineTag}>`;
  }).join("\n");
  const taxSubtotals = Array.from(taxGroups.entries()).map(([rate, group]) => `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${xml(currency)}">${amount(group.taxable)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${xml(currency)}">${amount(group.tax)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${category}</cbc:ID><cbc:Percent>${rate.toFixed(2)}</cbc:Percent>${category === "AE" ? "<cbc:TaxExemptionReason>Reverse charge</cbc:TaxExemptionReason>" : ""}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join("");
  const bank = input.seller.bank && typeof input.seller.bank === "object" ? input.seller.bank as JsonRecord : {};
  const iban = value(bank.iban || input.seller.iban);
  const dueDate = value(document.due_date);
  const profile = input.profile || "peppol";
  const customizationId = profile === "fr-cius"
    ? "urn:cen.eu:en16931:2017#compliant#urn:peppol:france:billing:cius:1.0"
    : profile === "peppol"
      ? "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0"
      : "urn:cen.eu:en16931:2017";
  const profileId = profile === "peppol" || profile === "fr-cius" ? "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0" : "";
  const sourceInvoiceNumber = value(document.source_invoice_number || document.source_document_number || document.source_invoice_id);
  const documentAllowanceXml = documentAllowance > 0 ? `<cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReasonCode>${xml(document.allowance_reason_code || "95")}</cbc:AllowanceChargeReasonCode>
    <cbc:AllowanceChargeReason>${xml(document.allowance_reason || "Remise commerciale")}</cbc:AllowanceChargeReason>
    ${allowancePercent ? `<cbc:MultiplierFactorNumeric>${(allowancePercent / 100).toFixed(4)}</cbc:MultiplierFactorNumeric>` : ""}
    <cbc:Amount currencyID="${xml(currency)}">${amount(documentAllowance)}</cbc:Amount>
    <cbc:BaseAmount currencyID="${xml(currency)}">${amount(lineExtensionTotal)}</cbc:BaseAmount>
  </cac:AllowanceCharge>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>${customizationId}</cbc:CustomizationID>
  ${profileId ? `<cbc:ProfileID>${profileId}</cbc:ProfileID>` : ""}
  <cbc:ID>${xml(number)}</cbc:ID>
  <cbc:IssueDate>${xml(value(document.date).slice(0, 10))}</cbc:IssueDate>
  ${dueDate ? `<cbc:DueDate>${xml(dueDate.slice(0, 10))}</cbc:DueDate>` : ""}
  <cbc:${isCredit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>${typeCode}</cbc:${isCredit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>
  <cbc:DocumentCurrencyCode>${xml(currency)}</cbc:DocumentCurrencyCode>
  ${document.buyer_reference ? `<cbc:BuyerReference>${xml(document.buyer_reference)}</cbc:BuyerReference>` : ""}
  ${isCredit && sourceInvoiceNumber ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${xml(sourceInvoiceNumber)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ""}
  ${partyXml("AccountingSupplierParty", input.seller)}
  ${partyXml("AccountingCustomerParty", input.buyer)}
  ${iban ? `<cac:PaymentMeans><cbc:PaymentMeansCode>30</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>${xml(iban)}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>` : ""}
  ${documentAllowanceXml}
  <cac:TaxTotal><cbc:TaxAmount currencyID="${xml(currency)}">${amount(totalVat)}</cbc:TaxAmount>${taxSubtotals}</cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${xml(currency)}">${amount(lineExtensionTotal)}</cbc:LineExtensionAmount>
    ${documentAllowance > 0 ? `<cbc:AllowanceTotalAmount currencyID="${xml(currency)}">${amount(documentAllowance)}</cbc:AllowanceTotalAmount>` : ""}
    <cbc:TaxExclusiveAmount currencyID="${xml(currency)}">${amount(totalHt)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${xml(currency)}">${amount(totalTtc)}</cbc:TaxInclusiveAmount>
    ${document.prepaid_amount ? `<cbc:PrepaidAmount currencyID="${xml(currency)}">${amount(document.prepaid_amount)}</cbc:PrepaidAmount>` : ""}
    <cbc:PayableAmount currencyID="${xml(currency)}">${amount(due)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  ${lineXml}
</${root}>`;
}

export function textToBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
