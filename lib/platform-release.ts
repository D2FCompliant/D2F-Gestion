export const currentPlatformRelease = {
  version: "3.3.17",
  ticketId: "33170000-0000-4000-8000-000000000001",
  ticketNumber: "D2F-REL-3317",
  releasedAt: "2026-07-22T09:12:00.000Z",
  subject: "v3.3.17 — compatibilité des clés Supabase",
  description: "Conserve le verrou strict sur l’URL officielle eafnemhzrvcdavjdbtpy tout en acceptant les clés Supabase opaques de nouvelle génération, qui ne peuvent pas être décodées comme les anciens JWT.",
  resolution: "Le contrôle fiable porte sur l’hôte du projet Supabase. La validité de la clé est vérifiée par Supabase lors de la connexion, sans supposer son format interne.",
  changes: [
    "URL Supabase limitée au projet eafnemhzrvcdavjdbtpy.",
    "Compatibilité avec les clés service_role Supabase opaques et JWT.",
    "Aucun compte, mot de passe ni enregistrement métier modifié.",
    "Correctif RPC de rattachement des avoirs conservé sous forme de migration idempotente.",
  ],
} as const;
