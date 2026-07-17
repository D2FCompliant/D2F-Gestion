import { readAppSession } from "../../../lib/auth/server";
import { declareBankTransfer, getAccountById, memberFor, requestTrialAccess, selectBillingTerm, updateBillingProfile } from "../../../lib/saas/accounts";
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
    if (body.action === "request_trial") {
      const updated = await requestTrialAccess(account, actor);
      return json(publicAccount(updated, session.userId, session.email));
    }
    if (body.action === "select_offer") {
      const billingTerm = body.billingTerm === "annual" ? "annual" : "monthly";
      const updated = await selectBillingTerm(account, actor, billingTerm);
      return json(publicAccount(updated, session.userId, session.email));
    }
    if (body.action === "update_billing_profile") {
      const updated = await updateBillingProfile(account, actor, {
        legalName: String(body.legalName || ""),
        legalIdentifier: account.companyIdentifier,
        vatId: String(body.vatId || ""),
        street: String(body.street || ""),
        street2: String(body.street2 || ""),
        postalCode: String(body.postalCode || ""),
        city: String(body.city || ""),
        country: account.country,
        email: String(body.email || session.email),
      });
      return json(publicAccount(updated, session.userId, session.email));
    }
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
