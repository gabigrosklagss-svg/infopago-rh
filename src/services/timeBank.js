/**
 * Regras de banco de horas + compensação automática
 * CLT art. 59 §2º: 180 dias (individual) ou 365 dias (coletivo)
 */
const { supabase } = require('../config/supabase');

async function getRegras() {
  const { data } = await supabase.from('time_bank_rules').select('*').eq('ativo', true).limit(1).maybeSingle();
  return data || {
    limite_acumulo_horas: 60, prazo_compensacao_dias: 180,
    permite_negativo: true, conversao_he50: 1.0, conversao_he100: 1.0,
    expira_automatico: true, forma_expiracao: 'paga',
  };
}

async function getSaldoAtual(employee_id) {
  const { data } = await supabase.from('time_bank_balance')
    .select('saldo_horas').eq('employee_id', employee_id).maybeSingle();
  return parseFloat(data?.saldo_horas || 0);
}

async function atualizarSaldo(employee_id, novoSaldo) {
  await supabase.from('time_bank_balance').upsert({
    employee_id,
    saldo_horas: parseFloat(novoSaldo.toFixed(2)),
    ultima_atualizacao: new Date().toISOString(),
  }, { onConflict: 'employee_id' });
}

/**
 * Registra uma transação no banco de horas e atualiza o saldo.
 * @param {object} opts { employee_id, tipo, horas, data_referencia, descricao, related_entry_id, created_by }
 */
async function lancar(opts) {
  const regras = await getRegras();
  const saldoAnterior = await getSaldoAtual(opts.employee_id);
  let horas = parseFloat(opts.horas);
  if (isNaN(horas)) throw new Error('Horas inválidas');

  // Aplica limite de acúmulo
  if (horas > 0 && (saldoAnterior + horas) > regras.limite_acumulo_horas) {
    horas = regras.limite_acumulo_horas - saldoAnterior;
    if (horas <= 0) {
      return { aplicado: 0, motivo: 'limite_acumulo_atingido', saldo: saldoAnterior };
    }
  }

  // Bloqueia negativo se regra impede
  if (horas < 0 && !regras.permite_negativo && (saldoAnterior + horas) < 0) {
    horas = -saldoAnterior;
    if (horas >= 0) {
      return { aplicado: 0, motivo: 'sem_saldo', saldo: saldoAnterior };
    }
  }

  const saldoPosterior = parseFloat((saldoAnterior + horas).toFixed(2));
  const dataRef = opts.data_referencia || new Date().toISOString().slice(0, 10);
  const dataExp = new Date(dataRef);
  dataExp.setDate(dataExp.getDate() + regras.prazo_compensacao_dias);

  const { data: tx, error } = await supabase.from('time_bank_transactions').insert({
    employee_id: opts.employee_id,
    tipo: opts.tipo,
    horas,
    data_referencia: dataRef,
    data_expiracao: dataExp.toISOString().slice(0, 10),
    saldo_anterior: saldoAnterior,
    saldo_posterior: saldoPosterior,
    descricao: opts.descricao,
    related_entry_id: opts.related_entry_id || null,
    created_by: opts.created_by || null,
  }).select().single();
  if (error) throw new Error(error.message);

  await atualizarSaldo(opts.employee_id, saldoPosterior);
  return { aplicado: horas, tx, saldo: saldoPosterior };
}

/**
 * Aplica compensação automática (folga descontando saldo positivo).
 * @param {object} opts { employee_id, data_folga, horas, descricao, created_by }
 */
async function compensarFolga(opts) {
  const horas = parseFloat(opts.horas);
  if (!horas || horas <= 0) throw new Error('Horas de folga devem ser positivas');
  const saldoAtual = await getSaldoAtual(opts.employee_id);
  if (saldoAtual < horas) {
    throw new Error(`Saldo insuficiente (${saldoAtual.toFixed(2)}h disponíveis, ${horas}h solicitadas).`);
  }
  return await lancar({
    employee_id: opts.employee_id,
    tipo: 'compensacao_folga',
    horas: -horas,                 // débito
    data_referencia: opts.data_folga || new Date().toISOString().slice(0, 10),
    descricao: opts.descricao || `Folga compensatória (${horas}h)`,
    created_by: opts.created_by,
  });
}

/**
 * Processa expirações: horas que passaram do prazo viram pagamento ou perda.
 * Executado por cron diário.
 */
async function processarExpiracoes() {
  const regras = await getRegras();
  if (!regras.expira_automatico) return { processadas: 0 };

  const hoje = new Date().toISOString().slice(0, 10);

  // Busca transações de crédito não compensadas com data_expiracao <= hoje
  const { data: vencidas } = await supabase.from('time_bank_transactions')
    .select('*')
    .eq('tipo', 'credito_he')
    .lte('data_expiracao', hoje);

  if (!vencidas?.length) return { processadas: 0 };

  // Agrupa por funcionário e soma o saldo expirado
  const porEmp = {};
  vencidas.forEach(v => {
    porEmp[v.employee_id] = (porEmp[v.employee_id] || 0) + parseFloat(v.horas);
  });

  let processadas = 0;
  for (const [employee_id, horasExp] of Object.entries(porEmp)) {
    if (horasExp <= 0) continue;
    await lancar({
      employee_id,
      tipo: 'expiracao',
      horas: -horasExp,
      data_referencia: hoje,
      descricao: `${regras.forma_expiracao === 'paga' ? 'Pagamento em folha' : 'Perda'} de ${horasExp.toFixed(2)}h expiradas (CLT 180d)`,
    });
    processadas++;
  }
  return { processadas };
}

async function extrato(employee_id, limit = 50) {
  const { data } = await supabase.from('time_bank_transactions')
    .select('*')
    .eq('employee_id', employee_id)
    .order('data_referencia', { ascending: false })
    .limit(limit);
  return data || [];
}

module.exports = { lancar, compensarFolga, processarExpiracoes, getSaldoAtual, getRegras, extrato };
