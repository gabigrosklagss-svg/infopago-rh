const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, authorize, invalidarPermissoesCache } = require('../middleware/auth');

/* ── LISTAR ROLES ───────────────────────────────────── */
router.get('/roles', requireAuth, authorize.any('permissions.manage', 'users.read'), async (req, res) => {
  const { data, error } = await supabase
    .from('roles').select('*').order('nivel', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/roles/:slug', requireAuth, authorize('permissions.manage'), async (req, res) => {
  const { data: role, error } = await supabase
    .from('roles').select('*').eq('slug', req.params.slug).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });

  const { data: rp } = await supabase
    .from('role_permissions')
    .select('permission_id, permissions(slug, nome, modulo, descricao)')
    .eq('role_id', role.id);

  res.json({ ...role, permissions: (rp || []).map(r => r.permissions) });
});

/* ── ATUALIZAR PERMISSÕES DE UM CARGO ──────────────── */
router.put('/roles/:slug/permissions', requireAuth, authorize('permissions.manage'), async (req, res) => {
  const { permission_slugs } = req.body;
  if (!Array.isArray(permission_slugs)) {
    return res.status(400).json({ error: 'permission_slugs deve ser array.' });
  }
  const { data: role } = await supabase.from('roles').select('id, slug, protegido').eq('slug', req.params.slug).maybeSingle();
  if (!role) return res.status(404).json({ error: 'Cargo não encontrado.' });
  if (role.slug === 'super_admin') {
    return res.status(400).json({ error: 'Não é possível alterar permissões do Super Administrador.' });
  }

  // Limpa atuais e insere novas
  await supabase.from('role_permissions').delete().eq('role_id', role.id);
  if (permission_slugs.length) {
    const { data: perms } = await supabase.from('permissions').select('id, slug').in('slug', permission_slugs);
    if (perms?.length) {
      await supabase.from('role_permissions').insert(perms.map(p => ({
        role_id: role.id, permission_id: p.id,
      })));
    }
  }

  // Invalida cache de todos os usuários que têm esse role
  const { data: usuarios } = await supabase.from('user_roles').select('user_id').eq('role_id', role.id);
  (usuarios || []).forEach(u => invalidarPermissoesCache(u.user_id));

  res.json({ success: true, count: permission_slugs.length });
});

/* ── LISTAR TODAS PERMISSÕES (catálogo) ────────────── */
router.get('/permissions', requireAuth, authorize.any('permissions.manage', 'users.read'), async (req, res) => {
  const { data, error } = await supabase
    .from('permissions').select('*').order('modulo').order('slug');
  if (error) return res.status(400).json({ error: error.message });
  // Agrupa por módulo
  const grupos = {};
  (data || []).forEach(p => {
    if (!grupos[p.modulo]) grupos[p.modulo] = [];
    grupos[p.modulo].push(p);
  });
  res.json({ flat: data, grupos });
});

/* ── ATRIBUIR ROLE A USUÁRIO ───────────────────────── */
router.post('/users/:userId/roles', requireAuth, authorize('permissions.manage'), async (req, res) => {
  const { role_slug } = req.body;
  if (!role_slug) return res.status(400).json({ error: 'role_slug obrigatório.' });
  const { data: role } = await supabase.from('roles').select('id').eq('slug', role_slug).maybeSingle();
  if (!role) return res.status(404).json({ error: 'Cargo não existe.' });

  await supabase.from('user_roles').upsert({
    user_id: req.params.userId, role_id: role.id, granted_by: req.user.id,
  }, { onConflict: 'user_id,role_id' });

  invalidarPermissoesCache(req.params.userId);
  res.json({ success: true });
});

router.delete('/users/:userId/roles/:roleSlug', requireAuth, authorize('permissions.manage'), async (req, res) => {
  // Bloqueia auto-remoção do super_admin
  const { data: role } = await supabase.from('roles').select('id, slug').eq('slug', req.params.roleSlug).maybeSingle();
  if (!role) return res.status(404).json({ error: 'Cargo não existe.' });
  if (role.slug === 'super_admin' && req.params.userId === req.user.id) {
    return res.status(400).json({ error: 'Você não pode remover sua própria permissão de Super Admin.' });
  }
  await supabase.from('user_roles').delete()
    .eq('user_id', req.params.userId).eq('role_id', role.id);
  invalidarPermissoesCache(req.params.userId);
  res.json({ success: true });
});

/* ── PERMISSÕES DE UM USUÁRIO ──────────────────────── */
router.get('/users/:userId/permissions', requireAuth, authorize.any('permissions.manage', 'users.read'), async (req, res) => {
  const { data, error } = await supabase
    .from('v_user_permissions')
    .select('role_slug, permission_slug, modulo')
    .eq('user_id', req.params.userId);
  if (error) return res.status(400).json({ error: error.message });
  const roles = [...new Set((data || []).map(r => r.role_slug))];
  const permissions = [...new Set((data || []).map(r => r.permission_slug))];
  res.json({ user_id: req.params.userId, roles, permissions });
});

/* ── TOKENS REVOGADOS (auditoria) ──────────────────── */
router.get('/revoked-tokens', requireAuth, authorize('security.manage'), async (req, res) => {
  const { data } = await supabase
    .from('revoked_tokens')
    .select('user_id, reason, revoked_at, expires_at')
    .order('revoked_at', { ascending: false })
    .limit(100);
  res.json(data || []);
});

module.exports = router;
