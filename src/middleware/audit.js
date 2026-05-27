/**
 * Middleware de auditoria — registra todas as ações de escrita
 * (POST, PUT, PATCH, DELETE) em audit_logs após resposta bem-sucedida.
 */
const { supabase } = require('../config/supabase');

// Mapeia path → entity legível
function inferirEntidade(reqPath) {
  const map = [
    [/^\/api\/employees/, 'employee'],
    [/^\/api\/departments/, 'department'],
    [/^\/api\/positions/, 'position'],
    [/^\/api\/payslips/, 'payslip'],
    [/^\/api\/email/, 'email'],
    [/^\/api\/warnings/, 'warning'],
    [/^\/api\/absences/, 'absence'],
    [/^\/api\/documents/, 'document'],
    [/^\/api\/time/, 'time_entry'],
    [/^\/api\/vacation-requests/, 'vacation_request'],
    [/^\/api\/vacation-receipts/, 'vacation_receipt'],
    [/^\/api\/checklists/, 'checklist'],
    [/^\/api\/help\/contacts/, 'contact'],
    [/^\/api\/help\/announcements/, 'announcement'],
    [/^\/api\/help\/documents/, 'company_document'],
    [/^\/api\/help/, 'help'],
    [/^\/api\/agent/, 'agent'],
    [/^\/api\/terminations/, 'termination'],
    [/^\/api\/thirteenth/, 'thirteenth'],
    [/^\/api\/epis\/deliveries/, 'epi_delivery'],
    [/^\/api\/epis/, 'epi'],
    [/^\/api\/salary-plan\/grades/, 'salary_grade'],
    [/^\/api\/salary-plan\/movements/, 'career_movement'],
    [/^\/api\/salary-plan/, 'salary_plan'],
    [/^\/api\/performance\/cycles/, 'performance_cycle'],
    [/^\/api\/performance\/evaluations/, 'performance_evaluation'],
    [/^\/api\/performance/, 'performance'],
    [/^\/api\/recruitment\/openings/, 'job_opening'],
    [/^\/api\/recruitment\/candidates/, 'candidate'],
    [/^\/api\/recruitment/, 'recruitment'],
    [/^\/api\/collective-vacations/, 'collective_vacation'],
    [/^\/api\/settings/, 'settings'],
    [/^\/api\/auth/, 'auth'],
    [/^\/api\/reports/, 'reports'],
    [/^\/api\/backup/, 'backup'],
  ];
  for (const [re, name] of map) if (re.test(reqPath)) return name;
  return 'unknown';
}

function inferirAcao(method) {
  if (method === 'POST') return 'create';
  if (method === 'PUT' || method === 'PATCH') return 'update';
  if (method === 'DELETE') return 'delete';
  return method.toLowerCase();
}

/* Tradução amigável da entidade */
const ENTIDADE_LABEL = {
  employee: 'funcionário',
  department: 'departamento',
  position: 'cargo',
  payslip: 'holerite',
  email: 'envio de e-mail',
  warning: 'advertência',
  absence: 'falta/atestado',
  document: 'documento',
  time_entry: 'lançamento de ponto',
  vacation_request: 'solicitação de férias',
  vacation_receipt: 'recibo de férias',
  checklist: 'checklist',
  help: 'central de ajuda',
  contact: 'contato útil',
  announcement: 'comunicado',
  company_document: 'documento da empresa',
  agent: 'agente IA',
  termination: 'rescisão',
  thirteenth: '13º salário',
  epi: 'EPI',
  epi_delivery: 'entrega de EPI',
  salary_plan: 'plano de cargos',
  salary_grade: 'faixa salarial',
  career_movement: 'movimentação de carreira',
  performance: 'desempenho',
  performance_cycle: 'ciclo de avaliação',
  performance_evaluation: 'avaliação de desempenho',
  recruitment: 'recrutamento',
  job_opening: 'vaga',
  candidate: 'candidato',
  collective_vacation: 'férias coletivas',
  settings: 'configurações',
  auth: 'autenticação',
  reports: 'relatórios',
  backup: 'backup',
};

/* Tenta extrair um "label" identificador do payload */
function extrairLabel(body, entity) {
  if (!body || typeof body !== 'object') return null;
  // Campos prioritários por entidade
  const camposPriori = {
    employee: ['nome_completo', 'cpf', 'matricula'],
    department: ['nome', 'codigo'],
    position: ['titulo', 'cbo'],
    payslip: ['employee_id', 'competencia_mes'],
    warning: ['motivo', 'tipo'],
    absence: ['tipo', 'data_inicio'],
    document: ['titulo', 'tipo'],
    epi: ['nome', 'ca'],
    termination: ['tipo_rescisao'],
    thirteenth: ['ano', 'parcela'],
    salary_plan: ['titulo', 'grade_nivel'],
    settings: ['razao_social', 'smtp_host'],
    help: ['titulo', 'nome'],
  };
  const campos = camposPriori[entity] || ['nome', 'titulo', 'name'];
  for (const c of campos) {
    if (body[c]) return String(body[c]).slice(0, 100);
  }
  return null;
}

/* Gera descrição em linguagem natural */
function gerarDescricao(method, entity, body, path, labelOverride) {
  const ent = ENTIDADE_LABEL[entity] || entity;
  const label = labelOverride || extrairLabel(body, entity);
  const verbo = method === 'POST' ? 'Cadastrou' : method === 'DELETE' ? 'Excluiu' : 'Atualizou';
  const sufixoLabel = label ? `: ${label}` : '';

  // Casos especiais
  if (path.includes('/foto') || path.includes('/avatar')) return `Atualizou foto${label ? ': ' + label : ''}`;
  if (path.includes('/pdf')) return `Gerou PDF de ${ent}${label ? ' (' + label + ')' : ''}`;
  if (path.includes('/aprovar')) return `Aprovou solicitação${label ? ': ' + label : ''}`;
  if (path.includes('/negar')) return `Negou solicitação${label ? ': ' + label : ''}`;
  if (path.includes('/login')) return 'Fez login no sistema';
  if (path.includes('/logout')) return 'Saiu do sistema';
  if (path.includes('/bate-ponto')) return 'Bateu ponto';
  if (path.includes('/test-smtp')) return 'Testou conexão SMTP';
  if (path.includes('/send') || path.includes('/email/send')) return `Enviou e-mail com holerite${label ? ' (' + label + ')' : ''}`;
  if (path.includes('/lote')) return `Geração em lote (${ent})`;
  if (path.includes('/chat')) return 'Conversou com a Ingrid';
  if (path.includes('/parse')) return 'Extraiu dados de currículo via IA';
  if (path.includes('/backup/run')) return 'Executou backup manual';
  if (path.includes('/hard')) return `Excluiu permanentemente ${ent}${sufixoLabel}`;

  return `${verbo} ${ent}${sufixoLabel}`;
}

/**
 * Para PUT/DELETE com UUID na URL, busca o registro ANTES da operação
 * pra capturar o nome/título do objeto que está sendo alterado.
 */
const TABELA_POR_ENTIDADE = {
  employee:           ['employees', ['nome_completo', 'matricula']],
  department:         ['departments', ['nome', 'codigo']],
  position:           ['positions', ['titulo', 'nivel']],
  payslip:            ['payslips', ['competencia_mes', 'competencia_ano']],
  warning:            ['warnings', ['tipo', 'motivo']],
  absence:            ['absences', ['tipo', 'data_inicio']],
  document:           ['employee_documents', ['tipo', 'descricao']],
  time_entry:         ['time_entries', ['data']],
  vacation_request:   ['vacation_requests', ['data_inicio_pretendida', 'status']],
  vacation_receipt:   ['vacation_receipts', ['data_inicio_gozo']],
  termination:        ['terminations', ['tipo_rescisao', 'data_demissao']],
  thirteenth:         ['thirteenth_salary', ['ano', 'parcela']],
  epi:                ['epis', ['nome', 'ca']],
  epi_delivery:       ['epi_deliveries', ['data_entrega']],
  contact:            ['useful_contacts', ['nome', 'categoria']],
  announcement:       ['announcements', ['titulo']],
  company_document:   ['company_documents', ['titulo', 'categoria']],
  salary_grade:       ['position_grades', ['grade_nivel']],
  career_movement:    ['career_movements', ['tipo']],
  performance_cycle:  ['performance_cycles', ['nome']],
  performance_evaluation: ['performance_evaluations', ['status']],
  job_opening:        ['job_openings', ['titulo']],
  candidate:          ['candidates', ['nome_completo']],
  collective_vacation:['collective_vacations', ['titulo']],
};

async function buscarLabelDoRegistro(entity, id) {
  if (!id) return null;
  const conf = TABELA_POR_ENTIDADE[entity];
  if (!conf) return null;
  try {
    const [tabela, campos] = conf;
    const { supabase } = require('../config/supabase');
    const { data } = await supabase.from(tabela).select(campos.join(',') + ',id').eq('id', id).maybeSingle();
    if (!data) return null;
    const partes = campos.map(c => data[c]).filter(v => v != null && v !== '');
    return partes.length ? partes.join(' · ') : null;
  } catch { return null; }
}

function extrairIdDoPath(path) {
  // Captura UUID em /api/algo/<UUID>... ou /algo/<UUID>/...
  const m = path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m?.[1] || null;
}

/** Express middleware: registra log após resposta */
function auditLogger() {
  return async (req, res, next) => {
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!isWrite || !req.path.startsWith('/api')) return next();
    // Não registra logs de auditoria recursivamente
    if (req.path.startsWith('/api/audit')) return next();

    // Captura request body sumarizado (sem arquivos)
    const reqBodySummary = (() => {
      try {
        if (!req.body) return null;
        const copy = { ...req.body };
        // Mascara campos sensíveis
        if (copy.password) copy.password = '***';
        if (copy.smtp_pass) copy.smtp_pass = '***';
        if (copy.ANTHROPIC_API_KEY) copy.ANTHROPIC_API_KEY = '***';
        // Limita tamanho de strings longas
        const limit = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) =>
          [k, typeof v === 'string' && v.length > 500 ? v.slice(0, 500) + '...' : v]
        ));
        return limit(copy);
      } catch { return null; }
    })();

    // Para PUT/PATCH/DELETE com UUID, captura o label do objeto ANTES da mudança
    const entityPrecoce = inferirEntidade(req.path);
    const idPath = extrairIdDoPath(req.path);
    let labelAntes = null;
    if (idPath && ['PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      labelAntes = await buscarLabelDoRegistro(entityPrecoce, idPath).catch(() => null);
    }

    // Hook na finalização da resposta
    res.on('finish', async () => {
      if (res.statusCode >= 400) return; // só sucesso
      try {
        const entity = entityPrecoce;
        const labelDoBody = extrairLabel(reqBodySummary, entity);
        const label = labelAntes || labelDoBody;
        const descricao = gerarDescricao(req.method, entity, reqBodySummary, req.path, label);

        await supabase.from('audit_logs').insert({
          user_id: req.user?.id || null,
          user_name: req.user?.full_name || null,
          user_role: req.user?.role || null,
          action: inferirAcao(req.method),
          entity,
          entity_id: req.params?.id || null,
          entity_label: label,
          changes: reqBodySummary,
          ip_address: req.ip?.slice(0, 45) || null,
          user_agent: req.headers['user-agent']?.slice(0, 500) || null,
          http_method: req.method,
          http_path: req.path,
          http_status: res.statusCode,
          metadata: { descricao },
        });
      } catch (e) {
        console.warn('[audit] falha ao gravar:', e.message);
      }
    });
    next();
  };
}

module.exports = { auditLogger };
