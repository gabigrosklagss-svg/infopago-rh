/**
 * Agente IA — extração de dados de currículo usando Claude API
 *
 * Aceita PDF, imagem (JPG/PNG/WebP) ou texto puro e retorna JSON
 * estruturado com os campos para preencher a ficha do funcionário.
 */

const Anthropic = require('@anthropic-ai/sdk');

let client = null;

function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY não configurada no .env. Adquira em https://console.anthropic.com');
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/* Schema dos campos extraíveis. Documentado para a IA. */
const EMPLOYEE_SCHEMA = `
Campos disponíveis para extrair (use null se não encontrado):

Identificação:
- nome_completo (string)
- cpf (formato "000.000.000-00")
- rg (string)
- rg_orgao_emissor (ex: "SSP")
- rg_uf (sigla de 2 letras)
- pis_pasep (string)
- ctps (string)
- ctps_serie (string)

Pessoais:
- data_nascimento (formato "YYYY-MM-DD")
- sexo ("M" ou "F")
- estado_civil ("solteiro", "casado", "divorciado", "viuvo", "uniao_estavel")
- escolaridade (ex: "Ensino Superior Completo")
- naturalidade (cidade onde nasceu)
- nacionalidade (padrão "Brasileiro(a)")
- nome_mae (string)
- nome_pai (string)

Contato:
- email_pessoal (e-mail válido)
- telefone (com DDD, formato "(00) 0000-0000")
- celular (com DDD, formato "(00) 00000-0000")

Endereço:
- cep (formato "00000-000")
- logradouro (rua/avenida)
- numero (string)
- complemento (string)
- bairro (string)
- cidade (string)
- uf (sigla 2 letras)

Trabalho (se mencionado no CV):
- tipo_contrato ("clt", "pj", "estagio", "temporario", "aprendiz")
- carga_horaria_semanal (número, padrão 44)
- cargo_pretendido (cargo que o candidato busca — campo livre, não vincula a position_id)
- experiencia_resumo (até 300 caracteres resumindo experiência profissional)
- competencias (array de strings com habilidades técnicas)

Importante:
- Se o documento NÃO for um currículo (ex: comprovante de residência, identidade isolada, etc.), retorne tipo = "outro_documento" e extraia o que conseguir.
- Sempre formate CPF, telefone e CEP com a máscara padrão.
- Datas SEMPRE no formato YYYY-MM-DD.
- Não invente dados. Se não tiver certeza, use null.
`;

const SYSTEM_PROMPT = `Você é um especialista em RH brasileiro com conhecimento profundo da CLT e dos padrões de currículos no Brasil.

Sua tarefa é extrair dados estruturados de currículos, formulários ou textos enviados pelo usuário, retornando APENAS um objeto JSON válido (sem markdown, sem explicação, sem texto antes ou depois).

${EMPLOYEE_SCHEMA}

Formato de retorno OBRIGATÓRIO:
{
  "tipo": "curriculo" | "outro_documento" | "dados_diretos",
  "confianca": "alta" | "media" | "baixa",
  "dados": { /* campos extraídos */ },
  "observacoes": "string opcional com avisos ou notas"
}
`;

/**
 * Extrai dados de um currículo
 * @param {object} input
 * @param {Buffer} [input.fileBuffer] - buffer do arquivo (opcional)
 * @param {string} [input.mimeType] - mime type do arquivo (opcional)
 * @param {string} [input.text] - texto direto (opcional)
 */
async function extrairDadosCurriculo({ fileBuffer, mimeType, text }) {
  const c = getClient();
  const content = [];

  if (fileBuffer && mimeType) {
    if (mimeType === 'application/pdf') {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: fileBuffer.toString('base64'),
        },
      });
    } else if (mimeType.startsWith('image/')) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: fileBuffer.toString('base64'),
        },
      });
    } else {
      throw new Error(`Tipo de arquivo não suportado: ${mimeType}`);
    }
  }

  if (text && text.trim()) {
    content.push({
      type: 'text',
      text: `Dados/texto enviados pelo usuário:\n\n${text.trim()}`,
    });
  }

  if (content.length === 0) {
    throw new Error('Envie um arquivo OU um texto com os dados do candidato.');
  }

  content.push({
    type: 'text',
    text: 'Extraia os dados do candidato no formato JSON especificado. Retorne APENAS o JSON, sem texto adicional.',
  });

  const response = await c.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
  });

  // Resposta esperada: texto JSON
  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  // Remove possíveis fences markdown que o modelo pode adicionar mesmo instruído
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Resposta da IA não é JSON válido. Texto bruto: ${raw.slice(0, 300)}`);
  }

  return {
    ...parsed,
    _meta: {
      modelo: response.model,
      tokens_entrada: response.usage?.input_tokens,
      tokens_saida: response.usage?.output_tokens,
    },
  };
}

module.exports = { extrairDadosCurriculo };
