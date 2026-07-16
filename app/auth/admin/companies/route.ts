import { isPlatformAdminEmail, readAppSession } from "../../../../lib/auth/server";
import { listTenantAccounts, setTenantSubscriptionStatus } from "../../../../lib/saas/accounts";
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
    plan: account.plan,
    members: account.members.length,
    amountEur: account.subscription.amountEur,
    payerName: account.subscription.payerName,
    transferReference: account.subscription.customerTransferReference,
    paidOn: account.subscription.paidOn,
    createdAt: account.createdAt,
  })));
}

export async function PATCH(request: Request) {
  try {
    const session = await readAppSession(request);
    if (!session || !authorized(session.email)) return json("Accès administrateur requis", 403);
    const body = await request.json() as Record<string, unknown>;
    const status = body.status === "suspended" ? "suspended" : "active";
    const account = await setTenantSubscriptionStatus(String(body.tenantId || ""), status);
    return json({ id: account.id, status: account.status });
  } catch (error) {
    return json(messageFromError(error, "Mise à jour impossible"), 400);
  }
}
