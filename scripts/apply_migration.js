// Aplica migration via RPC exec_sql (se existir) ou diagnóstica
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260526_modulos_estrategicos.sql'), 'utf8');

async function tryRPC(name, body) {
  const r = await fetch(`${URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.text() };
}

(async () => {
  for (const fname of ['exec_sql', 'execute_sql', 'run_sql', 'sql']) {
    const r = await tryRPC(fname, { sql: 'SELECT 1 as ok' });
    console.log(`RPC ${fname}: ${r.status} ${r.body.slice(0, 200)}`);
    if (r.status === 200 || r.status === 204) {
      console.log(`✓ ${fname} funciona. Aplicando migration completa...`);
      const r2 = await tryRPC(fname, { sql });
      console.log('Resultado migration:', r2.status, r2.body.slice(0, 500));
      return;
    }
  }
  console.log('\nNenhuma RPC de execução SQL disponível.');
  console.log('Você precisa colar a SQL manualmente em:');
  console.log(`  ${URL.replace('.supabase.co', '.supabase.com/project/').replace('https://', 'https://supabase.com/dashboard/project/').slice(0, -1)}`);
  console.log('  Path: supabase/migrations/20260526_modulos_estrategicos.sql');
})();
