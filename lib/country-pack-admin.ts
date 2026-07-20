import type { SupabaseClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;
type ReviewType = "regulatory" | "technical" | "security";
type ReviewDecision = "approved" | "rejected" | "changes_requested";

function text(value: unknown, max = 1000) { return String(value || "").trim().slice(0, max); }
function object(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function databaseError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (["42P01", "PGRST204", "PGRST205"].includes(error.code || "")) throw new Error("Le registre de gouvernance Country Packs doit être initialisé dans Supabase");
  throw new Error(error.message || "Le registre Country Packs est indisponible");
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function governanceRows(supabase: SupabaseClient) {
  const versions = await supabase.from("d2f_country_pack_versions")
    .select("id,pack_id,country,pack_version,status,regulatory_owner,technical_owner,manifest,manifest_sha256,effective_from,effective_to,published_at,created_by,created_at,updated_at")
    .order("country", { ascending: true }).order("created_at", { ascending: false });
  databaseError(versions.error);
  const ids = (versions.data || []).map((row) => row.id);
  if (!ids.length) return { versions: [], evidence: [], reviews: [] };
  const [evidence, reviews] = await Promise.all([
    supabase.from("d2f_country_pack_evidence").select("id,pack_version_id,evidence_type,source_uri,authority,effective_date,sha256,verification_status,metadata,created_at").in("pack_version_id", ids).order("created_at", { ascending: true }),
    supabase.from("d2f_country_pack_reviews").select("id,pack_version_id,review_type,reviewer,decision,notes,evidence_snapshot_hash,decided_at").in("pack_version_id", ids).order("decided_at", { ascending: false }),
  ]);
  databaseError(evidence.error); databaseError(reviews.error);
  return { versions: versions.data || [], evidence: evidence.data || [], reviews: reviews.data || [] };
}

async function publicPack(version: JsonRecord, allEvidence: JsonRecord[], allReviews: JsonRecord[]) {
  const evidence = allEvidence.filter((row) => row.pack_version_id === version.id);
  const reviews = allReviews.filter((row) => row.pack_version_id === version.id);
  const latestReviews = Object.fromEntries((["regulatory", "technical", "security"] as const).map((kind) => [kind, reviews.find((row) => row.review_type === kind) || null]));
  const manifest = object(version.manifest);
  const evidenceVerified = evidence.length > 0 && evidence.every((row) => row.verification_status === "verified");
  const evidenceSnapshotHash = await sha256(JSON.stringify(evidence.map((row) => ({ id: row.id, sha256: row.sha256, verification_status: row.verification_status })).sort((left, right) => String(left.id).localeCompare(String(right.id)))));
  const approvalsComplete = Object.values(latestReviews).every((row) => row && row.decision === "approved" && row.evidence_snapshot_hash === evidenceSnapshotHash);
  const ownersComplete = Boolean(text(version.regulatory_owner) && text(version.technical_owner));
  const manualPublication = manifest.automaticPublication === false;
  return {
    id: version.id, packId: version.pack_id, country: version.country, version: version.pack_version, status: version.status,
    regulatoryOwner: version.regulatory_owner, technicalOwner: version.technical_owner, manifestHash: version.manifest_sha256,
    effectiveFrom: version.effective_from, effectiveTo: version.effective_to, publishedAt: version.published_at,
    createdBy: version.created_by, createdAt: version.created_at, updatedAt: version.updated_at,
    manifest: { module: manifest.module || "", currency: manifest.currency || "", languages: manifest.languages || [], unresolvedDecisions: manifest.unresolvedDecisions || [] },
    evidence, reviews, latestReviews, evidenceSnapshotHash,
    readiness: { ownersComplete, evidenceVerified, approvalsComplete, manualPublication, publishable: ownersComplete && evidenceVerified && approvalsComplete && manualPublication && version.status !== "published" },
  };
}

export async function listCountryPackGovernance(supabase: SupabaseClient) {
  const rows = await governanceRows(supabase);
  return { packs: await Promise.all(rows.versions.map((version) => publicPack(version, rows.evidence, rows.reviews))) };
}

async function editablePack(supabase: SupabaseClient, packVersionId: string) {
  const result = await supabase.from("d2f_country_pack_versions").select("id,status,country,pack_id,pack_version").eq("id", packVersionId).maybeSingle();
  databaseError(result.error);
  if (!result.data) throw new Error("Country Pack introuvable");
  if (["published", "superseded", "revoked"].includes(result.data.status)) throw new Error("Cette version publiée ou archivée n’est plus modifiable");
  return result.data;
}

export async function assignCountryPackOwners(supabase: SupabaseClient, packVersionIdValue: unknown, regulatoryOwnerValue: unknown, technicalOwnerValue: unknown) {
  const packVersionId = text(packVersionIdValue, 80); await editablePack(supabase, packVersionId);
  const regulatoryOwner = text(regulatoryOwnerValue, 160), technicalOwner = text(technicalOwnerValue, 160);
  if (regulatoryOwner.length < 3 || technicalOwner.length < 3) throw new Error("Renseignez les responsables réglementaire et technique");
  const result = await supabase.from("d2f_country_pack_versions").update({ regulatory_owner: regulatoryOwner, technical_owner: technicalOwner, updated_at: new Date().toISOString() }).eq("id", packVersionId);
  databaseError(result.error); return listCountryPackGovernance(supabase);
}

export async function verifyCountryPackEvidence(supabase: SupabaseClient, actorEmail: string, packVersionIdValue: unknown, evidenceIdValue: unknown, statusValue: unknown) {
  const packVersionId = text(packVersionIdValue, 80), evidenceId = text(evidenceIdValue, 80); await editablePack(supabase, packVersionId);
  const verificationStatus = statusValue === "verified" ? "verified" : statusValue === "rejected" ? "rejected" : "pending";
  const current = await supabase.from("d2f_country_pack_evidence").select("id,metadata").eq("id", evidenceId).eq("pack_version_id", packVersionId).maybeSingle();
  databaseError(current.error); if (!current.data) throw new Error("Preuve Country Pack introuvable");
  const metadata = { ...object(current.data.metadata), verification: { actor: actorEmail, status: verificationStatus, decidedAt: new Date().toISOString() } };
  const result = await supabase.from("d2f_country_pack_evidence").update({ verification_status: verificationStatus, metadata }).eq("id", evidenceId).eq("pack_version_id", packVersionId).select("id").maybeSingle();
  databaseError(result.error); if (!result.data) throw new Error("Preuve Country Pack introuvable");
  return listCountryPackGovernance(supabase);
}

export async function reviewCountryPack(supabase: SupabaseClient, actorEmail: string, input: JsonRecord) {
  const packVersionId = text(input.packVersionId, 80), reviewType = text(input.reviewType, 30) as ReviewType, decision = text(input.decision, 30) as ReviewDecision, notes = text(input.notes, 4000);
  if (!["regulatory", "technical", "security"].includes(reviewType)) throw new Error("Type de validation invalide");
  if (!["approved", "rejected", "changes_requested"].includes(decision)) throw new Error("Décision invalide");
  if (notes.length < 10) throw new Error("Documentez la validation en au moins 10 caractères");
  await editablePack(supabase, packVersionId);
  const evidence = await supabase.from("d2f_country_pack_evidence").select("id,sha256,verification_status").eq("pack_version_id", packVersionId).order("id", { ascending: true });
  databaseError(evidence.error);
  if (!(evidence.data || []).length) throw new Error("Aucune preuve n’est rattachée à cette version");
  if (decision === "approved" && (evidence.data || []).some((row) => row.verification_status !== "verified")) throw new Error("Vérifiez toutes les preuves avant d’approuver");
  const inserted = await supabase.from("d2f_country_pack_reviews").insert({ pack_version_id: packVersionId, review_type: reviewType, reviewer: actorEmail, decision, notes, evidence_snapshot_hash: await sha256(JSON.stringify((evidence.data || []).map((row) => ({ id: row.id, sha256: row.sha256, verification_status: row.verification_status })).sort((left, right) => String(left.id).localeCompare(String(right.id))))) });
  databaseError(inserted.error);
  const workspace = await listCountryPackGovernance(supabase), pack = workspace.packs.find((item) => item.id === packVersionId);
  const nextStatus = decision !== "approved" ? (decision === "rejected" ? "rejected" : "evidence_collection") : pack?.readiness.approvalsComplete ? "approved" : reviewType === "regulatory" ? "technical_review" : reviewType === "technical" ? "security_review" : "approved";
  const updated = await supabase.from("d2f_country_pack_versions").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", packVersionId);
  databaseError(updated.error); return listCountryPackGovernance(supabase);
}

export async function publishCountryPack(supabase: SupabaseClient, actorEmail: string, packVersionIdValue: unknown) {
  const packVersionId = text(packVersionIdValue, 80), workspace = await listCountryPackGovernance(supabase), pack = workspace.packs.find((item) => item.id === packVersionId);
  if (!pack) throw new Error("Country Pack introuvable");
  if (!pack.readiness.ownersComplete) throw new Error("Les responsables réglementaire et technique sont obligatoires");
  if (!pack.readiness.evidenceVerified) throw new Error("Toutes les preuves doivent être vérifiées");
  if (!pack.readiness.approvalsComplete) throw new Error("Les validations réglementaire, technique et sécurité sont obligatoires");
  if (!pack.readiness.manualPublication) throw new Error("La publication automatique est interdite");
  const published = await supabase.rpc("d2f_publish_country_pack_v1", { p_pack_version_id: packVersionId, p_actor: actorEmail });
  databaseError(published.error);
  return { workspace: await listCountryPackGovernance(supabase), published: { id: pack.id, country: pack.country, packId: pack.packId, version: pack.version, manifestHash: pack.manifestHash } };
}
