-- !preview conn=DBI::dbConnect(RSQLite::SQLite())

-- 060_company_vat_regime.sql
ALTER TABLE company ADD COLUMN vat_regime TEXT DEFAULT 'REAL_NORMAL_MONTHLY';

