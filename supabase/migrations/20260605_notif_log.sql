CREATE TABLE IF NOT EXISTS notification_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text NOT NULL,
  destinatarios   text[],
  total_alertas   int,
  conteudo        jsonb,
  enviado_em      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_log_tipo ON notification_log(tipo);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY p_nlog_all ON notification_log FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
