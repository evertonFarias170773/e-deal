/**
 * maestro-simple-router.ts
 *
 * Router semântico de inteligência artificial para o Maestro Simple.
 * Traduz consultas do usuário em planos de ferramentas (Tool Calling).
 *
 * Barreira de Segurança Rígida:
 * - Whitelist estrita de ferramentas no servidor.
 * - Sem SQL livre — os parâmetros são validados e mapeados para adapters parametrizados.
 * - Sem caminhos de escrita.
 */

import type { SimpleClientContext, LastAnswerRecord } from './maestro-simple-context';

export interface RouterPeriodoMeses {
  mes: number;
  ano: number;
  label?: string;
}

export interface RouterPeriodo {
  tipo: 'mes_atual' | 'mes_passado' | 'ultimos_dias' | 'mes_especifico';
  mes?: number;
  ano?: number;
  dias?: number;
  label?: string;
}

export type AllowedToolName =
  | 'requisicao_nao_suportada'
  | 'consultarCampoCadastro'
  | 'buscarCliente'
  | 'consultarBoletos'
  | 'consultarPropostasCliente'
  | 'consultarUltimoOrcamento'
  | 'consultarRecebimentoClientePeriodo'
  | 'compararRecebimentoClienteMeses'
  | 'revalidarUltimaConsulta';

export interface RouterStep {
  tool: AllowedToolName;
  params: {
    id_cliente?: number;
    campo?: 'padrao_pagamento' | 'telefone' | 'cnpj' | 'email' | 'cidade' | 'vendedor' | 'credito' | 'restricao' | 'ativo' | 'risco_credito' | 'nome' | 'fundacao';
    busca?: string;
    filtro?: 'todos' | 'atrasados' | 'abertos';
    status?: 'abertas' | 'aprovadas' | 'todas';
    mesesRetroativos?: number;
    meses?: RouterPeriodoMeses[];
    periodo?: RouterPeriodo;
  };
}

export interface RouterPlan {
  steps: RouterStep[];
}

export interface RouterResult {
  routed: boolean;
  plan?: RouterPlan;
  error?: string;
}

// Lista oficial e exclusiva de ferramentas autorizadas (Whitelist no Backend)
const ALLOWED_TOOLS: AllowedToolName[] = [
  'requisicao_nao_suportada',
  'consultarCampoCadastro',
  'buscarCliente',
  'consultarBoletos',
  'consultarPropostasCliente',
  'consultarUltimoOrcamento',
  'consultarRecebimentoClientePeriodo',
  'compararRecebimentoClienteMeses',
  'revalidarUltimaConsulta'
];

/**
 * Roteia a query do usuário para um plano de ferramentas financeiras ou cadastrais estruturado (JSON).
 */
export async function routeToolSimple(
  query: string,
  activeClient: SimpleClientContext | null,
  lastAnswer: LastAnswerRecord | null,
  currentDateIso: string = new Date().toISOString()
): Promise<RouterResult> {
  // 1. Feature Flag check
  if (process.env.MAESTRO_V2_ENABLED !== 'true') {
    return { routed: false };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[MaestroV2Router] OPENAI_API_KEY não configurada — ignorando router.');
    return { routed: false };
  }

  const clientName = activeClient?.clientFantasia || activeClient?.clientName || 'desconhecido';
  const clientId = activeClient?.clientInternalId;

  // Monta o prompt do sistema para roteamento
  const systemPrompt = `
Você é o Router Semântico do Maestro V2 (ERP Ideal).
Seu papel exclusivo é analisar a pergunta do usuário e o contexto ativo e retornar um plano de execução em formato JSON rígido.
NÃO responda em texto normal. Retorne APENAS o JSON conforme o schema.

DATA REFERÊNCIA DO SERVIDOR: ${currentDateIso}
CLIENTE ATIVO NA SESSÃO: "${clientName}" (id_cliente: ${clientId ?? 'nenhum'}).

WHITELIST DE FERRAMENTAS PERMITIDAS:
1. "requisicao_nao_suportada": Use obrigatoriamente se a pergunta não for atendida pelas outras tools.
   - Parâmetros: {}
2. "consultarCampoCadastro": Buscar informação estática.
   - Parâmetros: { campo: "padrao_pagamento" | "telefone" | "cnpj" | "email" | "cidade" | "vendedor" | "credito" | "restricao" | "ativo" | "risco_credito" | "nome" | "fundacao" }
3. "buscarCliente": Selecionar cliente pelo nome ou ID.
   - Parâmetros: { busca: string }
4. "consultarBoletos": Consultar saúde de pagamentos ou dívidas reais ("ele paga em dia?", "atrasa?").
   - Parâmetros: { filtro: "todos" | "atrasados" | "abertos" }
5. "consultarPropostasCliente": Consultar histórico de pedidos reais.
   - Parâmetros: { status: "abertas" | "aprovadas" | "todas", mesesRetroativos: number }
6. "consultarUltimoOrcamento": Consultar apenas o último pedido gerado.
   - Parâmetros: {}
7. "consultarRecebimentoClientePeriodo": Consultar recebimento financeiro de UM período agregado.
   - Parâmetros: { periodo: { tipo: "mes_atual" | "mes_passado" | "ultimos_dias" | "mes_especifico", mes?: number, ano?: number, dias?: number, label?: string } }
8. "compararRecebimentoClienteMeses": Comparar faturamentos recebidos em múltiplos meses específicos.
   - Parâmetros: { meses: [{ mes: number, ano: number, label?: string }] } (máximo de 6 meses).
9. "revalidarUltimaConsulta": Acionar para intenções de confirmação ("tem certeza?", "você conferiu?", "posso confiar?", "isso está certo?", "confere de novo").
   - Parâmetros: {}

REGRAS DE DECISÃO RÍGIDAS E PERÍODOS:
- "Últimos X meses": Significa SEMPRE o mês atual da DATA REFERÊNCIA + os (X-1) meses imediatamente anteriores. Exemplo: Se hoje é Julho/2026, os últimos 3 meses são Maio, Junho e Julho de 2026. NUNCA projete meses futuros.
- Ano Ausente: Se o usuário citar apenas um mês (ex: "maio"), assuma obrigatoriamente o ano da DATA REFERÊNCIA (ex: 2026).
- Edição de Comparação: Se o usuário pedir para alterar a comparação ("traga maio e tire agosto", "troca agosto por maio", "inclui maio", "remove agosto"), leia o JSON "Última resposta dados", modifique a lista de meses conforme solicitado (preenchendo anos ausentes com o ano atual), e chame "compararRecebimentoClienteMeses" emitindo a nova lista COMPLETA de meses.
- Perguntas sobre "padrão de pagamento", "como ele paga", "ele é faturado?" usam "consultarCampoCadastro" com campo="padrao_pagamento".
- A ferramenta "buscarCliente" não deve ser usada se o usuário já estiver se referindo ao cliente ativo ("ele", "dele", "desse cliente").

FORMATO DE RETORNO (JSON RÍGIDO):
{
  "steps": [
    {
      "tool": "nome_da_tool",
      "params": { ... }
    }
  ]
}
  `.trim();

  const userPrompt = `
Pergunta do usuário: "${query}"
Última resposta na sessão (tipo): "${lastAnswer?.type ?? 'nenhuma'}"
Última resposta na sessão (label): "${lastAnswer?.label ?? 'nenhuma'}"
Última resposta na sessão (valor): "${lastAnswer?.value ?? 'nenhuma'}"
Última resposta na sessão (reason): "${lastAnswer?.reason ?? 'nenhuma'}"
Última resposta dados (data): ${lastAnswer?.data ? JSON.stringify(lastAnswer.data) : 'nenhum'}
  `.trim();

  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: process.env.MAESTRO_OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return { routed: false };

    const plan = JSON.parse(text) as RouterPlan;
    if (!plan || !plan.steps) return { routed: false };

    // 2. Validação Rígida no Servidor
    if (plan.steps.length === 0) return { routed: false };
    if (plan.steps.length > 6) {
      console.warn('[MaestroV2Router] Rejeitado: plano excede o máximo de 6 steps.');
      return { routed: false };
    }

    for (const step of plan.steps) {
      // Validar whitelist de ferramentas
      if (!ALLOWED_TOOLS.includes(step.tool)) {
        console.warn(`[MaestroV2Router] Rejeitado: ferramenta desconhecida "${step.tool}".`);
        return { routed: false };
      }

      // Validar cliente ativo
      if (step.tool !== 'requisicao_nao_suportada' && step.tool !== 'buscarCliente') {
        if (!clientId) {
          console.warn('[MaestroV2Router] Rejeitado: ferramenta de consulta necessita de cliente ativo.');
          return { routed: false };
        }
        step.params.id_cliente = clientId; // Força o ID do cliente ativo por segurança
      }

      // Validar consultarCampoCadastro
      if (step.tool === 'consultarCampoCadastro') {
        const { campo } = step.params;
        const validFields = [
          'padrao_pagamento', 'telefone', 'cnpj', 'email', 'cidade', 'vendedor',
          'credito', 'restricao', 'ativo', 'risco_credito', 'nome', 'fundacao'
        ];
        if (!campo || !validFields.includes(campo)) {
          console.warn('[MaestroV2Router] Rejeitado: campo de cadastro inválido.');
          return { routed: false };
        }
      }

      // Validar buscarCliente
      if (step.tool === 'buscarCliente') {
        const { busca } = step.params;
        if (!busca || busca.trim().length < 1) {
          console.warn('[MaestroV2Router] Rejeitado: termo de busca de cliente vazio.');
          return { routed: false };
        }
      }

      // Validar datas e períodos se existirem
      if (step.tool === 'consultarRecebimentoClientePeriodo') {
        const { periodo } = step.params;
        if (!periodo || !periodo.tipo) {
          console.warn('[MaestroV2Router] Rejeitado: periodo inválido.');
          return { routed: false };
        }
      }

      if (step.tool === 'compararRecebimentoClienteMeses') {
        const { meses } = step.params;
        if (!meses || !Array.isArray(meses) || meses.length === 0) {
          console.warn('[MaestroV2Router] Rejeitado: comparação de meses sem períodos.');
          return { routed: false };
        }
        if (meses.length > 6) {
          console.warn('[MaestroV2Router] Rejeitado: comparação excede limite de 6 meses.');
          return { routed: false };
        }
        for (const m of meses) {
          if (!m.mes || !m.ano) {
            console.warn('[MaestroV2Router] Rejeitado: mês/ano ausente na comparação.');
            return { routed: false };
          }
        }
      }
    }

    return {
      routed: true,
      plan
    };

  } catch (err) {
    console.error('[MaestroSimpleRouter] Falha ao parsear ou executar roteamento:', err);
    return { routed: false };
  }
}

