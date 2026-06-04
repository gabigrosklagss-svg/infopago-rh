const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env'), override: true });
const { supabase } = require('../src/config/supabase');
(async () => {
  const { data: demitidos } = await supabase.from('employees').select('id, nome_completo').neq('status', 'ativo');
  for (const e of demitidos || []) {
    const { error } = await supabase.from('time_bank_balance').delete().eq('employee_id', e.id);
    console.log(error ? `✗ ${e.nome_completo}: ${error.message}` : `✓ Saldo removido: ${e.nome_completo}`);
  }
})();
