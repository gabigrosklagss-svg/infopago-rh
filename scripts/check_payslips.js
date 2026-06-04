const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
(async () => {
  const r = await fetch(`${URL}/rest/v1/payslips?select=id,employee_id,competencia_mes,competencia_ano,status,pdf_path,total_proventos,created_at&order=created_at.desc&limit=20`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
  });
  const list = await r.json();
  console.table(list.map(p => ({
    mes: p.competencia_mes,
    ano: p.competencia_ano,
    status: p.status,
    pdf: p.pdf_path ? '✓' : '—',
    proventos: p.total_proventos,
    emp: p.employee_id.slice(0, 8),
    criado: p.created_at?.slice(0, 16),
  })));
})();
