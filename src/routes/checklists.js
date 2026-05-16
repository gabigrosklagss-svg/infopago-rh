const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

/* Templates padrão de checklist */
const TEMPLATES = {
  onboarding: [
    { titulo: 'Coletar documentos pessoais',                       responsavel: 'rh',           ordem: 1, descricao: 'RG, CPF, CTPS, comprovante de residência, foto 3x4, título de eleitor, reservista (homens)' },
    { titulo: 'Assinar contrato de trabalho',                      responsavel: 'rh',           ordem: 2 },
    { titulo: 'Exame médico admissional',                          responsavel: 'rh',           ordem: 3, descricao: 'Agendar e obter ASO (Atestado de Saúde Ocupacional)' },
    { titulo: 'Cadastrar no sistema de RH',                        responsavel: 'rh',           ordem: 4 },
    { titulo: 'Solicitar criação de e-mail corporativo',           responsavel: 'ti',           ordem: 5 },
    { titulo: 'Entregar equipamentos (notebook, crachá, EPIs)',    responsavel: 'ti',           ordem: 6 },
    { titulo: 'Apresentar política interna e código de conduta',   responsavel: 'rh',           ordem: 7 },
    { titulo: 'Apresentação à equipe e gestor direto',             responsavel: 'gestor',       ordem: 8 },
    { titulo: 'Treinamento inicial do cargo',                      responsavel: 'gestor',       ordem: 9 },
    { titulo: 'Liberar acesso a ferramentas/sistemas',             responsavel: 'ti',           ordem: 10 },
    { titulo: 'Comunicar início de contrato de experiência',       responsavel: 'rh',           ordem: 11, descricao: 'Marcar avaliação aos 45 e 90 dias' },
  ],
  offboarding: [
    { titulo: 'Solicitar aviso prévio (trabalhado ou indenizado)', responsavel: 'rh',           ordem: 1 },
    { titulo: 'Exame médico demissional',                          responsavel: 'rh',           ordem: 2 },
    { titulo: 'Devolver equipamentos (notebook, crachá, EPIs)',    responsavel: 'funcionario',  ordem: 3 },
    { titulo: 'Revogar acessos a sistemas e e-mail',               responsavel: 'ti',           ordem: 4 },
    { titulo: 'Calcular rescisão (TRCT)',                          responsavel: 'rh',           ordem: 5, descricao: 'Saldo de salário, férias proporcionais, 13º proporcional, FGTS, multa 40% (se aplicável)' },
    { titulo: 'Pagamento da rescisão',                             responsavel: 'financeiro',   ordem: 6 },
    { titulo: 'Homologação no sindicato (se aplicável)',           responsavel: 'rh',           ordem: 7 },
    { titulo: 'Entregar guias do FGTS e seguro-desemprego',        responsavel: 'rh',           ordem: 8 },
    { titulo: 'Baixa na CTPS Digital',                             responsavel: 'rh',           ordem: 9 },
    { titulo: 'Atualizar status do funcionário no sistema',        responsavel: 'rh',           ordem: 10 },
    { titulo: 'Entrevista de desligamento (opcional)',             responsavel: 'rh',           ordem: 11, obrigatorio: false },
  ],
};

/* GET /api/checklists/:employee_id */
router.get('/:employee_id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('process_checklists')
    .select('*, checklist_items(*)')
    .eq('employee_id', req.params.employee_id)
    .order('created_at', { ascending: false });
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

/* POST /api/checklists — cria checklist a partir do template */
router.post('/', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { employee_id, tipo, observacoes } = req.body;
  if (!employee_id || !TEMPLATES[tipo]) {
    return res.status(400).json({ error: 'employee_id e tipo (onboarding|offboarding) são obrigatórios.' });
  }

  const { data: ckl, error: e1 } = await supabase.from('process_checklists').insert({
    employee_id, tipo, observacoes,
    responsavel_rh: req.user.id,
  }).select().single();
  if (e1) return res.status(400).json({ error: e1.message });

  const items = TEMPLATES[tipo].map(t => ({
    checklist_id: ckl.id,
    titulo: t.titulo,
    descricao: t.descricao,
    responsavel: t.responsavel,
    ordem: t.ordem,
    obrigatorio: t.obrigatorio !== false,
  }));
  await supabase.from('checklist_items').insert(items);

  const { data: full } = await supabase.from('process_checklists')
    .select('*, checklist_items(*)').eq('id', ckl.id).single();
  res.status(201).json(full);
});

/* PUT /api/checklists/items/:id — concluir/desconcluir item */
router.put('/items/:id', requireAuth, async (req, res) => {
  const { concluido, observacao } = req.body;
  const payload = {
    concluido: !!concluido,
    observacao,
    data_conclusao: concluido ? new Date().toISOString() : null,
    concluido_por: concluido ? req.user.id : null,
  };
  const { data, error } = await supabase.from('checklist_items').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Verifica se todos os obrigatórios estão concluídos → marca checklist como concluído
  if (concluido && data.checklist_id) {
    const { data: items } = await supabase.from('checklist_items').select('concluido, obrigatorio').eq('checklist_id', data.checklist_id);
    const todos = items.filter(i => i.obrigatorio).every(i => i.concluido);
    if (todos) {
      await supabase.from('process_checklists').update({
        status: 'concluido',
        data_conclusao: new Date().toISOString().split('T')[0],
      }).eq('id', data.checklist_id);
    }
  }
  res.json(data);
});

/* DELETE /api/checklists/:id */
router.delete('/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { error } = await supabase.from('process_checklists').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

module.exports = router;
