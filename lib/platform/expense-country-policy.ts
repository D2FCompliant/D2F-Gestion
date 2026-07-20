type JsonRecord = Record<string, unknown>;

export type ExpenseCountryPolicy = {
  country: string;
  packId: string;
  version: string;
  status: "manual_validation_required" | "not_qualified";
  allowedCategories: readonly string[];
  receiptRequired: boolean;
  vatRecoverability: "pending";
};

const COMMON_CATEGORIES = ["travel", "meals", "lodging", "mileage", "supplies", "other"] as const;
const QUALIFIED_COUNTRIES = new Set(["FR", "RS", "IT", "ES"]);

export function expenseCountryPolicy(countryValue: unknown): ExpenseCountryPolicy {
  const country = String(countryValue || "").trim().toUpperCase().slice(0, 2);
  return {
    country: country || "—",
    packId: country ? "country." + country.toLowerCase() + ".expense" : "country.unqualified.expense",
    version: "1.0.0-preview",
    status: QUALIFIED_COUNTRIES.has(country) ? "manual_validation_required" : "not_qualified",
    allowedCategories: COMMON_CATEGORIES,
    receiptRequired: true,
    vatRecoverability: "pending",
  };
}

export function evaluateExpenseLine(countryValue: unknown, input: JsonRecord) {
  const policy = expenseCountryPolicy(countryValue);
  if (policy.status === "not_qualified") throw new Error("Les règles de notes de frais ne sont pas encore qualifiées pour le pays " + policy.country);
  const category = String(input.category || "other").trim().toLowerCase();
  if (!policy.allowedCategories.includes(category)) throw new Error("Catégorie de dépense non admise par le Country Pack " + policy.country);
  return {
    category,
    receiptRequired: policy.receiptRequired,
    vatRecoverability: policy.vatRecoverability,
    policyResult: {
      status: policy.status,
      packId: policy.packId,
      packVersion: policy.version,
      establishmentCountry: policy.country,
      taxDecision: "pending_human_validation",
      reimbursementDecision: "pending_policy_validation",
    },
  };
}
