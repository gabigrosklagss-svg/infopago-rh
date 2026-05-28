const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
(async () => {
  const r = await fetch('https://api.supabase.com/v1/projects/rroxhjinwvrmhklehjwq/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'SELECT 1 as ok' })
  });
  console.log(r.status, (await r.text()).slice(0, 300));
})();
