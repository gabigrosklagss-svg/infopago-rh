const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { supabase } = require('../config/supabase');
const { feriadosDoAno } = require('./holidays');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/holerites');

const meses = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const diasSem = ['DOM','SEG','TER','QUA','QUI','SEX','SAB'];

function fmtMoeda(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtData(s) {
  if (!s) return '';
  try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return s; }
}

/**
 * Lê o template HTML e substitui as variáveis {{var}} e blocos {{#each lista}}...{{/each}}
 */
function renderTemplate(html, data) {
  // {{#each items}}...{{/each}}
  html = html.replace(/\{\{#each ([\w_]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, key, block) => {
    const arr = data[key] || [];
    return arr.map(item => {
      let row = block;
      Object.entries(item).forEach(([k, v]) => {
        row = row.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v != null ? String(v) : '');
      });
      return row;
    }).join('');
  });
  // {{var}}
  html = html.replace(/\{\{([\w_.]+)\}\}/g, (_, key) => {
    const val = key.split('.').reduce((o, k) => (o ? o[k] : ''), data);
    return val != null ? String(val) : '';
  });
  return html;
}

async function gerarPDF(payslip, employee, company) {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const ano = payslip.competencia_ano;
  const mes = String(payslip.competencia_mes).padStart(2, '0');
  const dir = path.join(UPLOADS_DIR, String(ano), mes);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const filename = `${employee.matricula}_${employee.nome_completo.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const filePath = path.join(dir, filename);
  const relPath = `uploads/holerites/${ano}/${mes}/${filename}`;

  // Recalcula lançamentos para o template (a partir dos campos salvos)
  const lancs = montarLancamentos(payslip);

  // ── Espelho de ponto da competência ──
  const espelhoPonto = await montarEspelhoPonto(employee.id, payslip.competencia_mes, payslip.competencia_ano, employee.carga_horaria_semanal || 44);

  const tplPath = path.join(__dirname, '../../templates/holerite.html');
  const tplHTML = fs.readFileSync(tplPath, 'utf8');

  const data = {
    empresa_nome: company.razao_social || 'Empresa',
    empresa_cnpj: company.cnpj || '',
    empresa_endereco: [company.endereco, company.cidade, company.uf].filter(Boolean).join(' - '),
    competencia: `${meses[payslip.competencia_mes - 1]}/${payslip.competencia_ano}`,
    func_codigo: employee.matricula,
    func_nome: (employee.nome_completo || '').toUpperCase(),
    func_cbo: employee.positions?.cbo || '',
    func_cargo: (employee.positions?.titulo || '').toUpperCase(),
    func_empresa: company.nome_fantasia || company.razao_social || '',
    func_local: employee.local_trabalho || '',
    func_depto: employee.departments?.nome || '',
    func_setor: employee.setor || '',
    func_secao: employee.secao || '',
    func_filial: employee.filial || '',
    lancamentos: lancs,
    total_vencimentos: fmtMoeda(payslip.total_proventos),
    total_descontos: fmtMoeda(payslip.total_descontos),
    salario_liquido: fmtMoeda(payslip.salario_liquido),
    salario_base_valor: fmtMoeda(payslip.salario_base),
    base_inss: fmtMoeda(payslip.base_inss),
    base_fgts: fmtMoeda(payslip.base_inss),
    fgts_mes: fmtMoeda(payslip.fgts_valor),
    base_irrf: fmtMoeda(payslip.base_irrf),
    faixa_irrf: payslip.faixa_irrf ? String(payslip.faixa_irrf).padStart(2, '0') : '00',
    data_pagamento: fmtData(payslip.data_pagamento),

    // Espelho de ponto (página 2)
    ponto_linhas: espelhoPonto.linhas,
    ponto_total_uteis: espelhoPonto.diasUteis,
    ponto_total_trabalhados: espelhoPonto.diasTrabalhados,
    ponto_total_dsr: espelhoPonto.diasDSR,
    ponto_total_feriados: espelhoPonto.diasFeriados,
    ponto_total_faltas: espelhoPonto.diasFaltas,
    ponto_horas_trabalhadas: espelhoPonto.horasTrabalhadas,
    ponto_horas_extras: espelhoPonto.horasExtras,
    ponto_horas_faltantes: espelhoPonto.horasFaltantes,
    ponto_carga_diaria: espelhoPonto.cargaDiaria,
  };

  const html = renderTemplate(tplHTML, data);

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: filePath,
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
  } finally {
    await browser.close();
  }

  return relPath;
}

function montarLancamentos(ps) {
  const out = [];
  const add = (cod, desc, ref, ven, desc2) => out.push({
    codigo: cod, descricao: desc, referencia: ref,
    vencimento: ven > 0 ? fmtMoeda(ven) : '',
    desconto: desc2 > 0 ? fmtMoeda(desc2) : '',
  });

  add('101', 'SALARIO', `${ps.dias_trabalhados || 30} d`, parseFloat(ps.salario_base), 0);
  if (ps.valor_horas_extras_50 > 0) add('102', 'HORAS EXTRAS 50%', `${ps.horas_extras_50} h`, parseFloat(ps.valor_horas_extras_50), 0);
  if (ps.valor_horas_extras_100 > 0) add('103', 'HORAS EXTRAS 100%', `${ps.horas_extras_100} h`, parseFloat(ps.valor_horas_extras_100), 0);
  if (ps.valor_adicional_noturno > 0) add('104', 'ADICIONAL NOTURNO', `${ps.adicional_noturno_horas} h`, parseFloat(ps.valor_adicional_noturno), 0);
  if (ps.adicional_insalubridade > 0) add('105', 'INSALUBRIDADE', '', parseFloat(ps.adicional_insalubridade), 0);
  if (ps.adicional_periculosidade > 0) add('106', 'PERICULOSIDADE', '', parseFloat(ps.adicional_periculosidade), 0);
  if (ps.comissoes > 0) add('107', 'COMISSOES', '', parseFloat(ps.comissoes), 0);
  if (ps.bonus > 0) add('108', 'BONIFICACAO', '', parseFloat(ps.bonus), 0);
  if (ps.gratificacao > 0) add('109', 'GRATIFICACAO', '', parseFloat(ps.gratificacao), 0);
  if (ps.decimo_terceiro > 0) add('110', '13o SALARIO', '', parseFloat(ps.decimo_terceiro), 0);
  if (ps.ferias_valor > 0) add('111', 'FERIAS', '', parseFloat(ps.ferias_valor), 0);
  if (ps.ferias_um_terco > 0) add('112', '1/3 FERIAS', '', parseFloat(ps.ferias_um_terco), 0);
  if (ps.vr_valor > 0) add('120', 'VALE REFEICAO', '', parseFloat(ps.vr_valor), 0);
  if (ps.va_valor > 0) add('121', 'VALE ALIMENTACAO', '', parseFloat(ps.va_valor), 0);
  if (ps.outros_proventos > 0) add('199', (ps.outros_proventos_desc || 'OUTROS PROVENTOS').toUpperCase(), '', parseFloat(ps.outros_proventos), 0);

  const baseInss = parseFloat(ps.base_inss || 0);
  if (ps.inss_valor > 0) add('973', 'INSS', baseInss > 0 ? `${((ps.inss_valor / baseInss) * 100).toFixed(2)}%` : '', 0, parseFloat(ps.inss_valor));
  if (ps.irrf_valor > 0) add('987', 'IRRF S.SALARIO', `${ps.faixa_irrf || ''}`.padStart(2,'0'), 0, parseFloat(ps.irrf_valor));
  if (ps.vt_desconto > 0) add('930', 'VALE TRANSPORTE', '', 0, parseFloat(ps.vt_desconto));
  if (ps.plano_saude_desconto > 0) add('940', 'PLANO DE SAUDE', '', 0, parseFloat(ps.plano_saude_desconto));
  if (ps.plano_odonto_desconto > 0) add('941', 'PLANO ODONTO', '', 0, parseFloat(ps.plano_odonto_desconto));
  if (ps.seguro_vida_desconto > 0) add('942', 'SEGURO DE VIDA', '', 0, parseFloat(ps.seguro_vida_desconto));
  if (ps.pensao_alimenticia > 0) add('910', 'PENSAO ALIMENTICIA', '', 0, parseFloat(ps.pensao_alimenticia));
  if (ps.adiantamento > 0) add('901', 'ADIANTAMENTO', '', 0, parseFloat(ps.adiantamento));
  if (ps.faltas_valor > 0) add('902', 'FALTAS', `${ps.faltas_dias} d`, 0, parseFloat(ps.faltas_valor));
  if (ps.outros_descontos > 0) add('999', (ps.outros_descontos_desc || 'OUTROS DESCONTOS').toUpperCase(), '', 0, parseFloat(ps.outros_descontos));

  // Preenche com linhas vazias até completar 20 (visual tradicional)
  while (out.length < 20) out.push({ codigo: '', descricao: '', referencia: '', vencimento: '', desconto: '' });

  return out;
}

/**
 * Monta espelho de ponto da competência:
 * - Para cada dia: data, dia da semana, marcações OU label (DSR/Feriado/Falta/Compensado)
 * - Conta dias úteis, trabalhados, DSR, feriados, faltas, e somatórios de horas
 */
async function montarEspelhoPonto(employeeId, mes, ano, cargaSemanal = 44) {
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(diasNoMes).padStart(2, '0')}`;

  const { data: entries } = await supabase.from('time_entries')
    .select('*').eq('employee_id', employeeId)
    .gte('data', inicio).lte('data', fim);

  const feriadosMap = feriadosDoAno(ano);
  const entriesMap = Object.fromEntries((entries || []).map(e => [e.data, e]));

  const cargaDiaria = parseFloat((cargaSemanal / 5).toFixed(2));

  let diasUteis = 0, diasTrabalhados = 0, diasDSR = 0, diasFeriados = 0, diasFaltas = 0;
  let horasTrab = 0, horasExtras = 0, horasFalt = 0;

  const linhas = [];
  for (let d = 1; d <= diasNoMes; d++) {
    const dataIso = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dt = new Date(dataIso + 'T12:00:00');
    const dow = dt.getDay();
    const isFimSemana = (dow === 0 || dow === 6);
    const feriadoNome = feriadosMap[dataIso];

    const entry = entriesMap[dataIso];

    let label = '';
    let status = '';   // codigo curto para coluna de status
    let ent1 = '—', sai1 = '—', ent2 = '—', sai2 = '—';
    let trab = '', extras = '', falt = '';
    let observacao = '';
    let rowStyle = '';

    if (feriadoNome) {
      label = feriadoNome;
      status = 'FERIADO';
      observacao = 'Descanso compensado';
      diasFeriados++;
      rowStyle = 'background:#FAF4E3';
    } else if (isFimSemana) {
      label = dow === 0 ? 'Domingo' : 'Sábado';
      status = 'DSR';
      observacao = 'Descanso semanal remunerado';
      diasDSR++;
      rowStyle = 'background:#F4F6F4';
    } else {
      // Dia útil
      diasUteis++;
      if (entry) {
        diasTrabalhados++;
        status = 'TRABALHADO';
        ent1 = entry.entrada_1 || '—';
        sai1 = entry.saida_1 || '—';
        ent2 = entry.entrada_2 || '—';
        sai2 = entry.saida_2 || '—';
        trab = entry.horas_trabalhadas ? `${parseFloat(entry.horas_trabalhadas).toFixed(2)}h` : '';
        extras = entry.horas_extras > 0 ? `+${parseFloat(entry.horas_extras).toFixed(2)}h` : '';
        falt = entry.horas_faltantes > 0 ? `-${parseFloat(entry.horas_faltantes).toFixed(2)}h` : '';
        horasTrab += parseFloat(entry.horas_trabalhadas || 0);
        horasExtras += parseFloat(entry.horas_extras || 0);
        horasFalt += parseFloat(entry.horas_faltantes || 0);
        observacao = entry.observacao || '';
      } else {
        // Dia útil sem marcação = falta (ou pode ser compensado, mas sem dados assumimos falta)
        status = 'SEM REGISTRO';
        diasFaltas++;
        rowStyle = 'background:#FBE9E9';
      }
    }

    linhas.push({
      dia: String(d).padStart(2, '0'),
      dow: diasSem[dow],
      label: label,
      status: status,
      ent1, sai1, ent2, sai2,
      trab, extras, falt,
      observacao,
      row_style: rowStyle,
    });
  }

  return {
    linhas,
    diasUteis, diasTrabalhados, diasDSR, diasFeriados, diasFaltas,
    horasTrabalhadas: horasTrab.toFixed(2),
    horasExtras: horasExtras.toFixed(2),
    horasFaltantes: horasFalt.toFixed(2),
    cargaDiaria: cargaDiaria.toFixed(2),
  };
}

async function gerarPDFEmLote(payslips, getEmployee, company) {
  const resultados = [];
  for (const ps of payslips) {
    try {
      const emp = await getEmployee(ps.employee_id);
      const pdf_path = await gerarPDF(ps, emp, company);
      resultados.push({ payslip_id: ps.id, success: true, pdf_path });
    } catch (err) {
      resultados.push({ payslip_id: ps.id, success: false, error: err.message });
    }
  }
  return resultados;
}

module.exports = { gerarPDF, gerarPDFEmLote };
