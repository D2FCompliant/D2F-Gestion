import type { SupabaseClient } from "@supabase/supabase-js";

type PaymentInput = { ownerKey: string; tenantId?: string | null; actorId: string; invoiceId: string; paymentId?: string; amount: number; currency: string; paymentDate: string; valueDate?: string | null; method: string; reference?: string; direction?: "in" | "out"; status?: "posted" | "cancelled"; idempotencyKey: string; notes?: string };

export async function registerCustomerPaymentAtomically(supabase: SupabaseClient, input: PaymentInput) {
  if (!input.invoiceId) throw new Error("Facture manquante pour le paiement");
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Montant de paiement invalide");
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("Devise de paiement invalide");
  if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 200) throw new Error("Clé d’idempotence de paiement invalide");
  const paymentId = input.paymentId || crypto.randomUUID();
  const { data, error } = await supabase.rpc("d2f_register_customer_payment_v1", {
    p_owner_key: input.ownerKey, p_tenant_id: input.tenantId || "", p_payment_id: paymentId, p_invoice_id: input.invoiceId, p_actor_id: input.actorId,
    p_amount: input.amount, p_currency: input.currency, p_payment_date: input.paymentDate, p_value_date: input.valueDate || null, p_method: input.method,
    p_reference: input.reference || null, p_direction: input.direction || "in", p_status: input.status || "posted", p_notes: input.notes || "",
    p_idempotency_key: input.idempotencyKey, p_event_id: crypto.randomUUID(), p_correlation_id: crypto.randomUUID(), p_settlement_id: crypto.randomUUID(),
  });
  if (error) {
    if (["PGRST202", "PGRST205"].includes(error.code || "") || /d2f_register_customer_payment_v1/i.test(error.message || "")) throw new Error("La migration du règlement client doit être appliquée avant l’enregistrement");
    throw error;
  }
  return data;
}
