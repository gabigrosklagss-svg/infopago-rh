const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const testEmail = `teste_${Date.now()}@infopago.dev`;
  console.log('Testando criação de auth.user com:', testEmail);
  const { data, error } = await supabase.auth.admin.createUser({
    email: testEmail,
    password: 'senha123456',
    email_confirm: true,
  });
  if (error) {
    console.log('ERRO:', error.message);
    console.log('STATUS:', error.status);
    console.log('FULL:', JSON.stringify(error, null, 2));
  } else {
    console.log('OK criado:', data.user.id);
    // Limpa
    await supabase.auth.admin.deleteUser(data.user.id);
    console.log('Removido.');
  }

  // Verifica triggers em auth.users
  console.log('\n--- Verificando user_profiles ---');
  const { data: tablas, error: terr } = await supabase
    .from('user_profiles').select('id, full_name, role').limit(3);
  if (terr) console.log('Erro user_profiles:', terr);
  else console.log('Sample:', tablas);
})();
