/**
 * Cálculo do 13º Salário
 *  - 1ª parcela: 50% do bruto · paga entre 1º fev e 30 nov · SEM descontos
 *  - 2ª parcela: 50% restante - INSS - IRRF · paga até 20 dez
 *  - Proporcional: salário ÷ 12 × meses trabalhados (mês com ≥15 dias conta)
 */

const { calcularINSS, calcularIRRF } = require('./payroll');

function mesesTrabalhadosNoAno(dataAdmissao, ano) {
  const adm = new Date(dataAdmissao);
  const inicio = adm.getFullYear() < ano ? new Date(ano, 0, 1) : adm;
  let m = 12 - inicio.getMonth();
  // Se admitiu antes do dia 15, conta o mês inteiro
  if (adm.getFullYear() === ano && adm.getDate() > 15) m -= 1;
  return Math.min(12, Math.max(0, m));
}

function calcular13(employee, ano, parcela, opts = {}) {
  const salario = parseFloat(employee.salario_base);
  const meses = opts.meses_trabalhados ?? mesesTrabalhadosNoAno(employee.data_admissao, ano);
  const numDeps = parseInt(employee.num_dependentes || 0);

  const mediaHE = parseFloat(opts.media_he || 0);
  const mediaOutros = parseFloat(opts.media_outros || 0);
  const baseMensal = salario + mediaHE + mediaOutros;
  const valorIntegral = parseFloat((baseMensal / 12 * meses).toFixed(2));

  let valorParcela, inss = 0, irrf = 0;

  if (parcela === 1) {
    // 50% adiantado SEM descontos
    valorParcela = parseFloat((valorIntegral / 2).toFixed(2));
  } else {
    // 2ª parcela: 50% restante COM descontos sobre o valor INTEGRAL
    const parcela2Bruta = parseFloat((valorIntegral / 2).toFixed(2));
    inss = calcularINSS(valorIntegral, ano);
    const irrInfo = calcularIRRF(valorIntegral, inss, numDeps, ano);
    irrf = irrInfo.irrf;
    valorParcela = parseFloat((parcela2Bruta - inss - irrf).toFixed(2));
  }

  const outrosDesc = parseFloat(opts.outros_descontos || 0);
  const totalDesc = parseFloat((inss + irrf + outrosDesc).toFixed(2));
  const liquido = parcela === 1
    ? valorParcela
    : parseFloat((valorParcela - outrosDesc).toFixed(2));

  return {
    salario_base: salario,
    media_he: mediaHE,
    media_outros: mediaOutros,
    meses_trabalhados: meses,
    valor_integral: valorIntegral,
    valor_parcela: valorParcela,
    inss, irrf,
    outros_descontos: outrosDesc,
    total_descontos: totalDesc,
    valor_liquido: liquido,
  };
}

module.exports = { calcular13, mesesTrabalhadosNoAno };
