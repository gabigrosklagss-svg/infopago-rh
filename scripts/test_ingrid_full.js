/**
 * Reproduz o /accounting/insights com KPIs reais.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'secrets', '.env'), override: true });

const KPIS = {
  competencia: { mes: 6, ano: 2026 },
  folha: { bruta: 10375.39, liquido: 8633.73, qtd_holerites: 2 },
  impostos_funcionario: { inss: 1060.13, irrf: 681.53, total: 1741.66 },
  encargos_patronais: { inss: 2075.08, sistema_s: 601.77, rat: 207.51, fgts: 830.03, total: 3714.39 },
  provisoes: { decimo_terceiro: 864.62, ferias: 1153.05, total: 2017.67 },
  custo_total: 16107.45,
  comparativo: { mes_anterior: { bruta: 41049.74, fgts: 3283.98 }, variacao_folha_pct: -74.7 },
  por_departamento: { CEO: { bruta: 0, fgts: 0, inss: 0, qtd: 0 }, Financeiro: { bruta: 5242.30, fgts: 419.38, inss: 537.71, qtd: 1 }, TI: { bruta: 5133.09, fgts: 410.65, inss: 522.42, qtd: 1 } },
  historico_12m: [],
};

(async () => {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Responda APENAS um array JSON sem texto antes ou depois, com 3 objetos no formato {"tipo":"info","titulo":"x","texto":"y"}. KPIs: ${JSON.stringify(KPIS).slice(0, 1000)}`;
  console.log('Chamando Claude...');
  const r = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });
  const raw = r.content[0].text;
  console.log('\n=== RAW ===\n', raw);
  console.log('\n=== USAGE ===', r.usage);

  // Parser robusto:
  let txt = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const inicio = txt.indexOf('[');
  const fim = txt.lastIndexOf(']');
  const jsonStr = txt.slice(inicio, fim + 1);
  console.log('\n=== PARSED ===\n', JSON.parse(jsonStr));
})();
