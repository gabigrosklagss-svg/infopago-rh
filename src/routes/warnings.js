const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { gerarAdvertenciaPDF } = require('../services/pdf');
const path = require('path');
const fs = require('fs');

router.get('/:employee_id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('warnings').select('*')
    .eq('employee_id', req.params.employee_id).order('data_ocorrencia', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/', requireAuth, requireRole('admin', 'rh', 'gestor'), async (req, res) => {
  const payload = { ...req.body, aplicada_por: req.user.id };
  if (!payload.employee_id || !payload.tipo || !payload.data_ocorrencia || !payload.motivo) {
    return res.status(400).json({ error: 'employee_id, tipo, data_ocorrencia e motivo são obrigatórios.' });
  }
  if (payload.dias_suspensao === '' || payload.dias_suspensao == null) payload.dias_suspensao = 0;
  else payload.dias_suspensao = parseInt(payload.dias_suspensao) || 0;

  const { data, error } = await supabase.from('warnings').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body };
  delete payload.id; delete payload.created_at; delete payload.aplicada_por;
  const { data, error } = await supabase.from('warnings').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { error } = await supabase.from('warnings').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* GET /api/warnings/:id/pdf — gera (ou regera) e baixa o PDF da advertência */
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const { data: warning, error: e1 } = await supabase.from('warnings').select('*').eq('id', req.params.id).single();
    if (e1 || !warning) return res.status(404).json({ error: 'Advertência não encontrada.' });

    const { data: employee, error: e2 } = await supabase.from('employees').select('*').eq('id', warning.employee_id).single();
    if (e2 || !employee) return res.status(404).json({ error: 'Funcionário não encontrado.' });

    const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();

    const relPath = await gerarAdvertenciaPDF(warning, employee, company || {});
    const fullPath = path.join(__dirname, '../../', relPath);
    if (!fs.existsSync(fullPath)) return res.status(500).json({ error: 'PDF não foi gerado.' });

    const nomeArq = `Advertencia_${employee.matricula}_${(employee.nome_completo || '').split(' ')[0]}_${warning.data_ocorrencia}.pdf`;
    res.download(fullPath, nomeArq);
  } catch (err) {
    console.error('[warnings/pdf]', err);
    res.status(500).json({ error: `Erro ao gerar PDF: ${err.message}` });
  }
});

module.exports = router;
