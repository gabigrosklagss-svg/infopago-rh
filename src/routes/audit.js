const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { user_id, entity, action, from, to, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let q = supabase.from('audit_logs').select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);
  if (user_id) q = q.eq('user_id', user_id);
  if (entity) q = q.eq('entity', entity);
  if (action) q = q.eq('action', action);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);

  const { data, error, count } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data, total: count, page: parseInt(page) });
});

router.get('/stats', requireAuth, requireRole('admin'), async (req, res) => {
  const dias = parseInt(req.query.dias) || 7;
  const since = new Date(Date.now() - dias * 86400000).toISOString();

  const { data } = await supabase.from('audit_logs')
    .select('action, entity, user_name')
    .gte('created_at', since);

  const stats = { total: data?.length || 0, byAction: {}, byEntity: {}, byUser: {} };
  (data || []).forEach(l => {
    stats.byAction[l.action] = (stats.byAction[l.action] || 0) + 1;
    stats.byEntity[l.entity] = (stats.byEntity[l.entity] || 0) + 1;
    if (l.user_name) stats.byUser[l.user_name] = (stats.byUser[l.user_name] || 0) + 1;
  });

  res.json({ periodo_dias: dias, ...stats });
});

module.exports = router;
