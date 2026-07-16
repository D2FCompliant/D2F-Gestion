export function normalizeCompanyCountry(value: unknown) {
  const country = String(value || "FR").trim().toUpperCase().slice(0, 2);
  return /^[A-Z]{2}$/.test(country) ? country : "OT";
}

export function normalizeEstablishmentIdentifier(countryValue: unknown, value: unknown) {
  const country = normalizeCompanyCountry(countryValue);
  let identifier = String(value || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9._-]/g, "").slice(0, 64);
  if (country === "IT") identifier = identifier.replace(/^IT/, "");
  return identifier;
}

export function establishmentIdentifierType(countryValue: unknown) {
  const country = normalizeCompanyCountry(countryValue);
  return ({ FR: "SIRET", RS: "PIB", IT: "PARTITA_IVA_OR_CF", ES: "NIF" } as Record<string, string>)[country] || "NATIONAL_ID";
}

export function validateEstablishmentIdentifier(countryValue: unknown, value: unknown) {
  const country = normalizeCompanyCountry(countryValue);
  const identifier = normalizeEstablishmentIdentifier(country, value);
  if (country === "FR" && !/^\d{14}$/.test(identifier)) throw new Error("Le SIRET de l’établissement doit comporter exactement 14 chiffres");
  if (country === "RS" && !/^\d{9}$/.test(identifier)) throw new Error("Le PIB serbe doit comporter exactement 9 chiffres");
  if (country === "IT" && !/^(\d{11}|[A-Z0-9]{16})$/.test(identifier)) throw new Error("Indiquez une Partita IVA de 11 chiffres ou un Codice Fiscale valide");
  if (country === "ES" && !/^[A-Z0-9][A-Z0-9._-]{7,11}$/.test(identifier)) throw new Error("Le NIF espagnol indiqué n’est pas valide");
  if (identifier.length < 3) throw new Error("Identifiant d’établissement invalide");
  return { country, identifier, identifierType: establishmentIdentifierType(country) };
}
