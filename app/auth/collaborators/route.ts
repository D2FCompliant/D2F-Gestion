import { readAppSession, safeOrigin } from "../../../lib/auth/server";
import { getAccountById, inviteCollaborator, memberFor } from "../../../lib/saas/accounts";
import { json, messageFromError, publicAccount } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await readAppSession(request);
  if (!session) return json("Session expirée", 401);
  const account = await getAccountById(session.tenantId);
  if (!account) return json("Entreprise introuvable", 404);
  return json(publicAccount(account, session.userId, session.email));
}

export async function POST(request: Request) {
  try {
    const session = await readAppSession(request);
    if (!session) return json("Session expirée", 401);
    const account = await getAccountById(session.tenantId);
    if (!account) return json("Entreprise introuvable", 404);
    const actor = memberFor(account, session.userId, session.email);
    if (!actor) return json("Accès révoqué", 403);
    const body = await request.json() as Record<string, unknown>;
    const updated = await inviteCollaborator(account, actor, {
      email: String(body.email || ""),
      fullName: String(body.fullName || ""),
      redirectTo: safeOrigin(request),
    });
    return json(publicAccount(updated, session.userId, session.email));
  } catch (error) {
    return json(messageFromError(error, "Invitation impossible"), 400);
  }
}
