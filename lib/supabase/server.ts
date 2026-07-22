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

export function assertOfficialServiceRoleKey(value: string) {
  try {
    const payloadSegment = value.split(".")[1];
    if (!payloadSegment) throw new Error("missing payload");
    const normalized = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(normalized + padding)) as { ref?: string; role?: string };
    if (payload.ref !== OFFICIAL_SUPABASE_PROJECT_ID || payload.role !== "service_role") {
      throw new Error("wrong project");
    }
  } catch {
    throw new SupabaseConfigurationError(
      `Clé Supabase non autorisée : elle doit appartenir à ${OFFICIAL_SUPABASE_PROJECT_ID}`,
    );
  }
}

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new SupabaseConfigurationError();
  assertOfficialSupabaseUrl(url);
  assertOfficialServiceRoleKey(serviceRoleKey);
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
