import { signUpWithPassword, isPlatformAdminEmail, normalizedEmail, safeOrigin } from "../../../lib/auth/server";
import { createTenantAccount } from "../../../lib/saas/accounts";
import { getSupabaseAdmin } from "../../../lib/supabase/server";
import { json, messageFromError, sessionResponse } from "../_shared";

export const dynamic = "force-dynamic";

function text(value: unknown, max = 160) {
  return String(value || "").trim().slice(0, max);
}

export async function POST(request: Request) {
  let createdUserId = "";
  try {
    const body = await request.json() as Record<string, unknown>;
    if (text(body.website)) return json({ submitted: true });
    const email = normalizedEmail(body.email);
    const password = String(body.password || "");
    const fullName = text(body.fullName);
    const companyName = text(body.companyName);
    const companyIdentifier = text(body.companyIdentifier, 64);
    const country = text(body.country || "FR", 2).toUpperCase();
    const payerName = text(body.payerName || companyName);
    if (!email.includes("@") || email.length > 254) return json("Adresse e-mail invalide", 400);
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      return json("Le mot de passe doit contenir au moins 12 caractères, une majuscule, une minuscule et un chiffre", 400);
    }
    if (fullName.length < 2 || companyName.length < 2 || companyIdentifier.length < 3) return json("Informations entreprise incomplètes", 400);
    if (body.acceptTerms !== true) return json("Vous devez accepter les conditions d’utilisation et la politique de confidentialité", 400);
    if (!isPlatformAdminEmail(email) && body.acceptPaymentTerms !== true) return json("Vous devez confirmer que l’accès sera activé uniquement après validation du paiement", 400);
    const signup = await signUpWithPassword({
      email,
      password,
      fullName,
      companyName,
      redirectTo: safeOrigin(request),
    });
    createdUserId = signup.user.id;
    const account = await createTenantAccount({ user: signup.user, fullName, companyName, companyIdentifier, country, payerName });
    if (signup.session) return sessionResponse(request, signup.user, account);
    return json({
      requiresEmailConfirmation: true,
      message: account.plan === "lifetime"
        ? "Compte D2F créé. Consultez votre e-mail pour confirmer l’accès, puis connectez-vous."
        : "Entreprise créée, mais l’application reste verrouillée. Confirmez votre e-mail, connectez-vous au portail de règlement, puis déclarez le virement effectué.",
      bankTransferReference: account.subscription.bankTransferReference,
      subscriptionStatus: account.status,
    });
  } catch (error) {
    if (createdUserId) await getSupabaseAdmin().auth.admin.deleteUser(createdUserId).catch(() => {});
    return json(messageFromError(error, "Inscription impossible"), 400);
  }
}
