import type { AppSession } from "./auth/server";
import { isPlatformAdminEmail } from "./auth/server";
import { getSupabaseAdmin } from "./supabase/server";
import type { TenantAccount } from "./saas/accounts";
import { sendSmtpMessage, smtpConfiguration } from "./support-mail";

type JsonRecord = Record<string, unknown>;
export type SupportLocale = "fr" | "en" | "sr" | "it" | "es";
export type SupportStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
export type SupportPriority = "low" | "normal" | "high" | "urgent";
export type SupportCategory = "access" | "billing" | "invoice" | "payment" | "einvoicing" | "reporting" | "compliance" | "technical" | "other";
export type SupportScope = "customer" | "internal";
export type SupportRequestType = "incident" | "need" | "question";

const SUPPORT_EMAIL = "support@d2fcompliant.com";
const categories = new Set<SupportCategory>(["access", "billing", "invoice", "payment", "einvoicing", "reporting", "compliance", "technical", "other"]);
const priorities = new Set<SupportPriority>(["low", "normal", "high", "urgent"]);
const statuses = new Set<SupportStatus>(["open", "in_progress", "waiting_customer", "resolved", "closed"]);
const locales = new Set<SupportLocale>(["fr", "en", "sr", "it", "es"]);
const requestTypes = new Set<SupportRequestType>(["incident", "need", "question"]);

function text(value: unknown, max = 5000) {
  return String(value || "").trim().slice(0, max);
}

function validEmail(value: unknown) {
  const email = text(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function missingSupportStorage(error: { code?: string; message?: string } | null) {
  const message = error?.message || "";
  return Boolean(error && (
    error.code === "42P01"
    || error.code === "PGRST205"
    || /relation .*d2f_support_.* does not exist/i.test(message)
    || /could not find the table .*d2f_support_/i.test(message)
  ));
}

function storageMessage() {
  return "Le stockage du module Support doit être initialisé dans Supabase avant sa première utilisation.";
}

function supportDatabaseError(error: { code?: string; message?: string } | null, admin: boolean) {
  if (missingSupportStorage(error)) return new Error(storageMessage());
  const code = text(error?.code, 30);
  const detail = text(error?.message, 500);
  if (admin && detail) return new Error(`Supabase Support${code ? ` (${code})` : ""} : ${detail}`);
  return new Error("Le service Support rencontre un problème de connexion. D2F a accès au diagnostic technique.");
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => item as JsonRecord)
    : [];
}

async function companySupportRows(session: AppSession, admin: boolean) {
  let query = getSupabaseAdmin().from("d2f_company").select("owner_email,data").limit(2000);
  if (!admin) query = query.eq("owner_email", session.ownerKey);
  const { data, error } = await query;
  if (error) throw supportDatabaseError(error, admin);
  const rows: Array<{ ownerKey: string; ticket: JsonRecord }> = [];
  for (const companyRow of data || []) {
    const ownerKey = String(companyRow.owner_email || "");
    const company = object(companyRow.data);
    for (const ticket of records(company._support_tickets)) {
      if (!admin && String(ticket.tenant_id || "") !== session.tenantId) continue;
      rows.push({ ownerKey, ticket: { ...ticket, __owner_key: ownerKey } });
    }
  }
  return rows
    .sort((left, right) => String(right.ticket.updated_at || "").localeCompare(String(left.ticket.updated_at || "")))
    .slice(0, 300);
}

async function saveCompanySupportTicket(ownerKey: string, ticket: JsonRecord) {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: readError } = await supabase.from("d2f_company").select("data").eq("owner_email", ownerKey).maybeSingle();
  if (readError) throw readError;
  const company = object(existing?.data);
  const stored = { ...ticket };
  delete stored.__owner_key;
  const current = records(company._support_tickets);
  const next = [...current.filter((item) => String(item.id || "") !== String(stored.id || "")), stored];
  const { error } = await supabase.from("d2f_company").upsert({
    owner_email: ownerKey,
    data: { ...company, _support_tickets: next },
    updated_at: new Date().toISOString(),
  }, { onConflict: "owner_email" });
  if (error) throw error;
}

function supportResponse(rows: Array<{ ownerKey: string; ticket: JsonRecord }>, admin: boolean) {
  const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const statusOrder: Record<string, number> = { open: 0, in_progress: 1, waiting_customer: 2, resolved: 3, closed: 4 };
  const tickets = rows
    .map(({ ticket }) => publicTicket(ticket, records(ticket.messages), admin))
    .sort((left, right) => {
      if (admin) {
        const scope = Number(left.ticketScope !== "customer") - Number(right.ticketScope !== "customer");
        if (scope) return scope;
        const active = Number(["resolved", "closed"].includes(left.status)) - Number(["resolved", "closed"].includes(right.status));
        if (active) return active;
        const priority = (priorityOrder[left.priority] ?? 9) - (priorityOrder[right.priority] ?? 9);
        if (priority) return priority;
        const status = (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9);
        if (status) return status;
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  const attentionCount = tickets.filter((ticket) => {
    const last = ticket.messages[ticket.messages.length - 1];
    if (admin) return ticket.status === "open" || (last?.authorType === "requester" && !["resolved", "closed"].includes(ticket.status));
    return ticket.status === "resolved" || (last?.authorType === "support" && ticket.status === "waiting_customer");
  }).length;
  return { tickets, attentionCount, ...mailConfiguration(), isAdmin: admin };
}

async function ticketRow(session: AppSession, ticketId: string, admin: boolean) {
  const rows = await companySupportRows(session, admin);
  const found = rows.find(({ ticket }) => String(ticket.id || "") === ticketId);
  if (!found) throw new Error("Ticket introuvable");
  return found.ticket;
}

function supportMessage(ticketId: string, authorType: string, authorName: string, authorEmail: string, body: string, internal = false) {
  return {
    id: crypto.randomUUID(),
    ticket_id: ticketId,
    author_type: authorType,
    author_name: authorName,
    author_email: authorEmail,
    body,
    internal,
    created_at: new Date().toISOString(),
  };
}

function l1Guidance(locale: SupportLocale, category: SupportCategory, subject: string, description: string) {
  const combined = `${subject} ${description}`.toLowerCase();
  const quoteContext = /devis|quote|preventiv|presupuest|ponud/i.test(combined);
  const actionContext = /bouton|button|action|export|envoy|send|transmi|télécharg|download/i.test(combined);
  const kind = quoteContext && actionContext ? "quote_actions"
    : /csv|import|glisser|déposer|drag|drop/i.test(combined) ? "csv_import"
      : /licen[cs]e|abonnement|subscription|réactiv|reactiv|suspend/i.test(combined) ? "license"
        : /pdf|imprimer|print|download|télécharg/i.test(combined) ? "pdf"
          : /mot de passe|password|connexion|login|session/i.test(combined) ? "access"
            : /avoir|credit note|annul|solde|balance/i.test(combined) ? "credit"
              : /peppol|sef|sdi|verifactu|pa |plateforme|e-?report/i.test(combined) ? "regulatory"
                : actionContext ? "missing_action"
                  : category;
  const guidance: Record<SupportLocale, Record<string, string>> = {
    fr: {
      quote_actions: "J’ai compris : l’action Exporter ou Envoyer est attendue dans l’onglet Devis, mais elle n’y apparaît pas et vous la trouvez seulement dans Exports.\n\nDiagnostic probable : ce n’est pas un problème de navigateur. Le parcours actuel centralise ces actions dans Exports ; le ticket porte donc sur une action manquante ou une incohérence d’ergonomie dans Devis.\n\nSuite utile pour D2F : vérifier le devis sélectionné et son statut, puis décider quelles actions Exporter / Envoyer doivent être accessibles directement depuis la barre d’actions Devis. Inutile de recharger la page. Si un devis précis est concerné, ajoutez uniquement son numéro.",
      csv_import: "J’ai compris : l’import CSV ne permet pas de sélectionner un fichier local ou de le glisser-déposer. Ce n’est pas un problème de format tant que le sélecteur de fichier ne s’ouvre pas. D2F doit d’abord vérifier le bouton de sélection et la zone de dépôt, puis seulement analyser le séparateur et les colonnes du fichier.",
      license: "J’ai compris : la demande concerne la suspension ou la réactivation d’une licence ou d’un abonnement. D2F doit vérifier l’état exact du compte, la période d’essai et la date de suspension avant toute action. Ne recréez pas de compte et ne relancez pas un paiement pour contourner le statut.",
      missing_action: "J’ai compris qu’une action attendue n’apparaît pas dans l’interface. Ce n’est pas utile de recharger par défaut. Indiquez l’onglet, le libellé exact de l’action et l’état du document concerné ; D2F vérifiera si l’action est masquée par le statut, déplacée dans un autre module ou réellement absente.",
      access: "Pré-diagnostic niveau 1 : vérifiez que vous utilisez gestion.d2fcompliant.org, puis essayez « Mot de passe oublié ». Après 30 minutes d’inactivité, une nouvelle authentification est normale. N’envoyez jamais votre mot de passe dans ce ticket.",
      pdf: "Pré-diagnostic niveau 1 : ouvrez le document concerné, vérifiez qu’un client et un numéro sont présents, enregistrez, puis relancez l’export PDF depuis le navigateur. Indiquez le numéro du document et le message exact si le problème persiste.",
      credit: "Pré-diagnostic niveau 1 : contrôlez le lien entre la facture et l’avoir, puis consultez la synthèse Paiements. Une facture entièrement annulée par avoir ne doit plus apparaître comme restant à encaisser.",
      regulatory: "Pré-diagnostic niveau 1 : contrôlez le pays de l’entreprise, le profil réglementaire et l’état du connecteur dans Entreprise. Ne transmettez pas un flux structuré tant que le connecteur n’est pas indiqué comme validé.",
      billing: "Pré-diagnostic niveau 1 : ouvrez votre compte entreprise, contrôlez la formule, la référence obligatoire et l’état du virement. D2F doit confirmer la réception avant l’activation payée.",
      payment: "Pré-diagnostic niveau 1 : recherchez la facture dans Paiements et vérifiez les avoirs associés, le montant encaissé et le solde restant. Joignez les références, jamais des coordonnées bancaires confidentielles.",
      invoice: "Pré-diagnostic niveau 1 : vérifiez la fiche client, la date, les lignes, la TVA et le statut de la facture. Indiquez son numéro et l’action exacte qui échoue.",
      reporting: "Pré-diagnostic niveau 1 : préparez la période, ouvrez les dossiers À contrôler, puis corrigez chaque anomalie avant transmission. Le connecteur national doit être validé.",
      compliance: "Pré-diagnostic niveau 1 : précisez le pays, l’opération et la preuve concernée. L’assistant peut guider le classement mais la validation réglementaire finale reste humaine.",
      technical: "J’ai lu la demande « {subject} ». Je ne propose pas de recharger la page sans indice de panne temporaire. Pour qualifier le ticket, D2F doit distinguer une action absente, une action déplacée et une action bloquée par le statut du document. Ajoutez seulement le libellé de l’onglet, l’action attendue et ce qui apparaît à sa place ; l’heure et le navigateur ne sont utiles que si le comportement est intermittent.",
      other: "Pré-diagnostic niveau 1 : précisez l’onglet, le résultat attendu, le résultat observé, l’heure et les étapes de reproduction. Un membre D2F reprendra le ticket si nécessaire.",
    },
    en: {
      quote_actions: "I understand that Export or Send is expected in the Quotes tab, but is missing there and only appears under Exports.\n\nLikely diagnosis: this is not a browser issue. The current workflow centralises these actions under Exports, so the ticket concerns a missing action or a navigation inconsistency in Quotes.\n\nUseful next step for D2F: check the selected quote and its status, then decide which Export / Send actions must also appear in the Quotes action bar. Reloading is not useful. If one quote is affected, add only its number.",
      csv_import: "I understand that CSV import does not let you select a local file or drag and drop it. This is not a CSV-format issue while the file picker itself does not open. D2F should first check the picker and drop zone, then inspect delimiter and columns.",
      license: "I understand that this concerns suspension or reactivation of a licence or subscription. D2F should check the exact account status, trial window and suspension date before taking action. Do not create another account or repeat payment to bypass the status.",
      missing_action: "I understand that an expected action is missing from the interface. Reloading should not be the default answer. Provide the tab, exact action label and document status; D2F will check whether it is hidden by status, moved to another module or actually missing.",
      access: "Level-1 check: confirm that you use gestion.d2fcompliant.org, then try “Forgot password”. Re-authentication after 30 minutes of inactivity is expected. Never send a password in a ticket.",
      pdf: "Level-1 check: open the document, verify that its customer and number are present, save it, then retry the browser PDF export. Include the document number and exact error if it persists.",
      credit: "Level-1 check: verify the link between the invoice and credit note, then open the Payments overview. A fully credited invoice must no longer show an outstanding balance.",
      regulatory: "Level-1 check: verify the company country, regulatory profile and connector status in Company. Do not transmit structured data until the connector is shown as validated.",
      billing: "Level-1 check: open the company account and verify the plan, mandatory reference and transfer status. D2F must confirm receipt before paid access starts.",
      payment: "Level-1 check: locate the invoice in Payments and verify linked credit notes, received amount and remaining balance. Share references, never confidential banking credentials.",
      invoice: "Level-1 check: verify the customer, date, lines, VAT and invoice status. Include its number and the exact action that fails.",
      reporting: "Level-1 check: prepare the period, open the items to review, then resolve each issue before submission. The national connector must be validated.",
      compliance: "Level-1 check: specify the country, transaction and evidence concerned. The assistant can guide classification, but final regulatory validation remains human.",
      technical: "I read the request “{subject}”. I will not suggest reloading without evidence of a temporary failure. D2F should distinguish a missing action, a moved action and one blocked by document status. Add only the tab, expected action and what appears instead; time and browser matter only for intermittent behaviour.",
      other: "Level-1 check: specify the tab, expected result, observed result, time and reproduction steps. A D2F team member will take over when needed.",
    },
    sr: {
      quote_actions: "Razumem: radnje Izvoz ili Slanje očekuju se u modulu Ponude, ali se tamo ne vide i dostupne su samo u modulu Izvoz.\n\nVerovatna dijagnoza: ovo nije problem pregledača. Trenutni tok centralizuje radnje u modulu Izvoz, pa tiket opisuje nedostajuću radnju ili nedoslednu navigaciju u Ponudama.\n\nSledeći korak za D2F: proveriti izabranu ponudu i status, zatim odlučiti koje radnje treba dodati direktno u traku Ponude. Osvežavanje stranice nije korisno.",
      csv_import: "Razumem: CSV uvoz ne omogućava izbor lokalne datoteke ili prevlačenje. Dok se izbor datoteke ne otvara, problem nije u CSV formatu. D2F prvo proverava birač i zonu za prevlačenje, zatim separator i kolone.",
      license: "Razumem: zahtev se odnosi na suspenziju ili ponovno aktiviranje licence ili pretplate. D2F treba da proveri status naloga, probni period i datum suspenzije. Ne pravite drugi nalog i ne ponavljajte uplatu.",
      missing_action: "Razumem da očekivana radnja nedostaje u interfejsu. Osvežavanje nije podrazumevani odgovor. Navedite modul, tačan naziv radnje i status dokumenta; D2F proverava da li je skrivena, premeštena ili zaista nedostaje.",
      access: "Nivo 1: proverite da koristite gestion.d2fcompliant.org, zatim pokušajte „Zaboravljena lozinka“. Nova prijava posle 30 minuta neaktivnosti je očekivana. Ne šaljite lozinku u tiketu.",
      pdf: "Nivo 1: otvorite dokument, proverite klijenta i broj, sačuvajte i ponovite PDF izvoz. Ako problem ostane, navedite broj dokumenta i tačnu poruku.",
      credit: "Nivo 1: proverite vezu fakture i knjižnog odobrenja, zatim pregled Plaćanja. Potpuno stornirana faktura ne sme imati preostali saldo.",
      regulatory: "Nivo 1: proverite zemlju, regulatorni profil i status konektora u modulu Preduzeće. Ne šaljite strukturirani tok dok konektor nije potvrđen.",
      billing: "Nivo 1: proverite paket, obaveznu referencu i status prenosa. D2F potvrđuje prijem pre aktivacije plaćenog pristupa.",
      payment: "Nivo 1: pronađite fakturu u Plaćanjima i proverite odobrenja, primljeni iznos i saldo. Ne šaljite poverljive bankarske podatke.",
      invoice: "Nivo 1: proverite klijenta, datum, stavke, PDV i status fakture. Navedite broj i tačnu radnju koja ne uspeva.",
      reporting: "Nivo 1: pripremite period, otvorite stavke za proveru i ispravite greške pre slanja. Nacionalni konektor mora biti potvrđen.",
      compliance: "Nivo 1: navedite zemlju, transakciju i dokaz. Asistent pomaže klasifikaciji, ali konačna regulatorna potvrda ostaje ljudska.",
      technical: "Pročitao sam zahtev „{subject}“. Ne predlažem osvežavanje bez znaka privremenog kvara. D2F treba da razlikuje radnju koja nedostaje, premeštenu radnju i radnju blokiranu statusom dokumenta. Dodajte modul, očekivanu radnju i ono što se prikazuje umesto nje.",
      other: "Nivo 1: navedite karticu, očekivani i dobijeni rezultat, vreme i korake. D2F tim preuzima tiket kada je potrebno.",
    },
    it: {
      quote_actions: "Ho capito: le azioni Esporta o Invia sono attese nella scheda Preventivi, ma non compaiono e sono disponibili soltanto in Esportazioni.\n\nDiagnosi probabile: non è un problema del browser. Il flusso attuale centralizza queste azioni in Esportazioni; il ticket riguarda quindi un’azione mancante o un’incoerenza di navigazione nei Preventivi.\n\nPasso utile per D2F: verificare preventivo selezionato e stato, poi decidere quali azioni aggiungere direttamente alla barra Preventivi. Ricaricare la pagina non serve.",
      csv_import: "Ho capito: l’importazione CSV non consente di scegliere un file locale o trascinarlo. Finché il selettore non si apre, non è un problema di formato CSV. D2F deve verificare prima selettore e area di rilascio, poi separatore e colonne.",
      license: "Ho capito: la richiesta riguarda sospensione o riattivazione di una licenza o di un abbonamento. D2F deve controllare stato del conto, periodo di prova e data di sospensione. Non create un altro account e non ripetete il pagamento.",
      missing_action: "Ho capito che manca un’azione attesa nell’interfaccia. Ricaricare non deve essere la risposta predefinita. Indicate scheda, etichetta esatta e stato del documento; D2F verificherà se l’azione è nascosta, spostata o assente.",
      access: "Controllo L1: verificate di usare gestion.d2fcompliant.org, poi provate “Password dimenticata”. Una nuova autenticazione dopo 30 minuti di inattività è normale. Non inviate mai la password.",
      pdf: "Controllo L1: aprite il documento, verificate cliente e numero, salvate e riprovate l’esportazione PDF. Se persiste, indicate numero e messaggio esatto.",
      credit: "Controllo L1: verificate il collegamento tra fattura e nota di credito e poi la sintesi Pagamenti. Una fattura totalmente stornata non deve avere saldo residuo.",
      regulatory: "Controllo L1: verificate paese, profilo normativo e stato del connettore in Azienda. Non trasmettete dati strutturati finché il connettore non è convalidato.",
      billing: "Controllo L1: verificate piano, riferimento obbligatorio e stato del bonifico. D2F deve confermare la ricezione prima dell’accesso pagato.",
      payment: "Controllo L1: cercate la fattura in Pagamenti e verificate note di credito, importo incassato e saldo. Non inviate credenziali bancarie riservate.",
      invoice: "Controllo L1: verificate cliente, data, righe, IVA e stato della fattura. Indicate numero e azione esatta che non riesce.",
      reporting: "Controllo L1: preparate il periodo, aprite gli elementi da controllare e correggete gli errori prima dell’invio. Il connettore nazionale deve essere convalidato.",
      compliance: "Controllo L1: indicate paese, operazione e prova. L’assistente guida la classificazione, ma la convalida normativa finale resta umana.",
      technical: "Ho letto la richiesta “{subject}”. Non propongo di ricaricare senza indizi di un errore temporaneo. D2F deve distinguere un’azione assente, spostata o bloccata dallo stato del documento. Aggiungete solo scheda, azione attesa e ciò che appare al suo posto.",
      other: "Controllo L1: indicate scheda, risultato atteso e osservato, ora e passaggi. Un operatore D2F prenderà in carico il ticket se necessario.",
    },
    es: {
      quote_actions: "Entiendo que las acciones Exportar o Enviar deberían estar en Presupuestos, pero no aparecen allí y solo se encuentran en Exportaciones.\n\nDiagnóstico probable: no es un problema del navegador. El flujo actual centraliza estas acciones en Exportaciones; el ticket trata de una acción ausente o de una incoherencia de navegación en Presupuestos.\n\nSiguiente paso útil para D2F: comprobar el presupuesto seleccionado y su estado, y decidir qué acciones deben añadirse directamente a la barra de Presupuestos. Recargar la página no sirve.",
      csv_import: "Entiendo que la importación CSV no permite seleccionar un archivo local ni arrastrarlo. Mientras no se abra el selector, no es un problema del formato CSV. D2F debe comprobar primero el selector y la zona de depósito, y después separador y columnas.",
      license: "Entiendo que la solicitud se refiere a suspender o reactivar una licencia o suscripción. D2F debe comprobar el estado exacto, el periodo de prueba y la fecha de suspensión. No cree otra cuenta ni repita el pago.",
      missing_action: "Entiendo que falta una acción esperada en la interfaz. Recargar no debe ser la respuesta predeterminada. Indique pestaña, etiqueta exacta y estado del documento; D2F comprobará si está oculta, trasladada o realmente ausente.",
      access: "Comprobación N1: confirme que usa gestion.d2fcompliant.org y pruebe «Contraseña olvidada». Una nueva autenticación tras 30 minutos es normal. Nunca envíe su contraseña.",
      pdf: "Comprobación N1: abra el documento, verifique cliente y número, guarde y repita la exportación PDF. Si continúa, indique el número y el mensaje exacto.",
      credit: "Comprobación N1: verifique el vínculo entre factura y abono y consulte Pagos. Una factura totalmente anulada no debe mostrar saldo pendiente.",
      regulatory: "Comprobación N1: verifique país, perfil normativo y estado del conector en Empresa. No transmita datos estructurados hasta que el conector esté validado.",
      billing: "Comprobación N1: verifique plan, referencia obligatoria y estado de la transferencia. D2F debe confirmar la recepción antes del acceso pagado.",
      payment: "Comprobación N1: localice la factura en Pagos y verifique abonos, importe cobrado y saldo. No envíe credenciales bancarias confidenciales.",
      invoice: "Comprobación N1: verifique cliente, fecha, líneas, IVA y estado. Indique el número y la acción exacta que falla.",
      reporting: "Comprobación N1: prepare el período, abra los elementos por revisar y corrija los errores antes del envío. El conector nacional debe estar validado.",
      compliance: "Comprobación N1: indique país, operación y prueba. El asistente orienta la clasificación; la validación normativa final sigue siendo humana.",
      technical: "He leído la solicitud «{subject}». No propongo recargar sin indicios de un fallo temporal. D2F debe distinguir una acción ausente, trasladada o bloqueada por el estado del documento. Añada solo pestaña, acción esperada y lo que aparece en su lugar.",
      other: "Comprobación N1: indique pestaña, resultado esperado y observado, hora y pasos. Un miembro de D2F retomará el ticket cuando sea necesario.",
    },
  };
  const response = guidance[locale][kind] || guidance[locale][category] || guidance[locale].other;
  return response.replaceAll("{subject}", text(subject, 120) || "ticket");
}

function publicMessage(row: JsonRecord) {
  return {
    id: String(row.id || ""),
    authorType: String(row.author_type || ""),
    authorName: String(row.author_name || ""),
    authorEmail: String(row.author_email || ""),
    body: String(row.body || ""),
    internal: Boolean(row.internal),
    createdAt: String(row.created_at || ""),
  };
}

function publicTicket(row: JsonRecord, messages: JsonRecord[], admin: boolean) {
  return {
    id: String(row.id || ""), number: String(row.ticket_number || ""), tenantId: String(row.tenant_id || ""), companyName: String(row.company_name || ""),
    requesterName: String(row.requester_name || ""), requesterEmail: String(row.requester_email || ""), contactEmail: String(row.contact_email || ""),
    ticketScope: String(row.ticket_scope || "customer"), requestType: String(row.request_type || "incident"),
    locale: String(row.locale || "fr"), category: String(row.category || "other"), priority: String(row.priority || "normal"), subject: String(row.subject || ""),
    description: String(row.description || ""), status: String(row.status || "open"), assignedTo: String(row.assigned_to || ""), l1Mode: String(row.l1_mode || "guided"),
    l1Summary: String(row.l1_summary || ""), resolution: String(row.resolution || ""), externalProvider: String(row.external_provider || ""), externalKey: String(row.external_key || ""),
    externalUrl: String(row.external_url || ""), resolvedAt: String(row.resolved_at || ""), closedAt: String(row.closed_at || ""), createdAt: String(row.created_at || ""), updatedAt: String(row.updated_at || ""),
    messages: messages.filter((message) => admin || !Boolean(message.internal)).map(publicMessage),
  };
}

function mailConfiguration() {
  const smtp = smtpConfiguration();
  const webhookUrl = text(process.env.D2F_SUPPORT_MAIL_WEBHOOK_URL, 1000);
  return {
    supportEmail: text(process.env.D2F_SUPPORT_EMAIL || SUPPORT_EMAIL, 254) || SUPPORT_EMAIL,
    deliveryConfigured: Boolean(smtp || webhookUrl),
    transport: smtp ? "smtp" : webhookUrl ? "webhook" : "none",
    l1Mode: "guided",
    generativeAiConfigured: false,
  };
}

async function queueNotification(ticket: JsonRecord, recipient: string, subject: string, body: string) {
  const supabase = getSupabaseAdmin();
  const configuration = mailConfiguration();
  const initialStatus = configuration.deliveryConfigured ? "queued" : "configuration_required";
  const { data, error } = await supabase.from("d2f_support_notifications").insert({ ticket_id: ticket.id, recipient, subject, body, delivery_status: initialStatus }).select("id").single();
  if (!configuration.deliveryConfigured) return;
  if (error && !missingSupportStorage(error)) return;
  const notificationId = data ? String(data.id || "") : "";
  try {
    const smtp = smtpConfiguration();
    if (smtp) {
      await sendSmtpMessage(smtp, { to: recipient, subject, text: body, replyTo: configuration.supportEmail });
    } else {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const secret = text(process.env.D2F_SUPPORT_MAIL_WEBHOOK_SECRET, 2000);
      if (secret) headers.authorization = `Bearer ${secret}`;
      const response = await fetch(String(process.env.D2F_SUPPORT_MAIL_WEBHOOK_URL), {
        method: "POST", headers,
        body: JSON.stringify({ from: configuration.supportEmail, replyTo: configuration.supportEmail, to: recipient, subject, text: body, ticketNumber: ticket.ticket_number, ticketId: ticket.id }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    }
    if (notificationId) await supabase.from("d2f_support_notifications").update({ delivery_status: "sent", attempts: 1, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", notificationId);
  } catch (error) {
    if (notificationId) await supabase.from("d2f_support_notifications").update({ delivery_status: "failed", attempts: 1, last_error: error instanceof Error ? error.message.slice(0, 500) : "Échec d’envoi", updated_at: new Date().toISOString() }).eq("id", notificationId);
  }
}

export async function listSupport(session: AppSession) {
  const admin = isPlatformAdminEmail(session.email);
  return supportResponse(await companySupportRows(session, admin), admin);
}

export async function createSupportTicket(session: AppSession, account: TenantAccount, input: JsonRecord) {
  const contactEmail = validEmail(input.contactEmail || session.email);
  const subject = text(input.subject, 160);
  const description = text(input.description, 8000);
  const category = categories.has(input.category as SupportCategory) ? input.category as SupportCategory : "other";
  const priority = priorities.has(input.priority as SupportPriority) ? input.priority as SupportPriority : "normal";
  const locale = locales.has(input.locale as SupportLocale) ? input.locale as SupportLocale : "fr";
  const admin = isPlatformAdminEmail(session.email);
  const ticketScope: SupportScope = admin && input.ticketScope === "internal" ? "internal" : "customer";
  const requestType = requestTypes.has(input.requestType as SupportRequestType) ? input.requestType as SupportRequestType : "incident";
  if (!contactEmail) throw new Error("Adresse e-mail de contact invalide");
  if (subject.length < 5) throw new Error("L’objet du ticket doit contenir au moins 5 caractères");
  if (description.length < 10) throw new Error("Décrivez le problème en au moins 10 caractères");
  const guidance = l1Guidance(locale, category, subject, description);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const ticketNumber = `D2F-${now.slice(0, 10).replace(/-/g, "")}-${id.slice(0, 6).toUpperCase()}`;
  const ticket: JsonRecord = {
    id,
    ticket_number: ticketNumber,
    tenant_id: account.id, owner_key: account.ownerKey, company_name: account.name, requester_user_id: session.userId,
    requester_name: session.fullName, requester_email: session.email, contact_email: contactEmail, locale, category, priority, subject, description,
    ticket_scope: ticketScope, request_type: requestType,
    status: "open", l1_mode: "guided", l1_summary: guidance.slice(0, 1000),
    assigned_to: "", resolution: "", external_provider: "", external_key: "", external_url: "",
    resolved_at: "", closed_at: "", created_at: now, updated_at: now,
    messages: [
      supportMessage(id, "requester", session.fullName, session.email, description),
      supportMessage(id, "assistant", "Assistant D2F niveau 1", SUPPORT_EMAIL, guidance),
    ],
  };
  await saveCompanySupportTicket(account.ownerKey, ticket);
  const configuration = mailConfiguration();
  await Promise.all([
    queueNotification(ticket, configuration.supportEmail, `[${ticketNumber}] ${ticketScope === "internal" ? "Ticket interne" : "Nouveau ticket"} — ${subject}`, `Entreprise : ${account.name}\nDemandeur : ${session.fullName} <${contactEmail}>\nNature : ${requestType}\nPriorité : ${priority}\n\n${description}`),
    queueNotification(ticket, contactEmail, `[${ticketNumber}] Votre demande de support D2F`, `Votre ticket ${ticketNumber} est enregistré.\n\n${guidance}\n\nD2F vous informera à chaque réponse et changement de statut.`),
  ]);
  return listSupport(session);
}

export async function reanalyzeSupportTicket(session: AppSession, input: JsonRecord) {
  const admin = isPlatformAdminEmail(session.email);
  if (!admin) throw new Error("Seul D2F peut relancer le diagnostic niveau 1");
  const ticket = await ticketRow(session, text(input.ticketId, 80), true);
  if (String(ticket.status) === "closed") throw new Error("Le diagnostic d’un ticket soldé ne peut pas être relancé");
  const locale = locales.has(ticket.locale as SupportLocale) ? ticket.locale as SupportLocale : "fr";
  const category = categories.has(ticket.category as SupportCategory) ? ticket.category as SupportCategory : "other";
  const guidance = l1Guidance(locale, category, String(ticket.subject || ""), String(ticket.description || ""));
  const updated = {
    ...ticket,
    l1_mode: "contextual",
    l1_summary: guidance.slice(0, 1000),
    updated_at: new Date().toISOString(),
    messages: [...records(ticket.messages), supportMessage(String(ticket.id), "assistant", "Assistant D2F niveau 1", SUPPORT_EMAIL, guidance)],
  };
  await saveCompanySupportTicket(String(ticket.__owner_key || session.ownerKey), updated);
  return listSupport(session);
}

export async function addSupportMessage(session: AppSession, input: JsonRecord) {
  const admin = isPlatformAdminEmail(session.email);
  const ticket = await ticketRow(session, text(input.ticketId, 80), admin);
  const body = text(input.body, 8000);
  if (body.length < 2) throw new Error("La réponse est vide");
  if (String(ticket.status) === "closed") throw new Error("Ce ticket est soldé. Ouvrez un nouveau ticket si le problème réapparaît.");
  const authorType = admin ? "support" : "requester";
  const internal = admin && input.internal === true;
  const status: SupportStatus = admin ? (internal ? String(ticket.status) as SupportStatus : "waiting_customer") : "in_progress";
  const updated = {
    ...ticket,
    status,
    updated_at: new Date().toISOString(),
    messages: [...records(ticket.messages), supportMessage(String(ticket.id), authorType, session.fullName, session.email, body, internal)],
  };
  const ownerKey = String(ticket.__owner_key || session.ownerKey);
  await saveCompanySupportTicket(ownerKey, updated);
  if (!internal) {
    const configuration = mailConfiguration();
    const recipient = admin ? String(ticket.contact_email) : configuration.supportEmail;
    await queueNotification(updated, recipient, `[${ticket.ticket_number}] Nouvelle réponse — ${ticket.subject}`, `${session.fullName} a répondu au ticket ${ticket.ticket_number}.\n\n${body}\n\nConnectez-vous à D2F Gestion pour consulter tout l’historique.`);
  }
  return listSupport(session);
}

export async function updateSupportStatus(session: AppSession, input: JsonRecord) {
  const admin = isPlatformAdminEmail(session.email);
  const ticket = await ticketRow(session, text(input.ticketId, 80), admin);
  const status = statuses.has(input.status as SupportStatus) ? input.status as SupportStatus : "in_progress";
  if (!admin && (status !== "closed" || String(ticket.status) !== "resolved")) throw new Error("Seul D2F peut modifier cet état");
  const resolution = text(input.resolution, 4000);
  if (status === "resolved" && resolution.length < 3) throw new Error("Ajoutez la solution apportée avant de résoudre le ticket");
  const now = new Date().toISOString();
  const update: JsonRecord = { status, updated_at: now };
  if (admin && input.assignedTo != null) update.assigned_to = text(input.assignedTo, 160);
  if (resolution) update.resolution = resolution;
  if (status === "resolved") update.resolved_at = now;
  if (status === "closed") update.closed_at = now;
  const label = status === "closed" ? "soldé" : status === "resolved" ? "résolu" : status === "waiting_customer" ? "en attente du demandeur" : status === "in_progress" ? "en cours" : "ouvert";
  const updated = {
    ...ticket,
    ...update,
    messages: [...records(ticket.messages), supportMessage(String(ticket.id), "system", "D2F Support", mailConfiguration().supportEmail, resolution ? `Statut : ${label}. Solution : ${resolution}` : `Statut : ${label}.`)],
  };
  await saveCompanySupportTicket(String(ticket.__owner_key || session.ownerKey), updated);
  await queueNotification(updated, String(ticket.contact_email), `[${ticket.ticket_number}] Ticket ${label}`, `Le ticket ${ticket.ticket_number} est maintenant ${label}.${resolution ? `\n\nSolution : ${resolution}` : ""}\n\nVous pouvez consulter son historique dans D2F Gestion.`);
  return listSupport(session);
}
