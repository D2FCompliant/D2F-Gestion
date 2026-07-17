export const SUPPORTED_ESTABLISHMENT_COUNTRIES = ["FR", "RS", "IT", "ES"] as const;

export function isSupportedEstablishmentCountry(value: unknown) {
  return (SUPPORTED_ESTABLISHMENT_COUNTRIES as readonly string[]).includes(String(value || "").trim().toUpperCase());
}

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

function luhnValid(value: string) {
  let sum = 0;
  let position = 0;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (position % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    position += 1;
  }
  return sum % 10 === 0;
}

function frenchSiretValid(value: string) {
  if (!/^\d{14}$/.test(value) || /^0+$/.test(value)) return false;
  if (value.startsWith("356000000")) {
    return [...value].reduce((sum, digit) => sum + Number(digit), 0) % 5 === 0;
  }
  return luhnValid(value);
}

function serbianPibValid(value: string) {
  if (!/^\d{9}$/.test(value) || /^0+$/.test(value)) return false;
  let product = 10;
  for (const digit of value.slice(0, 8)) {
    let sum = (Number(digit) + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }
  return (11 - product) % 10 === Number(value[8]);
}

function italianPartitaIvaValid(value: string) {
  if (!/^\d{11}$/.test(value) || /^0+$/.test(value)) return false;
  let sum = 0;
  for (let index = 0; index < 10; index += 1) {
    let digit = Number(value[index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === Number(value[10]);
}

function italianCodiceFiscaleValid(value: string) {
  if (!/^[A-Z0-9]{16}$/.test(value)) return false;
  const oddValues: Record<string, number> = {
    "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
    N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
  };
  let sum = 0;
  for (let index = 0; index < 15; index += 1) {
    const character = value[index];
    if (index % 2 === 0) sum += oddValues[character];
    else if (/\d/.test(character)) sum += Number(character);
    else sum += character.charCodeAt(0) - 65;
  }
  return String.fromCharCode(65 + (sum % 26)) === value[15];
}

function spanishNifValid(value: string) {
  const dniLetters = "TRWAGMYFPDXBNJZSQVHLCKE";
  if (/^\d{8}[A-Z]$/.test(value)) return dniLetters[Number(value.slice(0, 8)) % 23] === value[8];
  if (/^[XYZ]\d{7}[A-Z]$/.test(value)) {
    const number = Number(({ X: "0", Y: "1", Z: "2" } as Record<string, string>)[value[0]] + value.slice(1, 8));
    return dniLetters[number % 23] === value[8];
  }
  if (!/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value)) return false;
  let sum = 0;
  for (let index = 1; index <= 7; index += 1) {
    let digit = Number(value[index]);
    if (index % 2 === 1) {
      digit *= 2;
      digit = Math.floor(digit / 10) + (digit % 10);
    }
    sum += digit;
  }
  const control = (10 - (sum % 10)) % 10;
  const expected = "JABCDEFGHI"[control];
  const supplied = value[8];
  return supplied === String(control) || supplied === expected;
}

export function establishmentIdentifierChecksumValid(countryValue: unknown, value: unknown) {
  const country = normalizeCompanyCountry(countryValue);
  const identifier = normalizeEstablishmentIdentifier(country, value);
  if (country === "FR") return frenchSiretValid(identifier);
  if (country === "RS") return serbianPibValid(identifier);
  if (country === "IT") return italianPartitaIvaValid(identifier) || italianCodiceFiscaleValid(identifier);
  if (country === "ES") return spanishNifValid(identifier);
  return identifier.length >= 3;
}

export function validateEstablishmentIdentifier(countryValue: unknown, value: unknown) {
  const country = normalizeCompanyCountry(countryValue);
  if (!isSupportedEstablishmentCountry(country)) throw new Error("D2F Gestion accepte actuellement les établissements établis en France, Serbie, Italie ou Espagne");
  const identifier = normalizeEstablishmentIdentifier(country, value);
  if (country === "FR" && !/^\d{14}$/.test(identifier)) throw new Error("Le SIRET de l’établissement doit comporter exactement 14 chiffres");
  if (country === "RS" && !/^\d{9}$/.test(identifier)) throw new Error("Le PIB serbe doit comporter exactement 9 chiffres");
  if (country === "IT" && !/^(\d{11}|[A-Z0-9]{16})$/.test(identifier)) throw new Error("Indiquez une Partita IVA de 11 chiffres ou un Codice Fiscale valide");
  if (country === "ES" && !/^(\d{8}[A-Z]|[XYZ]\d{7}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])$/.test(identifier)) throw new Error("Le NIF espagnol indiqué n’est pas valide");
  if (identifier.length < 3) throw new Error("Identifiant d’établissement invalide");
  if (!establishmentIdentifierChecksumValid(country, identifier)) {
    const label = establishmentIdentifierType(country);
    throw new Error(`Le ${label} comporte une clé de contrôle invalide`);
  }
  return { country, identifier, identifierType: establishmentIdentifierType(country) };
}
