export const currentPlatformRelease = {
  version: "3.3.16",
  ticketId: "33160000-0000-4000-8000-000000000001",
  ticketNumber: "D2F-REL-3316",
  releasedAt: "2026-07-22T09:05:00.000Z",
  subject: "v3.3.16 — verrouillage du projet Supabase officiel",
  description: "Interdit techniquement toute connexion à un projet Supabase autre que le projet officiel eafnemhzrvcdavjdbtpy. Vérifie simultanément l’URL et le project_ref de la clé service_role avant toute lecture ou écriture.",
  resolution: "Le centre Support crée automatiquement cette fiche de version. Une configuration Supabase étrangère ou incohérente est désormais bloquée avant tout accès aux données.",
  changes: [
    "URL Supabase limitée au projet eafnemhzrvcdavjdbtpy.",
    "Clé service_role contrôlée par son project_ref avant utilisation.",
    "Suppression de toute référence active à l’ancien projet dans la configuration locale et Sites.",
    "Correctif RPC de rattachement des avoirs livré sous forme de migration idempotente.",
  ],
} as const;
