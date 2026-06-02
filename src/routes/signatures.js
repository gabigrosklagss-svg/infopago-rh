const router = require('express').Router();
const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { requireAuth, authorize } = require('../middleware/auth');

/* ── Lista assinaturas (com filtros) ─────────────────── */
router.get('/', requireAuth, authorize('signatures.read'), async (req, res) => {
  const { doc_type, doc_id, status, employee_id } = req.query;
  let q = supabase.from('signatures')
    .select('*, employees:signer_employee_id(nome_completo, matricula)')
    .order('created_at', { ascending: false });
  if (doc_type) q = q.eq('doc_type', doc_type);
  if (doc_id) q = q.eq('doc_id', doc_id);
  if (status) q = q.eq('status', status);
  if (employee_id) q = q.eq('signer_employee_id', employee_id);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

/* ── Cria solicitação de assinatura ──────────────────── */
router.post('/', requireAuth, authorize('signatures.manage'), async (req, res) => {
  const {
    doc_type, doc_id, doc_titulo, doc_descricao, doc_pdf_path,
    signer_employee_id, expires_in_days,
  } = req.body;
  if (!doc_type || !doc_titulo) {
    return res.status(400).json({ error: 'doc_type e doc_titulo são obrigatórios.' });
  }
  let signer_name = req.body.signer_name;
  let signer_email = req.body.signer_email;
  let signer_cpf = req.body.signer_cpf;
  if (signer_employee_id) {
    const { data: emp } = await supabase.from('employees')
      .select('nome_completo, email_corporativo, email_pessoal, cpf')
      .eq('id', signer_employee_id).maybeSingle();
    if (emp) {
      signer_name = signer_name || emp.nome_completo;
      signer_email = signer_email || emp.email_corporativo || emp.email_pessoal;
      signer_cpf = signer_cpf || emp.cpf;
    }
  }
  if (!signer_name) return res.status(400).json({ error: 'Nome do signatário é obrigatório.' });

  const token = crypto.randomBytes(24).toString('hex');
  const expires_at = expires_in_days
    ? new Date(Date.now() + parseInt(expires_in_days) * 24 * 3600 * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  const { data, error } = await supabase.from('signatures').insert({
    doc_type, doc_id, doc_titulo, doc_descricao, doc_pdf_path,
    signer_employee_id, signer_name, signer_email, signer_cpf,
    token, expires_at,
    audit_trail: [{ at: new Date().toISOString(), event: 'created', by: req.user.id }],
    created_by: req.user.id,
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Inclui link público pra assinar
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.status(201).json({ ...data, public_link: `${baseUrl}/sign.html?token=${token}` });
});

/* ── Endpoint público: dados pra assinar (não exige auth) ── */
router.get('/public/:token', async (req, res) => {
  const { data: sig } = await supabase.from('signatures').select(
    'id, doc_type, doc_titulo, doc_descricao, doc_pdf_path, signer_name, signer_email, signer_cpf, status, expires_at, signed_at'
  ).eq('token', req.params.token).maybeSingle();
  if (!sig) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (new Date(sig.expires_at) < new Date() && sig.status === 'pendente') {
    await supabase.from('signatures').update({ status: 'expirada' }).eq('id', sig.id);
    sig.status = 'expirada';
  }
  // Audit: registra visualização
  await supabase.rpc('append_audit_trail_signature', { sig_id: sig.id, ev: { at: new Date().toISOString(), event: 'viewed', ip: req.ip } }).catch(() => {});
  res.json(sig);
});

/* ── Endpoint público: assinar (canvas base64) ───────── */
router.post('/public/:token/sign', async (req, res) => {
  const { signature_data, signer_name } = req.body;
  if (!signature_data) return res.status(400).json({ error: 'Assinatura obrigatória.' });

  const { data: sig } = await supabase.from('signatures')
    .select('*').eq('token', req.params.token).maybeSingle();
  if (!sig) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (sig.status !== 'pendente') {
    return res.status(400).json({ error: `Já ${sig.status}.`, code: 'ALREADY_RESOLVED' });
  }
  if (new Date(sig.expires_at) < new Date()) {
    await supabase.from('signatures').update({ status: 'expirada' }).eq('id', sig.id);
    return res.status(400).json({ error: 'Solicitação expirada.' });
  }

  const trail = sig.audit_trail || [];
  trail.push({
    at: new Date().toISOString(),
    event: 'signed',
    ip: req.ip,
    ua: req.headers['user-agent']?.slice(0, 200),
    name_confirm: signer_name,
  });

  const { data, error } = await supabase.from('signatures').update({
    status: 'assinada',
    signature_data,
    signed_at: new Date().toISOString(),
    signed_ip: req.ip,
    signed_ua: req.headers['user-agent']?.slice(0, 500),
    audit_trail: trail,
    updated_at: new Date().toISOString(),
  }).eq('id', sig.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, signed_at: data.signed_at });
});

/* ── Endpoint público: recusar ──────────────────────── */
router.post('/public/:token/refuse', async (req, res) => {
  const { motivo } = req.body;
  const { data: sig } = await supabase.from('signatures').select('id, status, audit_trail').eq('token', req.params.token).maybeSingle();
  if (!sig) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (sig.status !== 'pendente') return res.status(400).json({ error: 'Já foi resolvida.' });
  const trail = sig.audit_trail || [];
  trail.push({ at: new Date().toISOString(), event: 'refused', ip: req.ip, motivo });
  await supabase.from('signatures').update({
    status: 'recusada', motivo_recusa: motivo, audit_trail: trail,
    updated_at: new Date().toISOString(),
  }).eq('id', sig.id);
  res.json({ success: true });
});

/* ── Cancela uma solicitação ────────────────────────── */
router.post('/:id/cancel', requireAuth, authorize('signatures.manage'), async (req, res) => {
  await supabase.from('signatures').update({
    status: 'cancelada',
    updated_at: new Date().toISOString(),
  }).eq('id', req.params.id);
  res.json({ success: true });
});

router.get('/:id', requireAuth, authorize('signatures.read'), async (req, res) => {
  const { data, error } = await supabase.from('signatures')
    .select('*, employees:signer_employee_id(nome_completo, matricula)')
    .eq('id', req.params.id).single();
  if (error) return res.status(400).json({ error: error.message });
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  data.public_link = `${baseUrl}/sign.html?token=${data.token}`;
  res.json(data);
});

router.delete('/:id', requireAuth, authorize('signatures.manage'), async (req, res) => {
  await supabase.from('signatures').delete().eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
