const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, authorize } = require('../middleware/auth');

/* GET — eventos do mês (por ano/mes) ou intervalo */
router.get('/', requireAuth, async (req, res) => {
  const { mes, ano, from, to } = req.query;
  let q = supabase.from('company_events').select('*, departments(nome)').order('data_inicio');
  if (from && to) q = q.gte('data_inicio', from).lte('data_inicio', to);
  else if (mes && ano) {
    const ini = `${ano}-${String(mes).padStart(2,'0')}-01`;
    const fim = new Date(parseInt(ano), parseInt(mes), 0).toISOString().slice(0,10);
    q = q.gte('data_inicio', ini).lte('data_inicio', fim);
  }
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('company_events')
    .select('*, departments(nome)').eq('id', req.params.id).single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/', requireAuth, authorize('events.manage'), async (req, res) => {
  const payload = { ...req.body, criado_por: req.user.id };
  if (!payload.titulo || !payload.data_inicio) {
    return res.status(400).json({ error: 'titulo e data_inicio são obrigatórios.' });
  }
  ['data_fim','hora_inicio','hora_fim','department_id'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  if (payload.dia_todo === undefined) payload.dia_todo = !(payload.hora_inicio || payload.hora_fim);
  const { data, error } = await supabase.from('company_events').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, authorize('events.manage'), async (req, res) => {
  const payload = { ...req.body, updated_at: new Date().toISOString() };
  delete payload.id; delete payload.created_at; delete payload.criado_por; delete payload.departments;
  ['data_fim','hora_inicio','hora_fim','department_id'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  const { data, error } = await supabase.from('company_events').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, authorize('events.manage'), async (req, res) => {
  const { error } = await supabase.from('company_events').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
