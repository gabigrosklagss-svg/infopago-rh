const router = require('express').Router();
const multer = require('multer');
const { supabase } = require('../config/supabase');
const { requireAuth, authorize } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* Helper de parse via Ingrid (reusa lógica do recruitment) */
async function extrairCV(texto) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const r = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Extraia dados do currículo em JSON com as chaves:
nome_completo, email, telefone, cpf, data_nascimento (YYYY-MM-DD), cidade, estado (UF),
linkedin_url, escolaridade, formacao, experiencia_anos, ultimo_cargo, ultima_empresa,
pretensao_salarial (número ou null), area_interesse, habilidades, idiomas, observacoes.
Use null se faltar. NUNCA invente. Retorne SOMENTE o JSON.

CURRÍCULO:
${texto.slice(0, 12000)}`
    }]
  });
  const txt = r.content?.[0]?.text || '{}';
  const json = txt.match(/\{[\s\S]*\}/)?.[0] || '{}';
  return JSON.parse(json);
}

/* ── LISTAR ────────────────────────────────────────── */
router.get('/', requireAuth, authorize('cvpool.read'), async (req, res) => {
  const { status, area, q } = req.query;
  let qb = supabase.from('cv_pool').select('*').order('created_at', { ascending: false });
  if (status) qb = qb.eq('status', status);
  if (area) qb = qb.eq('area_interesse', area);
  if (q) qb = qb.or(`nome_completo.ilike.%${q}%,email.ilike.%${q}%,ultimo_cargo.ilike.%${q}%,habilidades.ilike.%${q}%`);
  const { data, error } = await qb;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/:id', requireAuth, authorize('cvpool.read'), async (req, res) => {
  const { data, error } = await supabase.from('cv_pool').select('*').eq('id', req.params.id).single();
  if (error) return res.status(400).json({ error: error.message });

  // Carrega histórico de candidaturas
  const { data: cands } = await supabase
    .from('cv_pool_candidatures')
    .select('*, candidates(id, status, job_openings(titulo))')
    .eq('cv_pool_id', req.params.id);
  data.candidaturas = cands || [];
  res.json(data);
});

/* ── CRIAR ─────────────────────────────────────────── */
router.post('/', requireAuth, authorize('cvpool.manage'), async (req, res) => {
  const payload = { ...req.body, responsavel_id: req.user.id };
  if (!payload.nome_completo) return res.status(400).json({ error: 'nome_completo é obrigatório.' });
  ['pretensao_salarial','experiencia_anos'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  if (payload.tags && typeof payload.tags === 'string') {
    payload.tags = payload.tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  const { data, error } = await supabase.from('cv_pool').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/:id', requireAuth, authorize('cvpool.manage'), async (req, res) => {
  const payload = { ...req.body, updated_at: new Date().toISOString() };
  delete payload.id; delete payload.created_at; delete payload.candidaturas;
  ['pretensao_salarial','experiencia_anos'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  if (payload.tags && typeof payload.tags === 'string') {
    payload.tags = payload.tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  const { data, error } = await supabase.from('cv_pool').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/:id', requireAuth, authorize('cvpool.manage'), async (req, res) => {
  const { error } = await supabase.from('cv_pool').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* ── PARSE CV — texto ─────────────────────────────── */
router.post('/parse', requireAuth, authorize('cvpool.manage'), async (req, res) => {
  const { texto } = req.body;
  if (!texto) return res.status(400).json({ error: 'texto obrigatório.' });
  try {
    const parsed = await extrairCV(texto);
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao processar currículo: ' + e.message });
  }
});

/* ── UPLOAD de arquivo (PDF/DOCX/TXT) — parse + salva ─────────────── */
router.post('/upload', requireAuth, authorize('cvpool.manage'), upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório.' });
  const buf = req.file.buffer;
  const nome = (req.file.originalname || '').toLowerCase();
  let texto = '';
  try {
    if (nome.endsWith('.pdf') || req.file.mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const d = await pdfParse(buf); texto = d.text || '';
    } else if (nome.endsWith('.docx') || nome.endsWith('.doc')) {
      const mammoth = require('mammoth');
      const r = await mammoth.extractRawText({ buffer: buf }); texto = r.value || '';
    } else if (nome.endsWith('.txt') || req.file.mimetype === 'text/plain') {
      texto = buf.toString('utf8');
    } else {
      return res.status(400).json({ error: 'Formato não suportado. Use PDF, DOCX ou TXT.' });
    }
    if (!texto.trim()) return res.status(400).json({ error: 'Não foi possível extrair texto do arquivo.' });

    const parsed = await extrairCV(texto);
    parsed.curriculo_texto = texto.slice(0, 10000);
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao processar arquivo: ' + e.message });
  }
});

/* ── USAR CV pra criar candidato em vaga ──────────── */
router.post('/:id/candidatar', requireAuth, authorize('cvpool.manage'), async (req, res) => {
  const { job_opening_id, observacao } = req.body;
  if (!job_opening_id) return res.status(400).json({ error: 'job_opening_id obrigatório.' });

  const { data: cv } = await supabase.from('cv_pool').select('*').eq('id', req.params.id).single();
  if (!cv) return res.status(404).json({ error: 'Currículo não encontrado.' });

  // Verifica se já não candidatou nessa vaga
  const { data: exists } = await supabase.from('cv_pool_candidatures')
    .select('id').eq('cv_pool_id', req.params.id).eq('job_opening_id', job_opening_id).maybeSingle();
  if (exists) return res.status(409).json({ error: 'Este currículo já foi candidatado a esta vaga.' });

  // Cria candidato (na tabela candidates)
  const candPayload = {
    job_opening_id,
    nome_completo: cv.nome_completo,
    email: cv.email,
    telefone: cv.telefone,
    cpf: cv.cpf,
    data_nascimento: cv.data_nascimento,
    cidade: cv.cidade, estado: cv.estado,
    linkedin_url: cv.linkedin_url,
    pretensao_salarial: cv.pretensao_salarial,
    experiencia_anos: cv.experiencia_anos,
    escolaridade: cv.escolaridade,
    curriculo_url: cv.curriculo_url,
    curriculo_texto: cv.curriculo_texto,
    origem: cv.origem || 'banco_de_curriculos',
    observacoes: observacao || `Importado do banco de currículos (CV #${cv.id.slice(0,8)})`,
    status: 'triagem',
    responsavel_id: req.user.id,
    parse_extra: cv.parse_extra,
  };
  const { data: cand, error } = await supabase.from('candidates').insert(candPayload).select().single();
  if (error) return res.status(400).json({ error: error.message });

  // Registra vínculo
  await supabase.from('cv_pool_candidatures').insert({
    cv_pool_id: cv.id, candidate_id: cand.id, job_opening_id,
    enviado_por: req.user.id,
  });

  // Atualiza status do CV
  await supabase.from('cv_pool').update({
    status: 'em_processo', ja_candidatou: true, updated_at: new Date().toISOString(),
  }).eq('id', cv.id);

  // Histórico do candidato
  await supabase.from('candidate_history').insert({
    candidate_id: cand.id, acao: 'origem_banco_curriculos',
    status_para: 'triagem',
    observacao: `Candidatura criada a partir do banco de currículos`,
    usuario_id: req.user.id,
  });

  res.status(201).json({ candidate: cand, cv_pool_id: cv.id });
});

/* ── SUGERIR CANDIDATOS pra uma vaga (matching simples) ───────── */
router.get('/sugestoes/:job_opening_id', requireAuth, authorize('cvpool.read'), async (req, res) => {
  const { data: vaga } = await supabase.from('job_openings')
    .select('*, positions(titulo)').eq('id', req.params.job_opening_id).single();
  if (!vaga) return res.status(404).json({ error: 'Vaga não encontrada.' });

  const titulo = (vaga.positions?.titulo || vaga.titulo || '').toLowerCase();
  const requisitos = (vaga.requisitos || '').toLowerCase();
  const palavras = [...new Set([
    ...titulo.split(/\s+/),
    ...requisitos.split(/[\s,;]+/),
  ])].filter(p => p.length > 3);

  const { data: pool } = await supabase.from('cv_pool')
    .select('*')
    .eq('status', 'disponivel');

  const scored = (pool || []).map(cv => {
    const blob = `${cv.nome_completo} ${cv.ultimo_cargo} ${cv.habilidades} ${cv.area_interesse} ${cv.observacoes}`.toLowerCase();
    let score = 0;
    palavras.forEach(p => { if (blob.includes(p)) score += 10; });
    // Bônus por pretensão dentro da faixa
    if (cv.pretensao_salarial && vaga.salario_min && vaga.salario_max
        && parseFloat(cv.pretensao_salarial) >= parseFloat(vaga.salario_min)
        && parseFloat(cv.pretensao_salarial) <= parseFloat(vaga.salario_max)) {
      score += 20;
    }
    return { ...cv, _score: score };
  }).filter(c => c._score > 0).sort((a, b) => b._score - a._score).slice(0, 20);

  res.json({ vaga, sugestoes: scored });
});

module.exports = router;
