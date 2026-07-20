import { createPasswordActivationToken, normalizedEmail, safeOrigin } from "../../../lib/auth/server";
import { sendSmtpMessage, smtpConfiguration } from "../../../lib/support-mail";
import { getSupabaseAdmin } from "../../../lib/supabase/server";
import { json } from "../_shared";

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const email = normalizedEmail(body.email);
  if (email.includes("@")) {
    try {
      const admin = getSupabaseAdmin();
      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const user = listed.data.users.find((candidate) => normalizedEmail(candidate.email) === email);
      const smtp = smtpConfiguration();
      if (user && smtp) {
        const nonce = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const metadata = { ...(user.user_metadata || {}), d2f_password_activation_nonce: nonce, d2f_password_activation_expires_at: expiresAt };
        const updated = await admin.auth.admin.updateUserById(user.id, { user_metadata: metadata });
        if (!updated.error) {
          const token = await createPasswordActivationToken(user.id, email, nonce);
          const link = `${safeOrigin(request)}/#d2f_activation=${encodeURIComponent(token)}`;
          await sendSmtpMessage(smtp, {
            to: email,
            subject: "Définition de votre mot de passe D2F Platform",
            text: `Utilisez ce lien personnel pour définir votre mot de passe D2F Platform :\n\n${link}\n\nCe lien est valable 24 heures et sera invalidé après sa première utilisation.`,
          });
        }
      }
    } catch {
      // The public response stays generic and does not disclose account existence.
    }
  }
  return json({ message: "Si cette adresse existe, un lien D2F valable 24 heures a été envoyé." });
}
