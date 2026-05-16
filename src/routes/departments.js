const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, async (req, res) => {
  const { active } = req.query;
  let q = supabase.from('departments').select('*').order('nome');
  if (active === 'true') q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { nome, codigo, responsavel } = req.body;
  if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
  const { data, error } = await supabase.from('departments').insert({ nome, codigo, responsavel }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { nome, codigo, responsavel, active } = req.body;
  const { data, error } = await supabase.from('departments')
    .update({ nome, codigo, responsavel, active }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  // Desativa em vez de apagar
  const { error } = await supabase.from('departments').update({ active: false }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
