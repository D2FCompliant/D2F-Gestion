import { isPlatformAdminEmail, readAppSession } from "../../../../lib/auth/server";
import { listSubscriptionInvoices, renderSubscriptionInvoice } from "../../../../lib/saas/billing";
import { json, messageFromError } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await readAppSession(request);
    if (!session) return json("Session expirée", 401);
    const url = new URL(request.url);
    const requestedTenantId = String(url.searchParams.get("tenantId") || session.tenantId);
    if (requestedTenantId !== session.tenantId && !isPlatformAdminEmail(session.email)) return json("Accès interdit", 403);
    const invoiceId = String(url.searchParams.get("invoiceId") || "");
    if (!invoiceId) return json(await listSubscriptionInvoices(requestedTenantId));
    const bytes = await renderSubscriptionInvoice(requestedTenantId, invoiceId, String(url.searchParams.get("locale") || "fr"));
    return new Response(new Uint8Array(bytes).buffer, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="facture-abonnement-d2f-${invoiceId.replace(/[^a-z0-9_-]+/gi, "-")}.pdf"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return json(messageFromError(error, "Facture indisponible"), 400);
  }
}
