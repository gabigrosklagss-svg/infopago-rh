-- ============================================================
-- InfoPago RH — Banco de Currículos (CV Pool)
-- Armazena currículos enviados sem vaga associada;
-- Quando surgir vaga compatível, gera candidato a partir do CV.
-- Data: 2026-05-31
-- ============================================================

CREATE TABLE IF NOT EXISTS cv_pool (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_completo       text NOT NULL,
  email               text,
  telefone            text,
  cpf                 text,
  data_nascimento     date,
  cidade              text,
  estado              text,
  linkedin_url        text,
  pretensao_salarial  numeric(12,2),
  experiencia_anos    numeric(4,1),
  escolaridade        text,
  formacao            text,
  ultimo_cargo        text,
  ultima_empresa      text,
  area_interesse      text,      -- TI, Financeiro, RH, Comercial, etc
  habilidades         text,
  idiomas             text,
  curriculo_url       text,      -- caminho no Supabase Storage
  curriculo_texto     text,      -- texto extraído pra busca
  parse_extra         jsonb,
  origem              text,      -- linkedin, indicacao, site, evento, banco_proprio
  observacoes         text,
  tags                text[],    -- ['react', 'frontend', 'remoto-only']
  status              text NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel','em_processo','contratado','indisponivel','arquivado')),
  ja_candidatou       boolean DEFAULT false,
  responsavel_id      uuid,
  recebido_em         date DEFAULT current_date,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cvpool_status ON cv_pool(status);
CREATE INDEX IF NOT EXISTS idx_cvpool_area ON cv_pool(area_interesse);
CREATE INDEX IF NOT EXISTS idx_cvpool_email ON cv_pool(email);

-- Histórico de candidaturas: vincula CV do pool a candidates de vagas
CREATE TABLE IF NOT EXISTS cv_pool_candidatures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cv_pool_id      uuid NOT NULL REFERENCES cv_pool(id) ON DELETE CASCADE,
  candidate_id    uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_opening_id  uuid REFERENCES job_openings(id) ON DELETE SET NULL,
  enviado_em      timestamptz DEFAULT now(),
  enviado_por     uuid,
  UNIQUE (cv_pool_id, job_opening_id)
);

CREATE INDEX IF NOT EXISTS idx_cvpool_cand_cv ON cv_pool_candidatures(cv_pool_id);

-- ── Permissões RBAC ──
INSERT INTO permissions (slug, nome, modulo, descricao) VALUES
  ('cvpool.read',    'Ver banco de currículos',     'recruitment', 'Listar currículos armazenados'),
  ('cvpool.manage',  'Gerenciar banco de currículos','recruitment', 'Cadastrar, editar, importar e arquivar currículos')
ON CONFLICT (slug) DO NOTHING;

-- Atribui pras roles que cuidam de recrutamento
DO $$
DECLARE
  r_super uuid := (SELECT id FROM roles WHERE slug='super_admin');
  r_admin uuid := (SELECT id FROM roles WHERE slug='admin');
  r_rh    uuid := (SELECT id FROM roles WHERE slug='rh');
  p_read  uuid := (SELECT id FROM permissions WHERE slug='cvpool.read');
  p_mng   uuid := (SELECT id FROM permissions WHERE slug='cvpool.manage');
BEGIN
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_super, p_read), (r_super, p_mng),
    (r_admin, p_read), (r_admin, p_mng),
    (r_rh,    p_read), (r_rh,    p_mng)
  ON CONFLICT DO NOTHING;
END $$;

ALTER TABLE cv_pool              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cv_pool_candidatures ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY p_cvpool_all ON cv_pool              FOR ALL USING (true);
  CREATE POLICY p_cvpc_all   ON cv_pool_candidatures FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
