-- ============================================================
-- InfoPago RH — Assinatura digital nativa (canvas)
-- ============================================================

CREATE TABLE IF NOT EXISTS signatures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_type        text NOT NULL,                -- 'rescisao','advertencia','contrato','comunicado','custom'
  doc_id          uuid,                          -- id do documento referenciado (opcional)
  doc_titulo      text NOT NULL,
  doc_descricao   text,
  doc_pdf_path    text,                          -- caminho do PDF original (opcional)
  signer_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  signer_name     text NOT NULL,
  signer_email    text,
  signer_cpf      text,
  token           text UNIQUE NOT NULL,          -- link público pra assinar
  status          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','assinada','recusada','expirada','cancelada')),
  motivo_recusa   text,
  signature_data  text,                          -- base64 do canvas (PNG)
  signed_at       timestamptz,
  signed_ip       text,
  signed_ua       text,
  expires_at      timestamptz,
  audit_trail     jsonb DEFAULT '[]'::jsonb,    -- log de acessos e eventos
  created_by      uuid,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sig_token ON signatures(token);
CREATE INDEX IF NOT EXISTS idx_sig_doc ON signatures(doc_type, doc_id);
CREATE INDEX IF NOT EXISTS idx_sig_status ON signatures(status);

-- Permissões RBAC
INSERT INTO permissions (slug, nome, modulo, descricao) VALUES
  ('signatures.read',   'Ver assinaturas',           'signatures', 'Visualizar solicitações de assinatura'),
  ('signatures.manage', 'Solicitar assinaturas',     'signatures', 'Criar pedidos de assinatura e cancelar')
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
  r_super uuid := (SELECT id FROM roles WHERE slug='super_admin');
  r_admin uuid := (SELECT id FROM roles WHERE slug='admin');
  r_rh    uuid := (SELECT id FROM roles WHERE slug='rh');
  p_read  uuid := (SELECT id FROM permissions WHERE slug='signatures.read');
  p_mng   uuid := (SELECT id FROM permissions WHERE slug='signatures.manage');
BEGIN
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_super, p_read), (r_super, p_mng),
    (r_admin, p_read), (r_admin, p_mng),
    (r_rh,    p_read), (r_rh,    p_mng)
  ON CONFLICT DO NOTHING;
END $$;

ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY p_sig_all ON signatures FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
