/**
 * Calculadora de Rescisão de Contrato de Trabalho (TRCT)
 *
 * Regras gerais (CLT):
 *  - Saldo de salário: salário ÷ 30 × dias trabalhados no mês da demissão
 *  - Aviso prévio: mínimo 30 dias + 3 dias por ano completo na empresa (máx 90 dias)
 *  - Aviso indenizado: empresa paga + projeção para férias proporc. e 13º
 *  - Férias vencidas: 1 salário + 1/3 (se houver período aquisitivo não gozado)
 *  - Férias proporcionais: salário ÷ 12 × meses trabalhados desde último período + 1/3
 *  - 13º proporcional: salário ÷ 12 × meses trabalhados no ano
 *  - Multa FGTS 40%: incide sobre TODO o saldo de FGTS (acumulado + depósitos da rescisão)
 *
 * Direitos por tipo de rescisão:
 *  TIPO                              SALDO  AV.PRÉ  13º   FÉR.VENC  FÉR.PROP  MULTA40
 *  sem_justa_causa_empregador         ✓      ✓       ✓     ✓         ✓         ✓
 *  pedido_demissao                    ✓      —       ✓     ✓         ✓         —
 *  justa_causa                        ✓      —       —     ✓         —         —
 *  comum_acordo                       ✓      50%     ✓     ✓         ✓         20% (multa)
 *  termino_contrato_experiencia       ✓      —       ✓     ✓         ✓         —
 *  termino_contrato_determinado       ✓      —       ✓     ✓         ✓         —
 *  aposentadoria                      ✓      —       ✓     ✓         ✓         —
 *  falecimento                        ✓      —       ✓     ✓         ✓         —
 */

const { calcularINSS, calcularIRRF } = require('./payroll');

/* Quais verbas o tipo de rescisão garante */
const DIREITOS = {
  sem_justa_causa_empregador:    { aviso: 1.0, decimo: true,  vencidas: true,  proporcionais: true,  multa: 0.40 },
  pedido_demissao:               { aviso: 0,   decimo: true,  vencidas: true,  proporcionais: true,  multa: 0 },
  justa_causa:                   { aviso: 0,   decimo: false, vencidas: true,  proporcionais: false, multa: 0 },
  comum_acordo:                  { aviso: 0.5, decimo: true,  vencidas: true,  proporcionais: true,  multa: 0.20 },
  termino_contrato_experiencia:  { aviso: 0,   decimo: true,  vencidas: true,  proporcionais: true,  multa: 0 },
  termino_contrato_determinado:  { aviso: 0,   decimo: true,  vencidas: true,  proporcionais: true,  multa: 0 },
  aposentadoria:                 { aviso: 0,   decimo: true,  vencidas: true,  proporcionais: true,  multa: 0 },
  falecimento:                   { aviso: 0,   decimo: true,  vencidas: true,  proporcionais: true,  multa: 0 },
};

function diffMeses(de, ate) {
  const a = new Date(de), b = new Date(ate);
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() >= 15) m += 1; // mês "trabalhado" se >= 15 dias
  return Math.max(0, m);
}

function diffAnos(de, ate) {
  const a = new Date(de), b = new Date(ate);
  let anos = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) anos--;
  return Math.max(0, anos);
}

function diasAvisoPrevio(dataAdmissao, dataDemissao) {
  const anos = diffAnos(dataAdmissao, dataDemissao);
  return Math.min(90, 30 + (anos * 3));
}

/**
 * Calcula tudo da rescisão.
 * @param {object} employee — registro do funcionário
 * @param {object} params — { tipo_rescisao, data_demissao, aviso_previo_tipo, saldo_fgts_acumulado, outros... }
 */
function calcularRescisao(employee, params) {
  const dir = DIREITOS[params.tipo_rescisao];
  if (!dir) throw new Error(`Tipo de rescisão inválido: ${params.tipo_rescisao}`);

  const salario = parseFloat(employee.salario_base);
  const ano = parseInt(String(params.data_demissao).slice(0, 4));
  const dataAdm = employee.data_admissao;
  const dataDem = params.data_demissao;
  const numDeps = parseInt(employee.num_dependentes || 0);

  // ── Saldo de salário ──────────────────────────────────
  const diaDemissao = new Date(dataDem).getDate();
  const saldoSalario = parseFloat((salario / 30 * diaDemissao).toFixed(2));

  // ── Aviso prévio ──────────────────────────────────────
  const diasAviso = diasAvisoPrevio(dataAdm, dataDem);
  let avisoIndenizado = 0;
  let dataProjecao = new Date(dataDem);
  if (dir.aviso > 0) {
    if (params.aviso_previo_tipo === 'indenizado') {
      avisoIndenizado = parseFloat((salario / 30 * diasAviso * dir.aviso).toFixed(2));
      // Projeção: prorroga a data fictícia pra cálculos proporcionais
      dataProjecao = new Date(new Date(dataDem).getTime() + diasAviso * 86400000);
    }
  }

  // ── 13º proporcional ──────────────────────────────────
  const inicioAno13 = new Date(ano, 0, 1) > new Date(dataAdm) ? new Date(ano, 0, 1) : new Date(dataAdm);
  const meses13 = diffMeses(inicioAno13.toISOString().split('T')[0], dataProjecao.toISOString().split('T')[0]);
  const decimo13 = dir.decimo ? parseFloat((salario / 12 * meses13).toFixed(2)) : 0;

  // ── Férias vencidas (se houver período sem gozo) ─────
  const feriasVencidas = dir.vencidas && params.tem_ferias_vencidas
    ? parseFloat(salario.toFixed(2))
    : 0;
  const umTercoVencidas = parseFloat((feriasVencidas / 3).toFixed(2));

  // ── Férias proporcionais ──────────────────────────────
  let feriasProp = 0;
  let umTercoProp = 0;
  if (dir.proporcionais) {
    // Período aquisitivo: último 12 meses
    const inicioFerias = params.inicio_periodo_aquisitivo || dataAdm;
    const mesesFer = diffMeses(inicioFerias, dataProjecao.toISOString().split('T')[0]);
    feriasProp = parseFloat((salario / 12 * mesesFer).toFixed(2));
    umTercoProp = parseFloat((feriasProp / 3).toFixed(2));
  }

  // ── FGTS sobre a rescisão (depósitos) ─────────────────
  const fgtsMes = parseFloat((saldoSalario * 0.08).toFixed(2));
  const fgts13 = parseFloat((decimo13 * 0.08).toFixed(2));
  const fgtsAviso = parseFloat((avisoIndenizado * 0.08).toFixed(2));

  // ── Multa FGTS ────────────────────────────────────────
  const saldoFGTS = parseFloat(params.saldo_fgts_acumulado || 0);
  const baseMulta = saldoFGTS + fgtsMes + fgts13 + fgtsAviso;
  const multa = parseFloat((baseMulta * dir.multa).toFixed(2));

  // ── Total proventos ───────────────────────────────────
  const outrosProventos = parseFloat(params.outros_proventos || 0);
  const totalProventos = parseFloat((
    saldoSalario + avisoIndenizado + decimo13 +
    feriasVencidas + umTercoVencidas + feriasProp + umTercoProp +
    outrosProventos
  ).toFixed(2));

  // ── Descontos (INSS e IRRF) ───────────────────────────
  // INSS incide separadamente sobre cada verba "tributável":
  //  - saldo salário, 13º, aviso indenizado (proporção)
  // Férias proporcionais e indenizadas têm tratamento separado
  // Para simplificar: INSS sobre (saldo + 13º), IRRF sobre líquido após INSS
  const baseINSS = saldoSalario + decimo13;
  const inss = calcularINSS(baseINSS, ano);
  const irrInfo = calcularIRRF(baseINSS, inss, numDeps, ano);
  const irrf = irrInfo.irrf;

  const pensao = parseFloat(params.pensao_alimenticia || 0);
  const adiant = parseFloat(params.adiantamentos || 0);
  const outrosDesc = parseFloat(params.outros_descontos || 0);

  const totalDescontos = parseFloat((inss + irrf + pensao + adiant + outrosDesc).toFixed(2));
  const totalLiquido = parseFloat((totalProventos - totalDescontos).toFixed(2));

  return {
    salario_base: salario,
    dias_trabalhados_mes: diaDemissao,
    saldo_fgts_acumulado: saldoFGTS,

    saldo_salario: saldoSalario,
    aviso_previo_indenizado: avisoIndenizado,
    decimo_terceiro_proporcional: decimo13,
    ferias_vencidas: feriasVencidas,
    um_terco_ferias_vencidas: umTercoVencidas,
    ferias_proporcionais: feriasProp,
    um_terco_ferias_proporcionais: umTercoProp,
    outros_proventos: outrosProventos,
    outros_proventos_desc: params.outros_proventos_desc,

    fgts_mes: fgtsMes,
    fgts_13: fgts13,
    fgts_aviso: fgtsAviso,
    multa_fgts: multa,

    inss, irrf,
    pensao_alimenticia: pensao,
    adiantamentos: adiant,
    outros_descontos: outrosDesc,
    outros_descontos_desc: params.outros_descontos_desc,

    total_proventos: totalProventos,
    total_descontos: totalDescontos,
    total_liquido: totalLiquido,

    aviso_previo_dias: diasAviso,
    meses_13_calculados: meses13,
  };
}

module.exports = { calcularRescisao, DIREITOS, diasAvisoPrevio };
