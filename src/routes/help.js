const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { feriadosDoAno } = require('../services/holidays');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const BUCKET = 'company-documents';

/* ──────────────────────────────────────────────────────
   CONTATOS ÚTEIS
   ────────────────────────────────────────────────────── */
router.get('/contacts', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('useful_contacts')
    .select('*').eq('active', true).order('ordem').order('categoria').order('nome');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/contacts', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body };
  if (!payload.nome || !payload.categoria) return res.status(400).json({ error: 'Nome e categoria são obrigatórios.' });
  const { data, error } = await supabase.from('useful_contacts').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/contacts/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body };
  delete payload.id; delete payload.created_at;
  const { data, error } = await supabase.from('useful_contacts').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/contacts/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { error } = await supabase.from('useful_contacts').update({ active: false }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* ──────────────────────────────────────────────────────
   COMUNICADOS E AVISOS
   ────────────────────────────────────────────────────── */
router.get('/announcements', requireAuth, async (req, res) => {
  const { categoria } = req.query;
  let q = supabase.from('announcements').select('*').eq('active', true)
    .order('fixado', { ascending: false })
    .order('data_publicacao', { ascending: false });
  if (categoria) q = q.eq('categoria', categoria);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });

  // Filtra os expirados
  const agora = new Date();
  const filtered = (data || []).filter(a => !a.data_expiracao || new Date(a.data_expiracao) > agora);
  res.json(filtered);
});

router.post('/announcements', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = {
    ...req.body,
    autor_id: req.user.id,
    autor_nome: req.user.full_name,
  };
  if (!payload.titulo || !payload.conteudo) return res.status(400).json({ error: 'Título e conteúdo são obrigatórios.' });
  if (!payload.categoria) payload.categoria = 'geral';
  if (payload.data_expiracao === '') payload.data_expiracao = null;

  const { data, error } = await supabase.from('announcements').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/announcements/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body };
  delete payload.id; delete payload.created_at; delete payload.autor_id; delete payload.autor_nome;
  if (payload.data_expiracao === '') payload.data_expiracao = null;
  const { data, error } = await supabase.from('announcements').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/announcements/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  await supabase.from('announcements').update({ active: false }).eq('id', req.params.id);
  res.json({ success: true });
});

/* Upload de anexo para comunicado */
router.post('/announcements/:id/anexo', requireAuth, requireRole('admin', 'rh'), upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });
  const id = req.params.id;
  const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
  const storage_path = `comunicados/${id}/${Date.now()}.${ext}`;

  // Remove anexo anterior se existir
  const { data: ann } = await supabase.from('announcements').select('anexo_url').eq('id', id).maybeSingle();
  if (ann?.anexo_url && ann.anexo_url.includes(`/${BUCKET}/`)) {
    const oldPath = ann.anexo_url.split(`/${BUCKET}/`)[1];
    if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
  }

  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(storage_path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (upErr) return res.status(500).json({ error: 'Falha no upload: ' + upErr.message });

  // Salva o storage_path (não URL pública) pra poder baixar depois via service_role
  await supabase.from('announcements').update({
    anexo_url: storage_path, // armazena o PATH interno, não URL pública
    anexo_nome: req.file.originalname,
    anexo_tipo: req.file.mimetype,
    anexo_tamanho: req.file.size,
  }).eq('id', id);

  // Retorna URL assinada (válida 1h) pra mostrar no UI
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrl(storage_path, 3600);
  res.json({
    anexo_url: signed?.signedUrl,
    storage_path,
    anexo_nome: req.file.originalname,
  });
});

router.delete('/announcements/:id/anexo', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: ann } = await supabase.from('announcements').select('anexo_url').eq('id', req.params.id).maybeSingle();
  if (ann?.anexo_url && ann.anexo_url.includes(`/${BUCKET}/`)) {
    const oldPath = ann.anexo_url.split(`/${BUCKET}/`)[1];
    if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {});
  }
  await supabase.from('announcements').update({
    anexo_url: null, anexo_nome: null, anexo_tipo: null, anexo_tamanho: null,
  }).eq('id', req.params.id);
  res.json({ success: true });
});

/* Envia o comunicado por e-mail aos destinatários definidos */
router.post('/announcements/:id/enviar-email', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { enviarComunicado } = require('../services/emailService');
  const { data: ann } = await supabase.from('announcements').select('*').eq('id', req.params.id).single();
  if (!ann) return res.status(404).json({ error: 'Comunicado não encontrado.' });

  // Resolve destinatários conforme escopo
  let q = supabase.from('employees').select('id, nome_completo, email_corporativo, email_pessoal').eq('status', 'ativo');
  if (ann.target_scope === 'departamentos' && ann.target_dept_ids?.length) {
    q = q.in('department_id', ann.target_dept_ids);
  } else if (ann.target_scope === 'funcionarios' && ann.target_employee_ids?.length) {
    q = q.in('id', ann.target_employee_ids);
  }
  const { data: emps } = await q;
  const recipients = (emps || []).map(e => ({
    id: e.id, nome: e.nome_completo,
    email: e.email_corporativo || e.email_pessoal,
  }));

  const { data: company } = await supabase.from('company_settings').select('*').eq('id', 1).single();
  try {
    const r = await enviarComunicado(ann, recipients, company || {}, req.user.id);
    await supabase.from('announcements').update({
      enviado_em: new Date().toISOString(),
      total_destinatarios: r.total,
      total_enviados: r.enviados,
      total_falhas: r.falhas,
    }).eq('id', req.params.id);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao enviar: ' + e.message });
  }
});

/* ──────────────────────────────────────────────────────
   DOCUMENTOS DA EMPRESA
   ────────────────────────────────────────────────────── */
router.get('/documents', requireAuth, async (req, res) => {
  const { categoria } = req.query;
  let q = supabase.from('company_documents').select('*').order('created_at', { ascending: false });
  if (categoria) q = q.eq('categoria', categoria);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.post('/documents', requireAuth, requireRole('admin', 'rh'), upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const { categoria, titulo, descricao, versao, data_vigencia } = req.body;
  if (!titulo || !categoria) return res.status(400).json({ error: 'Título e categoria são obrigatórios.' });

  const ext = (req.file.originalname.split('.').pop() || 'bin').toLowerCase();
  const storage_path = `${categoria}/${Date.now()}_${titulo.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 60)}.${ext}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(storage_path, req.file.buffer, {
    contentType: req.file.mimetype, upsert: false,
  });
  if (upErr) return res.status(500).json({ error: `Falha no upload: ${upErr.message}` });

  const { data, error } = await supabase.from('company_documents').insert({
    categoria, titulo, descricao, versao, data_vigencia: data_vigencia || null,
    storage_path, filename_original: req.file.originalname,
    mime_type: req.file.mimetype, tamanho_bytes: req.file.size,
    uploaded_by: req.user.id,
  }).select().single();
  if (error) {
    await supabase.storage.from(BUCKET).remove([storage_path]);
    return res.status(400).json({ error: error.message });
  }
  res.status(201).json(data);
});

router.get('/documents/file/:id', requireAuth, async (req, res) => {
  const { data: doc } = await supabase.from('company_documents')
    .select('storage_path, filename_original').eq('id', req.params.id).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
  const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 3600);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ url: signed.signedUrl, filename: doc.filename_original });
});

router.delete('/documents/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data: doc } = await supabase.from('company_documents').select('storage_path').eq('id', req.params.id).single();
  if (!doc) return res.status(404).json({ error: 'Documento não encontrado.' });
  await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  await supabase.from('company_documents').delete().eq('id', req.params.id);
  res.json({ success: true });
});

/* ──────────────────────────────────────────────────────
   CALENDÁRIO DE EVENTOS RH (mês corrente + próximo)
   ────────────────────────────────────────────────────── */
router.get('/calendar', requireAuth, async (req, res) => {
  const ano = parseInt(req.query.ano) || new Date().getFullYear();
  const mes = parseInt(req.query.mes) || (new Date().getMonth() + 1);

  // Feriados do ano
  const feriadosMap = feriadosDoAno(ano);
  const feriados = Object.entries(feriadosMap)
    .filter(([data]) => data.startsWith(`${ano}-${String(mes).padStart(2, '0')}`))
    .map(([data, nome]) => ({ data, tipo: 'feriado', titulo: nome, cor: '#92500D', icone: '' }));

  // Aniversariantes do mês
  const { data: emps } = await supabase.from('employees')
    .select('id, nome_completo, matricula, data_nascimento, data_admissao')
    .eq('status', 'ativo');

  const aniversariantes = (emps || []).filter(e => {
    if (!e.data_nascimento) return false;
    return new Date(e.data_nascimento + 'T12:00:00').getMonth() + 1 === mes;
  }).map(e => {
    const dt = new Date(e.data_nascimento + 'T12:00:00');
    return {
      data: `${ano}-${String(mes).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`,
      tipo: 'aniversario',
      titulo: ` ${e.nome_completo}`,
      subtitulo: `Aniversário · ${e.matricula}`,
      cor: '#1B4A78',
      icone: '',
    };
  });

  // Aniversários de empresa (admissão)
  const aniversarioEmpresa = (emps || []).filter(e => {
    if (!e.data_admissao) return false;
    const adm = new Date(e.data_admissao + 'T12:00:00');
    return adm.getMonth() + 1 === mes && adm.getFullYear() < ano;
  }).map(e => {
    const adm = new Date(e.data_admissao + 'T12:00:00');
    const anos = ano - adm.getFullYear();
    return {
      data: `${ano}-${String(mes).padStart(2,'0')}-${String(adm.getDate()).padStart(2,'0')}`,
      tipo: 'admissao',
      titulo: ` ${e.nome_completo}`,
      subtitulo: `${anos} ano(s) de empresa`,
      cor: '#1B5B3E',
      icone: '',
    };
  });

  // Férias agendadas — apenas as que INICIAM no mês visualizado (evita duplicação)
  const inicioMes = `${ano}-${String(mes).padStart(2,'0')}-01`;
  const fimMes = new Date(ano, mes, 0).toISOString().split('T')[0];
  const { data: ferias } = await supabase.from('vacation_requests')
    .select('*, employees(nome_completo, matricula)')
    .eq('status', 'aprovada')
    .gte('data_inicio_pretendida', inicioMes)
    .lte('data_inicio_pretendida', fimMes);

  const eventosFerias = (ferias || []).map(f => ({
    data: f.data_inicio_pretendida,
    tipo: 'ferias',
    titulo: `${f.employees?.nome_completo}`,
    subtitulo: `Férias até ${f.data_fim_pretendida}`,
    cor: '#1B4A78',
    icone: '',
  }));

  // Períodos aquisitivos vencendo NO MÊS visualizado (entram no grid)
  const { data: vacAVencer } = await supabase.from('vacations')
    .select('*, employees(nome_completo, matricula)')
    .gte('periodo_aquisitivo_fim', inicioMes).lte('periodo_aquisitivo_fim', fimMes)
    .neq('status', 'concluido');

  const eventosVencimento = (vacAVencer || []).map(v => ({
    data: v.periodo_aquisitivo_fim,
    tipo: 'ferias_vencendo',
    titulo: `Férias vencendo: ${v.employees?.nome_completo}`,
    subtitulo: `Período ${v.periodo_aquisitivo_inicio} até ${v.periodo_aquisitivo_fim}`,
    cor: '#B0282A',
    icone: '',
  }));

  // ALERTAS GLOBAIS de férias (independente do mês visualizado)
  const hoje = new Date().toISOString().split('T')[0];
  const em30 = new Date(); em30.setDate(em30.getDate() + 30);
  const em30Iso = em30.toISOString().split('T')[0];

  const { data: vacVencidasGlobal } = await supabase.from('vacations')
    .select('*, employees(nome_completo, matricula, departments(nome))')
    .lt('periodo_aquisitivo_fim', hoje)
    .neq('status', 'concluido');

  const { data: vacVencendoGlobal } = await supabase.from('vacations')
    .select('*, employees(nome_completo, matricula, departments(nome))')
    .gte('periodo_aquisitivo_fim', hoje).lte('periodo_aquisitivo_fim', em30Iso)
    .neq('status', 'concluido');

  // Documentos vencendo no mês
  const { data: docs } = await supabase.from('employee_documents')
    .select('*, employees(nome_completo, matricula)')
    .gte('data_validade', inicioMes).lte('data_validade', fimMes);

  const eventosDocs = (docs || []).map(d => ({
    data: d.data_validade,
    tipo: 'doc_vencendo',
    titulo: ` Doc venc.: ${d.employees?.nome_completo}`,
    subtitulo: `${d.tipo.toUpperCase().replace('_', ' ')}`,
    cor: '#92500D',
    icone: '',
  }));

  const todos = [...feriados, ...aniversariantes, ...aniversarioEmpresa, ...eventosFerias, ...eventosVencimento, ...eventosDocs]
    .sort((a, b) => a.data.localeCompare(b.data));

  res.json({
    mes, ano,
    eventos: todos,
    alertas_ferias_vencidas: (vacVencidasGlobal || []).map(v => ({
      nome: v.employees?.nome_completo,
      departamento: v.employees?.departments?.nome,
      vencimento: v.periodo_aquisitivo_fim,
    })),
    alertas_ferias_vencendo: (vacVencendoGlobal || []).map(v => ({
      nome: v.employees?.nome_completo,
      departamento: v.employees?.departments?.nome,
      vencimento: v.periodo_aquisitivo_fim,
      dias_restantes: Math.ceil((new Date(v.periodo_aquisitivo_fim) - new Date()) / 86400000),
    })),
  });
});

module.exports = router;
