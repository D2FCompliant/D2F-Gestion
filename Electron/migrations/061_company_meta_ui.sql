PRAGMA foreign_keys = ON;

-- Ajouts “Company UI / PDF”
ALTER TABLE company ADD COLUMN cgv_text TEXT;
ALTER TABLE company ADD COLUMN bank_name TEXT;
ALTER TABLE company ADD COLUMN bank_holder TEXT;
ALTER TABLE company ADD COLUMN bank_extra TEXT;
ALTER TABLE company ADD COLUMN show_logo INTEGER NOT NULL DEFAULT 1;

-- (Optionnel) zone JSON “libre” pour stocker des choses UI/config
-- Si tu veux l’utiliser au lieu d’un fichier company.meta.json
ALTER TABLE company ADD COLUMN meta_json TEXT NOT NULL DEFAULT '{}';

-- Normalise l’existant (si la ligne id=1 existe déjà)
UPDATE company
SET
  cgv_text   = COALESCE(cgv_text, ''),
  bank_name  = COALESCE(bank_name, ''),
  bank_holder= COALESCE(bank_holder, ''),
  bank_extra = COALESCE(bank_extra, ''),
  show_logo  = COALESCE(show_logo, 1),
  meta_json  = COALESCE(meta_json, '{}')
WHERE id = 1;
