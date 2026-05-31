const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

/* ════════════════════════════════════════════════════════════
   DASHBOARD (existente — mantido)
   ════════════════════════════════════════════════════════════ */
router.get('/dashboard', requireAuth, async (req, res) => {
  const now = new Date();
  const mes = parseInt(req.query.mes) || (now.getMonth() + 1);
  const ano = parseInt(req.query.ano) || now.getFullYear();

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
  const sum = (k) => folhaData.reduce((s, p) => s + parseFloat(p[k] || 0), 0);

  const aniv = (aniversariantes.data || []).filter(e => {
    if (!e.data_nascimento) return false;
    return new Date(e.data_nascimento).getMonth() + 1 === mes;
  }).map(e => ({ ...e, dia: new Date(e.data_nascimento).getDate() }))
    .sort((a, b) => a.dia - b.dia);

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
      total_proventos: sum('total_proventos'),
      total_descontos: sum('total_descontos'),
      total_liquido: sum('salario_liquido'),
      inss: sum('inss_valor'),
      irrf: sum('irrf_valor'),
      fgts: sum('fgts_valor'),
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

/* ════════════════════════════════════════════════════════════
   HELPERS de período
   ════════════════════════════════════════════════════════════ */
function getPeriodo(req) {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(to.getFullYear(), to.getMonth() - 11, 1);
  return { from, to, fromISO: from.toISOString().slice(0, 10), toISO: to.toISOString().slice(0, 10) };
}

function idade(data_nasc) {
  if (!data_nasc) return null;
  const d = new Date(data_nasc); const h = new Date();
  let a = h.getFullYear() - d.getFullYear();
  if (h.getMonth() < d.getMonth() || (h.getMonth() === d.getMonth() && h.getDate() < d.getDate())) a--;
  return a;
}

function mesesEntre(de, ate) {
  const d = new Date(de), a = new Date(ate);
  return (a.getFullYear() - d.getFullYear()) * 12 + (a.getMonth() - d.getMonth());
}

/* ════════════════════════════════════════════════════════════
   1. HEADCOUNT — composição da força de trabalho
   ════════════════════════════════════════════════════════════ */
router.get('/headcount', requireAuth, async (req, res) => {
  const { department_id } = req.query;
  let q = supabase.from('employees')
    .select('id, nome_completo, sexo, data_nascimento, data_admissao, tipo_contrato, filial, status, salario_base, department_id, position_id, departments(nome), positions(titulo, nivel)')
    .eq('status', 'ativo');
  if (department_id) q = q.eq('department_id', department_id);
  const { data: emps, error } = await q;
  if (error) return res.status(400).json({ error: error.message });

  const agg = (arr, key) => arr.reduce((m, x) => { const k = x[key] || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const grupoIdade = (i) => i == null ? '—' : i < 25 ? '<25' : i < 35 ? '25-34' : i < 45 ? '35-44' : i < 55 ? '45-54' : '55+';
  const grupoTempo = (m) => m == null ? '—' : m < 12 ? '0-1 ano' : m < 36 ? '1-3 anos' : m < 60 ? '3-5 anos' : m < 120 ? '5-10 anos' : '10+ anos';

  res.json({
    total: emps.length,
    por_departamento: agg(emps.map(e => ({ k: e.departments?.nome })), 'k'),
    por_cargo: agg(emps.map(e => ({ k: e.positions?.titulo })), 'k'),
    por_nivel: agg(emps.map(e => ({ k: e.positions?.nivel })), 'k'),
    por_filial: agg(emps.map(e => ({ k: e.filial })), 'k'),
    por_tipo_contrato: agg(emps.map(e => ({ k: e.tipo_contrato })), 'k'),
    por_genero: agg(emps.map(e => ({ k: e.sexo })), 'k'),
    por_faixa_etaria: agg(emps.map(e => ({ k: grupoIdade(idade(e.data_nascimento)) })), 'k'),
    por_tempo_casa: agg(emps.map(e => ({ k: grupoTempo(mesesEntre(e.data_admissao, new Date())) })), 'k'),
  });
});

/* ════════════════════════════════════════════════════════════
   2. TURNOVER — admissões e desligamentos
   ════════════════════════════════════════════════════════════ */
router.get('/turnover', requireAuth, async (req, res) => {
  const { from, to, fromISO, toISO } = getPeriodo(req);

  const [{ data: admissoes }, { data: desligados }, { count: ativos }] = await Promise.all([
    supabase.from('employees').select('id, nome_completo, data_admissao, department_id, departments(nome)')
      .gte('data_admissao', fromISO).lte('data_admissao', toISO),
    supabase.from('terminations').select('id, data_demissao, tipo_rescisao, motivo, employee_id, employees(nome_completo, department_id, data_admissao, departments(nome))')
      .gte('data_demissao', fromISO).lte('data_demissao', toISO),
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
  ]);

  const adm = admissoes || [], des = desligados || [];

  // Turnover %
  const turnoverPct = ativos > 0 ? ((adm.length + des.length) / 2 / ativos) * 100 : 0;

  // Voluntário (pedido demissão) vs Involuntário
  const voluntarios = des.filter(d => /pedido|voluntar/i.test(d.tipo_rescisao || '')).length;
  const involuntarios = des.length - voluntarios;

  // Por mês
  const porMes = {};
  const inc = (label, tipo) => { porMes[label] = porMes[label] || { mes: label, admissoes: 0, desligamentos: 0 }; porMes[label][tipo]++; };
  adm.forEach(a => inc(new Date(a.data_admissao).toISOString().slice(0, 7), 'admissoes'));
  des.forEach(d => inc(new Date(d.data_demissao).toISOString().slice(0, 7), 'desligamentos'));
  const evolucao = Object.values(porMes).sort((a, b) => a.mes.localeCompare(b.mes));

  // Top departamentos com saída
  const porDepto = {};
  des.forEach(d => {
    const dep = d.employees?.departments?.nome || '—';
    porDepto[dep] = (porDepto[dep] || 0) + 1;
  });

  // Tempo médio até saída (em meses)
  const tempos = des.map(d => {
    if (!d.employees?.data_admissao || !d.data_demissao) return null;
    return mesesEntre(d.employees.data_admissao, d.data_demissao);
  }).filter(t => t != null && t >= 0);
  const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : 0;

  res.json({
    periodo: { from: fromISO, to: toISO },
    headcount_atual: ativos || 0,
    admissoes: adm.length,
    desligamentos: des.length,
    voluntarios,
    involuntarios,
    turnover_pct: parseFloat(turnoverPct.toFixed(2)),
    tempo_medio_casa_meses: parseFloat(tempoMedio.toFixed(1)),
    evolucao_mensal: evolucao,
    desligamentos_por_depto: porDepto,
    desligamentos_detalhe: des,
    admissoes_detalhe: adm,
  });
});

/* ════════════════════════════════════════════════════════════
   3. CUSTO DE PESSOAL — folha + encargos + provisões
   ════════════════════════════════════════════════════════════ */
router.get('/payroll-cost', requireAuth, async (req, res) => {
  const { from, to, fromISO, toISO } = getPeriodo(req);

  const [{ data: emps }, { data: payslips }] = await Promise.all([
    supabase.from('employees').select('id, nome_completo, salario_base, department_id, position_id, departments(nome), positions(titulo)').eq('status', 'ativo'),
    supabase.from('payslips').select('competencia_mes, competencia_ano, total_proventos, salario_liquido, inss_valor, irrf_valor, fgts_valor, employee_id, employees(department_id, departments(nome))'),
  ]);

  // Filtra por período
  const psP = (payslips || []).filter(p => {
    const d = new Date(p.competencia_ano, p.competencia_mes - 1, 1);
    return d >= from && d <= to;
  });

  const sum = (arr, k) => arr.reduce((s, x) => s + parseFloat(x[k] || 0), 0);
  const totalBruto = sum(psP, 'total_proventos');
  const totalLiquido = sum(psP, 'salario_liquido');
  const totalINSS = sum(psP, 'inss_valor');
  const totalIRRF = sum(psP, 'irrf_valor');
  const totalFGTS = sum(psP, 'fgts_valor');

  // Encargos patronais estimados (CLT padrão sobre folha bruta)
  const inssPatronal = totalBruto * 0.20;
  const sistemaS = totalBruto * 0.058;
  const rat = totalBruto * 0.02;
  const totalEncargos = inssPatronal + sistemaS + rat + totalFGTS;
  // Provisões mensais
  const prov13 = totalBruto / 12;
  const provFerias = (totalBruto * 1.3333) / 12;
  const totalCusto = totalBruto + totalEncargos + prov13 + provFerias;

  // Custo médio por funcionário
  const ativos = emps.length;
  const custoMedio = ativos > 0 ? totalCusto / (psP.length / Math.max(1, Object.keys(groupBy(psP, p => `${p.competencia_ano}-${p.competencia_mes}`)).length)) / Math.max(1, ativos) : 0;

  // Custo por departamento
  const porDepto = {};
  psP.forEach(p => {
    const dep = p.employees?.departments?.nome || '—';
    porDepto[dep] = (porDepto[dep] || 0) + parseFloat(p.total_proventos || 0);
  });

  // Evolução mensal
  const porMes = {};
  psP.forEach(p => {
    const k = `${p.competencia_ano}-${String(p.competencia_mes).padStart(2, '0')}`;
    porMes[k] = (porMes[k] || 0) + parseFloat(p.total_proventos || 0);
  });
  const evolucao = Object.entries(porMes).sort().map(([mes, total]) => ({ mes, total }));

  // Top 10 funcionários mais caros (por salário base)
  const top = [...emps].sort((a, b) => parseFloat(b.salario_base || 0) - parseFloat(a.salario_base || 0)).slice(0, 10);

  res.json({
    periodo: { from: fromISO, to: toISO },
    total_bruto: totalBruto,
    total_liquido: totalLiquido,
    total_encargos: totalEncargos,
    detalhe_encargos: { inss_patronal: inssPatronal, sistema_s: sistemaS, rat, fgts: totalFGTS },
    provisoes: { decimo_terceiro: prov13, ferias_um_terco: provFerias },
    total_custo_real: totalCusto,
    custo_medio_funcionario: custoMedio,
    headcount: ativos,
    qtd_holerites: psP.length,
    impostos: { inss_funcionario: totalINSS, irrf: totalIRRF },
    custo_por_departamento: porDepto,
    evolucao_mensal: evolucao,
    top10_caros: top.map(e => ({
      id: e.id, nome: e.nome_completo, cargo: e.positions?.titulo,
      depto: e.departments?.nome, salario: e.salario_base,
    })),
  });
});

function groupBy(arr, fn) {
  return arr.reduce((m, x) => { const k = fn(x); (m[k] = m[k] || []).push(x); return m; }, {});
}

/* ════════════════════════════════════════════════════════════
   4. ABSENTEÍSMO — faltas, atestados, atrasos
   ════════════════════════════════════════════════════════════ */
router.get('/absenteeism', requireAuth, async (req, res) => {
  const { from, to, fromISO, toISO } = getPeriodo(req);

  const [{ data: abs }, { count: ativos }] = await Promise.all([
    supabase.from('absences').select('*, employees(nome_completo, matricula, department_id, salario_base, departments(nome))')
      .gte('data_inicio', fromISO).lte('data_inicio', toISO),
    supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
  ]);

  const lista = abs || [];
  const totalDias = lista.reduce((s, a) => s + (a.dias || 0), 0);

  // Estimativa de horas previstas no período (22 dias × 8h × headcount)
  const mesesNoPer = Math.max(1, mesesEntre(from, to) + 1);
  const horasPrevistas = ativos * 22 * 8 * mesesNoPer;
  const horasFaltadas = totalDias * 8;
  const taxaAbsent = horasPrevistas > 0 ? (horasFaltadas / horasPrevistas) * 100 : 0;

  const agg = (arr, key) => arr.reduce((m, x) => { const k = x[key] || '—'; m[k] = (m[k] || 0) + 1; return m; }, {});

  // Por tipo
  const porTipo = agg(lista, 'tipo');

  // Por departamento (total de dias)
  const porDepto = {};
  lista.forEach(a => {
    const dep = a.employees?.departments?.nome || '—';
    porDepto[dep] = (porDepto[dep] || 0) + (a.dias || 0);
  });

  // Top 10 funcionários com mais dias
  const porFunc = {};
  lista.forEach(a => {
    const id = a.employee_id;
    if (!porFunc[id]) porFunc[id] = { nome: a.employees?.nome_completo, matricula: a.employees?.matricula, dias: 0 };
    porFunc[id].dias += (a.dias || 0);
  });
  const top = Object.values(porFunc).sort((a, b) => b.dias - a.dias).slice(0, 10);

  // Sazonalidade por mês
  const porMes = {};
  lista.forEach(a => {
    const k = (a.data_inicio || '').slice(0, 7);
    porMes[k] = (porMes[k] || 0) + (a.dias || 0);
  });
  const sazonalidade = Object.entries(porMes).sort().map(([mes, dias]) => ({ mes, dias }));

  // Custo das faltas (apenas as descontadas — estimativa)
  const custoFaltas = lista.reduce((s, a) => {
    if (a.descontar_salario && a.employees?.salario_base) {
      return s + (parseFloat(a.employees.salario_base) / 30) * (a.dias || 0);
    }
    return s;
  }, 0);

  res.json({
    periodo: { from: fromISO, to: toISO },
    total_ocorrencias: lista.length,
    total_dias: totalDias,
    taxa_absenteismo_pct: parseFloat(taxaAbsent.toFixed(2)),
    custo_faltas_descontadas: custoFaltas,
    por_tipo: porTipo,
    por_departamento: porDepto,
    top10_funcionarios: top,
    sazonalidade_mensal: sazonalidade,
  });
});

/* ════════════════════════════════════════════════════════════
   5. HORAS EXTRAS — HE50, HE100, custo
   ════════════════════════════════════════════════════════════ */
router.get('/overtime', requireAuth, async (req, res) => {
  const { from, to, fromISO, toISO } = getPeriodo(req);

  const { data: entries } = await supabase.from('time_entries')
    .select('*, employees(nome_completo, matricula, salario_base, department_id, departments(nome))')
    .gte('data', fromISO).lte('data', toISO);

  const lista = entries || [];
  const horas = lista.reduce((s, e) => {
    s.he50 += parseFloat(e.he50_horas || e.he_50 || 0);
    s.he100 += parseFloat(e.he100_horas || e.he_100 || 0);
    return s;
  }, { he50: 0, he100: 0 });

  // Custo HE (aprox: salário/220 × 1.5 / 2.0)
  let custoHE = 0;
  const porFunc = {};
  lista.forEach(e => {
    const sb = parseFloat(e.employees?.salario_base || 0);
    if (sb > 0) {
      const valorHora = sb / 220;
      const he50 = parseFloat(e.he50_horas || e.he_50 || 0);
      const he100 = parseFloat(e.he100_horas || e.he_100 || 0);
      const custo = he50 * valorHora * 1.5 + he100 * valorHora * 2;
      custoHE += custo;
      const id = e.employee_id;
      if (!porFunc[id]) porFunc[id] = { nome: e.employees?.nome_completo, matricula: e.employees?.matricula, he50: 0, he100: 0, custo: 0 };
      porFunc[id].he50 += he50;
      porFunc[id].he100 += he100;
      porFunc[id].custo += custo;
    }
  });

  const top = Object.values(porFunc).sort((a, b) => b.custo - a.custo).slice(0, 10);

  const porDepto = {};
  Object.values(porFunc).forEach(f => {});
  lista.forEach(e => {
    const dep = e.employees?.departments?.nome || '—';
    porDepto[dep] = (porDepto[dep] || 0) + parseFloat(e.he50_horas || 0) + parseFloat(e.he100_horas || 0);
  });

  res.json({
    periodo: { from: fromISO, to: toISO },
    total_he50: parseFloat(horas.he50.toFixed(2)),
    total_he100: parseFloat(horas.he100.toFixed(2)),
    total_horas: parseFloat((horas.he50 + horas.he100).toFixed(2)),
    custo_total: custoHE,
    top10_funcionarios: top,
    por_departamento: porDepto,
  });
});

/* ════════════════════════════════════════════════════════════
   6. FÉRIAS — vencidas, vencendo, saldo
   ════════════════════════════════════════════════════════════ */
router.get('/vacation-alerts', requireAuth, async (req, res) => {
  const hoje = new Date();
  const em30 = new Date(hoje); em30.setDate(em30.getDate() + 30);
  const em60 = new Date(hoje); em60.setDate(em60.getDate() + 60);

  const { data: emps } = await supabase.from('employees')
    .select('id, nome_completo, matricula, data_admissao, salario_base, departments(nome)')
    .eq('status', 'ativo');

  const vencidas = [], vence30 = [], vence60 = [];
  let passivoTotal = 0;

  for (const e of emps || []) {
    if (!e.data_admissao) continue;
    // Calcula próximo vencimento de período aquisitivo
    const adm = new Date(e.data_admissao);
    const anos = hoje.getFullYear() - adm.getFullYear();
    // Período aquisitivo termina sempre na mesma data de admissão (anualmente)
    let proxVenc = new Date(adm); proxVenc.setFullYear(adm.getFullYear() + anos);
    if (proxVenc < hoje) proxVenc.setFullYear(proxVenc.getFullYear() + 1);
    const diasAteVenc = Math.floor((proxVenc - hoje) / 86400000);

    // Provisão de férias (passivo trabalhista)
    const provisaoFunc = parseFloat(e.salario_base || 0) * 1.3333;
    passivoTotal += provisaoFunc;

    const ent = { id: e.id, nome: e.nome_completo, matricula: e.matricula, depto: e.departments?.nome,
                  data_admissao: e.data_admissao, prox_vencimento: proxVenc.toISOString().slice(0,10),
                  dias_ate_vencimento: diasAteVenc, provisao: provisaoFunc };

    // Vencida: o aquisitivo passou + 12 meses concessivo já encerrou
    const aquisitivoTerminou = new Date(adm); aquisitivoTerminou.setFullYear(adm.getFullYear() + anos);
    const concessivoTerminou = new Date(aquisitivoTerminou); concessivoTerminou.setFullYear(concessivoTerminou.getFullYear() + 1);
    if (concessivoTerminou < hoje) vencidas.push(ent);
    else if (proxVenc <= em30) vence30.push(ent);
    else if (proxVenc <= em60) vence60.push(ent);
  }

  res.json({
    vencidas_count: vencidas.length,
    vencidas,
    vence_30dias: vence30,
    vence_60dias: vence60,
    passivo_trabalhista_estimado: passivoTotal,
  });
});

/* ════════════════════════════════════════════════════════════
   7. DATAS-CHAVE — aniversários, empresa, experiência
   ════════════════════════════════════════════════════════════ */
router.get('/key-dates', requireAuth, async (req, res) => {
  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const em45 = new Date(hoje); em45.setDate(em45.getDate() + 45);

  const { data: emps } = await supabase.from('employees')
    .select('id, nome_completo, matricula, data_admissao, data_nascimento, foto_url, departments(nome)')
    .eq('status', 'ativo');

  const aniversariantes_mes = [], aniversarios_empresa = [], experiencia_45 = [], experiencia_90 = [];

  (emps || []).forEach(e => {
    // Aniversário pessoal
    if (e.data_nascimento) {
      const d = new Date(e.data_nascimento);
      if (d.getMonth() + 1 === mesAtual) {
        aniversariantes_mes.push({ ...e, dia: d.getDate(), idade: idade(e.data_nascimento) });
      }
    }
    // Aniversário de empresa
    if (e.data_admissao) {
      const a = new Date(e.data_admissao);
      if (a.getMonth() + 1 === mesAtual) {
        const anos = hoje.getFullYear() - a.getFullYear();
        if (anos > 0) aniversarios_empresa.push({ ...e, dia: a.getDate(), anos });
      }
      // Contrato de experiência: 45 dias (1ª etapa) e 90 dias (efetivação)
      const exp45 = new Date(a); exp45.setDate(a.getDate() + 45);
      const exp90 = new Date(a); exp90.setDate(a.getDate() + 90);
      if (exp45 >= hoje && exp45 <= em45) experiencia_45.push({ ...e, data_evento: exp45.toISOString().slice(0,10), etapa: '1ª etapa (45d)' });
      if (exp90 >= hoje && exp90 <= em45) experiencia_90.push({ ...e, data_evento: exp90.toISOString().slice(0,10), etapa: 'Efetivação (90d)' });
    }
  });

  aniversariantes_mes.sort((a, b) => a.dia - b.dia);
  aniversarios_empresa.sort((a, b) => a.dia - b.dia);

  res.json({
    mes: mesAtual,
    aniversariantes_mes,
    aniversarios_empresa,
    contratos_experiencia: [...experiencia_45, ...experiencia_90].sort((a, b) => a.data_evento.localeCompare(b.data_evento)),
  });
});

/* ════════════════════════════════════════════════════════════
   8. DISTRIBUIÇÃO SALARIAL — equidade e fora-da-faixa
   ════════════════════════════════════════════════════════════ */
router.get('/salary-distribution', requireAuth, async (req, res) => {
  const { data: emps } = await supabase.from('employees')
    .select('id, nome_completo, matricula, sexo, salario_base, position_id, department_id, positions(titulo, salario_minimo, salario_maximo), departments(nome)')
    .eq('status', 'ativo');

  const lista = (emps || []).filter(e => e.salario_base);

  // Por cargo
  const porCargo = {};
  lista.forEach(e => {
    const cargo = e.positions?.titulo || '—';
    if (!porCargo[cargo]) porCargo[cargo] = {
      cargo, qtd: 0, salarios: [], min_faixa: e.positions?.salario_minimo, max_faixa: e.positions?.salario_maximo,
      fora_faixa: [],
    };
    const sb = parseFloat(e.salario_base);
    porCargo[cargo].salarios.push(sb);
    porCargo[cargo].qtd++;
    if (e.positions?.salario_minimo && sb < parseFloat(e.positions.salario_minimo)) {
      porCargo[cargo].fora_faixa.push({ nome: e.nome_completo, salario: sb, lado: 'abaixo do mínimo' });
    } else if (e.positions?.salario_maximo && sb > parseFloat(e.positions.salario_maximo)) {
      porCargo[cargo].fora_faixa.push({ nome: e.nome_completo, salario: sb, lado: 'acima do máximo' });
    }
  });

  const stats = (arr) => {
    if (!arr.length) return { min: 0, max: 0, media: 0, mediana: 0 };
    const s = [...arr].sort((a, b) => a - b);
    const media = s.reduce((a, b) => a + b, 0) / s.length;
    const mediana = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
    return { min: s[0], max: s[s.length - 1], media, mediana };
  };

  const tabela = Object.values(porCargo).map(c => ({
    cargo: c.cargo, qtd: c.qtd,
    min_faixa: c.min_faixa, max_faixa: c.max_faixa,
    ...stats(c.salarios),
    fora_faixa: c.fora_faixa,
  })).sort((a, b) => b.media - a.media);

  // Gap salarial por gênero (no mesmo cargo)
  const gap = [];
  Object.values(porCargo).forEach(c => {
    if (c.qtd < 2) return;
    const homens = lista.filter(e => e.positions?.titulo === c.cargo && /m/i.test(e.sexo)).map(e => parseFloat(e.salario_base));
    const mulheres = lista.filter(e => e.positions?.titulo === c.cargo && /f/i.test(e.sexo)).map(e => parseFloat(e.salario_base));
    if (homens.length && mulheres.length) {
      const mH = homens.reduce((a, b) => a + b, 0) / homens.length;
      const mM = mulheres.reduce((a, b) => a + b, 0) / mulheres.length;
      const dif = mH - mM;
      gap.push({
        cargo: c.cargo,
        media_h: mH, media_m: mM, diferenca: dif,
        pct: mH > 0 ? (dif / mH) * 100 : 0,
        qtd_h: homens.length, qtd_m: mulheres.length,
      });
    }
  });

  res.json({
    tabela_por_cargo: tabela,
    fora_da_faixa: tabela.flatMap(t => t.fora_faixa.map(f => ({ ...f, cargo: t.cargo }))),
    gap_genero: gap.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)),
  });
});

/* ════════════════════════════════════════════════════════════
   9. AVALIAÇÃO — consolidado
   ════════════════════════════════════════════════════════════ */
router.get('/performance-summary', requireAuth, async (req, res) => {
  const { cycle_id } = req.query;
  let q = supabase.from('performance_evaluations')
    .select('nota_final, status, employee_id, cycle_id, employees(nome_completo, matricula, salario_base, data_admissao, departments(nome), positions(titulo))');
  if (cycle_id) q = q.eq('cycle_id', cycle_id);
  const { data: evals } = await q;

  const lista = (evals || []).filter(e => e.nota_final != null);

  const media_geral = lista.length ? lista.reduce((s, e) => s + parseFloat(e.nota_final), 0) / lista.length : 0;

  // Por departamento
  const porDepto = {};
  lista.forEach(e => {
    const dep = e.employees?.departments?.nome || '—';
    if (!porDepto[dep]) porDepto[dep] = { dep, notas: [] };
    porDepto[dep].notas.push(parseFloat(e.nota_final));
  });
  const rankingDepto = Object.values(porDepto).map(d => ({
    departamento: d.dep, qtd: d.notas.length,
    media: d.notas.reduce((a, b) => a + b, 0) / d.notas.length,
  })).sort((a, b) => b.media - a.media);

  // Distribuição (faixas)
  const distribuicao = { '0-1.9': 0, '2-2.9': 0, '3-3.9': 0, '4-4.9': 0, '5': 0 };
  lista.forEach(e => {
    const n = parseFloat(e.nota_final);
    if (n < 2) distribuicao['0-1.9']++;
    else if (n < 3) distribuicao['2-2.9']++;
    else if (n < 4) distribuicao['3-3.9']++;
    else if (n < 5) distribuicao['4-4.9']++;
    else distribuicao['5']++;
  });

  const ord = [...lista].sort((a, b) => parseFloat(b.nota_final) - parseFloat(a.nota_final));
  const top_performers = ord.filter(e => parseFloat(e.nota_final) >= 4).slice(0, 10).map(e => ({
    nome: e.employees?.nome_completo, cargo: e.employees?.positions?.titulo, depto: e.employees?.departments?.nome, nota: e.nota_final,
  }));
  const low_performers = ord.filter(e => parseFloat(e.nota_final) <= 2).reverse().slice(0, 10).map(e => ({
    nome: e.employees?.nome_completo, cargo: e.employees?.positions?.titulo, depto: e.employees?.departments?.nome, nota: e.nota_final,
  }));

  res.json({
    total_avaliacoes: lista.length,
    media_geral: parseFloat(media_geral.toFixed(2)),
    ranking_por_departamento: rankingDepto,
    distribuicao,
    top_performers,
    low_performers,
  });
});

/* ════════════════════════════════════════════════════════════
   10. RECRUTAMENTO — funil
   ════════════════════════════════════════════════════════════ */
router.get('/recruitment-funnel', requireAuth, async (req, res) => {
  const { from, to, fromISO, toISO } = getPeriodo(req);

  const [{ data: vagas }, { data: cands }] = await Promise.all([
    supabase.from('job_openings').select('*'),
    supabase.from('candidates').select('*'),
  ]);

  const vagasPer = (vagas || []).filter(v => {
    const d = new Date(v.data_abertura || v.created_at);
    return d >= from && d <= to;
  });

  // Funil
  const STATUS = ['triagem','entrevista','teste_tecnico','proposta','contratado','reprovado','desistiu'];
  const funil = {};
  STATUS.forEach(s => { funil[s] = 0; });
  (cands || []).forEach(c => { if (funil[c.status] != null) funil[c.status]++; });

  const totalProcesso = Object.values(funil).reduce((a, b) => a + b, 0);
  const contratados = funil.contratado || 0;
  const reprovados = (funil.reprovado || 0) + (funil.desistiu || 0);

  // Taxa de aceitação proposta → contratado
  const taxaAceitacao = (funil.proposta + contratados) > 0
    ? (contratados / (funil.proposta + contratados)) * 100 : 0;

  // Tempo médio de fechamento
  const fechadas = vagasPer.filter(v => v.data_fechamento);
  const tempos = fechadas.map(v => Math.floor((new Date(v.data_fechamento) - new Date(v.data_abertura)) / 86400000));
  const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : 0;

  // Origem dos contratados
  const origens = {};
  (cands || []).filter(c => c.status === 'contratado').forEach(c => {
    origens[c.origem || '—'] = (origens[c.origem || '—'] || 0) + 1;
  });

  res.json({
    periodo: { from: fromISO, to: toISO },
    vagas_abertas: vagasPer.filter(v => v.status === 'aberta').length,
    vagas_preenchidas: vagasPer.filter(v => v.status === 'preenchida').length,
    vagas_encerradas: vagasPer.filter(v => v.status === 'encerrada').length,
    total_candidatos: (cands || []).length,
    funil,
    contratados,
    reprovados_desistiram: reprovados,
    taxa_aceitacao_proposta_pct: parseFloat(taxaAceitacao.toFixed(1)),
    tempo_medio_fechamento_dias: parseFloat(tempoMedio.toFixed(1)),
    origens,
  });
});

module.exports = router;
