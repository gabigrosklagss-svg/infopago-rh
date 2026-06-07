const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env'), override: true });
const { supabase } = require('../src/config/supabase');

(async () => {
  const id = 'b98a2b9b-ac4d-4f58-a395-1d06846df3ab';

  // Tenta com cada campo separado pra descobrir qual rejeita
  const tests = [
    { campo: 'anexo_url', valor: 'comunicados/b98a2b9b/teste.jpg' },
    { campo: 'anexo_nome', valor: 'ferias coletivas teste.jpg' },
    { campo: 'anexo_tipo', valor: 'image/jpeg' },
    { campo: 'anexo_tamanho', valor: 12914 },
  ];

  for (const t of tests) {
    const payload = { [t.campo]: t.valor };
    const { data, error } = await supabase.from('announcements')
      .update(payload).eq('id', id).select(t.campo).single();
    if (error) {
      console.log(`❌ ${t.campo} = ${t.valor} → ERRO: ${error.message} (code ${error.code}) ${error.details || ''}`);
    } else {
      console.log(`✓ ${t.campo} = ${t.valor} → OK (saved: ${JSON.stringify(data)})`);
    }
  }

  // Agora limpa
  await supabase.from('announcements').update({
    anexo_url: null, anexo_nome: null, anexo_tipo: null, anexo_tamanho: null
  }).eq('id', id);
  console.log('\n(Campos limpos para retestar)');
})();
