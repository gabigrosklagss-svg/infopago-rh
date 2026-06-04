-- Cache de respostas da IA para economizar custo
CREATE TABLE IF NOT EXISTS ia_cache (
  cache_key   text PRIMARY KEY,
  resposta    jsonb NOT NULL,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ia_cache_created ON ia_cache(created_at);

ALTER TABLE ia_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY p_ia_cache_all ON ia_cache FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Limpeza automática (manter só últimos 30 dias)
-- Pode ser feita por cron no app, mas adiciono esta função utilitária
CREATE OR REPLACE FUNCTION clean_ia_cache_antigo() RETURNS void AS $$
  DELETE FROM ia_cache WHERE created_at < now() - interval '30 days';
$$ LANGUAGE sql;
