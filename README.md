# D2F Gestion

Cockpit web de gestion pour suivre les clients, dossiers, revenus et actions prioritaires. L’application est conçue pour un déploiement privé avec Sites et utilise Supabase comme base de données.

## Configuration Supabase

1. Créer un projet Supabase.
2. Exécuter le fichier `supabase/migrations/20260710150000_init_d2f_gestion.sql` dans l’éditeur SQL.
3. Copier `.env.example` vers `.env.local` et renseigner l’URL du projet, la clé `service_role` et l’adresse e-mail locale.
4. Lancer `npm run dev`.

La clé `service_role` reste exclusivement côté serveur. Les tables refusent tout accès direct aux rôles navigateur `anon` et `authenticated`; les requêtes sont filtrées par l’adresse e-mail authentifiée transmise par l’hébergement.

## Commandes

- `npm run dev` : développement local
- `npm run build` : compilation de production
- `npm test` : compilation et tests de rendu/sécurité
