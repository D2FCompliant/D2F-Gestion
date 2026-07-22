import { createClient, SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

export const OFFICIAL_SUPABASE_PROJECT_ID = "eafnemhzrvcdavjdbtpy";
const OFFICIAL_SUPABASE_HOST = `${OFFICIAL_SUPABASE_PROJECT_ID}.supabase.co`;

export class SupabaseConfigurationError extends Error {
  constructor(message = "Supabase n’est pas encore configuré") {
    super(message);
  }
}

export function assertOfficialSupabaseUrl(value: string) {
  let host: string;
  try {
    host = new URL(value).hostname;
  } catch {
    throw new SupabaseConfigurationError("URL Supabase invalide");
  }
  if (host !== OFFICIAL_SUPABASE_HOST) {
    throw new SupabaseConfigurationError(
      `Projet Supabase non autorisé : seul ${OFFICIAL_SUPABASE_PROJECT_ID} peut être utilisé`,
    );
  }
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new SupabaseConfigurationError();
  assertOfficialSupabaseUrl(url);
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
