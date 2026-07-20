import { isPlatformAdminEmail, readAppSession } from "../../../../lib/auth/server";
import { getSupabaseAdmin } from "../../../../lib/supabase/server";
import { assignCountryPackOwners, listCountryPackGovernance, publishCountryPack, reviewCountryPack, verifyCountryPackEvidence } from "../../../../lib/country-pack-admin";
import { updateSupportStatus } from "../../../../lib/support";
import { json, messageFromError } from "../../_shared";

export const dynamic = "force-dynamic";

async function adminSession(request: Request) {
  const session = await readAppSession(request);
  return session && isPlatformAdminEmail(session.email) ? session : null;
}

export async function GET(request: Request) {
  try {
    const session = await adminSession(request);
    if (!session) return json("Accès administrateur D2F requis", 403);
    return json(await listCountryPackGovernance(getSupabaseAdmin()));
  } catch (error) {
    return json(messageFromError(error, "Chargement des Country Packs impossible"), 400);
  }
}

export async function POST(request: Request) {
  try {
    const session = await adminSession(request);
    if (!session) return json("Accès administrateur D2F requis", 403);
    const body = await request.json() as Record<string, unknown>;
    const supabase = getSupabaseAdmin();
    if (body.action === "owners") return json(await assignCountryPackOwners(supabase, body.packVersionId, body.regulatoryOwner, body.technicalOwner));
    if (body.action === "evidence") return json(await verifyCountryPackEvidence(supabase, session.email, body.packVersionId, body.evidenceId, body.status));
    if (body.action === "review") return json(await reviewCountryPack(supabase, session.email, body));
    if (body.action === "publish") {
      const result = await publishCountryPack(supabase, session.email, body.packVersionId);
      const ticketId = String(body.ticketId || "").trim();
      if (ticketId) {
        const published = result.published;
        await updateSupportStatus(session, {
          ticketId, status: "closed", assignedTo: session.email,
          resolution: `Country Pack ${published.country} ${published.version} publié après vérification des preuves et validations réglementaire, technique et sécurité. Empreinte : ${published.manifestHash}.`,
        });
      }
      return json(result);
    }
    return json("Action Country Pack inconnue", 400);
  } catch (error) {
    return json(messageFromError(error, "Mise à jour du Country Pack impossible"), 400);
  }
}
