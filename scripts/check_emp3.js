const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
(async () => {
  const r = await fetch(`${URL}/rest/v1/employees?select=id,nome_completo,matricula,status,salario_base,data_admissao,carga_horaria_semanal,num_dependentes`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
  });
  console.table(await r.json());
})();
