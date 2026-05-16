const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/:employee_id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('warnings').select('*')
    .eq('employee_id', req.params.employee_id).order('data_ocorrencia', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/', requireAuth, requireRole('admin', 'rh', 'gestor'), async (req, res) => {
  const payload = { ...req.body, aplicada_por: req.user.id };
  if (!payload.employee_id || !payload.tipo || !payload.data_ocorrencia || !payload.motivo) {
    return res.status(400).json({ error: 'employee_id, tipo, data_ocorrencia e motivo são obrigatórios.' });
  }
  if (payload.dias_suspensao === '' || payload.dias_suspensao == null) payload.dias_suspensao = 0;
  else payload.dias_suspensao = parseInt(payload.dias_suspensao) || 0;

  const { data, error } = await supabase.from('warnings').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body };
  delete payload.id; delete payload.created_at; delete payload.aplicada_por;
  const { data, error } = await supabase.from('warnings').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { error } = await supabase.from('warnings').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
