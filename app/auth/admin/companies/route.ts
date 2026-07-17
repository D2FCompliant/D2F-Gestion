import { isPlatformAdminEmail, readAppSession } from "../../../../lib/auth/server";
import { accountBillingTerm, accountCanReactivate, accountIsTrial, accountTrialEndsAt, accountTrialRequested, listTenantAccounts, setTenantSubscriptionStatus } from "../../../../lib/saas/accounts";
import { json, messageFromError } from "../../_shared";

export const dynamic = "force-dynamic";

function authorized(email: string) {
  return isPlatformAdminEmail(email);
}

export async function GET(request: Request) {
  const session = await readAppSession(request);
  if (!session || !authorized(session.email)) return json("Accès administrateur requis", 403);
  const accounts = await listTenantAccounts();
  return json(accounts.map((account) => ({
    id: account.id,
    name: account.name,
    companyIdentifier: account.companyIdentifier,
    status: account.status,
    subscriptionStatus: account.subscription.status,
    plan: account.plan,
    members: account.members.length,
    amountEur: account.subscription.amountEur,
    payerName: account.subscription.payerName,
    transferReference: accountTrialRequested(account) ? "" : account.subscription.customerTransferReference,
    billingTerm: accountBillingTerm(account),
    trialRequested: accountTrialRequested(account),
    paidOn: account.subscription.paidOn,
    currentPeriodEnd: account.subscription.currentPeriodEnd,
    isTrial: accountIsTrial(account),
    trialEndsAt: accountTrialEndsAt(account),
    canReactivate: accountCanReactivate(account),
    reactivationKind: accountTrialEndsAt(account) ? "trial" : "paid",
    createdAt: account.createdAt,
  })));
}

export async function PATCH(request: Request) {
  try {
    const session = await readAppSession(request);
    if (!session || !authorized(session.email)) return json("Accès administrateur requis", 403);
    const body = await request.json() as Record<string, unknown>;
    const status = body.status === "suspended" ? "suspended" : body.status === "trial" ? "trial" : "active";
    const result = await setTenantSubscriptionStatus(String(body.tenantId || ""), status, session.email);
    return json({ id: result.account.id, status: result.account.status, invoice: result.invoice });
  } catch (error) {
    return json(messageFromError(error, "Mise à jour impossible"), 400);
  }
}
