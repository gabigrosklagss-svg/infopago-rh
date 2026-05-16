const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { feriadosDoAno } = require('../services/holidays');

/* Calcula horas trabalhadas (entre 4 marcações) */
function calcHoras(e1, s1, e2, s2) {
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const m1 = toMin(e1), m2 = toMin(s1), m3 = toMin(e2), m4 = toMin(s2);
  let total = 0;
  if (m1 != null && m2 != null) total += Math.max(0, m2 - m1);
  if (m3 != null && m4 != null) total += Math.max(0, m4 - m3);
  return parseFloat((total / 60).toFixed(2));
}

/**
 * Verifica se a data é dia de descanso (sábado/domingo/feriado)
 *  - Nesses dias: TODAS as horas trabalhadas viram horas extras
 *  - Nesses dias: NÃO se conta horas faltantes (não há expectativa de trabalho)
 */
function ehDiaDeDescanso(dataIso) {
  const dt = new Date(dataIso + 'T12:00:00');
  const dow = dt.getDay();
  if (dow === 0 || dow === 6) return true;
  const ano = parseInt(dataIso.slice(0, 4));
  return !!feriadosDoAno(ano)[dataIso];
}

/** Calcula extras/faltantes considerando se o dia é descanso */
function calcularHorasDoDia(dataIso, horasTrab, horasEsperadas) {
  if (ehDiaDeDescanso(dataIso)) {
    // Sábado, domingo ou feriado → todas as horas viram extras, sem faltantes
    return {
      horas_extras: parseFloat((horasTrab || 0).toFixed(2)),
      horas_faltantes: 0,
    };
  }
  // Dia útil
  return {
    horas_extras: parseFloat(Math.max(0, horasTrab - horasEsperadas).toFixed(2)),
    horas_faltantes: parseFloat(Math.max(0, horasEsperadas - horasTrab).toFixed(2)),
  };
}

/* GET /api/time/espelho/:employee_id?mes=&ano= — espelho mensal */
router.get('/espelho/:employee_id', requireAuth, async (req, res) => {
  const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);
  const ano = parseInt(req.query.ano) || new Date().getFullYear();
  const ini = `${ano}-${String(mes).padStart(2,'0')}-01`;
  const fim = new Date(ano, mes, 0).toISOString().split('T')[0];

  const [entries, emp, bank] = await Promise.all([
    supabase.from('time_entries').select('*').eq('employee_id', req.params.employee_id)
      .gte('data', ini).lte('data', fim).order('data'),
    supabase.from('employees').select('id, nome_completo, matricula, carga_horaria_semanal').eq('id', req.params.employee_id).single(),
    supabase.from('time_bank_balance').select('*').eq('employee_id', req.params.employee_id).maybeSingle(),
  ]);

  const cargaSemanal = emp.data?.carga_horaria_semanal || 44;
  const horasDia = parseFloat((cargaSemanal / 5).toFixed(2)); // 5 dias úteis

  const data = entries.data || [];
  const totalTrab = data.reduce((s, r) => s + parseFloat(r.horas_trabalhadas || 0), 0);
  const totalExtras = data.reduce((s, r) => s + parseFloat(r.horas_extras || 0), 0);
  const totalFaltantes = data.reduce((s, r) => s + parseFloat(r.horas_faltantes || 0), 0);

  res.json({
    employee: emp.data,
    competencia: { mes, ano, inicio: ini, fim },
    entries: data,
    totais: {
      horas_trabalhadas: parseFloat(totalTrab.toFixed(2)),
      horas_extras: parseFloat(totalExtras.toFixed(2)),
      horas_faltantes: parseFloat(totalFaltantes.toFixed(2)),
      dias_registrados: data.length,
      carga_diaria_esperada: horasDia,
    },
    banco_horas: bank.data?.saldo_horas || 0,
  });
});

/* POST /api/time — registrar/atualizar dia (upsert) */
router.post('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { employee_id, data, entrada_1, saida_1, entrada_2, saida_2, observacao } = req.body;
  if (!employee_id || !data) return res.status(400).json({ error: 'employee_id e data são obrigatórios.' });

  const { data: emp } = await supabase.from('employees').select('carga_horaria_semanal').eq('id', employee_id).single();
  const horasEsperadas = (emp?.carga_horaria_semanal || 44) / 5;

  const horasTrab = calcHoras(entrada_1, saida_1, entrada_2, saida_2);
  const { horas_extras, horas_faltantes } = calcularHorasDoDia(data, horasTrab, horasEsperadas);

  const payload = {
    employee_id, data,
    entrada_1: entrada_1 || null,
    saida_1: saida_1 || null,
    entrada_2: entrada_2 || null,
    saida_2: saida_2 || null,
    horas_trabalhadas: horasTrab,
    horas_extras,
    horas_faltantes,
    observacao,
    ajuste_manual: true,
    ajustado_por: req.user.id,
  };

  const { data: rec, error } = await supabase.from('time_entries')
    .upsert(payload, { onConflict: 'employee_id,data' }).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Atualiza banco de horas (extras - faltantes)
  try {
    const delta = parseFloat((horas_extras - horas_faltantes).toFixed(2));
    const { data: bal } = await supabase.from('time_bank_balance').select('saldo_horas').eq('employee_id', employee_id).maybeSingle();
    const novoSaldo = parseFloat(((bal?.saldo_horas || 0) + delta).toFixed(2));
    await supabase.from('time_bank_balance').upsert({
      employee_id, saldo_horas: novoSaldo, ultima_atualizacao: new Date().toISOString()
    }, { onConflict: 'employee_id' });
  } catch (e) {
    console.warn('Banco de horas não atualizado:', e.message);
  }

  res.status(201).json(rec);
});

/* POST /api/time/bate-ponto — registro rápido do horário atual */
router.post('/bate-ponto', requireAuth, async (req, res) => {
  const { employee_id } = req.body;
  if (!employee_id) return res.status(400).json({ error: 'employee_id obrigatório.' });

  const agora = new Date();
  const dataHoje = agora.toISOString().split('T')[0];
  const horaAgora = agora.toTimeString().slice(0, 5);

  const { data: existing } = await supabase.from('time_entries')
    .select('*').eq('employee_id', employee_id).eq('data', dataHoje).maybeSingle();

  // Determina qual marcação vai bater
  const merged = {
    entrada_1: existing?.entrada_1,
    saida_1:   existing?.saida_1,
    entrada_2: existing?.entrada_2,
    saida_2:   existing?.saida_2,
  };
  if (!merged.entrada_1)      merged.entrada_1 = horaAgora;
  else if (!merged.saida_1)   merged.saida_1   = horaAgora;
  else if (!merged.entrada_2) merged.entrada_2 = horaAgora;
  else if (!merged.saida_2)   merged.saida_2   = horaAgora;
  else return res.status(400).json({ error: 'Já tem 4 marcações para hoje.' });

  const { data: emp } = await supabase.from('employees').select('carga_horaria_semanal').eq('id', employee_id).single();
  const horasEsperadas = (emp?.carga_horaria_semanal || 44) / 5;
  const horasTrab = calcHoras(merged.entrada_1, merged.saida_1, merged.entrada_2, merged.saida_2);
  const { horas_extras, horas_faltantes } = calcularHorasDoDia(dataHoje, horasTrab, horasEsperadas);

  const payload = {
    employee_id, data: dataHoje,
    ...merged,
    horas_trabalhadas: horasTrab,
    horas_extras,
    horas_faltantes,
    ajuste_manual: false,
    ajustado_por: req.user.id,
  };

  const { data, error } = await supabase.from('time_entries')
    .upsert(payload, { onConflict: 'employee_id,data' }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

/* DELETE /api/time/:id */
router.delete('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { error } = await supabase.from('time_entries').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* GET /api/time/banco-horas — saldo de todos os funcionários */
router.get('/banco-horas', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('time_bank_balance')
    .select('*, employees(nome_completo, matricula, departments(nome))')
    .order('saldo_horas', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
