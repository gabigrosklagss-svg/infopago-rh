const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { calcularHolerite } = require('../services/payroll');
const { gerarPDF, gerarPDFEmLote } = require('../services/pdf');
const { calcularHEDoPonto } = require('../utils/pontoExtras');
const path = require('path');
const fs = require('fs');

const NAO_PERSISTE = ['lancamentos_detalhados', 'salario_familia', 'faixa_irrf', 'ano_tabela', 'vt_total_mes', 'vt_custo_empresa', 'valor_hora'];
function stripDB(o) { const c = { ...o }; NAO_PERSISTE.forEach(k => delete c[k]); return c; }

router.get('/', requireAuth, async (req, res) => {
  const { mes, ano, status, employee_id, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let q = supabase.from('payslips').select(`
    id, competencia_mes, competencia_ano, salario_base, total_proventos,
    total_descontos, salario_liquido, inss_valor, irrf_valor, fgts_valor,
    status, data_pagamento, pdf_path, created_at,
    employees(id, matricula, nome_completo, email_pessoal, email_corporativo, departments(nome))
  `, { count: 'exact' })
    .order('competencia_ano', { ascending: false })
    .order('competencia_mes', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (mes) q = q.eq('competencia_mes', parseInt(mes));
  if (ano) q = q.eq('competencia_ano', parseInt(ano));
  if (status) q = q.eq('status', status);
  if (employee_id) q = q.eq('employee_id', employee_id);

  const { data, error, count } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data, total: count, page: parseInt(page) });
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('payslips')
    .select('*, employees(*, departments(nome), positions(titulo,cbo))')
    .eq('id', req.params.id).single();
  if (error || !data) return res.status(404).json({ error: 'Holerite não encontrado.' });
  res.json(data);
});

router.post('/calcular', requireAuth, async (req, res) => {
  const { employee_id, lancamentos, competencia_ano } = req.body;
  const { data: emp, error } = await supabase.from('employees').select('*').eq('id', employee_id).single();
  if (error || !emp) return res.status(404).json({ error: 'Funcionário não encontrado.' });
  const ano = parseInt(competencia_ano) || new Date().getFullYear();
  res.json(calcularHolerite(emp, lancamentos || {}, ano));
});

router.post('/', requireAuth, async (req, res) => {
  const { employee_id, competencia_mes, competencia_ano, lancamentos, data_pagamento } = req.body;
  if (!employee_id || !competencia_mes || !competencia_ano)
    return res.status(400).json({ error: 'employee_id, competencia_mes e competencia_ano são obrigatórios.' });

  const { data: emp, error: e1 } = await supabase.from('employees').select('*').eq('id', employee_id).single();
  if (e1 || !emp) return res.status(404).json({ error: 'Funcionário não encontrado.' });

  // Calcula HE automaticamente do ponto (sobrescreve manual se houver dados)
  const heAuto = await calcularHEDoPonto(employee_id, parseInt(competencia_mes), parseInt(competencia_ano), emp.carga_horaria_semanal || 44);
  const lancEffective = { ...lancamentos, data_pagamento };
  if (heAuto.has_data) {
    lancEffective.horas_extras_50  = heAuto.horas_extras_50;
    lancEffective.horas_extras_100 = heAuto.horas_extras_100;
  }

  const calc = calcularHolerite(emp, lancEffective, parseInt(competencia_ano));
  const payload = {
    employee_id,
    competencia_mes: parseInt(competencia_mes),
    competencia_ano: parseInt(competencia_ano),
    ...stripDB(calc),
    created_by: req.user.id,
  };

  const { data, error } = await supabase.from('payslips')
    .upsert(payload, { onConflict: 'employee_id,competencia_mes,competencia_ano' })
    .select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.post('/lote', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { competencia_mes, competencia_ano, department_id, employee_ids, lancamentos_padrao, data_pagamento } = req.body;
  let q = supabase.from('employees').select('*').eq('status', 'ativo');
  if (department_id) q = q.eq('department_id', department_id);
  if (employee_ids?.length) q = q.in('id', employee_ids);

  const { data: emps } = await q;
  if (!emps?.length) return res.status(400).json({ error: 'Nenhum funcionário ativo encontrado.' });

  const resultados = [];
  for (const emp of emps) {
    try {
      const heAuto = await calcularHEDoPonto(emp.id, parseInt(competencia_mes), parseInt(competencia_ano), emp.carga_horaria_semanal || 44);
      const lancEffective = { ...lancamentos_padrao, data_pagamento };
      if (heAuto.has_data) {
        lancEffective.horas_extras_50  = heAuto.horas_extras_50;
        lancEffective.horas_extras_100 = heAuto.horas_extras_100;
      }
      const calc = calcularHolerite(emp, lancEffective, parseInt(competencia_ano));
      const payload = {
        employee_id: emp.id,
        competencia_mes: parseInt(competencia_mes),
        competencia_ano: parseInt(competencia_ano),
        ...stripDB(calc),
        pdf_path: null,           // invalida PDF antigo - força regeração
        pdf_generated_at: null,
        status: 'pendente',       // volta pra pendente até gerar PDF novo
        created_by: req.user.id,
      };
      const { data: ps } = await supabase.from('payslips')
        .upsert(payload, { onConflict: 'employee_id,competencia_mes,competencia_ano' }).select().single();
      resultados.push({ employee_id: emp.id, nome: emp.nome_completo, payslip_id: ps?.id, success: true });
    } catch (err) {
      resultados.push({ employee_id: emp.id, nome: emp.nome_completo, success: false, error: err.message });
    }
  }
  const ok = resultados.filter(r => r.success).length;
  res.json({ total: emps.length, criados: ok, erros: emps.length - ok, resultados });
});

router.post('/:id/gerar-pdf', requireAuth, async (req, res) => {
  const { data: ps } = await supabase.from('payslips')
    .select('*, employees(*, departments(nome), positions(titulo,cbo))')
    .eq('id', req.params.id).single();
  if (!ps) return res.status(404).json({ error: 'Holerite não encontrado.' });

  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();

  try {
    const pdf_path = await gerarPDF(ps, ps.employees, company || {});
    await supabase.from('payslips').update({
      pdf_path, pdf_generated_at: new Date().toISOString(), status: 'gerado'
    }).eq('id', req.params.id);
    res.json({ success: true, pdf_path });
  } catch (err) {
    res.status(500).json({ error: `Erro ao gerar PDF: ${err.message}` });
  }
});

router.post('/lote/gerar-pdf', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { competencia_mes, competencia_ano, payslip_ids } = req.body;
  let q = supabase.from('payslips').select('*, employees(*, departments(nome), positions(titulo,cbo))');
  if (payslip_ids?.length) q = q.in('id', payslip_ids);
  else q = q.eq('competencia_mes', competencia_mes).eq('competencia_ano', competencia_ano);

  const { data: pss } = await q;
  if (!pss?.length) return res.status(400).json({ error: 'Nenhum holerite encontrado.' });

  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();

  const resultados = await gerarPDFEmLote(pss, (emp_id) => pss.find(p => p.employee_id === emp_id)?.employees, company || {});

  for (const r of resultados) {
    if (r.success) {
      await supabase.from('payslips').update({
        pdf_path: r.pdf_path, pdf_generated_at: new Date().toISOString(), status: 'gerado'
      }).eq('id', r.payslip_id);
    }
  }
  const ok = resultados.filter(r => r.success).length;
  res.json({ total: pss.length, gerados: ok, erros: pss.length - ok, resultados });
});

router.get('/:id/download', requireAuth, async (req, res) => {
  const { data: ps } = await supabase.from('payslips')
    .select('pdf_path, competencia_mes, competencia_ano, employees(nome_completo)')
    .eq('id', req.params.id).single();
  if (!ps?.pdf_path) return res.status(404).json({ error: 'PDF não gerado. Gere primeiro.' });

  const file = path.join(__dirname, '../../', ps.pdf_path);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });

  const nome = ps.employees?.nome_completo?.split(' ')[0] || 'funcionario';
  res.download(file, `Holerite_${nome}_${ps.competencia_mes}_${ps.competencia_ano}.pdf`);
});

router.put('/:id', requireAuth, async (req, res) => {
  const { lancamentos, data_pagamento, observacoes } = req.body;
  const { data: ps } = await supabase.from('payslips').select('*, employees(*)').eq('id', req.params.id).single();
  if (!ps) return res.status(404).json({ error: 'Holerite não encontrado.' });

  const calc = calcularHolerite(ps.employees, { ...lancamentos, data_pagamento, observacoes }, ps.competencia_ano);
  const { data, error } = await supabase.from('payslips').update({ ...stripDB(calc), pdf_path: null })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: ps } = await supabase.from('payslips').select('id, status, pdf_path').eq('id', req.params.id).single();
  if (!ps) return res.status(404).json({ error: 'Holerite não encontrado.' });

  // Apaga PDF do disco se existir
  if (ps.pdf_path) {
    try {
      const fullPath = path.join(__dirname, '../../', ps.pdf_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    } catch (e) { console.warn('Erro ao apagar PDF:', e.message); }
  }

  // Apaga logs de envio relacionados (CASCADE seria melhor, mas vamos garantir)
  await supabase.from('email_logs').delete().eq('payslip_id', req.params.id);

  const { error } = await supabase.from('payslips').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
