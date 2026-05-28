const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tables = [
  'performance_cycles', 'performance_evaluations',
  'job_openings', 'candidates', 'candidate_history',
  'collective_vacations', 'collective_vacation_employees'
];
(async () => {
  for (const t of tables) {
    const r = await fetch(`${URL}/rest/v1/${t}?select=id&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const ok = r.status === 200;
    console.log(`${ok ? '✓' : '✗'} ${t.padEnd(35)} ${r.status}`);
  }
})();
