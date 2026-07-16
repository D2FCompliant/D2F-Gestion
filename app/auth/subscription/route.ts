import { readAppSession } from "../../../lib/auth/server";
import { declareBankTransfer, getAccountById, memberFor } from "../../../lib/saas/accounts";
import { json, messageFromError, publicAccount } from "../_shared";

export async function POST(request: Request) {
  try {
    const session = await readAppSession(request);
    if (!session) return json("Session expirée", 401);
    const account = await getAccountById(session.tenantId);
    if (!account) return json("Entreprise introuvable", 404);
    const actor = memberFor(account, session.userId, session.email);
    if (!actor) return json("Accès révoqué", 403);
    const body = await request.json() as Record<string, unknown>;
    if (body.confirmTransfer !== true) return json("Vous devez confirmer que le virement a réellement été exécuté", 400);
    const updated = await declareBankTransfer(account, actor, {
      payerName: String(body.payerName || ""),
      transferReference: String(body.transferReference || ""),
      paidOn: String(body.paidOn || ""),
    });
    return json(publicAccount(updated, session.userId, session.email));
  } catch (error) {
    return json(messageFromError(error, "Déclaration impossible"), 400);
  }
}
