-- ============================================================
-- InfoPago RH — Onda 2: RBAC + Segurança Backend
-- 5 cargos, ~50 permissões granulares, blacklist de tokens, kill switch
-- Data: 2026-05-28
-- ============================================================

-- ── ROLES ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  nome        text NOT NULL,
  descricao   text,
  nivel       int  NOT NULL DEFAULT 0,
  protegido   boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);

-- ── PERMISSIONS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  nome        text NOT NULL,
  modulo      text NOT NULL,
  descricao   text,
  created_at  timestamptz DEFAULT now()
);

-- ── ROLE_PERMISSIONS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id        uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id  uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at     timestamptz DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

-- ── USER_ROLES (mapeamento) ─────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  user_id     uuid NOT NULL,
  role_id     uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by  uuid,
  granted_at  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);

-- ── REVOKED TOKENS (blacklist) ──────────────────────────
CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash   text PRIMARY KEY,
  user_id      uuid,
  revoked_at   timestamptz DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  reason       text
);
CREATE INDEX IF NOT EXISTS idx_revoked_user ON revoked_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_exp ON revoked_tokens(expires_at);

-- ── SECURITY SETTINGS (kill switch global) ──────────────
CREATE TABLE IF NOT EXISTS security_settings (
  key         text PRIMARY KEY,
  value       jsonb,
  updated_at  timestamptz DEFAULT now(),
  updated_by  uuid
);
-- Tokens emitidos ANTES desta data são rejeitados (kill switch)
INSERT INTO security_settings (key, value) VALUES
  ('min_token_iat', to_jsonb(extract(epoch from now())::bigint))
ON CONFLICT (key) DO UPDATE SET value = to_jsonb(extract(epoch from now())::bigint), updated_at = now();

-- ── SEED ROLES ─────────────────────────────────────────
INSERT INTO roles (slug, nome, descricao, nivel, protegido) VALUES
  ('super_admin', 'Super Administrador', 'Acesso total irrestrito. Gerencia usuários, permissões e infraestrutura.', 100, true),
  ('admin',       'Administrador',       'Gestão completa de operação. Não gerencia permissões nem backups destrutivos.', 80, true),
  ('rh',          'Recursos Humanos',    'Operação de RH: funcionários, férias, holerites, documentos, recrutamento.', 60, true),
  ('financeiro',  'Financeiro',          'Folha, salários, encargos, relatórios financeiros e CTC.', 60, true),
  ('gestor',      'Gestor de Equipe',    'Aprovações de férias, avaliações e visualização do próprio departamento.', 40, true)
ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome, descricao = EXCLUDED.descricao, nivel = EXCLUDED.nivel;

-- ── SEED PERMISSIONS (ordenadas por módulo) ────────────
INSERT INTO permissions (slug, nome, modulo, descricao) VALUES
  -- Funcionários
  ('employees.read',     'Visualizar funcionários',     'employees',    'Listar e ver detalhes de funcionários ativos e inativos'),
  ('employees.create',   'Cadastrar funcionários',      'employees',    'Criar novos cadastros'),
  ('employees.update',   'Editar funcionários',         'employees',    'Alterar dados cadastrais (exceto financeiros)'),
  ('employees.delete',   'Excluir funcionários',        'employees',    'Soft + hard delete'),
  ('employees.photo',    'Gerenciar fotos',             'employees',    'Upload e remoção de fotos'),

  -- Salário (sensível)
  ('salary.read',        'Ver salários',                'salary',       'Visualizar campos financeiros do funcionário'),
  ('salary.update',      'Editar salários',             'salary',       'Alterar salário base, adicionais e benefícios'),
  ('salary.plan.manage', 'Plano de cargos e movimentações','salary',    'Faixas salariais, promoções, transferências'),

  -- Departamentos e cargos
  ('departments.manage', 'Gerenciar departamentos',     'orgstructure', 'CRUD de departamentos'),
  ('positions.manage',   'Gerenciar cargos',            'orgstructure', 'CRUD de cargos e faixas'),

  -- Holerites e folha
  ('payslips.read',      'Ver holerites',               'payslips',     'Visualizar holerites gerados'),
  ('payslips.create',    'Gerar holerites',             'payslips',     'Calcular e emitir folha'),
  ('payslips.send',      'Enviar holerites por e-mail', 'payslips',     'Envio individual e em lote'),
  ('payslips.delete',    'Excluir holerites',           'payslips',     'Remover holerite emitido'),

  -- Férias
  ('vacations.read',     'Ver solicitações de férias',  'vacations',    'Listar pedidos e recibos'),
  ('vacations.request',  'Criar solicitação de férias', 'vacations',    'Nova solicitação em nome do funcionário'),
  ('vacations.approve',  'Aprovar/negar férias',        'vacations',    'Decidir sobre solicitações'),
  ('vacations.collective','Férias coletivas',           'vacations',    'Criar e aplicar férias coletivas'),
  ('vacations.receipt',  'Gerar recibos de férias',     'vacations',    'PDF e cálculo do recibo'),

  -- Rescisão e 13º
  ('terminations.read',   'Ver rescisões',              'terminations', 'Visualizar TRCT calculados'),
  ('terminations.manage', 'Gerar rescisões',            'terminations', 'Calcular e emitir TRCT'),
  ('thirteenth.read',     'Ver 13º salário',            'thirteenth',   'Visualizar cálculos do décimo'),
  ('thirteenth.manage',   'Gerar 13º salário',          'thirteenth',   'Calcular 1ª e 2ª parcela'),

  -- Ausências, advertências, documentos
  ('absences.read',       'Ver ausências',              'absences',     'Listar faltas e atestados'),
  ('absences.manage',     'Lançar ausências',           'absences',     'Cadastrar faltas e justificativas'),
  ('warnings.read',       'Ver advertências',           'warnings',     'Listar advertências'),
  ('warnings.manage',     'Aplicar advertências',       'warnings',     'Criar e gerar PDF'),
  ('documents.read',      'Ver documentos',             'documents',    'Documentos do funcionário'),
  ('documents.manage',    'Gerenciar documentos',       'documents',    'Upload e exclusão'),

  -- Ponto
  ('time.read',           'Ver lançamentos de ponto',   'time',         'Espelho de ponto'),
  ('time.manage',         'Lançar e editar ponto',      'time',         'Bater ponto, ajustes, HE'),

  -- EPIs
  ('epis.read',           'Ver EPIs',                   'epis',         'Inventário e entregas'),
  ('epis.manage',         'Gerenciar EPIs',             'epis',         'Cadastro, entrega, devolução'),

  -- Recrutamento
  ('recruitment.read',    'Ver vagas e candidatos',     'recruitment',  'Pipeline de R&S'),
  ('recruitment.manage',  'Gerenciar R&S',              'recruitment',  'Criar vagas, mover candidatos, contratar'),

  -- Avaliação de desempenho
  ('performance.read',    'Ver avaliações',             'performance',  'Visualizar ciclos e notas'),
  ('performance.evaluate','Avaliar funcionários',       'performance',  'Lançar notas e plano de ação'),
  ('performance.manage',  'Gerenciar ciclos',           'performance',  'Criar e fechar ciclos'),

  -- Relatórios
  ('reports.view',        'Ver relatórios',             'reports',      'Dashboard e analytics'),
  ('reports.export',      'Exportar relatórios',        'reports',      'CSV e PDF'),
  ('reports.financial',   'Relatórios financeiros',     'reports',      'Custo de pessoal, encargos, salários (sensível)'),

  -- Configurações
  ('settings.read',       'Ver configurações',          'settings',     'Empresa, SMTP'),
  ('settings.manage',     'Editar configurações',       'settings',     'Razão social, SMTP, dados da empresa'),

  -- E-mail
  ('email.send',          'Enviar e-mails',             'email',        'Disparar e-mails do sistema'),
  ('email.smtp.test',     'Testar SMTP',                'email',        'Validar conexão'),

  -- Agente IA
  ('agent.use',           'Usar Ingrid (IA)',           'agent',        'Conversar com a agente IA'),

  -- Administração
  ('audit.view',          'Ver auditoria',              'audit',        'Logs de ações do sistema'),
  ('backup.run',          'Executar backup',            'backup',       'Backup manual'),
  ('backup.restore',      'Restaurar backup',           'backup',       'Restauração (destrutivo)'),
  ('users.read',          'Ver usuários do sistema',    'users',        'Listar contas com acesso'),
  ('users.manage',        'Gerenciar usuários',         'users',        'Criar, editar e desativar contas'),
  ('permissions.manage',  'Gerenciar permissões',       'security',     'Atribuir cargos e permissões (sensível)'),
  ('security.manage',     'Gerenciar segurança',        'security',     'Kill switch, revogar tokens')
ON CONFLICT (slug) DO NOTHING;

-- ── SEED ROLE_PERMISSIONS ─────────────────────────────
-- SUPER_ADMIN: TUDO
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE slug='super_admin'), p.id FROM permissions p
ON CONFLICT DO NOTHING;

-- ADMIN: tudo exceto users.manage, permissions.manage, backup.restore, security.manage
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE slug='admin'), p.id FROM permissions p
WHERE p.slug NOT IN ('users.manage','permissions.manage','backup.restore','security.manage')
ON CONFLICT DO NOTHING;

-- RH: operação completa de RH (sem salary.update, sem permissões sensíveis)
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE slug='rh'), p.id FROM permissions p
WHERE p.slug IN (
  'employees.read','employees.create','employees.update','employees.photo',
  'salary.read',
  'departments.manage','positions.manage',
  'payslips.read','payslips.create','payslips.send',
  'vacations.read','vacations.request','vacations.approve','vacations.collective','vacations.receipt',
  'terminations.read','terminations.manage',
  'thirteenth.read','thirteenth.manage',
  'absences.read','absences.manage',
  'warnings.read','warnings.manage',
  'documents.read','documents.manage',
  'time.read','time.manage',
  'epis.read','epis.manage',
  'recruitment.read','recruitment.manage',
  'performance.read','performance.evaluate','performance.manage',
  'reports.view','reports.export',
  'settings.read',
  'email.send','email.smtp.test',
  'agent.use',
  'audit.view'
)
ON CONFLICT DO NOTHING;

-- FINANCEIRO: foco em folha, salários e relatórios financeiros
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE slug='financeiro'), p.id FROM permissions p
WHERE p.slug IN (
  'employees.read',
  'salary.read','salary.update','salary.plan.manage',
  'payslips.read','payslips.create','payslips.send','payslips.delete',
  'terminations.read','terminations.manage',
  'thirteenth.read','thirteenth.manage',
  'reports.view','reports.export','reports.financial',
  'settings.read',
  'audit.view'
)
ON CONFLICT DO NOTHING;

-- GESTOR: read no que afeta o time, aprovações
INSERT INTO role_permissions (role_id, permission_id)
SELECT (SELECT id FROM roles WHERE slug='gestor'), p.id FROM permissions p
WHERE p.slug IN (
  'employees.read',
  'vacations.read','vacations.approve',
  'absences.read','absences.manage',
  'warnings.read','warnings.manage',
  'time.read',
  'performance.read','performance.evaluate',
  'reports.view'
)
ON CONFLICT DO NOTHING;

-- ── MIGRA user_profiles.role → user_roles ──────────────
-- Mapeia roles legadas pras novas
DO $$
DECLARE
  r_super uuid := (SELECT id FROM roles WHERE slug='super_admin');
  r_admin uuid := (SELECT id FROM roles WHERE slug='admin');
  r_rh    uuid := (SELECT id FROM roles WHERE slug='rh');
  r_fin   uuid := (SELECT id FROM roles WHERE slug='financeiro');
  r_gest  uuid := (SELECT id FROM roles WHERE slug='gestor');
BEGIN
  -- Quem é admin no legado vira admin novo. O super_admin é atribuído manualmente depois.
  INSERT INTO user_roles (user_id, role_id)
  SELECT id, r_admin FROM user_profiles WHERE role = 'admin'
  ON CONFLICT DO NOTHING;

  INSERT INTO user_roles (user_id, role_id)
  SELECT id, r_rh FROM user_profiles WHERE role = 'rh'
  ON CONFLICT DO NOTHING;

  INSERT INTO user_roles (user_id, role_id)
  SELECT id, r_fin FROM user_profiles WHERE role = 'financeiro'
  ON CONFLICT DO NOTHING;

  INSERT INTO user_roles (user_id, role_id)
  SELECT id, r_gest FROM user_profiles WHERE role IN ('gestor','manager')
  ON CONFLICT DO NOTHING;

  -- Quem ainda não tem nenhum role recebe RH (mais comum)
  INSERT INTO user_roles (user_id, role_id)
  SELECT up.id, r_rh
  FROM user_profiles up
  LEFT JOIN user_roles ur ON ur.user_id = up.id
  WHERE ur.user_id IS NULL
  ON CONFLICT DO NOTHING;
END $$;

-- ── PROMOVE primeiro admin a super_admin ────────────────
-- (o admin original do sistema vira super_admin)
DO $$
DECLARE
  r_super uuid := (SELECT id FROM roles WHERE slug='super_admin');
  first_admin uuid;
BEGIN
  SELECT id INTO first_admin
  FROM user_profiles
  WHERE role = 'admin' AND active IS NOT FALSE
  ORDER BY created_at ASC
  LIMIT 1;

  IF first_admin IS NOT NULL THEN
    INSERT INTO user_roles (user_id, role_id) VALUES (first_admin, r_super)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ── RLS ────────────────────────────────────────────────
ALTER TABLE roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE revoked_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY p_roles_all ON roles FOR ALL USING (true);
  CREATE POLICY p_perm_all ON permissions FOR ALL USING (true);
  CREATE POLICY p_rp_all ON role_permissions FOR ALL USING (true);
  CREATE POLICY p_ur_all ON user_roles FOR ALL USING (true);
  CREATE POLICY p_rt_all ON revoked_tokens FOR ALL USING (true);
  CREATE POLICY p_ss_all ON security_settings FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── VIEW: permissões por usuário (helper) ──────────────
CREATE OR REPLACE VIEW v_user_permissions AS
SELECT
  ur.user_id,
  r.slug AS role_slug,
  r.nivel,
  p.slug AS permission_slug,
  p.modulo
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id;
