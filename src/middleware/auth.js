const { supabase, supabasePublic } = require('../config/supabase');

/**
 * Valida o JWT do Supabase Auth e carrega o perfil do usuário.
 * Exige Header: Authorization: Bearer <token>
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token de autenticação não enviado.' });

  const { data: userData, error } = await supabasePublic.auth.getUser(token);
  if (error || !userData?.user) return res.status(401).json({ error: 'Sessão inválida ou expirada.' });

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, active')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (!profile || profile.active === false) {
    return res.status(403).json({ error: 'Perfil inativo ou não encontrado.' });
  }

  req.user = { id: userData.user.id, email: userData.user.email, ...profile };
  next();
}

/**
 * Restringe acesso a determinadas roles. Uso: requireRole('admin','rh')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Sem permissão para esta ação.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
