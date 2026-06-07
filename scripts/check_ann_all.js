const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env'), override: true });
const { supabase } = require('../src/config/supabase');
(async () => {
  console.log('Supabase URL:', process.env.SUPABASE_URL);
  // Replica EXATAMENTE a query da rota
  const { data, error, count } = await supabase.from('announcements').select('*', { count: 'exact' });
  console.log(`Total no banco: ${count}`);
  if (error) console.log('ERRO:', error);
  console.log(JSON.stringify(data, null, 2));

  // Conta total via REST direto pra confirmar
  const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${URL}/rest/v1/announcements?select=count`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' }
  });
  console.log('\n--- Via REST direto ---');
  console.log('Headers:', r.headers.get('content-range'));
  console.log(await r.text());
})();
