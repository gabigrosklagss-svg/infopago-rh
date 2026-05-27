const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

/* ── CICLOS ───────────────────────────────────────────── */
router.get('/cycles', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('performance_cycles').select('*').order('periodo_inicio', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/cycles/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('performance_cycles').select('*').eq('id', req.params.id).single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/cycles', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body, criado_por: req.user.id };
  if (!payload.nome || !payload.periodo_inicio || !payload.periodo_fim) {
    return res.status(400).json({ error: 'nome, periodo_inicio e periodo_fim são obrigatórios.' });
  }
  const { data, error } = await supabase.from('performance_cycles').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/cycles/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body, updated_at: new Date().toISOString() };
  delete payload.id; delete payload.created_at; delete payload.criado_por;
  const { data, error } = await supabase.from('performance_cycles').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/cycles/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { error } = await supabase.from('performance_cycles').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* ── AVALIAÇÕES ───────────────────────────────────────── */
router.get('/evaluations', requireAuth, async (req, res) => {
  const { cycle_id, employee_id, status } = req.query;
  let q = supabase.from('performance_evaluations')
    .select('*, employees(nome_completo, matricula, departments(nome), positions(titulo)), performance_cycles(nome)')
    .order('created_at', { ascending: false });
  if (cycle_id) q = q.eq('cycle_id', cycle_id);
  if (employee_id) q = q.eq('employee_id', employee_id);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/evaluations/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('performance_evaluations')
    .select('*, employees(nome_completo, matricula, departments(nome), positions(titulo)), performance_cycles(*)')
    .eq('id', req.params.id).single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/evaluations', requireAuth, requireRole('admin', 'rh', 'gestor'), async (req, res) => {
  const payload = { ...req.body, avaliador_id: req.user.id };
  if (!payload.cycle_id || !payload.employee_id) {
    return res.status(400).json({ error: 'cycle_id e employee_id são obrigatórios.' });
  }
  // Calcula nota final como média dos critérios
  if (payload.notas && typeof payload.notas === 'object') {
    const vals = Object.values(payload.notas).map(v => parseFloat(v)).filter(v => !isNaN(v));
    if (vals.length) payload.nota_final = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
  }
  if (!payload.data_avaliacao) payload.data_avaliacao = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase.from('performance_evaluations').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/evaluations/:id', requireAuth, requireRole('admin', 'rh', 'gestor'), async (req, res) => {
  const payload = { ...req.body, updated_at: new Date().toISOString() };
  delete payload.id; delete payload.created_at; delete payload.employees; delete payload.performance_cycles;
  if (payload.notas && typeof payload.notas === 'object') {
    const vals = Object.values(payload.notas).map(v => parseFloat(v)).filter(v => !isNaN(v));
    if (vals.length) payload.nota_final = parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1));
  }
  const { data, error } = await supabase.from('performance_evaluations').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/evaluations/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { error } = await supabase.from('performance_evaluations').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* Gera avaliações em massa para todos funcionários de um ciclo */
router.post('/cycles/:id/seed', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { department_id } = req.body || {};
  let q = supabase.from('employees').select('id').eq('status', 'ativo');
  if (department_id) q = q.eq('department_id', department_id);
  const { data: emps, error: e1 } = await q;
  if (e1) return res.status(400).json({ error: e1.message });

  const rows = (emps || []).map(e => ({
    cycle_id: req.params.id,
    employee_id: e.id,
    status: 'pendente',
  }));
  if (!rows.length) return res.json({ inserted: 0 });

  const { error } = await supabase.from('performance_evaluations')
    .upsert(rows, { onConflict: 'cycle_id,employee_id', ignoreDuplicates: true });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ inserted: rows.length });
});

module.exports = router;
