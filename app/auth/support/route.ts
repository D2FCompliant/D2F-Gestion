import { readAppSession } from "../../../lib/auth/server";
import { getAccountById, memberFor } from "../../../lib/saas/accounts";
import { addSupportMessage, createSupportTicket, listSupport, updateSupportStatus } from "../../../lib/support";
import { json, messageFromError } from "../_shared";

export const dynamic = "force-dynamic";

async function context(request: Request) {
  const session = await readAppSession(request);
  if (!session) return null;
  const account = await getAccountById(session.tenantId);
  if (!account || !memberFor(account, session.userId, session.email)) return null;
  return { session, account };
}

export async function GET(request: Request) {
  try {
    const current = await context(request);
    if (!current) return json("Session expirée", 401);
    return json(await listSupport(current.session));
  } catch (error) {
    return json(messageFromError(error, "Chargement du support impossible"), 400);
  }
}

export async function POST(request: Request) {
  try {
    const current = await context(request);
    if (!current) return json("Session expirée", 401);
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "reply") return json(await addSupportMessage(current.session, body));
    return json(await createSupportTicket(current.session, current.account, body));
  } catch (error) {
    return json(messageFromError(error, "Création du ticket impossible"), 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const current = await context(request);
    if (!current) return json("Session expirée", 401);
    const body = await request.json() as Record<string, unknown>;
    return json(await updateSupportStatus(current.session, body));
  } catch (error) {
    return json(messageFromError(error, "Mise à jour du ticket impossible"), 400);
  }
}
