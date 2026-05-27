// Aplica a migration via REST (pg_meta query)
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260526_modulos_estrategicos.sql'), 'utf8');

(async () => {
  const r = await fetch(`${URL}/pg/query`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const txt = await r.text();
  console.log('Status:', r.status);
  console.log(txt);
})();
