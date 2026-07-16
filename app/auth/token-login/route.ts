import { userFromAccessToken } from "../../../lib/auth/server";
import { ensureD2FLifetimeAccount, findAccountForUser } from "../../../lib/saas/accounts";
import { json, messageFromError, sessionResponse } from "../_shared";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const user = await userFromAccessToken(String(body.accessToken || ""));
    const account = await findAccountForUser(user.id, String(user.email || "")) || await ensureD2FLifetimeAccount(user);
    if (!account) return json("Aucune entreprise associée", 403);
    return sessionResponse(request, user, account);
  } catch (error) {
    return json(messageFromError(error, "Lien invalide"), 401);
  }
}
