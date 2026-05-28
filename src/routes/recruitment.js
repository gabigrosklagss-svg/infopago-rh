const router = require('express').Router();
const multer = require('multer');
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/* ── VAGAS ────────────────────────────────────────────── */
router.get('/openings', requireAuth, async (req, res) => {
  const { status, department_id } = req.query;
  let q = supabase.from('job_openings')
    .select('*, positions(titulo), departments(nome), candidates(id, status)')
    .order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  if (department_id) q = q.eq('department_id', department_id);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  // Agrega contadores
  const enriched = (data || []).map(v => {
    const c = v.candidates || [];
    return {
      ...v,
      total_candidatos: c.length,
      candidatos_ativos: c.filter(x => !['reprovado','desistiu','contratado'].includes(x.status)).length,
      candidatos: undefined,
    };
  });
  res.json(enriched);
});

router.get('/openings/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('job_openings')
    .select('*, positions(titulo), departments(nome)').eq('id', req.params.id).single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.post('/openings', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body, responsavel_id: req.body.responsavel_id || req.user.id };
  if (!payload.titulo) return res.status(400).json({ error: 'titulo é obrigatório.' });
  ['salario_min','salario_max'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  ['position_id','department_id','responsavel_id'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  const { data, error } = await supabase.from('job_openings').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

router.put('/openings/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body, updated_at: new Date().toISOString() };
  delete payload.id; delete payload.created_at; delete payload.positions; delete payload.departments;
  ['salario_min','salario_max'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  ['position_id','department_id','responsavel_id'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  const { data, error } = await supabase.from('job_openings').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

router.delete('/openings/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { error } = await supabase.from('job_openings').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* ── CANDIDATOS ───────────────────────────────────────── */
router.get('/candidates', requireAuth, async (req, res) => {
  const { job_opening_id, status } = req.query;
  let q = supabase.from('candidates').select('*, job_openings(titulo)').order('created_at', { ascending: false });
  if (job_opening_id) q = q.eq('job_opening_id', job_opening_id);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
});

router.get('/candidates/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('candidates')
    .select('*, job_openings(titulo, position_id, department_id, salario_min, salario_max)')
    .eq('id', req.params.id).single();
  if (error) return res.status(400).json({ error: error.message });
  const { data: hist } = await supabase.from('candidate_history')
    .select('*').eq('candidate_id', req.params.id).order('created_at', { ascending: false });
  data.historico = hist || [];
  res.json(data);
});

router.post('/candidates', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const payload = { ...req.body, responsavel_id: req.body.responsavel_id || req.user.id };
  if (!payload.nome_completo) return res.status(400).json({ error: 'nome_completo é obrigatório.' });
  ['pretensao_salarial','experiencia_anos','pontuacao'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  ['job_opening_id','responsavel_id','employee_id'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  const { data, error } = await supabase.from('candidates').insert(payload).select().single();
  if (error) return res.status(400).json({ error: error.message });
  // Histórico inicial
  await supabase.from('candidate_history').insert({
    candidate_id: data.id, acao: 'cadastro', status_para: data.status,
    observacao: 'Candidato cadastrado', usuario_id: req.user.id,
  });
  res.status(201).json(data);
});

router.put('/candidates/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  // Captura status anterior pra histórico
  const { data: antes } = await supabase.from('candidates').select('status').eq('id', req.params.id).single();
  const payload = { ...req.body, updated_at: new Date().toISOString() };
  delete payload.id; delete payload.created_at; delete payload.job_openings; delete payload.historico;
  ['pretensao_salarial','experiencia_anos','pontuacao'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  ['job_opening_id','responsavel_id','employee_id'].forEach(f => { if (payload[f] === '') payload[f] = null; });
  const { data, error } = await supabase.from('candidates').update(payload).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  if (antes && payload.status && antes.status !== payload.status) {
    await supabase.from('candidate_history').insert({
      candidate_id: data.id, acao: 'mudanca_status',
      status_de: antes.status, status_para: payload.status,
      observacao: payload._motivo_mudanca || null, usuario_id: req.user.id,
    });
  }
  res.json(data);
});

router.delete('/candidates/:id', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { error } = await supabase.from('candidates').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true });
});

/* Move candidato no pipeline */
router.put('/candidates/:id/status', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { status, observacao } = req.body;
  if (!status) return res.status(400).json({ error: 'status obrigatório.' });
  const { data: antes } = await supabase.from('candidates').select('status').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('candidates').update({ status, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(400).json({ error: error.message });
  await supabase.from('candidate_history').insert({
    candidate_id: req.params.id, acao: 'mudanca_status',
    status_de: antes?.status, status_para: status,
    observacao, usuario_id: req.user.id,
  });
  res.json(data);
});

/* Converte candidato → funcionário (cria registro mínimo em employees) */
router.post('/candidates/:id/contratar', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { data_admissao, salario_base, matricula, observacoes } = req.body;
  const { data: c, error: e1 } = await supabase.from('candidates').select('*, job_openings(*)').eq('id', req.params.id).single();
  if (e1 || !c) return res.status(404).json({ error: 'Candidato não encontrado.' });

  const payload = {
    nome_completo: c.nome_completo,
    email: c.email,
    telefone: c.telefone,
    cpf: c.cpf,
    data_nascimento: c.data_nascimento,
    cidade: c.cidade,
    estado: c.estado,
    escolaridade: c.escolaridade,
    data_admissao: data_admissao || new Date().toISOString().slice(0, 10),
    salario_base: parseFloat(salario_base) || c.pretensao_salarial || c.job_openings?.salario_min || 0,
    position_id: c.job_openings?.position_id || null,
    department_id: c.job_openings?.department_id || null,
    matricula: matricula || null,
    status: 'ativo',
    observacoes: observacoes || `Contratado via processo seletivo · vaga: ${c.job_openings?.titulo || '—'}`,
  };
  const { data: emp, error: e2 } = await supabase.from('employees').insert(payload).select().single();
  if (e2) return res.status(400).json({ error: e2.message });

  // Atualiza candidato
  await supabase.from('candidates').update({
    status: 'contratado',
    employee_id: emp.id,
    data_contratacao: payload.data_admissao,
  }).eq('id', c.id);

  await supabase.from('candidate_history').insert({
    candidate_id: c.id, acao: 'contratado',
    status_de: c.status, status_para: 'contratado',
    observacao: `Convertido em funcionário (matrícula ${emp.matricula || emp.id.slice(0, 8)})`,
    usuario_id: req.user.id,
  });

  // Atualiza vaga: se foi a última, encerra
  if (c.job_opening_id) {
    const { count } = await supabase.from('candidates')
      .select('id', { count: 'exact', head: true })
      .eq('job_opening_id', c.job_opening_id)
      .eq('status', 'contratado');
    const { data: vaga } = await supabase.from('job_openings').select('vagas').eq('id', c.job_opening_id).single();
    if (vaga && count >= vaga.vagas) {
      await supabase.from('job_openings').update({
        status: 'preenchida',
        data_fechamento: new Date().toISOString().slice(0, 10),
      }).eq('id', c.job_opening_id);
    }
  }

  res.status(201).json({ candidato: c, funcionario: emp });
});

/* Extrai dados via Ingrid (helper) */
async function extrairCV(texto) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const r = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [{
      role: 'user',
      content: `Extraia dados do currículo abaixo e retorne SOMENTE um JSON válido (sem markdown, sem comentários) com as chaves:
nome_completo, email, telefone (só dígitos), cpf (só dígitos), rg, data_nascimento (YYYY-MM-DD),
cidade, estado (UF 2 letras), endereco, cep, linkedin_url,
escolaridade (Ensino médio | Técnico | Superior incompleto | Superior completo | Pós-graduação | Mestrado | Doutorado),
formacao (curso e instituição em 1 linha), experiencia_anos (número decimal),
ultimo_cargo, ultima_empresa, pretensao_salarial (número ou null),
estado_civil (solteiro | casado | divorciado | viuvo | uniao_estavel | null),
nome_mae, nome_pai, nacionalidade (default: Brasileira), naturalidade,
habilidades (string com competências separadas por vírgula),
idiomas (string),
observacoes (resumo profissional em 2-3 linhas).
Se um campo não estiver no currículo, use null. NUNCA invente dados.

CURRÍCULO:
${texto.slice(0, 12000)}`
    }]
  });
  const txt = r.content?.[0]?.text || '{}';
  const json = txt.match(/\{[\s\S]*\}/)?.[0] || '{}';
  return JSON.parse(json);
}

/* Parse de currículo via texto colado */
router.post('/parse-cv', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  const { texto } = req.body;
  if (!texto) return res.status(400).json({ error: 'texto do currículo é obrigatório.' });
  try {
    const parsed = await extrairCV(texto);
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao processar currículo: ' + e.message });
  }
});

/* Parse de currículo via UPLOAD (PDF, DOC, DOCX, TXT) */
router.post('/parse-cv-file', requireAuth, requireRole('admin', 'rh'), upload.single('arquivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado.' });
  const buf = req.file.buffer;
  const nome = (req.file.originalname || '').toLowerCase();
  let texto = '';
  try {
    if (nome.endsWith('.pdf') || req.file.mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const d = await pdfParse(buf);
      texto = d.text || '';
    } else if (nome.endsWith('.txt') || req.file.mimetype === 'text/plain') {
      texto = buf.toString('utf8');
    } else if (nome.endsWith('.docx') || nome.endsWith('.doc')) {
      // Fallback: tenta extrair como texto bruto (não ideal mas funciona pra alguns CVs)
      try {
        const mammoth = require('mammoth');
        const r = await mammoth.extractRawText({ buffer: buf });
        texto = r.value || '';
      } catch {
        return res.status(400).json({ error: 'Para .docx instale o pacote "mammoth" (npm install mammoth) ou converta o CV para PDF.' });
      }
    } else {
      return res.status(400).json({ error: 'Formato não suportado. Envie PDF, DOCX ou TXT.' });
    }

    if (!texto.trim()) return res.status(400).json({ error: 'Não foi possível extrair texto do arquivo. Tente outro formato.' });

    const parsed = await extrairCV(texto);
    parsed.curriculo_texto = texto.slice(0, 6000);
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: 'Falha ao processar arquivo: ' + e.message });
  }
});

module.exports = router;
