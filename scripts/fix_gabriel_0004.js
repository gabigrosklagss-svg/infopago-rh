const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env'), override: true });
const { supabase } = require('../src/config/supabase');
(async () => {
  const { data } = await supabase.from('employees').select('id,nome_completo,matricula,data_admissao,salario_base').eq('matricula', '0004').maybeSingle();
  if (!data) { console.log('Funcionário 0004 não encontrado'); return; }
  console.log('ANTES:', data);
  const hoje = new Date().toISOString().slice(0, 10);
  const { data: u } = await supabase.from('employees').update({ data_admissao: hoje })
    .eq('id', data.id).select('matricula,data_admissao').single();
  console.log('DEPOIS:', u);

  // Recria o período aquisitivo a partir de hoje
  await supabase.from('vacations').delete().eq('employee_id', data.id);
  const fim = new Date(); fim.setFullYear(fim.getFullYear() + 1); fim.setDate(fim.getDate() - 1);
  await supabase.from('vacations').insert({
    employee_id: data.id,
    periodo_aquisitivo_inicio: hoje,
    periodo_aquisitivo_fim: fim.toISOString().slice(0, 10),
    status: 'em_aquisicao',
  });
  console.log('Período aquisitivo recriado.');
})();
