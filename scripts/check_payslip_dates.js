const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
(async () => {
  const r = await fetch(`${URL}/rest/v1/payslips?select=id,competencia_mes,competencia_ano,data_pagamento,employees(nome_completo)&limit=10`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const data = await r.json();
  data.forEach(p => console.log(`${p.employees?.nome_completo?.padEnd(35)} mes=${p.competencia_mes}/${p.competencia_ano}  data_pagamento="${p.data_pagamento}"`));
})();
