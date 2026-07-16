import { createClient, type User } from "@supabase/supabase-js";
import { getSupabaseAdmin, SupabaseConfigurationError } from "../supabase/server";

export const SESSION_COOKIE_NAME = "d2f_session";
export const SESSION_IDLE_SECONDS = 30 * 60;

export type AppSession = {
  userId: string;
  email: string;
  fullName: string;
  tenantId: string;
  ownerKey: string;
  role: "owner" | "collaborator";
  issuedAt: number;
  expiresAt: number;
};

function requiredAuthConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new SupabaseConfigurationError();
  return { url, key };
}

export function createPasswordAuthClient() {
  const { url, key } = requiredAuthConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function sessionSecret() {
  const value = process.env.D2F_SESSION_SECRET || process.env.D2F_AUDIT_HMAC_SECRET || "";
  if (value.length < 24) throw new Error("Clé de session D2F non configurée");
  return value;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signature(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return "";
}

export async function encodeSession(session: AppSession) {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(session)));
  return `${payload}.${await signature(payload)}`;
}

export async function readAppSession(request: Request): Promise<AppSession | null> {
  const token = cookieValue(request, SESSION_COOKIE_NAME);
  const separator = token.lastIndexOf(".");
  if (separator < 1) return null;
  const payload = token.slice(0, separator);
  const suppliedSignature = token.slice(separator + 1);
  if (!constantTimeEqual(suppliedSignature, await signature(payload))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as AppSession;
    if (!parsed.userId || !parsed.email || !parsed.tenantId || !parsed.ownerKey || !parsed.role) return null;
    if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function renewedSession(session: Omit<AppSession, "issuedAt" | "expiresAt">): AppSession {
  const now = Math.floor(Date.now() / 1000);
  return { ...session, issuedAt: now, expiresAt: now + SESSION_IDLE_SECONDS };
}

export async function sessionCookie(session: AppSession, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${await encodeSession(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_IDLE_SECONDS}${secure}`;
}

export function clearSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function authenticatePassword(email: string, password: string) {
  const { data, error } = await createPasswordAuthClient().auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error("Adresse e-mail ou mot de passe incorrect");
  return data.user;
}

export async function signUpWithPassword(input: {
  email: string;
  password: string;
  fullName: string;
  companyName: string;
  redirectTo: string;
}) {
  const client = createPasswordAuthClient();
  const { data, error } = await client.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      emailRedirectTo: input.redirectTo,
      data: { full_name: input.fullName, company_name: input.companyName },
    },
  });
  if (error || !data.user) throw new Error(error?.message || "Inscription impossible");
  if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error("Un compte utilise déjà cette adresse e-mail");
  }
  return { user: data.user, session: data.session };
}

export async function userFromAccessToken(accessToken: string): Promise<User> {
  const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
  if (error || !data.user) throw new Error("Lien d’authentification invalide ou expiré");
  return data.user;
}

export function publicBillingConfig() {
  const amount = Number(process.env.D2F_MONTHLY_PRICE_EUR || "29");
  return {
    amountEur: Number.isFinite(amount) && amount > 0 ? amount : 29,
    currency: "EUR",
    beneficiary: process.env.D2F_BILLING_BENEFICIARY || "D2F Compliant d.o.o.",
    iban: process.env.D2F_BILLING_IBAN || "",
    bic: process.env.D2F_BILLING_BIC || "",
  };
}

export function safeOrigin(request: Request) {
  const configured = String(process.env.D2F_PUBLIC_URL || "").trim().replace(/\/$/, "");
  if (/^https:\/\/[^/]+$/i.test(configured)) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function normalizedEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isPlatformAdminEmail(email: string) {
  return Boolean(email && normalizedEmail(process.env.D2F_OWNER_EMAIL) === normalizedEmail(email));
}
