/* D2F receivables rules shared by the dashboard and Payments screen. */
(function attachReceivables(root) {
  "use strict";

  const EPSILON = 0.001;

  function numberValue(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function round2(value) {
    return Math.round((numberValue(value) + Number.EPSILON) * 100) / 100;
  }

  function objectValue(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    if (typeof value !== "string" || !value.trim()) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function invoiceType(invoice) {
    return String(invoice?.type || invoice?.kind || "final").trim().toLowerCase();
  }

  function invoiceStatus(invoice) {
    return String(invoice?.status || invoice?.state || "draft").trim().toLowerCase();
  }

  function creditSourceId(creditNote) {
    const direct = creditNote?.source_invoice_id || creditNote?.sourceInvoiceId;
    if (direct) return String(direct);

    const meta = { ...objectValue(creditNote?.meta_json), ...objectValue(creditNote?.meta) };
    const metaSource = objectValue(meta.source);
    if (metaSource.invoice_id || metaSource.invoiceId) return String(metaSource.invoice_id || metaSource.invoiceId);

    const links = Array.isArray(creditNote?.links_from) ? creditNote.links_from : [];
    const creditLink = links.find((link) => String(link?.link_type || "").toLowerCase() === "credit_of");
    return creditLink?.to_invoice_id ? String(creditLink.to_invoice_id) : "";
  }

  function invoiceGrossAmount(invoice) {
    const totalTtc = Math.max(0, numberValue(invoice?.total_ttc));
    const prepaid = invoiceType(invoice) === "final" ? Math.max(0, numberValue(invoice?.prepaid_amount)) : 0;
    if (totalTtc > 0) return Math.max(0, round2(totalTtc - prepaid));
    return Math.max(0, round2(numberValue(invoice?.amount_due)));
  }

  function paymentSignedAmount(payment) {
    if (String(payment?.status || "posted").toLowerCase() === "cancelled") return 0;
    const amount = Math.abs(numberValue(payment?.amount));
    return String(payment?.direction || "in").toLowerCase() === "out" ? -amount : amount;
  }

  function buildReceivableRows(invoices, payments) {
    const allInvoices = Array.isArray(invoices) ? invoices : [];
    const allPayments = Array.isArray(payments) ? payments : [];
    const creditsBySource = new Map();

    for (const creditNote of allInvoices) {
      if (invoiceType(creditNote) !== "credit_note" || invoiceStatus(creditNote) !== "issued") continue;
      const sourceId = creditSourceId(creditNote);
      if (!sourceId) continue;
      const current = creditsBySource.get(sourceId) || { amount: 0, numbers: [] };
      const amount = Math.abs(numberValue(creditNote?.total_ttc || creditNote?.amount_due));
      current.amount = round2(current.amount + amount);
      const number = String(creditNote?.invoice_number || creditNote?.number || "").trim();
      if (number) current.numbers.push(number);
      creditsBySource.set(sourceId, current);
    }

    const paidByInvoice = new Map();
    for (const payment of allPayments) {
      const invoiceId = String(payment?.invoice_id || payment?.invoiceId || "");
      if (!invoiceId) continue;
      paidByInvoice.set(invoiceId, round2((paidByInvoice.get(invoiceId) || 0) + paymentSignedAmount(payment)));
    }

    return allInvoices
      .filter((invoice) => invoiceStatus(invoice) === "issued" && invoiceType(invoice) !== "credit_note")
      .map((invoice) => {
        const invoiceId = String(invoice?.id || "");
        const grossDue = invoiceGrossAmount(invoice);
        const credit = creditsBySource.get(invoiceId) || { amount: 0, numbers: [] };
        const credited = Math.min(grossDue, Math.max(0, round2(credit.amount)));
        const netDue = Math.max(0, round2(grossDue - credited));
        const paid = Math.max(0, round2(paidByInvoice.get(invoiceId) || 0));
        const remaining = Math.max(0, round2(netDue - paid));
        const paymentStatus = credited > 0 && netDue <= EPSILON
          ? "credited"
          : netDue <= EPSILON || paid + EPSILON >= netDue
            ? "paid"
            : paid > EPSILON
              ? "partial"
              : "unpaid";
        return { invoice, grossDue, credited, creditNumbers: credit.numbers, netDue, paid, remaining, paymentStatus };
      });
  }

  function summarize(invoices, payments) {
    const rows = buildReceivableRows(invoices, payments);
    const activeRows = rows.filter((row) => row.paymentStatus !== "credited");
    const activePayments = (Array.isArray(payments) ? payments : []).filter((payment) =>
      String(payment?.status || "posted").toLowerCase() !== "cancelled"
    );
    return {
      rows,
      activeRows,
      paidCount: activeRows.filter((row) => row.paymentStatus === "paid").length,
      creditedCount: rows.filter((row) => row.paymentStatus === "credited").length,
      waitingCount: activeRows.filter((row) => row.remaining > EPSILON).length,
      outstanding: round2(rows.reduce((sum, row) => sum + row.remaining, 0)),
      totalPaid: round2(activePayments.reduce((sum, payment) => sum + paymentSignedAmount(payment), 0)),
      operations: activePayments.length,
    };
  }

  root.D2FReceivables = Object.freeze({
    EPSILON,
    round2,
    creditSourceId,
    invoiceGrossAmount,
    paymentSignedAmount,
    buildReceivableRows,
    summarize,
  });
})(typeof window !== "undefined" ? window : globalThis);
