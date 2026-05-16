const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/:employee_id', requireAuth, async (req, res) => {
  const { tipo } = req.query;
  let q = supabase.from('absences').select('*').eq('employee_id', req.params.employee_id);
  if (tipo) q = q.eq('tipo', tipo);
  q = q.order('data_inicio', { ascending: false });
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/', requireAuth, requireRole('admin', 'rh', 'gestor'), async (req, res) => {
  const payload = { ...req.body };
  if (!payload.employee_id || !payload.tipo || !payload.data_inicio) {
    return res.status(400).json({ error: 'employee_id, tipo e data_inicio são obrigatórios.' });
  }
  if (payload.data_fim) {
    payload.dias = Math.floor((new Date(payload.data_fim) - new Date(payload.data_inicio)) / 86400000) + 1;
  } else if (!payload.dias) payload.dias = 1;

  const { data, error } = await supabase.from('absences').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body };
  delete payload.id; delete payload.created_at;
  if (payload.data_fim && payload.data_inicio) {
    payload.dias = Math.floor((new Date(payload.data_fim) - new Date(payload.data_inicio)) / 86400000) + 1;
  }
  const { data, error } = await supabase.from('absences').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { error } = await supabase.from('absences').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
