import { getOwnerEmail, getSupabaseAdmin, SupabaseConfigurationError } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const preview = {
  clients: [],
  dossiers: [],
  tasks: [],
  mode: "preview" as const,
};

const allowedEntities = ["clients", "dossiers", "tasks"] as const;
type Entity = (typeof allowedEntities)[number];

const writableFields: Record<Entity, string[]> = {
  clients: ["name", "company", "email", "phone", "status", "monthly_revenue"],
  dossiers: ["client_id", "title", "status", "due_date", "amount", "progress"],
  tasks: ["dossier_id", "title", "due_date", "priority", "completed"],
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function parseEntity(value: unknown): Entity | null {
  return typeof value === "string" && allowedEntities.includes(value as Entity) ? value as Entity : null;
}

function sanitize(entity: Entity, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(writableFields[entity].filter((field) => field in input).map((field) => [field, input[field]]));
}

export async function GET(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return json({ error: "Authentification requise" }, 401);
  try {
    const supabase = getSupabaseAdmin();
    const [clients, dossiers, tasks] = await Promise.all([
      supabase.from("clients").select("id,name,company,email,phone,status,monthly_revenue,created_at").eq("owner_email", ownerEmail).order("created_at", { ascending: false }),
      supabase.from("dossiers").select("id,client_id,title,status,due_date,amount,progress,created_at").eq("owner_email", ownerEmail).order("created_at", { ascending: false }),
      supabase.from("tasks").select("id,dossier_id,title,due_date,priority,completed,created_at").eq("owner_email", ownerEmail).order("due_date", { ascending: true }),
    ]);
    const error = clients.error || dossiers.error || tasks.error;
    if (error) return json({ error: error.message }, 500);
    return json({ clients: clients.data ?? [], dossiers: dossiers.data ?? [], tasks: tasks.data ?? [], mode: "live" });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return json(preview);
    return json({ error: "Lecture des données impossible" }, 500);
  }
}

export async function POST(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return json({ error: "Authentification requise" }, 401);
  try {
    const payload = await request.json() as Record<string, unknown>;
    const entity = parseEntity(payload.entity);
    if (!entity) return json({ error: "Type d’enregistrement invalide" }, 400);
    const record = sanitize(entity, payload.record);
    if (!record) return json({ error: "Données invalides" }, 400);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from(entity).insert({ ...record, owner_email: ownerEmail }).select().single();
    if (error) return json({ error: error.message }, 400);
    return json({ record: data }, 201);
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return json({ error: error.message }, 503);
    return json({ error: "Enregistrement impossible" }, 500);
  }
}

export async function PATCH(request: Request) {
  const ownerEmail = getOwnerEmail(request);
  if (!ownerEmail) return json({ error: "Authentification requise" }, 401);
  try {
    const payload = await request.json() as Record<string, unknown>;
    const entity = parseEntity(payload.entity);
    const id = typeof payload.id === "string" ? payload.id : null;
    if (!entity || !id) return json({ error: "Requête invalide" }, 400);
    const record = sanitize(entity, payload.record);
    if (!record || Object.keys(record).length === 0) return json({ error: "Aucune modification" }, 400);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from(entity).update(record).eq("id", id).eq("owner_email", ownerEmail).select().single();
    if (error) return json({ error: error.message }, 400);
    return json({ record: data });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) return json({ error: error.message }, 503);
    return json({ error: "Modification impossible" }, 500);
  }
}
