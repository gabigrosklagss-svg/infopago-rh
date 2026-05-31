const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: positions } = await supabase
    .from('positions')
    .select('id, titulo, nivel, salario_minimo, salario_maximo, cbo_descricao, active');
  if (!positions?.length) { console.log('Nenhum cargo cadastrado.'); return; }

  const { data: grades } = await supabase.from('position_grades').select('position_id').eq('ativo', true);
  const cargosComGrade = new Set((grades || []).map(g => g.position_id));

  const semGrade = positions.filter(p => p.active !== false && !cargosComGrade.has(p.id));
  console.log(`Total cargos: ${positions.length}`);
  console.log(`Já com grade: ${positions.length - semGrade.length}`);
  console.log(`Sem grade: ${semGrade.length}\n`);

  let criadas = 0;
  for (const p of semGrade) {
    const nivelLabel = p.nivel ? p.nivel.charAt(0).toUpperCase() + p.nivel.slice(1) : 'Inicial';
    const salario = p.salario_minimo || 0;
    const { error } = await supabase.from('position_grades').insert({
      position_id: p.id, grade_nivel: nivelLabel, salario_base: salario,
      ordem: 1, ativo: true, descricao_competencias: p.cbo_descricao || null,
    });
    if (error) console.log(`✗ ${p.titulo}: ${error.message}`);
    else { console.log(`✓ ${p.titulo} → faixa ${nivelLabel} · R$ ${salario}`); criadas++; }
  }
  console.log(`\nTotal criadas: ${criadas}`);
})();
