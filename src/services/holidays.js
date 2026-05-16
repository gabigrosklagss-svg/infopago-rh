/**
 * Feriados nacionais brasileiros — fixos e móveis (calculados a partir da Páscoa)
 */

// Algoritmo de Meeus para calcular a Páscoa
function pascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function addDias(d, dias) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + dias);
  return nd;
}

function fmtIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* Retorna mapa { 'YYYY-MM-DD': 'Nome do feriado' } */
function feriadosDoAno(ano) {
  const pas = pascoa(ano);
  const list = [
    [`${ano}-01-01`, 'Confraternização Universal'],
    [fmtIso(addDias(pas, -48)), 'Carnaval (segunda)'],
    [fmtIso(addDias(pas, -47)), 'Carnaval (terça)'],
    [fmtIso(addDias(pas, -2)),  'Sexta-feira Santa'],
    [fmtIso(pas),               'Páscoa'],
    [`${ano}-04-21`, 'Tiradentes'],
    [`${ano}-05-01`, 'Dia do Trabalho'],
    [fmtIso(addDias(pas, 60)),  'Corpus Christi'],
    [`${ano}-09-07`, 'Independência do Brasil'],
    [`${ano}-10-12`, 'Nossa Senhora Aparecida'],
    [`${ano}-11-02`, 'Finados'],
    [`${ano}-11-15`, 'Proclamação da República'],
    [`${ano}-11-20`, 'Consciência Negra'],
    [`${ano}-12-25`, 'Natal'],
  ];
  return Object.fromEntries(list);
}

/* Verifica se data é feriado, retorna nome ou null */
function ehFeriado(dataIso) {
  const ano = parseInt(dataIso.slice(0, 4));
  const mapa = feriadosDoAno(ano);
  return mapa[dataIso] || null;
}

module.exports = { feriadosDoAno, ehFeriado };
