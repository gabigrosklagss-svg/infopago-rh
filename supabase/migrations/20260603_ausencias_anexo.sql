-- Anexo de atestado/comprovante na falta
ALTER TABLE absences
  ADD COLUMN IF NOT EXISTS anexo_url text,
  ADD COLUMN IF NOT EXISTS anexo_nome text,
  ADD COLUMN IF NOT EXISTS anexo_tipo text;
