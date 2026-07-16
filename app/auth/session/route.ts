import { readAppSession, renewedSession, sessionCookie } from "../../../lib/auth/server";
import { getAccountById, memberFor } from "../../../lib/saas/accounts";
import { json, publicAccount } from "../_shared";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  const session = await readAppSession(request);
  if (!session) return json("Session expirée", 401);
  const account = await getAccountById(session.tenantId);
  if (!account || !memberFor(account, session.userId, session.email)) return json("Accès entreprise révoqué", 403);
  const renewed = renewedSession({
    userId: session.userId,
    email: session.email,
    fullName: session.fullName,
    tenantId: account.id,
    ownerKey: account.ownerKey,
    role: memberFor(account, session.userId, session.email)?.role || session.role,
  });
  return json({
    user: { id: renewed.userId, email: renewed.email, fullName: renewed.fullName, role: renewed.role },
    account: publicAccount(account, renewed.userId, renewed.email),
    idleTimeoutSeconds: 30 * 60,
  }, 200, { "set-cookie": await sessionCookie(renewed, request) });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
