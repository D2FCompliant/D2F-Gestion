import { createPasswordAuthClient, normalizedEmail, safeOrigin } from "../../../lib/auth/server";
import { json } from "../_shared";

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const email = normalizedEmail(body.email);
  if (email.includes("@")) {
    await createPasswordAuthClient().auth.resetPasswordForEmail(email, { redirectTo: safeOrigin(request) }).catch(() => {});
  }
  return json({ message: "Si cette adresse existe, un lien sécurisé a été envoyé." });
}
