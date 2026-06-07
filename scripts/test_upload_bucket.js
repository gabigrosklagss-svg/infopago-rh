const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env'), override: true });
const { supabase } = require('../src/config/supabase');

(async () => {
  // Lista buckets
  const { data: buckets, error: e1 } = await supabase.storage.listBuckets();
  console.log('Buckets disponíveis:');
  if (e1) console.log('ERRO:', e1.message);
  else console.table(buckets);

  // Tenta upload de teste pro company-documents
  const path_test = `teste/teste_${Date.now()}.txt`;
  const { error: upErr } = await supabase.storage.from('company-documents')
    .upload(path_test, Buffer.from('teste'), { contentType: 'text/plain', upsert: true });
  if (upErr) {
    console.log('\n❌ UPLOAD FALHOU:', upErr.message);
    return;
  }
  console.log('\n✓ Upload OK em company-documents/' + path_test);

  // Pega URL pública
  const { data: pub } = supabase.storage.from('company-documents').getPublicUrl(path_test);
  console.log('URL pública:', pub.publicUrl);

  // Tenta acessar
  try {
    const r = await fetch(pub.publicUrl);
    console.log('Status do fetch público:', r.status);
  } catch (e) { console.log('Fetch falhou:', e.message); }

  // Limpa
  await supabase.storage.from('company-documents').remove([path_test]);
})();
