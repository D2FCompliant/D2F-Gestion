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

export function getOwnerEmail(_request: Request) {
  void _request;
  if (process.env.NODE_ENV !== "production") {
    return (process.env.LOCAL_OWNER_EMAIL || "demo@d2f.local").trim().toLowerCase();
  }
  return null;
}
