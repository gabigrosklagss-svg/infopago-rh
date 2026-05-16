const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const multer = require('multer');

// Multer em memória — o arquivo vai direto pro Supabase Storage, sem disco local
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const allowed = /(pdf|jpeg|png|webp)$/i;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de arquivo não permitido. Use PDF, JPG, PNG ou WebP.'));
  },
});

const BUCKET = 'employee-documents';

// GET /api/documents/:employee_id — lista documentos do funcionário
router.get('/:employee_id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('employee_documents')
    .select('*')
    .eq('employee_id', req.params.employee_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// POST /api/documents/:employee_id — upload de documento
router.post('/:employee_id', requireAuth, requireRole('admin', 'rh'), upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const { tipo, descricao, data_emissao, data_validade } = req.body;
  if (!tipo) return res.status(400).json({ error: 'Tipo de documento é obrigatório.' });

  const employee_id = req.params.employee_id;
  const timestamp = Date.now();
  const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
  const storage_path = `${employee_id}/${tipo}_${timestamp}.${ext}`;

  // Upload no Supabase Storage
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storage_path, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: false,
    });
  if (upErr) return res.status(500).json({ error: `Falha no upload: ${upErr.message}` });

  // Registra no banco
  const { data, error } = await supabase.from('employee_documents').insert({
    employee_id,
    tipo,
    descricao,
    storage_path,
    filename_original: req.file.originalname,
    mime_type: req.file.mimetype,
    tamanho_bytes: req.file.size,
    data_emissao: data_emissao || null,
    data_validade: data_validade || null,
    uploaded_by: req.user.id,
  }).select().single();

  if (error) {
    // Rollback do storage se o INSERT falhar
    await supabase.storage.from(BUCKET).remove([storage_path]);
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json(data);
});

// GET /api/documents/file/:id — gera URL assinada (válida por 1 hora)
router.get('/file/:id', requireAuth, async (req, res) => {
  const { data: doc, error } = await supabase
    .from('employee_documents').select('storage_path, filename_original').eq('id', req.params.id).single();
  if (error || !doc) return res.status(404).json({ error: 'Documento não encontrado.' });

  const { data: signed, error: sErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, 3600); // 1 hora
  if (sErr) return res.status(500).json({ error: sErr.message });

  res.json({ url: signed.signedUrl, filename: doc.filename_original });
});

// DELETE /api/documents/:id
router.delete('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: doc } = await supabase.from('employee_documents')
    .select('storage_path').eq('id', req.params.id).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });

  await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  const { error } = await supabase.from('employee_documents').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// GET /api/documents/expiring/:dias — documentos prestes a vencer
router.get('/expiring/:dias', requireAuth, async (req, res) => {
  const dias = parseInt(req.params.dias) || 30;
  const limite = new Date(Date.now() + dias * 86400000).toISOString().split('T')[0];
  const { data, error } = await supabase.from('employee_documents')
    .select('*, employees(nome_completo, matricula)')
    .not('data_validade', 'is', null)
    .lte('data_validade', limite)
    .order('data_validade');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

module.exports = router;
