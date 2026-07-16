import { authenticatePassword, normalizedEmail } from "../../../lib/auth/server";
import { ensureD2FLifetimeAccount, findAccountForUser } from "../../../lib/saas/accounts";
import { json, messageFromError, sessionResponse } from "../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const email = normalizedEmail(body.email);
    const password = String(body.password || "");
    if (!email || !password) return json("Adresse e-mail et mot de passe requis", 400);
    const user = await authenticatePassword(email, password);
    const account = await findAccountForUser(user.id, email) || await ensureD2FLifetimeAccount(user);
    if (!account) return json("Aucune entreprise active n’est associée à ce compte", 403);
    return sessionResponse(request, user, account);
  } catch (error) {
    return json(messageFromError(error, "Connexion impossible"), 401);
  }
}
