-- ============================================================
-- InfoPago RH — Eventos da Empresa
-- Festas, reuniões, treinamentos e eventos custom no calendário
-- Data: 2026-06-01
-- ============================================================

CREATE TABLE IF NOT EXISTS company_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo        text NOT NULL,
  descricao     text,
  data_inicio   date NOT NULL,
  data_fim      date,
  hora_inicio   time,
  hora_fim      time,
  dia_todo      boolean DEFAULT true,
  local         text,
  categoria     text NOT NULL DEFAULT 'evento' CHECK (categoria IN (
    'evento','festa','reuniao','treinamento','prazo','feriado_empresa','outros'
  )),
  cor           text DEFAULT '#1FAB54',
  publico_alvo  text,                                       -- 'todos','depto X', 'gestores'...
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  criado_por    uuid,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_events_data ON company_events(data_inicio);
CREATE INDEX IF NOT EXISTS idx_company_events_cat  ON company_events(categoria);

-- ── Permissões RBAC ──
INSERT INTO permissions (slug, nome, modulo, descricao) VALUES
  ('events.read',   'Ver eventos da empresa',   'calendar', 'Visualizar calendário de eventos'),
  ('events.manage', 'Gerenciar eventos da empresa','calendar', 'Criar, editar e excluir eventos no calendário')
ON CONFLICT (slug) DO NOTHING;

DO $$
DECLARE
  r_super uuid := (SELECT id FROM roles WHERE slug='super_admin');
  r_admin uuid := (SELECT id FROM roles WHERE slug='admin');
  r_rh    uuid := (SELECT id FROM roles WHERE slug='rh');
  r_fin   uuid := (SELECT id FROM roles WHERE slug='financeiro');
  r_gest  uuid := (SELECT id FROM roles WHERE slug='gestor');
  p_read  uuid := (SELECT id FROM permissions WHERE slug='events.read');
  p_mng   uuid := (SELECT id FROM permissions WHERE slug='events.manage');
BEGIN
  -- Todos podem ver eventos
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_super, p_read), (r_admin, p_read), (r_rh, p_read),
    (r_fin, p_read), (r_gest, p_read)
  ON CONFLICT DO NOTHING;
  -- Só admin/super/RH podem gerenciar
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_super, p_mng), (r_admin, p_mng), (r_rh, p_mng)
  ON CONFLICT DO NOTHING;
END $$;

ALTER TABLE company_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY p_ce_all ON company_events FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
