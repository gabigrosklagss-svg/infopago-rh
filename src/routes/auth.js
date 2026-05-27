const router = require('express').Router();
const { supabase, supabasePublic } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Apenas imagens JPG, PNG ou WebP.'));
  },
});

const PHOTOS_BUCKET = 'employee-photos';
const SUPABASE_URL = process.env.SUPABASE_URL;

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });

  const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: 'E-mail ou senha incorretos.' });

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, avatar_url, active')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profile) {
    // Auto-cria perfil rh se não existir
    await supabase.from('user_profiles').insert({
      id: data.user.id,
      full_name: data.user.email.split('@')[0],
      role: 'rh',
    });
  }

  res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    user: { id: data.user.id, email: data.user.email, ...profile },
  });
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  res.json({ success: true });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// PUT /api/auth/me — usuário atualiza o próprio perfil (nome e departamento)
router.put('/me', requireAuth, async (req, res) => {
  const { full_name, department } = req.body;
  const payload = {};
  if (full_name !== undefined) payload.full_name = full_name;
  if (department !== undefined) payload.department = department;
  if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });

  const { data, error } = await supabase
    .from('user_profiles')
    .update(payload)
    .eq('id', req.user.id)
    .select('id, full_name, role, active, avatar_url, department')
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ...data, email: req.user.email });
});

// POST /api/auth/me/avatar — upload da foto de perfil do usuário logado
router.post('/me/avatar', requireAuth, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const userId = req.user.id;
  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const storage_path = `users/${userId}/avatar_${Date.now()}.${ext}`;

  // Remove avatar antigo
  if (req.user.avatar_url && req.user.avatar_url.includes(`/${PHOTOS_BUCKET}/`)) {
    const oldPath = req.user.avatar_url.split(`/${PHOTOS_BUCKET}/`)[1];
    if (oldPath) await supabase.storage.from(PHOTOS_BUCKET).remove([oldPath]).catch(() => {});
  }

  const { error: upErr } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storage_path, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
      cacheControl: '3600',
    });
  if (upErr) return res.status(500).json({ error: `Falha no upload: ${upErr.message}` });

  const avatar_url = `${SUPABASE_URL}/storage/v1/object/public/${PHOTOS_BUCKET}/${storage_path}`;
  await supabase.from('user_profiles').update({ avatar_url }).eq('id', userId);
  res.json({ avatar_url });
});

// DELETE /api/auth/me/avatar — remove a foto de perfil
router.delete('/me/avatar', requireAuth, async (req, res) => {
  if (req.user.avatar_url && req.user.avatar_url.includes(`/${PHOTOS_BUCKET}/`)) {
    const oldPath = req.user.avatar_url.split(`/${PHOTOS_BUCKET}/`)[1];
    if (oldPath) await supabase.storage.from(PHOTOS_BUCKET).remove([oldPath]).catch(() => {});
  }
  await supabase.from('user_profiles').update({ avatar_url: null }).eq('id', req.user.id);
  res.json({ success: true });
});

// GET /api/auth/users — listar usuários do sistema (admin)
router.get('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, department, active, avatar_url, created_at')
    .order('full_name');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

// POST /api/auth/users — criar usuário (admin)
router.post('/users', requireAuth, requireRole('admin'), async (req, res) => {
  const { email, password, full_name, role, department } = req.body;
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'E-mail, senha e nome completo são obrigatórios.' });
  }

  // Cria no Supabase Auth
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (authErr) return res.status(400).json({ error: authErr.message });

  // Cria perfil
  const { data, error } = await supabase.from('user_profiles').insert({
    id: authData.user.id,
    full_name,
    role: role || 'rh',
    department,
  }).select().single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

// PUT /api/auth/users/:id
router.put('/users/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { full_name, role, department, active } = req.body;
  const { data, error } = await supabase
    .from('user_profiles')
    .update({ full_name, role, department, active })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

module.exports = router;
