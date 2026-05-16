/**
 * Motor de Cálculo CLT — Tabelas tributárias multi-ano
 *
 * Para atualizar quando o Governo publicar uma nova tabela:
 * 1. Adicione um novo ano em TABELAS_TRIBUTARIAS abaixo
 * 2. O sistema usa automaticamente a tabela do ano da competência do holerite
 *
 * Fontes oficiais:
 *  - INSS: Portaria Interministerial MPS/MF (jan/ano)
 *  - IRRF: Lei 14.848/2024 e Receita Federal
 *  - FGTS: Lei 8.036/1990 (8% — não muda)
 *  - Salário-família: Portaria INSS anual
 */

const TABELAS_TRIBUTARIAS = {
  2025: {
    salario_minimo: 1518.00,
    inss_faixas: [
      { ate: 1518.00, aliquota: 0.075 },
      { ate: 2793.88, aliquota: 0.090 },
      { ate: 4190.83, aliquota: 0.120 },
      { ate: 8157.41, aliquota: 0.140 },
    ],
    inss_teto: 8157.41,
    inss_max: 951.62,
    irrf_faixas: [
      { ate: 2259.20, aliquota: 0,     deducao: 0      },
      { ate: 2826.65, aliquota: 0.075, deducao: 169.44 },
      { ate: 3751.05, aliquota: 0.150, deducao: 381.44 },
      { ate: 4664.68, aliquota: 0.225, deducao: 662.77 },
      { ate: Infinity, aliquota: 0.275, deducao: 896.00 },
    ],
    deducao_dependente: 189.59,
    sf_teto: 1819.26,
    sf_valor_filho: 62.04,
  },
  2026: {
    salario_minimo: 1564.18,
    inss_faixas: [
      { ate: 1564.18, aliquota: 0.075 },
      { ate: 2879.00, aliquota: 0.090 },
      { ate: 4319.00, aliquota: 0.120 },
      { ate: 8406.21, aliquota: 0.140 },
    ],
    inss_teto: 8406.21,
    inss_max: 980.72,
    irrf_faixas: [
      { ate: 2428.80, aliquota: 0,     deducao: 0      },
      { ate: 2985.00, aliquota: 0.075, deducao: 182.16 },
      { ate: 3961.00, aliquota: 0.150, deducao: 410.03 },
      { ate: 4927.68, aliquota: 0.225, deducao: 707.20 },
      { ate: Infinity, aliquota: 0.275, deducao: 953.55 },
    ],
    deducao_dependente: 200.00,
    sf_teto: 1906.04,
    sf_valor_filho: 65.00,
  },
};

const ANO_PADRAO = new Date().getFullYear();

function getTabela(ano = ANO_PADRAO) {
  if (TABELAS_TRIBUTARIAS[ano]) return TABELAS_TRIBUTARIAS[ano];
  const anos = Object.keys(TABELAS_TRIBUTARIAS).map(Number).sort();
  return TABELAS_TRIBUTARIAS[anos[anos.length - 1]];
}

function calcularHorasMensais(h = 44) { return Math.round((h * 52) / 12); }

function calcularINSS(bruto, ano = ANO_PADRAO) {
  if (bruto <= 0) return 0;
  const t = getTabela(ano);
  const base = Math.min(bruto, t.inss_teto);
  let inss = 0, anterior = 0;
  for (const f of t.inss_faixas) {
    if (base <= anterior) break;
    inss += (Math.min(base, f.ate) - anterior) * f.aliquota;
    anterior = f.ate;
  }
  return Math.min(parseFloat(inss.toFixed(2)), t.inss_max);
}

function calcularIRRF(bruto, inss, deps = 0, ano = ANO_PADRAO) {
  const t = getTabela(ano);
  const base = bruto - inss - (deps * t.deducao_dependente);
  if (base <= 0) return { irrf: 0, baseIRRF: 0, faixa: 0, aliquota: 0 };
  let irrf = 0, aliq = 0, idx = 0;
  for (let i = 0; i < t.irrf_faixas.length; i++) {
    const f = t.irrf_faixas[i];
    if (base <= f.ate) { irrf = base * f.aliquota - f.deducao; aliq = f.aliquota; idx = i + 1; break; }
  }
  return {
    irrf: Math.max(parseFloat(irrf.toFixed(2)), 0),
    baseIRRF: parseFloat(base.toFixed(2)),
    faixa: idx, aliquota: aliq,
  };
}

function calcularFGTS(bruto, tipo = 'clt') {
  return parseFloat((bruto * (tipo === 'aprendiz' ? 0.02 : 0.08)).toFixed(2));
}

function calcularDescontoVT(salBase, valorDia, dias = 22, tem = false) {
  if (!tem || valorDia <= 0) return { desconto: 0, totalVT: 0, custo_empresa: 0 };
  const total = parseFloat((valorDia * dias).toFixed(2));
  const limite = parseFloat((salBase * 0.06).toFixed(2));
  const desc = Math.min(total, limite);
  return { desconto: parseFloat(desc.toFixed(2)), totalVT: total, custo_empresa: parseFloat((total - desc).toFixed(2)) };
}

function calcularHorasExtras(salBase, ch, h50 = 0, h100 = 0) {
  const hm = calcularHorasMensais(ch);
  const vh = parseFloat((salBase / hm).toFixed(6));
  return {
    valorHora: parseFloat(vh.toFixed(4)),
    he50: parseFloat((h50 * vh * 1.5).toFixed(2)),
    he100: parseFloat((h100 * vh * 2.0).toFixed(2)),
  };
}

function calcularAdicionalNoturno(salBase, ch, hn = 0) {
  if (hn <= 0) return 0;
  const hm = calcularHorasMensais(ch);
  return parseFloat((hn * (salBase / hm) * 0.20).toFixed(2));
}

function calcularProporcional(salBase, dias, total = 30) {
  if (dias >= total) return salBase;
  return parseFloat(((salBase / total) * dias).toFixed(2));
}

function calcularDescontoFaltas(salBase, n, dias = 30) {
  if (n <= 0) return { total: 0, valorDia: 0 };
  const vd = parseFloat((salBase / dias).toFixed(6));
  return { total: parseFloat((vd * n).toFixed(2)), valorDia: parseFloat(vd.toFixed(4)) };
}

function calcularSalarioFamilia(bruto, filhos = 0, ano = ANO_PADRAO) {
  if (filhos <= 0) return 0;
  const t = getTabela(ano);
  if (bruto > t.sf_teto) return 0;
  return parseFloat((filhos * t.sf_valor_filho).toFixed(2));
}

function calcularHolerite(emp, lanc = {}, ano = ANO_PADRAO) {
  const {
    salario_base, carga_horaria_semanal = 44, tipo_contrato = 'clt', num_dependentes = 0,
    tem_vt = false, vt_valor_dia = 0, vt_dias_uteis = 22,
    tem_vr = false, vr_valor_dia = 0, vr_dias_uteis = 22,
    tem_va = false, va_valor_mes = 0,
    tem_plano_saude = false, plano_saude_valor = 0,
    tem_plano_odonto = false, plano_odonto_valor = 0,
    tem_seguro_vida = false, seguro_vida_valor = 0,
    num_filhos_salario_familia = 0,
  } = emp;

  const {
    dias_trabalhados = 30, horas_extras_50 = 0, horas_extras_100 = 0,
    adicional_noturno_horas = 0, adicional_insalubridade = 0, adicional_periculosidade = 0,
    comissoes = 0, bonus = 0, gratificacao = 0, decimo_terceiro = 0,
    ferias_valor = 0, ferias_um_terco = 0, outros_proventos = 0, outros_proventos_desc = '',
    pensao_alimenticia = 0, adiantamento = 0, faltas_dias = 0,
    outros_descontos = 0, outros_descontos_desc = '',
    data_pagamento = null, observacoes = '',
  } = lanc;

  const sb = parseFloat(salario_base);
  const salProp = calcularProporcional(sb, dias_trabalhados);
  const he = calcularHorasExtras(sb, carga_horaria_semanal, horas_extras_50, horas_extras_100);
  const adNot = calcularAdicionalNoturno(sb, carga_horaria_semanal, adicional_noturno_horas);
  const vrVal = tem_vr ? parseFloat((vr_valor_dia * vr_dias_uteis).toFixed(2)) : 0;
  const vaVal = tem_va ? parseFloat(parseFloat(va_valor_mes).toFixed(2)) : 0;

  const baseINSS = parseFloat((
    salProp + he.he50 + he.he100 + adNot +
    parseFloat(adicional_insalubridade) + parseFloat(adicional_periculosidade) + parseFloat(comissoes)
  ).toFixed(2));

  const inss = tipo_contrato === 'pj' ? 0 : calcularINSS(baseINSS, ano);
  const irr = tipo_contrato === 'pj' ? { irrf: 0, baseIRRF: 0, faixa: 0, aliquota: 0 } : calcularIRRF(baseINSS, inss, num_dependentes, ano);
  const fgts = calcularFGTS(baseINSS, tipo_contrato);
  const sf = calcularSalarioFamilia(baseINSS, num_filhos_salario_familia, ano);
  const vt = calcularDescontoVT(sb, vt_valor_dia, vt_dias_uteis, tem_vt);
  const fl = calcularDescontoFaltas(sb, faltas_dias);

  const psd = tem_plano_saude  ? parseFloat(parseFloat(plano_saude_valor).toFixed(2))  : 0;
  const pod = tem_plano_odonto ? parseFloat(parseFloat(plano_odonto_valor).toFixed(2)) : 0;
  const svd = tem_seguro_vida  ? parseFloat(parseFloat(seguro_vida_valor).toFixed(2))  : 0;

  const totProv = parseFloat((
    salProp + he.he50 + he.he100 + adNot +
    parseFloat(adicional_insalubridade) + parseFloat(adicional_periculosidade) +
    parseFloat(comissoes) + parseFloat(bonus) + parseFloat(gratificacao) +
    parseFloat(decimo_terceiro) + parseFloat(ferias_valor) + parseFloat(ferias_um_terco) +
    parseFloat(outros_proventos) + sf + vrVal + vaVal
  ).toFixed(2));

  const totDesc = parseFloat((
    inss + irr.irrf + vt.desconto + psd + pod + svd +
    parseFloat(pensao_alimenticia) + parseFloat(adiantamento) +
    fl.total + parseFloat(outros_descontos)
  ).toFixed(2));

  const liquido = parseFloat((totProv - totDesc).toFixed(2));

  // Lançamentos para o PDF (formato tradicional)
  const lancs = [];
  lancs.push({ codigo: '101', descricao: 'SALARIO', referencia: `${dias_trabalhados} d`, vencimento: salProp, desconto: 0 });
  if (he.he50 > 0) lancs.push({ codigo: '102', descricao: 'HORAS EXTRAS 50%', referencia: `${horas_extras_50} h`, vencimento: he.he50, desconto: 0 });
  if (he.he100 > 0) lancs.push({ codigo: '103', descricao: 'HORAS EXTRAS 100%', referencia: `${horas_extras_100} h`, vencimento: he.he100, desconto: 0 });
  if (adNot > 0) lancs.push({ codigo: '104', descricao: 'ADICIONAL NOTURNO', referencia: `${adicional_noturno_horas} h`, vencimento: adNot, desconto: 0 });
  if (parseFloat(adicional_insalubridade) > 0) lancs.push({ codigo: '105', descricao: 'INSALUBRIDADE', referencia: '', vencimento: parseFloat(adicional_insalubridade), desconto: 0 });
  if (parseFloat(adicional_periculosidade) > 0) lancs.push({ codigo: '106', descricao: 'PERICULOSIDADE', referencia: '', vencimento: parseFloat(adicional_periculosidade), desconto: 0 });
  if (parseFloat(comissoes) > 0) lancs.push({ codigo: '107', descricao: 'COMISSOES', referencia: '', vencimento: parseFloat(comissoes), desconto: 0 });
  if (parseFloat(bonus) > 0) lancs.push({ codigo: '108', descricao: 'BONIFICACAO', referencia: '', vencimento: parseFloat(bonus), desconto: 0 });
  if (parseFloat(gratificacao) > 0) lancs.push({ codigo: '109', descricao: 'GRATIFICACAO', referencia: '', vencimento: parseFloat(gratificacao), desconto: 0 });
  if (parseFloat(decimo_terceiro) > 0) lancs.push({ codigo: '110', descricao: '13o SALARIO', referencia: '', vencimento: parseFloat(decimo_terceiro), desconto: 0 });
  if (parseFloat(ferias_valor) > 0) lancs.push({ codigo: '111', descricao: 'FERIAS', referencia: '', vencimento: parseFloat(ferias_valor), desconto: 0 });
  if (parseFloat(ferias_um_terco) > 0) lancs.push({ codigo: '112', descricao: '1/3 FERIAS', referencia: '', vencimento: parseFloat(ferias_um_terco), desconto: 0 });
  if (sf > 0) lancs.push({ codigo: '650', descricao: 'SALARIO FAMILIA', referencia: `${num_filhos_salario_familia} filho(s)`, vencimento: sf, desconto: 0 });
  if (vrVal > 0) lancs.push({ codigo: '120', descricao: 'VALE REFEICAO', referencia: `${vr_dias_uteis} d`, vencimento: vrVal, desconto: 0 });
  if (vaVal > 0) lancs.push({ codigo: '121', descricao: 'VALE ALIMENTACAO', referencia: '', vencimento: vaVal, desconto: 0 });
  if (parseFloat(outros_proventos) > 0) lancs.push({ codigo: '199', descricao: (outros_proventos_desc || 'OUTROS PROVENTOS').toUpperCase(), referencia: '', vencimento: parseFloat(outros_proventos), desconto: 0 });

  if (inss > 0) lancs.push({ codigo: '973', descricao: 'INSS', referencia: `${((inss / baseINSS) * 100).toFixed(2)}%`, vencimento: 0, desconto: inss });
  if (irr.irrf > 0) lancs.push({ codigo: '987', descricao: 'IRRF S.SALARIO', referencia: `${(irr.aliquota * 100).toFixed(2)}%`, vencimento: 0, desconto: irr.irrf });
  if (vt.desconto > 0) lancs.push({ codigo: '930', descricao: 'VALE TRANSPORTE', referencia: `${vt_dias_uteis} d`, vencimento: 0, desconto: vt.desconto });
  if (psd > 0) lancs.push({ codigo: '940', descricao: 'PLANO DE SAUDE', referencia: '', vencimento: 0, desconto: psd });
  if (pod > 0) lancs.push({ codigo: '941', descricao: 'PLANO ODONTO', referencia: '', vencimento: 0, desconto: pod });
  if (svd > 0) lancs.push({ codigo: '942', descricao: 'SEGURO DE VIDA', referencia: '', vencimento: 0, desconto: svd });
  if (parseFloat(pensao_alimenticia) > 0) lancs.push({ codigo: '910', descricao: 'PENSAO ALIMENTICIA', referencia: '', vencimento: 0, desconto: parseFloat(pensao_alimenticia) });
  if (parseFloat(adiantamento) > 0) lancs.push({ codigo: '901', descricao: 'ADIANTAMENTO', referencia: '', vencimento: 0, desconto: parseFloat(adiantamento) });
  if (fl.total > 0) lancs.push({ codigo: '902', descricao: 'FALTAS', referencia: `${faltas_dias} d`, vencimento: 0, desconto: fl.total });
  if (parseFloat(outros_descontos) > 0) lancs.push({ codigo: '999', descricao: (outros_descontos_desc || 'OUTROS DESCONTOS').toUpperCase(), referencia: '', vencimento: 0, desconto: parseFloat(outros_descontos) });

  return {
    lancamentos_detalhados: lancs,
    salario_base: salProp, dias_trabalhados,
    horas_extras_50, horas_extras_100,
    valor_horas_extras_50: he.he50, valor_horas_extras_100: he.he100,
    adicional_noturno_horas, valor_adicional_noturno: adNot,
    adicional_insalubridade: parseFloat(adicional_insalubridade),
    adicional_periculosidade: parseFloat(adicional_periculosidade),
    comissoes: parseFloat(comissoes), bonus: parseFloat(bonus),
    gratificacao: parseFloat(gratificacao), decimo_terceiro: parseFloat(decimo_terceiro),
    ferias_valor: parseFloat(ferias_valor), ferias_um_terco: parseFloat(ferias_um_terco),
    outros_proventos: parseFloat(outros_proventos), outros_proventos_desc,
    salario_familia: sf, vr_valor: vrVal, va_valor: vaVal,
    total_proventos: totProv,
    inss_valor: inss, irrf_valor: irr.irrf, fgts_valor: fgts,
    vt_desconto: vt.desconto, plano_saude_desconto: psd,
    plano_odonto_desconto: pod, seguro_vida_desconto: svd,
    pensao_alimenticia: parseFloat(pensao_alimenticia),
    adiantamento: parseFloat(adiantamento), faltas_dias,
    faltas_valor: fl.total, outros_descontos: parseFloat(outros_descontos), outros_descontos_desc,
    total_descontos: totDesc, salario_liquido: liquido,
    base_inss: baseINSS, base_irrf: irr.baseIRRF,
    faixa_irrf: irr.faixa, num_dependentes,
    valor_hora: he.valorHora,
    vt_total_mes: vt.totalVT, vt_custo_empresa: vt.custo_empresa,
    data_pagamento, observacoes, status: 'gerado',
    ano_tabela: ano,
  };
}

module.exports = {
  calcularHolerite, calcularINSS, calcularIRRF, calcularFGTS,
  calcularHorasExtras, calcularAdicionalNoturno, calcularDescontoVT,
  calcularDescontoFaltas, calcularProporcional, calcularHorasMensais,
  calcularSalarioFamilia, getTabela, TABELAS_TRIBUTARIAS,
};
