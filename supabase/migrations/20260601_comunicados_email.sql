-- ============================================================
-- InfoPago RH — Comunicados como ferramenta de envio em massa
-- Permite anexar destinatários (toda empresa, departamentos ou funcionários)
-- e disparar por e-mail mantendo o histórico do envio.
-- Data: 2026-06-01
-- ============================================================

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_scope text DEFAULT 'empresa'
    CHECK (target_scope IN ('empresa','departamentos','funcionarios')),
  ADD COLUMN IF NOT EXISTS target_dept_ids uuid[],
  ADD COLUMN IF NOT EXISTS target_employee_ids uuid[],
  ADD COLUMN IF NOT EXISTS enviar_email boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS total_destinatarios int,
  ADD COLUMN IF NOT EXISTS total_enviados int,
  ADD COLUMN IF NOT EXISTS total_falhas int;
