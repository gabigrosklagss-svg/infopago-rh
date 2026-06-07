const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env'), override: true });
const { supabase } = require('../src/config/supabase');
(async () => {
  const { data } = await supabase.from('announcements').select('id, titulo, anexo_url, anexo_nome, anexo_tipo, anexo_tamanho').not('anexo_url', 'is', null).order('created_at', { ascending: false }).limit(5);
  if (!data?.length) { console.log('Nenhum comunicado com anexo no banco.'); return; }
  console.log('Comunicados com anexo:\n');
  for (const a of data) {
    console.log(`- ${a.titulo}`);
    console.log(`  anexo_url: ${a.anexo_url}`);
    console.log(`  nome: ${a.anexo_nome} · tipo: ${a.anexo_tipo}`);
    // Tenta baixar
    try {
      const r = await fetch(a.anexo_url);
      console.log(`  fetch: ${r.status} ${r.headers.get('content-type')} ${r.headers.get('content-length')} bytes`);
    } catch (e) {
      console.log(`  fetch FALHOU: ${e.message}`);
    }
    console.log();
  }
})();
