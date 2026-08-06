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

import { APP_NAME } from '@/constants/brand';
import type { SimpleClientContext, LastAnswerRecord } from './maestro-simple-context';

export interface RouterPeriodo {
  startDate: string;
  endDate: string;
  label: string;
}

export type AllowedToolName =
  | 'consultarCampoCadastro'
  | 'consultarResumoCliente'
  | 'buscarCliente'
  | 'consultarBoletos'
  | 'consultarUltimosPedidos'
  | 'consultarMaiorPedido'
  | 'consultarPropostasNaoAprovadas'
  | 'consultarUltimoOrcamento'
  | 'consultarUltimoPedido'
  | 'consultarRecebimentoClientePeriodo'
  | 'compararRecebimentoClienteMeses'
  | 'analisarComparacaoAnterior'
  | 'resposta_frustracao_usuario';

export interface RouterStep {
  tool: AllowedToolName;
  params: {
    id_cliente?: number;
    campo?: 'telefone' | 'cnpj' | 'email' | 'cidade' | 'vendedor' | 'credito' | 'nome' | 'fundacao' | 'cadastro_data' | 'padrao_pagamento' | 'restricao' | 'ativo' | 'risco_credito';
    busca?: string;
    filtro?: 'todos' | 'atrasados' | 'abertos';
    limite?: number;
    startDate?: string;
    endDate?: string;
    label?: string;
    meses?: RouterPeriodo[];
    analise?: 'tabela' | 'melhor_mes' | 'variacao';
    mesA?: string;
    mesB?: string;
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
  'consultarCampoCadastro',
  'consultarResumoCliente',
  'buscarCliente',
  'consultarBoletos',
  'consultarUltimosPedidos',
  'consultarMaiorPedido',
  'consultarPropostasNaoAprovadas',
  'consultarUltimoOrcamento',
  'consultarUltimoPedido',
  'consultarRecebimentoClientePeriodo',
  'compararRecebimentoClienteMeses',
  'analisarComparacaoAnterior'
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
  if (process.env.MAESTRO_TOOL_ROUTER_ENABLED !== 'true') {
    return { routed: false };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[MaestroSimpleRouter] OPENAI_API_KEY não configurada — ignorando router.');
    return { routed: false };
  }

  const clientName = activeClient?.clientFantasia || activeClient?.clientName || 'desconhecido';
  const clientId = activeClient?.clientInternalId;

  // Monta o prompt do sistema para roteamento
  const systemPrompt = `
Você é o Router Semântico do Maestro (${APP_NAME}).
Seu papel exclusivo é analisar a pergunta do usuário e o contexto ativo e retornar um plano de execução em formato JSON rígido.
NÃO responda em texto normal. Retorne APENAS o JSON conforme o schema.

DATA REFERÊNCIA DO SERVIDOR: ${currentDateIso} (Use isto para calcular datas de início e fim de meses como "abril", "maio", "junho", "este mês", "mês passado").
CLIENTE ATIVO NA SESSÃO: "${clientName}" (id_cliente: ${clientId ?? 'nenhum'}).

WHITELIST DE FERRAMENTAS PERMITIDAS:
1. "consultarCampoCadastro": Consultar um campo específico do cadastro do cliente ativo.
   - Parâmetros: { campo: "telefone" | "cnpj" | "email" | "cidade" | "vendedor" | "credito" | "nome" | "fundacao" | "cadastro_data" | "padrao_pagamento" | "restricao" | "ativo" | "risco_credito" }
   - Regra: Use "padrao_pagamento" para "como esse cliente paga?", "ele é faturado?", "qual o padrão de pagamento dele?", "ele costuma pagar como?".
     Use "credito" para limite de crédito ou situação de crédito. Use "restricao" para restrições ou bloqueio cadastral.
2. "consultarResumoCliente": Obter o resumo geral do cadastro do cliente ativo.
   - Parâmetros: {}
3. "buscarCliente": Localizar um cliente pelo nome, código ou documento (CNPJ/CPF) quando o usuário pedir para buscar ou selecionar.
   - Parâmetros: { busca: string }
4. "consultarBoletos": Consultar o status ou comportamento real de boletos/cobranças (em aberto, em atraso, liquidados) do cliente ativo.
   - Parâmetros: { filtro: "todos" | "atrasados" | "abertos" }
   - Regra: Use "consultarBoletos" para "ele costuma pagar em dia?", "ele atrasa?", "tem boleto em atraso?".
5. "consultarUltimosPedidos": Listar as últimas compras aprovadas (pedidos) do cliente ativo.
   - Parâmetros: { limite: number }
6. "consultarMaiorPedido": Localizar o pedido aprovado de maior valor do cliente ativo.
   - Parâmetros: {}
7. "consultarPropostasNaoAprovadas": Listar orçamentos/propostas pendentes (não aprovadas) criadas no mês atual para o cliente ativo.
   - Parâmetros: {}
8. "consultarUltimoOrcamento": Consultar o valor ou detalhes do último orçamento (pendente ou aprovado) criado para o cliente ativo.
   - Parâmetros: {}
9. "consultarUltimoPedido": Consultar o valor ou detalhes do último pedido real aprovado criado para o cliente ativo.
   - Parâmetros: {}
10. "consultarRecebimentoClientePeriodo": Consultar recebimento/faturamento financeiro consolidado de um período específico (pagamentos_v2).
    - Parâmetros: { startDate: string (ISO), endDate: string (ISO), label: string }
11. "compararRecebimentoClienteMeses": Comparar recebimentos financeiros consolidados em múltiplos meses (máximo 6 meses).
    - Parâmetros: { meses: Array<{ startDate: string (ISO), endDate: string (ISO), label: string }> }
12. "analisarComparacaoAnterior": Analisar os dados de comparação imediatamente anterior salvos no contexto.
    - Parâmetros: { analise: "tabela" | "melhor_mes" | "variacao", mesA?: string, mesB?: string }

REGRAS DE DECISÃO RÍGIDAS:
- Padrão de Pagamento Cadastrado vs Histórico Real:
  - Perguntas sobre a REGRA ou ACORDO cadastral ("ele é faturado?", "como esse cliente paga?", "ele costuma pagar como?", "qual o padrão de pagamento?") devem usar obrigatoriamente a tool "consultarCampoCadastro" com campo = "padrao_pagamento".
  - Perguntas sobre o COMPORTAMENTO real de pagamento ("ele costuma pagar em dia?", "ele atrasa?", "tem boa pontualidade?") devem usar a tool "consultarBoletos" com filtro = "todos".
- Se a pergunta pedir faturamento simples ou por período, use "consultarRecebimentoClientePeriodo".
- Se pedir comparação de faturamento por meses, use "compararRecebimentoClienteMeses".
- Se pedir follow-up de período curto (ex: "e em maio?", "e junho?") e o contexto anterior indicar faturamento, chame "consultarRecebimentoClientePeriodo" com as novas datas.
- Se a pergunta NÃO se adequar a nenhuma ferramenta ou se não houver cliente ativo e a ferramenta exigir um, retorne steps vazio.

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
      console.warn('[MaestroSimpleRouter] Rejeitado: plano excede o máximo de 6 steps.');
      return { routed: false };
    }

    for (const step of plan.steps) {
      // Validar whitelist de ferramentas
      if (!ALLOWED_TOOLS.includes(step.tool)) {
        console.warn(`[MaestroSimpleRouter] Rejeitado: ferramenta desconhecida "${step.tool}".`);
        return { routed: false };
      }

      // Validar cliente ativo
      if (step.tool !== 'analisarComparacaoAnterior' && step.tool !== 'buscarCliente') {
        if (!clientId) {
          console.warn('[MaestroSimpleRouter] Rejeitado: ferramenta de consulta necessita de cliente ativo.');
          return { routed: false };
        }
        step.params.id_cliente = clientId; // Força o ID do cliente ativo por segurança
      }

      // Validar consultarCampoCadastro
      if (step.tool === 'consultarCampoCadastro') {
        const { campo } = step.params;
        const validFields = [
          'telefone', 'cnpj', 'email', 'cidade', 'vendedor',
          'credito', 'nome', 'fundacao', 'cadastro_data',
          'padrao_pagamento', 'restricao', 'ativo', 'risco_credito'
        ];
        if (!campo || !validFields.includes(campo)) {
          console.warn('[MaestroSimpleRouter] Rejeitado: campo de cadastro inválido.');
          return { routed: false };
        }
      }

      // Validar buscarCliente
      if (step.tool === 'buscarCliente') {
        const { busca } = step.params;
        if (!busca || busca.trim().length < 1) {
          console.warn('[MaestroSimpleRouter] Rejeitado: termo de busca de cliente vazio.');
          return { routed: false };
        }
      }

      // Validar datas e períodos se existirem
      if (step.tool === 'consultarRecebimentoClientePeriodo') {
        const { startDate, endDate } = step.params;
        if (!startDate || !endDate || isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate))) {
          console.warn('[MaestroSimpleRouter] Rejeitado: datas inválidas em período simples.');
          return { routed: false };
        }
      }

      if (step.tool === 'compararRecebimentoClienteMeses') {
        const { meses } = step.params;
        if (!meses || !Array.isArray(meses) || meses.length === 0) {
          console.warn('[MaestroSimpleRouter] Rejeitado: comparação de meses sem períodos.');
          return { routed: false };
        }
        if (meses.length > 6) {
          console.warn('[MaestroSimpleRouter] Rejeitado: comparação excede limite de 6 meses.');
          return { routed: false };
        }
        for (const m of meses) {
          if (!m.startDate || !m.endDate || isNaN(Date.parse(m.startDate)) || isNaN(Date.parse(m.endDate))) {
            console.warn('[MaestroSimpleRouter] Rejeitado: data inválida em comparação de meses.');
            return { routed: false };
          }
        }
      }

      // Validar análise comparativa
      if (step.tool === 'analisarComparacaoAnterior') {
        const { analise } = step.params;
        if (!analise || !['tabela', 'melhor_mes', 'variacao'].includes(analise)) {
          console.warn('[MaestroSimpleRouter] Rejeitado: tipo de análise inválido.');
          return { routed: false };
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

