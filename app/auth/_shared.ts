import type { User } from "@supabase/supabase-js";
import { isPlatformAdminEmail, publicBillingConfig, renewedSession, sessionCookie, type AppSession } from "../../lib/auth/server";
import { accountAllowsApplication, accountBillingTerm, accountIsTrial, accountTrialEndsAt, accountTrialRequested, memberFor, type TenantAccount } from "../../lib/saas/accounts";

export function json(result: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(status < 400 ? { ok: true, result } : { ok: false, error: result }, {
    status,
    headers: { "cache-control": "no-store", "x-d2f-build": "2.1.4", ...headers },
  });
}

export function publicAccount(account: TenantAccount, userId: string, email: string) {
  const member = memberFor(account, userId, email);
  return {
    id: account.id,
    name: account.name,
    companyIdentifier: account.companyIdentifier,
    country: account.country,
    plan: account.plan,
    seatLimit: account.seatLimit,
    status: account.status,
    members: account.members,
    billingProfile: account.billingProfile,
    subscription: {
      ...account.subscription,
      billingTerm: accountBillingTerm(account),
      customerTransferReference: accountTrialRequested(account) ? "" : account.subscription.customerTransferReference,
    },
    role: member?.role || "collaborator",
    canUseApplication: accountAllowsApplication(account),
    isTrial: accountIsTrial(account),
    trialEndsAt: accountTrialEndsAt(account),
    trialRequested: accountTrialRequested(account),
    isPlatformAdmin: isPlatformAdminEmail(email),
    billing: publicBillingConfig(),
  };
}

export function sessionFor(user: Pick<User, "id" | "email" | "user_metadata">, account: TenantAccount): AppSession {
  const email = String(user.email || "").trim().toLowerCase();
  const member = memberFor(account, user.id, email);
  if (!member) throw new Error("Utilisateur non autorisé pour cette entreprise");
  return renewedSession({
    userId: user.id,
    email,
    fullName: member.fullName || String(user.user_metadata?.full_name || email),
    tenantId: account.id,
    ownerKey: account.ownerKey,
    role: member.role,
  });
}

export async function sessionResponse(request: Request, user: Pick<User, "id" | "email" | "user_metadata">, account: TenantAccount) {
  const session = sessionFor(user, account);
  return json({
    user: { id: session.userId, email: session.email, fullName: session.fullName, role: session.role },
    account: publicAccount(account, session.userId, session.email),
    idleTimeoutSeconds: 30 * 60,
  }, 200, { "set-cookie": await sessionCookie(session, request) });
}

export function messageFromError(error: unknown, fallback = "Une erreur est survenue") {
  return error instanceof Error ? error.message : fallback;
}
