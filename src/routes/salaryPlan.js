const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

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

router.post('/grades', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body };
  if (!payload.position_id || !payload.grade_nivel || !payload.salario_base) {
    return res.status(400).json({ error: 'position_id, grade_nivel e salario_base são obrigatórios.' });
  }
  const { data, error } = await supabase.from('position_grades').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/grades/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body }; delete payload.id; delete payload.created_at; delete payload.positions;
  const { data, error } = await supabase.from('position_grades').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/grades/:id', requireAuth, requireRole('admin'), async (req, res) => {
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

router.post('/movements', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
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

router.put('/movements/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
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

router.delete('/movements/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await supabase.from('career_movements').delete().eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
