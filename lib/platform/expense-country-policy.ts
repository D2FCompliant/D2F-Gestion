import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

export type ExpenseCountryPolicy = {
  country: string;
  packId: string;
  version: string;
  status: "qualified" | "not_qualified";
  allowedCategories: readonly string[];
  receiptRequired: boolean;
  vatRecoverability: "pending";
  evidenceRequirements: readonly string[];
  ruleReferences: readonly string[];
};

export const CANONICAL_EXPENSE_CATEGORIES = [
  "meal", "accommodation", "fuel", "toll", "parking", "train", "flight", "taxi",
  "ride_hailing", "public_transport", "vehicle_rental", "mileage", "per_diem",
  "telecommunications", "office_supplies", "representation", "training", "conference",
  "home_working", "miscellaneous",
] as const;

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function missingRegistry(error: { code?: string; message?: string } | null) {
  return Boolean(error && (["42P01", "PGRST204", "PGRST205"].includes(error.code || "") || /d2f_country_pack_versions/i.test(error.message || "")));
}

export async function expenseCountryPolicy(supabase: SupabaseClient, countryValue: unknown): Promise<ExpenseCountryPolicy> {
  const country = String(countryValue || "").trim().toUpperCase().slice(0, 2);
  const unqualified = (reason: string): ExpenseCountryPolicy => ({
    country: country || "—", packId: country ? `country.${country.toLowerCase()}.unqualified` : "country.unqualified", version: "",
    status: "not_qualified", allowedCategories: [], receiptRequired: true, vatRecoverability: "pending", evidenceRequirements: [reason], ruleReferences: [],
  });
  if (!country) return unqualified("country_missing");
  const result = await supabase.from("d2f_country_pack_versions")
    .select("pack_id,pack_version,manifest,effective_from,effective_to")
    .eq("country", country).eq("status", "published").order("effective_from", { ascending: false }).limit(10);
  if (result.error) {
    if (missingRegistry(result.error)) return unqualified("registry_not_initialized");
    throw new Error("Le registre Country Pack est indisponible");
  }
  const now = new Date().toISOString();
  const row = (result.data || []).find((candidate) => (!candidate.effective_from || candidate.effective_from <= now) && (!candidate.effective_to || candidate.effective_to > now));
  if (!row) return unqualified("no_published_pack");
  const manifest = object(row.manifest);
  const expense = object(manifest.expense || object(manifest.capabilities).expense);
  const categories = Array.isArray(expense.allowedCategories)
    ? expense.allowedCategories.map(String).filter((value) => (CANONICAL_EXPENSE_CATEGORIES as readonly string[]).includes(value))
    : [];
  if (!categories.length) return unqualified("expense_scope_missing");
  return {
    country, packId: String(row.pack_id), version: String(row.pack_version), status: "qualified", allowedCategories: categories,
    receiptRequired: expense.receiptRequiredDefault !== false, vatRecoverability: "pending",
    evidenceRequirements: Array.isArray(expense.evidenceRequirements) ? expense.evidenceRequirements.map(String) : [],
    ruleReferences: Array.isArray(expense.ruleReferences) ? expense.ruleReferences.map(String) : [],
  };
}

export function evaluateExpenseLine(policy: ExpenseCountryPolicy, input: JsonRecord) {
  if (policy.status !== "qualified") throw new Error("Les règles de notes de frais ne sont pas qualifiées pour le pays " + policy.country);
  const category = String(input.category || "miscellaneous").trim().toLowerCase();
  if (!policy.allowedCategories.includes(category)) throw new Error("Catégorie non couverte par le Country Pack " + policy.country + " version " + policy.version);
  return {
    category, receiptRequired: policy.receiptRequired, vatRecoverability: policy.vatRecoverability,
    policyResult: {
      status: "qualified", packId: policy.packId, packVersion: policy.version, establishmentCountry: policy.country,
      taxDecision: "pending_human_validation", reimbursementDecision: "pending_policy_validation",
      evidenceRequirements: policy.evidenceRequirements, ruleReferences: policy.ruleReferences, evaluatedAt: new Date().toISOString(),
    },
  };
}
