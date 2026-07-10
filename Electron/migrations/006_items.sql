-- 006_items.sql
-- (renommé proprement: ton fichier s'appelait "005_items.sql" mais 005 est déjà pris)
--
-- Avec notre réorganisation, la table items est déjà créée dans 001_init.sql
-- et contient PLUS de colonnes (vat_category, item_type, active, etc.).
-- Donc pour éviter toute incohérence / plantage:
--  - on NE recrée PAS la table ici
--  - on garde uniquement des INDEX idempotents

PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_items_ref     ON items(ref);
CREATE INDEX IF NOT EXISTS idx_items_name    ON items(name);
CREATE INDEX IF NOT EXISTS idx_items_updated ON items(updated_at);
CREATE INDEX IF NOT EXISTS idx_items_active  ON items(active);
CREATE INDEX IF NOT EXISTS idx_items_type    ON items(item_type);
