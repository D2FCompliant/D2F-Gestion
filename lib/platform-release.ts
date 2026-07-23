export const currentPlatformRelease = {
  version: "3.4.3",
  ticketId: "34300000-0000-4000-8000-000000000001",
  ticketNumber: "D2F-REL-3430",
  releasedAt: "2026-07-23T15:30:00.000Z",
  subject: "v3.4.3 — Expenses : défilement, approbations et exports visibles",
  description: "Rétablit le défilement intégral des dossiers Expenses et rend explicite le parcours jusqu’à Approbations, au comptable et à la banque.",
  resolution: "Les actions restent visibles dans l’en-tête du dossier. Leur disponibilité et la condition manquante sont expliquées sans masquer les formulaires ni activer un export avant l’approbation requise.",
  changes: [
    "Défilement vertical rétabli sur l’intégralité du détail et de l’ordre de mission.",
    "Bouton Valider et soumettre toujours visible avec la condition bloquante affichée.",
    "La soumission alimente explicitement la file Approbations.",
    "Exports comptable, voyage et banque visibles avec activation selon le statut réglementaire.",
    "Parcours et messages disponibles en français, anglais, serbe, italien et espagnol.",
  ],
} as const;
