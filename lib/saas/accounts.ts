import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../supabase/server";
import { isPlatformAdminEmail, normalizedEmail, publicBillingConfig } from "../auth/server";

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

function missingAccountTable(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /d2f_(tenants|tenant_members|subscriptions).*not find|relation .*d2f_/i.test(error.message || "")));
}

export function normalizeCompanyIdentifier(value: unknown) {
  return stringValue(value).toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9._-]/g, "").slice(0, 64);
}

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

function accountFromFallback(ownerKey: string, raw: unknown): TenantAccount | null {
  const value = object(raw);
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
  return (data || []).map((row) => accountFromFallback(String(row.owner_email), object(row.data)._saas_account)).filter(Boolean) as TenantAccount[];
}

async function saveFallbackAccount(supabase: SupabaseClient, account: TenantAccount) {
  const { data: existing, error: readError } = await supabase.from("d2f_company").select("data").eq("owner_email", account.ownerKey).maybeSingle();
  if (readError) throw readError;
  const company = object(existing?.data);
  const { error } = await supabase.from("d2f_company").upsert({
    owner_email: account.ownerKey,
    data: { ...company, _saas_account: fallbackShape(account) },
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
  const [{ data: members, error: memberError }, { data: subscription, error: subscriptionError }] = await Promise.all([
    supabase.from("d2f_tenant_members").select("user_id,email,full_name,role,status").eq("tenant_id", tenantId).order("created_at"),
    supabase.from("d2f_subscriptions").select("*").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (memberError) throw memberError;
  if (subscriptionError) throw subscriptionError;
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
}) {
  const supabase = getSupabaseAdmin();
  const email = normalizedEmail(input.user.email);
  const companyIdentifier = normalizeCompanyIdentifier(input.companyIdentifier);
  if (companyIdentifier.length < 3) throw new Error("Identifiant entreprise invalide");
  const existingForUser = await findAccountForUser(input.user.id, email);
  if (existingForUser) return existingForUser;
  const { data: matchingTenant, error: matchError } = await supabase.from("d2f_tenants").select("id").eq("company_identifier", companyIdentifier).maybeSingle();
  if (!matchError && matchingTenant) throw new Error("Cet identifiant entreprise est déjà enregistré");
  if (matchError && !missingAccountTable(matchError)) throw matchError;
  if ((await fallbackAccounts(supabase)).some((account) => account.companyIdentifier === companyIdentifier)) {
    throw new Error("Cet identifiant entreprise est déjà enregistré");
  }

  const tenantId = crypto.randomUUID();
  const lifetime = isPlatformAdminEmail(email);
  const ownerKey = lifetime ? normalizedEmail(process.env.D2F_OWNER_EMAIL) : `tenant:${tenantId}`;
  const now = new Date().toISOString();
  const status: SubscriptionStatus = lifetime ? "lifetime" : "pending_payment";
  const billing = publicBillingConfig();
  const account: TenantAccount = {
    id: tenantId,
    name: stringValue(input.companyName),
    companyIdentifier,
    country: stringValue(input.country || "FR").toUpperCase(),
    ownerKey,
    plan: lifetime ? "lifetime" : "monthly",
    seatLimit: 2,
    status,
    members: [{ userId: input.user.id, email, fullName: stringValue(input.fullName), role: "owner", status: "active" }],
    subscription: {
      status,
      billingCycle: lifetime ? "lifetime" : "monthly",
      amountEur: lifetime ? 0 : billing.amountEur,
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
  return account;
}

export async function ensureD2FLifetimeAccount(user: User) {
  const existing = await findAccountForUser(user.id, normalizedEmail(user.email));
  if (existing) return existing;
  if (!isPlatformAdminEmail(normalizedEmail(user.email))) return null;
  const ownerKey = normalizedEmail(process.env.D2F_OWNER_EMAIL);
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
  return !account.subscription.currentPeriodEnd || account.subscription.currentPeriodEnd >= todayIso();
}

export function memberFor(account: TenantAccount, userId: string, email: string) {
  return account.members.find((member) => member.userId === userId || member.email === normalizedEmail(email)) || null;
}

export async function inviteCollaborator(account: TenantAccount, actor: TenantMember, input: { email: string; fullName: string; redirectTo: string }) {
  if (actor.role !== "owner") throw new Error("Seul le propriétaire peut inviter un collaborateur");
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

export async function declareBankTransfer(account: TenantAccount, actor: TenantMember, input: { payerName: string; transferReference: string; paidOn: string }) {
  if (actor.role !== "owner") throw new Error("Seul le propriétaire peut déclarer un virement");
  if (account.plan === "lifetime") return account;
  const subscriptionStatus: SubscriptionStatus = "payment_declared";
  const status: SubscriptionStatus = accountAllowsApplication(account) ? "active" : subscriptionStatus;
  const updated: TenantAccount = {
    ...account,
    status,
    subscription: {
      ...account.subscription,
      status: subscriptionStatus,
      payerName: stringValue(input.payerName || account.subscription.payerName),
      customerTransferReference: stringValue(input.transferReference).slice(0, 120),
      paidOn: stringValue(input.paidOn).slice(0, 10),
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
  if (!error) {
    return (await Promise.all((data || []).map((row) => dedicatedAccount(supabase, String(row.id))))).filter(Boolean) as TenantAccount[];
  }
  if (!missingAccountTable(error)) throw error;
  return fallbackAccounts(supabase);
}

export async function setTenantSubscriptionStatus(tenantId: string, status: "active" | "suspended") {
  const account = await getAccountById(tenantId);
  if (!account) throw new Error("Entreprise introuvable");
  if (account.plan === "lifetime") return account;
  const periodStart = status === "active"
    ? (accountAllowsApplication(account) && account.subscription.currentPeriodEnd ? account.subscription.currentPeriodEnd : todayIso())
    : account.subscription.currentPeriodStart;
  const periodEnd = status === "active" ? addUtcMonth(periodStart) : account.subscription.currentPeriodEnd;
  const updated = {
    ...account,
    status,
    subscription: { ...account.subscription, status, currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    updatedAt: new Date().toISOString(),
  };
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("d2f_tenants").update({ status, updated_at: new Date().toISOString() }).eq("id", tenantId);
  if (error) {
    if (!missingAccountTable(error)) throw error;
    await saveFallbackAccount(supabase, updated);
    return updated;
  }
  await supabase.from("d2f_subscriptions").update({
    status,
    current_period_start: periodStart || null,
    current_period_end: periodEnd || null,
    updated_at: new Date().toISOString(),
  }).eq("tenant_id", tenantId);
  return (await getAccountById(tenantId)) || updated;
}
