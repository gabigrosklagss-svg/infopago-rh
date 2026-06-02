-- ============================================================
-- InfoPago RH — Autenticação em 2 fatores (TOTP)
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_2fa (
  user_id        uuid PRIMARY KEY,
  secret         text NOT NULL,                -- base32 secret do TOTP
  ativado        boolean NOT NULL DEFAULT false,
  backup_codes   jsonb DEFAULT '[]'::jsonb,    -- array de códigos hash (1 uso cada)
  created_at     timestamptz DEFAULT now(),
  ativado_em     timestamptz,
  last_used_at   timestamptz
);

-- Tokens temporários para o passo 2 do login (entre senha OK e código 2FA)
CREATE TABLE IF NOT EXISTS auth_2fa_pending (
  token        text PRIMARY KEY,
  user_id      uuid NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_2fa_pending_exp ON auth_2fa_pending(expires_at);

-- Guarda a sessão Supabase Auth do passo 1 (senha OK) até o passo 2 (TOTP)
CREATE TABLE IF NOT EXISTS auth_2fa_pending_session (
  pending_token  text PRIMARY KEY,
  access_token   text NOT NULL,
  refresh_token  text NOT NULL,
  expires_at     bigint,
  user_data      jsonb,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE auth_2fa                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_2fa_pending         ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_2fa_pending_session ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY p_2fa_all ON auth_2fa FOR ALL USING (true);
  CREATE POLICY p_2fa_pending_all ON auth_2fa_pending FOR ALL USING (true);
  CREATE POLICY p_2fa_pending_sess_all ON auth_2fa_pending_session FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
