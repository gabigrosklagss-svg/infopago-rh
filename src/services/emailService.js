const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const { supabase } = require('../config/supabase');

const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function buildTransporter(company) {
  return nodemailer.createTransport({
    host: company.smtp_host || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(company.smtp_port) || 587,
    secure: false,
    auth: {
      user: company.smtp_user || process.env.GMAIL_USER,
      pass: company.smtp_pass || process.env.GMAIL_APP_PASSWORD,
    },
  });
}

function buildHTML(employee, payslip, company, token, baseUrl) {
  const competencia = `${meses[payslip.competencia_mes - 1]} / ${payslip.competencia_ano}`;
  const liquido = Number(payslip.salario_liquido).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const linkConfirma = `${baseUrl}/confirmar/${token}`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7fb;margin:0;padding:32px">
<div style="max-width:560px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">
  <div style="background:#1f3a8a;color:#fff;padding:24px 32px">
    <h1 style="margin:0;font-size:20px">Holerite — ${competencia}</h1>
    <p style="margin:8px 0 0;opacity:.9">${company.razao_social || 'Sua empresa'}</p>
  </div>
  <div style="padding:32px">
    <p>Olá <strong>${(employee.nome_completo || '').split(' ')[0]}</strong>,</p>
    <p>Segue em anexo o seu holerite referente a <strong>${competencia}</strong>.</p>
    <div style="background:#f0f4ff;border-left:4px solid #1f3a8a;padding:16px;border-radius:6px;margin:24px 0">
      <p style="margin:0;color:#555">Salário líquido</p>
      <p style="margin:4px 0 0;font-size:24px;font-weight:700;color:#1f3a8a">${liquido}</p>
    </div>
    <p>Por favor, confirme o recebimento clicando no botão abaixo:</p>
    <p style="text-align:center;margin:32px 0">
      <a href="${linkConfirma}" style="background:#1f3a8a;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;display:inline-block">✓ Confirmar recebimento</a>
    </p>
    <p style="color:#888;font-size:13px;margin-top:32px">Em caso de dúvida sobre os valores, entre em contato com o RH.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#aaa;font-size:12px;text-align:center;margin:0">${company.razao_social || ''} · ${company.cnpj || ''}</p>
  </div>
</div></body></html>`;
}

async function enviarHolerite(payslip, employee, company, userId) {
  const recipient = employee.email_corporativo || employee.email_pessoal;
  if (!recipient) throw new Error('Funcionário sem e-mail cadastrado.');

  const pdfFullPath = path.join(__dirname, '../../', payslip.pdf_path);
  if (!fs.existsSync(pdfFullPath)) throw new Error('PDF do holerite não encontrado.');

  const competencia = `${meses[payslip.competencia_mes - 1]} / ${payslip.competencia_ano}`;
  const subject = `Holerite ${competencia} - ${company.razao_social || 'RH'}`;

  // Cria log com token de confirmação
  const { data: log } = await supabase.from('email_logs').insert({
    payslip_id: payslip.id,
    employee_id: employee.id,
    recipient_email: recipient,
    subject,
    sent_by: userId,
    status: 'pendente',
  }).select().single();

  const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`;

  try {
    const transporter = buildTransporter(company);
    await transporter.sendMail({
      from: `"${company.email_nome_remetente || 'RH'}" <${company.smtp_user || process.env.GMAIL_USER}>`,
      to: recipient,
      subject,
      html: buildHTML(employee, payslip, company, log.confirmation_token, baseUrl),
      attachments: [{
        filename: `Holerite_${(employee.nome_completo || '').split(' ')[0]}_${competencia.replace(/[\/ ]/g, '_')}.pdf`,
        path: pdfFullPath,
      }],
    });

    await supabase.from('email_logs').update({ status: 'enviado', sent_at: new Date().toISOString() }).eq('id', log.id);
    await supabase.from('payslips').update({ status: 'enviado' }).eq('id', payslip.id);

    return { success: true, log_id: log.id, recipient };
  } catch (err) {
    await supabase.from('email_logs').update({ status: 'erro', error_message: err.message }).eq('id', log.id);
    throw err;
  }
}

async function enviarEmLote(payslips, company, userId) {
  const resultados = [];
  for (const ps of payslips) {
    try {
      const r = await enviarHolerite(ps, ps.employees, company, userId);
      resultados.push({ payslip_id: ps.id, nome: ps.employees?.nome_completo, ...r });
    } catch (err) {
      resultados.push({ payslip_id: ps.id, nome: ps.employees?.nome_completo, success: false, error: err.message });
    }
    await new Promise(r => setTimeout(r, 500)); // 0.5s entre envios
  }
  const ok = resultados.filter(r => r.success).length;
  return { total: payslips.length, enviados: ok, erros: payslips.length - ok, resultados };
}

/* ──────────────────────────────────────────────────────
   ENVIO DE COMUNICADO PARA MÚLTIPLOS FUNCIONÁRIOS
   ────────────────────────────────────────────────────── */
function buildComunicadoHTML(announcement, company) {
  const importanteBadge = announcement.importante
    ? '<span style="background:#fee2e2;color:#b91c1c;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:14px;display:inline-block">⚠ Importante</span>'
    : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7fb;margin:0;padding:32px">
<div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">
  <div style="background:linear-gradient(135deg,#0F2E1E,#1FAB54);color:#fff;padding:28px 32px">
    <h1 style="margin:0;font-size:22px;letter-spacing:-.01em">${announcement.titulo}</h1>
    <p style="margin:8px 0 0;opacity:.9;font-size:13px">${company.razao_social || 'Comunicado oficial'}</p>
  </div>
  <div style="padding:28px 32px;color:#1F2D3D">
    ${importanteBadge}
    <div style="font-size:14px;line-height:1.7;white-space:pre-wrap">${(announcement.conteudo || '').replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))}</div>
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e3e8ee;font-size:12px;color:#697386">
      Enviado por <strong>${announcement.autor_nome || 'RH'}</strong>${announcement.data_expiracao ? ` · Válido até ${announcement.data_expiracao}` : ''}<br>
      Este é um e-mail automático do sistema InfoPago RH. Para dúvidas, responda este e-mail.
    </div>
  </div>
</div></body></html>`;
}

async function enviarComunicado(announcement, recipients, company, userId) {
  if (!recipients?.length) return { enviados: 0, falhas: 0, total: 0 };
  const transporter = buildTransporter(company);
  const fromName = company.email_nome_remetente || 'RH';
  const fromAddr = company.smtp_user || process.env.GMAIL_USER;
  const html = buildComunicadoHTML(announcement, company);
  const subject = `${announcement.importante ? '[Importante] ' : ''}${announcement.titulo}`;

  let enviados = 0, falhas = 0;
  const logs = [];
  for (const r of recipients) {
    if (!r.email) { falhas++; logs.push({ employee_id: r.id, success: false, error: 'sem e-mail cadastrado' }); continue; }
    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromAddr}>`,
        to: r.email,
        subject,
        html,
      });
      enviados++;
      logs.push({ employee_id: r.id, email: r.email, success: true });
    } catch (e) {
      falhas++;
      logs.push({ employee_id: r.id, email: r.email, success: false, error: e.message });
    }
  }
  return { enviados, falhas, total: recipients.length, logs };
}

module.exports = { enviarHolerite, enviarEmLote, enviarComunicado };
