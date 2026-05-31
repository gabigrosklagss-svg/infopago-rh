const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, authorize } = require('../middleware/auth');

/* ── GRADES por cargo ─────────────────────────────────── */
router.get('/grades', requireAuth, async (req, res) => {
  const { position_id } = req.query;
  let q = supabase.from('position_grades')
    .select('*, positions(titulo, cbo, nivel, departments(nome))')
    .eq('ativo', true).order('position_id').order('ordem');
  if (position_id) q = q.eq('position_id', position_id);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/grades', requireAuth, authorize('salary.plan.manage'), async (req, res) => {
  const payload = { ...req.body };
  if (!payload.position_id || !payload.grade_nivel || !payload.salario_base) {
    return res.status(400).json({ error: 'position_id, grade_nivel e salario_base são obrigatórios.' });
  }
  const { data, error } = await supabase.from('position_grades').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/grades/:id', requireAuth, authorize('salary.plan.manage'), async (req, res) => {
  const payload = { ...req.body }; delete payload.id; delete payload.created_at; delete payload.positions;
  const { data, error } = await supabase.from('position_grades').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/grades/:id', requireAuth, authorize('salary.plan.manage'), async (req, res) => {
  await supabase.from('position_grades').update({ ativo: false }).eq('id', req.params.id);
  res.json({ success: true });
});

/* ── MOVIMENTAÇÕES de carreira ────────────────────────── */
router.get('/movements/employee/:employee_id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('career_movements')
    .select('*, position_anterior:positions!career_movements_position_anterior_id_fkey(titulo), position_nova:positions!career_movements_position_nova_id_fkey(titulo)')
    .eq('employee_id', req.params.employee_id)
    .order('data_movimento', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/movements', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('career_movements')
    .select('*, employees(nome_completo, matricula)')
    .order('data_movimento', { ascending: false }).limit(100);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

/**
 * Resolve o department_id automaticamente quando um position_nova_id é informado.
 * Se o cliente já passou department_novo_id, respeita. Senão, busca o do cargo.
 */
async function resolverDepartamentoDoCargo(payload) {
  if (payload.position_nova_id && !payload.department_novo_id) {
    const { data: pos } = await supabase.from('positions').select('department_id').eq('id', payload.position_nova_id).single();
    if (pos?.department_id) payload.department_novo_id = pos.department_id;
  }
  return payload;
}

router.post('/movements', requireAuth, authorize('salary.plan.manage'), async (req, res) => {
  const payload = await resolverDepartamentoDoCargo({ ...req.body, aprovado_por: req.user.id });
  if (!payload.employee_id || !payload.tipo || !payload.data_movimento) {
    return res.status(400).json({ error: 'employee_id, tipo e data_movimento são obrigatórios.' });
  }
  // Calcula percentual de aumento se informado
  if (payload.salario_anterior && payload.salario_novo) {
    const pct = ((parseFloat(payload.salario_novo) - parseFloat(payload.salario_anterior)) / parseFloat(payload.salario_anterior)) * 100;
    payload.percentual_aumento = parseFloat(pct.toFixed(2));
  }

  const { data, error } = await supabase.from('career_movements').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Aplica a movimentação no funcionário (atualiza dados atuais)
  const empUpdate = {};
  if (payload.position_nova_id) empUpdate.position_id = payload.position_nova_id;
  if (payload.grade_nova_id) empUpdate.grade_id = payload.grade_nova_id;
  if (payload.department_novo_id) empUpdate.department_id = payload.department_novo_id;
  if (payload.salario_novo) empUpdate.salario_base = payload.salario_novo;

  if (Object.keys(empUpdate).length) {
    await supabase.from('employees').update(empUpdate).eq('id', payload.employee_id);
  }

  res.status(201).json(data);
});

router.put('/movements/:id', requireAuth, authorize('salary.plan.manage'), async (req, res) => {
  const payload = await resolverDepartamentoDoCargo({ ...req.body });
  delete payload.id;
  delete payload.created_at;
  delete payload.aprovado_por;
  delete payload.employees;

  if (payload.salario_anterior && payload.salario_novo) {
    const pct = ((parseFloat(payload.salario_novo) - parseFloat(payload.salario_anterior)) / parseFloat(payload.salario_anterior)) * 100;
    payload.percentual_aumento = parseFloat(pct.toFixed(2));
  }

  const { data, error } = await supabase.from('career_movements').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Reaplica os efeitos da movimentação editada no funcionário
  const empUpdate = {};
  if (payload.position_nova_id) empUpdate.position_id = payload.position_nova_id;
  if (payload.grade_nova_id) empUpdate.grade_id = payload.grade_nova_id;
  if (payload.department_novo_id) empUpdate.department_id = payload.department_novo_id;
  if (payload.salario_novo) empUpdate.salario_base = payload.salario_novo;

  if (Object.keys(empUpdate).length && data.employee_id) {
    await supabase.from('employees').update(empUpdate).eq('id', data.employee_id);
  }

  res.json(data);
});

router.delete('/movements/:id', requireAuth, authorize('salary.plan.manage'), async (req, res) => {
  await supabase.from('career_movements').delete().eq('id', req.params.id);
  res.json({ success: true });
});

/* ── BACKFILL: cria faixa salarial inicial pra cargos sem grade ───────── */
router.post('/grades/backfill', requireAuth, authorize('salary.plan.manage'), async (req, res) => {
  // Busca cargos sem grade ativa
  const { data: positions } = await supabase
    .from('positions').select('id, titulo, nivel, salario_minimo, salario_maximo, cbo_descricao, active');
  if (!positions?.length) return res.json({ criadas: 0, mensagem: 'Nenhum cargo cadastrado.' });

  const { data: grades } = await supabase.from('position_grades').select('position_id').eq('ativo', true);
  const cargosComGrade = new Set((grades || []).map(g => g.position_id));

  const semGrade = positions.filter(p => p.active !== false && !cargosComGrade.has(p.id));
  if (!semGrade.length) return res.json({ criadas: 0, mensagem: 'Todos os cargos já possuem faixa.' });

  let criadas = 0;
  const erros = [];
  for (const p of semGrade) {
    try {
      const nivelLabel = p.nivel
        ? p.nivel.charAt(0).toUpperCase() + p.nivel.slice(1)
        : 'Inicial';
      const salario = p.salario_minimo || 0;
      const { error } = await supabase.from('position_grades').insert({
        position_id: p.id,
        grade_nivel: nivelLabel,
        salario_base: salario,
        ordem: 1,
        ativo: true,
        descricao_competencias: p.cbo_descricao || null,
      });
      if (error) erros.push({ position: p.titulo, error: error.message });
      else criadas++;
    } catch (e) {
      erros.push({ position: p.titulo, error: e.message });
    }
  }
  res.json({ criadas, ja_existentes: positions.length - semGrade.length, erros });
});

module.exports = router;
