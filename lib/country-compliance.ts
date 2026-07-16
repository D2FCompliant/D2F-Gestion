type JsonRecord = Record<string, unknown>;

export type ComplianceMode = "pdf" | "peppol" | "national";

export type ComplianceIssue = {
  code: string;
  field: string;
  message: string;
};

export type CountryComplianceProfile = {
  country: string;
  label: string;
  nationalProfile: string;
  nationalChannel: string;
  nationalFormat: string;
  peppolNationalRules: boolean;
  authorityUrl: string;
};

const PROFILES: Record<string, CountryComplianceProfile> = {
  FR: {
    country: "FR",
    label: "France — PA / PPF + règles françaises EN16931",
    nationalProfile: "FR_PA",
    nationalChannel: "Plateforme Agréée (PA)",
    nationalFormat: "UBL 2.1, CII ou Factur-X selon le flux qualifié",
    peppolNationalRules: true,
    authorityUrl: "https://www.impots.gouv.fr/specifications-externes-b2b",
  },
  RS: {
    country: "RS",
    label: "Serbie — Sistem eFaktura (SEF)",
    nationalProfile: "RS_SEF",
    nationalChannel: "SEF API",
    nationalFormat: "UBL 2.1 adapté au SEF",
    peppolNationalRules: false,
    authorityUrl: "https://www.efaktura.gov.rs/",
  },
  IT: {
    country: "IT",
    label: "Italie — FatturaPA / Sistema di Interscambio",
    nationalProfile: "IT_SDI",
    nationalChannel: "Sistema di Interscambio (SdI)",
    nationalFormat: "FatturaPA XML",
    peppolNationalRules: true,
    authorityUrl: "https://www.fatturapa.gov.it/",
  },
  ES: {
    country: "ES",
    label: "Espagne — SIF / VERI*FACTU",
    nationalProfile: "ES_VERIFACTU",
    nationalChannel: "AEAT VERI*FACTU (registre de facturation)",
    nationalFormat: "Registre AEAT ; facture distincte du registre fiscal",
    peppolNationalRules: false,
    authorityUrl: "https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu.html",
  },
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function stringValue(value: unknown) {
  return String(value ?? "").trim();
}

function countryCode(value: unknown) {
  return stringValue(value).toUpperCase().slice(0, 2);
}

function meta(recordValue: JsonRecord) {
  const direct = record(recordValue.meta);
  if (typeof recordValue.meta_json !== "string") return { ...record(recordValue.meta_json), ...direct };
  try {
    return { ...record(JSON.parse(recordValue.meta_json)), ...direct };
  } catch {
    return direct;
  }
}

function endpoint(party: JsonRecord) {
  const partyMeta = meta(party);
  return {
    id: stringValue(party.peppol_endpoint_id || partyMeta.peppol_endpoint_id),
    scheme: stringValue(party.peppol_endpoint_scheme || partyMeta.peppol_endpoint_scheme),
    status: stringValue(party.peppol_directory_status || partyMeta.peppol_directory_status),
  };
}

export function countryComplianceProfile(countryValue: unknown): CountryComplianceProfile {
  const country = countryCode(countryValue) || "OT";
  return PROFILES[country] || {
    country,
    label: `${country} — profil national à qualifier`,
    nationalProfile: "GENERIC_EN16931",
    nationalChannel: "Connecteur national non qualifié",
    nationalFormat: "EN16931 ne suffit pas à prouver la conformité nationale",
    peppolNationalRules: false,
    authorityUrl: "https://peppol.org/",
  };
}

function add(errors: ComplianceIssue[], code: string, field: string, message: string) {
  errors.push({ code, field, message });
}

export function preflightInvoice(input: {
  document: JsonRecord;
  lines: JsonRecord[];
  seller: JsonRecord;
  buyer: JsonRecord;
  mode: ComplianceMode;
}) {
  const { document, lines, seller, buyer, mode } = input;
  const sellerCountry = countryCode(seller.country);
  const buyerCountry = countryCode(buyer.country);
  const profile = countryComplianceProfile(sellerCountry);
  const errors: ComplianceIssue[] = [];
  const warnings: ComplianceIssue[] = [];
  const sellerEndpoint = endpoint(seller);
  const buyerEndpoint = endpoint(buyer);
  const buyerType = stringValue(buyer.customer_type || "B2B").toUpperCase();
  const type = stringValue(document.type || document.kind || "final").toLowerCase();

  if (!stringValue(document.invoice_number || document.number)) add(errors, "BT-1", "invoice_number", "La facture doit être émise et numérotée.");
  if (!stringValue(document.date)) add(errors, "BT-2", "date", "La date d’émission est obligatoire.");
  if (!stringValue(seller.legal_name || seller.name)) add(errors, "BT-27", "seller.legal_name", "La raison sociale du vendeur est obligatoire.");
  if (!sellerCountry) add(errors, "BT-40", "seller.country", "Le pays du vendeur est obligatoire.");
  if (!stringValue(seller.legal_id)) add(errors, "BT-29", "seller.legal_id", "L’identifiant légal du vendeur est obligatoire.");
  if (!stringValue(buyer.name || buyer.legal_name)) add(errors, "BT-44", "buyer.name", "Le nom du client est obligatoire.");
  if (!buyerCountry) add(errors, "BT-55", "buyer.country", "Le pays du client est obligatoire.");
  if (!stringValue(buyer.street)) add(errors, "BT-50", "buyer.street", "L’adresse du client est obligatoire avant un export structuré.");
  if (!stringValue(buyer.city)) add(errors, "BT-52", "buyer.city", "La ville du client est obligatoire avant un export structuré.");
  if (!stringValue(buyer.postal_code || buyer.postal)) add(errors, "BT-53", "buyer.postal_code", "Le code postal du client est obligatoire avant un export structuré.");
  if (!lines.length) add(errors, "BG-25", "lines", "La facture doit contenir au moins une ligne.");
  lines.forEach((line, index) => {
    if (!stringValue(line.description || line.name || line.label)) add(errors, "BT-153", `lines.${index}.description`, `La ligne ${index + 1} doit avoir une désignation.`);
    if (!(Number(line.quantity) > 0)) add(errors, "BT-129", `lines.${index}.quantity`, `La quantité de la ligne ${index + 1} doit être supérieure à zéro.`);
  });
  if (type === "credit_note" && !stringValue(document.source_invoice_id || document.source_invoice_number)) {
    add(errors, "BG-3", "source_invoice_id", "Un avoir doit référencer la facture qu’il corrige.");
  }

  if (mode === "peppol") {
    if (!sellerEndpoint.id || !sellerEndpoint.scheme) add(errors, "BT-34", "seller.peppol_endpoint", "L’adresse électronique PEPPOL du vendeur et son schéma sont obligatoires.");
    if (!buyerEndpoint.id || !buyerEndpoint.scheme) add(errors, "BT-49", "buyer.peppol_endpoint", "L’adresse électronique PEPPOL du client et son schéma sont obligatoires.");
    if (buyerEndpoint.status !== "verified") add(warnings, "PEPPOL-DIRECTORY", "buyer.peppol_directory_status", "L’identifiant du client doit être confirmé par le prestataire PEPPOL avant l’envoi.");
    if (sellerCountry === "FR" && sellerEndpoint.scheme !== "0225") {
      add(errors, "FR-BT-34", "seller.peppol_endpoint_scheme", "En France, l’adresse électronique du vendeur doit utiliser le schéma 0225 pour ce profil.");
    }
    if (sellerCountry === "FR" && buyerCountry === "FR" && buyerType !== "B2C" && buyerEndpoint.scheme !== "0225") {
      add(errors, "FR-BT-49", "buyer.peppol_endpoint_scheme", "En France, l’adresse électronique du client relevant du dispositif doit utiliser le schéma 0225.");
    }
  }

  if (mode === "national") {
    if (!PROFILES[sellerCountry]) add(errors, "COUNTRY-NOT-QUALIFIED", "seller.country", `Aucun connecteur national D2F n’est qualifié pour ${sellerCountry || "ce pays"}.`);
    if (sellerCountry === "FR" && buyerCountry === "FR" && buyerType !== "B2C" && (!buyerEndpoint.id || buyerEndpoint.scheme !== "0225")) {
      add(errors, "FR-BT-49", "buyer.peppol_endpoint", "Le routage français B2B/B2G exige une adresse électronique 0225 validée via la PA/PPF.");
    }
    if (sellerCountry === "FR" && (!sellerEndpoint.id || sellerEndpoint.scheme !== "0225")) {
      add(errors, "FR-BT-34", "seller.peppol_endpoint", "Le routage français exige une adresse électronique vendeur 0225 dans la fiche Entreprise.");
    }
    if (sellerCountry === "IT") add(errors, "IT-FATTURAPA", "format", "Une facture domestique italienne doit être générée en FatturaPA XML et transmise via SdI ; l’UBL PEPPOL générique est bloqué.");
    if (sellerCountry === "ES") add(errors, "ES-VERIFACTU", "fiscal_record", "La transmission nationale espagnole exige un registre SIF/VERI*FACTU AEAT distinct, avec empreinte et QR ; l’UBL seul est insuffisant.");
  }

  if (mode === "pdf" && (buyerType === "B2B" || buyerType === "B2G") && !buyerEndpoint.id) {
    add(warnings, "PDF-FALLBACK", "buyer.peppol_endpoint", "PDF autorisé comme solution de lecture ou de repli ; vérifiez l’obligation de facture structurée applicable à l’opération.");
  }

  return {
    ok: errors.length === 0,
    readiness: errors.length ? "blocked" : warnings.length ? "warning" : "ready",
    mode,
    sellerCountry,
    buyerCountry,
    profile,
    sellerEndpoint,
    buyerEndpoint,
    errors,
    warnings,
  };
}
