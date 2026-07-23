export const currentPlatformRelease = {
  version: "3.4.4",
  ticketId: "34400000-0000-4000-8000-000000000001",
  ticketNumber: "D2F-REL-3440",
  releasedAt: "2026-07-23T16:30:00.000Z",
  subject: "v3.4.4 — Expenses vers Financial et export comptable",
  description: "Relie les notes approuvées aux propositions Financial, fiabilise les conversions multidevises et ajoute un export comptable identifié par cabinet.",
  resolution: "Une approbation Expenses rafraîchit immédiatement Financial. Les taux suivent la convention 1 devise étrangère = X devise comptable, y compris pour les dossiers historiques.",
  changes: [
    "Les notes approuvées alimentent immédiatement les propositions D2F Financial.",
    "Export global des propositions comptables avec les coordonnées du cabinet destinataire.",
    "Coordonnées du cabinet comptable et de la banque configurables dans la fiche Entreprise.",
    "Remboursements et carte entreprise recalculés à partir des lignes de frais.",
    "Convention NBS corrigée : 1 EUR = 117,20 RSD, avec compatibilité des anciens dossiers.",
    "Analyse documentaire sécurisée prête pour un fournisseur Document AI configuré.",
  ],
} as const;
