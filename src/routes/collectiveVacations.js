const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

/* GET — lista todos os períodos de férias coletivas */
router.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('collective_vacations')
    .select('*, departments(nome)')
    .order('data_inicio', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('collective_vacations')
    .select('*, departments(nome)').eq('id', req.params.id).single();
  if (error) return res.status(400).json({ error: error.message });
  const { data: emps } = await supabase.from('collective_vacation_employees')
    .select('*, employees(nome_completo, matricula, departments(nome))')
    .eq('collective_vacation_id', req.params.id);
  data.funcionarios = emps || [];
  res.json(data);
});

router.post('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { titulo, data_inicio, data_fim, escopo, department_id, filial, observacoes } = req.body;
  if (!titulo || !data_inicio || !data_fim) {
    return res.status(400).json({ error: 'titulo, data_inicio e data_fim são obrigatórios.' });
  }
  const dias = Math.floor((new Date(data_fim) - new Date(data_inicio)) / 86400000) + 1;
  if (dias < 1) return res.status(400).json({ error: 'Período inválido.' });

  const payload = {
    titulo, data_inicio, data_fim, dias,
    escopo: escopo || 'empresa',
    department_id: department_id || null,
    filial: filial || null,
    observacoes,
    status: 'planejada',
  };
  const { data, error } = await supabase.from('collective_vacations').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body, updated_at: new Date().toISOString() };
  delete payload.id; delete payload.created_at; delete payload.departments; delete payload.funcionarios;
  if (payload.data_inicio && payload.data_fim) {
    payload.dias = Math.floor((new Date(payload.data_fim) - new Date(payload.data_inicio)) / 86400000) + 1;
  }
  const { data, error } = await supabase.from('collective_vacations').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: cv } = await supabase.from('collective_vacations').select('status').eq('id', req.params.id).single();
  if (cv?.status === 'aplicada') return res.status(400).json({ error: 'Não é possível excluir um período já aplicado. Cancele primeiro.' });
  const { error } = await supabase.from('collective_vacations').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* Aplica o período: cria lançamento em absences pra cada funcionário do escopo */
router.post('/:id/aplicar', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: cv, error: e1 } = await supabase.from('collective_vacations').select('*').eq('id', req.params.id).single();
  if (e1 || !cv) return res.status(404).json({ error: 'Período não encontrado.' });
  if (cv.status === 'aplicada') return res.status(400).json({ error: 'Período já foi aplicado.' });

  // Resolve funcionários do escopo
  let q = supabase.from('employees').select('id, nome_completo, matricula').eq('status', 'ativo');
  if (cv.escopo === 'departamento' && cv.department_id) q = q.eq('department_id', cv.department_id);
  if (cv.escopo === 'filial' && cv.filial) q = q.eq('filial', cv.filial);
  const { data: emps, error: e2 } = await q;
  if (e2) return res.status(400).json({ error: e2.message });

  if (!emps?.length) return res.status(400).json({ error: 'Nenhum funcionário no escopo selecionado.' });

  // Cria absences + associações em lote
  const absences = emps.map(e => ({
    employee_id: e.id,
    tipo: 'ferias',
    data_inicio: cv.data_inicio,
    data_fim: cv.data_fim,
    dias: cv.dias,
    justificado: true,
    descontar_salario: false,
    observacoes: `Férias coletivas: ${cv.titulo}`,
  }));
  const { data: absIns, error: e3 } = await supabase.from('absences').insert(absences).select();
  if (e3) return res.status(400).json({ error: e3.message });

  const links = emps.map((e, i) => ({
    collective_vacation_id: cv.id,
    employee_id: e.id,
    absence_id: absIns?.[i]?.id || null,
  }));
  await supabase.from('collective_vacation_employees').insert(links);

  await supabase.from('collective_vacations').update({
    status: 'aplicada',
    total_funcionarios: emps.length,
    aplicado_em: new Date().toISOString(),
    aplicado_por: req.user.id,
  }).eq('id', cv.id);

  res.json({ success: true, total: emps.length });
});

/* Cancela: reverte absences */
router.post('/:id/cancelar', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: cv } = await supabase.from('collective_vacations').select('status').eq('id', req.params.id).single();
  if (!cv) return res.status(404).json({ error: 'Não encontrado.' });
  if (cv.status === 'aplicada') {
    // Remove os absences vinculados
    const { data: links } = await supabase.from('collective_vacation_employees')
      .select('absence_id').eq('collective_vacation_id', req.params.id);
    const absIds = (links || []).map(l => l.absence_id).filter(Boolean);
    if (absIds.length) await supabase.from('absences').delete().in('id', absIds);
    await supabase.from('collective_vacation_employees').delete().eq('collective_vacation_id', req.params.id);
  }
  await supabase.from('collective_vacations').update({ status: 'cancelada', total_funcionarios: 0 }).eq('id', req.params.id);
  res.json({ success: true });
});

module.exports = router;
