/**
 * Health check: verifica integridade básica do sistema.
 * Roda os endpoints/queries principais e reporta problemas.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env'), override: true });

const { supabase } = require('../src/config/supabase');

const checks = [];
const erros = [];

async function check(nome, fn) {
  try {
    const r = await fn();
    checks.push(`✓ ${nome}: ${r}`);
  } catch (e) {
    erros.push(`✗ ${nome}: ${e.message}`);
  }
}

(async () => {
  // 1. Tabelas críticas existem
  for (const t of [
    'employees', 'payslips', 'departments', 'positions',
    'vacations', 'vacation_requests', 'time_entries', 'time_bank_balance',
    'terminations', 'thirteenth_salary', 'absences', 'warnings',
    'roles', 'permissions', 'user_roles',
    'company_events', 'cv_pool', 'announcements', 'ia_cache',
  ]) {
    await check(`tabela ${t}`, async () => {
      const { count, error } = await supabase.from(t).select('id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return `${count || 0} registros`;
    });
  }

  // 2. Holerites com status inválido
  await check('payslips com status fora do enum', async () => {
    const valid = ['rascunho','gerado','enviado','confirmado'];
    const { data } = await supabase.from('payslips').select('status').not('status', 'in', `(${valid.join(',')})`);
    if (data?.length) throw new Error(`${data.length} holerite(s) com status inválido`);
    return 'OK';
  });

  // 3. Funcionários demitidos ainda em time_bank_balance
  await check('banco de horas vazado com demitidos', async () => {
    const { data: emps } = await supabase.from('employees').select('id').neq('status', 'ativo');
    const ids = (emps || []).map(e => e.id);
    if (!ids.length) return 'sem demitidos';
    const { data: lixo } = await supabase.from('time_bank_balance').select('employee_id').in('employee_id', ids);
    if (lixo?.length) throw new Error(`${lixo.length} saldo(s) órfão(s)`);
    return 'OK';
  });

  // 4. Holerites órfãos (sem funcionário)
  await check('holerites órfãos', async () => {
    const { data: emps } = await supabase.from('employees').select('id');
    const ids = new Set((emps || []).map(e => e.id));
    const { data: ps } = await supabase.from('payslips').select('id, employee_id');
    const orfaos = (ps || []).filter(p => !ids.has(p.employee_id));
    if (orfaos.length) throw new Error(`${orfaos.length} holerite(s) órfão(s)`);
    return 'OK';
  });

  // 5. Datas de pagamento absurdas
  await check('payslips com data_pagamento ano > 2100', async () => {
    const { data } = await supabase.from('payslips').select('data_pagamento').not('data_pagamento', 'is', null);
    const ruins = (data || []).filter(p => p.data_pagamento && parseInt(p.data_pagamento.slice(0,4)) > 2100);
    if (ruins.length) throw new Error(`${ruins.length} datas com ano > 2100`);
    return 'OK';
  });

  // 6. Tabela ia_cache com erros antigos (mais de 30 dias)
  await check('ia_cache entradas antigas', async () => {
    const lim = new Date(Date.now() - 30*24*3600*1000).toISOString();
    const { data } = await supabase.from('ia_cache').select('cache_key').lt('created_at', lim);
    return data?.length ? `${data.length} entradas antigas (limpe com SELECT clean_ia_cache_antigo())` : 'OK';
  });

  // 7. ANTHROPIC_API_KEY definida
  await check('ANTHROPIC_API_KEY', async () => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('não definida no env');
    if (!process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')) throw new Error('formato inválido');
    return 'OK (' + process.env.ANTHROPIC_API_KEY.slice(0, 16) + '...)';
  });

  // 8. SMTP configurado
  await check('SMTP configurado', async () => {
    const { data } = await supabase.from('company_settings').select('smtp_host, smtp_user, smtp_pass').eq('id', 1).maybeSingle();
    if (!data) throw new Error('company_settings não existe');
    if (!data.smtp_host) return 'aviso: SMTP não configurado, envio de e-mails desabilitado';
    return `OK (${data.smtp_host}:${data.smtp_user})`;
  });

  // 9. Roles sem permissões
  await check('roles sem permissões', async () => {
    const { data: rs } = await supabase.from('roles').select('id, slug');
    const semPerm = [];
    for (const r of rs || []) {
      const { count } = await supabase.from('role_permissions').select('*', { count: 'exact', head: true }).eq('role_id', r.id);
      if (count === 0) semPerm.push(r.slug);
    }
    if (semPerm.length) throw new Error(`roles vazios: ${semPerm.join(', ')}`);
    return 'OK';
  });

  // 10. Usuários sem role
  await check('usuários sem role atribuído', async () => {
    const { data: ups } = await supabase.from('user_profiles').select('id, full_name').eq('active', true);
    const semRole = [];
    for (const u of ups || []) {
      const { count } = await supabase.from('user_roles').select('*', { count: 'exact', head: true }).eq('user_id', u.id);
      if (count === 0) semRole.push(u.full_name);
    }
    if (semRole.length) throw new Error(`sem role: ${semRole.join(', ')}`);
    return 'OK';
  });

  console.log('\n=== HEALTH CHECK ===\n');
  checks.forEach(c => console.log(c));
  console.log('\n=== ERROS ===\n');
  if (erros.length === 0) console.log('Nenhum erro encontrado.');
  else erros.forEach(e => console.log(e));
})();
