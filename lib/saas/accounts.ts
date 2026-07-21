import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../supabase/server";
import { isPlatformAdminEmail, normalizedEmail, publicBillingConfig } from "../auth/server";
import { normalizeEstablishmentIdentifier, validateEstablishmentIdentifier } from "../company-identifiers";
import { generateSubscriptionInvoice, type SubscriptionInvoiceReference } from "./billing";

type JsonRecord = Record<string, unknown>;
export type MemberRole = "owner" | "collaborator";
export type SubscriptionStatus = "lifetime" | "pending_payment" | "payment_declared" | "active" | "suspended";

export type TenantMember = {
  userId: string;
  email: string;
  fullName: string;
  role: MemberRole;
  status: "active" | "invited";
};

export type BillingProfile = {
  legalName: string;
  legalIdentifier: string;
  vatId: string;
  street: string;
  street2: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
};

export type TenantAccount = {
  id: string;
  name: string;
  companyIdentifier: string;
  country: string;
  ownerKey: string;
  plan: "monthly" | "lifetime";
  seatLimit: number;
  status: SubscriptionStatus;
  members: TenantMember[];
  billingProfile: BillingProfile;
  subscription: {
    status: SubscriptionStatus;
    billingCycle: "monthly" | "lifetime";
    amountEur: number | null;
    currency: "EUR";
    paymentMethod: "bank_transfer" | "none";
    bankTransferReference: string;
    payerName: string;
    customerTransferReference: string;
    paidOn: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  };
  createdAt: string;
  updatedAt: string;
};

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function billingProfile(value: unknown, defaults: Partial<BillingProfile> = {}): BillingProfile {
  const profile = object(value);
  return {
    legalName: stringValue(profile.legalName || profile.legal_name || defaults.legalName),
    legalIdentifier: stringValue(profile.legalIdentifier || profile.legal_identifier || profile.legal_id || defaults.legalIdentifier),
    vatId: stringValue(profile.vatId || profile.vat_id || defaults.vatId),
    street: stringValue(profile.street || profile.address || defaults.street),
    street2: stringValue(profile.street2 || profile.address2 || profile.address_line_2 || defaults.street2),
    postalCode: stringValue(profile.postalCode || profile.postal_code || profile.postal || defaults.postalCode),
    city: stringValue(profile.city || defaults.city),
    country: stringValue(profile.country || defaults.country).toUpperCase().slice(0, 2),
    email: normalizedEmail(profile.email || defaults.email),
  };
}

function d2fDataOwnerKey() {
  return normalizedEmail(process.env.D2F_DATA_OWNER_KEY || process.env.D2F_OWNER_EMAIL);
}

function missingAccountTable(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || (error.code === "PGRST204" && /identifier_type/i.test(error.message || "")) || /d2f_(tenants|tenant_members|subscriptions).*not find|relation .*d2f_/i.test(error.message || "")));
}

export function normalizeCompanyIdentifier(value: unknown) {
  return normalizeEstablishmentIdentifier("OT", value);
}

export const TRIAL_REQUEST_REFERENCE = "D2F_TRIAL_REQUEST";
const TRIAL_DAYS = 14;

function transferReference(tenantId: string) {
  return `D2F-${new Date().getUTCFullYear()}-${tenantId.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function isoDate(value: unknown) {
  return stringValue(value).slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addUtcMonth(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

function addUtcYear(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const month = date.getUTCMonth();
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  if (date.getUTCMonth() !== month) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function addUtcDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function accountTrialRequested(account: TenantAccount) {
  return Boolean(account.plan === "monthly" && !account.subscription.currentPeriodEnd && account.subscription.customerTransferReference === TRIAL_REQUEST_REFERENCE);
}

export function accountBillingTerm(account: TenantAccount): "monthly" | "annual" | "lifetime" {
  if (account.plan === "lifetime") return "lifetime";
  const annualAmount = publicBillingConfig().annualAmountEur;
  return annualAmount && account.subscription.amountEur != null && Math.abs(account.subscription.amountEur - annualAmount) < 0.01 ? "annual" : "monthly";
}

export function accountTrialEndsAt(account: TenantAccount) {
  if (account.plan !== "monthly" || !account.subscription.currentPeriodStart || !account.subscription.currentPeriodEnd) return "";
  const start = new Date(`${account.subscription.currentPeriodStart}T00:00:00.000Z`).getTime();
  const end = new Date(`${account.subscription.currentPeriodEnd}T00:00:00.000Z`).getTime();
  const inclusiveDays = Math.round((end - start) / 86400000) + 1;
  const explicitTrial = account.subscription.customerTransferReference === TRIAL_REQUEST_REFERENCE;
  return explicitTrial || inclusiveDays === TRIAL_DAYS ? account.subscription.currentPeriodEnd : "";
}

export function accountIsTrial(account: TenantAccount) {
  const trialEndsAt = accountTrialEndsAt(account);
  return Boolean(account.status === "active" && trialEndsAt && trialEndsAt >= todayIso());
}

function accountWithEffectivePeriod(account: TenantAccount) {
  if (account.plan !== "monthly" || account.status !== "active" || !account.subscription.currentPeriodEnd) return account;
  if (account.subscription.currentPeriodEnd >= todayIso()) return account;
  const status: SubscriptionStatus = account.subscription.status === "payment_declared" ? "payment_declared" : "pending_payment";
  return {
    ...account,
    status,
    subscription: { ...account.subscription, status },
  };
}

function accountFromFallback(ownerKey: string, raw: unknown, rawCompany: unknown = {}): TenantAccount | null {
  const value = object(raw);
  const company = object(rawCompany);
  if (!value.id) return null;
  const subscription = object(value.subscription);
  const members = Array.isArray(value.members) ? value.members.map((item) => {
    const member = object(item);
    return {
      userId: stringValue(member.userId || member.user_id),
      email: normalizedEmail(member.email),
      fullName: stringValue(member.fullName || member.full_name),
      role: member.role === "owner" ? "owner" as const : "collaborator" as const,
      status: member.status === "invited" ? "invited" as const : "active" as const,
    };
  }) : [];
  const status = stringValue(value.status || subscription.status || "pending_payment") as SubscriptionStatus;
  return accountWithEffectivePeriod({
    id: stringValue(value.id),
    name: stringValue(value.name),
    companyIdentifier: stringValue(value.companyIdentifier || value.company_identifier),
    country: stringValue(value.country || "FR"),
    ownerKey,
    plan: value.plan === "lifetime" ? "lifetime" : "monthly",
    seatLimit: numberValue(value.seatLimit || value.seat_limit) || 2,
    status,
    members,
    billingProfile: billingProfile(value.billingProfile || value.billing_profile || company, {
      legalName: stringValue(value.name),
      legalIdentifier: stringValue(value.companyIdentifier || value.company_identifier),
      country: stringValue(value.country || "FR"),
      email: members.find((member) => member.role === "owner")?.email || "",
    }),
    subscription: {
      status: stringValue(subscription.status || status) as SubscriptionStatus,
      billingCycle: subscription.billingCycle === "lifetime" || subscription.billing_cycle === "lifetime" ? "lifetime" : "monthly",
      amountEur: subscription.amountEur == null && subscription.amount_eur == null ? null : numberValue(subscription.amountEur ?? subscription.amount_eur),
      currency: "EUR",
      paymentMethod: subscription.paymentMethod === "none" || subscription.payment_method === "none" ? "none" : "bank_transfer",
      bankTransferReference: stringValue(subscription.bankTransferReference || subscription.bank_transfer_reference),
      payerName: stringValue(subscription.payerName || subscription.payer_name),
      customerTransferReference: stringValue(subscription.customerTransferReference || subscription.customer_transfer_reference),
      paidOn: stringValue(subscription.paidOn || subscription.paid_on),
      currentPeriodStart: isoDate(subscription.currentPeriodStart || subscription.current_period_start),
      currentPeriodEnd: isoDate(subscription.currentPeriodEnd || subscription.current_period_end),
    },
    createdAt: stringValue(value.createdAt || value.created_at),
    updatedAt: stringValue(value.updatedAt || value.updated_at),
  });
}

function fallbackShape(account: TenantAccount) {
  return account;
}

async function fallbackAccounts(supabase: SupabaseClient) {
  const { data, error } = await supabase.from("d2f_company").select("owner_email,data").limit(2000);
  if (error) throw error;
  return (data || []).map((row) => accountFromFallback(String(row.owner_email), object(row.data)._saas_account, row.data)).filter(Boolean) as TenantAccount[];
}

async function saveFallbackAccount(supabase: SupabaseClient, account: TenantAccount) {
  const { data: existing, error: readError } = await supabase.from("d2f_company").select("data").eq("owner_email", account.ownerKey).maybeSingle();
  if (readError) throw readError;
  const company = object(existing?.data);
  const { error } = await supabase.from("d2f_company").upsert({
    owner_email: account.ownerKey,
    data: {
      ...company,
      legal_name: stringValue(company.legal_name) || account.name,
      legal_id: stringValue(company.legal_id) || account.companyIdentifier,
      country: stringValue(company.country) || account.country,
      currency: stringValue(company.currency) || "EUR",
      email: stringValue(company.email) || account.billingProfile.email || account.members.find((member) => member.role === "owner")?.email || "",
      street: stringValue(company.street) || account.billingProfile.street,
      street2: stringValue(company.street2) || account.billingProfile.street2,
      postal_code: stringValue(company.postal_code || company.postal) || account.billingProfile.postalCode,
      city: stringValue(company.city) || account.billingProfile.city,
      vat_id: stringValue(company.vat_id) || account.billingProfile.vatId,
      _saas_account: fallbackShape(account),
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_email" });
  if (error) throw error;
}

async function prefillCompanyProfile(supabase: SupabaseClient, account: TenantAccount, email: string) {
  const { data: existing, error: readError } = await supabase.from("d2f_company").select("data").eq("owner_email", account.ownerKey).maybeSingle();
  if (readError) throw readError;
  const current = object(existing?.data);
  const { error } = await supabase.from("d2f_company").upsert({
    owner_email: account.ownerKey,
    data: {
      ...current,
      legal_name: stringValue(current.legal_name) || account.name,
      legal_id: stringValue(current.legal_id) || account.companyIdentifier,
      country: stringValue(current.country) || account.country,
      currency: stringValue(current.currency) || "EUR",
      email: stringValue(current.email) || account.billingProfile.email || email,
      street: stringValue(current.street) || account.billingProfile.street,
      street2: stringValue(current.street2) || account.billingProfile.street2,
      postal_code: stringValue(current.postal_code || current.postal) || account.billingProfile.postalCode,
      city: stringValue(current.city) || account.billingProfile.city,
      vat_id: stringValue(current.vat_id) || account.billingProfile.vatId,
    },
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_email" });
  if (error) throw error;
}

async function dedicatedAccount(supabase: SupabaseClient, tenantId: string): Promise<TenantAccount | null> {
  const { data: tenant, error } = await supabase.from("d2f_tenants").select("*").eq("id", tenantId).maybeSingle();
  if (error) {
    if (missingAccountTable(error)) return null;
    throw error;
  }
  if (!tenant) return null;
  const [{ data: members, error: memberError }, { data: subscription, error: subscriptionError }, { data: companyRow, error: companyError }] = await Promise.all([
    supabase.from("d2f_tenant_members").select("user_id,email,full_name,role,status").eq("tenant_id", tenantId).order("created_at"),
    supabase.from("d2f_subscriptions").select("*").eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("d2f_company").select("data").eq("owner_email", String(tenant.owner_key)).maybeSingle(),
  ]);
  if (memberError) throw memberError;
  if (subscriptionError) throw subscriptionError;
  if (companyError) throw companyError;
  const status = stringValue(tenant.status || subscription?.status || "pending_payment") as SubscriptionStatus;
  return accountWithEffectivePeriod({
    id: String(tenant.id),
    name: stringValue(tenant.name),
    companyIdentifier: stringValue(tenant.company_identifier),
    country: stringValue(tenant.country || "FR"),
    ownerKey: stringValue(tenant.owner_key),
    plan: tenant.plan_code === "lifetime" ? "lifetime" : "monthly",
    seatLimit: numberValue(tenant.seat_limit) || 2,
    status,
    members: (members || []).map((member) => ({
      userId: stringValue(member.user_id),
      email: normalizedEmail(member.email),
      fullName: stringValue(member.full_name),
      role: member.role === "owner" ? "owner" : "collaborator",
      status: member.status === "invited" ? "invited" : "active",
    })),
    billingProfile: billingProfile(companyRow?.data, {
      legalName: stringValue(tenant.name),
      legalIdentifier: stringValue(tenant.company_identifier),
      country: stringValue(tenant.country || "FR"),
      email: normalizedEmail((members || []).find((member) => member.role === "owner")?.email),
    }),
    subscription: {
      status: stringValue(subscription?.status || status) as SubscriptionStatus,
      billingCycle: subscription?.billing_cycle === "lifetime" ? "lifetime" : "monthly",
      amountEur: subscription?.amount_eur == null ? null : numberValue(subscription.amount_eur),
      currency: "EUR",
      paymentMethod: subscription?.payment_method === "none" ? "none" : "bank_transfer",
      bankTransferReference: stringValue(subscription?.bank_transfer_reference),
      payerName: stringValue(subscription?.payer_name),
      customerTransferReference: stringValue(subscription?.customer_transfer_reference),
      paidOn: stringValue(subscription?.paid_on),
      currentPeriodStart: isoDate(subscription?.current_period_start),
      currentPeriodEnd: isoDate(subscription?.current_period_end),
    },
    createdAt: stringValue(tenant.created_at),
    updatedAt: stringValue(tenant.updated_at),
  });
}

export async function findAccountForUser(userId: string, email: string) {
  const supabase = getSupabaseAdmin();
  const { data: userMembership, error: userError } = await supabase.from("d2f_tenant_members").select("tenant_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!userError && userMembership?.tenant_id) return dedicatedAccount(supabase, String(userMembership.tenant_id));
  if (userError && !missingAccountTable(userError)) throw userError;

  if (!userError) {
    const { data: emailMembership, error: emailError } = await supabase.from("d2f_tenant_members").select("tenant_id").eq("email", normalizedEmail(email)).limit(1).maybeSingle();
    if (!emailError && emailMembership?.tenant_id) return dedicatedAccount(supabase, String(emailMembership.tenant_id));
    if (emailError && !missingAccountTable(emailError)) throw emailError;
  }
  const accounts = await fallbackAccounts(supabase);
  return accounts.find((account) => account.members.some((member) => member.userId === userId || member.email === normalizedEmail(email))) || null;
}

export async function getAccountById(tenantId: string) {
  const supabase = getSupabaseAdmin();
  const dedicated = await dedicatedAccount(supabase, tenantId);
  if (dedicated) return dedicated;
  return (await fallbackAccounts(supabase)).find((account) => account.id === tenantId) || null;
}

export async function createTenantAccount(input: {
  user: User;
  fullName: string;
  companyName: string;
  companyIdentifier: string;
  country: string;
  payerName: string;
  billingTerm?: "monthly" | "annual";
  billingProfile?: Partial<BillingProfile>;
}) {
  const supabase = getSupabaseAdmin();
  const email = normalizedEmail(input.user.email);
  const identity = validateEstablishmentIdentifier(input.country, input.companyIdentifier);
  const companyIdentifier = identity.identifier;
  const country = identity.country;
  const existingForUser = await findAccountForUser(input.user.id, email);
  if (existingForUser) return existingForUser;
  const { data: matchingTenant, error: matchError } = await supabase.from("d2f_tenants").select("id").eq("country", country).eq("company_identifier", companyIdentifier).maybeSingle();
  if (!matchError && matchingTenant) throw new Error("Cet identifiant entreprise est déjà enregistré");
  if (matchError && !missingAccountTable(matchError)) throw matchError;
  if ((await fallbackAccounts(supabase)).some((account) => account.country.toUpperCase() === country && account.companyIdentifier === companyIdentifier)) {
    throw new Error("Cet identifiant entreprise est déjà enregistré");
  }

  const tenantId = crypto.randomUUID();
  const lifetime = isPlatformAdminEmail(email);
  const ownerKey = lifetime ? d2fDataOwnerKey() : `tenant:${tenantId}`;
  const now = new Date().toISOString();
  const status: SubscriptionStatus = lifetime ? "lifetime" : "pending_payment";
  const billing = publicBillingConfig();
  const billingTerm = input.billingTerm === "annual" ? "annual" : "monthly";
  const account: TenantAccount = {
    id: tenantId,
    name: stringValue(input.companyName),
    companyIdentifier,
    country,
    ownerKey,
    plan: lifetime ? "lifetime" : "monthly",
    seatLimit: 2,
    status,
    members: [{ userId: input.user.id, email, fullName: stringValue(input.fullName), role: "owner", status: "active" }],
    billingProfile: billingProfile(input.billingProfile, {
      legalName: stringValue(input.companyName),
      legalIdentifier: companyIdentifier,
      country,
      email,
    }),
    subscription: {
      status,
      billingCycle: lifetime ? "lifetime" : "monthly",
      amountEur: lifetime ? 0 : billingTerm === "annual" ? billing.annualAmountEur : billing.amountEur,
      currency: "EUR",
      paymentMethod: lifetime ? "none" : "bank_transfer",
      bankTransferReference: lifetime ? "" : transferReference(tenantId),
      payerName: stringValue(input.payerName || input.companyName),
      customerTransferReference: "",
      paidOn: "",
      currentPeriodStart: "",
      currentPeriodEnd: "",
    },
    createdAt: now,
    updatedAt: now,
  };

  const { error: tenantError } = await supabase.from("d2f_tenants").insert({
    id: tenantId,
    company_identifier: account.companyIdentifier,
    identifier_type: identity.identifierType,
    name: account.name,
    country: account.country,
    owner_key: ownerKey,
    plan_code: account.plan,
    seat_limit: account.seatLimit,
    status,
  });
  if (tenantError) {
    if (!missingAccountTable(tenantError)) throw tenantError;
    await saveFallbackAccount(supabase, account);
    return account;
  }
  const [{ error: memberError }, { error: subscriptionError }] = await Promise.all([
    supabase.from("d2f_tenant_members").insert({ tenant_id: tenantId, user_id: input.user.id, email, full_name: input.fullName, role: "owner", status: "active" }),
    supabase.from("d2f_subscriptions").insert({
      tenant_id: tenantId,
      billing_cycle: account.subscription.billingCycle,
      amount_eur: account.subscription.amountEur,
      currency: "EUR",
      payment_method: account.subscription.paymentMethod,
      bank_transfer_reference: account.subscription.bankTransferReference,
      payer_name: account.subscription.payerName,
      status,
    }),
  ]);
  if (memberError) throw memberError;
  if (subscriptionError) throw subscriptionError;
  try {
    await prefillCompanyProfile(supabase, account, email);
  } catch (error) {
    await supabase.from("d2f_tenants").delete().eq("id", tenantId);
    throw error;
  }
  return account;
}

export async function ensureD2FLifetimeAccount(user: User) {
  const existing = await findAccountForUser(user.id, normalizedEmail(user.email));
  if (existing) return existing;
  if (!isPlatformAdminEmail(normalizedEmail(user.email))) return null;
  const ownerKey = d2fDataOwnerKey();
  const { data } = await getSupabaseAdmin().from("d2f_company").select("data").eq("owner_email", ownerKey).maybeSingle();
  const company = object(data?.data);
  return createTenantAccount({
    user,
    fullName: stringValue(object(user.user_metadata).full_name || user.email),
    companyName: stringValue(company.legal_name || company.name || "D2F Compliant d.o.o."),
    companyIdentifier: stringValue(company.legal_id || company.vat_id || `D2F-${user.id.slice(0, 8)}`),
    country: stringValue(company.country || "RS"),
    payerName: "D2F Compliant d.o.o.",
  });
}

export function accountAllowsApplication(account: TenantAccount) {
  if (account.status === "lifetime") return true;
  if (account.status !== "active") return false;
  return Boolean(account.subscription.currentPeriodStart && account.subscription.currentPeriodEnd && account.subscription.currentPeriodEnd >= todayIso());
}

export function accountCanReactivate(account: TenantAccount) {
  return Boolean(account.plan === "monthly" && account.status === "suspended" && account.subscription.currentPeriodStart && account.subscription.currentPeriodEnd && account.subscription.currentPeriodEnd >= todayIso());
}

export function memberFor(account: TenantAccount, userId: string, email: string) {
  return account.members.find((member) => member.userId === userId || member.email === normalizedEmail(email)) || null;
}

export async function inviteCollaborator(account: TenantAccount, actor: TenantMember, input: { email: string; fullName: string; redirectTo: string }) {
  if (actor.role !== "owner") throw new Error("Seul le propriétaire peut inviter un collaborateur");
  if (!accountAllowsApplication(account)) throw new Error("L’abonnement doit être actif avant d’inviter un collaborateur");
  const email = normalizedEmail(input.email);
  if (!email || !email.includes("@")) throw new Error("Adresse e-mail invalide");
  if (account.members.some((member) => member.email === email)) throw new Error("Cette personne appartient déjà à l’entreprise");
  if (account.members.length >= account.seatLimit) throw new Error(`La formule inclut ${account.seatLimit} utilisateurs maximum`);
  const { data, error } = await getSupabaseAdmin().auth.admin.inviteUserByEmail(email, {
    data: { full_name: stringValue(input.fullName), tenant_id: account.id },
    redirectTo: input.redirectTo,
  });
  if (error || !data.user) throw new Error(error?.message || "Invitation impossible");
  const member: TenantMember = { userId: data.user.id, email, fullName: stringValue(input.fullName), role: "collaborator", status: "invited" };
  const supabase = getSupabaseAdmin();
  const { error: insertError } = await supabase.from("d2f_tenant_members").insert({ tenant_id: account.id, user_id: member.userId, email, full_name: member.fullName, role: "collaborator", status: "invited" });
  if (insertError) {
    if (!missingAccountTable(insertError)) throw insertError;
    const updated = { ...account, members: [...account.members, member], updatedAt: new Date().toISOString() };
    await saveFallbackAccount(supabase, updated);
    return updated;
  }
  return (await getAccountById(account.id)) || account;
}

export async function requestTrialAccess(account: TenantAccount, actor: TenantMember) {
  if (actor.role !== "owner") throw new Error("Seul le propriétaire peut demander une période d’essai");
  if (account.plan === "lifetime") return account;
  if (account.subscription.currentPeriodEnd) throw new Error("La période d’essai a déjà été utilisée pour cette entreprise");
  const existingReference = account.subscription.customerTransferReference;
  if ((existingReference && existingReference !== TRIAL_REQUEST_REFERENCE) || account.subscription.paidOn) throw new Error("Un paiement est déjà en cours de traitement");
  if (accountTrialRequested(account)) return account;
  const status: SubscriptionStatus = "pending_payment";
  const updated: TenantAccount = {
    ...account,
    status,
    subscription: { ...account.subscription, status, customerTransferReference: TRIAL_REQUEST_REFERENCE, paidOn: "" },
    updatedAt: new Date().toISOString(),
  };
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("d2f_subscriptions").update({
    status,
    customer_transfer_reference: TRIAL_REQUEST_REFERENCE,
    paid_on: null,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", account.id);
  if (error) {
    if (!missingAccountTable(error)) throw error;
    await saveFallbackAccount(supabase, updated);
    return updated;
  }
  await supabase.from("d2f_tenants").update({ status, updated_at: new Date().toISOString() }).eq("id", account.id);
  return (await getAccountById(account.id)) || updated;
}

export async function selectBillingTerm(account: TenantAccount, actor: TenantMember, billingTerm: "monthly" | "annual") {
  if (actor.role !== "owner") throw new Error("Seul le propriétaire peut choisir la formule");
  if (account.plan === "lifetime") return account;
  const reference = account.subscription.customerTransferReference;
  if (account.subscription.status === "payment_declared" || account.subscription.paidOn || (reference && reference !== TRIAL_REQUEST_REFERENCE)) {
    throw new Error("La formule ne peut plus être modifiée après déclaration du virement");
  }
  const billing = publicBillingConfig();
  const amountEur = billingTerm === "annual" ? billing.annualAmountEur : billing.amountEur;
  const updated: TenantAccount = { ...account, subscription: { ...account.subscription, amountEur }, updatedAt: new Date().toISOString() };
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("d2f_subscriptions").update({ amount_eur: amountEur, updated_at: new Date().toISOString() }).eq("tenant_id", account.id);
  if (error) {
    if (!missingAccountTable(error)) throw error;
    await saveFallbackAccount(supabase, updated);
    return updated;
  }
  return (await getAccountById(account.id)) || updated;
}

export function accountBillingProfileComplete(account: TenantAccount) {
  const profile = account.billingProfile;
  return Boolean(profile.legalName && profile.legalIdentifier && profile.street && profile.postalCode && profile.city && profile.country && profile.email);
}

export async function updateBillingProfile(account: TenantAccount, actor: TenantMember, input: Partial<BillingProfile>) {
  if (actor.role !== "owner") throw new Error("Seul le propriétaire peut modifier les coordonnées de facturation");
  const profile = billingProfile(input, account.billingProfile);
  profile.legalIdentifier = account.companyIdentifier;
  profile.country = account.country;
  if (profile.legalName.length < 2 || profile.street.length < 3 || profile.postalCode.length < 2 || profile.city.length < 2 || !profile.email.includes("@")) {
    throw new Error("Renseignez la raison sociale, l’adresse, le code postal, la ville et l’e-mail de facturation");
  }
  const updated: TenantAccount = { ...account, billingProfile: profile, updatedAt: new Date().toISOString() };
  const supabase = getSupabaseAdmin();
  const { data: existing, error: readError } = await supabase.from("d2f_company").select("data").eq("owner_email", account.ownerKey).maybeSingle();
  if (readError) throw readError;
  const company = object(existing?.data);
  const { error } = await supabase.from("d2f_company").upsert({
    owner_email: account.ownerKey,
    data: {
      ...company,
      legal_name: profile.legalName,
      legal_id: profile.legalIdentifier,
      vat_id: profile.vatId,
      street: profile.street,
      street2: profile.street2,
      postal_code: profile.postalCode,
      city: profile.city,
      country: profile.country,
      email: profile.email,
      ...(company._saas_account ? { _saas_account: fallbackShape(updated) } : {}),
    },
    updated_at: updated.updatedAt,
  }, { onConflict: "owner_email" });
  if (error) throw error;
  return (await getAccountById(account.id)) || updated;
}

export async function declareBankTransfer(account: TenantAccount, actor: TenantMember, input: { payerName: string; transferReference: string; paidOn: string }) {
  if (actor.role !== "owner") throw new Error("Seul le propriétaire peut déclarer un virement");
  if (account.plan === "lifetime") return account;
  const payerName = stringValue(input.payerName);
  const customerTransferReference = stringValue(input.transferReference).slice(0, 120);
  const paidOn = stringValue(input.paidOn).slice(0, 10);
  if (payerName.length < 2) throw new Error("Nom du payeur requis");
  if (customerTransferReference.length < 4) throw new Error("Référence bancaire invalide");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > todayIso()) throw new Error("Date d’exécution du virement invalide");
  const subscriptionStatus: SubscriptionStatus = "payment_declared";
  const status: SubscriptionStatus = accountAllowsApplication(account) ? "active" : subscriptionStatus;
  const updated: TenantAccount = {
    ...account,
    status,
    subscription: {
      ...account.subscription,
      status: subscriptionStatus,
      payerName,
      customerTransferReference,
      paidOn,
    },
    updatedAt: new Date().toISOString(),
  };
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("d2f_subscriptions").update({
    status: subscriptionStatus,
    payer_name: updated.subscription.payerName,
    customer_transfer_reference: updated.subscription.customerTransferReference,
    paid_on: updated.subscription.paidOn || null,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", account.id);
  if (error) {
    if (!missingAccountTable(error)) throw error;
    await saveFallbackAccount(supabase, updated);
    return updated;
  }
  await supabase.from("d2f_tenants").update({ status, updated_at: new Date().toISOString() }).eq("id", account.id);
  return (await getAccountById(account.id)) || updated;
}

export async function listTenantAccounts() {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("d2f_tenants").select("id").order("created_at", { ascending: false }).limit(500);
  if (error) {
    if (!missingAccountTable(error)) throw error;
    return fallbackAccounts(supabase);
  }

  const [dedicatedAccounts, legacyAccounts] = await Promise.all([
    Promise.all((data || []).map((row) => dedicatedAccount(supabase, String(row.id))))
      .then((accounts) => accounts.filter(Boolean) as TenantAccount[]),
    fallbackAccounts(supabase),
  ]);
  const knownIds = new Set(dedicatedAccounts.map((account) => account.id));
  const knownOwners = new Set(dedicatedAccounts.map((account) => normalizedEmail(account.ownerKey)).filter(Boolean));
  const knownEstablishments = new Set(dedicatedAccounts.map((account) => `${account.country.toUpperCase()}:${account.companyIdentifier}`));
  const mergedAccounts = [...dedicatedAccounts];

  for (const account of legacyAccounts) {
    const establishment = `${account.country.toUpperCase()}:${account.companyIdentifier}`;
    if (knownIds.has(account.id) || knownOwners.has(normalizedEmail(account.ownerKey)) || knownEstablishments.has(establishment)) continue;
    mergedAccounts.push(account);
  }

  return mergedAccounts.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export async function setTenantSubscriptionStatus(tenantId: string, requestedStatus: "active" | "suspended" | "trial", actorEmail = ""):
  Promise<{ account: TenantAccount; invoice: SubscriptionInvoiceReference | null }> {
  const account = await getAccountById(tenantId);
  if (!account) throw new Error("Entreprise introuvable");
  if (account.plan === "lifetime") return { account, invoice: null };
  const reactivatingExistingPeriod = requestedStatus === "active" && accountCanReactivate(account);
  if (requestedStatus === "active" && !reactivatingExistingPeriod && account.subscription.status !== "payment_declared") {
    throw new Error(account.status === "suspended"
      ? "La période accordée est expirée : un nouveau paiement doit être déclaré avant réactivation"
      : "Le client doit d’abord déclarer le paiement avant sa validation");
  }
  if (requestedStatus === "trial" && account.subscription.currentPeriodEnd) {
    throw new Error("Une période d’essai ou d’abonnement a déjà été accordée à cette entreprise");
  }

  const status: SubscriptionStatus = requestedStatus === "trial" ? "active" : requestedStatus;
  const periodStart = reactivatingExistingPeriod
    ? account.subscription.currentPeriodStart
    : status === "active"
      ? (requestedStatus === "trial" ? todayIso() : (accountAllowsApplication(account) && account.subscription.currentPeriodEnd ? addUtcDays(account.subscription.currentPeriodEnd, 1) : todayIso()))
      : account.subscription.currentPeriodStart;
  const periodEnd = reactivatingExistingPeriod
    ? account.subscription.currentPeriodEnd
    : requestedStatus === "trial"
      ? addUtcDays(periodStart, TRIAL_DAYS - 1)
      : status === "active"
        ? addUtcDays(accountBillingTerm(account) === "annual" ? addUtcYear(periodStart) : addUtcMonth(periodStart), -1)
        : account.subscription.currentPeriodEnd;
  const updated: TenantAccount = {
    ...account,
    status,
    subscription: { ...account.subscription, status, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    updatedAt: new Date().toISOString(),
  };
  const invoice = requestedStatus === "active" && !reactivatingExistingPeriod
    ? await generateSubscriptionInvoice(account, { periodStart, periodEnd, actorEmail })
    : null;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("d2f_tenants").update({ status, updated_at: new Date().toISOString() }).eq("id", tenantId);
  if (error) {
    if (!missingAccountTable(error)) throw error;
    await saveFallbackAccount(supabase, updated);
    return { account: updated, invoice };
  }
  await supabase.from("d2f_subscriptions").update({
    status,
    current_period_start: periodStart || null,
    current_period_end: periodEnd || null,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId);
  return { account: (await getAccountById(tenantId)) || updated, invoice };
}
