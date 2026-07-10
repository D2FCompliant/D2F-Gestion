# D2F Gestion — version web

Cette branche conserve le logiciel Electron historique et ajoute une version accessible depuis un navigateur. L’interface métier existante est servie dans le site web ; ses appels IPC sont traduits en requêtes sécurisées vers Supabase.

## Fonctions web connectées

- paramètres de la société ;
- clients et articles ;
- devis et lignes de devis ;
- factures, acomptes et avoirs ;
- encaissements ;
- tableaux de bord et indicateurs.

Les fonctions dépendant du système local — sélection de fichiers, génération PDF/UBL, SMTP, connecteurs SFTP/PDP et audit sur disque — nécessitent un service serveur complémentaire et renvoient actuellement un message explicite dans le navigateur.

## Configuration Supabase

1. Créer un projet Supabase.
2. Exécuter `supabase/migrations/20260710150000_init_d2f_gestion.sql` dans l’éditeur SQL.
3. Copier `.env.example` vers `.env.local` et renseigner l’URL du projet, la clé `service_role` et l’adresse e-mail locale.
4. Lancer `npm run dev`.

La clé `service_role` reste exclusivement côté serveur. Les tables refusent tout accès direct aux rôles navigateur ; chaque requête est isolée par l’adresse e-mail authentifiée transmise par l’hébergement.
Pour un déploiement privé mono-utilisateur, `D2F_OWNER_EMAIL` fournit l’identité stable de secours lorsque l’hébergement ne transmet pas d’en-tête utilisateur.

## Commandes web

- `npm run dev` : développement local
- `npm run build` : compilation de production
- `npm test` : compilation et tests de rendu/sécurité
