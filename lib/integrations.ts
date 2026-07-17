import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;
export type IntegrationType = "pa" | "archive" | "email";

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function base64ToBytes(input: string) {
  const binary = atob(input);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey() {
  const secret = process.env.D2F_CONNECTOR_ENCRYPTION_KEY || process.env.D2F_AUDIT_HMAC_SECRET || "";
  if (secret.length < 24) throw new Error("Clé de chiffrement des connecteurs non configurée");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`d2f-integrations-v1:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptSecret(secret: string) {
  if (!secret) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(secret));
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decryptSecret(payload: unknown) {
  const parts = stringValue(payload).split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return "";
  const iv = base64ToBytes(parts[1]);
  const encrypted = base64ToBytes(parts[2]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await encryptionKey(), encrypted);
  return new TextDecoder().decode(plain);
}

function publicConfig(input: JsonRecord) {
  const allowed = [
    "provider_name", "base_url", "health_path", "submit_path", "status_path", "auth_type", "auth_header", "retention_years", "enabled",
    "country", "channel_profile", "environment", "public_identifier", "routing_id", "routing_email", "last_test_status", "last_tested_at",
    "reporting_submit_path", "reporting_enabled", "reporting_adapter_qualified", "reporting_adapter_contract",
  ];
  return Object.fromEntries(allowed.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

function missingIntegrationTable(error: { code?: string; message?: string } | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || /d2f_(integrations|transmissions).*not find|relation .*d2f_/i.test(error.message || "")));
}

async function fallbackCompanyData(supabase: SupabaseClient, ownerEmail: string) {
  const { data, error } = await supabase.from("d2f_company").select("data").eq("owner_email", ownerEmail).maybeSingle();
  if (error) throw error;
  return object(data?.data);
}

async function saveFallbackCompanyData(supabase: SupabaseClient, ownerEmail: string, data: JsonRecord) {
  const { error } = await supabase.from("d2f_company").upsert({ owner_email: ownerEmail, data, updated_at: new Date().toISOString() }, { onConflict: "owner_email" });
  if (error) throw error;
}

export async function getIntegration(supabase: SupabaseClient, ownerEmail: string, type: IntegrationType, includeSecret = false) {
  const { data, error } = await supabase.from("d2f_integrations").select("config,secret_encrypted,updated_at").eq("owner_email", ownerEmail).eq("integration_type", type).maybeSingle();
  if (!error) {
    const config = object(data?.config);
    return { ...config, configured: Boolean(data?.secret_encrypted), updated_at: data?.updated_at || null, ...(includeSecret && data?.secret_encrypted ? { secret: await decryptSecret(data.secret_encrypted) } : {}) };
  }
  if (!missingIntegrationTable(error)) throw error;
  const company = await fallbackCompanyData(supabase, ownerEmail);
  const integrations = object(company._integrations);
  const fallback = object(integrations[type]);
  const config = object(fallback.config);
  const secretEncrypted = stringValue(fallback.secret_encrypted);
  return { ...config, configured: Boolean(secretEncrypted), updated_at: fallback.updated_at || null, ...(includeSecret && secretEncrypted ? { secret: await decryptSecret(secretEncrypted) } : {}) };
}

export async function saveIntegration(supabase: SupabaseClient, ownerEmail: string, type: IntegrationType, input: JsonRecord) {
  const previous = await getIntegration(supabase, ownerEmail, type, true).catch(() => ({} as JsonRecord));
  const secret = stringValue(input.secret || previous.secret);
  const row = { owner_email: ownerEmail, integration_type: type, config: publicConfig(input), secret_encrypted: secret ? await encryptSecret(secret) : null, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from("d2f_integrations").upsert(row, { onConflict: "owner_email,integration_type" }).select("config,secret_encrypted,updated_at").single();
  if (!error) return { ...object(data.config), configured: Boolean(data.secret_encrypted), updated_at: data.updated_at };
  if (!missingIntegrationTable(error)) throw error;
  const company = await fallbackCompanyData(supabase, ownerEmail);
  const integrations = object(company._integrations);
  integrations[type] = { config: row.config, secret_encrypted: row.secret_encrypted, updated_at: row.updated_at };
  await saveFallbackCompanyData(supabase, ownerEmail, { ...company, _integrations: integrations });
  return { ...object(row.config), configured: Boolean(row.secret_encrypted), updated_at: row.updated_at };
}

function connectorUrl(base: unknown, path: unknown) {
  const baseUrl = new URL(stringValue(base));
  if (baseUrl.protocol !== "https:") throw new Error("Le connecteur doit utiliser une adresse HTTPS");
  const hostname = baseUrl.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) || hostname === "::1") throw new Error("Adresse de connecteur privée ou locale interdite");
  return new URL(stringValue(path || "/"), `${baseUrl.origin}${baseUrl.pathname.replace(/\/$/, "")}/`).toString();
}

function authorizationHeaders(config: JsonRecord, secret: string) {
  if (!secret) throw new Error("Identifiant secret du connecteur manquant");
  const type = stringValue(config.auth_type || "bearer").toLowerCase();
  if (type === "bearer") return { authorization: `Bearer ${secret}` };
  if (type === "apikey") return { [stringValue(config.auth_header || "x-api-key")]: secret };
  throw new Error(`Type d'authentification non pris en charge : ${type}`);
}

async function connectorFetch(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = text;
    try { body = text ? JSON.parse(text) : {}; } catch { /* réponse texte conservée */ }
    if (!response.ok) throw new Error(`Connecteur HTTP ${response.status}: ${typeof body === "string" ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300)}`);
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

export async function testIntegration(supabase: SupabaseClient, ownerEmail: string, type: IntegrationType) {
  const config = await getIntegration(supabase, ownerEmail, type, true);
  if (!config.enabled) throw new Error("Le connecteur est désactivé");
  const result = await connectorFetch(connectorUrl(config.base_url, config.health_path || "/health"), { method: "GET", headers: { ...authorizationHeaders(config, stringValue(config.secret)), accept: "application/json" } });
  const lastTestedAt = new Date().toISOString();
  await saveIntegration(supabase, ownerEmail, type, { ...config, secret: config.secret, last_test_status: "ok", last_tested_at: lastTestedAt });
  return { ok: true, provider: config.provider_name || type, profile: config.channel_profile || type, status: result.status, tested_at: lastTestedAt };
}

export async function transmitIntegration(supabase: SupabaseClient, ownerEmail: string, type: IntegrationType, input: { documentId?: string; documentNumber?: string; content: BodyInit; contentType: string; metadata?: JsonRecord; path?: string }) {
  const config = await getIntegration(supabase, ownerEmail, type, true);
  if (!config.enabled) return { ok: true, skipped: true, reason: "disabled" };
  const path = input.path || (type === "archive" ? config.submit_path || "/archives" : config.submit_path || "/invoices");
  const response = await connectorFetch(connectorUrl(config.base_url, path), {
    method: "POST",
    headers: { ...authorizationHeaders(config, stringValue(config.secret)), "content-type": input.contentType, accept: "application/json", "x-d2f-document-id": input.documentId || "", "x-d2f-document-number": input.documentNumber || "" },
    body: input.content,
  });
  const receipt = object(response.body);
  const remoteId = stringValue(receipt.id || receipt.remote_id || receipt.archive_id);
  const { error } = await supabase.from("d2f_transmissions").insert({ owner_email: ownerEmail, channel: type, document_id: input.documentId || null, document_number: input.documentNumber || null, status: stringValue(receipt.status || "submitted"), remote_id: remoteId || null, receipt: { ...receipt, http_status: response.status, metadata: input.metadata || {} } });
  if (error) {
    if (!missingIntegrationTable(error)) throw error;
    const company = await fallbackCompanyData(supabase, ownerEmail);
    const transmissions = Array.isArray(company._transmissions) ? company._transmissions : [];
    transmissions.unshift({ id: crypto.randomUUID(), channel: type, document_id: input.documentId || null, document_number: input.documentNumber || null, status: stringValue(receipt.status || "submitted"), remote_id: remoteId || null, receipt: { ...receipt, http_status: response.status, metadata: input.metadata || {} }, created_at: new Date().toISOString() });
    await saveFallbackCompanyData(supabase, ownerEmail, { ...company, _transmissions: transmissions.slice(0, 200) });
  }
  return { ok: true, provider: config.provider_name || type, status: stringValue(receipt.status || "submitted"), remote_id: remoteId || null };
}

export async function listTransmissions(supabase: SupabaseClient, ownerEmail: string) {
  const { data, error } = await supabase.from("d2f_transmissions").select("id,channel,document_id,document_number,status,remote_id,receipt,created_at").eq("owner_email", ownerEmail).order("created_at", { ascending: false }).limit(200);
  if (!error) return data || [];
  if (!missingIntegrationTable(error)) throw error;
  const company = await fallbackCompanyData(supabase, ownerEmail);
  return Array.isArray(company._transmissions) ? company._transmissions : [];
}
