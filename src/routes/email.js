const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { enviarHolerite, enviarEmLote } = require('../services/emailService');

router.get('/logs', requireAuth, async (req, res) => {
  const { mes, ano, status, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let q = supabase.from('email_logs').select(`
    *, payslips(competencia_mes, competencia_ano),
    employees(nome_completo, matricula)
  `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);
  if (status) q = q.eq('status', status);

  const { data, error, count } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data, total: count });
});

router.post('/send/:payslip_id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: ps } = await supabase.from('payslips')
    .select('*, employees(*)').eq('id', req.params.payslip_id).single();
  if (!ps) return res.status(404).json({ error: 'Holerite não encontrado.' });
  if (!ps.pdf_path) return res.status(400).json({ error: 'Gere o PDF antes de enviar.' });

  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();

  try {
    const result = await enviarHolerite(ps, ps.employees, company || {}, req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/send-batch', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { competencia_mes, competencia_ano, payslip_ids } = req.body;
  let q = supabase.from('payslips').select('*, employees(*)').not('pdf_path', 'is', null);
  if (payslip_ids?.length) q = q.in('id', payslip_ids);
  else q = q.eq('competencia_mes', competencia_mes).eq('competencia_ano', competencia_ano);

  const { data: pss } = await q;
  if (!pss?.length) return res.status(400).json({ error: 'Nenhum holerite com PDF gerado encontrado.' });

  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();

  const resultado = await enviarEmLote(pss, company || {}, req.user.id);
  res.json(resultado);
});

router.get('/schedules', requireAuth, async (req, res) => {
  const { data } = await supabase.from('scheduled_sends')
    .select('*, departments(nome)').order('scheduled_date', { ascending: false });
  res.json(data || []);
});

router.post('/schedules', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body, created_by: req.user.id };
  if (payload.department_id === '') payload.department_id = null;
  const { data, error } = await supabase.from('scheduled_sends').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.delete('/schedules/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  await supabase.from('scheduled_sends').update({ status: 'cancelado' }).eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
