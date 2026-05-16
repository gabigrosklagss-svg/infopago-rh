-- ============================================================
-- SISTEMA RH SIMPLIFIKK — Schema Supabase (PostgreSQL)
-- Execute TODO este arquivo de uma só vez no SQL Editor
-- ============================================================

-- Perfis de usuário
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(20) DEFAULT 'rh' CHECK (role IN ('admin', 'rh', 'gestor')),
  department VARCHAR(255),
  active BOOLEAN DEFAULT true,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Configurações da empresa
CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  razao_social VARCHAR(255) NOT NULL DEFAULT 'Minha Empresa',
  nome_fantasia VARCHAR(255),
  cnpj VARCHAR(18),
  inscricao_estadual VARCHAR(30),
  endereco VARCHAR(500),
  cidade VARCHAR(100),
  uf VARCHAR(2),
  cep VARCHAR(9),
  telefone VARCHAR(20),
  email_empresa VARCHAR(255),
  logo_url TEXT,
  smtp_host VARCHAR(255) DEFAULT 'smtp.gmail.com',
  smtp_port INTEGER DEFAULT 587,
  smtp_user VARCHAR(255),
  smtp_pass TEXT,
  email_nome_remetente VARCHAR(255) DEFAULT 'RH',
  dia_pagamento INTEGER DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO company_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Departamentos
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome VARCHAR(255) NOT NULL,
  codigo VARCHAR(20),
  responsavel VARCHAR(255),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cargos
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo VARCHAR(255) NOT NULL,
  cbo VARCHAR(10),
  cbo_descricao VARCHAR(255),
  nivel VARCHAR(30) CHECK (nivel IN ('junior','pleno','senior','especialista','coordenador','gerente','diretor')),
  salario_minimo DECIMAL(10,2),
  salario_maximo DECIMAL(10,2),
  department_id UUID REFERENCES departments(id),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Funcionários
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula VARCHAR(20) UNIQUE NOT NULL,
  nome_completo VARCHAR(255) NOT NULL,
  cpf VARCHAR(14) UNIQUE NOT NULL,
  rg VARCHAR(20),
  rg_orgao_emissor VARCHAR(20),
  rg_uf VARCHAR(2),
  pis_pasep VARCHAR(14),
  ctps VARCHAR(20),
  ctps_serie VARCHAR(10),
  ctps_uf VARCHAR(2),
  data_nascimento DATE NOT NULL,
  sexo CHAR(1) CHECK (sexo IN ('M','F')),
  estado_civil VARCHAR(20) CHECK (estado_civil IN ('solteiro','casado','divorciado','viuvo','uniao_estavel')),
  escolaridade VARCHAR(50),
  naturalidade VARCHAR(100),
  nacionalidade VARCHAR(100) DEFAULT 'Brasileiro(a)',
  nome_mae VARCHAR(255),
  nome_pai VARCHAR(255),
  email_pessoal VARCHAR(255),
  email_corporativo VARCHAR(255),
  telefone VARCHAR(20),
  celular VARCHAR(20),
  cep VARCHAR(9),
  logradouro VARCHAR(255),
  numero VARCHAR(20),
  complemento VARCHAR(100),
  bairro VARCHAR(100),
  cidade VARCHAR(100),
  uf VARCHAR(2),
  data_admissao DATE NOT NULL,
  data_demissao DATE,
  tipo_contrato VARCHAR(20) DEFAULT 'clt' CHECK (tipo_contrato IN ('clt','pj','estagio','temporario','aprendiz')),
  regime_trabalho VARCHAR(20) DEFAULT 'mensalista' CHECK (regime_trabalho IN ('mensalista','horista','comissionado')),
  carga_horaria_semanal INTEGER DEFAULT 44,
  status VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo','afastado','ferias','demitido')),
  motivo_demissao VARCHAR(255),
  department_id UUID REFERENCES departments(id),
  position_id UUID REFERENCES positions(id),
  gestor_id UUID REFERENCES employees(id),
  local_trabalho VARCHAR(255),
  setor VARCHAR(100),
  secao VARCHAR(100),
  filial VARCHAR(100),
  salario_base DECIMAL(10,2) NOT NULL,
  valor_hora DECIMAL(10,4),
  tem_vt BOOLEAN DEFAULT false,
  vt_valor_dia DECIMAL(10,2) DEFAULT 0,
  vt_dias_uteis INTEGER DEFAULT 22,
  tem_vr BOOLEAN DEFAULT false,
  vr_valor_dia DECIMAL(10,2) DEFAULT 0,
  vr_dias_uteis INTEGER DEFAULT 22,
  tem_va BOOLEAN DEFAULT false,
  va_valor_mes DECIMAL(10,2) DEFAULT 0,
  tem_plano_saude BOOLEAN DEFAULT false,
  plano_saude_valor DECIMAL(10,2) DEFAULT 0,
  tem_plano_odonto BOOLEAN DEFAULT false,
  plano_odonto_valor DECIMAL(10,2) DEFAULT 0,
  tem_seguro_vida BOOLEAN DEFAULT false,
  seguro_vida_valor DECIMAL(10,2) DEFAULT 0,
  num_dependentes INTEGER DEFAULT 0,
  num_filhos_salario_familia INTEGER DEFAULT 0,
  banco VARCHAR(10),
  banco_nome VARCHAR(100),
  agencia VARCHAR(10),
  conta VARCHAR(20),
  tipo_conta VARCHAR(20) CHECK (tipo_conta IN ('corrente','poupanca')),
  chave_pix VARCHAR(255),
  tipo_pix VARCHAR(20) CHECK (tipo_pix IN ('cpf','email','celular','aleatoria')),
  forma_pagamento VARCHAR(20) DEFAULT 'pix' CHECK (forma_pagamento IN ('transferencia','pix','cheque','dinheiro')),
  observacoes TEXT,
  foto_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Holerites
CREATE TABLE IF NOT EXISTS payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) NOT NULL,
  competencia_mes INTEGER NOT NULL CHECK (competencia_mes BETWEEN 1 AND 12),
  competencia_ano INTEGER NOT NULL,
  salario_base DECIMAL(10,2) NOT NULL,
  dias_trabalhados INTEGER DEFAULT 30,
  horas_extras_50 DECIMAL(6,2) DEFAULT 0,
  horas_extras_100 DECIMAL(6,2) DEFAULT 0,
  valor_horas_extras_50 DECIMAL(10,2) DEFAULT 0,
  valor_horas_extras_100 DECIMAL(10,2) DEFAULT 0,
  adicional_noturno_horas DECIMAL(6,2) DEFAULT 0,
  valor_adicional_noturno DECIMAL(10,2) DEFAULT 0,
  adicional_insalubridade DECIMAL(10,2) DEFAULT 0,
  adicional_periculosidade DECIMAL(10,2) DEFAULT 0,
  comissoes DECIMAL(10,2) DEFAULT 0,
  bonus DECIMAL(10,2) DEFAULT 0,
  gratificacao DECIMAL(10,2) DEFAULT 0,
  decimo_terceiro DECIMAL(10,2) DEFAULT 0,
  ferias_valor DECIMAL(10,2) DEFAULT 0,
  ferias_um_terco DECIMAL(10,2) DEFAULT 0,
  outros_proventos DECIMAL(10,2) DEFAULT 0,
  outros_proventos_desc VARCHAR(255),
  vr_valor DECIMAL(10,2) DEFAULT 0,
  va_valor DECIMAL(10,2) DEFAULT 0,
  total_proventos DECIMAL(10,2) NOT NULL,
  inss_valor DECIMAL(10,2) NOT NULL DEFAULT 0,
  irrf_valor DECIMAL(10,2) NOT NULL DEFAULT 0,
  fgts_valor DECIMAL(10,2) NOT NULL DEFAULT 0,
  vt_desconto DECIMAL(10,2) DEFAULT 0,
  plano_saude_desconto DECIMAL(10,2) DEFAULT 0,
  plano_odonto_desconto DECIMAL(10,2) DEFAULT 0,
  seguro_vida_desconto DECIMAL(10,2) DEFAULT 0,
  pensao_alimenticia DECIMAL(10,2) DEFAULT 0,
  adiantamento DECIMAL(10,2) DEFAULT 0,
  faltas_dias INTEGER DEFAULT 0,
  faltas_valor DECIMAL(10,2) DEFAULT 0,
  outros_descontos DECIMAL(10,2) DEFAULT 0,
  outros_descontos_desc VARCHAR(255),
  total_descontos DECIMAL(10,2) NOT NULL DEFAULT 0,
  salario_liquido DECIMAL(10,2) NOT NULL,
  base_inss DECIMAL(10,2),
  base_irrf DECIMAL(10,2),
  num_dependentes INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'rascunho' CHECK (status IN ('rascunho','gerado','enviado','confirmado')),
  data_pagamento DATE,
  observacoes TEXT,
  pdf_path TEXT,
  pdf_generated_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, competencia_mes, competencia_ano)
);

-- Log de envios
CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payslip_id UUID REFERENCES payslips(id),
  employee_id UUID REFERENCES employees(id),
  recipient_email VARCHAR(255) NOT NULL,
  subject VARCHAR(500),
  status VARCHAR(20) DEFAULT 'pendente' CHECK (status IN ('pendente','enviado','erro','bounce')),
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  confirmation_token UUID DEFAULT gen_random_uuid(),
  confirmed_at TIMESTAMPTZ,
  sent_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Envios agendados
CREATE TABLE IF NOT EXISTS scheduled_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competencia_mes INTEGER NOT NULL,
  competencia_ano INTEGER NOT NULL,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME DEFAULT '08:00',
  status VARCHAR(20) DEFAULT 'agendado' CHECK (status IN ('agendado','executando','concluido','erro','cancelado')),
  employee_filter VARCHAR(20) DEFAULT 'todos' CHECK (employee_filter IN ('todos','departamento','selecionados')),
  department_id UUID REFERENCES departments(id),
  employee_ids UUID[],
  created_by UUID REFERENCES auth.users(id),
  executed_at TIMESTAMPTZ,
  total_sent INTEGER DEFAULT 0,
  total_errors INTEGER DEFAULT 0,
  log_detalhado JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Afastamentos, faltas, atestados
CREATE TABLE IF NOT EXISTS absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  tipo VARCHAR(30) CHECK (tipo IN ('falta','atestado','ferias','licenca_maternidade','licenca_paternidade','afastamento_inss','suspensao','outros')),
  data_inicio DATE NOT NULL,
  data_fim DATE,
  dias INTEGER,
  justificado BOOLEAN DEFAULT false,
  descontar_salario BOOLEAN DEFAULT true,
  cid VARCHAR(10),
  medico_nome VARCHAR(255),
  medico_crm VARCHAR(20),
  anexo_url TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Férias
CREATE TABLE IF NOT EXISTS vacations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  periodo_aquisitivo_inicio DATE NOT NULL,
  periodo_aquisitivo_fim DATE NOT NULL,
  dias_direito INTEGER DEFAULT 30,
  dias_gozados INTEGER DEFAULT 0,
  dias_vendidos INTEGER DEFAULT 0,
  data_gozo_inicio DATE,
  data_gozo_fim DATE,
  status VARCHAR(20) DEFAULT 'em_aquisicao' CHECK (status IN ('em_aquisicao','a_gozar','em_gozo','concluido','vencido')),
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Histórico salarial
CREATE TABLE IF NOT EXISTS salary_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  salario_anterior DECIMAL(10,2),
  salario_novo DECIMAL(10,2) NOT NULL,
  data_reajuste DATE NOT NULL,
  motivo VARCHAR(255),
  percentual_reajuste DECIMAL(5,2),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Advertências disciplinares
CREATE TABLE IF NOT EXISTS warnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE NOT NULL,
  tipo VARCHAR(30) CHECK (tipo IN ('verbal','escrita','suspensao','justa_causa')) NOT NULL,
  data_ocorrencia DATE NOT NULL,
  motivo TEXT NOT NULL,
  descricao_detalhada TEXT,
  testemunhas TEXT,
  funcionario_ciente BOOLEAN DEFAULT false,
  dias_suspensao INTEGER DEFAULT 0,
  aplicada_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_cpf ON employees(cpf);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_payslips_employee ON payslips(employee_id);
CREATE INDEX IF NOT EXISTS idx_payslips_competencia ON payslips(competencia_ano, competencia_mes);
CREATE INDEX IF NOT EXISTS idx_payslips_status ON payslips(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_payslip ON email_logs(payslip_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_absences_employee ON absences(employee_id);
CREATE INDEX IF NOT EXISTS idx_vacations_employee ON vacations(employee_id);
CREATE INDEX IF NOT EXISTS idx_warnings_employee ON warnings(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_history_employee ON salary_history(employee_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE user_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips         ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_sends  ENABLE ROW LEVEL SECURITY;
ALTER TABLE warnings         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_full" ON employees;        CREATE POLICY "auth_full" ON employees        FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON payslips;         CREATE POLICY "auth_full" ON payslips         FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON email_logs;       CREATE POLICY "auth_full" ON email_logs       FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON company_settings; CREATE POLICY "auth_full" ON company_settings FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON departments;      CREATE POLICY "auth_full" ON departments      FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON positions;        CREATE POLICY "auth_full" ON positions        FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON absences;         CREATE POLICY "auth_full" ON absences         FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON vacations;        CREATE POLICY "auth_full" ON vacations        FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON salary_history;   CREATE POLICY "auth_full" ON salary_history   FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON scheduled_sends;  CREATE POLICY "auth_full" ON scheduled_sends  FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "auth_full" ON warnings;         CREATE POLICY "auth_full" ON warnings         FOR ALL TO authenticated USING (true);
DROP POLICY IF EXISTS "own_profile" ON user_profiles;  CREATE POLICY "own_profile" ON user_profiles  FOR ALL TO authenticated USING (auth.uid() = id);

-- ============================================================
-- TRIGGER updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employees_updated ON employees;
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_payslips_updated ON payslips;
CREATE TRIGGER trg_payslips_updated BEFORE UPDATE ON payslips FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_company_updated ON company_settings;
CREATE TRIGGER trg_company_updated BEFORE UPDATE ON company_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated ON user_profiles;
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
