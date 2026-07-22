export const currentPlatformRelease = {
  version: "3.3.15",
  ticketId: "33150000-0000-4000-8000-000000000001",
  ticketNumber: "D2F-REL-3315",
  releasedAt: "2026-07-22T08:45:00.000Z",
  subject: "v3.3.15 — environnement unique, Country Packs par module et traçabilité automatique",
  description: "Aligne les déploiements Sites et Cloudflare sur le projet Supabase officiel eafnemhzrvcdavjdbtpy. Sépare les états Platform, Financial et Expenses afin qu’un pack Platform publié ne qualifie jamais silencieusement les règles comptables ou de notes de frais. Crée automatiquement un ticket interne idempotent pour chaque version publiée.",
  resolution: "Le centre Support crée automatiquement cette fiche de version à sa première ouverture par D2F. Les Country Packs sont affichés et demandés par module, sans état contradictoire.",
  changes: [
    "Une seule base Supabase officielle pour les deux URL de déploiement.",
    "États Country Pack distincts pour Platform, Financial et Expenses.",
    "Demande de qualification explicitement rattachée au module concerné.",
    "Ticket de version automatique, idempotent et exportable en CSV.",
  ],
} as const;
