/**
 * Cálculo do Recibo de Pagamento de Férias
 *
 * Componentes:
 *  - Valor base (proporcional aos dias gozados)
 *  - 1/3 constitucional sobre o valor base
 *  - Abono pecuniário (se vendeu dias) + 1/3 sobre o abono
 *  - Adiantamento do 13º (opcional)
 *  - INSS sobre (base + 1/3) — abono pecuniário NÃO sofre INSS
 *  - IRRF idem
 *
 * Pagamento até 2 dias antes do início das férias (CLT).
 */

const { calcularINSS, calcularIRRF } = require('./payroll');

function calcularReciboFerias(employee, params) {
  const salario = parseFloat(employee.salario_base);
  const numDeps = parseInt(employee.num_dependentes || 0);
  const ano = parseInt(String(params.data_inicio_gozo).slice(0, 4));

  const diasFerias = parseInt(params.dias_ferias);
  const diasAbono = parseInt(params.dias_abono || 0);
  const totalDias = diasFerias + diasAbono;
  if (totalDias > 30) throw new Error('Total de dias (férias + abono) não pode passar de 30.');

  const mediaHE = parseFloat(params.media_he || 0);
  const baseCalculo = parseFloat((salario + mediaHE).toFixed(2));

  const valorDia = baseCalculo / 30;
  const valorFerias = parseFloat((valorDia * diasFerias).toFixed(2));
  const umTercoFerias = parseFloat((valorFerias / 3).toFixed(2));

  const abono = parseFloat((valorDia * diasAbono).toFixed(2));
  const umTercoAbono = parseFloat((abono / 3).toFixed(2));

  const adiantamento13 = params.adiantamento_13
    ? parseFloat((baseCalculo / 2).toFixed(2))
    : 0;

  const totalProventos = parseFloat((
    valorFerias + umTercoFerias + abono + umTercoAbono + adiantamento13
  ).toFixed(2));

  // INSS/IRRF — incidem sobre férias + 1/3 (abono é isento)
  const baseTributavel = valorFerias + umTercoFerias;
  const inss = calcularINSS(baseTributavel, ano);
  const irrInfo = calcularIRRF(baseTributavel, inss, numDeps, ano);
  const irrf = irrInfo.irrf;

  const outrosDesc = parseFloat(params.outros_descontos || 0);
  const totalDescontos = parseFloat((inss + irrf + outrosDesc).toFixed(2));
  const totalLiquido = parseFloat((totalProventos - totalDescontos).toFixed(2));

  return {
    salario_base: salario,
    media_he: mediaHE,
    base_calculo: baseCalculo,
    dias_ferias: diasFerias,
    dias_abono: diasAbono,
    valor_ferias: valorFerias,
    um_terco_ferias: umTercoFerias,
    abono_pecuniario: abono,
    um_terco_abono: umTercoAbono,
    adiantamento_13: adiantamento13,
    total_proventos: totalProventos,
    inss, irrf,
    outros_descontos: outrosDesc,
    total_descontos: totalDescontos,
    total_liquido: totalLiquido,
  };
}

module.exports = { calcularReciboFerias };
