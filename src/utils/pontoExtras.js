/**
 * Calcula horas extras automaticamente a partir do controle de ponto
 *
 * Regras CLT:
 *  - Sábado trabalhado → todas as horas viram HE 50%
 *  - Domingo trabalhado → todas as horas viram HE 100%
 *  - Feriado trabalhado → todas as horas viram HE 100%
 *  - Dia útil: somente as horas que excedem a carga diária viram HE 50%
 */

const { supabase } = require('../config/supabase');
const { feriadosDoAno } = require('../services/holidays');

async function calcularHEDoPonto(employeeId, mes, ano, cargaSemanal = 44) {
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(diasNoMes).padStart(2, '0')}`;

  const { data: entries } = await supabase.from('time_entries')
    .select('*').eq('employee_id', employeeId)
    .gte('data', inicio).lte('data', fim);

  if (!entries?.length) {
    return {
      has_data: false,
      horas_extras_50: 0,
      horas_extras_100: 0,
      dias_trabalhados_uteis: 0,
      dias_trabalhados_sabado: 0,
      dias_trabalhados_dom_feriado: 0,
      detalhes: [],
    };
  }

  const cargaDiaria = cargaSemanal / 5;
  const feriadosMap = feriadosDoAno(ano);

  let he50 = 0, he100 = 0;
  let diasUteis = 0, diasSabado = 0, diasDomFer = 0;
  const detalhes = [];

  for (const e of entries) {
    const horas = parseFloat(e.horas_trabalhadas || 0);
    if (horas <= 0) continue;

    const dt = new Date(e.data + 'T12:00:00');
    const dow = dt.getDay(); // 0=dom, 6=sab
    const ehFeriado = !!feriadosMap[e.data];

    if (ehFeriado || dow === 0) {
      // Domingo ou feriado → 100%
      he100 += horas;
      diasDomFer++;
      detalhes.push({ data: e.data, tipo: ehFeriado ? 'feriado' : 'domingo', horas, percentual: 100 });
    } else if (dow === 6) {
      // Sábado → 50%
      he50 += horas;
      diasSabado++;
      detalhes.push({ data: e.data, tipo: 'sabado', horas, percentual: 50 });
    } else {
      // Dia útil: horas que excedem a carga diária → 50%
      diasUteis++;
      const extras = Math.max(0, horas - cargaDiaria);
      if (extras > 0) {
        he50 += extras;
        detalhes.push({ data: e.data, tipo: 'util_extra', horas: extras, percentual: 50 });
      }
    }
  }

  return {
    has_data: true,
    horas_extras_50: parseFloat(he50.toFixed(2)),
    horas_extras_100: parseFloat(he100.toFixed(2)),
    dias_trabalhados_uteis: diasUteis,
    dias_trabalhados_sabado: diasSabado,
    dias_trabalhados_dom_feriado: diasDomFer,
    detalhes,
  };
}

module.exports = { calcularHEDoPonto };
