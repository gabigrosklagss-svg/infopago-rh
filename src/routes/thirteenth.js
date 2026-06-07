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

/* POST /:id/send-email — envia o PDF do 13º por e-mail ao funcionário */
router.post('/:id/send-email', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const nodemailer = require('nodemailer');
  const { data: t } = await supabase.from('thirteenth_salary')
    .select('*, employees(*)').eq('id', req.params.id).single();
  if (!t) return res.status(404).json({ error: 'Registro não encontrado.' });
  if (!t.pdf_path) return res.status(400).json({ error: 'Gere o PDF antes de enviar.' });

  const file = path.join(__dirname, '../../', t.pdf_path);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Arquivo PDF não encontrado no disco.' });

  const emp = t.employees;
  const email = emp.email_corporativo || emp.email_pessoal;
  if (!email) return res.status(400).json({ error: 'Funcionário sem e-mail cadastrado.' });

  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();
  const c = company || {};
  if (!c.smtp_host || !c.smtp_user) return res.status(400).json({ error: 'SMTP não configurado.' });

  const parcelaTxt = t.parcela === 1 ? '1ª parcela' : '2ª parcela';
  const valor = Number(t.valor_liquido).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7fb;margin:0;padding:32px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">
  <div style="background:linear-gradient(135deg,#0F2E1E,#1FAB54);color:#fff;padding:24px 32px">
    <h1 style="margin:0;font-size:20px">13º Salário — ${parcelaTxt} de ${t.ano}</h1>
    <p style="margin:8px 0 0;opacity:.9">${c.razao_social || ''}</p>
  </div>
  <div style="padding:28px 32px;color:#1F2D3D;font-size:14px;line-height:1.6">
    <p>Olá ${emp.nome_completo?.split(' ')[0] || ''},</p>
    <p>Segue em anexo o demonstrativo da <strong>${parcelaTxt} do 13º salário</strong> referente ao ano de ${t.ano}.</p>
    <div style="background:#f5f7fb;border-left:3px solid #1FAB54;padding:14px 18px;border-radius:6px;margin:18px 0">
      <strong>Valor líquido:</strong> ${valor}<br>
      <strong>Data de pagamento:</strong> ${new Date(t.data_pagamento).toLocaleDateString('pt-BR')}
    </div>
    <p style="font-size:12px;color:#697386">Qualquer dúvida, entre em contato com o RH.</p>
  </div>
</div></body></html>`;

  const transporter = nodemailer.createTransport({
    host: c.smtp_host, port: parseInt(c.smtp_port) || 587, secure: false,
    auth: { user: c.smtp_user, pass: c.smtp_pass },
  });
  try {
    await transporter.sendMail({
      from: `"${c.email_nome_remetente || 'RH'}" <${c.smtp_user}>`,
      to: email,
      subject: `13º Salário · ${parcelaTxt} de ${t.ano}`,
      html,
      attachments: [{ filename: `13o_${t.ano}_p${t.parcela}.pdf`, path: file }],
    });
    res.json({ success: true, to: email });
  } catch (e) {
    res.status(500).json({ error: 'Falha no envio: ' + e.message });
  }
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { data: t } = await supabase.from('thirteenth_salary').select('pdf_path').eq('id', req.params.id).single();
  if (t?.pdf_path) { try { fs.unlinkSync(path.join(__dirname, '../../', t.pdf_path)); } catch {} }
  await supabase.from('thirteenth_salary').delete().eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
