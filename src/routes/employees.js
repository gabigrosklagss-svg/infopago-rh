const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole, authorize, hasPermission } = require('../middleware/auth');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|png|webp)/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Apenas imagens JPG, PNG ou WebP.'));
  },
});

const PHOTOS_BUCKET = 'employee-photos';
const SUPABASE_URL = process.env.SUPABASE_URL;

// Campos que NÃO podem receber string vazia (Postgres rejeita UUID/ENUM/DATE "")
const NULLABLE_UUID  = ['department_id', 'position_id', 'gestor_id', 'created_by', 'updated_by'];
const NULLABLE_ENUM  = ['sexo', 'estado_civil', 'tipo_contrato', 'regime_trabalho', 'status', 'tipo_conta', 'tipo_pix', 'forma_pagamento'];
const NULLABLE_DATE  = ['data_demissao'];
const NUMERIC_FIELDS = [
  'salario_base', 'valor_hora', 'vt_valor_dia', 'vr_valor_dia', 'va_valor_mes',
  'plano_saude_valor', 'plano_odonto_valor', 'seguro_vida_valor',
  'vt_dias_uteis', 'vr_dias_uteis', 'num_dependentes', 'num_filhos_salario_familia', 'carga_horaria_semanal'
];
const BOOLEAN_FIELDS = [
  'tem_vt', 'tem_vr', 'tem_va', 'tem_plano_saude', 'tem_plano_odonto', 'tem_seguro_vida'
];

function sanitize(payload) {
  const clean = { ...payload };
  [...NULLABLE_UUID, ...NULLABLE_ENUM, ...NULLABLE_DATE].forEach(f => {
    if (clean[f] === '' || clean[f] === undefined) clean[f] = null;
  });
  NUMERIC_FIELDS.forEach(f => {
    if (clean[f] === '' || clean[f] == null) clean[f] = f === 'salario_base' ? null : 0;
    else if (typeof clean[f] === 'string') clean[f] = parseFloat(clean[f]) || 0;
  });
  BOOLEAN_FIELDS.forEach(f => {
    if (clean[f] === 'on' || clean[f] === 'true' || clean[f] === true) clean[f] = true;
    else if (clean[f] === '' || clean[f] == null) clean[f] = false;
    else clean[f] = Boolean(clean[f]);
  });
  delete clean.motivo_reajuste;
  return clean;
}

// GET /api/employees — listar
router.get('/', requireAuth, async (req, res) => {
  const { status, department_id, search, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let q = supabase.from('employees').select(`
    id, matricula, nome_completo, cpf, email_pessoal, email_corporativo,
    celular, data_admissao, salario_base, status, foto_url,
    departments(id,nome), positions(id,titulo)
  `, { count: 'exact' })
    .order('nome_completo')
    .range(offset, offset + parseInt(limit) - 1);

  if (status) q = q.eq('status', status);
  if (department_id) q = q.eq('department_id', department_id);
  if (search) q = q.or(`nome_completo.ilike.%${search}%,cpf.ilike.%${search}%,matricula.ilike.%${search}%`);

  const { data, error, count } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ data, total: count, page: parseInt(page), limit: parseInt(limit) });
});

// GET /api/employees/:id
router.get('/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('employees')
    .select('*, departments(nome,codigo), positions(titulo,cbo,nivel)')
    .eq('id', req.params.id)
    .single();
  if (error || !data) return res.status(404).json({ error: 'Funcionário não encontrado.' });
  res.json(data);
});

// POST /api/employees
router.post('/', requireAuth, async (req, res) => {
  const payload = sanitize({ ...req.body, created_by: req.user.id });

  const { data: dup } = await supabase.from('employees').select('id').eq('cpf', payload.cpf).maybeSingle();
  if (dup) return res.status(400).json({ error: 'CPF já cadastrado.' });

  if (!payload.matricula) {
    const { count } = await supabase.from('employees').select('id', { count: 'exact', head: true });
    payload.matricula = String((count || 0) + 1).padStart(4, '0');
  }

  if (payload.salario_base && payload.carga_horaria_semanal) {
    const hm = Math.round((parseInt(payload.carga_horaria_semanal) * 52) / 12);
    payload.valor_hora = parseFloat((parseFloat(payload.salario_base) / hm).toFixed(4));
  }

  const { data, error } = await supabase.from('employees').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Cria período aquisitivo inicial
  const inicio = payload.data_admissao;
  const fim = new Date(new Date(inicio).setFullYear(new Date(inicio).getFullYear() + 1) - 86400000)
    .toISOString().split('T')[0];
  await supabase.from('vacations').insert({
    employee_id: data.id,
    periodo_aquisitivo_inicio: inicio,
    periodo_aquisitivo_fim: fim,
    status: 'em_aquisicao',
  });

  res.status(201).json(data);
});

// PUT /api/employees/:id
router.put('/:id', requireAuth, authorize('employees.update'), async (req, res) => {
  const motivoReajuste = req.body.motivo_reajuste;
  const payload = sanitize({ ...req.body, updated_by: req.user.id });
  delete payload.id; delete payload.created_at; delete payload.created_by;
  delete payload.departments; delete payload.positions;

  // Bloqueia alteração de salário sem permissão financeira
  if (payload.salario_base !== undefined && !hasPermission(req.user, 'salary.update')) {
    const { data: cur } = await supabase.from('employees').select('salario_base').eq('id', req.params.id).single();
    if (cur && parseFloat(cur.salario_base || 0) !== parseFloat(payload.salario_base || 0)) {
      return res.status(403).json({
        error: 'Sem permissão para alterar salário. Necessária a permissão "salary.update" (Financeiro).',
        code: 'INSUFFICIENT_PERMISSIONS',
      });
    }
  }

  if (payload.salario_base && payload.carga_horaria_semanal) {
    const hm = Math.round((parseInt(payload.carga_horaria_semanal) * 52) / 12);
    payload.valor_hora = parseFloat((parseFloat(payload.salario_base) / hm).toFixed(4));
  }

  const { data: old } = await supabase.from('employees').select('salario_base').eq('id', req.params.id).single();
  if (old && payload.salario_base && parseFloat(old.salario_base) !== parseFloat(payload.salario_base)) {
    const pct = ((parseFloat(payload.salario_base) - parseFloat(old.salario_base)) / parseFloat(old.salario_base) * 100).toFixed(2);
    await supabase.from('salary_history').insert({
      employee_id: req.params.id,
      salario_anterior: old.salario_base,
      salario_novo: payload.salario_base,
      data_reajuste: new Date().toISOString().split('T')[0],
      motivo: motivoReajuste || 'Atualização cadastral',
      percentual_reajuste: pct,
      created_by: req.user.id,
    });
  }

  const { data, error } = await supabase.from('employees').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// DELETE /api/employees/:id — desativa
router.delete('/:id', requireAuth, authorize('employees.delete'), async (req, res) => {
  const { motivo_demissao, data_demissao } = req.body;
  const { error } = await supabase.from('employees').update({
    status: 'demitido',
    data_demissao: data_demissao || new Date().toISOString().split('T')[0],
    motivo_demissao,
    updated_by: req.user.id,
  }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

// POST /api/employees/:id/foto — upload pro Supabase Storage (bucket público)
router.post('/:id/foto', requireAuth, upload.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });

  const employee_id = req.params.id;
  const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
  const storage_path = `${employee_id}/foto_${Date.now()}.${ext}`;

  // Remove foto antiga
  const { data: emp } = await supabase.from('employees').select('foto_url').eq('id', employee_id).single();
  if (emp?.foto_url && emp.foto_url.includes('/storage/v1/object/public/employee-photos/')) {
    const oldPath = emp.foto_url.split('/employee-photos/')[1];
    if (oldPath) await supabase.storage.from(PHOTOS_BUCKET).remove([oldPath]).catch(() => {});
  }

  const { error: upErr } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storage_path, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true,
      cacheControl: '3600',
    });
  if (upErr) return res.status(500).json({ error: `Falha no upload: ${upErr.message}` });

  const foto_url = `${SUPABASE_URL}/storage/v1/object/public/${PHOTOS_BUCKET}/${storage_path}`;
  await supabase.from('employees').update({ foto_url, updated_by: req.user.id }).eq('id', employee_id);
  res.json({ foto_url });
});

// Subcoleções
router.get('/:id/historico-salarial', requireAuth, async (req, res) => {
  const { data } = await supabase.from('salary_history').select('*')
    .eq('employee_id', req.params.id).order('data_reajuste', { ascending: false });
  res.json(data || []);
});

router.get('/:id/ferias', requireAuth, async (req, res) => {
  const { data } = await supabase.from('vacations').select('*')
    .eq('employee_id', req.params.id).order('periodo_aquisitivo_inicio', { ascending: false });
  res.json(data || []);
});

router.get('/:id/holerites', requireAuth, async (req, res) => {
  const { data } = await supabase.from('payslips')
    .select('id, competencia_mes, competencia_ano, salario_liquido, status, data_pagamento, created_at, pdf_path')
    .eq('employee_id', req.params.id)
    .order('competencia_ano', { ascending: false })
    .order('competencia_mes', { ascending: false });
  res.json(data || []);
});

// GET /api/employees/:id/ficha-completa — tudo num único request (para o pop-up)
router.get('/:id/ficha-completa', requireAuth, async (req, res) => {
  const id = req.params.id;
  const [emp, hist, ferias, holerites, faltas, advertencias, documentos, vacReqs, checklists] = await Promise.all([
    supabase.from('employees').select('*, departments(nome,codigo), positions(titulo,cbo,nivel)').eq('id', id).single(),
    supabase.from('salary_history').select('*').eq('employee_id', id).order('data_reajuste', { ascending: false }),
    supabase.from('vacations').select('*').eq('employee_id', id).order('periodo_aquisitivo_inicio', { ascending: false }),
    supabase.from('payslips').select('id,competencia_mes,competencia_ano,salario_liquido,status,data_pagamento,pdf_path').eq('employee_id', id).order('competencia_ano', { ascending: false }).order('competencia_mes', { ascending: false }),
    supabase.from('absences').select('*').eq('employee_id', id).order('data_inicio', { ascending: false }),
    supabase.from('warnings').select('*').eq('employee_id', id).order('data_ocorrencia', { ascending: false }),
    supabase.from('employee_documents').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
    supabase.from('vacation_requests').select('*').eq('employee_id', id).order('created_at', { ascending: false }),
    supabase.from('process_checklists').select('*, checklist_items(*)').eq('employee_id', id).order('created_at', { ascending: false }),
  ]);

  if (emp.error) return res.status(404).json({ error: 'Funcionário não encontrado.' });

  res.json({
    employee: emp.data,
    historico_salarial: hist.data || [],
    ferias: ferias.data || [],
    holerites: holerites.data || [],
    faltas_atestados: faltas.data || [],
    advertencias: advertencias.data || [],
    documentos: documentos.data || [],
    solicitacoes_ferias: vacReqs.data || [],
    checklists: checklists.data || [],
  });
});

module.exports = router;
