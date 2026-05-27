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

  // Férias agendadas no mês
  const inicioMes = `${ano}-${String(mes).padStart(2,'0')}-01`;
  const fimMes = new Date(ano, mes, 0).toISOString().split('T')[0];
  const { data: ferias } = await supabase.from('vacation_requests')
    .select('*, employees(nome_completo, matricula)')
    .eq('status', 'aprovada')
    .or(`data_inicio_pretendida.lte.${fimMes},data_fim_pretendida.gte.${inicioMes}`);

  const eventosFerias = (ferias || []).map(f => ({
    data: f.data_inicio_pretendida,
    tipo: 'ferias',
    titulo: ` ${f.employees?.nome_completo}`,
    subtitulo: `Férias até ${f.data_fim_pretendida}`,
    cor: '#1B4A78',
    icone: '',
  }));

  // Períodos aquisitivos vencendo no mês
  const { data: vacAVencer } = await supabase.from('vacations')
    .select('*, employees(nome_completo, matricula)')
    .gte('periodo_aquisitivo_fim', inicioMes).lte('periodo_aquisitivo_fim', fimMes)
    .neq('status', 'concluido');

  const eventosVencimento = (vacAVencer || []).map(v => ({
    data: v.periodo_aquisitivo_fim,
    tipo: 'ferias_vencendo',
    titulo: ` Férias vencendo: ${v.employees?.nome_completo}`,
    subtitulo: `Período ${v.periodo_aquisitivo_inicio} até ${v.periodo_aquisitivo_fim}`,
    cor: '#B0282A',
    icone: '',
  }));

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

  res.json({ mes, ano, eventos: todos });
});

module.exports = router;
