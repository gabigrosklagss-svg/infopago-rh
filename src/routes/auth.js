const router = require('express').Router();
const multer = require('multer');
const { supabase, supabasePublic } = require('../config/supabase');
const {
  requireAuth, requireRole, authorize,
  revogarToken, revogarTodosTokens, invalidarPermissoesCache,
} = require('../middleware/auth');

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

/* ── LOGIN ──────────────────────────────────────────── */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });

  const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: 'E-mail ou senha incorretos.', code: 'INVALID_CREDENTIALS' });

  // Carrega perfil
  let { data: profile } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, avatar_url, active')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profile) {
    const { data: novo } = await supabase.from('user_profiles').insert({
      id: data.user.id,
      full_name: data.user.email.split('@')[0],
      role: 'rh',
    }).select().single();
    profile = novo;
    // Associa role 'rh' por padrão
    const { data: rh } = await supabase.from('roles').select('id').eq('slug', 'rh').maybeSingle();
    if (rh) await supabase.from('user_roles').insert({ user_id: data.user.id, role_id: rh.id });
  }

  if (profile.active === false) {
    return res.status(403).json({ error: 'Conta desativada. Contate o administrador.', code: 'INACTIVE' });
  }

  // Carrega lista de roles + permissões pra o cliente
  const { data: ups } = await supabase
    .from('v_user_permissions')
    .select('role_slug, permission_slug, nivel')
    .eq('user_id', data.user.id);

  const roles = [...new Set((ups || []).map(r => r.role_slug))];
  const permissions = [...new Set((ups || []).map(r => r.permission_slug))];
  const nivel = (ups || []).reduce((m, r) => Math.max(m, r.nivel || 0), 0);

  res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: {
      id: data.user.id, email: data.user.email,
      ...profile, roles, permissions, nivel,
    },
  });
});

/* ── REFRESH TOKEN ──────────────────────────────────── */
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: 'refresh_token obrigatório.' });

  const { data, error } = await supabasePublic.auth.refreshSession({ refresh_token });
  if (error || !data.session) return res.status(401).json({ error: 'Refresh token inválido.', code: 'INVALID_REFRESH' });

  res.json({
    token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
});

/* ── LOGOUT (revoga o token atual) ──────────────────── */
router.post('/logout', requireAuth, async (req, res) => {
  await revogarToken(req.user.token, req.user.id, 'logout');
  res.json({ success: true });
});

/* ── ME ─────────────────────────────────────────────── */
router.get('/me', requireAuth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, email: u.email, full_name: u.full_name, role: u.role,
    active: u.active, avatar_url: u.avatar_url, department: u.department,
    roles: u.roles, permissions: [...u.permissions], nivel: u.nivel,
    created_at: u.created_at,
  });
});

router.put('/me', requireAuth, async (req, res) => {
  const { full_name, department } = req.body;
  const payload = {};
  if (full_name !== undefined) payload.full_name = full_name;
  if (department !== undefined) payload.department = department;
  if (!Object.keys(payload).length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });

  const { data, error } = await supabase
    .from('user_profiles').update(payload).eq('id', req.user.id)
    .select('id, full_name, role, active, avatar_url, department').single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ...data, email: req.user.email });
});

/* ── TROCAR PRÓPRIA SENHA ───────────────────────────── */
router.put('/me/password', requireAuth, async (req, res) => {
  const { senha_atual, nova_senha } = req.body;
  if (!senha_atual || !nova_senha) return res.status(400).json({ error: 'Informe senha atual e nova senha.' });
  if (nova_senha.length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });

  // Confirma senha atual
  const { error: confErr } = await supabasePublic.auth.signInWithPassword({ email: req.user.email, password: senha_atual });
  if (confErr) return res.status(401).json({ error: 'Senha atual incorreta.' });

  const { error } = await supabase.auth.admin.updateUserById(req.user.id, { password: nova_senha });
  if (error) return res.status(400).json({ error: error.message });

  // Revoga o token atual após troca de senha
  await revogarToken(req.user.token, req.user.id, 'password_change');
  res.json({ success: true, message: 'Senha alterada. Faça login novamente.' });
});

/* ── AVATAR ─────────────────────────────────────────── */
router.post('/me/avatar', requireAuth, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const userId = req.user.id;
  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const storage_path = `users/${userId}/avatar_${Date.now()}.${ext}`;

  if (req.user.avatar_url && req.user.avatar_url.includes(`/${PHOTOS_BUCKET}/`)) {
    const oldPath = req.user.avatar_url.split(`/${PHOTOS_BUCKET}/`)[1];
    if (oldPath) await supabase.storage.from(PHOTOS_BUCKET).remove([oldPath]).catch(() => {});
  }

  const { error: upErr } = await supabase.storage.from(PHOTOS_BUCKET)
    .upload(storage_path, req.file.buffer, {
      contentType: req.file.mimetype, upsert: true, cacheControl: '3600',
    });
  if (upErr) return res.status(500).json({ error: `Falha no upload: ${upErr.message}` });

  const avatar_url = `${SUPABASE_URL}/storage/v1/object/public/${PHOTOS_BUCKET}/${storage_path}`;
  await supabase.from('user_profiles').update({ avatar_url }).eq('id', userId);
  res.json({ avatar_url });
});

router.delete('/me/avatar', requireAuth, async (req, res) => {
  if (req.user.avatar_url && req.user.avatar_url.includes(`/${PHOTOS_BUCKET}/`)) {
    const oldPath = req.user.avatar_url.split(`/${PHOTOS_BUCKET}/`)[1];
    if (oldPath) await supabase.storage.from(PHOTOS_BUCKET).remove([oldPath]).catch(() => {});
  }
  await supabase.from('user_profiles').update({ avatar_url: null }).eq('id', req.user.id);
  res.json({ success: true });
});

/* ── GERENCIAR USUÁRIOS (apenas super_admin) ────────── */
router.get('/users', requireAuth, authorize('users.read'), async (req, res) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, department, active, avatar_url, created_at')
    .order('full_name');
  if (error) return res.status(400).json({ error: error.message });

  // Anexa roles novos
  const ids = (data || []).map(u => u.id);
  let urs = [];
  if (ids.length) {
    const { data: rs } = await supabase
      .from('user_roles')
      .select('user_id, roles(slug, nome)')
      .in('user_id', ids);
    urs = rs || [];
  }
  const enriched = (data || []).map(u => ({
    ...u,
    new_roles: urs.filter(r => r.user_id === u.id).map(r => ({ slug: r.roles?.slug, nome: r.roles?.nome })),
  }));
  res.json(enriched);
});

router.post('/users', requireAuth, authorize('users.manage'), async (req, res) => {
  const { email, password, full_name, role, department, role_slugs } = req.body;
  if (!email || !password || !full_name) {
    return res.status(400).json({ error: 'E-mail, senha e nome completo são obrigatórios.' });
  }
  if (password.length < 8) return res.status(400).json({ error: 'Senha deve ter pelo menos 8 caracteres.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'E-mail inválido.' });
  }

  // Cria no Supabase Auth
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (authErr) {
    const msg = authErr.message || '';
    if (/already.*registered|duplicate|already.*exists/i.test(msg)) {
      return res.status(409).json({ error: `Já existe um usuário com o e-mail "${email}". Verifique a lista de usuários — se ele estiver lá, basta atribuir as permissões.`, code: 'EMAIL_EXISTS' });
    }
    if (/password/i.test(msg)) {
      return res.status(400).json({ error: 'Senha não atende aos requisitos mínimos. Use no mínimo 8 caracteres com letras e números.', code: 'WEAK_PASSWORD' });
    }
    return res.status(400).json({ error: 'Falha ao criar conta: ' + msg });
  }

  // Cria perfil — se falhar, faz ROLLBACK do auth.user pra não deixar órfão
  const { data, error } = await supabase.from('user_profiles').insert({
    id: authData.user.id, full_name, role: role || 'rh', department: department || null,
  }).select().single();
  if (error) {
    console.warn('[auth/users] user_profiles falhou — fazendo rollback do auth.user', authData.user.id);
    await supabase.auth.admin.deleteUser(authData.user.id).catch(() => {});
    return res.status(400).json({ error: 'Falha ao criar perfil: ' + error.message });
  }

  // Atribui roles novos (slug array)
  const slugs = Array.isArray(role_slugs) && role_slugs.length ? role_slugs : [role || 'rh'];
  const { data: roles } = await supabase.from('roles').select('id, slug').in('slug', slugs);
  if (roles?.length) {
    await supabase.from('user_roles').insert(roles.map(r => ({
      user_id: authData.user.id, role_id: r.id, granted_by: req.user.id,
    })));
  }

  res.status(201).json(data);
});

router.put('/users/:id', requireAuth, authorize('users.manage'), async (req, res) => {
  const { full_name, role, department, active, role_slugs } = req.body;

  // Não permite desativar a si mesmo
  if (req.params.id === req.user.id && active === false) {
    return res.status(400).json({ error: 'Você não pode desativar sua própria conta.' });
  }

  const update = {};
  if (full_name !== undefined) update.full_name = full_name;
  if (role !== undefined) update.role = role;
  if (department !== undefined) update.department = department;
  if (active !== undefined) update.active = active;

  const { data, error } = await supabase.from('user_profiles')
    .update(update).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Atualiza roles (substituição completa)
  if (Array.isArray(role_slugs)) {
    await supabase.from('user_roles').delete().eq('user_id', req.params.id);
    if (role_slugs.length) {
      const { data: roles } = await supabase.from('roles').select('id, slug').in('slug', role_slugs);
      if (roles?.length) {
        await supabase.from('user_roles').insert(roles.map(r => ({
          user_id: req.params.id, role_id: r.id, granted_by: req.user.id,
        })));
      }
    }
    invalidarPermissoesCache(req.params.id);
  }

  // Se desativou, revoga sessões
  if (active === false) {
    await supabase.from('revoked_tokens').insert({
      token_hash: `user-disabled-${req.params.id}-${Date.now()}`,
      user_id: req.params.id,
      reason: 'user_disabled',
      expires_at: new Date(Date.now() + 7*24*3600*1000).toISOString(),
    });
  }

  res.json(data);
});

router.post('/users/:id/reset-password', requireAuth, authorize('users.manage'), async (req, res) => {
  const { nova_senha } = req.body;
  if (!nova_senha || nova_senha.length < 8) {
    return res.status(400).json({ error: 'Senha deve ter pelo menos 8 caracteres.' });
  }
  const { error } = await supabase.auth.admin.updateUserById(req.params.id, { password: nova_senha });
  if (error) return res.status(400).json({ error: error.message });
  invalidarPermissoesCache(req.params.id);
  res.json({ success: true });
});

/* ── KILL SWITCH (super_admin) ──────────────────────── */
router.post('/security/revoke-all', requireAuth, authorize('security.manage'), async (req, res) => {
  const r = await revogarTodosTokens(req.body?.motivo || 'manual_kill_switch');
  res.json(r);
});

module.exports = router;
