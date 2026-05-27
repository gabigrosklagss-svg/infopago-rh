-- ============================================================
-- InfoPago RH — Módulos estratégicos
-- Avaliação de Desempenho, Recrutamento & Seleção, Férias Coletivas
-- Data: 2026-05-26
-- ============================================================

-- ── AVALIAÇÃO DE DESEMPENHO ────────────────────────────────
CREATE TABLE IF NOT EXISTS performance_cycles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome            text NOT NULL,
  periodo_inicio  date NOT NULL,
  periodo_fim     date NOT NULL,
  status          text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','em_andamento','finalizado')),
  criterios       jsonb DEFAULT '[]'::jsonb,
  descricao       text,
  criado_por      uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS performance_evaluations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id        uuid NOT NULL REFERENCES performance_cycles(id) ON DELETE CASCADE,
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  avaliador_id    uuid REFERENCES auth.users(id),
  notas           jsonb DEFAULT '{}'::jsonb,
  nota_final      numeric(3,1),
  pontos_fortes   text,
  pontos_melhoria text,
  plano_acao      text,
  observacoes     text,
  status          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','concluida')),
  data_avaliacao  date,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (cycle_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_perf_eval_employee ON performance_evaluations(employee_id);
CREATE INDEX IF NOT EXISTS idx_perf_eval_cycle ON performance_evaluations(cycle_id);

-- ── RECRUTAMENTO & SELEÇÃO ─────────────────────────────────
CREATE TABLE IF NOT EXISTS job_openings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          text NOT NULL,
  position_id     uuid REFERENCES positions(id) ON DELETE SET NULL,
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  vagas           int  NOT NULL DEFAULT 1,
  modalidade      text CHECK (modalidade IN ('presencial','remoto','hibrido')),
  tipo_contrato   text CHECK (tipo_contrato IN ('clt','pj','estagio','temporario','aprendiz')),
  salario_min     numeric(12,2),
  salario_max     numeric(12,2),
  requisitos      text,
  responsabilidades text,
  beneficios      text,
  local_trabalho  text,
  status          text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','pausada','encerrada','preenchida')),
  prioridade      text DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta','urgente')),
  data_abertura   date DEFAULT current_date,
  data_fechamento date,
  responsavel_id  uuid REFERENCES auth.users(id),
  observacoes     text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS candidates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_opening_id    uuid REFERENCES job_openings(id) ON DELETE CASCADE,
  nome_completo     text NOT NULL,
  email             text,
  telefone          text,
  cpf               text,
  data_nascimento   date,
  cidade            text,
  estado            text,
  linkedin_url      text,
  pretensao_salarial numeric(12,2),
  experiencia_anos  numeric(4,1),
  escolaridade      text,
  curriculo_url     text,
  curriculo_texto   text,
  origem            text,
  status            text NOT NULL DEFAULT 'triagem' CHECK (status IN (
    'triagem','entrevista','teste_tecnico','proposta','contratado','reprovado','desistiu'
  )),
  pontuacao         int CHECK (pontuacao BETWEEN 0 AND 100),
  observacoes       text,
  parse_extra       jsonb,
  responsavel_id    uuid REFERENCES auth.users(id),
  data_contratacao  date,
  employee_id       uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidates_job ON candidates(job_opening_id);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON candidates(status);

CREATE TABLE IF NOT EXISTS candidate_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  acao          text NOT NULL,
  status_de     text,
  status_para   text,
  observacao    text,
  usuario_id    uuid REFERENCES auth.users(id),
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cand_history ON candidate_history(candidate_id, created_at DESC);

-- ── FÉRIAS COLETIVAS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS collective_vacations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo          text NOT NULL,
  data_inicio     date NOT NULL,
  data_fim        date NOT NULL,
  dias            int  NOT NULL,
  escopo          text NOT NULL DEFAULT 'empresa' CHECK (escopo IN ('empresa','departamento','filial')),
  department_id   uuid REFERENCES departments(id) ON DELETE SET NULL,
  filial          text,
  observacoes     text,
  status          text NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada','aplicada','cancelada')),
  total_funcionarios int DEFAULT 0,
  aplicado_em     timestamptz,
  aplicado_por    uuid REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collective_vacation_employees (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collective_vacation_id   uuid NOT NULL REFERENCES collective_vacations(id) ON DELETE CASCADE,
  employee_id              uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  absence_id               uuid REFERENCES absences(id) ON DELETE SET NULL,
  created_at               timestamptz DEFAULT now(),
  UNIQUE (collective_vacation_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_cv_employees ON collective_vacation_employees(collective_vacation_id);

-- ── RLS (deixar permissivo, app usa service_role) ──────────
ALTER TABLE performance_cycles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_evaluations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_openings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_history             ENABLE ROW LEVEL SECURITY;
ALTER TABLE collective_vacations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE collective_vacation_employees ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY p_perf_cycles_all   ON performance_cycles            FOR ALL USING (true);
  CREATE POLICY p_perf_eval_all     ON performance_evaluations       FOR ALL USING (true);
  CREATE POLICY p_job_openings_all  ON job_openings                  FOR ALL USING (true);
  CREATE POLICY p_candidates_all    ON candidates                    FOR ALL USING (true);
  CREATE POLICY p_cand_hist_all     ON candidate_history             FOR ALL USING (true);
  CREATE POLICY p_cv_all            ON collective_vacations          FOR ALL USING (true);
  CREATE POLICY p_cv_emp_all        ON collective_vacation_employees FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
