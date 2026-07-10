"use strict";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function lastDayOfMonthUTC(yyyy, mm1to12) {
  return new Date(Date.UTC(yyyy, mm1to12, 0)).getUTCDate();
}

function normPeriodicity(v) {
  const p = String(v || "M").toUpperCase();
  return ["D", "M", "B"].includes(p) ? p : "M";
}

function computeNextDueDEFAULT({ periodicity, now }) {
  const p = normPeriodicity(periodicity);
  const d = now instanceof Date ? now : new Date();

  const yyyy = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();

  if (p === "D") {
    let dueDay = 10;
    if (day <= 10) dueDay = 10;
    else if (day <= 20) dueDay = 20;
    else dueDay = lastDayOfMonthUTC(yyyy, month);
    return `${yyyy}-${pad2(month)}-${pad2(dueDay)}`;
  }

  if (p === "B") {
    const dueMonth =
      month <= 2 ? 2 :
      month <= 4 ? 4 :
      month <= 6 ? 6 :
      month <= 8 ? 8 :
      month <= 10 ? 10 : 12;

    const dueDay = lastDayOfMonthUTC(yyyy, dueMonth);
    return `${yyyy}-${pad2(dueMonth)}-${pad2(dueDay)}`;
  }

  return `${yyyy}-${pad2(month)}-20`;
}

module.exports = {
  id: "DEFAULT",
  derive: ({ cfg }) => ({
    jurisdiction: "DEFAULT",
    periodicity: normPeriodicity(cfg?.periodicity),
  }),
  computeNextDue: ({ cfg, ctx }) => {
    return computeNextDueDEFAULT({
      periodicity: cfg?.periodicity,
      now: ctx?.now || new Date(),
    });
  },
};
