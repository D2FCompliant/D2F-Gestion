export type PortalLocale = "fr" | "en" | "sr" | "it" | "es";

export type PortalCopy = {
  brandTitle: string;
  brandLead: string;
  isolatedTitle: string;
  isolatedText: string;
  seatsTitle: string;
  seatsText: string;
  sessionTitle: string;
  sessionText: string;
  loginTab: string;
  signupTab: string;
  secureSpace: string;
  welcome: string;
  resetTitle: string;
  loginLead: string;
  resetLead: string;
  email: string;
  password: string;
  wait: string;
  login: string;
  sendLink: string;
  forgot: string;
  backToLogin: string;
  monthly: string;
  createSpace: string;
  signupLead: string;
  pricingPlan: string;
  pricingPeriod: string;
  pricingTax: string;
  pricingScope: string;
  pricingSeats: string;
  pricingIncluded: string;
  pricingExternal: string;
  pricingCommitment: string;
  companyName: string;
  country: string;
  ownerName: string;
  workEmail: string;
  confirmPassword: string;
  terms: string;
  paymentTerms: string;
  creating: string;
  createCompany: string;
  passwordSecurity: string;
  identifierScope: string;
  expectedConnection: string;
  passwordMismatch: string;
  loginError: string;
  signupError: string;
  signupNotice: string;
  identifierInvalid: string;
  language: string;
  countries: Record<string, string>;
  identifiers: Record<string, { label: string; placeholder: string }>;
  connectors: Record<string, string>;
};

export const portalCopies: Record<PortalLocale, PortalCopy> = {
  fr: {
    brandTitle: "La gestion conforme, établissement par établissement.",
    brandLead: "Facturation EN16931, paiements, audit et e-Reporting dans un espace sécurisé réservé à votre établissement facturant.",
    isolatedTitle: "Données isolées", isolatedText: "Un espace logique par établissement.",
    seatsTitle: "2 utilisateurs inclus", seatsText: "Un propriétaire et un collaborateur.",
    sessionTitle: "Session protégée", sessionText: "Déconnexion après 30 minutes d’inactivité.",
    loginTab: "Connexion", signupTab: "Créer un établissement", secureSpace: "ESPACE SÉCURISÉ",
    welcome: "Bienvenue", resetTitle: "Réinitialiser l’accès", loginLead: "Connectez-vous avec vos identifiants D2F.",
    resetLead: "Nous vous envoyons un lien sécurisé.", email: "Adresse e-mail", password: "Mot de passe",
    wait: "Veuillez patienter…", login: "Se connecter", sendLink: "Envoyer le lien", forgot: "Mot de passe oublié ?", backToLogin: "Retour à la connexion",
    monthly: "ABONNEMENT MENSUEL", createSpace: "Créer votre espace",
    signupLead: "La création ouvre uniquement le portail de règlement. L’application reste verrouillée jusqu’à validation du paiement par D2F.",
    pricingPlan: "Offre D2F Gestion", pricingPeriod: "/ mois et par établissement", pricingTax: "Prix hors taxes — TVA selon le pays et le statut fiscal.",
    pricingScope: "1 établissement facturant (un SIRET en France)", pricingSeats: "2 utilisateurs inclus", pricingIncluded: "Hébergement sécurisé, mises à jour et fonctions D2F Gestion inclus",
    pricingExternal: "Frais éventuels du connecteur réglementaire et de l’archivage probant non inclus", pricingCommitment: "Sans engagement · facturation mensuelle",
    companyName: "Raison sociale", country: "Pays de l’établissement", ownerName: "Nom du propriétaire", workEmail: "E-mail professionnel",
    confirmPassword: "Confirmer", terms: "Je confirme être autorisé à engager l’établissement et accepte le traitement des données nécessaire au service.",
    paymentTerms: "Je comprends que l’inscription ne vaut pas paiement : l’accès au logiciel sera activé seulement après déclaration puis validation du règlement.",
    creating: "Création…", createCompany: "Créer l’établissement", passwordSecurity: "Votre mot de passe est géré par Supabase Auth et n’est jamais enregistré par D2F Gestion.",
    identifierScope: "Un espace D2F correspond à un seul établissement facturant. En France, le SIRET — et non le seul SIREN — est donc obligatoire.",
    expectedConnection: "Connexion réglementaire attendue", passwordMismatch: "Les deux mots de passe ne correspondent pas", loginError: "Connexion impossible",
    signupError: "Inscription impossible", signupNotice: "Inscription enregistrée. Confirmez votre adresse e-mail.", identifierInvalid: "L’identifiant de l’établissement n’est pas valide pour le pays choisi.", language: "Langue",
    countries: { FR: "France", RS: "Serbie", IT: "Italie", ES: "Espagne", DE: "Allemagne", OTHER: "Autre" },
    identifiers: {
      FR: { label: "SIRET de l’établissement (14 chiffres)", placeholder: "12345678901234" },
      RS: { label: "PIB de l’entreprise (9 chiffres)", placeholder: "115028819" },
      IT: { label: "Partita IVA ou Codice Fiscale", placeholder: "IT12345678901" },
      ES: { label: "NIF de l’entreprise", placeholder: "B12345678" },
      DEFAULT: { label: "Identifiant national / TVA", placeholder: "Identifiant officiel de l’établissement" },
    },
    connectors: { FR: "Plateforme Agréée (PA)", RS: "Sistem eFaktura (SEF)", IT: "Sistema di Interscambio (SdI)", ES: "AEAT VERI*FACTU (et FACe pour le secteur public)", DEFAULT: "Profil EN16931 / connecteur national à qualifier" },
  },
  en: {
    brandTitle: "Compliant management, one establishment at a time.",
    brandLead: "EN16931 invoicing, payments, audit and e-reporting in a secure workspace dedicated to your invoicing establishment.",
    isolatedTitle: "Isolated data", isolatedText: "One logical workspace per establishment.",
    seatsTitle: "2 users included", seatsText: "One owner and one collaborator.",
    sessionTitle: "Protected session", sessionText: "Automatic sign-out after 30 minutes of inactivity.",
    loginTab: "Sign in", signupTab: "Create an establishment", secureSpace: "SECURE SPACE",
    welcome: "Welcome", resetTitle: "Reset access", loginLead: "Sign in with your D2F credentials.", resetLead: "We will send you a secure link.",
    email: "Email address", password: "Password", wait: "Please wait…", login: "Sign in", sendLink: "Send link", forgot: "Forgot your password?", backToLogin: "Back to sign in",
    monthly: "MONTHLY SUBSCRIPTION", createSpace: "Create your workspace", signupLead: "Creating the account only opens the payment portal. The application remains locked until D2F validates the payment.",
    pricingPlan: "D2F Gestion plan", pricingPeriod: "/ month per establishment", pricingTax: "Price excludes tax — VAT depends on country and tax status.",
    pricingScope: "1 invoicing establishment (one SIRET in France)", pricingSeats: "2 users included", pricingIncluded: "Secure hosting, updates and D2F Gestion features included",
    pricingExternal: "Any regulatory connector and probative archiving provider fees are not included", pricingCommitment: "No commitment · monthly billing",
    companyName: "Legal name", country: "Establishment country", ownerName: "Owner name", workEmail: "Business email", confirmPassword: "Confirm",
    terms: "I confirm that I am authorised to bind the establishment and accept the data processing required to provide the service.",
    paymentTerms: "I understand that registration is not payment: software access is activated only after the transfer is declared and then verified.",
    creating: "Creating…", createCompany: "Create establishment", passwordSecurity: "Your password is managed by Supabase Auth and is never stored by D2F Gestion.",
    identifierScope: "One D2F workspace represents one invoicing establishment. In France, the SIRET — not the SIREN alone — is therefore required.",
    expectedConnection: "Expected regulatory connection", passwordMismatch: "The two passwords do not match", loginError: "Unable to sign in", signupError: "Unable to register",
    signupNotice: "Registration saved. Confirm your email address.", identifierInvalid: "The establishment identifier is not valid for the selected country.", language: "Language",
    countries: { FR: "France", RS: "Serbia", IT: "Italy", ES: "Spain", DE: "Germany", OTHER: "Other" },
    identifiers: {
      FR: { label: "Establishment SIRET (14 digits)", placeholder: "12345678901234" }, RS: { label: "Company PIB (9 digits)", placeholder: "115028819" },
      IT: { label: "Partita IVA or Codice Fiscale", placeholder: "IT12345678901" }, ES: { label: "Company NIF", placeholder: "B12345678" },
      DEFAULT: { label: "National / VAT identifier", placeholder: "Official establishment identifier" },
    },
    connectors: { FR: "Approved Platform (PA)", RS: "Sistem eFaktura (SEF)", IT: "Sistema di Interscambio (SdI)", ES: "AEAT VERI*FACTU (and FACe for public-sector invoices)", DEFAULT: "EN16931 profile / national connector to be qualified" },
  },
  sr: {
    brandTitle: "Usklađeno upravljanje, za svako poslovno sedište.",
    brandLead: "EN16931 fakturisanje, plaćanja, revizija i e-izveštavanje u bezbednom prostoru vašeg izdavaoca faktura.",
    isolatedTitle: "Odvojeni podaci", isolatedText: "Jedan logički prostor po poslovnom sedištu.",
    seatsTitle: "2 korisnika uključena", seatsText: "Jedan vlasnik i jedan saradnik.",
    sessionTitle: "Zaštićena sesija", sessionText: "Automatska odjava posle 30 minuta neaktivnosti.",
    loginTab: "Prijava", signupTab: "Kreiraj preduzeće", secureSpace: "BEZBEDAN PROSTOR", welcome: "Dobro došli", resetTitle: "Obnovi pristup",
    loginLead: "Prijavite se D2F podacima.", resetLead: "Poslaćemo vam bezbednu vezu.", email: "E-adresa", password: "Lozinka", wait: "Sačekajte…", login: "Prijavi se", sendLink: "Pošalji vezu", forgot: "Zaboravljena lozinka?", backToLogin: "Nazad na prijavu",
    monthly: "MESEČNA PRETPLATA", createSpace: "Kreirajte svoj prostor", signupLead: "Kreiranje otvara samo portal za plaćanje. Aplikacija ostaje zaključana dok D2F ne potvrdi uplatu.",
    pricingPlan: "D2F Gestion paket", pricingPeriod: "/ mesečno po poslovnom sedištu", pricingTax: "Cena ne uključuje porez — PDV zavisi od zemlje i poreskog statusa.",
    pricingScope: "1 izdavalac faktura (jedan SIRET u Francuskoj)", pricingSeats: "2 korisnika uključena", pricingIncluded: "Bezbedan hosting, ažuriranja i D2F Gestion funkcije su uključeni",
    pricingExternal: "Troškovi regulatornog konektora i kvalifikovanog arhiviranja nisu uključeni", pricingCommitment: "Bez obaveze · mesečna naplata",
    companyName: "Poslovno ime", country: "Država preduzeća", ownerName: "Ime vlasnika", workEmail: "Poslovna e-adresa", confirmPassword: "Potvrda",
    terms: "Potvrđujem da sam ovlašćen da zastupam preduzeće i prihvatam obradu podataka potrebnu za uslugu.", paymentTerms: "Razumem da registracija nije plaćanje: pristup se aktivira tek nakon prijave i D2F potvrde uplate.",
    creating: "Kreiranje…", createCompany: "Kreiraj preduzeće", passwordSecurity: "Lozinkom upravlja Supabase Auth i D2F Gestion je nikada ne čuva.",
    identifierScope: "Jedan D2F prostor predstavlja jednog izdavaoca faktura. Za Srbiju je obavezan PIB.", expectedConnection: "Očekivana regulatorna veza",
    passwordMismatch: "Lozinke se ne podudaraju", loginError: "Prijava nije uspela", signupError: "Registracija nije uspela", signupNotice: "Registracija je sačuvana. Potvrdite e-adresu.", identifierInvalid: "Identifikator nije ispravan za izabranu državu.", language: "Jezik",
    countries: { FR: "Francuska", RS: "Srbija", IT: "Italija", ES: "Španija", DE: "Nemačka", OTHER: "Drugo" },
    identifiers: { FR: { label: "SIRET sedišta (14 cifara)", placeholder: "12345678901234" }, RS: { label: "PIB preduzeća (9 cifara)", placeholder: "115028819" }, IT: { label: "Partita IVA ili Codice Fiscale", placeholder: "IT12345678901" }, ES: { label: "NIF preduzeća", placeholder: "B12345678" }, DEFAULT: { label: "Nacionalni / PDV identifikator", placeholder: "Zvanični identifikator" } },
    connectors: { FR: "Odobrena platforma (PA)", RS: "Sistem eFaktura (SEF)", IT: "Sistema di Interscambio (SdI)", ES: "AEAT VERI*FACTU (i FACe za javni sektor)", DEFAULT: "EN16931 profil / nacionalni konektor za proveru" },
  },
  it: {
    brandTitle: "Gestione conforme, sede per sede.", brandLead: "Fatturazione EN16931, pagamenti, audit ed e-reporting in uno spazio sicuro dedicato alla sede che emette fatture.",
    isolatedTitle: "Dati isolati", isolatedText: "Uno spazio logico per ogni sede.", seatsTitle: "2 utenti inclusi", seatsText: "Un proprietario e un collaboratore.", sessionTitle: "Sessione protetta", sessionText: "Disconnessione dopo 30 minuti di inattività.",
    loginTab: "Accedi", signupTab: "Crea una sede", secureSpace: "SPAZIO SICURO", welcome: "Benvenuto", resetTitle: "Reimposta accesso", loginLead: "Accedi con le credenziali D2F.", resetLead: "Ti invieremo un collegamento sicuro.", email: "Indirizzo e-mail", password: "Password", wait: "Attendere…", login: "Accedi", sendLink: "Invia link", forgot: "Password dimenticata?", backToLogin: "Torna all’accesso",
    monthly: "ABBONAMENTO MENSILE", createSpace: "Crea il tuo spazio", signupLead: "La creazione apre soltanto il portale di pagamento. L’applicazione resta bloccata finché D2F non convalida il pagamento.",
    pricingPlan: "Piano D2F Gestion", pricingPeriod: "/ mese per sede", pricingTax: "Prezzo al netto delle imposte — IVA secondo il Paese e lo status fiscale.",
    pricingScope: "1 sede di fatturazione (un SIRET in Francia)", pricingSeats: "2 utenti inclusi", pricingIncluded: "Hosting sicuro, aggiornamenti e funzioni D2F Gestion inclusi",
    pricingExternal: "Eventuali costi del connettore normativo e dell’archiviazione probatoria non inclusi", pricingCommitment: "Senza impegno · fatturazione mensile",
    companyName: "Ragione sociale", country: "Paese della sede", ownerName: "Nome del proprietario", workEmail: "E-mail aziendale", confirmPassword: "Conferma",
    terms: "Confermo di essere autorizzato a impegnare la sede e accetto il trattamento dei dati necessario al servizio.", paymentTerms: "Comprendo che la registrazione non equivale al pagamento: l’accesso viene attivato solo dopo la dichiarazione e la verifica del bonifico.",
    creating: "Creazione…", createCompany: "Crea la sede", passwordSecurity: "La password è gestita da Supabase Auth e non viene mai memorizzata da D2F Gestion.",
    identifierScope: "Uno spazio D2F corrisponde a una sola sede di fatturazione.", expectedConnection: "Connessione normativa prevista", passwordMismatch: "Le password non coincidono", loginError: "Accesso non riuscito", signupError: "Registrazione non riuscita", signupNotice: "Registrazione salvata. Conferma l’indirizzo e-mail.", identifierInvalid: "L’identificativo non è valido per il Paese selezionato.", language: "Lingua",
    countries: { FR: "Francia", RS: "Serbia", IT: "Italia", ES: "Spagna", DE: "Germania", OTHER: "Altro" },
    identifiers: { FR: { label: "SIRET della sede (14 cifre)", placeholder: "12345678901234" }, RS: { label: "PIB dell’impresa (9 cifre)", placeholder: "115028819" }, IT: { label: "Partita IVA o Codice Fiscale", placeholder: "IT12345678901" }, ES: { label: "NIF dell’impresa", placeholder: "B12345678" }, DEFAULT: { label: "Identificativo nazionale / IVA", placeholder: "Identificativo ufficiale della sede" } },
    connectors: { FR: "Plateforme Agréée (PA)", RS: "Sistem eFaktura (SEF)", IT: "Sistema di Interscambio (SdI)", ES: "AEAT VERI*FACTU (e FACe per il settore pubblico)", DEFAULT: "Profilo EN16931 / connettore nazionale da qualificare" },
  },
  es: {
    brandTitle: "Gestión conforme, establecimiento por establecimiento.", brandLead: "Facturación EN16931, pagos, auditoría y e-reporting en un espacio seguro dedicado al establecimiento emisor.",
    isolatedTitle: "Datos aislados", isolatedText: "Un espacio lógico por establecimiento.", seatsTitle: "2 usuarios incluidos", seatsText: "Un propietario y un colaborador.", sessionTitle: "Sesión protegida", sessionText: "Desconexión tras 30 minutos de inactividad.",
    loginTab: "Acceder", signupTab: "Crear establecimiento", secureSpace: "ESPACIO SEGURO", welcome: "Bienvenido", resetTitle: "Restablecer acceso", loginLead: "Acceda con sus credenciales D2F.", resetLead: "Le enviaremos un enlace seguro.", email: "Correo electrónico", password: "Contraseña", wait: "Espere…", login: "Acceder", sendLink: "Enviar enlace", forgot: "¿Olvidó la contraseña?", backToLogin: "Volver al acceso",
    monthly: "SUSCRIPCIÓN MENSUAL", createSpace: "Cree su espacio", signupLead: "La creación solo abre el portal de pago. La aplicación permanece bloqueada hasta que D2F valide el pago.",
    pricingPlan: "Plan D2F Gestion", pricingPeriod: "/ mes por establecimiento", pricingTax: "Precio sin impuestos — IVA según el país y la situación fiscal.",
    pricingScope: "1 establecimiento emisor (un SIRET en Francia)", pricingSeats: "2 usuarios incluidos", pricingIncluded: "Alojamiento seguro, actualizaciones y funciones de D2F Gestion incluidos",
    pricingExternal: "No incluye posibles costes del conector normativo ni del archivo probatorio", pricingCommitment: "Sin permanencia · facturación mensual",
    companyName: "Razón social", country: "País del establecimiento", ownerName: "Nombre del propietario", workEmail: "Correo profesional", confirmPassword: "Confirmar",
    terms: "Confirmo que estoy autorizado para representar al establecimiento y acepto el tratamiento de datos necesario para el servicio.", paymentTerms: "Entiendo que registrarse no equivale a pagar: el acceso solo se activa tras declarar y verificar la transferencia.",
    creating: "Creando…", createCompany: "Crear establecimiento", passwordSecurity: "La contraseña la gestiona Supabase Auth y D2F Gestion nunca la almacena.",
    identifierScope: "Un espacio D2F corresponde a un único establecimiento emisor.", expectedConnection: "Conexión normativa prevista", passwordMismatch: "Las contraseñas no coinciden", loginError: "No se puede acceder", signupError: "No se puede registrar", signupNotice: "Registro guardado. Confirme su correo electrónico.", identifierInvalid: "El identificador no es válido para el país seleccionado.", language: "Idioma",
    countries: { FR: "Francia", RS: "Serbia", IT: "Italia", ES: "España", DE: "Alemania", OTHER: "Otro" },
    identifiers: { FR: { label: "SIRET del establecimiento (14 dígitos)", placeholder: "12345678901234" }, RS: { label: "PIB de la empresa (9 dígitos)", placeholder: "115028819" }, IT: { label: "Partita IVA o Codice Fiscale", placeholder: "IT12345678901" }, ES: { label: "NIF de la empresa", placeholder: "B12345678" }, DEFAULT: { label: "Identificador nacional / IVA", placeholder: "Identificador oficial del establecimiento" } },
    connectors: { FR: "Plateforme Agréée (PA)", RS: "Sistem eFaktura (SEF)", IT: "Sistema di Interscambio (SdI)", ES: "AEAT VERI*FACTU (y FACe para el sector público)", DEFAULT: "Perfil EN16931 / conector nacional pendiente de cualificación" },
  },
};

export function normalizePortalLocale(value: unknown): PortalLocale {
  const locale = String(value || "fr").toLowerCase().slice(0, 2);
  return (["fr", "en", "sr", "it", "es"] as PortalLocale[]).includes(locale as PortalLocale) ? locale as PortalLocale : "fr";
}

export function normalizePortalIdentifier(country: string, value: unknown) {
  const normalized = String(value || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9._-]/g, "").slice(0, 64);
  if (country === "IT") return normalized.replace(/^IT/, "");
  return normalized;
}

export function portalIdentifierIsValid(country: string, value: unknown) {
  const normalized = normalizePortalIdentifier(country, value);
  if (country === "FR") return /^\d{14}$/.test(normalized);
  if (country === "RS") return /^\d{9}$/.test(normalized);
  if (country === "IT") return /^(\d{11}|[A-Z0-9]{16})$/.test(normalized);
  if (country === "ES") return /^[A-Z0-9][A-Z0-9._-]{7,11}$/.test(normalized);
  return normalized.length >= 3;
}
