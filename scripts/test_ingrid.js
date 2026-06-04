const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env'), override: true });
(async () => {
  console.log('ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? `${process.env.ANTHROPIC_API_KEY.slice(0, 16)}...` : 'NÃO DEFINIDA');

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    console.log('\n--- Testando claude-sonnet-4-5 ---');
    const r = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 500,
      messages: [{ role: 'user', content: 'Responda apenas: [{"tipo":"info","titulo":"Teste","texto":"OK"}]' }],
    });
    console.log('Resposta:', r.content?.[0]?.text);
    console.log('Stop reason:', r.stop_reason);
    console.log('Usage:', r.usage);
  } catch (e) {
    console.log('❌ ERRO:', e.message);
    console.log('Status:', e.status);
    console.log('Stack:', e.stack?.split('\n').slice(0, 5).join('\n'));
  }

  // Verifica tabela ia_cache
  const { supabase } = require('../src/config/supabase');
  console.log('\n--- Verificando tabela ia_cache ---');
  const { data, error } = await supabase.from('ia_cache').select('*').limit(1);
  if (error) console.log('❌ Erro tabela:', error.message);
  else console.log('✓ Tabela ia_cache existe. Total:', data.length);
})();
