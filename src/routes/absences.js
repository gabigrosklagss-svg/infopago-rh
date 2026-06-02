const router = require('express').Router();
const multer = require('multer');
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const BUCKET = 'employee-documents';

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
  // Limpa anexo antes de excluir
  const { data: ab } = await supabase.from('absences').select('anexo_url').eq('id', req.params.id).maybeSingle();
  if (ab?.anexo_url && ab.anexo_url.includes(`/${BUCKET}/`)) {
    const oldPath = ab.anexo_url.split(`/${BUCKET}/`)[1];
    if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
  }
  const { error } = await supabase.from('absences').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* Upload de atestado / comprovante */
router.post('/:id/anexo', requireAuth, requireRole('admin', 'rh'), upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });
  const id = req.params.id;
  const { data: ab } = await supabase.from('absences').select('employee_id, anexo_url').eq('id', id).maybeSingle();
  if (!ab) return res.status(404).json({ error: 'Falta/atestado não encontrado.' });

  // Remove anexo antigo se existir
  if (ab.anexo_url && ab.anexo_url.includes(`/${BUCKET}/`)) {
    const oldPath = ab.anexo_url.split(`/${BUCKET}/`)[1];
    if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
  }

  const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
  const storage_path = `atestados/${ab.employee_id}/${id}_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(storage_path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (upErr) return res.status(500).json({ error: upErr.message });

  // URL assinada (privado), válida 1h
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storage_path, 60 * 60);
  await supabase.from('absences').update({
    anexo_url: storage_path,        // guarda o path
    anexo_nome: req.file.originalname,
    anexo_tipo: req.file.mimetype,
  }).eq('id', id);

  res.json({ url: signed?.signedUrl, anexo_nome: req.file.originalname });
});

/* Retorna URL assinada para baixar o anexo */
router.get('/:id/anexo', requireAuth, async (req, res) => {
  const { data: ab } = await supabase.from('absences').select('anexo_url, anexo_nome').eq('id', req.params.id).maybeSingle();
  if (!ab?.anexo_url) return res.status(404).json({ error: 'Sem anexo.' });
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(ab.anexo_url, 60 * 60);
  res.json({ url: signed?.signedUrl, anexo_nome: ab.anexo_nome });
});

router.delete('/:id/anexo', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: ab } = await supabase.from('absences').select('anexo_url').eq('id', req.params.id).maybeSingle();
  if (ab?.anexo_url) {
    await supabase.storage.from(BUCKET).remove([ab.anexo_url]).catch(() => {});
  }
  await supabase.from('absences').update({ anexo_url: null, anexo_nome: null, anexo_tipo: null }).eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
