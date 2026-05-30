const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

(async () => {
  // Lista usuários ativos
  const r = await fetch(`${URL}/rest/v1/user_profiles?select=id,full_name,role,active,created_at&order=created_at.asc`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const users = await r.json();
  console.log('\nUSUÁRIOS NO SISTEMA:');
  users.forEach(u => console.log(`  ${u.id.slice(0,8)} · ${u.full_name} · role=${u.role} · active=${u.active}`));

  // Auth users (e-mails)
  const r2 = await fetch(`${URL}/auth/v1/admin/users?per_page=20`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const auth = await r2.json();
  console.log('\nE-MAILS CADASTRADOS:');
  (auth.users || []).forEach(u => console.log(`  ${u.id.slice(0,8)} · ${u.email} · confirmed=${!!u.email_confirmed_at} · last_login=${u.last_sign_in_at || 'nunca'}`));

  // Estado RLS revoked_tokens
  const r3 = await fetch(`${URL}/rest/v1/revoked_tokens?select=*&order=revoked_at.desc&limit=5`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const rev = await r3.json();
  console.log('\nÚLTIMOS TOKENS REVOGADOS:', rev.length);
  rev.forEach(t => console.log(`  ${t.reason} · ${t.revoked_at}`));
})();
