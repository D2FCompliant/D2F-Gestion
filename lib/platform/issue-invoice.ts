import type { SupabaseClient } from "@supabase/supabase-js";

type IssueInvoiceInput = {
  ownerKey: string;
  tenantId?: string | null;
  invoiceId: string;
  actorId: string;
  idempotencyKey: string;
  outboundPaConnectorId?: string | null;
};

export async function issueInvoiceAtomically(supabase: SupabaseClient, input: IssueInvoiceInput) {
  if (!input.invoiceId) throw new Error("Facture introuvable");
  if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) {
    throw new Error("Clé d’idempotence d’émission invalide");
  }

  const eventId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const { data, error } = await supabase.rpc("d2f_issue_invoice_v1", {
    p_owner_key: input.ownerKey,
    p_tenant_id: input.tenantId || "",
    p_invoice_id: input.invoiceId,
    p_actor_id: input.actorId,
    p_idempotency_key: input.idempotencyKey,
    p_event_id: eventId,
    p_correlation_id: correlationId,
    p_outbound_pa_connector_id: input.outboundPaConnectorId || null,
  });

  if (error) {
    if (error.code === "PGRST202" || /d2f_issue_invoice_v1/i.test(error.message || "")) {
      throw new Error("La migration D2F Platform doit être appliquée avant l’émission atomique");
    }
    throw new Error(error.message || "Échec de l’émission atomique du document");
  }

  return data;
}
