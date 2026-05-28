const crypto = require('crypto');
const { supabase, supabasePublic } = require('../config/supabase');

/* ── Cache em memória pra reduzir queries ─────────────── */
const PERM_CACHE = new Map();           // userId → { perms: Set, roles: [], expiresAt }
const REVOKED_CACHE = new Set();        // token hashes recentes
const PERM_TTL = 60 * 1000;             // 60s
let MIN_TOKEN_IAT = 0;                  // kill switch (epoch seconds)
let MIN_TOKEN_IAT_FETCHED = 0;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function carregarMinTokenIat() {
  // Refresca a cada 30s
  if (Date.now() - MIN_TOKEN_IAT_FETCHED < 30000) return MIN_TOKEN_IAT;
  try {
    const { data } = await supabase.from('security_settings').select('value').eq('key', 'min_token_iat').maybeSingle();
    if (data?.value) MIN_TOKEN_IAT = parseInt(data.value);
  } catch {}
  MIN_TOKEN_IAT_FETCHED = Date.now();
  return MIN_TOKEN_IAT;
}

async function tokenRevogado(token) {
  const h = hashToken(token);
  if (REVOKED_CACHE.has(h)) return true;
  const { data } = await supabase.from('revoked_tokens').select('token_hash').eq('token_hash', h).maybeSingle();
  if (data) { REVOKED_CACHE.add(h); return true; }
  return false;
}

async function carregarPermissoes(userId) {
  const cached = PERM_CACHE.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const { data, error } = await supabase
    .from('v_user_permissions')
    .select('role_slug, nivel, permission_slug')
    .eq('user_id', userId);
  if (error) return { perms: new Set(), roles: [], nivel: 0, expiresAt: Date.now() + PERM_TTL };
  const perms = new Set();
  const rolesSet = new Set();
  let nivelMax = 0;
  (data || []).forEach(r => {
    perms.add(r.permission_slug);
    rolesSet.add(r.role_slug);
    if (r.nivel > nivelMax) nivelMax = r.nivel;
  });
  const entry = { perms, roles: [...rolesSet], nivel: nivelMax, expiresAt: Date.now() + PERM_TTL };
  PERM_CACHE.set(userId, entry);
  return entry;
}

function invalidarPermissoesCache(userId) {
  if (userId) PERM_CACHE.delete(userId);
  else PERM_CACHE.clear();
}

/* ── REQUIRE AUTH ─────────────────────────────────────── */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token de autenticação não enviado.', code: 'NO_TOKEN' });

  // Decodifica JWT pra extrair iat e sub (sem verificar — Supabase Auth verifica)
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8'));
    const iat = payload.iat || 0;
    const minIat = await carregarMinTokenIat();
    if (minIat && iat < minIat) {
      return res.status(401).json({ error: 'Sessão expirada por motivo de segurança. Faça login novamente.', code: 'TOKEN_REVOKED_GLOBAL' });
    }
  } catch {}

  // Blacklist específica
  if (await tokenRevogado(token)) {
    return res.status(401).json({ error: 'Token revogado.', code: 'TOKEN_REVOKED' });
  }

  // Valida o JWT no Supabase Auth
  const { data: userData, error } = await supabasePublic.auth.getUser(token);
  if (error || !userData?.user) return res.status(401).json({ error: 'Sessão inválida ou expirada.', code: 'INVALID_TOKEN' });

  // Carrega perfil
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, active, avatar_url, department, created_at')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile || profile.active === false) {
    return res.status(403).json({ error: 'Perfil inativo ou não encontrado.', code: 'PROFILE_INACTIVE' });
  }

  // Carrega permissões da tabela user_roles
  const { perms, roles, nivel } = await carregarPermissoes(userData.user.id);

  req.user = {
    id: userData.user.id,
    email: userData.user.email,
    ...profile,
    token,                // expõe pra revogar no logout
    permissions: perms,   // Set<string>
    roles,                // string[]
    nivel,                // hierarquia
  };
  next();
}

/* ── REQUIRE ROLE (LEGADO — mantido por compat) ───────── */
function requireRole(...rolesAceitos) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    // Aceita tanto pelo campo legado user_profiles.role quanto pelos novos roles
    if (rolesAceitos.includes(req.user.role)) return next();
    if (req.user.roles?.some(r => rolesAceitos.includes(r))) return next();
    // Super admin sempre passa
    if (req.user.roles?.includes('super_admin')) return next();
    return res.status(403).json({ error: 'Sem permissão para esta ação.', code: 'FORBIDDEN' });
  };
}

/* ── AUTHORIZE (novo, granular) ───────────────────────── */
/**
 * Uso:
 *   authorize('employees.update')                    -- precisa dessa permissão
 *   authorize('employees.update', 'salary.update')   -- precisa de TODAS
 *   authorize.any('payslips.read', 'payslips.create')-- precisa de PELO MENOS UMA
 */
function authorize(...permissoes) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.', code: 'NOT_AUTHENTICATED' });
    if (req.user.roles?.includes('super_admin')) return next();
    const faltam = permissoes.filter(p => !req.user.permissions.has(p));
    if (faltam.length) {
      return res.status(403).json({
        error: `Sem permissão: ${faltam.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS',
        required: permissoes,
        missing: faltam,
      });
    }
    next();
  };
}

authorize.any = function (...permissoes) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.', code: 'NOT_AUTHENTICATED' });
    if (req.user.roles?.includes('super_admin')) return next();
    const tem = permissoes.some(p => req.user.permissions.has(p));
    if (!tem) {
      return res.status(403).json({
        error: 'Sem permissão',
        code: 'INSUFFICIENT_PERMISSIONS',
        required_any: permissoes,
      });
    }
    next();
  };
};

/* ── HAS PERMISSION (helper p/ usar em código) ────────── */
function hasPermission(user, permissao) {
  if (!user) return false;
  if (user.roles?.includes('super_admin')) return true;
  return user.permissions?.has(permissao) || false;
}

/* ── REVOGAR TOKEN (logout/admin) ─────────────────────── */
async function revogarToken(token, userId, motivo = 'logout') {
  if (!token) return;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8'));
    const exp = payload.exp ? new Date(payload.exp * 1000).toISOString() : new Date(Date.now() + 24*3600*1000).toISOString();
    const h = hashToken(token);
    await supabase.from('revoked_tokens').upsert({
      token_hash: h,
      user_id: userId,
      reason: motivo,
      expires_at: exp,
    }, { onConflict: 'token_hash' });
    REVOKED_CACHE.add(h);
  } catch (e) {
    console.warn('[auth] falha ao revogar token:', e.message);
  }
}

/* ── KILL SWITCH GLOBAL (revoga todos) ────────────────── */
async function revogarTodosTokens(motivo = 'kill_switch') {
  const novoIat = Math.floor(Date.now() / 1000);
  await supabase.from('security_settings').upsert({
    key: 'min_token_iat',
    value: novoIat,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  MIN_TOKEN_IAT = novoIat;
  MIN_TOKEN_IAT_FETCHED = Date.now();
  PERM_CACHE.clear();
  REVOKED_CACHE.clear();
  return { revoked_iat: novoIat, motivo };
}

/* ── LIMPEZA DE BLACKLIST EXPIRADA ───────────────────── */
async function limparBlacklistExpirada() {
  await supabase.from('revoked_tokens').delete().lt('expires_at', new Date().toISOString());
  REVOKED_CACHE.clear();
}

module.exports = {
  requireAuth,
  requireRole,        // legado
  authorize,
  hasPermission,
  revogarToken,
  revogarTodosTokens,
  invalidarPermissoesCache,
  limparBlacklistExpirada,
  hashToken,
};
