const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env') });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log('Tentando criar usuário com email JÁ EXISTENTE...');
  const { data, error } = await supabase.auth.admin.createUser({
    email: 'gkamysss@gmail.com',
    password: 'senha12345',
    email_confirm: true,
  });
  if (error) {
    console.log('ERRO esperado:', error.message);
    console.log('STATUS:', error.status);
  } else {
    console.log('Criou de novo?', data.user.id);
  }
})();
