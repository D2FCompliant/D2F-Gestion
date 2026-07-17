import { validateEstablishmentIdentifier } from "../../../lib/company-identifiers";
import { json, messageFromError } from "../_shared";

export const dynamic = "force-dynamic";

type RegistryResult = {
  registryStatus: "verified" | "not_found" | "unavailable" | "not_applicable";
  registrySource: string;
  legalName: string;
  address: string;
  active: boolean | null;
};

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function verifyFrenchSiret(siret: string): Promise<RegistryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch(`https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(siret)}&page=1&per_page=1`, {
      headers: { accept: "application/json", "user-agent": "D2F-Gestion/1.0 support@d2fcompliant.com" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = object(await response.json());
    const results = Array.isArray(payload.results) ? payload.results.map(object) : [];
    const company = results[0];
    if (!company) return { registryStatus: "not_found", registrySource: "Annuaire des Entreprises", legalName: "", address: "", active: null };
    const establishments = [object(company.siege), ...(Array.isArray(company.matching_etablissements) ? company.matching_etablissements.map(object) : [])];
    const establishment = establishments.find((item) => String(item.siret || "") === siret);
    if (!establishment) return { registryStatus: "not_found", registrySource: "Annuaire des Entreprises", legalName: "", address: "", active: null };
    const state = String(establishment.etat_administratif || "").toUpperCase();
    return {
      registryStatus: "verified",
      registrySource: "Annuaire des Entreprises — données Sirene",
      legalName: String(company.nom_complet || company.nom_raison_sociale || ""),
      address: String(establishment.adresse || ""),
      active: state ? state === "A" : null,
    };
  } catch {
    return { registryStatus: "unavailable", registrySource: "Annuaire des Entreprises", legalName: "", address: "", active: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: Request) {
  try {
    const body = object(await request.json());
    const identity = validateEstablishmentIdentifier(body.country, body.identifier);
    const registry = identity.country === "FR"
      ? await verifyFrenchSiret(identity.identifier)
      : { registryStatus: "not_applicable" as const, registrySource: "Contrôle local de clé", legalName: "", address: "", active: null };
    if (registry.registryStatus === "verified" && registry.active === false) {
      return json({ ...identity, ...registry, valid: false, reason: "closed_establishment" });
    }
    return json({ ...identity, ...registry, valid: true, checksumValid: true });
  } catch (error) {
    return json(messageFromError(error, "Identifiant invalide"), 400);
  }
}
