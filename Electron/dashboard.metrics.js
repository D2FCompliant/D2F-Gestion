"use strict";

const { getDb } = require("./db");

function readAnnualTargetHt(db) {
  try {
    const row = db.prepare("SELECT meta_json FROM company WHERE id = 1").get();
    const meta = row?.meta_json ? JSON.parse(row.meta_json) : {};
    const v = Number(meta?.annual_target_ht);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function buildMonths(year) {
  const y = Number(year);
  const out = [];
  for (let m = 1; m <= 12; m++) out.push({ ym: `${y}-${String(m).padStart(2, "0")}` });
  return out;
}

function buildTargetCumulative(months, annualTargetHt) {
  if (!annualTargetHt || !months?.length) return months.map((m) => ({ ym: m.ym, target_cum: 0 }));
  return months.map((m, idx) => ({ ym: m.ym, target_cum: (annualTargetHt * (idx + 1)) / 12 }));
}

function getDashboardMetrics({ year } = {}) {
  const db = getDb();

  const y = Number(year) || new Date().getFullYear();
  const yStart = `${y}-01-01`;
  const yEndExclusive = `${y + 1}-01-01`;

  const annualTargetHt = readAnnualTargetHt(db);
  const nAlloc = db.prepare("SELECT COUNT(*) AS n FROM payment_allocations").get()?.n ?? 0;

  const cashYtd =
    nAlloc > 0
      ? db
          .prepare(
            `
            WITH alloc AS (
              SELECT
                p.date AS pay_date,
                i.type AS invoice_type,
                CASE WHEN p.direction = 'out' THEN -pa.amount ELSE pa.amount END AS amount
              FROM payment_allocations pa
              JOIN payments p ON p.id = pa.payment_id
              JOIN invoices i ON i.id = pa.invoice_id
              WHERE p.status IN ('posted','reconciled')
                AND p.date >= ?
                AND p.date <  ?
            )
            SELECT
              COALESCE(SUM(CASE WHEN invoice_type='deposit' THEN amount END),0) AS cash_deposit_ytd,
              COALESCE(SUM(CASE WHEN invoice_type='final'   THEN amount END),0) AS cash_final_ytd,
              COALESCE(SUM(amount),0) AS cash_total_ytd
            FROM alloc;
            `
          )
          .get(yStart, yEndExclusive)
      : db
          .prepare(
            `
            SELECT
              0 AS cash_deposit_ytd,
              0 AS cash_final_ytd,
              COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS cash_total_ytd
            FROM payments
            WHERE status IN ('posted','reconciled')
              AND date >= ?
              AND date <  ?;
            `
          )
          .get(yStart, yEndExclusive);

  const revenueIssuedYtd = db
    .prepare(
      `
      SELECT
        COALESCE(SUM(CASE WHEN type='final'   THEN total_ttc END),0) AS revenue_final_ytd,
        COALESCE(SUM(CASE WHEN type='deposit' THEN total_ttc END),0) AS revenue_deposit_ytd,
        COALESCE(SUM(CASE WHEN type IN ('final','deposit') THEN total_ttc END),0) AS revenue_total_ytd
      FROM invoices
      WHERE status='issued'
        AND type IN ('final','deposit')
        AND date >= ?
        AND date <  ?;
      `
    )
    .get(yStart, yEndExclusive);

  const months = buildMonths(y);

  const cashMonthlyRows =
    nAlloc > 0
      ? db
          .prepare(
            `
            WITH alloc AS (
              SELECT
                substr(p.date,1,7) AS ym,
                i.type AS invoice_type,
                CASE WHEN p.direction='out' THEN -pa.amount ELSE pa.amount END AS amount
              FROM payment_allocations pa
              JOIN payments p ON p.id = pa.payment_id
              JOIN invoices i ON i.id = pa.invoice_id
              WHERE p.status IN ('posted','reconciled')
                AND p.date >= ?
                AND p.date <  ?
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
      : db
          .prepare(
            `
            SELECT
              substr(date,1,7) AS ym,
              0 AS cash_deposit,
              0 AS cash_final,
              COALESCE(SUM(CASE WHEN direction='out' THEN -amount ELSE amount END),0) AS cash_total
            FROM payments
            WHERE status IN ('posted','reconciled')
              AND date >= ?
              AND date <  ?
            GROUP BY ym
            ORDER BY ym;
            `
          )
          .all(yStart, yEndExclusive);

  const byYm = new Map(cashMonthlyRows.map((r) => [r.ym, r]));

  const cashMonthly = months.map((m) => {
    const r = byYm.get(m.ym);
    return {
      ym: m.ym,
      cash_deposit: Number(r?.cash_deposit ?? 0),
      cash_final: Number(r?.cash_final ?? 0),
      cash_total: Number(r?.cash_total ?? 0),
    };
  });

  let running = 0;
  const cashCumulative = cashMonthly.map((r) => {
    running += Number(r.cash_total ?? 0);
    return { ym: r.ym, cash_cum: running };
  });

  const targetCumulative = buildTargetCumulative(months, annualTargetHt);

  const cashTotalYtd = Number(cashYtd?.cash_total_ytd ?? 0);
  const pct = annualTargetHt ? clamp01(cashTotalYtd / annualTargetHt) : 0;

  return {
    ok: true,
    year: y,
    target: {
      annual_target_ht: annualTargetHt,
      pct_of_target_cash_ytd: pct,
      cash_ytd: cashTotalYtd,
      remaining_to_target: annualTargetHt ? Math.max(0, annualTargetHt - cashTotalYtd) : null,
    },
    ytd: {
      cash: {
        cash_deposit_ytd: Number(cashYtd?.cash_deposit_ytd ?? 0),
        cash_final_ytd: Number(cashYtd?.cash_final_ytd ?? 0),
        cash_total_ytd: cashTotalYtd,
      },
      revenue_issued: {
        revenue_deposit_ytd: Number(revenueIssuedYtd?.revenue_deposit_ytd ?? 0),
        revenue_final_ytd: Number(revenueIssuedYtd?.revenue_final_ytd ?? 0),
        revenue_total_ytd: Number(revenueIssuedYtd?.revenue_total_ytd ?? 0),
      },
    },
    series: {
      cash_monthly: cashMonthly,
      cash_cumulative: cashCumulative,
      target_cumulative: targetCumulative,
    },
  };
}

module.exports = { getDashboardMetrics };
