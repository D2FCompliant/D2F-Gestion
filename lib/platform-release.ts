export const currentPlatformRelease = {
  version: "3.4.0",
  ticketId: "34000000-0000-4000-8000-000000000001",
  ticketNumber: "D2F-REL-3400",
  releasedAt: "2026-07-23T12:00:00.000Z",
  subject: "v3.4.0 — Expenses : achats et ordres de mission",
  description: "Sépare les dépenses ordinaires de l’entreprise des ordres de mission, avec validation explicite, taux de change figé, justificatifs sécurisés et exports comptable, voyage et banque.",
  resolution: "Le parcours serbe reprend la structure Putni nalog / Putni račun. Les variantes FR, IT et ES sont créées en revue réglementaire et ne deviennent applicables qu’après leur publication gouvernée.",
  changes: [
    "Deux dossiers distincts : dépense d’entreprise et ordre de mission.",
    "Ordre préalable, décompte, rapport de mission et justification de nécessité professionnelle.",
    "Taux officiel du jour de validation conservé avec source et empreinte SHA-256.",
    "Exports traçables pour le comptable, l’ordre et le décompte de voyage, ainsi que le dossier bancaire serbe.",
    "Candidats Expenses 2026.2.0 pour RS, FR, IT et ES, sans publication automatique.",
  ],
} as const;
