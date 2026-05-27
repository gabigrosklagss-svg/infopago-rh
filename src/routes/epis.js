const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

/* ── Catálogo de EPIs ─────────────────────────────────── */
router.get('/', requireAuth, async (req, res) => {
  const { ativo } = req.query;
  let q = supabase.from('epis').select('*').order('categoria').order('nome');
  if (ativo === 'true') q = q.eq('ativo', true);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data, error } = await supabase.from('epis').insert(req.body).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body }; delete payload.id; delete payload.created_at;
  const { data, error } = await supabase.from('epis').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await supabase.from('epis').update({ ativo: false }).eq('id', req.params.id);
  res.json({ success: true });
});

/* ── Entregas de EPIs por funcionário ─────────────────── */
router.get('/deliveries/employee/:employee_id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('epi_deliveries')
    .select('*, epis(nome, ca, categoria, validade_meses)')
    .eq('employee_id', req.params.employee_id)
    .order('data_entrega', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/deliveries/all', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('epi_deliveries')
    .select('*, epis(nome, categoria), employees(nome_completo, matricula)')
    .order('data_entrega', { ascending: false }).limit(200);
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/deliveries', requireAuth, requireRole('admin', 'rh', 'gestor'), async (req, res) => {
  try {
    const payload = { ...req.body, entregue_por: req.user.id };

    // Normaliza datas vazias
    if (payload.data_vencimento === '') payload.data_vencimento = null;
    if (payload.data_devolucao === '') payload.data_devolucao = null;

    // Calcula data_vencimento se houver validade do EPI
    if (payload.epi_id && payload.data_entrega && !payload.data_vencimento) {
      const { data: epi } = await supabase.from('epis').select('validade_meses').eq('id', payload.epi_id).single();
      if (epi?.validade_meses) {
        const venc = new Date(payload.data_entrega);
        venc.setMonth(venc.getMonth() + epi.validade_meses);
        payload.data_vencimento = venc.toISOString().split('T')[0];
      }
    }

    const { data, error } = await supabase.from('epi_deliveries').insert(payload).select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Atualiza estoque (best effort)
    try {
      if (payload.epi_id && payload.quantidade) {
        const { data: epi } = await supabase.from('epis').select('estoque_atual').eq('id', payload.epi_id).single();
        if (epi) {
          await supabase.from('epis').update({
            estoque_atual: Math.max(0, (epi.estoque_atual || 0) - parseInt(payload.quantidade || 1))
          }).eq('id', payload.epi_id);
        }
      }
    } catch (e) {
      console.warn('[epi] estoque não atualizado:', e.message);
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('[epi/deliveries POST]', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/deliveries/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body }; delete payload.id; delete payload.created_at;
  const { data, error } = await supabase.from('epi_deliveries').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/deliveries/:id', requireAuth, requireRole('admin'), async (req, res) => {
  await supabase.from('epi_deliveries').delete().eq('id', req.params.id);
  res.json({ success: true });
});

/* ── EPIs com validade vencendo ───────────────────────── */
router.get('/expiring/:dias', requireAuth, async (req, res) => {
  const dias = parseInt(req.params.dias) || 30;
  const limite = new Date(Date.now() + dias * 86400000).toISOString().split('T')[0];
  const { data, error } = await supabase.from('epi_deliveries')
    .select('*, epis(nome), employees(nome_completo, matricula)')
    .is('data_devolucao', null)
    .not('data_vencimento', 'is', null)
    .lte('data_vencimento', limite)
    .order('data_vencimento');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
