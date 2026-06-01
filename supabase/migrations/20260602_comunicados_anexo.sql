-- Anexo (imagem ou arquivo) em comunicados
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS anexo_url text,
  ADD COLUMN IF NOT EXISTS anexo_nome text,
  ADD COLUMN IF NOT EXISTS anexo_tipo text,
  ADD COLUMN IF NOT EXISTS anexo_tamanho int;
