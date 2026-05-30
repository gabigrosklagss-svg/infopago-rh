const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

(async () => {
  const tables = ['roles','permissions','role_permissions','user_roles','revoked_tokens','security_settings'];
  for (const t of tables) {
    const r = await fetch(`${URL}/rest/v1/${t}?select=*&limit=200`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
    });
    const ct = r.headers.get('content-range') || '—';
    console.log(`${r.status === 200 ? '✓' : '✗'} ${t.padEnd(20)} ${r.status}  total: ${ct}`);
  }

  // Lista cargos e quantidade de permissões de cada
  const roles = await fetch(`${URL}/rest/v1/roles?select=slug,nome,nivel&order=nivel.desc`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  }).then(r => r.json());
  console.log('\nCargos cadastrados:');
  for (const role of roles) {
    const count = await fetch(`${URL}/rest/v1/role_permissions?role_id=eq.(select id from roles where slug=${role.slug})&select=*`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' },
    }).then(r => r.headers.get('content-range'));
    // simpler — count via head
    const c2 = await fetch(`${URL}/rest/v1/rpc/role_perm_count`, {}).catch(() => null);
    console.log(`  ${role.slug.padEnd(14)} ${role.nome} (nível ${role.nivel})`);
  }

  // Lista permissões por cargo via JOIN
  const all = await fetch(`${URL}/rest/v1/role_permissions?select=roles(slug),permissions(modulo)`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  }).then(r => r.json());
  const byRole = {};
  all.forEach(r => { const s = r.roles?.slug; if (!s) return; byRole[s] = (byRole[s] || 0) + 1; });
  console.log('\nPermissões por cargo:');
  Object.entries(byRole).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(14)} ${v} permissões`);
  });

  // Usuários e seus cargos
  const usr = await fetch(`${URL}/rest/v1/user_roles?select=user_id,roles(slug)`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  }).then(r => r.json());
  console.log('\nUsuários com cargos atribuídos:');
  const grp = {};
  usr.forEach(u => {
    if (!grp[u.user_id]) grp[u.user_id] = [];
    grp[u.user_id].push(u.roles?.slug);
  });
  Object.entries(grp).forEach(([uid, roles]) => {
    console.log(`  ${uid.slice(0,8)} → ${roles.join(', ')}`);
  });
})();
