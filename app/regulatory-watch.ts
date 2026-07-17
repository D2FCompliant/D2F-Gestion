import type { PortalLocale } from "./portal-i18n";

export const regulatoryCountries = ["FR", "RS", "IT", "ES"] as const;
export type RegulatoryCountry = (typeof regulatoryCountries)[number];

export const regulatoryWatchUi: Record<PortalLocale, {
  eyebrow: string;
  title: string;
  intro: string;
  chooseCountry: string;
  previous: string;
  next: string;
  officialSource: string;
  verified: string;
}> = {
  fr: { eyebrow: "VEILLE RÉGLEMENTAIRE D2F", title: "Les échéances utiles, selon votre pays", intro: "Synthèse issue de sources administratives officielles. Sélectionnez un pays pour consulter ses actualités.", chooseCountry: "Choisir le pays de la veille", previous: "Actualité précédente", next: "Actualité suivante", officialSource: "Lire la source officielle", verified: "Sources vérifiées le 17/07/2026" },
  en: { eyebrow: "D2F REGULATORY WATCH", title: "Useful deadlines for your country", intro: "Summaries based on official administration sources. Select a country to view its updates.", chooseCountry: "Choose regulatory watch country", previous: "Previous update", next: "Next update", officialSource: "Read the official source", verified: "Sources checked on 17 July 2026" },
  sr: { eyebrow: "D2F REGULATORNI PREGLED", title: "Važni rokovi za vašu zemlju", intro: "Sažeci zasnovani na zvaničnim izvorima uprave. Izaberite zemlju da vidite novosti.", chooseCountry: "Izaberite zemlju za regulatorni pregled", previous: "Prethodna vest", next: "Sledeća vest", officialSource: "Otvori zvanični izvor", verified: "Izvori provereni 17.07.2026." },
  it: { eyebrow: "OSSERVATORIO NORMATIVO D2F", title: "Le scadenze utili per il tuo Paese", intro: "Sintesi basate su fonti ufficiali delle amministrazioni. Seleziona un Paese per le novità.", chooseCountry: "Scegli il Paese dell’osservatorio", previous: "Notizia precedente", next: "Notizia successiva", officialSource: "Leggi la fonte ufficiale", verified: "Fonti verificate il 17/07/2026" },
  es: { eyebrow: "OBSERVATORIO NORMATIVO D2F", title: "Plazos útiles para su país", intro: "Resúmenes basados en fuentes oficiales de las administraciones. Seleccione un país para ver sus novedades.", chooseCountry: "Elegir el país del observatorio", previous: "Noticia anterior", next: "Noticia siguiente", officialSource: "Leer la fuente oficial", verified: "Fuentes verificadas el 17/07/2026" },
};

type NewsCopy = Record<PortalLocale, { title: string; summary: string }>;
type NewsItem = { date: string | Record<PortalLocale, string>; label: Record<PortalLocale, string>; sourceName: string; sourceUrl: string; text: NewsCopy };

export const regulatoryNews: Record<RegulatoryCountry, NewsItem[]> = {
  FR: [
    { date: "01.09.2026", label: { fr: "ÉCHÉANCE", en: "DEADLINE", sr: "ROK", it: "SCADENZA", es: "PLAZO" }, sourceName: "Ministère de l’Économie et des Finances", sourceUrl: "https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises", text: {
      fr: { title: "Réception électronique obligatoire pour toutes les entreprises", summary: "Les grandes entreprises et ETI devront aussi émettre leurs factures électroniques et transmettre leurs données de e-reporting à cette date." },
      en: { title: "Mandatory e-invoice reception for every business", summary: "Large companies and mid-caps must also issue e-invoices and submit e-reporting data from this date." },
      sr: { title: "Obavezan prijem e-faktura za sva preduzeća", summary: "Velika i srednja preduzeća od ovog datuma takođe izdaju e-fakture i dostavljaju podatke e-izveštavanja." },
      it: { title: "Ricezione elettronica obbligatoria per tutte le imprese", summary: "Le grandi imprese e le società di medie dimensioni dovranno anche emettere e-fatture e trasmettere i dati di e-reporting da questa data." },
      es: { title: "Recepción electrónica obligatoria para todas las empresas", summary: "Las grandes empresas y las medianas también deberán emitir facturas electrónicas y transmitir los datos de e-reporting desde esta fecha." },
    } },
    { date: "01.09.2027", label: { fr: "PME & MICRO", en: "SMEs & MICRO", sr: "MSP", it: "PMI & MICRO", es: "PYMES & MICRO" }, sourceName: "Ministère de l’Économie et des Finances", sourceUrl: "https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises", text: {
      fr: { title: "Émission et e-reporting pour les PME et microentreprises", summary: "Le passage par une Plateforme Agréée devient obligatoire pour émettre les factures électroniques et transmettre les données attendues." },
      en: { title: "Issuance and e-reporting for SMEs and micro-businesses", summary: "Using an Approved Platform becomes mandatory to issue e-invoices and transmit the required data." },
      sr: { title: "Izdavanje i e-izveštavanje za MSP i mikropreduzeća", summary: "Odobrena platforma postaje obavezna za izdavanje e-faktura i slanje traženih podataka." },
      it: { title: "Emissione ed e-reporting per PMI e microimprese", summary: "L’uso di una Plateforme Agréée diventa obbligatorio per emettere fatture elettroniche e trasmettere i dati richiesti." },
      es: { title: "Emisión y e-reporting para pymes y microempresas", summary: "El uso de una Plateforme Agréée pasa a ser obligatorio para emitir facturas electrónicas y transmitir los datos requeridos." },
    } },
  ],
  RS: [
    { date: "01.07.2026", label: { fr: "NOUVEAU", en: "NEW", sr: "NOVO", it: "NOVITÀ", es: "NOVEDAD" }, sourceName: "Ministarstvo finansija — eFaktura", sourceUrl: "https://www.efaktura.gov.rs/vest/en/8335/mandatory-registration-with-the-crf-begins.php", text: {
      fr: { title: "Enregistrement CRF obligatoire pour le secteur public", summary: "Les factures électroniques relatives aux transactions commerciales avec un débiteur public doivent être enregistrées au Registre central des factures." },
      en: { title: "Mandatory CRF registration for public-sector transactions", summary: "Electronic invoices for commercial transactions with a public-sector debtor must be registered in the Central Invoice Register." },
      sr: { title: "Obavezna registracija u CRF-u za javni sektor", summary: "Elektronske fakture iz komercijalnih transakcija sa dužnikom iz javnog sektora moraju biti registrovane u Centralnom registru faktura." },
      it: { title: "Registrazione CRF obbligatoria per il settore pubblico", summary: "Le fatture elettroniche relative a transazioni commerciali con un debitore pubblico devono essere registrate nel Registro centrale delle fatture." },
      es: { title: "Registro CRF obligatorio para el sector público", summary: "Las facturas electrónicas de operaciones comerciales con un deudor público deben registrarse en el Registro Central de Facturas." },
    } },
    { date: "15.05.2026", label: { fr: "SÉCURITÉ", en: "SECURITY", sr: "BEZBEDNOST", it: "SICUREZZA", es: "SEGURIDAD" }, sourceName: "Ministarstvo finansija — eFaktura", sourceUrl: "https://efaktura.gov.rs/vest/10324/revizija-korisnickih-uloga-i-dodeljenih-ovlascenja-na-sef-u.php", text: {
      fr: { title: "Réviser les rôles et autorisations attribués dans SEF", summary: "L’administration recommande de contrôler les utilisateurs actifs et leurs droits avant la mise en place du nouveau module d’administration." },
      en: { title: "Review roles and permissions assigned in SEF", summary: "The administration recommends checking active users and their rights before the new administration module is introduced." },
      sr: { title: "Proverite uloge i ovlašćenja dodeljena na SEF-u", summary: "Uprava preporučuje proveru aktivnih korisnika i njihovih prava pre uvođenja novog administratorskog modula." },
      it: { title: "Verificare ruoli e autorizzazioni assegnati in SEF", summary: "L’amministrazione raccomanda di controllare utenti attivi e relativi diritti prima del nuovo modulo di amministrazione." },
      es: { title: "Revisar los roles y permisos asignados en SEF", summary: "La administración recomienda comprobar los usuarios activos y sus derechos antes de implantar el nuevo módulo de administración." },
    } },
  ],
  IT: [
    { date: { fr: "EN VIGUEUR", en: "IN FORCE", sr: "NA SNAZI", it: "IN VIGORE", es: "EN VIGOR" }, label: { fr: "SDI", en: "SDI", sr: "SDI", it: "SDI", es: "SDI" }, sourceName: "Agenzia delle Entrate", sourceUrl: "https://www1.agenziaentrate.gov.it/web_app_entrate/fatturazione_elettronica.html", text: {
      fr: { title: "La facture doit transiter en XML par le SdI", summary: "Une facture envoyée autrement est considérée comme non émise. Le SdI contrôle notamment les données fiscales obligatoires et l’adresse électronique du destinataire." },
      en: { title: "Invoices must pass through SdI in XML format", summary: "An invoice sent by another route is treated as not issued. SdI checks mandatory tax data and the recipient’s electronic address, among other fields." },
      sr: { title: "Faktura mora proći kroz SdI u XML formatu", summary: "Faktura poslata drugim putem smatra se neizdatom. SdI proverava obavezne poreske podatke i elektronsku adresu primaoca." },
      it: { title: "La fattura deve transitare in XML tramite SdI", summary: "Una fattura inviata con modalità diversa è considerata non emessa. Lo SdI controlla i dati fiscali obbligatori e l’indirizzo telematico del destinatario." },
      es: { title: "La factura debe pasar por SdI en formato XML", summary: "Una factura enviada por otra vía se considera no emitida. SdI comprueba la información fiscal obligatoria y la dirección electrónica del destinatario." },
    } },
    { date: { fr: "EN CONTINU", en: "ONGOING", sr: "STALNO", it: "OPERATIVO", es: "CONTINUO" }, label: { fr: "CONTRÔLES", en: "CHECKS", sr: "KONTROLE", it: "CONTROLLI", es: "CONTROLES" }, sourceName: "Agenzia delle Entrate", sourceUrl: "https://www1.agenziaentrate.gov.it/web_app_entrate/fatturazione_elettronica.html", text: {
      fr: { title: "Suivre les reçus et notifications retournés par le SdI", summary: "Le système remet un reçu de livraison ou une notification de rejet : ces retours doivent alimenter le statut réel de la facture." },
      en: { title: "Track receipts and notifications returned by SdI", summary: "The system returns a delivery receipt or rejection notice; these responses must update the invoice’s actual status." },
      sr: { title: "Pratite potvrde i obaveštenja koja vraća SdI", summary: "Sistem vraća potvrdu o isporuci ili obaveštenje o odbijanju; odgovori moraju ažurirati stvarni status fakture." },
      it: { title: "Seguire ricevute e notifiche restituite dallo SdI", summary: "Il sistema restituisce una ricevuta di consegna o una notifica di scarto: questi esiti devono aggiornare lo stato reale della fattura." },
      es: { title: "Seguir los recibos y notificaciones devueltos por SdI", summary: "El sistema devuelve un recibo de entrega o una notificación de rechazo; estas respuestas deben actualizar el estado real de la factura." },
    } },
  ],
  ES: [
    { date: "01.01.2027", label: { fr: "ÉCHÉANCE", en: "DEADLINE", sr: "ROK", it: "SCADENZA", es: "PLAZO" }, sourceName: "Agencia Tributaria — AEAT", sourceUrl: "https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html", text: {
      fr: { title: "VERI*FACTU : échéance de l’impôt sur les sociétés", summary: "Les systèmes informatiques de facturation des contribuables concernés par l’impôt sur les sociétés doivent être adaptés avant cette date." },
      en: { title: "VERI*FACTU deadline for Corporate Tax taxpayers", summary: "Billing software used by Corporate Tax taxpayers must be adapted before this date." },
      sr: { title: "VERI*FACTU rok za obveznike poreza na dobit", summary: "Sistemi za fakturisanje obveznika poreza na dobit moraju biti prilagođeni pre ovog datuma." },
      it: { title: "Scadenza VERI*FACTU per i soggetti all’imposta sulle società", summary: "I sistemi informatici di fatturazione dei soggetti interessati devono essere adeguati entro questa data." },
      es: { title: "Plazo VERI*FACTU para contribuyentes del Impuesto sobre Sociedades", summary: "Los sistemas informáticos de facturación de estos contribuyentes deben estar adaptados antes de esta fecha." },
    } },
    { date: "01.07.2027", label: { fr: "AUTRES ACTIVITÉS", en: "OTHER BUSINESSES", sr: "OSTALI", it: "ALTRE ATTIVITÀ", es: "RESTO" }, sourceName: "Agencia Tributaria — AEAT", sourceUrl: "https://sede.agenciatributaria.gob.es/Sede/iva/sistemas-informaticos-facturacion-verifactu/preguntas-frecuentes.html", text: {
      fr: { title: "VERI*FACTU : échéance des autres professionnels", summary: "Les autres contribuables visés, notamment ceux exerçant une activité économique à l’impôt sur le revenu, doivent adapter leurs systèmes avant cette date." },
      en: { title: "VERI*FACTU deadline for other professionals", summary: "Other taxpayers in scope, including individuals carrying on business activities under personal income tax, must adapt their systems before this date." },
      sr: { title: "VERI*FACTU rok za ostale profesionalce", summary: "Ostali obuhvaćeni obveznici, uključujući fizička lica koja obavljaju delatnost, moraju prilagoditi sisteme pre ovog datuma." },
      it: { title: "Scadenza VERI*FACTU per gli altri professionisti", summary: "Gli altri contribuenti interessati, comprese le persone fisiche che esercitano attività economiche, devono adeguare i sistemi entro questa data." },
      es: { title: "Plazo VERI*FACTU para el resto de profesionales", summary: "Los demás contribuyentes afectados, incluidos quienes realizan actividades económicas en IRPF, deben adaptar sus sistemas antes de esta fecha." },
    } },
  ],
};
