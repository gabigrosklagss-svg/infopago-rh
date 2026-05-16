const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

router.get('/dashboard', requireAuth, async (req, res) => {
  const now = new Date();
  const mes = now.getMonth() + 1;
  const ano = now.getFullYear();

  const [empAtivos, folha, holEnviados, ferAVencer, aniversariantes, ultimas] = await Promise.all([
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
    supabase.from('payslips').select('total_proventos, total_descontos, salario_liquido, inss_valor, irrf_valor, fgts_valor')
      .eq('competencia_mes', mes).eq('competencia_ano', ano),
    supabase.from('payslips').select('id', { count: 'exact', head: true })
      .eq('competencia_mes', mes).eq('competencia_ano', ano).eq('status', 'enviado'),
    supabase.from('vacations').select('*, employees(nome_completo, matricula)')
      .lte('periodo_aquisitivo_fim', new Date(ano, now.getMonth() + 2, 0).toISOString().split('T')[0])
      .neq('status', 'concluido'),
    supabase.from('employees').select('id, nome_completo, data_nascimento, matricula, foto_url').eq('status', 'ativo'),
    supabase.from('email_logs').select('*, employees(nome_completo)')
      .order('created_at', { ascending: false }).limit(10),
  ]);

  const folhaData = folha.data || [];
  const totalProventos = folhaData.reduce((s, p) => s + parseFloat(p.total_proventos || 0), 0);
  const totalDescontos = folhaData.reduce((s, p) => s + parseFloat(p.total_descontos || 0), 0);
  const totalLiquido   = folhaData.reduce((s, p) => s + parseFloat(p.salario_liquido || 0), 0);
  const totalINSS      = folhaData.reduce((s, p) => s + parseFloat(p.inss_valor || 0), 0);
  const totalIRRF      = folhaData.reduce((s, p) => s + parseFloat(p.irrf_valor || 0), 0);
  const totalFGTS      = folhaData.reduce((s, p) => s + parseFloat(p.fgts_valor || 0), 0);

  // Aniversariantes do mês
  const aniv = (aniversariantes.data || []).filter(e => {
    if (!e.data_nascimento) return false;
    return new Date(e.data_nascimento).getMonth() + 1 === mes;
  }).map(e => ({
    ...e,
    dia: new Date(e.data_nascimento).getDate(),
  })).sort((a, b) => a.dia - b.dia);

  // Histórico últimos 6 meses
  const historico = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ano, now.getMonth() - i, 1);
    const m = d.getMonth() + 1;
    const a = d.getFullYear();
    const { data: ps } = await supabase.from('payslips')
      .select('total_proventos').eq('competencia_mes', m).eq('competencia_ano', a);
    historico.push({
      mes: m, ano: a,
      label: d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
      total: (ps || []).reduce((s, p) => s + parseFloat(p.total_proventos || 0), 0),
    });
  }

  res.json({
    funcionarios_ativos: empAtivos.count || 0,
    folha_do_mes: {
      total_proventos: totalProventos,
      total_descontos: totalDescontos,
      total_liquido: totalLiquido,
      inss: totalINSS,
      irrf: totalIRRF,
      fgts: totalFGTS,
      qtd_holerites: folhaData.length,
    },
    holerites_enviados: holEnviados.count || 0,
    ferias_a_vencer: ferAVencer.data || [],
    aniversariantes: aniv,
    ultimos_envios: ultimas.data || [],
    historico_folha: historico,
    competencia: { mes, ano },
  });
});

module.exports = router;
