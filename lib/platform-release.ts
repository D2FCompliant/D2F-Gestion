export const currentPlatformRelease = {
  version: "3.3.18",
  ticketId: "33180000-0000-4000-8000-000000000001",
  ticketNumber: "D2F-REL-3318",
  releasedAt: "2026-07-23T12:00:00.000Z",
  subject: "v3.3.18 — Country Pack Financial RS gouverné",
  description: "Ajoute la déclinaison Financial du Country Pack serbe, distincte du socle Platform déjà publié, avec ses références réglementaires officielles et sans activation silencieuse de règle locale.",
  resolution: "Le centre Country Packs peut maintenant qualifier country.rs.financial au moyen de la vérification des preuves et des validations réglementaire, technique et sécurité avant publication explicite.",
  changes: [
    "Création idempotente de country.rs.financial 2026.1.0 en revue réglementaire.",
    "Références officielles serbes pour la comptabilité, le plan de comptes et la TVA.",
    "Aucun taux, seuil, mapping comptable ou calendrier déclaratif activé avant validation humaine.",
    "Le Country Pack Platform publié reste inchangé et ne qualifie pas implicitement Financial.",
  ],
} as const;
