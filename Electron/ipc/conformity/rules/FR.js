"use strict";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function lastDayOfMonthUTC(yyyy, mm1to12) {
  return new Date(Date.UTC(yyyy, mm1to12, 0)).getUTCDate();
}

function addDaysUTC(date, days) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d;
}

function isoDateUTC(date) {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  return `${y}-${m}-${d}`;
}

function normPeriodicity(v) {
  const p = String(v || "M").toUpperCase();
  return ["D", "M", "B"].includes(p) ? p : "M";
}

function periodicityFromVatRegime(vatRegime) {
  const vr = String(vatRegime || "").toUpperCase();

  if (vr === "REAL_NORMAL_MONTHLY") return "D";
  if (vr === "REAL_NORMAL_QUARTERLY") return "M";
  if (vr === "SIMPLIFIED") return "M";
  if (vr === "FRANCHISE") return "B";

  return "M";
}

function computeNextDueFR({ periodicity, now }) {
  const p = normPeriodicity(periodicity);
  const d = now instanceof Date ? now : new Date();

  const yyyy = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  if (p === "D") {
    let periodEndDay = 10;
    if (day <= 10) periodEndDay = 10;
    else if (day <= 20) periodEndDay = 20;
    else periodEndDay = lastDayOfMonthUTC(yyyy, month);

    const periodEnd = new Date(Date.UTC(yyyy, month - 1, periodEndDay));
    return isoDateUTC(addDaysUTC(periodEnd, 10));
  }

  if (p === "B") {
    const dueMonth =
      month <= 2 ? 2 :
      month <= 4 ? 4 :
      month <= 6 ? 6 :
      month <= 8 ? 8 :
      month <= 10 ? 10 : 12;

    const endDay = lastDayOfMonthUTC(yyyy, dueMonth);
    const periodEnd = new Date(Date.UTC(yyyy, dueMonth - 1, endDay));
    return isoDateUTC(addDaysUTC(periodEnd, 10));
  }

  // M placeholder: 10 du mois suivant
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? yyyy + 1 : yyyy;
  return `${nextYear}-${pad2(nextMonth)}-10`;
}

module.exports = {
  id: "FR",
  derive: ({ ctx }) => {
    const vatRegime = String(ctx?.vat_regime || "");
    const forced = periodicityFromVatRegime(vatRegime);
    return { jurisdiction: "FR", periodicity: forced };
  },
  computeNextDue: ({ cfg, ctx }) => {
    return computeNextDueFR({
      periodicity: cfg?.periodicity,
      now: ctx?.now || new Date(),
    });
  },
};
