import { createClient, SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

export class SupabaseConfigurationError extends Error {
  constructor() {
    super("Supabase n’est pas encore configuré");
  }
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new SupabaseConfigurationError();
  if (!adminClient) {
    adminClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return adminClient;
}

export function getOwnerEmail(request: Request) {
  const forwardedEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (forwardedEmail) return forwardedEmail;
  if (process.env.NODE_ENV !== "production") {
    return (process.env.LOCAL_OWNER_EMAIL || "demo@d2f.local").trim().toLowerCase();
  }
  return null;
}
