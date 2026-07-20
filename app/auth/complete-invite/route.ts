import { getSupabaseAdmin } from "../../../lib/supabase/server";
import { normalizedEmail, readPasswordActivationToken, userFromAccessToken } from "../../../lib/auth/server";
import { ensureD2FLifetimeAccount, findAccountForUser } from "../../../lib/saas/accounts";
import { json, messageFromError, sessionResponse } from "../_shared";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const password = String(body.password || "");
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      return json("Le mot de passe doit contenir au moins 12 caractères, une majuscule, une minuscule et un chiffre", 400);
    }
    const admin = getSupabaseAdmin();
    const activationToken = String(body.activationToken || "");
    let user;
    let activationNonce = "";
    if (activationToken) {
      const activation = await readPasswordActivationToken(activationToken);
      const found = await admin.auth.admin.getUserById(activation.userId);
      if (found.error || !found.data.user || normalizedEmail(found.data.user.email) !== activation.email) throw new Error("Lien d’activation invalide");
      if (String(found.data.user.user_metadata?.d2f_password_activation_nonce || "") !== activation.nonce) throw new Error("Lien d’activation déjà utilisé ou remplacé");
      user = found.data.user;
      activationNonce = activation.nonce;
    } else {
      user = await userFromAccessToken(String(body.accessToken || ""));
    }
    const account = await findAccountForUser(user.id, String(user.email || "")) || await ensureD2FLifetimeAccount(user);
    if (!account) return json("Invitation sans entreprise associée", 403);
    const userMetadata = { ...(user.user_metadata || {}) };
    if (activationNonce) {
      delete userMetadata.d2f_password_activation_nonce;
      delete userMetadata.d2f_password_activation_expires_at;
    }
    const { data, error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true, user_metadata: userMetadata });
    if (error || !data.user) throw new Error(error?.message || "Mot de passe non enregistré");
    return sessionResponse(request, data.user, account);
  } catch (error) {
    return json(messageFromError(error, "Lien invalide"), 400);
  }
}
