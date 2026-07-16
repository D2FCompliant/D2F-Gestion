import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from "pdf-lib";

type JsonRecord = Record<string, unknown>;

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 42;
const BLUE = rgb(0.08, 0.28, 0.67);
const INK = rgb(0.05, 0.10, 0.16);
const MUTED = rgb(0.34, 0.39, 0.46);
const LINE = rgb(0.86, 0.89, 0.93);
const SOFT = rgb(0.95, 0.97, 1);

const COPY: Record<string, Record<string, string>> = {
  fr: { quote: "DEVIS", invoice: "FACTURE", credit: "AVOIR", seller: "Émetteur", buyer: "Client", number: "Numéro", date: "Date", dueDate: "Échéance", description: "Désignation", quantity: "Qté", unitPrice: "Prix unitaire HT", vat: "TVA", total: "Total HT", subtotal: "Total HT", vatTotal: "Total TVA", grandTotal: "Total TTC", prepaid: "Acomptes", amountDue: "Net à payer", payment: "Paiement", terms: "Conditions", bank: "Coordonnées bancaires", legal: "Mentions", thanks: "Merci pour votre confiance.", page: "Page" },
  en: { quote: "QUOTATION", invoice: "INVOICE", credit: "CREDIT NOTE", seller: "Seller", buyer: "Customer", number: "Number", date: "Date", dueDate: "Due date", description: "Description", quantity: "Qty", unitPrice: "Unit price excl. VAT", vat: "VAT", total: "Total excl. VAT", subtotal: "Subtotal", vatTotal: "VAT total", grandTotal: "Total", prepaid: "Prepayments", amountDue: "Amount due", payment: "Payment", terms: "Terms", bank: "Bank details", legal: "Legal information", thanks: "Thank you for your business.", page: "Page" },
  es: { quote: "PRESUPUESTO", invoice: "FACTURA", credit: "NOTA DE CRÉDITO", seller: "Emisor", buyer: "Cliente", number: "Número", date: "Fecha", dueDate: "Vencimiento", description: "Descripción", quantity: "Cant.", unitPrice: "Precio sin IVA", vat: "IVA", total: "Total sin IVA", subtotal: "Base imponible", vatTotal: "Total IVA", grandTotal: "Total", prepaid: "Anticipos", amountDue: "Importe a pagar", payment: "Pago", terms: "Condiciones", bank: "Datos bancarios", legal: "Información legal", thanks: "Gracias por su confianza.", page: "Página" },
  it: { quote: "PREVENTIVO", invoice: "FATTURA", credit: "NOTA DI CREDITO", seller: "Emittente", buyer: "Cliente", number: "Numero", date: "Data", dueDate: "Scadenza", description: "Descrizione", quantity: "Q.tà", unitPrice: "Prezzo IVA escl.", vat: "IVA", total: "Totale IVA escl.", subtotal: "Imponibile", vatTotal: "Totale IVA", grandTotal: "Totale", prepaid: "Acconti", amountDue: "Da pagare", payment: "Pagamento", terms: "Condizioni", bank: "Coordinate bancarie", legal: "Informazioni legali", thanks: "Grazie per la fiducia.", page: "Pagina" },
  sr: { quote: "PONUDA", invoice: "FAKTURA", credit: "KNJIZNO ODOBRENJE", seller: "Izdavalac", buyer: "Kupac", number: "Broj", date: "Datum", dueDate: "Rok placanja", description: "Opis", quantity: "Kol.", unitPrice: "Cena bez PDV", vat: "PDV", total: "Iznos bez PDV", subtotal: "Osnovica", vatTotal: "Ukupan PDV", grandTotal: "Ukupno", prepaid: "Avansi", amountDue: "Za uplatu", payment: "Placanje", terms: "Uslovi", bank: "Podaci banke", legal: "Pravni podaci", thanks: "Hvala na poverenju.", page: "Strana" },
};

function value(input: unknown) {
  return String(input ?? "").trim();
}

function numberValue(input: unknown) {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function object(input: unknown): JsonRecord {
  return input && typeof input === "object" && !Array.isArray(input) ? input as JsonRecord : {};
}

function localeCode(input: unknown) {
  const locale = value(input || "fr").toLowerCase().slice(0, 2);
  return COPY[locale] ? locale : "fr";
}

function safeText(input: unknown, locale: string) {
  let text = value(input)
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00a0/g, " ");
  if (locale === "sr") {
    const pairs: Record<string, string> = { А:"A", Б:"B", В:"V", Г:"G", Д:"D", Ђ:"Dj", Е:"E", Ж:"Z", З:"Z", И:"I", Ј:"J", К:"K", Л:"L", Љ:"Lj", М:"M", Н:"N", Њ:"Nj", О:"O", П:"P", Р:"R", С:"S", Т:"T", Ћ:"C", У:"U", Ф:"F", Х:"H", Ц:"C", Ч:"C", Џ:"Dz", Ш:"S", а:"a", б:"b", в:"v", г:"g", д:"d", ђ:"dj", е:"e", ж:"z", з:"z", и:"i", ј:"j", к:"k", л:"l", љ:"lj", м:"m", н:"n", њ:"nj", о:"o", п:"p", р:"r", с:"s", т:"t", ћ:"c", у:"u", ф:"f", х:"h", ц:"c", ч:"c", џ:"dz", ш:"s" };
    text = Array.from(text, (char) => pairs[char] ?? char).join("");
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  return text.replace(/[^\x09\x0a\x0d\x20-\x7e\xA0-\xFF]/g, (character) => character === "€" ? character : "?");
}

function money(amount: unknown, currency: unknown, locale: string) {
  const intl = ({ fr: "fr-FR", en: "en-GB", es: "es-ES", it: "it-IT", sr: "sr-Latn-RS" } as Record<string, string>)[locale] || "fr-FR";
  try {
    return new Intl.NumberFormat(intl, { style: "currency", currency: value(currency || "EUR"), minimumFractionDigits: 2 }).format(numberValue(amount)).replace(/\u202f|\u00a0/g, " ");
  } catch {
    return `${numberValue(amount).toFixed(2)} ${value(currency || "EUR")}`;
  }
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number) {
  const paragraphs = text.split(/\r?\n/);
  const result: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      result.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) line = candidate;
      else {
        result.push(line);
        line = word;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

function drawLines(page: PDFPage, lines: string[], x: number, y: number, options: { font: PDFFont; size: number; color?: ReturnType<typeof rgb>; lineHeight?: number }) {
  const lineHeight = options.lineHeight || options.size * 1.25;
  lines.forEach((line, index) => page.drawText(line, { x, y: y - index * lineHeight, size: options.size, font: options.font, color: options.color || INK }));
  return y - lines.length * lineHeight;
}

function partyLines(party: JsonRecord, locale: string) {
  const address = [party.legal_name || party.name, party.street, party.street2, [party.postal_code || party.postal, party.city].filter(Boolean).join(" "), party.country].map(value).filter(Boolean);
  if (party.legal_id) address.push(`ID: ${value(party.legal_id)}`);
  if (party.vat_id) address.push(`VAT: ${value(party.vat_id)}`);
  if (party.email) address.push(safeText(party.email, locale));
  return address.map((line) => safeText(line, locale));
}

function lineTotals(lines: JsonRecord[]) {
  let totalHt = 0;
  let totalVat = 0;
  for (const line of lines) {
    const quantity = numberValue(line.quantity || 1);
    const unitPrice = numberValue(line.unit_price_ht);
    const discount = numberValue(line.remise_percent);
    const ht = Math.round(quantity * unitPrice * (1 - discount / 100) * 100) / 100;
    totalHt += ht;
    totalVat += ht * numberValue(line.tva_percent) / 100;
  }
  return { totalHt: Math.round(totalHt * 100) / 100, totalVat: Math.round(totalVat * 100) / 100, totalTtc: Math.round((totalHt + totalVat) * 100) / 100 };
}

export async function createDocumentPdf(input: {
  kind: "quote" | "invoice";
  document: JsonRecord;
  lines: JsonRecord[];
  seller: JsonRecord;
  buyer: JsonRecord;
  locale?: unknown;
}) {
  const locale = localeCode(input.locale);
  const c = COPY[locale];
  const document = input.document;
  const lines = input.lines.map(object);
  const currency = document.currency || input.seller.currency || "EUR";
  const isCredit = value(document.type).toLowerCase() === "credit_note";
  const title = isCredit ? c.credit : input.kind === "quote" ? c.quote : c.invoice;
  const documentNumber = value(document.invoice_number || document.number || document.id);
  if (!documentNumber) throw new Error("Le document doit avoir un numéro avant la génération du PDF");
  if (!value(input.seller.legal_name || input.seller.name)) throw new Error("La raison sociale de l'émetteur est obligatoire");
  if (!value(input.buyer.name || input.buyer.legal_name)) throw new Error("Le client est obligatoire");
  if (!lines.length) throw new Error("Le document doit contenir au moins une ligne");

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} ${documentNumber}`);
  pdf.setAuthor(value(input.seller.legal_name || input.seller.name));
  pdf.setSubject("D2F Gestion - EN 16931");
  pdf.setProducer("D2F Gestion Web");
  pdf.setCreationDate(new Date());
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  let page = pdf.addPage([A4.width, A4.height]);
  pages.push(page);
  let y = A4.height - MARGIN;

  const addPage = () => {
    page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    y = A4.height - MARGIN;
  };
  const ensure = (height: number) => {
    if (y - height < 68) addPage();
  };

  page.drawRectangle({ x: 0, y: A4.height - 10, width: A4.width, height: 10, color: BLUE });
  page.drawText(safeText(title, locale), { x: MARGIN, y: y - 17, size: 23, font: bold, color: BLUE });
  page.drawText(safeText(documentNumber, locale), { x: MARGIN, y: y - 37, size: 11, font: bold, color: INK });
  const meta = [`${c.date}: ${value(document.date).slice(0, 10) || "-"}`];
  if (document.due_date) meta.push(`${c.dueDate}: ${value(document.due_date).slice(0, 10)}`);
  drawLines(page, meta.map((line) => safeText(line, locale)), 360, y - 18, { font: regular, size: 9, color: MUTED, lineHeight: 14 });
  y -= 72;

  const gap = 14;
  const boxWidth = (A4.width - MARGIN * 2 - gap) / 2;
  const sellerLines = partyLines(input.seller, locale);
  const buyerLines = partyLines(input.buyer, locale);
  const partyHeight = Math.max(94, 35 + Math.max(sellerLines.length, buyerLines.length) * 12);
  page.drawRectangle({ x: MARGIN, y: y - partyHeight, width: boxWidth, height: partyHeight, borderColor: LINE, borderWidth: 1, color: SOFT });
  page.drawRectangle({ x: MARGIN + boxWidth + gap, y: y - partyHeight, width: boxWidth, height: partyHeight, borderColor: LINE, borderWidth: 1 });
  page.drawText(safeText(c.seller, locale), { x: MARGIN + 10, y: y - 18, size: 9, font: bold, color: BLUE });
  page.drawText(safeText(c.buyer, locale), { x: MARGIN + boxWidth + gap + 10, y: y - 18, size: 9, font: bold, color: BLUE });
  drawLines(page, sellerLines, MARGIN + 10, y - 35, { font: regular, size: 8.5, lineHeight: 12 });
  drawLines(page, buyerLines, MARGIN + boxWidth + gap + 10, y - 35, { font: regular, size: 8.5, lineHeight: 12 });
  y -= partyHeight + 25;

  const columns = { desc: MARGIN, qty: 323, price: 370, vat: 465, total: 510 };
  const tableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 22, width: A4.width - MARGIN * 2, height: 22, color: BLUE });
    const headers: Array<[string, number]> = [[c.description, columns.desc + 7], [c.quantity, columns.qty], [c.unitPrice, columns.price], [c.vat, columns.vat], [c.total, columns.total]];
    headers.forEach(([label, x]) => page.drawText(safeText(label, locale), { x, y: y - 15, size: x === columns.desc + 7 ? 8 : 7, font: bold, color: rgb(1, 1, 1) }));
    y -= 26;
  };
  tableHeader();
  for (const line of lines) {
    const description = safeText(line.description || line.name || line.label || "-", locale);
    const descriptionLines = wrap(description, regular, 8.5, 268);
    const rowHeight = Math.max(24, descriptionLines.length * 11 + 10);
    if (y - rowHeight < 118) {
      addPage();
      tableHeader();
    }
    const quantity = numberValue(line.quantity || 1);
    const price = numberValue(line.unit_price_ht);
    const discount = numberValue(line.remise_percent);
    const total = Math.round(quantity * price * (1 - discount / 100) * 100) / 100;
    page.drawRectangle({ x: MARGIN, y: y - rowHeight, width: A4.width - MARGIN * 2, height: rowHeight, borderColor: LINE, borderWidth: 0.6 });
    drawLines(page, descriptionLines, columns.desc + 7, y - 14, { font: regular, size: 8.5, lineHeight: 11 });
    page.drawText(quantity.toFixed(2).replace(/\.00$/, ""), { x: columns.qty, y: y - 15, size: 8, font: regular });
    page.drawText(safeText(money(price, currency, locale), locale), { x: columns.price, y: y - 15, size: 7.5, font: regular });
    page.drawText(`${numberValue(line.tva_percent).toFixed(2).replace(/\.00$/, "")}%`, { x: columns.vat, y: y - 15, size: 8, font: regular });
    page.drawText(safeText(money(total, currency, locale), locale), { x: columns.total, y: y - 15, size: 7.5, font: regular });
    y -= rowHeight;
  }

  const calculated = lineTotals(lines);
  const sign = isCredit ? -1 : 1;
  const totalHt = document.total_ht == null ? calculated.totalHt * sign : numberValue(document.total_ht);
  const totalVat = document.total_tva == null ? calculated.totalVat * sign : numberValue(document.total_tva);
  const totalTtc = document.total_ttc == null ? calculated.totalTtc * sign : numberValue(document.total_ttc);
  const prepaid = Math.max(0, numberValue(document.prepaid_amount));
  const amountDue = document.amount_due == null ? totalTtc - prepaid : numberValue(document.amount_due);
  const totalsRows: Array<[string, number]> = [[c.subtotal, totalHt], [c.vatTotal, totalVat], [c.grandTotal, totalTtc]];
  if (prepaid) totalsRows.push([c.prepaid, -prepaid]);
  totalsRows.push([c.amountDue, amountDue]);
  ensure(totalsRows.length * 18 + 40);
  y -= 18;
  const totalsX = 340;
  page.drawRectangle({ x: totalsX, y: y - totalsRows.length * 18 - 8, width: A4.width - MARGIN - totalsX, height: totalsRows.length * 18 + 8, color: SOFT, borderColor: LINE, borderWidth: 1 });
  totalsRows.forEach(([label, amount], index) => {
    const rowY = y - 17 - index * 18;
    const final = index === totalsRows.length - 1;
    page.drawText(safeText(label, locale), { x: totalsX + 10, y: rowY, size: final ? 9.5 : 8.5, font: final ? bold : regular, color: final ? BLUE : INK });
    const formatted = safeText(money(amount, currency, locale), locale);
    page.drawText(formatted, { x: A4.width - MARGIN - 10 - (final ? bold : regular).widthOfTextAtSize(formatted, final ? 9.5 : 8.5), y: rowY, size: final ? 9.5 : 8.5, font: final ? bold : regular, color: final ? BLUE : INK });
  });
  y -= totalsRows.length * 18 + 28;

  const bank = object(input.seller.bank);
  const paymentText = value(document.payment_text || input.seller.payment_terms || input.seller.payment_text);
  const bankText = [bank.bank_name || input.seller.bank_name, bank.holder || input.seller.bank_holder, bank.iban || input.seller.iban ? `IBAN: ${value(bank.iban || input.seller.iban)}` : "", bank.bic || input.seller.bic ? `BIC/SWIFT: ${value(bank.bic || input.seller.bic)}` : ""].map(value).filter(Boolean).join(" | ");
  const terms = [paymentText, bankText].filter(Boolean).join("\n");
  if (terms) {
    const termLines = wrap(safeText(terms, locale), regular, 8.5, A4.width - MARGIN * 2);
    ensure(termLines.length * 11 + 35);
    page.drawText(safeText(c.payment, locale), { x: MARGIN, y, size: 10, font: bold, color: BLUE });
    y = drawLines(page, termLines, MARGIN, y - 17, { font: regular, size: 8.5, color: MUTED, lineHeight: 11 }) - 10;
  }

  const legalLines = [
    document.operation_category ? `${c.legal}: ${value(document.operation_category)}` : "",
    document.vat_on_debits ? "TVA sur les débits" : "",
    value(document.vat_effective).toUpperCase() === "REVERSE_CHARGE" ? (locale === "fr" ? "Autoliquidation - TVA due par le preneur." : "Reverse charge - VAT due by the customer.") : "",
    value(document.notes),
    input.kind === "quote" ? value(document.payment_text) : "",
  ].filter(Boolean).join("\n");
  if (legalLines) {
    const wrapped = wrap(safeText(legalLines, locale), regular, 8, A4.width - MARGIN * 2);
    ensure(wrapped.length * 10 + 30);
    page.drawText(safeText(c.terms, locale), { x: MARGIN, y, size: 9.5, font: bold, color: BLUE });
    y = drawLines(page, wrapped, MARGIN, y - 16, { font: regular, size: 8, color: MUTED, lineHeight: 10 });
  }

  pages.forEach((current, index) => {
    current.drawLine({ start: { x: MARGIN, y: 48 }, end: { x: A4.width - MARGIN, y: 48 }, color: LINE, thickness: 0.6 });
    current.drawText(safeText(`${c.thanks}  © D2F Compliant d.o.o. 2026`, locale), { x: MARGIN, y: 30, size: 7.5, font: regular, color: MUTED });
    const pageText = `${c.page} ${index + 1}/${pages.length}`;
    current.drawText(pageText, { x: A4.width - MARGIN - regular.widthOfTextAtSize(pageText, 7.5), y: 30, size: 7.5, font: regular, color: MUTED });
  });

  return pdf.save();
}

export function pdfBytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
