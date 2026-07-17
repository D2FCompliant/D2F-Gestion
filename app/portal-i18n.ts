import { normalizeEstablishmentIdentifier, validateEstablishmentIdentifier } from "../lib/company-identifiers";

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
  trialTitle: string;
  trialText: string;
  discoverTitle: string;
  linkedinPosts: string;
  d2fWebsite: string;
  requestRecorded: string;
  paymentInstructions: string;
  paymentAfterConfirmation: string;
  bankName: string;
  beneficiary: string;
  mandatoryReference: string;
  sepaTransfer: string;
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
  pricingMonthlyLabel: string;
  pricingMonthlyNote: string;
  pricingAnnualLabel: string;
  pricingAnnualPeriod: string;
  pricingAnnualNote: string;
  pricingAnnualSaving: string;
  pricingNoAutoRenewal: string;
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
  identifierChecking: string;
  identifierVerified: string;
  identifierRegistryUnavailable: string;
  identifierClosed: string;
  identifierCheckPrompt: string;
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
    trialTitle: "Essai gratuit de 14 jours.", trialText: "Accordé une seule fois par D2F, sans paiement préalable ; l’accès se verrouille à l’échéance sans règlement validé.",
    discoverTitle: "Découvrir l’expertise D2F", linkedinPosts: "Nos analyses sur LinkedIn", d2fWebsite: "Site D2F Compliant",
    requestRecorded: "DEMANDE ENREGISTRÉE", paymentInstructions: "Coordonnées de règlement D2F", paymentAfterConfirmation: "Confirmez d’abord votre adresse e-mail. Vous pourrez demander l’essai ou effectuer le virement avec la référence ci-dessous.",
    bankName: "Banque", beneficiary: "Bénéficiaire", mandatoryReference: "Référence obligatoire", sepaTransfer: "Virement SEPA en euros disponible selon la banque émettrice ; il ne s’agit pas d’un prélèvement automatique.",
    loginTab: "Connexion", signupTab: "Créer un établissement", secureSpace: "ESPACE SÉCURISÉ",
    welcome: "Bienvenue", resetTitle: "Réinitialiser l’accès", loginLead: "Connectez-vous avec vos identifiants D2F.",
    resetLead: "Nous vous envoyons un lien sécurisé.", email: "Adresse e-mail", password: "Mot de passe",
    wait: "Veuillez patienter…", login: "Se connecter", sendLink: "Envoyer le lien", forgot: "Mot de passe oublié ?", backToLogin: "Retour à la connexion",
    monthly: "OFFRES D2F GESTION", createSpace: "Créer votre espace",
    signupLead: "La création enregistre une demande. D2F peut ensuite accorder un essai unique de 14 jours ou activer l’abonnement après validation du paiement.",
    pricingPlan: "Offre D2F Gestion", pricingPeriod: "/ mois et par établissement", pricingTax: "Prix hors taxes — TVA selon le pays et le statut fiscal.",
    pricingScope: "1 établissement facturant (un SIRET en France)", pricingSeats: "2 utilisateurs inclus", pricingIncluded: "Hébergement sécurisé, mises à jour et fonctions D2F Gestion inclus",
    pricingExternal: "Frais éventuels du connecteur réglementaire et de l’archivage probant non inclus", pricingCommitment: "Deux formules transparentes",
    pricingMonthlyLabel: "Mensuel", pricingMonthlyNote: "Sans engagement", pricingAnnualLabel: "Annuel", pricingAnnualPeriod: "/ an", pricingAnnualNote: "Engagement 12 mois", pricingAnnualSaving: "58 € économisés par an", pricingNoAutoRenewal: "Aucun prélèvement automatique : arrêt possible à tout moment, avec accès conservé jusqu’au terme déjà réglé.",
    companyName: "Raison sociale", country: "Pays de l’établissement", ownerName: "Nom du propriétaire", workEmail: "E-mail professionnel",
    confirmPassword: "Confirmer", terms: "Je confirme être autorisé à engager l’établissement et accepte le traitement des données nécessaire au service.",
    paymentTerms: "Je comprends que seule D2F peut activer l’essai ou l’abonnement, après contrôle de la demande ou du règlement.",
    creating: "Création…", createCompany: "Créer l’établissement", passwordSecurity: "Votre mot de passe est géré par Supabase Auth et n’est jamais enregistré par D2F Gestion.",
    identifierScope: "Un espace D2F correspond à un seul établissement facturant. En France, le SIRET — et non le seul SIREN — est donc obligatoire.",
    expectedConnection: "Connexion réglementaire attendue", passwordMismatch: "Les deux mots de passe ne correspondent pas", loginError: "Connexion impossible",
    signupError: "Inscription impossible", signupNotice: "Inscription enregistrée. Confirmez votre adresse e-mail.", identifierInvalid: "L’identifiant comporte un format ou une clé de contrôle invalide.", identifierChecking: "Contrôle de l’identifiant…", identifierVerified: "Format et clé de contrôle validés", identifierRegistryUnavailable: "Clé valide ; le registre public n’a pas pu être interrogé. Un contrôle sera requis avant transmission.", identifierClosed: "Cet établissement est indiqué comme fermé dans le registre public.", identifierCheckPrompt: "Contrôler l’identifiant", language: "Langue",
    countries: { FR: "France", RS: "Serbie", IT: "Italie", ES: "Espagne" },
    identifiers: {
      FR: { label: "SIRET de l’établissement (14 chiffres)", placeholder: "13002526500013" },
      RS: { label: "PIB de l’entreprise (9 chiffres)", placeholder: "115028819" },
      IT: { label: "Partita IVA ou Codice Fiscale", placeholder: "12345678903" },
      ES: { label: "NIF de l’entreprise", placeholder: "B12345674" },
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
    trialTitle: "14-day free trial.", trialText: "Granted once by D2F without upfront payment; access is locked at expiry unless payment has been approved.",
    discoverTitle: "Discover D2F expertise", linkedinPosts: "Our LinkedIn insights", d2fWebsite: "D2F Compliant website",
    requestRecorded: "REQUEST RECORDED", paymentInstructions: "D2F payment details", paymentAfterConfirmation: "Confirm your email first. You can then request the trial or make the transfer using the reference below.",
    bankName: "Bank", beneficiary: "Beneficiary", mandatoryReference: "Mandatory reference", sepaTransfer: "SEPA euro credit transfer is available subject to the sending bank; this is not an automatic direct debit.",
    loginTab: "Sign in", signupTab: "Create an establishment", secureSpace: "SECURE SPACE",
    welcome: "Welcome", resetTitle: "Reset access", loginLead: "Sign in with your D2F credentials.", resetLead: "We will send you a secure link.",
    email: "Email address", password: "Password", wait: "Please wait…", login: "Sign in", sendLink: "Send link", forgot: "Forgot your password?", backToLogin: "Back to sign in",
    monthly: "D2F GESTION PLANS", createSpace: "Create your workspace", signupLead: "Creating the account records a request. D2F may then grant one 14-day trial or activate the subscription after payment approval.",
    pricingPlan: "D2F Gestion plan", pricingPeriod: "/ month per establishment", pricingTax: "Price excludes tax — VAT depends on country and tax status.",
    pricingScope: "1 invoicing establishment (one SIRET in France)", pricingSeats: "2 users included", pricingIncluded: "Secure hosting, updates and D2F Gestion features included",
    pricingExternal: "Any regulatory connector and probative archiving provider fees are not included", pricingCommitment: "Two transparent plans",
    pricingMonthlyLabel: "Monthly", pricingMonthlyNote: "No commitment", pricingAnnualLabel: "Annual", pricingAnnualPeriod: "/ year", pricingAnnualNote: "12-month commitment", pricingAnnualSaving: "Save €58 per year", pricingNoAutoRenewal: "No automatic debit: stop at any time and retain access until the end of the period already paid.",
    companyName: "Legal name", country: "Establishment country", ownerName: "Owner name", workEmail: "Business email", confirmPassword: "Confirm",
    terms: "I confirm that I am authorised to bind the establishment and accept the data processing required to provide the service.",
    paymentTerms: "I understand that only D2F can activate the trial or subscription after reviewing the request or payment.",
    creating: "Creating…", createCompany: "Create establishment", passwordSecurity: "Your password is managed by Supabase Auth and is never stored by D2F Gestion.",
    identifierScope: "One D2F workspace represents one invoicing establishment. In France, the SIRET — not the SIREN alone — is therefore required.",
    expectedConnection: "Expected regulatory connection", passwordMismatch: "The two passwords do not match", loginError: "Unable to sign in", signupError: "Unable to register",
    signupNotice: "Registration saved. Confirm your email address.", identifierInvalid: "The identifier format or checksum is invalid.", identifierChecking: "Checking identifier…", identifierVerified: "Format and checksum validated", identifierRegistryUnavailable: "Checksum valid; the public registry could not be reached. Verification is required before transmission.", identifierClosed: "The public registry lists this establishment as closed.", identifierCheckPrompt: "Check identifier", language: "Language",
    countries: { FR: "France", RS: "Serbia", IT: "Italy", ES: "Spain" },
    identifiers: {
      FR: { label: "Establishment SIRET (14 digits)", placeholder: "13002526500013" }, RS: { label: "Company PIB (9 digits)", placeholder: "115028819" },
      IT: { label: "Partita IVA or Codice Fiscale", placeholder: "12345678903" }, ES: { label: "Company NIF", placeholder: "B12345674" },
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
    trialTitle: "Besplatna proba od 14 dana.", trialText: "D2F je odobrava samo jednom, bez plaćanja unapred; pristup se zaključava po isteku ako uplata nije potvrđena.",
    discoverTitle: "Upoznajte D2F stručnost", linkedinPosts: "Naše LinkedIn analize", d2fWebsite: "D2F Compliant sajt",
    requestRecorded: "ZAHTEV JE EVIDENTIRAN", paymentInstructions: "D2F podaci za plaćanje", paymentAfterConfirmation: "Prvo potvrdite e-adresu. Zatim možete zatražiti probu ili izvršiti uplatu uz obaveznu referencu.",
    bankName: "Banka", beneficiary: "Primalac", mandatoryReference: "Obavezna referenca", sepaTransfer: "SEPA transfer u evrima dostupan je u zavisnosti od banke pošiljaoca; nije automatsko direktno zaduženje.",
    loginTab: "Prijava", signupTab: "Kreiraj preduzeće", secureSpace: "BEZBEDAN PROSTOR", welcome: "Dobro došli", resetTitle: "Obnovi pristup",
    loginLead: "Prijavite se D2F podacima.", resetLead: "Poslaćemo vam bezbednu vezu.", email: "E-adresa", password: "Lozinka", wait: "Sačekajte…", login: "Prijavi se", sendLink: "Pošalji vezu", forgot: "Zaboravljena lozinka?", backToLogin: "Nazad na prijavu",
    monthly: "D2F GESTION PAKETI", createSpace: "Kreirajte svoj prostor", signupLead: "Kreiranje evidentira zahtev. D2F zatim može odobriti jednu probu od 14 dana ili aktivirati pretplatu nakon potvrde uplate.",
    pricingPlan: "D2F Gestion paket", pricingPeriod: "/ mesečno po poslovnom sedištu", pricingTax: "Cena ne uključuje porez — PDV zavisi od zemlje i poreskog statusa.",
    pricingScope: "1 izdavalac faktura (jedan SIRET u Francuskoj)", pricingSeats: "2 korisnika uključena", pricingIncluded: "Bezbedan hosting, ažuriranja i D2F Gestion funkcije su uključeni",
    pricingExternal: "Troškovi regulatornog konektora i kvalifikovanog arhiviranja nisu uključeni", pricingCommitment: "Dve transparentne opcije",
    pricingMonthlyLabel: "Mesečno", pricingMonthlyNote: "Bez obaveze", pricingAnnualLabel: "Godišnje", pricingAnnualPeriod: "/ godišnje", pricingAnnualNote: "Obaveza 12 meseci", pricingAnnualSaving: "Ušteda 58 € godišnje", pricingNoAutoRenewal: "Bez automatskog zaduženja: prekid je moguć u svakom trenutku, uz pristup do kraja već plaćenog perioda.",
    companyName: "Poslovno ime", country: "Država preduzeća", ownerName: "Ime vlasnika", workEmail: "Poslovna e-adresa", confirmPassword: "Potvrda",
    terms: "Potvrđujem da sam ovlašćen da zastupam preduzeće i prihvatam obradu podataka potrebnu za uslugu.", paymentTerms: "Razumem da samo D2F može aktivirati probu ili pretplatu nakon provere zahteva ili uplate.",
    creating: "Kreiranje…", createCompany: "Kreiraj preduzeće", passwordSecurity: "Lozinkom upravlja Supabase Auth i D2F Gestion je nikada ne čuva.",
    identifierScope: "Jedan D2F prostor predstavlja jednog izdavaoca faktura. Za Srbiju je obavezan PIB.", expectedConnection: "Očekivana regulatorna veza",
    passwordMismatch: "Lozinke se ne podudaraju", loginError: "Prijava nije uspela", signupError: "Registracija nije uspela", signupNotice: "Registracija je sačuvana. Potvrdite e-adresu.", identifierInvalid: "Format ili kontrolna cifra identifikatora nisu ispravni.", identifierChecking: "Provera identifikatora…", identifierVerified: "Format i kontrolna cifra su potvrđeni", identifierRegistryUnavailable: "Kontrolna cifra je ispravna; javni registar nije dostupan. Provera je obavezna pre slanja.", identifierClosed: "Javni registar navodi da je preduzeće zatvoreno.", identifierCheckPrompt: "Proveri identifikator", language: "Jezik",
    countries: { FR: "Francuska", RS: "Srbija", IT: "Italija", ES: "Španija" },
    identifiers: { FR: { label: "SIRET sedišta (14 cifara)", placeholder: "13002526500013" }, RS: { label: "PIB preduzeća (9 cifara)", placeholder: "115028819" }, IT: { label: "Partita IVA ili Codice Fiscale", placeholder: "12345678903" }, ES: { label: "NIF preduzeća", placeholder: "B12345674" }, DEFAULT: { label: "Nacionalni / PDV identifikator", placeholder: "Zvanični identifikator" } },
    connectors: { FR: "Odobrena platforma (PA)", RS: "Sistem eFaktura (SEF)", IT: "Sistema di Interscambio (SdI)", ES: "AEAT VERI*FACTU (i FACe za javni sektor)", DEFAULT: "EN16931 profil / nacionalni konektor za proveru" },
  },
  it: {
    brandTitle: "Gestione conforme, sede per sede.", brandLead: "Fatturazione EN16931, pagamenti, audit ed e-reporting in uno spazio sicuro dedicato alla sede che emette fatture.",
    isolatedTitle: "Dati isolati", isolatedText: "Uno spazio logico per ogni sede.", seatsTitle: "2 utenti inclusi", seatsText: "Un proprietario e un collaboratore.", sessionTitle: "Sessione protetta", sessionText: "Disconnessione dopo 30 minuti di inattività.",
    trialTitle: "Prova gratuita di 14 giorni.", trialText: "Concessa una sola volta da D2F senza pagamento anticipato; l’accesso viene bloccato alla scadenza se il pagamento non è convalidato.",
    discoverTitle: "Scopri l’esperienza D2F", linkedinPosts: "Le nostre analisi su LinkedIn", d2fWebsite: "Sito D2F Compliant",
    requestRecorded: "RICHIESTA REGISTRATA", paymentInstructions: "Coordinate di pagamento D2F", paymentAfterConfirmation: "Conferma prima l’indirizzo e-mail. Potrai quindi richiedere la prova o effettuare il bonifico con il riferimento indicato.",
    bankName: "Banca", beneficiary: "Beneficiario", mandatoryReference: "Riferimento obbligatorio", sepaTransfer: "Bonifico SEPA in euro disponibile secondo la banca mittente; non è un addebito diretto automatico.",
    loginTab: "Accedi", signupTab: "Crea una sede", secureSpace: "SPAZIO SICURO", welcome: "Benvenuto", resetTitle: "Reimposta accesso", loginLead: "Accedi con le credenziali D2F.", resetLead: "Ti invieremo un collegamento sicuro.", email: "Indirizzo e-mail", password: "Password", wait: "Attendere…", login: "Accedi", sendLink: "Invia link", forgot: "Password dimenticata?", backToLogin: "Torna all’accesso",
    monthly: "PIANI D2F GESTION", createSpace: "Crea il tuo spazio", signupLead: "La creazione registra una richiesta. D2F può quindi concedere una prova unica di 14 giorni o attivare l’abbonamento dopo la convalida del pagamento.",
    pricingPlan: "Piano D2F Gestion", pricingPeriod: "/ mese per sede", pricingTax: "Prezzo al netto delle imposte — IVA secondo il Paese e lo status fiscale.",
    pricingScope: "1 sede di fatturazione (un SIRET in Francia)", pricingSeats: "2 utenti inclusi", pricingIncluded: "Hosting sicuro, aggiornamenti e funzioni D2F Gestion inclusi",
    pricingExternal: "Eventuali costi del connettore normativo e dell’archiviazione probatoria non inclusi", pricingCommitment: "Due formule trasparenti",
    pricingMonthlyLabel: "Mensile", pricingMonthlyNote: "Senza impegno", pricingAnnualLabel: "Annuale", pricingAnnualPeriod: "/ anno", pricingAnnualNote: "Impegno di 12 mesi", pricingAnnualSaving: "Risparmio di 58 € all’anno", pricingNoAutoRenewal: "Nessun addebito automatico: recesso possibile in qualsiasi momento, con accesso fino alla fine del periodo già pagato.",
    companyName: "Ragione sociale", country: "Paese della sede", ownerName: "Nome del proprietario", workEmail: "E-mail aziendale", confirmPassword: "Conferma",
    terms: "Confermo di essere autorizzato a impegnare la sede e accetto il trattamento dei dati necessario al servizio.", paymentTerms: "Comprendo che solo D2F può attivare la prova o l’abbonamento dopo il controllo della richiesta o del pagamento.",
    creating: "Creazione…", createCompany: "Crea la sede", passwordSecurity: "La password è gestita da Supabase Auth e non viene mai memorizzata da D2F Gestion.",
    identifierScope: "Uno spazio D2F corrisponde a una sola sede di fatturazione.", expectedConnection: "Connessione normativa prevista", passwordMismatch: "Le password non coincidono", loginError: "Accesso non riuscito", signupError: "Registrazione non riuscita", signupNotice: "Registrazione salvata. Conferma l’indirizzo e-mail.", identifierInvalid: "Il formato o il codice di controllo non è valido.", identifierChecking: "Verifica dell’identificativo…", identifierVerified: "Formato e codice di controllo convalidati", identifierRegistryUnavailable: "Codice di controllo valido; il registro pubblico non è disponibile. La verifica sarà necessaria prima dell’invio.", identifierClosed: "Il registro pubblico indica che la sede è chiusa.", identifierCheckPrompt: "Verifica identificativo", language: "Lingua",
    countries: { FR: "Francia", RS: "Serbia", IT: "Italia", ES: "Spagna" },
    identifiers: { FR: { label: "SIRET della sede (14 cifre)", placeholder: "13002526500013" }, RS: { label: "PIB dell’impresa (9 cifre)", placeholder: "115028819" }, IT: { label: "Partita IVA o Codice Fiscale", placeholder: "12345678903" }, ES: { label: "NIF dell’impresa", placeholder: "B12345674" }, DEFAULT: { label: "Identificativo nazionale / IVA", placeholder: "Identificativo ufficiale della sede" } },
    connectors: { FR: "Plateforme Agréée (PA)", RS: "Sistem eFaktura (SEF)", IT: "Sistema di Interscambio (SdI)", ES: "AEAT VERI*FACTU (e FACe per il settore pubblico)", DEFAULT: "Profilo EN16931 / connettore nazionale da qualificare" },
  },
  es: {
    brandTitle: "Gestión conforme, establecimiento por establecimiento.", brandLead: "Facturación EN16931, pagos, auditoría y e-reporting en un espacio seguro dedicado al establecimiento emisor.",
    isolatedTitle: "Datos aislados", isolatedText: "Un espacio lógico por establecimiento.", seatsTitle: "2 usuarios incluidos", seatsText: "Un propietario y un colaborador.", sessionTitle: "Sesión protegida", sessionText: "Desconexión tras 30 minutos de inactividad.",
    trialTitle: "Prueba gratuita de 14 días.", trialText: "Concedida una sola vez por D2F sin pago anticipado; el acceso se bloquea al vencer si el pago no está validado.",
    discoverTitle: "Descubra la experiencia D2F", linkedinPosts: "Nuestros análisis en LinkedIn", d2fWebsite: "Sitio D2F Compliant",
    requestRecorded: "SOLICITUD REGISTRADA", paymentInstructions: "Datos de pago de D2F", paymentAfterConfirmation: "Confirme primero su correo electrónico. Después podrá solicitar la prueba o realizar la transferencia con la referencia indicada.",
    bankName: "Banco", beneficiary: "Beneficiario", mandatoryReference: "Referencia obligatoria", sepaTransfer: "Transferencia SEPA en euros disponible según el banco emisor; no es una domiciliación automática.",
    loginTab: "Acceder", signupTab: "Crear establecimiento", secureSpace: "ESPACIO SEGURO", welcome: "Bienvenido", resetTitle: "Restablecer acceso", loginLead: "Acceda con sus credenciales D2F.", resetLead: "Le enviaremos un enlace seguro.", email: "Correo electrónico", password: "Contraseña", wait: "Espere…", login: "Acceder", sendLink: "Enviar enlace", forgot: "¿Olvidó la contraseña?", backToLogin: "Volver al acceso",
    monthly: "PLANES D2F GESTION", createSpace: "Cree su espacio", signupLead: "La creación registra una solicitud. D2F puede conceder una prueba única de 14 días o activar la suscripción tras validar el pago.",
    pricingPlan: "Plan D2F Gestion", pricingPeriod: "/ mes por establecimiento", pricingTax: "Precio sin impuestos — IVA según el país y la situación fiscal.",
    pricingScope: "1 establecimiento emisor (un SIRET en Francia)", pricingSeats: "2 usuarios incluidos", pricingIncluded: "Alojamiento seguro, actualizaciones y funciones de D2F Gestion incluidos",
    pricingExternal: "No incluye posibles costes del conector normativo ni del archivo probatorio", pricingCommitment: "Dos planes transparentes",
    pricingMonthlyLabel: "Mensual", pricingMonthlyNote: "Sin permanencia", pricingAnnualLabel: "Anual", pricingAnnualPeriod: "/ año", pricingAnnualNote: "Compromiso de 12 meses", pricingAnnualSaving: "Ahorro de 58 € al año", pricingNoAutoRenewal: "Sin domiciliación automática: cancelación posible en cualquier momento, con acceso hasta el final del período ya pagado.",
    companyName: "Razón social", country: "País del establecimiento", ownerName: "Nombre del propietario", workEmail: "Correo profesional", confirmPassword: "Confirmar",
    terms: "Confirmo que estoy autorizado para representar al establecimiento y acepto el tratamiento de datos necesario para el servicio.", paymentTerms: "Entiendo que solo D2F puede activar la prueba o la suscripción tras revisar la solicitud o el pago.",
    creating: "Creando…", createCompany: "Crear establecimiento", passwordSecurity: "La contraseña la gestiona Supabase Auth y D2F Gestion nunca la almacena.",
    identifierScope: "Un espacio D2F corresponde a un único establecimiento emisor.", expectedConnection: "Conexión normativa prevista", passwordMismatch: "Las contraseñas no coinciden", loginError: "No se puede acceder", signupError: "No se puede registrar", signupNotice: "Registro guardado. Confirme su correo electrónico.", identifierInvalid: "El formato o dígito de control no es válido.", identifierChecking: "Comprobando identificador…", identifierVerified: "Formato y dígito de control validados", identifierRegistryUnavailable: "Dígito de control válido; el registro público no está disponible. Será necesario verificar antes del envío.", identifierClosed: "El registro público indica que el establecimiento está cerrado.", identifierCheckPrompt: "Comprobar identificador", language: "Idioma",
    countries: { FR: "Francia", RS: "Serbia", IT: "Italia", ES: "España" },
    identifiers: { FR: { label: "SIRET del establecimiento (14 dígitos)", placeholder: "13002526500013" }, RS: { label: "PIB de la empresa (9 dígitos)", placeholder: "115028819" }, IT: { label: "Partita IVA o Codice Fiscale", placeholder: "12345678903" }, ES: { label: "NIF de la empresa", placeholder: "B12345674" }, DEFAULT: { label: "Identificador nacional / IVA", placeholder: "Identificador oficial del establecimiento" } },
    connectors: { FR: "Plateforme Agréée (PA)", RS: "Sistem eFaktura (SEF)", IT: "Sistema di Interscambio (SdI)", ES: "AEAT VERI*FACTU (y FACe para el sector público)", DEFAULT: "Perfil EN16931 / conector nacional pendiente de cualificación" },
  },
};

export function normalizePortalLocale(value: unknown): PortalLocale {
  const locale = String(value || "fr").toLowerCase().slice(0, 2);
  return (["fr", "en", "sr", "it", "es"] as PortalLocale[]).includes(locale as PortalLocale) ? locale as PortalLocale : "fr";
}

export function normalizePortalIdentifier(country: string, value: unknown) {
  return normalizeEstablishmentIdentifier(country, value);
}

export function portalIdentifierIsValid(country: string, value: unknown) {
  try {
    validateEstablishmentIdentifier(country, value);
    return true;
  } catch {
    return false;
  }
}
