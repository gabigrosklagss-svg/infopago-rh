const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { calcularReciboFerias } = require('../services/vacationReceipt');
const { gerarPDFGenerico, fmtBRL, fmtData } = require('../services/docPdf');
const path = require('path');
const fs = require('fs');

router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('vacation_receipts')
    .select('*, employees(nome_completo, matricula)').order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/calcular', requireAuth, async (req, res) => {
  const { employee_id, ...params } = req.body;
  const { data: emp, error } = await supabase.from('employees').select('*').eq('id', employee_id).single();
  if (error || !emp) return res.status(404).json({ error: 'Funcionário não encontrado.' });
  try {
    const calc = calcularReciboFerias(emp, params);
    res.json(calc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { employee_id, ...params } = req.body;
  const { data: emp, error } = await supabase.from('employees').select('*').eq('id', employee_id).single();
  if (error || !emp) return res.status(404).json({ error: 'Funcionário não encontrado.' });

  try {
    const calc = calcularReciboFerias(emp, params);
    const payload = {
      employee_id,
      vacation_request_id: params.vacation_request_id || null,
      periodo_aquisitivo_inicio: params.periodo_aquisitivo_inicio || null,
      periodo_aquisitivo_fim: params.periodo_aquisitivo_fim || null,
      data_inicio_gozo: params.data_inicio_gozo,
      data_fim_gozo: params.data_fim_gozo,
      ...calc,
      data_pagamento: params.data_pagamento || null,
      status: 'gerado',
      observacoes: params.observacoes,
      created_by: req.user.id,
    };
    const { data, error: e2 } = await supabase.from('vacation_receipts').insert(payload).select().single();
    if (e2) return res.status(400).json({ error: e2.message });
    res.status(201).json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/:id/pdf', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: r } = await supabase.from('vacation_receipts')
    .select('*, employees(*, positions(titulo,cbo))').eq('id', req.params.id).single();
  if (!r) return res.status(404).json({ error: 'Recibo não encontrado.' });
  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();
  const c = company || {}; const emp = r.employees;

  const linhasAbono = [];
  if (r.abono_pecuniario > 0) linhasAbono.push({ descricao: 'Abono pecuniário', referencia: `${r.dias_abono} dias`, valor: fmtBRL(r.abono_pecuniario) });
  if (r.um_terco_abono > 0) linhasAbono.push({ descricao: '1/3 sobre abono', referencia: '', valor: fmtBRL(r.um_terco_abono) });
  if (r.adiantamento_13 > 0) linhasAbono.push({ descricao: 'Adiantamento do 13º (50%)', referencia: '', valor: fmtBRL(r.adiantamento_13) });

  const linhasDesc = [];
  if (r.inss > 0) linhasDesc.push({ descricao: 'INSS', referencia: 'Sobre férias + 1/3', valor: fmtBRL(r.inss) });
  if (r.irrf > 0) linhasDesc.push({ descricao: 'IRRF', referencia: 'Sobre férias + 1/3', valor: fmtBRL(r.irrf) });
  if (r.outros_descontos > 0) linhasDesc.push({ descricao: 'Outros descontos', referencia: '', valor: fmtBRL(r.outros_descontos) });

  const data = {
    empresa_nome: c.razao_social || '—',
    empresa_cnpj: c.cnpj || '—',
    func_nome: (emp.nome_completo || '').toUpperCase(),
    func_cpf: emp.cpf || '—',
    func_matricula: emp.matricula || '—',
    func_cargo: (emp.positions?.titulo || '').toUpperCase(),
    data_admissao: fmtData(emp.data_admissao),
    periodo_aquisitivo: r.periodo_aquisitivo_inicio ? `${fmtData(r.periodo_aquisitivo_inicio)} a ${fmtData(r.periodo_aquisitivo_fim)}` : '—',
    periodo_gozo: `${fmtData(r.data_inicio_gozo)} a ${fmtData(r.data_fim_gozo)}`,
    dias_ferias: r.dias_ferias,
    dias_abono: r.dias_abono,
    base_calculo: fmtBRL(r.base_calculo),
    valor_ferias: fmtBRL(r.valor_ferias),
    um_terco_ferias: fmtBRL(r.um_terco_ferias),
    linhas_abono: linhasAbono,
    linhas_descontos: linhasDesc,
    total_proventos: fmtBRL(r.total_proventos),
    total_descontos: fmtBRL(r.total_descontos),
    total_liquido: fmtBRL(r.total_liquido),
    data_pagamento: fmtData(r.data_pagamento || new Date()),
  };

  const ano = String(r.data_inicio_gozo).slice(0, 4);
  const filename = `Ferias_${emp.matricula}_${String(r.data_inicio_gozo).replace(/-/g,'')}.pdf`;
  const pdf_path = await gerarPDFGenerico('recibo-ferias', data, `ferias/${ano}`, filename);
  await supabase.from('vacation_receipts').update({ pdf_path }).eq('id', req.params.id);
  res.json({ pdf_path });
});

router.get('/:id/download', requireAuth, async (req, res) => {
  const { data: r } = await supabase.from('vacation_receipts').select('pdf_path, employees(nome_completo)').eq('id', req.params.id).single();
  if (!r?.pdf_path) return res.status(404).json({ error: 'PDF não gerado.' });
  const file = path.join(__dirname, '../../', r.pdf_path);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.download(file, `Recibo_Ferias_${(r.employees?.nome_completo || 'funcionario').split(' ')[0]}.pdf`);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { data: r } = await supabase.from('vacation_receipts').select('pdf_path').eq('id', req.params.id).single();
  if (r?.pdf_path) { try { fs.unlinkSync(path.join(__dirname, '../../', r.pdf_path)); } catch {} }
  await supabase.from('vacation_receipts').delete().eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
