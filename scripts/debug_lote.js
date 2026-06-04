/**
 * Reproduz a geração em lote de holerites direto na rota,
 * usando o mesmo fluxo que o frontend chama.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });

const { supabase } = require('../src/config/supabase');
const { calcularHolerite } = require('../src/services/payroll');
const { calcularHEDoPonto } = require('../src/utils/pontoExtras');

const NAO_PERSISTE = ['lancamentos_detalhados', 'salario_familia', 'faixa_irrf', 'ano_tabela', 'vt_total_mes', 'vt_custo_empresa', 'valor_hora'];
function stripDB(o) { const c = { ...o }; NAO_PERSISTE.forEach(k => delete c[k]); return c; }

(async () => {
  const mes = 6, ano = 2026;
  console.log(`\n=== Tentando gerar lote para ${mes}/${ano} ===\n`);

  const { data: emps } = await supabase.from('employees').select('*').eq('status', 'ativo');
  console.log(`Funcionários ativos: ${emps?.length || 0}`);
  if (!emps?.length) return;

  for (const emp of emps) {
    console.log(`\n--- ${emp.nome_completo} (${emp.matricula}) ---`);
    console.log(`  salario_base: ${emp.salario_base}`);
    console.log(`  carga_horaria_semanal: ${emp.carga_horaria_semanal}`);
    console.log(`  data_admissao: ${emp.data_admissao}`);
    try {
      const heAuto = await calcularHEDoPonto(emp.id, mes, ano, emp.carga_horaria_semanal || 44);
      console.log(`  HE auto: ${JSON.stringify(heAuto)}`);

      const lancEffective = { dias_trabalhados: 30, data_pagamento: `${ano}-07-05` };
      if (heAuto.has_data) {
        lancEffective.horas_extras_50 = heAuto.horas_extras_50;
        lancEffective.horas_extras_100 = heAuto.horas_extras_100;
      }

      const calc = calcularHolerite(emp, lancEffective, ano);
      console.log(`  calc total_proventos: ${calc.total_proventos}`);
      console.log(`  calc salario_liquido: ${calc.salario_liquido}`);

      const payload = {
        employee_id: emp.id,
        competencia_mes: mes,
        competencia_ano: ano,
        ...stripDB(calc),
        pdf_path: null,
        pdf_generated_at: null,
        status: 'rascunho',
      };

      const { data: ps, error } = await supabase.from('payslips')
        .upsert(payload, { onConflict: 'employee_id,competencia_mes,competencia_ano' })
        .select().single();
      if (error) {
        console.log(`  ❌ ERRO: ${error.message}`);
        console.log(`     code: ${error.code}`);
        console.log(`     details: ${error.details}`);
      } else {
        console.log(`  ✓ Salvo: id=${ps.id.slice(0,8)} status=${ps.status}`);
      }
    } catch (e) {
      console.log(`  ❌ EXCEPTION: ${e.message}`);
      console.log(e.stack);
    }
  }

  // Lista o que tem no banco para mes 6 ano 2026
  console.log(`\n=== Holerites em ${mes}/${ano} ===`);
  const { data: existentes } = await supabase.from('payslips')
    .select('id, employee_id, status, total_proventos')
    .eq('competencia_mes', mes).eq('competencia_ano', ano);
  console.table(existentes);
})();
