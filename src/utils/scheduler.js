const cron = require('node-cron');
const { supabase } = require('../config/supabase');
const { enviarEmLote } = require('../services/emailService');

async function executarAgendamentos() {
  const hoje = new Date().toISOString().split('T')[0];
  const { data: pendentes } = await supabase.from('scheduled_sends')
    .select('*').eq('status', 'agendado').lte('scheduled_date', hoje);

  if (!pendentes?.length) return;

  for (const ag of pendentes) {
    console.log(`[cron] Executando agendamento ${ag.id}...`);
    await supabase.from('scheduled_sends').update({ status: 'executando' }).eq('id', ag.id);

    try {
      let q = supabase.from('payslips').select('*, employees(*)').not('pdf_path', 'is', null)
        .eq('competencia_mes', ag.competencia_mes).eq('competencia_ano', ag.competencia_ano);
      if (ag.employee_filter === 'departamento' && ag.department_id) {
        q = q.eq('employees.department_id', ag.department_id);
      } else if (ag.employee_filter === 'selecionados' && ag.employee_ids?.length) {
        q = q.in('employee_id', ag.employee_ids);
      }
      const { data: pss } = await q;

      const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();

      const r = await enviarEmLote(pss || [], company || {}, ag.created_by);

      await supabase.from('scheduled_sends').update({
        status: 'concluido',
        executed_at: new Date().toISOString(),
        total_sent: r.enviados,
        total_errors: r.erros,
        log_detalhado: r.resultados,
      }).eq('id', ag.id);
    } catch (err) {
      await supabase.from('scheduled_sends').update({
        status: 'erro',
        executed_at: new Date().toISOString(),
        log_detalhado: { error: err.message },
      }).eq('id', ag.id);
    }
  }
}

function initScheduler() {
  // Executa diariamente às 7:55 e 8:05 (para cobrir o horário de envio)
  cron.schedule('55 7 * * *', executarAgendamentos);
  cron.schedule('5 8 * * *',  executarAgendamentos);
  console.log('  ⏰ Agendador de envios iniciado (7:55 e 8:05 diariamente)');
}

module.exports = { initScheduler, executarAgendamentos };
