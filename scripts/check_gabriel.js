const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function get(t, q = '') {
  const r = await fetch(`${URL}/rest/v1/${t}${q}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  return await r.json();
}
(async () => {
  console.log('=== EMPLOYEES (todos os status) ===');
  const emps = await get('employees', '?select=id,nome_completo,matricula,status,data_demissao&order=matricula');
  console.table(emps);
  console.log('\n=== TERMINATIONS ===');
  const terms = await get('terminations', '?select=id,employee_id,data_demissao,tipo_rescisao,total_liquido,status&order=data_demissao.desc');
  console.table(terms);
  console.log('\n=== TIME_BANK_BALANCE ===');
  const bal = await get('time_bank_balance', '?select=employee_id,saldo_horas');
  console.table(bal);
})();
