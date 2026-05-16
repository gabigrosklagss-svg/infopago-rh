const router = require('express').Router();
const { supabase, supabasePublic } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

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
