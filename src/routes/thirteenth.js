const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { calcular13 } = require('../services/thirteenthCalc');
const { gerarPDFGenerico, fmtBRL, fmtData } = require('../services/docPdf');
const path = require('path');
const fs = require('fs');

router.get('/', requireAuth, async (req, res) => {
  const { ano, employee_id } = req.query;
  let q = supabase.from('thirteenth_salary').select('*, employees(nome_completo, matricula)').order('ano', { ascending: false }).order('parcela');
  if (ano) q = q.eq('ano', parseInt(ano));
  if (employee_id) q = q.eq('employee_id', employee_id);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/calcular', requireAuth, async (req, res) => {
  const { employee_id, ano, parcela, ...opts } = req.body;
  const { data: emp, error } = await supabase.from('employees').select('*').eq('id', employee_id).single();
  if (error || !emp) return res.status(404).json({ error: 'Funcionário não encontrado.' });
  try {
    const calc = calcular13(emp, parseInt(ano), parseInt(parcela), opts);
    res.json(calc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { employee_id, ano, parcela, data_pagamento, ...opts } = req.body;
  const { data: emp, error } = await supabase.from('employees').select('*').eq('id', employee_id).single();
  if (error || !emp) return res.status(404).json({ error: 'Funcionário não encontrado.' });

  try {
    const calc = calcular13(emp, parseInt(ano), parseInt(parcela), opts);
    const payload = {
      employee_id, ano: parseInt(ano), parcela: parseInt(parcela),
      ...calc, data_pagamento, status: 'gerado',
      observacoes: opts.observacoes,
      created_by: req.user.id,
    };
    const { data, error: e2 } = await supabase.from('thirteenth_salary')
      .upsert(payload, { onConflict: 'employee_id,ano,parcela' }).select().single();
    if (e2) return res.status(400).json({ error: e2.message });
    res.status(201).json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/lote/:ano/:parcela', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const ano = parseInt(req.params.ano);
  const parcela = parseInt(req.params.parcela);
  const data_pagamento = req.body.data_pagamento;

  const { data: emps } = await supabase.from('employees').select('*').eq('status', 'ativo');
  if (!emps?.length) return res.status(400).json({ error: 'Nenhum funcionário ativo.' });

  const resultados = [];
  for (const emp of emps) {
    try {
      const calc = calcular13(emp, ano, parcela);
      const payload = {
        employee_id: emp.id, ano, parcela,
        ...calc, data_pagamento, status: 'gerado',
        created_by: req.user.id,
      };
      const { data } = await supabase.from('thirteenth_salary')
        .upsert(payload, { onConflict: 'employee_id,ano,parcela' }).select().single();
      resultados.push({ employee_id: emp.id, nome: emp.nome_completo, success: true, id: data?.id });
    } catch (err) {
      resultados.push({ employee_id: emp.id, nome: emp.nome_completo, success: false, error: err.message });
    }
  }
  const ok = resultados.filter(r => r.success).length;
  res.json({ total: emps.length, gerados: ok, erros: emps.length - ok, resultados });
});

router.post('/:id/pdf', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: t } = await supabase.from('thirteenth_salary')
    .select('*, employees(*, positions(titulo,cbo))').eq('id', req.params.id).single();
  if (!t) return res.status(404).json({ error: 'Registro não encontrado.' });
  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();
  const c = company || {}; const emp = t.employees;

  const descontos = [];
  if (t.inss > 0) descontos.push({ descricao: 'INSS', referencia: 'Sobre valor integral', valor: fmtBRL(t.inss) });
  if (t.irrf > 0) descontos.push({ descricao: 'IRRF', referencia: 'Sobre valor integral', valor: fmtBRL(t.irrf) });
  if (t.outros_descontos > 0) descontos.push({ descricao: 'Outros descontos', referencia: '', valor: fmtBRL(t.outros_descontos) });

  const data = {
    empresa_nome: c.razao_social || '—',
    empresa_cnpj: c.cnpj || '—',
    func_nome: (emp.nome_completo || '').toUpperCase(),
    func_cpf: emp.cpf || '—',
    func_matricula: emp.matricula || '—',
    func_cargo: (emp.positions?.titulo || '').toUpperCase(),
    data_admissao: fmtData(emp.data_admissao),
    ano: t.ano,
    parcela_texto: t.parcela === 1 ? '1ª PARCELA (Adiantamento)' : '2ª PARCELA',
    parcela_label: t.parcela === 1 ? '1ª Parcela (50%, sem descontos)' : '2ª Parcela (50% restante)',
    parcela_obs: t.parcela === 1 ? 'Pago entre fev e nov · sem INSS/IRRF' : 'Pago até 20/dez · INSS + IRRF sobre o INTEGRAL',
    meses_trabalhados: t.meses_trabalhados,
    salario_base: fmtBRL(t.salario_base),
    valor_integral: fmtBRL(t.valor_integral),
    valor_parcela: fmtBRL(t.valor_parcela),
    descontos,
    total_descontos: fmtBRL(t.total_descontos),
    valor_liquido: fmtBRL(t.valor_liquido),
    data_pagamento: fmtData(t.data_pagamento || new Date()),
  };

  const filename = `13o_${t.ano}_p${t.parcela}_${emp.matricula}.pdf`;
  const pdf_path = await gerarPDFGenerico('decimo-terceiro', data, `13o/${t.ano}`, filename);
  await supabase.from('thirteenth_salary').update({ pdf_path }).eq('id', req.params.id);
  res.json({ pdf_path });
});

router.get('/:id/download', requireAuth, async (req, res) => {
  const { data: t } = await supabase.from('thirteenth_salary').select('pdf_path, ano, parcela, employees(nome_completo)').eq('id', req.params.id).single();
  if (!t?.pdf_path) return res.status(404).json({ error: 'PDF não gerado.' });
  const file = path.join(__dirname, '../../', t.pdf_path);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo não encontrado.' });
  res.download(file, `13o_${t.ano}_p${t.parcela}_${(t.employees?.nome_completo || 'funcionario').split(' ')[0]}.pdf`);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { data: t } = await supabase.from('thirteenth_salary').select('pdf_path').eq('id', req.params.id).single();
  if (t?.pdf_path) { try { fs.unlinkSync(path.join(__dirname, '../../', t.pdf_path)); } catch {} }
  await supabase.from('thirteenth_salary').delete().eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
