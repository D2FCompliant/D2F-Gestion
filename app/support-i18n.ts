export type SupportLanguage = "fr" | "en" | "sr" | "it" | "es";

type SupportCopy = {
  title: string; subtitle: string; newTicket: string; tickets: string; noTickets: string; supportByEmail: string;
  adminTitle: string; adminSubtitle: string; newInternalTicket: string;
  category: string; priority: string; subject: string; description: string; contactEmail: string; create: string; creating: string;
  assistantTitle: string; assistantText: string; emailActive: string; emailPending: string; reply: string; sendReply: string;
  internalNote: string; status: string; assignedTo: string; resolution: string; apply: string; close: string; back: string;
  requester: string; company: string; updated: string; waiting: string; created: string; confirmedClose: string;
  ticketScope: string; requestType: string;
  categories: Record<string, string>; priorities: Record<string, string>; statuses: Record<string, string>; authors: Record<string, string>;
  scopes: Record<string, string>; requestTypes: Record<string, string>;
};

export const supportCopies: Record<SupportLanguage, SupportCopy> = {
  fr: {
    title: "Support D2F", subtitle: "Créez et suivez vos demandes jusqu’à leur résolution.", newTicket: "Nouveau ticket", tickets: "Tickets", noTickets: "Aucun ticket pour le moment.", supportByEmail: "Support par e-mail",
    adminTitle: "Centre de traitement D2F", adminSubtitle: "Traitez les tickets clients : attribution, réponse, statut, solution et clôture.", newInternalTicket: "Créer un ticket interne",
    category: "Catégorie", priority: "Priorité", subject: "Objet", description: "Décrivez le problème et les étapes pour le reproduire", contactEmail: "Adresse e-mail à informer", create: "Créer le ticket", creating: "Création…",
    assistantTitle: "Assistant niveau 1", assistantText: "Un pré-diagnostic immédiat sera ajouté. Il ne clôture jamais le ticket et D2F garde la décision finale.", emailActive: "Notifications e-mail actives", emailPending: "Suivi dans l’application actif ; raccordement d’envoi e-mail à finaliser.", reply: "Votre réponse", sendReply: "Envoyer la réponse",
    internalNote: "Note interne D2F (non visible par le client)", status: "Statut", assignedTo: "Attribué à", resolution: "Solution apportée", apply: "Mettre à jour", close: "Confirmer que le ticket est soldé", back: "Retour aux tickets",
    requester: "Demandeur", company: "Entreprise", updated: "Mis à jour", waiting: "Veuillez patienter…", created: "Ticket créé", confirmedClose: "Le ticket est soldé.",
    ticketScope: "Visibilité", requestType: "Nature de la demande",
    categories: { access: "Connexion et accès", billing: "Abonnement", invoice: "Factures et devis", payment: "Paiements", einvoicing: "Facturation électronique", reporting: "Déclarations", compliance: "Conformité et preuves", technical: "Problème technique", other: "Autre" },
    priorities: { low: "Faible", normal: "Normale", high: "Haute", urgent: "Urgente" },
    statuses: { open: "Ouvert", in_progress: "En cours", waiting_customer: "En attente du demandeur", resolved: "Résolu", closed: "Soldé" },
    authors: { requester: "Demandeur", support: "Support D2F", assistant: "Assistant niveau 1", system: "Suivi du ticket" },
    scopes: { customer: "Client", internal: "Interne D2F" }, requestTypes: { incident: "Incident", need: "Besoin / amélioration", question: "Question" },
  },
  en: {
    title: "D2F Support", subtitle: "Create and track requests through resolution.", newTicket: "New ticket", tickets: "Tickets", noTickets: "No tickets yet.", supportByEmail: "Email support",
    adminTitle: "D2F processing centre", adminSubtitle: "Handle customer tickets: assignment, reply, status, resolution and closure.", newInternalTicket: "Create internal ticket",
    category: "Category", priority: "Priority", subject: "Subject", description: "Describe the issue and steps to reproduce it", contactEmail: "Email address to notify", create: "Create ticket", creating: "Creating…",
    assistantTitle: "Level-1 assistant", assistantText: "An immediate guided diagnosis will be added. It never closes a ticket and D2F retains the final decision.", emailActive: "Email notifications active", emailPending: "In-app tracking is active; outbound email delivery still needs configuration.", reply: "Your reply", sendReply: "Send reply",
    internalNote: "Internal D2F note (not visible to customer)", status: "Status", assignedTo: "Assigned to", resolution: "Resolution", apply: "Update", close: "Confirm that the ticket is closed", back: "Back to tickets",
    requester: "Requester", company: "Company", updated: "Updated", waiting: "Please wait…", created: "Ticket created", confirmedClose: "The ticket is closed.",
    ticketScope: "Visibility", requestType: "Request type",
    categories: { access: "Sign-in and access", billing: "Subscription", invoice: "Invoices and quotes", payment: "Payments", einvoicing: "E-invoicing", reporting: "Reporting", compliance: "Compliance and evidence", technical: "Technical issue", other: "Other" },
    priorities: { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" },
    statuses: { open: "Open", in_progress: "In progress", waiting_customer: "Waiting for requester", resolved: "Resolved", closed: "Closed" },
    authors: { requester: "Requester", support: "D2F Support", assistant: "Level-1 assistant", system: "Ticket tracking" },
    scopes: { customer: "Customer", internal: "Internal D2F" }, requestTypes: { incident: "Incident", need: "Need / improvement", question: "Question" },
  },
  sr: {
    title: "D2F podrška", subtitle: "Kreirajte i pratite zahteve do rešenja.", newTicket: "Novi tiket", tickets: "Tiketi", noTickets: "Još nema tiketa.", supportByEmail: "Podrška e-poštom",
    adminTitle: "D2F centar za obradu", adminSubtitle: "Obradite klijentske tikete: dodela, odgovor, status, rešenje i zatvaranje.", newInternalTicket: "Kreiraj interni tiket",
    category: "Kategorija", priority: "Prioritet", subject: "Naslov", description: "Opišite problem i korake za ponavljanje", contactEmail: "E-adresa za obaveštenja", create: "Kreiraj tiket", creating: "Kreiranje…",
    assistantTitle: "Asistent nivoa 1", assistantText: "Odmah se dodaje vođena dijagnostika. Asistent ne zatvara tiket; D2F donosi konačnu odluku.", emailActive: "E-mail obaveštenja su aktivna", emailPending: "Praćenje u aplikaciji je aktivno; slanje e-pošte treba povezati.", reply: "Vaš odgovor", sendReply: "Pošalji odgovor",
    internalNote: "Interna D2F beleška (nije vidljiva klijentu)", status: "Status", assignedTo: "Dodeljeno", resolution: "Rešenje", apply: "Ažuriraj", close: "Potvrdi da je tiket zatvoren", back: "Nazad na tikete",
    requester: "Podnosilac", company: "Preduzeće", updated: "Ažurirano", waiting: "Sačekajte…", created: "Tiket je kreiran", confirmedClose: "Tiket je zatvoren.",
    ticketScope: "Vidljivost", requestType: "Vrsta zahteva",
    categories: { access: "Prijava i pristup", billing: "Pretplata", invoice: "Fakture i ponude", payment: "Plaćanja", einvoicing: "E-fakture", reporting: "Izveštavanje", compliance: "Usklađenost i dokazi", technical: "Tehnički problem", other: "Drugo" },
    priorities: { low: "Nizak", normal: "Normalan", high: "Visok", urgent: "Hitan" },
    statuses: { open: "Otvoren", in_progress: "U radu", waiting_customer: "Čeka podnosioca", resolved: "Rešen", closed: "Zatvoren" },
    authors: { requester: "Podnosilac", support: "D2F podrška", assistant: "Asistent nivoa 1", system: "Praćenje tiketa" },
    scopes: { customer: "Klijent", internal: "Interni D2F" }, requestTypes: { incident: "Incident", need: "Potreba / unapređenje", question: "Pitanje" },
  },
  it: {
    title: "Supporto D2F", subtitle: "Create e seguite le richieste fino alla risoluzione.", newTicket: "Nuovo ticket", tickets: "Ticket", noTickets: "Nessun ticket.", supportByEmail: "Supporto via e-mail",
    adminTitle: "Centro di gestione D2F", adminSubtitle: "Gestite i ticket clienti: assegnazione, risposta, stato, soluzione e chiusura.", newInternalTicket: "Crea ticket interno",
    category: "Categoria", priority: "Priorità", subject: "Oggetto", description: "Descrivete il problema e i passaggi per riprodurlo", contactEmail: "E-mail da informare", create: "Crea ticket", creating: "Creazione…",
    assistantTitle: "Assistente di livello 1", assistantText: "Viene aggiunta subito una diagnosi guidata. Non chiude mai il ticket e D2F mantiene la decisione finale.", emailActive: "Notifiche e-mail attive", emailPending: "Il monitoraggio nell’app è attivo; l’invio e-mail deve essere configurato.", reply: "La vostra risposta", sendReply: "Invia risposta",
    internalNote: "Nota interna D2F (non visibile al cliente)", status: "Stato", assignedTo: "Assegnato a", resolution: "Soluzione", apply: "Aggiorna", close: "Conferma chiusura ticket", back: "Torna ai ticket",
    requester: "Richiedente", company: "Azienda", updated: "Aggiornato", waiting: "Attendere…", created: "Ticket creato", confirmedClose: "Il ticket è chiuso.",
    ticketScope: "Visibilità", requestType: "Tipo di richiesta",
    categories: { access: "Accesso", billing: "Abbonamento", invoice: "Fatture e preventivi", payment: "Pagamenti", einvoicing: "Fatturazione elettronica", reporting: "Dichiarazioni", compliance: "Conformità e prove", technical: "Problema tecnico", other: "Altro" },
    priorities: { low: "Bassa", normal: "Normale", high: "Alta", urgent: "Urgente" },
    statuses: { open: "Aperto", in_progress: "In corso", waiting_customer: "In attesa del richiedente", resolved: "Risolto", closed: "Chiuso" },
    authors: { requester: "Richiedente", support: "Supporto D2F", assistant: "Assistente L1", system: "Monitoraggio ticket" },
    scopes: { customer: "Cliente", internal: "Interno D2F" }, requestTypes: { incident: "Incidente", need: "Esigenza / miglioramento", question: "Domanda" },
  },
  es: {
    title: "Soporte D2F", subtitle: "Cree y siga sus solicitudes hasta su resolución.", newTicket: "Nuevo ticket", tickets: "Tickets", noTickets: "Aún no hay tickets.", supportByEmail: "Soporte por correo",
    adminTitle: "Centro de gestión D2F", adminSubtitle: "Gestione tickets de clientes: asignación, respuesta, estado, solución y cierre.", newInternalTicket: "Crear ticket interno",
    category: "Categoría", priority: "Prioridad", subject: "Asunto", description: "Describa el problema y los pasos para reproducirlo", contactEmail: "Correo a notificar", create: "Crear ticket", creating: "Creando…",
    assistantTitle: "Asistente de nivel 1", assistantText: "Se añade inmediatamente un diagnóstico guiado. Nunca cierra el ticket y D2F conserva la decisión final.", emailActive: "Notificaciones por correo activas", emailPending: "El seguimiento en la aplicación está activo; falta configurar el envío de correo.", reply: "Su respuesta", sendReply: "Enviar respuesta",
    internalNote: "Nota interna D2F (no visible para el cliente)", status: "Estado", assignedTo: "Asignado a", resolution: "Solución", apply: "Actualizar", close: "Confirmar cierre del ticket", back: "Volver a tickets",
    requester: "Solicitante", company: "Empresa", updated: "Actualizado", waiting: "Espere…", created: "Ticket creado", confirmedClose: "El ticket está cerrado.",
    ticketScope: "Visibilidad", requestType: "Tipo de solicitud",
    categories: { access: "Acceso", billing: "Suscripción", invoice: "Facturas y presupuestos", payment: "Pagos", einvoicing: "Facturación electrónica", reporting: "Declaraciones", compliance: "Cumplimiento y pruebas", technical: "Problema técnico", other: "Otro" },
    priorities: { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" },
    statuses: { open: "Abierto", in_progress: "En curso", waiting_customer: "Esperando al solicitante", resolved: "Resuelto", closed: "Cerrado" },
    authors: { requester: "Solicitante", support: "Soporte D2F", assistant: "Asistente N1", system: "Seguimiento del ticket" },
    scopes: { customer: "Cliente", internal: "Interno D2F" }, requestTypes: { incident: "Incidencia", need: "Necesidad / mejora", question: "Pregunta" },
  },
};

export function supportLanguage(value: string): SupportLanguage {
  const language = value.toLowerCase().slice(0, 2) as SupportLanguage;
  return language in supportCopies ? language : "fr";
}
