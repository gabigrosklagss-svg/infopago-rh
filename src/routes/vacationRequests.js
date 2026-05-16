const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

/* GET /api/vacation-requests?status=pendente — lista solicitações */
router.get('/', requireAuth, async (req, res) => {
  const { status, employee_id } = req.query;
  let q = supabase.from('vacation_requests')
    .select('*, employees(nome_completo, matricula, departments(nome))')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (employee_id) q = q.eq('employee_id', employee_id);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

/* POST /api/vacation-requests — funcionário ou RH solicita férias */
router.post('/', requireAuth, async (req, res) => {
  const { employee_id, data_inicio_pretendida, data_fim_pretendida, dias_vendidos, adiantar_13, observacao_funcionario } = req.body;
  if (!employee_id || !data_inicio_pretendida || !data_fim_pretendida) {
    return res.status(400).json({ error: 'employee_id, data_inicio e data_fim são obrigatórios.' });
  }
  const dias = Math.floor((new Date(data_fim_pretendida) - new Date(data_inicio_pretendida)) / 86400000) + 1;
  if (dias < 1) return res.status(400).json({ error: 'Período inválido.' });

  const payload = {
    employee_id,
    data_inicio_pretendida,
    data_fim_pretendida,
    dias_solicitados: dias,
    dias_vendidos: parseInt(dias_vendidos) || 0,
    adiantar_13: !!adiantar_13,
    observacao_funcionario,
    status: 'pendente',
    solicitado_por: req.user.id,
  };
  const { data, error } = await supabase.from('vacation_requests').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

/* PUT /api/vacation-requests/:id/aprovar — gestor/RH aprova */
router.put('/:id/aprovar', requireAuth, requireRole('admin', 'rh', 'gestor'), async (req, res) => {
  const { observacao_gestor } = req.body;
  const { data: vr } = await supabase.from('vacation_requests').select('*').eq('id', req.params.id).single();
  if (!vr) return res.status(404).json({ error: 'Solicitação não encontrada.' });
  if (vr.status !== 'pendente') return res.status(400).json({ error: 'Solicitação já decidida.' });

  // Atualiza solicitação
  const { data, error } = await supabase.from('vacation_requests').update({
    status: 'aprovada',
    observacao_gestor,
    aprovado_por: req.user.id,
    data_decisao: new Date().toISOString(),
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Cria registro em absences (tipo=ferias)
  await supabase.from('absences').insert({
    employee_id: vr.employee_id,
    tipo: 'ferias',
    data_inicio: vr.data_inicio_pretendida,
    data_fim: vr.data_fim_pretendida,
    dias: vr.dias_solicitados,
    justificado: true,
    descontar_salario: false,
    observacoes: `Férias aprovadas (solicitação #${vr.id.slice(0, 8)})${vr.dias_vendidos ? ` · ${vr.dias_vendidos} dias vendidos` : ''}`,
  });

  // Atualiza vacations (dias_gozados, dias_vendidos)
  if (vr.vacation_id) {
    const { data: vac } = await supabase.from('vacations').select('*').eq('id', vr.vacation_id).single();
    if (vac) {
      await supabase.from('vacations').update({
        dias_gozados: (vac.dias_gozados || 0) + vr.dias_solicitados,
        dias_vendidos: (vac.dias_vendidos || 0) + (vr.dias_vendidos || 0),
        data_gozo_inicio: vr.data_inicio_pretendida,
        data_gozo_fim: vr.data_fim_pretendida,
        status: 'a_gozar',
      }).eq('id', vr.vacation_id);
    }
  }

  res.json(data);
});

/* PUT /api/vacation-requests/:id/negar */
router.put('/:id/negar', requireAuth, requireRole('admin', 'rh', 'gestor'), async (req, res) => {
  const { observacao_gestor } = req.body;
  const { data, error } = await supabase.from('vacation_requests').update({
    status: 'negada',
    observacao_gestor,
    aprovado_por: req.user.id,
    data_decisao: new Date().toISOString(),
  }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

/* DELETE /api/vacation-requests/:id — cancela (só se pendente) */
router.delete('/:id', requireAuth, async (req, res) => {
  const { data: vr } = await supabase.from('vacation_requests').select('status').eq('id', req.params.id).single();
  if (vr?.status !== 'pendente') return res.status(400).json({ error: 'Só é possível cancelar solicitações pendentes.' });
  await supabase.from('vacation_requests').update({ status: 'cancelada', data_decisao: new Date().toISOString() }).eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
