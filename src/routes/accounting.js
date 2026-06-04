const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, authorize } = require('../middleware/auth');

/* Indicadores contábeis do período */
router.get('/kpis', requireAuth, authorize.any('reports.financial', 'reports.view'), async (req, res) => {
  const now = new Date();
  const mes = parseInt(req.query.mes) || (now.getMonth() + 1);
  const ano = parseInt(req.query.ano) || now.getFullYear();

  // Folha atual
  const { data: psAtual } = await supabase.from('payslips')
    .select('total_proventos, total_descontos, salario_liquido, inss_valor, irrf_valor, fgts_valor, employees(department_id, departments(nome))')
    .eq('competencia_mes', mes).eq('competencia_ano', ano);

  const sum = (arr, k) => (arr || []).reduce((s, p) => s + parseFloat(p[k] || 0), 0);

  const bruta   = sum(psAtual, 'total_proventos');
  const liquido = sum(psAtual, 'salario_liquido');
  const inssFunc= sum(psAtual, 'inss_valor');
  const irrfFunc= sum(psAtual, 'irrf_valor');
  const fgts    = sum(psAtual, 'fgts_valor');

  // Encargos patronais estimados
  const inssPatronal = bruta * 0.20;
  const sistemaS     = bruta * 0.058;
  const rat          = bruta * 0.02;
  const totalEncargos= inssPatronal + sistemaS + rat + fgts;

  // Provisões
  const prov13       = bruta / 12;
  const provFerias   = (bruta * 1.3333) / 12;
  const totalProv    = prov13 + provFerias;
  const totalCusto   = bruta + totalEncargos + totalProv;

  // Comparativo com mês anterior
  const dataAnt = new Date(ano, mes - 2, 1);
  const mesAnt = dataAnt.getMonth() + 1;
  const anoAnt = dataAnt.getFullYear();
  const { data: psAnt } = await supabase.from('payslips')
    .select('total_proventos, fgts_valor')
    .eq('competencia_mes', mesAnt).eq('competencia_ano', anoAnt);
  const brutaAnt = sum(psAnt, 'total_proventos');
  const fgtsAnt  = sum(psAnt, 'fgts_valor');

  const varFolha = brutaAnt > 0 ? ((bruta - brutaAnt) / brutaAnt) * 100 : 0;

  // Por departamento
  const porDepto = {};
  (psAtual || []).forEach(p => {
    const dep = p.employees?.departments?.nome || '—';
    if (!porDepto[dep]) porDepto[dep] = { bruta: 0, fgts: 0, inss: 0, qtd: 0 };
    porDepto[dep].bruta += parseFloat(p.total_proventos || 0);
    porDepto[dep].fgts  += parseFloat(p.fgts_valor || 0);
    porDepto[dep].inss  += parseFloat(p.inss_valor || 0);
    porDepto[dep].qtd++;
  });

  // Histórico 12 meses
  const historico = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(ano, mes - 1 - i, 1);
    const m = d.getMonth() + 1;
    const a = d.getFullYear();
    const { data: hps } = await supabase.from('payslips')
      .select('total_proventos, fgts_valor, inss_valor').eq('competencia_mes', m).eq('competencia_ano', a);
    historico.push({
      mes: m, ano: a,
      label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      bruta: sum(hps, 'total_proventos'),
      fgts: sum(hps, 'fgts_valor'),
      inss: sum(hps, 'inss_valor'),
    });
  }

  res.json({
    competencia: { mes, ano },
    folha: { bruta, liquido, qtd_holerites: (psAtual || []).length },
    impostos_funcionario: { inss: inssFunc, irrf: irrfFunc, total: inssFunc + irrfFunc },
    encargos_patronais: { inss: inssPatronal, sistema_s: sistemaS, rat, fgts, total: totalEncargos },
    provisoes: { decimo_terceiro: prov13, ferias: provFerias, total: totalProv },
    custo_total: totalCusto,
    comparativo: {
      mes_anterior: { bruta: brutaAnt, fgts: fgtsAnt },
      variacao_folha_pct: parseFloat(varFolha.toFixed(2)),
    },
    por_departamento: porDepto,
    historico_12m: historico,
  });
});

/* Insights da Ingrid sobre os KPIs (com cache diário pra economizar custo) */
router.post('/insights', requireAuth, authorize.any('reports.financial', 'reports.view'), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({
      insights: [
        { tipo: 'info', titulo: 'IA não configurada', texto: 'Configure a chave ANTHROPIC_API_KEY nas variáveis de ambiente para receber análises automáticas.' }
      ]
    });
  }

  const kpis = req.body.kpis;
  if (!kpis) return res.status(400).json({ error: 'KPIs obrigatórios.' });

  const force = req.body.force === true;
  const mes = kpis.competencia?.mes;
  const ano = kpis.competencia?.ano;
  const hojeIso = new Date().toISOString().slice(0, 10);
  const cacheKey = `insights_${ano}_${mes}_${hojeIso}`;

  // Verifica cache do dia (se não for forçado)
  if (!force) {
    const { data: cached } = await supabase.from('ia_cache')
      .select('resposta, created_at').eq('cache_key', cacheKey).maybeSingle();
    if (cached) {
      return res.json({
        insights: cached.resposta,
        cached: true,
        cached_at: cached.created_at,
        model: 'claude-sonnet-4-5',
      });
    }
  }

  const prompt = `Você é a Ingrid, analista contábil/RH especialista da empresa.
Analise os indicadores contábeis abaixo e gere 4-6 INSIGHTS curtos e ACIONÁVEIS em português brasileiro.
Cada insight deve apontar fatos relevantes, identificar variações importantes, sugerir cuidados ou parabenizar.

Responda APENAS um array JSON válido, no formato:
[
  {"tipo":"warn|danger|success|info","titulo":"título curto","texto":"explicação em 1-2 frases"}
]

Critérios:
- "danger" para problemas críticos (variações > 15%, multas, valores absurdos)
- "warn" para atenção (variações 5-15%, departamentos fora da média)
- "success" para conquistas (redução de custo, boa eficiência)
- "info" para fatos relevantes neutros

DADOS DA COMPETÊNCIA ${String(kpis.competencia?.mes).padStart(2,'0')}/${kpis.competencia?.ano}:
- Folha bruta: R$ ${kpis.folha?.bruta?.toFixed(2)} (${kpis.folha?.qtd_holerites} holerites)
- Folha líquida: R$ ${kpis.folha?.liquido?.toFixed(2)}
- INSS funcionário: R$ ${kpis.impostos_funcionario?.inss?.toFixed(2)}
- IRRF retido: R$ ${kpis.impostos_funcionario?.irrf?.toFixed(2)}
- Encargos patronais totais: R$ ${kpis.encargos_patronais?.total?.toFixed(2)}
  - INSS patronal (20%): R$ ${kpis.encargos_patronais?.inss?.toFixed(2)}
  - FGTS (8%): R$ ${kpis.encargos_patronais?.fgts?.toFixed(2)}
  - Sistema S (5,8%): R$ ${kpis.encargos_patronais?.sistema_s?.toFixed(2)}
- Provisões (13º + férias): R$ ${kpis.provisoes?.total?.toFixed(2)}
- CUSTO TOTAL DA EMPRESA: R$ ${kpis.custo_total?.toFixed(2)}
- Variação vs mês anterior: ${kpis.comparativo?.variacao_folha_pct}%

Por departamento:
${Object.entries(kpis.por_departamento || {}).map(([dep, v]) => `- ${dep}: ${v.qtd} pessoas, bruta R$ ${v.bruta.toFixed(2)}`).join('\n')}

Tendência 12 meses (folha bruta): ${(kpis.historico_12m || []).slice(-4).map(h => `${h.label} R$ ${(h.bruta/1000).toFixed(0)}k`).join(' · ')}

Retorne APENAS o array JSON, nada mais.`;

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const r = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });
    const txt = r.content?.[0]?.text || '[]';
    const json = txt.match(/\[[\s\S]*\]/)?.[0] || '[]';
    const insights = JSON.parse(json);
    // Salva no cache pra reuso no mesmo dia
    await supabase.from('ia_cache').upsert({
      cache_key: cacheKey,
      resposta: insights,
      created_at: new Date().toISOString(),
    }, { onConflict: 'cache_key' }).catch(() => {});
    res.json({ insights, cached: false, model: 'claude-sonnet-4-5' });
  } catch (e) {
    console.warn('[accounting/insights] erro IA:', e.message);
    res.json({
      insights: [
        { tipo: 'info', titulo: 'Análise indisponível', texto: 'A IA não conseguiu processar os dados agora. Tente novamente em alguns minutos.' }
      ]
    });
  }
});

/* Pergunta livre pra Ingrid sobre os dados contábeis */
router.post('/ask', requireAuth, authorize.any('reports.financial', 'reports.view'), async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'IA não configurada.' });
  }
  const { pergunta, contexto } = req.body;
  if (!pergunta) return res.status(400).json({ error: 'pergunta obrigatória.' });

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const r = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Você é a Ingrid, analista contábil da empresa. Responda a pergunta de forma curta e direta em português brasileiro.
Use os dados abaixo como contexto. Se a pergunta não puder ser respondida com esses dados, diga claramente o que falta.

DADOS:
${JSON.stringify(contexto || {}, null, 2)}

PERGUNTA: ${pergunta}`
      }],
    });
    res.json({ resposta: r.content?.[0]?.text || '(sem resposta)' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
