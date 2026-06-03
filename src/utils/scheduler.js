const cron = require('node-cron');
const { supabase } = require('../config/supabase');
const { enviarEmLote } = require('../services/emailService');
const { executarBackup } = require('../services/backup');
const { enviarDigestRH } = require('../services/notifications');

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
  // Envio de holerites agendados — diariamente 7:55 e 8:05
  cron.schedule('55 7 * * *', executarAgendamentos);
  cron.schedule('5 8 * * *',  executarAgendamentos);

  // Backup automático diário às 03:00
  cron.schedule('0 3 * * *', async () => {
    try {
      await executarBackup();
    } catch (err) {
      console.warn('[backup] falha:', err.message);
    }
  });

  // Digest matinal do RH — diariamente às 07:00
  cron.schedule('0 7 * * 1-5', async () => {
    try { await enviarDigestRH(); }
    catch (err) { console.warn('[digest] falha:', err.message); }
  });

  // Expiração de banco de horas — 02:00 todos os dias
  cron.schedule('0 2 * * *', async () => {
    try {
      const { processarExpiracoes } = require('../services/timeBank');
      const r = await processarExpiracoes();
      if (r.processadas > 0) console.log(`[time_bank] ${r.processadas} expiração(ões) processada(s)`);
    } catch (err) { console.warn('[time_bank] falha:', err.message); }
  });

  console.log('   Agendador iniciado: envios 7:55/8:05 · digest 07:00 · backup 03:00');
}

module.exports = { initScheduler, executarAgendamentos };
