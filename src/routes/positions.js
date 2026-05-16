const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const NULLABLE_UUID = ['department_id'];
const NULLABLE_ENUM = ['nivel'];

function sanitize(p) {
  const c = { ...p };
  [...NULLABLE_UUID, ...NULLABLE_ENUM].forEach(f => { if (c[f] === '' || c[f] === undefined) c[f] = null; });
  ['salario_minimo','salario_maximo'].forEach(f => {
    if (c[f] === '' || c[f] == null) c[f] = null;
    else if (typeof c[f] === 'string') c[f] = parseFloat(c[f]) || null;
  });
  return c;
}

router.get('/', requireAuth, async (req, res) => {
  const { active, department_id } = req.query;
  let q = supabase.from('positions').select('*, departments(nome)').order('titulo');
  if (active === 'true') q = q.eq('active', true);
  if (department_id) q = q.eq('department_id', department_id);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = sanitize(req.body);
  if (!payload.titulo) return res.status(400).json({ error: 'Título é obrigatório.' });
  const { data, error } = await supabase.from('positions').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = sanitize(req.body);
  delete payload.id; delete payload.created_at; delete payload.departments;
  const { data, error } = await supabase.from('positions').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { error } = await supabase.from('positions').update({ active: false }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
