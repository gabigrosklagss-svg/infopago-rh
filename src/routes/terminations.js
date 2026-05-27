const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { calcularRescisao } = require('../services/terminationCalc');
const { gerarPDFGenerico, fmtBRL, fmtData } = require('../services/docPdf');
const path = require('path');
const fs = require('fs');

const TIPOS_LABEL = {
  sem_justa_causa_empregador: 'Rescisão sem justa causa (empregador)',
  pedido_demissao: 'Pedido de demissão',
  justa_causa: 'Justa causa',
  comum_acordo: 'Comum acordo (Lei 13.467/17)',
  termino_contrato_experiencia: 'Término de contrato de experiência',
  termino_contrato_determinado: 'Término de contrato por prazo determinado',
  aposentadoria: 'Aposentadoria',
  falecimento: 'Falecimento',
};

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('terminations')
    .select('*, employees(nome_completo, matricula, cpf)')
    .order('data_demissao', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('terminations')
    .select('*, employees(*, departments(nome), positions(titulo,cbo))')
    .eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Rescisão não encontrada.' });
  res.json(data);
});

router.post('/calcular', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { employee_id, ...params } = req.body;
  const { data: emp, error } = await supabase.from('employees').select('*').eq('id', employee_id).single();
  if (error || !emp) return res.status(404).json({ error: 'Funcionário não encontrado.' });
  try {
    const calc = calcularRescisao(emp, params);
    res.json(calc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { employee_id, ...params } = req.body;
  const { data: emp, error } = await supabase.from('employees').select('*').eq('id', employee_id).single();
  if (error || !emp) return res.status(404).json({ error: 'Funcionário não encontrado.' });

  try {
    const calc = calcularRescisao(emp, params);
    const payload = {
      employee_id,
      data_demissao: params.data_demissao,
      data_aviso_previo: params.data_aviso_previo || null,
      ultimo_dia_trabalhado: params.ultimo_dia_trabalhado || null,
      tipo_rescisao: params.tipo_rescisao,
      aviso_previo_tipo: params.aviso_previo_tipo || 'nao_aplica',
      aviso_previo_dias: calc.aviso_previo_dias,
      motivo: params.motivo,
      ...calc,
      status: 'calculada',
      observacoes: params.observacoes,
      created_by: req.user.id,
    };
    // Remove campos do calc que não pertencem à tabela
    delete payload.meses_13_calculados;

    const { data, error: e2 } = await supabase.from('terminations').insert(payload).select().single();
    if (e2) return res.status(400).json({ error: e2.message });
    res.status(201).json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body };
  delete payload.id; delete payload.created_at; delete payload.created_by;
  const { data, error } = await supabase.from('terminations').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { data: t } = await supabase.from('terminations').select('pdf_path').eq('id', req.params.id).single();
  if (t?.pdf_path) {
    try { fs.unlinkSync(path.join(__dirname, '../../', t.pdf_path)); } catch {}
  }
  await supabase.from('terminations').delete().eq('id', req.params.id);
  res.json({ success: true });
});

router.post('/:id/pdf', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: t } = await supabase.from('terminations')
    .select('*, employees(*, departments(nome), positions(titulo,cbo))')
    .eq('id', req.params.id).single();
  if (!t) return res.status(404).json({ error: 'Rescisão não encontrada.' });

  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();
  const emp = t.employees;
  const c = company || {};

  // Montar linhas de verbas
  const linhas = [];
  const add = (cod, desc, ref, ven, desc2) => linhas.push({
    codigo: cod, descricao: desc, referencia: ref,
    vencimento: ven > 0 ? fmtBRL(ven) : '',
    desconto: desc2 > 0 ? fmtBRL(desc2) : '',
  });
  add('101', 'SALDO DE SALÁRIO', `${t.dias_trabalhados_mes} dias`, t.saldo_salario, 0);
  if (t.aviso_previo_indenizado > 0) add('110', 'AVISO PRÉVIO INDENIZADO', `${t.aviso_previo_dias} dias`, t.aviso_previo_indenizado, 0);
  if (t.decimo_terceiro_proporcional > 0) add('120', '13º SALÁRIO PROPORCIONAL', '', t.decimo_terceiro_proporcional, 0);
  if (t.ferias_vencidas > 0) add('130', 'FÉRIAS VENCIDAS', '', t.ferias_vencidas, 0);
  if (t.um_terco_ferias_vencidas > 0) add('131', '1/3 FÉRIAS VENCIDAS', '', t.um_terco_ferias_vencidas, 0);
  if (t.ferias_proporcionais > 0) add('140', 'FÉRIAS PROPORCIONAIS', '', t.ferias_proporcionais, 0);
  if (t.um_terco_ferias_proporcionais > 0) add('141', '1/3 FÉRIAS PROPORCIONAIS', '', t.um_terco_ferias_proporcionais, 0);
  if (t.outros_proventos > 0) add('199', (t.outros_proventos_desc || 'OUTROS PROVENTOS').toUpperCase(), '', t.outros_proventos, 0);

  if (t.inss > 0) add('973', 'INSS', '', 0, t.inss);
  if (t.irrf > 0) add('987', 'IRRF', '', 0, t.irrf);
  if (t.pensao_alimenticia > 0) add('910', 'PENSÃO ALIMENTÍCIA', '', 0, t.pensao_alimenticia);
  if (t.adiantamentos > 0) add('901', 'ADIANTAMENTOS', '', 0, t.adiantamentos);
  if (t.outros_descontos > 0) add('999', (t.outros_descontos_desc || 'OUTROS DESCONTOS').toUpperCase(), '', 0, t.outros_descontos);

  while (linhas.length < 12) linhas.push({ codigo: '', descricao: '', referencia: '', vencimento: '', desconto: '' });

  const baseMulta = parseFloat(t.saldo_fgts_acumulado || 0) + t.fgts_mes + t.fgts_13 + t.fgts_aviso;
  const multaPct = t.multa_fgts > 0 ? Math.round(t.multa_fgts / baseMulta * 100) : 0;

  const data = {
    empresa_nome: c.razao_social || '—',
    empresa_cnpj: c.cnpj || '—',
    empresa_endereco: [c.endereco, c.cidade, c.uf].filter(Boolean).join(' - ') || '—',
    func_nome: (emp.nome_completo || '').toUpperCase(),
    func_cpf: emp.cpf || '—',
    func_pis: emp.pis_pasep || '—',
    func_ctps: emp.ctps ? `${emp.ctps}${emp.ctps_serie ? ' / ' + emp.ctps_serie : ''}` : '—',
    func_cargo: (emp.positions?.titulo || '').toUpperCase(),
    data_admissao: fmtData(emp.data_admissao),
    data_demissao: fmtData(t.data_demissao),
    tipo_rescisao_texto: TIPOS_LABEL[t.tipo_rescisao] || t.tipo_rescisao,
    aviso_texto: { trabalhado: 'Trabalhado', indenizado: 'Indenizado', dispensado: 'Dispensado', nao_aplica: '—' }[t.aviso_previo_tipo] || '—',
    aviso_dias: t.aviso_previo_dias || 0,
    salario_base: fmtBRL(t.salario_base),
    linhas_verbas: linhas,
    fgts_saldo: fmtBRL(t.saldo_fgts_acumulado),
    fgts_rescisao_total: fmtBRL(t.fgts_mes + t.fgts_13 + t.fgts_aviso),
    fgts_base_multa: fmtBRL(baseMulta),
    multa_pct: multaPct,
    multa_fgts: fmtBRL(t.multa_fgts),
    total_proventos: fmtBRL(t.total_proventos),
    total_descontos: fmtBRL(t.total_descontos),
    total_liquido: fmtBRL(t.total_liquido),
    cidade: c.cidade || '',
    data_pagamento: fmtData(new Date()),
  };

  const ano = String(t.data_demissao).slice(0, 4);
  const filename = `Rescisao_${emp.matricula}_${emp.nome_completo.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const pdf_path = await gerarPDFGenerico('rescisao', data, `rescisoes/${ano}`, filename);

  await supabase.from('terminations').update({ pdf_path }).eq('id', req.params.id);
  res.json({ pdf_path });
});

router.get('/:id/download', requireAuth, async (req, res) => {
  const { data: t } = await supabase.from('terminations').select('pdf_path, employees(nome_completo)').eq('id', req.params.id).single();
  if (!t?.pdf_path) return res.status(404).json({ error: 'PDF não gerado.' });
  const file = path.join(__dirname, '../../', t.pdf_path);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.download(file, `Rescisao_${(t.employees?.nome_completo || 'funcionario').split(' ')[0]}.pdf`);
});

module.exports = router;
