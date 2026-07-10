// ------- electron/ipc/dashboard.ipc.js
"use strict";

function s(v, def = "") {
  return String(v ?? def).trim();
}

function n(v, def = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : def;
}

function round2(x) {
  return Math.round((n(x, 0) + Number.EPSILON) * 100) / 100;
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function tableExists(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1")
    .get(name);
}

function tableHasColumn(db, table, col) {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some((r) => r && r.name === col);
  } catch {
    return false;
  }
}

// Choisit une colonne existante
function pickCol(db, table, candidates) {
  for (const c of candidates) {
    if (tableHasColumn(db, table, c)) return c;
  }
  return null;
}

// Choisit une colonne existante ET qui contient au moins 1 valeur non vide
function pickColWithData(db, table, candidates) {
  for (const c of candidates) {
    if (!tableHasColumn(db, table, c)) continue;
    try {
      const row = db
        .prepare(`SELECT 1 AS ok FROM ${table} WHERE ${c} IS NOT NULL AND TRIM(${c}) <> '' LIMIT 1`)
        .get();
      if (row?.ok === 1) return c;
    } catch {
      // ignore
    }
  }
  return null;
}

function parseJsonSafe(str, fallback = {}) {
  try {
    const o = str ? JSON.parse(str) : fallback;
    return o && typeof o === "object" ? o : fallback;
  } catch {
    return fallback;
  }
}

function readAnnualTargetHt(db) {
  try {
    if (!tableExists(db, "company")) return null;
    const row = db.prepare("SELECT meta_json FROM company WHERE id=1").get();
    const meta = parseJsonSafe(row?.meta_json, {});
    const v = Number(meta?.annual_target_ht);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function buildMonths(year) {
  const y = Number(year);
  const out = [];
  for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
}

module.exports = (ipcMain, getDb) => {
  // =========================
  // Dashboard main KPIs
  // =========================
  ipcMain.handle("dashboard:get", (_e, { from, to } = {}) => {
    try {
      const db = getDb();

      const dateFrom = s(from);
      const dateTo = s(to);
      const withRange = !!(dateFrom && dateTo);

      const hasPayments = tableExists(db, "payments");
      const hasAlloc = tableExists(db, "payment_allocations");
      const hasInvoices = tableExists(db, "invoices");

      // Dates : on choisit la colonne qui A DES DONNÉES
      const invDateCol = hasInvoices
        ? pickColWithData(db, "invoices", ["date", "issue_date", "created_at", "createdAt"])
        : null;

      const payDateCol = hasPayments
        ? pickColWithData(db, "payments", [
            "date",
            "payment_date",
            "paid_date",
            "value_date",
            "effective_date",
            "created_at",
            "createdAt",
          ])
        : null;

      // Echéance
      const dueCol = hasInvoices
        ? pickCol(db, "invoices", ["due_date", "date_due", "due", "due_at", "dueAt"])
        : null;

      const today = new Date().toISOString().slice(0, 10);

      // -------- CA reconnu (final - avoirs sur finals) | avoirs normalisés -ABS
      let caRow = { final_ht: 0, credit_on_final_ht: 0 };

      if (hasInvoices && invDateCol) {
        const finalWhere = withRange ? `WHERE ${invDateCol} BETWEEN ? AND ?` : "";
        const finalAnd = withRange ? "AND" : "WHERE";

        const creditWhere = withRange ? `WHERE cn.${invDateCol} BETWEEN ? AND ?` : "";
        const creditAnd = withRange ? "AND" : "WHERE";

        caRow = db
          .prepare(
            `
            WITH
            final AS (
              SELECT COALESCE(SUM(COALESCE(total_ht,0)),0) AS final_ht
              FROM invoices
              ${finalWhere}
              ${finalAnd} type='final' AND status='issued'
            ),
            credit_on_final AS (
              SELECT COALESCE(SUM(-ABS(COALESCE(cn.total_ht,0))),0) AS credit_on_final_ht
              FROM invoices cn
              JOIN invoices src ON src.id = cn.source_invoice_id
              ${creditWhere}
              ${creditAnd} cn.type='credit_note'
                AND cn.status='issued'
                AND src.type='final'
                AND src.status='issued'
            )
            SELECT final.final_ht, credit_on_final.credit_on_final_ht
            FROM final, credit_on_final;
            `
          )
          .get(...(withRange ? [dateFrom, dateTo, dateFrom, dateTo] : []));
      }

      const caRecognizedHt = round2(n(caRow?.final_ht) + n(caRow?.credit_on_final_ht));

      // -------- Avoirs sur acomptes (normalisés -ABS)
      let creditDepRow = { credit_on_deposit_ttc: 0 };

      if (hasInvoices && invDateCol) {
        const creditWhere = withRange ? `WHERE cn.${invDateCol} BETWEEN ? AND ?` : "";
        const creditAnd = withRange ? "AND" : "WHERE";

        creditDepRow = db
          .prepare(
            `
            SELECT COALESCE(SUM(-ABS(COALESCE(cn.total_ttc,0))),0) AS credit_on_deposit_ttc
            FROM invoices cn
            JOIN invoices src ON src.id = cn.source_invoice_id
            ${creditWhere}
            ${creditAnd} cn.type='credit_note'
              AND cn.status='issued'
              AND src.type='deposit'
              AND src.status='issued'
            `
          )
          .get(...(withRange ? [dateFrom, dateTo] : []));
      }

      const creditOnDepositTtc = round2(n(creditDepRow?.credit_on_deposit_ttc)); // négatif/0

      // -------- Acomptes émis TTC
      let depIssuedRow = { s: 0 };

      if (hasInvoices && invDateCol) {
        depIssuedRow = db
          .prepare(
            `
            SELECT COALESCE(SUM(COALESCE(total_ttc,0)),0) AS s
            FROM invoices
            WHERE type='deposit' AND status='issued'
            ${withRange ? `AND ${invDateCol} BETWEEN ? AND ?` : ""}
            `
          )
          .get(...(withRange ? [dateFrom, dateTo] : []));
      }

      const depositsIssuedTtc = round2(n(depIssuedRow?.s));
      const depositsIssuedNetTtc = round2(Math.max(0, depositsIssuedTtc + creditOnDepositTtc));

      // -------- Acomptes encaissés TTC
      let depositsPaidTtc = 0;

      const nAlloc = hasAlloc
        ? db.prepare("SELECT COUNT(*) AS n FROM payment_allocations").get()?.n ?? 0
        : 0;

      const useAlloc = hasPayments && hasInvoices && hasAlloc && nAlloc > 0;

      // filtre date côté payments : toujours en YYYY-MM-DD (substr gère ISO)
      const payBetween = withRange && payDateCol ? `AND substr(p.${payDateCol},1,10) BETWEEN ? AND ?` : "";

      if (useAlloc && payDateCol) {
        const depPaidRow = db
          .prepare(
            `
            SELECT
              COALESCE(SUM(CASE WHEN p.direction='out' THEN -pa.amount ELSE pa.amount END),0) AS s
            FROM payment_allocations pa
            JOIN payments p ON p.id = pa.payment_id
            JOIN invoices i ON i.id = pa.invoice_id
            WHERE p.status IN ('posted','reconciled')
              AND i.type='deposit'
              AND i.status='issued'
              ${payBetween}
            `
          )
          .get(...(withRange ? [dateFrom, dateTo] : []));

        depositsPaidTtc = round2(n(depPaidRow?.s));
      } else if (hasPayments && hasInvoices && payDateCol && tableHasColumn(db, "payments", "invoice_id")) {
        const depPaidRow = db
          .prepare(
            `
            SELECT
              COALESCE(SUM(CASE WHEN p.direction='out' THEN -p.amount ELSE p.amount END),0) AS s
            FROM payments p
            JOIN invoices i ON i.id = p.invoice_id
            WHERE p.status IN ('posted','reconciled')
              AND i.type='deposit'
              AND i.status='issued'
              ${payBetween}
            `
          )
          .get(...(withRange ? [dateFrom, dateTo] : []));

        depositsPaidTtc = round2(n(depPaidRow?.s));
      } else {
        depositsPaidTtc = 0;
      }

      const depositsWaitingTtc = round2(Math.max(0, depositsIssuedNetTtc - depositsPaidTtc));

      // -------- En retard
      let depositsOverdueTtc = 0;
      let depositsOverdueN = 0;

      if (hasInvoices && dueCol) {
        const invBetween = withRange && invDateCol ? `AND ${invDateCol} BETWEEN ? AND ?` : "";
        const row = db
          .prepare(
            `
            SELECT
              COUNT(*) AS n,
              COALESCE(SUM(
                COALESCE(amount_due, ROUND(COALESCE(total_ttc,0) - COALESCE(prepaid_amount,0),2))
              ),0) AS s
            FROM invoices
            WHERE type='deposit'
              AND status='issued'
              AND ${dueCol} < ?
              AND COALESCE(amount_due, ROUND(COALESCE(total_ttc,0) - COALESCE(prepaid_amount,0),2)) > 0.01
              ${invBetween}
            `
          )
          .get(...(withRange && invDateCol ? [today, dateFrom, dateTo] : [today]));

        depositsOverdueTtc = round2(n(row?.s));
        depositsOverdueN = n(row?.n);
      }

      // -------- Délai moyen d'encaissement (pondéré par montant)
      let avgDaysToCollect = null;

      if (hasInvoices && hasPayments && invDateCol && payDateCol) {
        if (useAlloc) {
          const row = db
            .prepare(
              `
              SELECT
                CASE
                  WHEN SUM(ABS(CASE WHEN p.direction='out' THEN -pa.amount ELSE pa.amount END)) > 0
                  THEN
                    SUM(
                      (julianday(substr(p.${payDateCol},1,10)) - julianday(substr(i.${invDateCol},1,10)))
                      * ABS(CASE WHEN p.direction='out' THEN -pa.amount ELSE pa.amount END)
                    )
                    / SUM(ABS(CASE WHEN p.direction='out' THEN -pa.amount ELSE pa.amount END))
                  ELSE NULL
                END AS avg_days
              FROM payment_allocations pa
              JOIN payments p ON p.id = pa.payment_id
              JOIN invoices i ON i.id = pa.invoice_id
              WHERE p.status IN ('posted','reconciled')
                AND i.status='issued'
                AND i.type='deposit'
                AND p.${payDateCol} IS NOT NULL AND TRIM(p.${payDateCol}) <> ''
                AND i.${invDateCol} IS NOT NULL AND TRIM(i.${invDateCol}) <> ''
                ${payBetween}
              `
            )
            .get(...(withRange ? [dateFrom, dateTo] : []));

          const v = Number(row?.avg_days);
          avgDaysToCollect = Number.isFinite(v) ? round2(v) : null;
        } else if (tableHasColumn(db, "payments", "invoice_id")) {
          const row = db
            .prepare(
              `
              SELECT
                CASE
                  WHEN SUM(ABS(p.amount)) > 0
                  THEN
                    SUM(
                      (julianday(substr(p.${payDateCol},1,10)) - julianday(substr(i.${invDateCol},1,10)))
                      * ABS(p.amount)
                    ) / SUM(ABS(p.amount))
                  ELSE NULL
                END AS avg_days
              FROM payments p
              JOIN invoices i ON i.id = p.invoice_id
              WHERE p.status IN ('posted','reconciled')
                AND i.status='issued'
                AND i.type='deposit'
                AND p.${payDateCol} IS NOT NULL AND TRIM(p.${payDateCol}) <> ''
                AND i.${invDateCol} IS NOT NULL AND TRIM(i.${invDateCol}) <> ''
                ${payBetween}
              `
            )
            .get(...(withRange ? [dateFrom, dateTo] : []));

          const v = Number(row?.avg_days);
          avgDaysToCollect = Number.isFinite(v) ? round2(v) : null;
        }
      }

      // -------- Quotes aggregate
      const quotesAgg = tableExists(db, "quotes")
        ? db
            .prepare(
              `
              SELECT
                COALESCE(SUM(CASE WHEN status='draft'    THEN 1 ELSE 0 END),0) AS draft_n,
                COALESCE(SUM(CASE WHEN status='sent'     THEN 1 ELSE 0 END),0) AS sent_n,
                COALESCE(SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END),0) AS accepted_n,
                COALESCE(SUM(CASE WHEN status IN ('rejected','refused') THEN 1 ELSE 0 END),0) AS rejected_n,

                COALESCE(SUM(CASE WHEN status='draft'    THEN COALESCE(total_ht,0) ELSE 0 END),0) AS draft_amt,
                COALESCE(SUM(CASE WHEN status='sent'     THEN COALESCE(total_ht,0) ELSE 0 END),0) AS sent_amt,
                COALESCE(SUM(CASE WHEN status='accepted' THEN COALESCE(total_ht,0) ELSE 0 END),0) AS accepted_amt,
                COALESCE(SUM(CASE WHEN status IN ('rejected','refused') THEN COALESCE(total_ht,0) ELSE 0 END),0) AS rejected_amt
              FROM quotes;
              `
            )
            .get()
        : {
            draft_n: 0,
            sent_n: 0,
            accepted_n: 0,
            rejected_n: 0,
            draft_amt: 0,
            sent_amt: 0,
            accepted_amt: 0,
            rejected_amt: 0,
          };

      // -------- Invoices KPIs (counts)
      let invoicesIssued = 0;
      let invoicesPaid = 0;
      let invoicesWaiting = 0;

      if (hasInvoices) {
        const invRows =
          hasPayments && tableHasColumn(db, "payments", "invoice_id")
            ? db
                .prepare(
                  `
                  SELECT
                    i.status,
                    i.type,
                    COALESCE(i.amount_due, ROUND(COALESCE(i.total_ttc,0) - COALESCE(i.prepaid_amount,0), 2)) AS amount_due,
                    COALESCE(p.paid_total,0) AS paid_total
                  FROM invoices i
                  LEFT JOIN (
                    SELECT invoice_id, SUM(CASE WHEN direction='out' THEN -amount ELSE amount END) AS paid_total
                    FROM payments
                    WHERE status IN ('posted','reconciled')
                    GROUP BY invoice_id
                  ) p ON p.invoice_id = i.id
                  `
                )
                .all()
            : db
                .prepare(
                  `
                  SELECT
                    status,
                    type,
                    COALESCE(amount_due, ROUND(COALESCE(total_ttc,0) - COALESCE(prepaid_amount,0), 2)) AS amount_due,
                    0 AS paid_total
                  FROM invoices
                  `
                )
                .all();

        for (const r of invRows) {
          if (r.status !== "issued") continue;
          if (!["final", "deposit", "credit_note"].includes(String(r.type || ""))) continue;

          invoicesIssued++;

          const due = round2(n(r.amount_due));
          const paid = round2(n(r.paid_total));
          const remain = round2(Math.max(0, due - paid));

          if (remain <= 0.01) invoicesPaid++;
          else invoicesWaiting++;
        }
      }

      // -------- Payments totals + by method
      let paymentsTotal = 0;
      let byMethod = [];

      if (hasPayments) {
        const dateFilter = withRange && payDateCol ? `AND substr(${payDateCol},1,10) BETWEEN ? AND ?` : "";

        const pr = db
          .prepare(
            `
            SELECT COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS s
            FROM payments
            WHERE status IN ('posted','reconciled')
            ${dateFilter}
            `
          )
          .get(...(withRange && payDateCol ? [dateFrom, dateTo] : []));

        paymentsTotal = round2(n(pr?.s));

        byMethod = db
          .prepare(
            `
            SELECT COALESCE(method,'other') AS method,
                   COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS total
            FROM payments
            WHERE status IN ('posted','reconciled')
            ${dateFilter}
            GROUP BY COALESCE(method,'other')
            ORDER BY total DESC
            `
          )
          .all(...(withRange && payDateCol ? [dateFrom, dateTo] : []))
          .map((x) => ({ method: x.method, total: round2(n(x.total)) }));
      }

      return {
        ok: true,
        currency: "EUR",
        ca_recognized_ht: caRecognizedHt,
        deposits: {
          total_ttc: depositsIssuedNetTtc,
          issued_ttc: depositsIssuedNetTtc,
          paid_ttc: depositsPaidTtc,
          waiting_ttc: depositsWaitingTtc,
          overdue_ttc: depositsOverdueTtc,
          overdue_n: depositsOverdueN,
          avg_days_to_collect: avgDaysToCollect,
        },
        quotes: {
          counts: {
            draft: n(quotesAgg?.draft_n),
            sent: n(quotesAgg?.sent_n),
            accepted: n(quotesAgg?.accepted_n),
            rejected: n(quotesAgg?.rejected_n),
            done: n(quotesAgg?.sent_n) + n(quotesAgg?.accepted_n) + n(quotesAgg?.rejected_n),
          },
          amounts: {
            draft: round2(n(quotesAgg?.draft_amt)),
            sent: round2(n(quotesAgg?.sent_amt)),
            accepted: round2(n(quotesAgg?.accepted_amt)),
            rejected: round2(n(quotesAgg?.rejected_amt)),
            done: round2(n(quotesAgg?.sent_amt) + n(quotesAgg?.accepted_amt) + n(quotesAgg?.rejected_amt)),
          },
          amounts_ht: {
            draft: round2(n(quotesAgg?.draft_amt)),
            sent: round2(n(quotesAgg?.sent_amt)),
            accepted: round2(n(quotesAgg?.accepted_amt)),
            rejected: round2(n(quotesAgg?.rejected_amt)),
            done: round2(n(quotesAgg?.sent_amt) + n(quotesAgg?.accepted_amt) + n(quotesAgg?.rejected_amt)),
          },
        },
        credits: {
          on_final_ht: round2(Math.abs(n(caRow?.credit_on_final_ht))),
          on_deposit_ttc: round2(Math.abs(n(creditDepRow?.credit_on_deposit_ttc))),
        },
        invoices: {
          issued: invoicesIssued,
          paid: invoicesPaid,
          waiting: invoicesWaiting,
        },
        payments: {
          total: paymentsTotal,
          by_method: byMethod,
        },
        _debug: { invDateCol, payDateCol, dueCol, useAlloc },
      };
    } catch (err) {
      console.error("[DASH][ERR] dashboard:get failed", err);
      return { ok: false, error: String(err?.message ?? err) };
    }
  });

  // =========================
  // Dashboard metrics / series
  // =========================
  ipcMain.handle("dashboard:metrics", (_e, { year } = {}) => {
    try {
      const db = getDb();

      const y = Number(year) || new Date().getFullYear();
      const yStart = `${y}-01-01`;
      const yEndExclusive = `${y + 1}-01-01`;

      const annualTargetHt = readAnnualTargetHt(db);

      const hasAlloc = tableExists(db, "payment_allocations");
      const hasPayments = tableExists(db, "payments");
      const hasInvoices = tableExists(db, "invoices");

      if (!hasPayments || !hasInvoices) return { ok: false, error: "MISSING_TABLES" };

      const invDateCol = pickColWithData(db, "invoices", ["date", "issue_date", "created_at", "createdAt"]);
      const payDateCol = pickColWithData(db, "payments", [
        "date",
        "payment_date",
        "paid_date",
        "value_date",
        "effective_date",
        "created_at",
        "createdAt",
      ]);

      const nAlloc = hasAlloc ? (db.prepare("SELECT COUNT(*) AS n FROM payment_allocations").get()?.n ?? 0) : 0;
      const useAlloc = hasAlloc && nAlloc > 0;

      const cashYtd =
        useAlloc && payDateCol
          ? db
              .prepare(
                `
                WITH alloc AS (
                  SELECT
                    substr(p.${payDateCol},1,10) AS pay_date,
                    i.type AS invoice_type,
                    CASE WHEN p.direction='out' THEN -pa.amount ELSE pa.amount END AS amount
                  FROM payment_allocations pa
                  JOIN payments p ON p.id = pa.payment_id
                  JOIN invoices i ON i.id = pa.invoice_id
                  WHERE p.status IN ('posted','reconciled')
                    AND substr(p.${payDateCol},1,10) >= ?
                    AND substr(p.${payDateCol},1,10) <  ?
                )
                SELECT
                  COALESCE(SUM(CASE WHEN invoice_type='deposit' THEN amount END),0) AS cash_deposit_ytd,
                  COALESCE(SUM(CASE WHEN invoice_type='final'   THEN amount END),0) AS cash_final_ytd,
                  COALESCE(SUM(amount),0) AS cash_total_ytd
                FROM alloc;
                `
              )
              .get(yStart, yEndExclusive)
          : payDateCol
            ? db
                .prepare(
                  `
                  SELECT
                    0 AS cash_deposit_ytd,
                    0 AS cash_final_ytd,
                    COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS cash_total_ytd
                  FROM payments
                  WHERE status IN ('posted','reconciled')
                    AND substr(${payDateCol},1,10) >= ?
                    AND substr(${payDateCol},1,10) <  ?;
                  `
                )
                .get(yStart, yEndExclusive)
            : { cash_deposit_ytd: 0, cash_final_ytd: 0, cash_total_ytd: 0 };

      const cashDepositYtd = round2(n(cashYtd?.cash_deposit_ytd));
      const cashFinalYtd = round2(n(cashYtd?.cash_final_ytd));
      const cashTotalYtd = round2(n(cashYtd?.cash_total_ytd));

      const rev = invDateCol
        ? db
            .prepare(
              `
              SELECT
                COALESCE(SUM(CASE WHEN type='final'   THEN total_ttc END),0) AS revenue_final_ytd,
                COALESCE(SUM(CASE WHEN type='deposit' THEN total_ttc END),0) AS revenue_deposit_ytd,
                COALESCE(SUM(CASE WHEN type IN ('final','deposit') THEN total_ttc END),0) AS revenue_total_ytd
              FROM invoices
              WHERE status='issued'
                AND type IN ('final','deposit')
                AND ${invDateCol} >= ?
                AND ${invDateCol} <  ?;
              `
            )
            .get(yStart, yEndExclusive)
        : { revenue_final_ytd: 0, revenue_deposit_ytd: 0, revenue_total_ytd: 0 };

      const revenueFinalYtd = round2(n(rev?.revenue_final_ytd));
      const revenueDepositYtd = round2(n(rev?.revenue_deposit_ytd));
      const revenueTotalYtd = round2(n(rev?.revenue_total_ytd));

      const months = buildMonths(y);

      const recRows = invDateCol
        ? db
            .prepare(
              `
              WITH
              sales AS (
                SELECT
                  substr(${invDateCol},1,7) AS ym,
                  COALESCE(SUM(COALESCE(total_ht,0)),0) AS sales_ht
                FROM invoices
                WHERE status='issued'
                  AND type='final'
                  AND ${invDateCol} >= ?
                  AND ${invDateCol} <  ?
                GROUP BY ym
              ),
              credits AS (
                SELECT
                  substr(cn.${invDateCol},1,7) AS ym,
                  COALESCE(SUM(-ABS(COALESCE(cn.total_ht,0))),0) AS credit_ht
                FROM invoices cn
                JOIN invoices src ON src.id = cn.source_invoice_id
                WHERE cn.status='issued'
                  AND cn.type='credit_note'
                  AND cn.${invDateCol} >= ?
                  AND cn.${invDateCol} <  ?
                  AND src.status='issued'
                  AND src.type='final'
                GROUP BY ym
              )
              SELECT
                m.ym AS ym,
                COALESCE(s.sales_ht,0) AS sales_ht,
                COALESCE(c.credit_ht,0) AS credit_ht
              FROM (
                SELECT substr(${invDateCol},1,7) AS ym
                FROM invoices
                WHERE ${invDateCol} >= ? AND ${invDateCol} < ?
                GROUP BY ym
              ) m
              LEFT JOIN sales s   ON s.ym = m.ym
              LEFT JOIN credits c ON c.ym = m.ym
              ORDER BY m.ym;
              `
            )
            .all(yStart, yEndExclusive, yStart, yEndExclusive, yStart, yEndExclusive)
        : [];

      const recByYm = new Map(recRows.map((r) => [r.ym, r]));

      const recognizedHtMonthly = months.map((ym) => {
        const r = recByYm.get(ym);
        const sales = round2(n(r?.sales_ht));
        const credit = round2(n(r?.credit_ht));
        return { ym, recognized_ht: round2(sales + credit) };
      });

      const caRecognizedHtYtd = round2(
        recognizedHtMonthly.reduce((acc, m) => round2(acc + n(m.recognized_ht)), 0)
      );

      const cashMonthlyRows =
        useAlloc && payDateCol
          ? db
              .prepare(
                `
                WITH alloc AS (
                  SELECT
                    substr(p.${payDateCol},1,7) AS ym,
                    i.type AS invoice_type,
                    CASE WHEN p.direction='out' THEN -pa.amount ELSE pa.amount END AS amount
                  FROM payment_allocations pa
                  JOIN payments p ON p.id = pa.payment_id
                  JOIN invoices i ON i.id = pa.invoice_id
                  WHERE p.status IN ('posted','reconciled')
                    AND substr(p.${payDateCol},1,10) >= ?
                    AND substr(p.${payDateCol},1,10) <  ?
                )
                SELECT
                  ym,
                  COALESCE(SUM(CASE WHEN invoice_type='deposit' THEN amount END),0) AS cash_deposit,
                  COALESCE(SUM(CASE WHEN invoice_type='final'   THEN amount END),0) AS cash_final,
                  COALESCE(SUM(amount),0) AS cash_total
                FROM alloc
                GROUP BY ym
                ORDER BY ym;
                `
              )
              .all(yStart, yEndExclusive)
          : payDateCol
            ? db
                .prepare(
                  `
                  SELECT
                    substr(${payDateCol},1,7) AS ym,
                    0 AS cash_deposit,
                    0 AS cash_final,
                    COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS cash_total
                  FROM payments
                  WHERE status IN ('posted','reconciled')
                    AND substr(${payDateCol},1,10) >= ?
                    AND substr(${payDateCol},1,10) <  ?
                  GROUP BY ym
                  ORDER BY ym;
                  `
                )
                .all(yStart, yEndExclusive)
            : [];

      const byYm = new Map(cashMonthlyRows.map((r) => [r.ym, r]));

      const cashMonthly = months.map((ym) => {
        const r = byYm.get(ym);
        return {
          ym,
          cash_deposit: round2(n(r?.cash_deposit)),
          cash_final: round2(n(r?.cash_final)),
          cash_total: round2(n(r?.cash_total)),
        };
      });

      let run = 0;
      const cashCumulative = cashMonthly.map((m) => {
        run = round2(run + n(m.cash_total));
        return { ym: m.ym, cash_cum: run };
      });

      const targetCumulative = months.map((ym, idx) => ({
        ym,
        target_cum: annualTargetHt ? round2((annualTargetHt * (idx + 1)) / 12) : 0,
      }));

      const pct = annualTargetHt ? clamp01(cashTotalYtd / annualTargetHt) : 0;

      return {
        ok: true,
        currency: "EUR",
        year: y,
        target: {
          annual_target_ht: annualTargetHt,
          pct_of_target_cash_ytd: pct,
          cash_ytd: cashTotalYtd,
          remaining_to_target: annualTargetHt ? round2(Math.max(0, annualTargetHt - cashTotalYtd)) : null,
        },
        ytd: {
          recognized: {
            ca_recognized_ht_ytd: caRecognizedHtYtd,
          },
          cash: {
            cash_deposit_ytd: cashDepositYtd,
            cash_final_ytd: cashFinalYtd,
            cash_total_ytd: cashTotalYtd,
          },
          revenue_issued: {
            revenue_deposit_ytd: revenueDepositYtd,
            revenue_final_ytd: revenueFinalYtd,
            revenue_total_ytd: revenueTotalYtd,
          },
        },
        series: {
          cash_monthly: cashMonthly,
          cash_cumulative: cashCumulative,
          target_cumulative: targetCumulative,
          recognized_ht_monthly: recognizedHtMonthly,
        },
        _debug: { invDateCol, payDateCol, useAlloc },
      };
    } catch (err) {
      console.error("[DASH][ERR] dashboard:metrics failed", err);
      return { ok: false, error: String(err?.message ?? err) };
    }
  });
};
