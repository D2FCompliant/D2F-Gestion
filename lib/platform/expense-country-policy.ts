import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

export type ExpenseCountryPolicy = {
  country: string;
  packId: string;
  version: string;
  status: "qualified" | "review" | "not_qualified";
  allowedCategories: readonly string[];
  receiptRequired: boolean;
  vatRecoverability: "pending";
  evidenceRequirements: readonly string[];
  ruleReferences: readonly string[];
  rules: readonly JsonRecord[];
  sources: readonly JsonRecord[];
  retention: JsonRecord;
  unresolvedDecisions: readonly string[];
};

export const CANONICAL_EXPENSE_CATEGORIES = [
  "meal", "accommodation", "fuel", "toll", "parking", "train", "flight", "taxi",
  "ride_hailing", "public_transport", "vehicle_rental", "mileage", "per_diem",
  "telecommunications", "office_supplies", "equipment", "software", "subscriptions",
  "professional_services", "rent", "utilities", "insurance", "bank_fees",
  "representation", "training", "conference", "home_working", "miscellaneous",
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
    status: "not_qualified", allowedCategories: [], receiptRequired: true, vatRecoverability: "pending", evidenceRequirements: [reason], ruleReferences: [], rules: [], sources: [], retention: {}, unresolvedDecisions: [],
  });
  if (!country) return unqualified("country_missing");
  const result = await supabase.from("d2f_country_pack_versions")
    .select("pack_id,pack_version,status,manifest,effective_from,effective_to")
    .eq("country", country).in("status", ["published","regulatory_review","technical_review","security_review","approved"]).order("effective_from", { ascending: false }).limit(20);
  if (result.error) {
    if (missingRegistry(result.error)) return unqualified("registry_not_initialized");
    throw new Error("Le registre Country Pack est indisponible");
  }
  const now = new Date().toISOString();
  const candidates = (result.data || []).filter((candidate) => {
    const manifest = object(candidate.manifest);
    const capabilities = object(manifest.capabilities);
    const isExpensesPack = String(candidate.pack_id || "").endsWith(".expenses") || manifest.module === "expenses" || Boolean(manifest.expense) || Boolean(capabilities.expense);
    return isExpensesPack && (!candidate.effective_from || candidate.effective_from <= now) && (!candidate.effective_to || candidate.effective_to > now);
  });
  const row = candidates.find((candidate) => candidate.status === "published") || candidates[0];
  if (!row) return unqualified("no_published_pack");
  const manifest = object(row.manifest);
  const expense = object(manifest.expense || object(manifest.capabilities).expense);
  const categories = Array.isArray(expense.allowedCategories)
    ? expense.allowedCategories.map(String).filter((value) => (CANONICAL_EXPENSE_CATEGORIES as readonly string[]).includes(value))
    : [];
  if (!categories.length) return unqualified("expense_scope_missing");
  return {
    country, packId: String(row.pack_id), version: String(row.pack_version), status: row.status === "published" ? "qualified" : "review", allowedCategories: categories,
    receiptRequired: expense.receiptRequiredDefault !== false, vatRecoverability: "pending",
    evidenceRequirements: Array.isArray(expense.evidenceRequirements) ? expense.evidenceRequirements.map(String) : [],
    ruleReferences: Array.isArray(expense.ruleReferences) ? expense.ruleReferences.map(String) : [],
    rules: Array.isArray(expense.rules) ? expense.rules.map(object) : [],
    sources: Array.isArray(manifest.sources) ? manifest.sources.map(object) : [],
    retention: object(manifest.retention),
    unresolvedDecisions: Array.isArray(manifest.unresolvedDecisions) ? manifest.unresolvedDecisions.map(String) : [],
  };
}

export function evaluateExpenseLine(policy: ExpenseCountryPolicy, input: JsonRecord) {
  if (policy.status === "not_qualified") throw new Error("Les règles de notes de frais ne sont pas qualifiées pour le pays " + policy.country);
  const category = String(input.category || "miscellaneous").trim().toLowerCase();
  if (!policy.allowedCategories.includes(category)) throw new Error("Catégorie non couverte par le Country Pack " + policy.country + " version " + policy.version);
  const paymentMethod = String(input.paymentMethod || input.payment_method || "");
  const cashPayment = paymentMethod.includes("cash");
  const applicableRules = policy.rules.filter((rule) => {
    const target = rule.category;
    return target === "*" || target === category || (Array.isArray(target) && target.map(String).includes(category));
  });
  const missingContext = [...new Set(applicableRules.flatMap((rule) => Array.isArray(rule.requirements) ? rule.requirements.map(String) : []).filter((field) => input[field] == null || input[field] === ""))];
  const traceabilityBlocked = applicableRules.some((rule) => rule.kind === "payment_traceability") && cashPayment;
  const manualReview = applicableRules.some((rule) => rule.kind === "vat_treatment" || rule.effect === "manual_review");
  const decision = traceabilityBlocked ? "blocked" : (policy.status !== "qualified" || missingContext.length || manualReview ? "incomplete" : "qualified");
  return {
    category, receiptRequired: policy.receiptRequired, vatRecoverability: policy.vatRecoverability,
    policyResult: {
      status: policy.status, packId: policy.packId, packVersion: policy.version, establishmentCountry: policy.country,
      taxDecision: decision, reimbursementDecision: decision === "blocked" ? "manual_review_required" : "policy_evaluated",
      applicableRules: applicableRules.map((rule) => ({ id: rule.id, kind: rule.kind, effect: rule.effect, limit: rule.limit || null, sourceIds: rule.sourceIds || [] })),
      missingContext, findings: [...(traceabilityBlocked ? ["non_traceable_payment"] : []), ...(manualReview ? ["vat_manual_review"] : [])],
      evidenceRequirements: policy.evidenceRequirements, ruleReferences: policy.ruleReferences, evaluatedAt: new Date().toISOString(),
    },
  };
}
