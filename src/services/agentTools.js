/**
 * Tools que o agente Claude pode chamar para operar o sistema InfoPago
 *
 * Cada tool tem:
 *  - name: nome técnico
 *  - description: instrução em PT-BR pro modelo entender quando usar
 *  - input_schema: JSON Schema dos parâmetros
 *  - handler: função async que executa a operação
 */

const { supabase } = require('../config/supabase');

/* ── Helpers ─────────────────────────────────────────────── */
function ok(data, msg) { return { success: true, data, message: msg }; }
function fail(error) { return { success: false, error }; }

async function buscarEmployeeId(nomeOuCpfOuMatricula) {
  if (!nomeOuCpfOuMatricula) return null;
  const v = String(nomeOuCpfOuMatricula).trim();
  const { data } = await supabase.from('employees')
    .select('id, nome_completo, matricula, cpf')
    .or(`nome_completo.ilike.%${v}%,cpf.eq.${v},matricula.eq.${v}`)
    .limit(1);
  return data?.[0] || null;
}

/* ──────────────────────────────────────────────────────────
   TOOLS — definição + handler
   ────────────────────────────────────────────────────────── */

const TOOLS = [
  /* ============= LEITURA ============= */
  {
    name: 'listar_funcionarios',
    description: 'Lista funcionários do sistema com filtros opcionais. Use quando o usuário pedir "quem são os funcionários", "lista todo mundo", "quantas pessoas trabalham aqui", etc.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ativo', 'demitido', 'afastado', 'ferias'], description: 'Filtrar por status (opcional)' },
        departamento: { type: 'string', description: 'Filtrar por nome de departamento (opcional)' },
        busca: { type: 'string', description: 'Buscar por nome, CPF ou matrícula (opcional)' },
      },
    },
    handler: async ({ status, departamento, busca }) => {
      let q = supabase.from('employees')
        .select('id, matricula, nome_completo, cpf, email_pessoal, celular, salario_base, status, data_admissao, departments(nome), positions(titulo)')
        .order('nome_completo').limit(50);
      if (status) q = q.eq('status', status);
      if (busca) q = q.or(`nome_completo.ilike.%${busca}%,cpf.ilike.%${busca}%,matricula.ilike.%${busca}%`);
      const { data, error } = await q;
      if (error) return fail(error.message);
      let resultado = data || [];
      if (departamento) resultado = resultado.filter(e => e.departments?.nome?.toLowerCase().includes(departamento.toLowerCase()));
      return ok(resultado, `${resultado.length} funcionário(s) encontrado(s)`);
    },
  },

  {
    name: 'obter_ficha_completa',
    description: 'Retorna ficha completa de UM funcionário (dados pessoais, holerites, faltas, advertências, férias, etc.). Use quando o usuário perguntar sobre alguém específico.',
    input_schema: {
      type: 'object',
      properties: {
        identificador: { type: 'string', description: 'Nome completo, CPF (com pontos) ou matrícula' },
      },
      required: ['identificador'],
    },
    handler: async ({ identificador }) => {
      const emp = await buscarEmployeeId(identificador);
      if (!emp) return fail(`Funcionário "${identificador}" não encontrado.`);
      const [hist, ferias, holerites, faltas, advs] = await Promise.all([
        supabase.from('salary_history').select('*').eq('employee_id', emp.id).order('data_reajuste', { ascending: false }).limit(5),
        supabase.from('vacations').select('*').eq('employee_id', emp.id),
        supabase.from('payslips').select('competencia_mes, competencia_ano, salario_liquido, status').eq('employee_id', emp.id).order('competencia_ano', { ascending: false }).limit(5),
        supabase.from('absences').select('*').eq('employee_id', emp.id).order('data_inicio', { ascending: false }).limit(10),
        supabase.from('warnings').select('*').eq('employee_id', emp.id).order('data_ocorrencia', { ascending: false }),
      ]);
      const { data: full } = await supabase.from('employees').select('*, departments(nome), positions(titulo,cbo)').eq('id', emp.id).single();
      return ok({
        funcionario: full,
        historico_salarial: hist.data || [],
        ferias: ferias.data || [],
        ultimos_holerites: holerites.data || [],
        faltas_atestados: faltas.data || [],
        advertencias: advs.data || [],
      });
    },
  },

  {
    name: 'dashboard_resumo',
    description: 'Retorna resumo executivo: total de ativos, folha do mês, encargos, aniversariantes. Use quando perguntarem "como está a empresa", "quantos funcionários ativos", "qual o custo da folha", etc.',
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const now = new Date();
      const mes = now.getMonth() + 1;
      const ano = now.getFullYear();
      const [empAtivos, folha] = await Promise.all([
        supabase.from('employees').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
        supabase.from('payslips').select('total_proventos, total_descontos, salario_liquido, inss_valor, irrf_valor, fgts_valor').eq('competencia_mes', mes).eq('competencia_ano', ano),
      ]);
      const fd = folha.data || [];
      return ok({
        funcionarios_ativos: empAtivos.count || 0,
        competencia: `${mes}/${ano}`,
        holerites_gerados: fd.length,
        total_proventos: fd.reduce((s, p) => s + parseFloat(p.total_proventos || 0), 0),
        total_descontos: fd.reduce((s, p) => s + parseFloat(p.total_descontos || 0), 0),
        total_liquido: fd.reduce((s, p) => s + parseFloat(p.salario_liquido || 0), 0),
        total_inss: fd.reduce((s, p) => s + parseFloat(p.inss_valor || 0), 0),
        total_irrf: fd.reduce((s, p) => s + parseFloat(p.irrf_valor || 0), 0),
        total_fgts: fd.reduce((s, p) => s + parseFloat(p.fgts_valor || 0), 0),
      });
    },
  },

  {
    name: 'listar_departamentos',
    description: 'Lista todos os departamentos ativos da empresa',
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const { data, error } = await supabase.from('departments').select('id, nome, codigo, responsavel').eq('active', true).order('nome');
      if (error) return fail(error.message);
      return ok(data || []);
    },
  },

  {
    name: 'listar_cargos',
    description: 'Lista todos os cargos ativos da empresa',
    input_schema: { type: 'object', properties: {} },
    handler: async () => {
      const { data, error } = await supabase.from('positions').select('id, titulo, cbo, nivel, salario_minimo, salario_maximo, departments(nome)').eq('active', true).order('titulo');
      if (error) return fail(error.message);
      return ok(data || []);
    },
  },

  /* ============= CADASTROS ============= */
  {
    name: 'criar_departamento',
    description: 'Cria um novo departamento. Use quando o usuário disser "cadastra um departamento chamado X", "cria o setor Y", etc.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string', description: 'Nome do departamento (ex: "Financeiro")' },
        codigo: { type: 'string', description: 'Código curto (opcional, ex: "FIN")' },
        responsavel: { type: 'string', description: 'Nome do responsável (opcional)' },
      },
      required: ['nome'],
    },
    handler: async ({ nome, codigo, responsavel }) => {
      const { data, error } = await supabase.from('departments').insert({ nome, codigo, responsavel }).select().single();
      if (error) return fail(error.message);
      return ok(data, `Departamento "${nome}" criado com ID ${data.id}`);
    },
  },

  {
    name: 'criar_cargo',
    description: 'Cria um novo cargo/função. Use quando o usuário disser "adiciona o cargo X", "cria a função Y".',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string', description: 'Título do cargo (ex: "Analista Financeiro")' },
        cbo: { type: 'string', description: 'Código CBO (opcional)' },
        nivel: { type: 'string', enum: ['junior','pleno','senior','especialista','coordenador','gerente','diretor'], description: 'Nível (opcional)' },
        salario_minimo: { type: 'number', description: 'Faixa salarial mínima (opcional)' },
        salario_maximo: { type: 'number', description: 'Faixa salarial máxima (opcional)' },
        departamento: { type: 'string', description: 'Nome do departamento ao qual pertence (opcional)' },
      },
      required: ['titulo'],
    },
    handler: async ({ titulo, cbo, nivel, salario_minimo, salario_maximo, departamento }) => {
      let department_id = null;
      if (departamento) {
        const { data: d } = await supabase.from('departments').select('id').ilike('nome', `%${departamento}%`).limit(1);
        if (d?.[0]) department_id = d[0].id;
      }
      const { data, error } = await supabase.from('positions').insert({
        titulo, cbo, nivel, salario_minimo, salario_maximo, department_id,
      }).select().single();
      if (error) return fail(error.message);
      return ok(data, `Cargo "${titulo}" criado`);
    },
  },

  {
    name: 'criar_funcionario',
    description: 'Cadastra um novo funcionário. Use quando o usuário disser "cadastra fulano", "adiciona o funcionário X", etc. Pergunte pelos dados obrigatórios que faltarem (CPF, data nascimento, admissão, salário).',
    input_schema: {
      type: 'object',
      properties: {
        nome_completo: { type: 'string' },
        cpf: { type: 'string', description: 'CPF no formato 000.000.000-00' },
        rg: { type: 'string' },
        data_nascimento: { type: 'string', description: 'YYYY-MM-DD' },
        sexo: { type: 'string', enum: ['M', 'F'] },
        email_pessoal: { type: 'string' },
        celular: { type: 'string' },
        cep: { type: 'string' },
        cidade: { type: 'string' },
        uf: { type: 'string' },
        data_admissao: { type: 'string', description: 'YYYY-MM-DD — padrão hoje se não informado' },
        salario_base: { type: 'number' },
        tipo_contrato: { type: 'string', enum: ['clt','pj','estagio','temporario','aprendiz'] },
        carga_horaria_semanal: { type: 'number', description: 'Padrão 44' },
        departamento: { type: 'string', description: 'Nome do departamento' },
        cargo: { type: 'string', description: 'Título do cargo' },
      },
      required: ['nome_completo', 'cpf', 'data_nascimento', 'salario_base'],
    },
    handler: async (params, ctx) => {
      const payload = { ...params };
      // Validar CPF único
      const { data: dup } = await supabase.from('employees').select('id').eq('cpf', payload.cpf).maybeSingle();
      if (dup) return fail(`CPF ${payload.cpf} já cadastrado`);

      // Resolver departamento/cargo por nome
      if (payload.departamento) {
        const { data: d } = await supabase.from('departments').select('id').ilike('nome', `%${payload.departamento}%`).limit(1);
        if (d?.[0]) payload.department_id = d[0].id;
        delete payload.departamento;
      }
      if (payload.cargo) {
        const { data: p } = await supabase.from('positions').select('id').ilike('titulo', `%${payload.cargo}%`).limit(1);
        if (p?.[0]) payload.position_id = p[0].id;
        delete payload.cargo;
      }

      // Matrícula auto
      const { count } = await supabase.from('employees').select('id', { count: 'exact', head: true });
      payload.matricula = String((count || 0) + 1).padStart(4, '0');
      if (!payload.data_admissao) payload.data_admissao = new Date().toISOString().split('T')[0];
      if (!payload.tipo_contrato) payload.tipo_contrato = 'clt';
      if (!payload.carga_horaria_semanal) payload.carga_horaria_semanal = 44;
      payload.status = 'ativo';
      payload.created_by = ctx.userId;

      const { data, error } = await supabase.from('employees').insert(payload).select().single();
      if (error) return fail(error.message);
      return ok(data, `Funcionário ${data.nome_completo} cadastrado (matrícula ${data.matricula})`);
    },
  },

  /* ============= EVENTOS DO FUNCIONÁRIO ============= */
  {
    name: 'registrar_advertencia',
    description: 'Registra uma advertência disciplinar (verbal, escrita, suspensão ou justa causa). Use quando o usuário disser "advertir fulano", "dá uma advertência para X".',
    input_schema: {
      type: 'object',
      properties: {
        funcionario: { type: 'string', description: 'Nome, CPF ou matrícula do funcionário' },
        tipo: { type: 'string', enum: ['verbal','escrita','suspensao','justa_causa'] },
        motivo: { type: 'string', description: 'Motivo curto da advertência' },
        descricao_detalhada: { type: 'string', description: 'Descrição completa (opcional)' },
        dias_suspensao: { type: 'number', description: 'Apenas se tipo=suspensao' },
        data_ocorrencia: { type: 'string', description: 'YYYY-MM-DD, padrão hoje' },
      },
      required: ['funcionario', 'tipo', 'motivo'],
    },
    handler: async ({ funcionario, tipo, motivo, descricao_detalhada, dias_suspensao, data_ocorrencia }, ctx) => {
      const emp = await buscarEmployeeId(funcionario);
      if (!emp) return fail(`Funcionário "${funcionario}" não encontrado`);
      const { data, error } = await supabase.from('warnings').insert({
        employee_id: emp.id, tipo, motivo, descricao_detalhada,
        dias_suspensao: dias_suspensao || 0,
        data_ocorrencia: data_ocorrencia || new Date().toISOString().split('T')[0],
        aplicada_por: ctx.userId,
      }).select().single();
      if (error) return fail(error.message);
      return ok(data, `Advertência ${tipo} registrada para ${emp.nome_completo}`);
    },
  },

  {
    name: 'registrar_falta_ou_atestado',
    description: 'Registra falta, atestado médico ou afastamento. Use quando o usuário disser "fulano faltou", "registra atestado de X", "tirou licença".',
    input_schema: {
      type: 'object',
      properties: {
        funcionario: { type: 'string' },
        tipo: { type: 'string', enum: ['falta','atestado','licenca_maternidade','licenca_paternidade','afastamento_inss','suspensao','outros'] },
        data_inicio: { type: 'string', description: 'YYYY-MM-DD' },
        data_fim: { type: 'string', description: 'YYYY-MM-DD (opcional)' },
        justificado: { type: 'boolean' },
        cid: { type: 'string', description: 'CID do atestado (opcional)' },
        observacoes: { type: 'string' },
      },
      required: ['funcionario', 'tipo', 'data_inicio'],
    },
    handler: async (params) => {
      const emp = await buscarEmployeeId(params.funcionario);
      if (!emp) return fail(`Funcionário "${params.funcionario}" não encontrado`);
      const payload = { ...params, employee_id: emp.id };
      delete payload.funcionario;
      if (payload.data_fim) payload.dias = Math.floor((new Date(payload.data_fim) - new Date(payload.data_inicio)) / 86400000) + 1;
      else payload.dias = 1;
      const { data, error } = await supabase.from('absences').insert(payload).select().single();
      if (error) return fail(error.message);
      return ok(data, `${params.tipo} de ${emp.nome_completo} registrado (${payload.dias} dia(s))`);
    },
  },

  {
    name: 'solicitar_ferias',
    description: 'Cria solicitação de férias (entra como "pendente" até aprovação). Use quando o usuário disser "fulano quer tirar férias", "agenda férias para X de tal a tal data".',
    input_schema: {
      type: 'object',
      properties: {
        funcionario: { type: 'string' },
        data_inicio: { type: 'string', description: 'YYYY-MM-DD início pretendido' },
        data_fim: { type: 'string', description: 'YYYY-MM-DD fim pretendido' },
        dias_vendidos: { type: 'number', description: 'Dias de abono pecuniário (padrão 0)' },
      },
      required: ['funcionario', 'data_inicio', 'data_fim'],
    },
    handler: async ({ funcionario, data_inicio, data_fim, dias_vendidos }, ctx) => {
      const emp = await buscarEmployeeId(funcionario);
      if (!emp) return fail(`Funcionário "${funcionario}" não encontrado`);
      const dias = Math.floor((new Date(data_fim) - new Date(data_inicio)) / 86400000) + 1;
      const { data, error } = await supabase.from('vacation_requests').insert({
        employee_id: emp.id,
        data_inicio_pretendida: data_inicio,
        data_fim_pretendida: data_fim,
        dias_solicitados: dias,
        dias_vendidos: dias_vendidos || 0,
        status: 'pendente',
        solicitado_por: ctx.userId,
      }).select().single();
      if (error) return fail(error.message);
      return ok(data, `Solicitação criada para ${emp.nome_completo}: ${dias} dia(s). Aguarda aprovação.`);
    },
  },

  {
    name: 'lancar_ponto',
    description: 'Lança/edita as 4 marcações de ponto de um funcionário em uma data específica. Use quando o usuário disser "registra o ponto de fulano dia X", "ajusta ponto de Y", etc.',
    input_schema: {
      type: 'object',
      properties: {
        funcionario: { type: 'string' },
        data: { type: 'string', description: 'YYYY-MM-DD' },
        entrada_1: { type: 'string', description: 'HH:MM (entrada manhã)' },
        saida_1: { type: 'string', description: 'HH:MM (saída almoço)' },
        entrada_2: { type: 'string', description: 'HH:MM (volta do almoço)' },
        saida_2: { type: 'string', description: 'HH:MM (saída fim do dia)' },
        observacao: { type: 'string' },
      },
      required: ['funcionario', 'data'],
    },
    handler: async (params, ctx) => {
      const emp = await buscarEmployeeId(params.funcionario);
      if (!emp) return fail(`Funcionário "${params.funcionario}" não encontrado`);

      const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const m1 = toMin(params.entrada_1), m2 = toMin(params.saida_1);
      const m3 = toMin(params.entrada_2), m4 = toMin(params.saida_2);
      let total = 0;
      if (m1 != null && m2 != null) total += Math.max(0, m2 - m1);
      if (m3 != null && m4 != null) total += Math.max(0, m4 - m3);
      const horas = parseFloat((total / 60).toFixed(2));

      const { data: empData } = await supabase.from('employees').select('carga_horaria_semanal').eq('id', emp.id).single();
      const cargaDiaria = (empData?.carga_horaria_semanal || 44) / 5;

      const dt = new Date(params.data + 'T12:00:00');
      const dow = dt.getDay();
      const ehDescanso = (dow === 0 || dow === 6);
      const extras = ehDescanso ? horas : Math.max(0, horas - cargaDiaria);
      const faltantes = ehDescanso ? 0 : Math.max(0, cargaDiaria - horas);

      const { data, error } = await supabase.from('time_entries').upsert({
        employee_id: emp.id,
        data: params.data,
        entrada_1: params.entrada_1 || null,
        saida_1: params.saida_1 || null,
        entrada_2: params.entrada_2 || null,
        saida_2: params.saida_2 || null,
        horas_trabalhadas: horas,
        horas_extras: parseFloat(extras.toFixed(2)),
        horas_faltantes: parseFloat(faltantes.toFixed(2)),
        observacao: params.observacao,
        ajuste_manual: true,
        ajustado_por: ctx.userId,
      }, { onConflict: 'employee_id,data' }).select().single();

      if (error) return fail(error.message);
      return ok(data, `Ponto de ${emp.nome_completo} em ${params.data} registrado: ${horas}h trabalhadas`);
    },
  },

  {
    name: 'gerar_holerite',
    description: 'Gera o holerite de um funcionário para uma competência. Faz upsert (cria ou recalcula).',
    input_schema: {
      type: 'object',
      properties: {
        funcionario: { type: 'string' },
        mes: { type: 'number', description: '1-12' },
        ano: { type: 'number' },
        data_pagamento: { type: 'string', description: 'YYYY-MM-DD' },
        bonus: { type: 'number', description: 'Bônus (opcional)' },
        faltas_dias: { type: 'number', description: 'Dias de falta (opcional)' },
      },
      required: ['funcionario', 'mes', 'ano'],
    },
    handler: async ({ funcionario, mes, ano, data_pagamento, bonus, faltas_dias }, ctx) => {
      const emp = await buscarEmployeeId(funcionario);
      if (!emp) return fail(`Funcionário "${funcionario}" não encontrado`);

      const { calcularHolerite } = require('./payroll');
      const { calcularHEDoPonto } = require('../utils/pontoExtras');
      const { data: full } = await supabase.from('employees').select('*').eq('id', emp.id).single();

      const heAuto = await calcularHEDoPonto(emp.id, mes, ano, full.carga_horaria_semanal || 44);
      const lanc = { data_pagamento, bonus: bonus || 0, faltas_dias: faltas_dias || 0 };
      if (heAuto.has_data) {
        lanc.horas_extras_50 = heAuto.horas_extras_50;
        lanc.horas_extras_100 = heAuto.horas_extras_100;
      }

      const calc = calcularHolerite(full, lanc, ano);
      const NAO_PERSISTE = ['lancamentos_detalhados', 'salario_familia', 'faixa_irrf', 'ano_tabela', 'vt_total_mes', 'vt_custo_empresa', 'valor_hora'];
      const payload = { employee_id: emp.id, competencia_mes: mes, competencia_ano: ano, created_by: ctx.userId };
      Object.entries(calc).forEach(([k, v]) => { if (!NAO_PERSISTE.includes(k)) payload[k] = v; });

      const { data, error } = await supabase.from('payslips').upsert(payload, { onConflict: 'employee_id,competencia_mes,competencia_ano' }).select().single();
      if (error) return fail(error.message);
      return ok(data, `Holerite de ${emp.nome_completo} para ${mes}/${ano} gerado: líquido R$ ${data.salario_liquido}`);
    },
  },

  /* ============= COMUNICAÇÃO INTERNA ============= */
  {
    name: 'criar_comunicado',
    description: 'Publica um comunicado/aviso interno na Central de Ajuda → aba Comunicados. Use quando o usuário disser "manda um aviso", "comunica para todos que...", "publica um anúncio".',
    input_schema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        conteudo: { type: 'string', description: 'Texto completo do comunicado' },
        categoria: { type: 'string', enum: ['geral','urgente','informativo','treinamento','beneficios','politicas','eventos'] },
        importante: { type: 'boolean', description: 'Marca como destaque vermelho' },
        fixado: { type: 'boolean', description: 'Fixa no topo da lista' },
      },
      required: ['titulo', 'conteudo'],
    },
    handler: async (params, ctx) => {
      const payload = {
        ...params,
        categoria: params.categoria || 'geral',
        importante: !!params.importante,
        fixado: !!params.fixado,
        autor_id: ctx.userId,
        autor_nome: ctx.userName,
      };
      const { data, error } = await supabase.from('announcements').insert(payload).select().single();
      if (error) return fail(error.message);
      return ok(data, `Comunicado "${params.titulo}" publicado`);
    },
  },

  {
    name: 'criar_contato_util',
    description: 'Adiciona um contato útil na Central de Ajuda (RH, DP, médico, sindicato, contabilidade, etc).',
    input_schema: {
      type: 'object',
      properties: {
        categoria: { type: 'string', enum: ['rh','dp','seguranca_trabalho','gestor','ti','financeiro','medico','sindicato','contabilidade','outros'] },
        nome: { type: 'string' },
        cargo: { type: 'string' },
        telefone: { type: 'string' },
        email: { type: 'string' },
        descricao: { type: 'string' },
      },
      required: ['nome', 'categoria'],
    },
    handler: async (params) => {
      const { data, error } = await supabase.from('useful_contacts').insert(params).select().single();
      if (error) return fail(error.message);
      return ok(data, `Contato "${params.nome}" adicionado`);
    },
  },

  /* ============= AUDITORIA ============= */
  {
    name: 'aprovar_ferias',
    description: 'Aprova uma solicitação de férias pendente. Identifica pelo nome do funcionário.',
    input_schema: {
      type: 'object',
      properties: {
        funcionario: { type: 'string' },
        observacao_gestor: { type: 'string' },
      },
      required: ['funcionario'],
    },
    handler: async ({ funcionario, observacao_gestor }, ctx) => {
      const emp = await buscarEmployeeId(funcionario);
      if (!emp) return fail(`Funcionário "${funcionario}" não encontrado`);
      const { data: pend } = await supabase.from('vacation_requests')
        .select('id').eq('employee_id', emp.id).eq('status', 'pendente').order('created_at', { ascending: false }).limit(1);
      if (!pend?.[0]) return fail(`Sem solicitação pendente para ${emp.nome_completo}`);
      const { data, error } = await supabase.from('vacation_requests').update({
        status: 'aprovada',
        observacao_gestor,
        aprovado_por: ctx.userId,
        data_decisao: new Date().toISOString(),
      }).eq('id', pend[0].id).select().single();
      if (error) return fail(error.message);
      return ok(data, `Férias de ${emp.nome_completo} aprovadas`);
    },
  },
];

/* ──────────────────────────────────────────────────────────
   EXECUTOR — recebe { name, input } e roda a tool
   ────────────────────────────────────────────────────────── */
async function executeTool(name, input, ctx) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return { success: false, error: `Tool desconhecida: ${name}` };
  try {
    return await tool.handler(input || {}, ctx);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/* Exporta as definições no formato esperado pela Anthropic API */
function getToolsForAnthropic() {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

module.exports = { TOOLS, executeTool, getToolsForAnthropic };
