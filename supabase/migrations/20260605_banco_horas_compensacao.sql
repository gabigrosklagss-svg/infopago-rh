-- ============================================================
-- Banco de horas com compensação automática (CLT art. 59 §2º)
-- Limite: 180 dias entre acúmulo e compensação (acordo individual)
-- Limite: 365 dias (acordo coletivo)
-- ============================================================

CREATE TABLE IF NOT EXISTS time_bank_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('credito_he','debito_falta','compensacao_folga','expiracao','ajuste_manual')),
  horas           numeric(6,2) NOT NULL,             -- positivo = entrada, negativo = saída
  data_referencia date NOT NULL,                      -- dia que gerou a transação
  data_expiracao  date,                               -- data limite pra usar este saldo (180d default)
  saldo_anterior  numeric(6,2),
  saldo_posterior numeric(6,2),
  descricao       text,
  related_entry_id uuid,                              -- time_entry, absence, etc
  created_by      uuid,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tbt_emp ON time_bank_transactions(employee_id, data_referencia DESC);
CREATE INDEX IF NOT EXISTS idx_tbt_exp ON time_bank_transactions(data_expiracao);

CREATE TABLE IF NOT EXISTS time_bank_rules (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ativo                boolean DEFAULT true,
  limite_acumulo_horas numeric(6,2) DEFAULT 60,       -- máximo a acumular (ex: 60h)
  prazo_compensacao_dias int DEFAULT 180,             -- 180d individual / 365d coletivo
  permite_negativo     boolean DEFAULT true,          -- pode ficar negativo (faltas)
  conversao_he50       numeric(4,2) DEFAULT 1.0,      -- 1h trabalhada em sábado = 1h no banco
  conversao_he100      numeric(4,2) DEFAULT 1.0,      -- 1h trabalhada em domingo = 1h no banco
  expira_automatico    boolean DEFAULT true,          -- ao expirar, paga em $ ou perde
  forma_expiracao      text DEFAULT 'paga' CHECK (forma_expiracao IN ('paga','perde')),
  observacao           text,
  updated_at           timestamptz DEFAULT now()
);

INSERT INTO time_bank_rules (ativo) VALUES (true)
ON CONFLICT DO NOTHING;
