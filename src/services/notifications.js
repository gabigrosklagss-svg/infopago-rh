/**
 * Notificações diárias para o RH por e-mail.
 * Roda via cron 07:00 (configurado em scheduler.js).
 * Envia digest matinal com tudo que merece atenção.
 */
const { supabase } = require('../config/supabase');

async function coletarAlertas() {
  const hoje = new Date();
  const em30 = new Date(hoje); em30.setDate(em30.getDate() + 30);
  const em45 = new Date(hoje); em45.setDate(em45.getDate() + 45);
  const isoHoje = hoje.toISOString().slice(0, 10);
  const iso30  = em30.toISOString().slice(0, 10);
  const iso45  = em45.toISOString().slice(0, 10);

  const out = {
    ferias_vencidas: [],
    ferias_vencendo: [],
    contratos_experiencia: [],
    epis_vencendo: [],
    documentos_vencendo: [],
    aniversariantes: [],
    holerites_pendentes: 0,
  };

  // Férias vencidas (período aquisitivo > hoje, ainda não gozadas)
  const { data: vencidas } = await supabase.from('vacations')
    .select('employees(nome_completo, matricula, departments(nome)), periodo_aquisitivo_fim, periodo_aquisitivo_inicio')
    .lt('periodo_aquisitivo_fim', isoHoje)
    .neq('status', 'concluido');
  out.ferias_vencidas = (vencidas || []).map(v => ({
    nome: v.employees?.nome_completo,
    depto: v.employees?.departments?.nome,
    matricula: v.employees?.matricula,
    venceu_em: v.periodo_aquisitivo_fim,
  }));

  // Férias vencendo em 30 dias
  const { data: vencendo } = await supabase.from('vacations')
    .select('employees(nome_completo, matricula, departments(nome)), periodo_aquisitivo_fim')
    .gte('periodo_aquisitivo_fim', isoHoje).lte('periodo_aquisitivo_fim', iso30)
    .neq('status', 'concluido');
  out.ferias_vencendo = (vencendo || []).map(v => ({
    nome: v.employees?.nome_completo,
    depto: v.employees?.departments?.nome,
    vence_em: v.periodo_aquisitivo_fim,
    dias_restantes: Math.ceil((new Date(v.periodo_aquisitivo_fim) - hoje) / 86400000),
  }));

  // Contratos de experiência terminando em 45 dias
  const { data: emps } = await supabase.from('employees')
    .select('nome_completo, matricula, data_admissao, departments(nome)')
    .eq('status', 'ativo');
  (emps || []).forEach(e => {
    if (!e.data_admissao) return;
    const adm = new Date(e.data_admissao);
    const exp45 = new Date(adm); exp45.setDate(adm.getDate() + 45);
    const exp90 = new Date(adm); exp90.setDate(adm.getDate() + 90);
    if (exp45 >= hoje && exp45 <= em45) out.contratos_experiencia.push({
      nome: e.nome_completo, depto: e.departments?.nome,
      etapa: '1ª etapa (45d)', data: exp45.toISOString().slice(0, 10),
    });
    if (exp90 >= hoje && exp90 <= em45) out.contratos_experiencia.push({
      nome: e.nome_completo, depto: e.departments?.nome,
      etapa: 'Efetivação (90d)', data: exp90.toISOString().slice(0, 10),
    });
  });

  // EPIs vencendo em 30 dias (entregas com data_vencimento)
  const { data: episEnt } = await supabase.from('epi_deliveries')
    .select('data_vencimento, employees(nome_completo, departments(nome)), epis(nome, ca)')
    .gte('data_vencimento', isoHoje).lte('data_vencimento', iso30);
  out.epis_vencendo = (episEnt || []).map(e => ({
    funcionario: e.employees?.nome_completo,
    depto: e.employees?.departments?.nome,
    epi: e.epis?.nome,
    ca: e.epis?.ca,
    vencimento: e.data_vencimento,
  }));

  // Documentos vencendo (exames, CNH, etc.)
  const { data: docs } = await supabase.from('employee_documents')
    .select('data_validade, tipo, descricao, employees(nome_completo, departments(nome))')
    .gte('data_validade', isoHoje).lte('data_validade', iso30);
  out.documentos_vencendo = (docs || []).map(d => ({
    funcionario: d.employees?.nome_completo,
    depto: d.employees?.departments?.nome,
    tipo: d.tipo, descricao: d.descricao,
    vencimento: d.data_validade,
  }));

  // Aniversariantes do dia
  (emps || []).forEach(e => {
    if (!e.data_admissao) return;
  });
  const { data: empsCompletos } = await supabase.from('employees')
    .select('nome_completo, data_nascimento, departments(nome)')
    .eq('status', 'ativo');
  (empsCompletos || []).forEach(e => {
    if (!e.data_nascimento) return;
    const d = new Date(e.data_nascimento + 'T12:00:00');
    if (d.getDate() === hoje.getDate() && d.getMonth() === hoje.getMonth()) {
      out.aniversariantes.push({
        nome: e.nome_completo, depto: e.departments?.nome,
        idade: hoje.getFullYear() - d.getFullYear(),
      });
    }
  });

  // Holerites pendentes (gerados, não enviados) no mês corrente
  const mes = hoje.getMonth() + 1, ano = hoje.getFullYear();
  const { count } = await supabase.from('payslips')
    .select('id', { count: 'exact', head: true })
    .eq('competencia_mes', mes).eq('competencia_ano', ano)
    .eq('status', 'gerado'); // gerado mas não enviado
  out.holerites_pendentes = count || 0;

  return out;
}

function buildHTMLDigest(alertas, company) {
  const dataPt = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const totalAlertas =
    alertas.ferias_vencidas.length +
    alertas.ferias_vencendo.length +
    alertas.contratos_experiencia.length +
    alertas.epis_vencendo.length +
    alertas.documentos_vencendo.length +
    alertas.aniversariantes.length +
    (alertas.holerites_pendentes > 0 ? 1 : 0);

  const secao = (titulo, items, render, cor) =>
    items.length === 0 ? '' : `
    <div style="margin-top:24px">
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:${cor};margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid ${cor}">${titulo} <span style="float:right;color:#697386;font-weight:500;font-size:11.5px">${items.length}</span></h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        ${items.map(render).join('')}
      </table>
    </div>`;

  const linha = (cells) => `<tr>${cells.map(c => `<td style="padding:8px 12px;border-bottom:1px solid #e3e8ee">${c}</td>`).join('')}</tr>`;

  let conteudo = '';
  conteudo += secao('🔴 Férias VENCIDAS — risco multa em dobro',
    alertas.ferias_vencidas,
    f => linha([
      `<strong>${f.nome}</strong><br><small style="color:#697386">${f.matricula || ''} · ${f.depto || ''}</small>`,
      `Venceu em <strong>${new Date(f.venceu_em).toLocaleDateString('pt-BR')}</strong>`,
    ]),
    '#B42318'
  );
  conteudo += secao('🟡 Férias vencendo em 30 dias',
    alertas.ferias_vencendo,
    f => linha([
      `<strong>${f.nome}</strong><br><small style="color:#697386">${f.depto || ''}</small>`,
      `Vence em <strong>${f.dias_restantes}d</strong> (${new Date(f.vence_em).toLocaleDateString('pt-BR')})`,
    ]),
    '#B45309'
  );
  conteudo += secao('📋 Contratos de experiência terminando',
    alertas.contratos_experiencia,
    c => linha([
      `<strong>${c.nome}</strong><br><small style="color:#697386">${c.depto || ''}</small>`,
      `${c.etapa} em <strong>${new Date(c.data).toLocaleDateString('pt-BR')}</strong>`,
    ]),
    '#0369A1'
  );
  conteudo += secao('🦺 EPIs vencendo em 30 dias',
    alertas.epis_vencendo,
    e => linha([
      `<strong>${e.funcionario}</strong><br><small style="color:#697386">${e.depto || ''}</small>`,
      `${e.epi} ${e.ca ? `(CA ${e.ca})` : ''} · ${new Date(e.vencimento).toLocaleDateString('pt-BR')}`,
    ]),
    '#7C3AED'
  );
  conteudo += secao('📄 Documentos vencendo (CNH, exames, etc)',
    alertas.documentos_vencendo,
    d => linha([
      `<strong>${d.funcionario}</strong><br><small style="color:#697386">${d.depto || ''}</small>`,
      `${d.tipo} ${d.descricao || ''} · ${new Date(d.vencimento).toLocaleDateString('pt-BR')}`,
    ]),
    '#0891B2'
  );
  conteudo += secao('🎂 Aniversariantes de hoje',
    alertas.aniversariantes,
    a => linha([
      `<strong>${a.nome}</strong>`,
      `${a.idade} anos · ${a.depto || ''}`,
    ]),
    '#D946EF'
  );

  if (alertas.holerites_pendentes > 0) {
    conteudo += `<div style="margin-top:20px;padding:14px 18px;background:#FFFBEB;border-left:3px solid #B45309;border-radius:6px;font-size:13.5px">
      <strong>${alertas.holerites_pendentes} holerite(s) gerado(s) e ainda não enviado(s) este mês.</strong><br>
      <a href="#" style="color:#B45309">Ir para Envios e Agendamentos</a>
    </div>`;
  }

  if (totalAlertas === 0) {
    conteudo = `<div style="padding:32px;text-align:center;color:#15803d;font-size:14px">✓ Nenhuma pendência crítica para hoje. Bom dia!</div>`;
  }

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7fb;margin:0;padding:24px">
<div style="max-width:680px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08)">
  <div style="background:linear-gradient(135deg,#0F2E1E,#1FAB54);color:#fff;padding:26px 32px">
    <h1 style="margin:0;font-size:22px;letter-spacing:-.01em">Bom dia, RH! 👋</h1>
    <p style="margin:8px 0 0;opacity:.9;font-size:13px">Digest matinal de ${dataPt}</p>
    ${totalAlertas > 0 ? `<p style="margin:8px 0 0;opacity:.95;font-size:13px"><strong>${totalAlertas} alerta(s)</strong> que merecem sua atenção.</p>` : ''}
  </div>
  <div style="padding:20px 32px;color:#1F2D3D">${conteudo}</div>
  <div style="padding:16px 32px;background:#f5f7fb;font-size:11.5px;color:#697386">
    Enviado por <strong>InfoPago RH</strong> · ${company.razao_social || ''}<br>
    Para parar de receber este digest, contate o administrador.
  </div>
</div></body></html>`;
}

async function enviarDigestRH() {
  try {
    const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();
    if (!company?.smtp_host || !company?.smtp_user) {
      console.log('[notif] SMTP não configurado, pulando digest.');
      return;
    }

    // Decide destinatários: e-mail da empresa + super_admins
    const destinatarios = new Set();
    if (company.email_empresa) destinatarios.add(company.email_empresa);

    // Super admins do sistema
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('id, full_name')
      .eq('active', true);
    if (profiles?.length) {
      const ids = profiles.map(p => p.id);
      const { data: superAdmins } = await supabase
        .from('user_roles')
        .select('user_id, roles!inner(slug)')
        .eq('roles.slug', 'super_admin')
        .in('user_id', ids);
      const adminIds = (superAdmins || []).map(s => s.user_id);
      for (const id of adminIds) {
        try {
          const { data: au } = await supabase.auth.admin.getUserById(id);
          if (au?.user?.email) destinatarios.add(au.user.email);
        } catch {}
      }
    }

    if (!destinatarios.size) {
      console.log('[notif] Nenhum destinatário, pulando.');
      return;
    }

    const alertas = await coletarAlertas();
    const html = buildHTMLDigest(alertas, company);
    const subject = `[RH] Digest matinal · ${new Date().toLocaleDateString('pt-BR')}`;

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: company.smtp_host, port: parseInt(company.smtp_port) || 587, secure: false,
      auth: { user: company.smtp_user, pass: company.smtp_pass },
    });

    for (const to of destinatarios) {
      try {
        await transporter.sendMail({
          from: `"${company.email_nome_remetente || 'InfoPago RH'}" <${company.smtp_user}>`,
          to, subject, html,
        });
        console.log(`[notif] Digest enviado a ${to}`);
      } catch (e) {
        console.warn(`[notif] Falha ao enviar a ${to}:`, e.message);
      }
    }

    // Registra no log
    await supabase.from('notification_log').insert({
      tipo: 'digest_matinal',
      destinatarios: [...destinatarios],
      total_alertas: Object.values(alertas).flat().length,
      conteudo: alertas,
    }).catch(() => {});
  } catch (e) {
    console.error('[notif] Erro fatal:', e);
  }
}

module.exports = { coletarAlertas, buildHTMLDigest, enviarDigestRH };
