import { getSupabaseAdmin } from "../../../lib/supabase/server";
import { userFromAccessToken } from "../../../lib/auth/server";
import { ensureD2FLifetimeAccount, findAccountForUser } from "../../../lib/saas/accounts";
import { json, messageFromError, sessionResponse } from "../_shared";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const password = String(body.password || "");
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      return json("Le mot de passe doit contenir au moins 12 caractères, une majuscule, une minuscule et un chiffre", 400);
    }
    const user = await userFromAccessToken(String(body.accessToken || ""));
    const account = await findAccountForUser(user.id, String(user.email || "")) || await ensureD2FLifetimeAccount(user);
    if (!account) return json("Invitation sans entreprise associée", 403);
    const { data, error } = await getSupabaseAdmin().auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error || !data.user) throw new Error(error?.message || "Mot de passe non enregistré");
    return sessionResponse(request, data.user, account);
  } catch (error) {
    return json(messageFromError(error, "Lien invalide"), 400);
  }
}
