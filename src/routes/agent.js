const router = require('express').Router();
const { supabase } = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { extrairDadosCurriculo, chatComTools } = require('../services/aiAgent');
const { executeTool, getToolsForAnthropic } = require('../services/agentTools');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

/* POST /api/agent/parse — recebe CV/texto e retorna dados estruturados */
router.post('/parse', requireAuth, requireRole('admin', 'rh'), upload.single('arquivo'), async (req, res) => {
  try {
    const text = req.body.texto;
    const fileBuffer = req.file?.buffer;
    const mimeType = req.file?.mimetype;

    if (!fileBuffer && (!text || !text.trim())) {
      return res.status(400).json({ error: 'Envie um arquivo ou um texto com os dados.' });
    }

    const result = await extrairDadosCurriculo({ fileBuffer, mimeType, text });
    res.json(result);
  } catch (err) {
    console.error('[agent/parse]', err);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/agent/create-employee — cria o funcionário a partir dos dados revisados */
router.post('/create-employee', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  try {
    const payload = { ...req.body };

    // Validações básicas
    if (!payload.nome_completo) return res.status(400).json({ error: 'Nome completo é obrigatório.' });
    if (!payload.cpf) return res.status(400).json({ error: 'CPF é obrigatório.' });
    if (!payload.data_nascimento) return res.status(400).json({ error: 'Data de nascimento é obrigatória.' });
    if (!payload.data_admissao) return res.status(400).json({ error: 'Data de admissão é obrigatória.' });
    if (!payload.salario_base) return res.status(400).json({ error: 'Salário base é obrigatório.' });

    // Verifica duplicidade de CPF
    const { data: dup } = await supabase.from('employees').select('id').eq('cpf', payload.cpf).maybeSingle();
    if (dup) return res.status(400).json({ error: `Já existe funcionário com CPF ${payload.cpf}.` });

    // Sanitização (remove campos que não vão pra DB)
    delete payload.cargo_pretendido;
    delete payload.experiencia_resumo;
    delete payload.competencias;
    delete payload._meta;
    delete payload.confianca;
    delete payload.observacoes;
    delete payload.tipo;
    delete payload.dados;

    // Normaliza campos UUID/ENUM/DATE vazios pra null
    const nullableFields = ['department_id', 'position_id', 'gestor_id', 'data_demissao', 'sexo', 'estado_civil', 'tipo_pix', 'tipo_conta'];
    nullableFields.forEach(f => { if (payload[f] === '') payload[f] = null; });

    // Matrícula automática
    if (!payload.matricula) {
      const { count } = await supabase.from('employees').select('id', { count: 'exact', head: true });
      payload.matricula = String((count || 0) + 1).padStart(4, '0');
    }

    // Defaults
    if (!payload.tipo_contrato) payload.tipo_contrato = 'clt';
    if (!payload.status) payload.status = 'ativo';
    if (!payload.carga_horaria_semanal) payload.carga_horaria_semanal = 44;
    payload.created_by = req.user.id;

    // Valor hora
    if (payload.salario_base && payload.carga_horaria_semanal) {
      const hm = Math.round((parseInt(payload.carga_horaria_semanal) * 52) / 12);
      payload.valor_hora = parseFloat((parseFloat(payload.salario_base) / hm).toFixed(4));
    }

    const { data, error } = await supabase.from('employees').insert(payload).select().single();
    if (error) return res.status(400).json({ error: error.message });

    // Cria período aquisitivo inicial de férias
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
  } catch (err) {
    console.error('[agent/create-employee]', err);
    res.status(500).json({ error: err.message });
  }
});

/* POST /api/agent/chat — chat livre com tool use */
router.post('/chat', requireAuth, requireRole('admin', 'rh'), async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Histórico de mensagens é obrigatório (array de {role, content}).' });
    }

    const ctx = {
      userId: req.user.id,
      userName: req.user.full_name,
      userRole: req.user.role,
    };

    const result = await chatComTools(
      messages,
      executeTool,
      getToolsForAnthropic(),
      ctx
    );

    res.json(result);
  } catch (err) {
    console.error('[agent/chat]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
