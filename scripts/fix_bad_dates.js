const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };

(async () => {
  // Busca todos com ano > 9999 ou < 2000
  const r = await fetch(`${URL}/rest/v1/payslips?select=id,data_pagamento&data_pagamento=gte.10000-01-01`, { headers });
  const bad = await r.json();
  console.log('Holerites com data invalida:', bad.length);
  for (const p of bad) {
    // Remove os dígitos extras do ano. "62026-06-05" → "2026-06-05"
    const m = p.data_pagamento.match(/^\d*(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) { console.log('skip', p.id, p.data_pagamento); continue; }
    const corrigida = `${m[1]}-${m[2]}-${m[3]}`;
    const up = await fetch(`${URL}/rest/v1/payslips?id=eq.${p.id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ data_pagamento: corrigida })
    });
    console.log(p.id, p.data_pagamento, '->', corrigida, '(' + up.status + ')');
  }
  // Mesma coisa em outras tabelas que tem data_pagamento
  for (const tabela of ['thirteenth_salary', 'terminations', 'vacation_receipts']) {
    const r2 = await fetch(`${URL}/rest/v1/${tabela}?select=id,data_pagamento&data_pagamento=gte.10000-01-01`, { headers });
    if (!r2.ok) continue;
    const bad2 = await r2.json();
    if (bad2.length) console.log(`${tabela}:`, bad2.length, 'invalidas');
    for (const p of bad2) {
      const m = p.data_pagamento?.match(/^\d*(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) continue;
      const corrigida = `${m[1]}-${m[2]}-${m[3]}`;
      await fetch(`${URL}/rest/v1/${tabela}?id=eq.${p.id}`, {
        method: 'PATCH', headers, body: JSON.stringify({ data_pagamento: corrigida })
      });
      console.log(`  ${tabela} ${p.id}: ${p.data_pagamento} -> ${corrigida}`);
    }
  }
})();
