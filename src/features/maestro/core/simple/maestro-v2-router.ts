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
import type { MaestroV2Context } from './maestro-v2-context-manager';
import { handleContextContinuation } from './maestro-v2-context-manager';
import { detectIntent } from './maestro-simple-intents';
import { processarOrcamentoAvulso } from './maestro-orcamento-engine';

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
  | 'revalidarUltimaConsulta'
  | 'simularOrcamentoAvulso'
  | 'perguntar_tipo_orcamento'
  | 'perguntar_continuacao_orcamento'
  | 'limpar_orcamento_avulso'
  | 'voltar_orcamento_anterior'
  | 'perguntar_quantidade_orcamento'
  | 'recuperacao_orcamento_avulso'
  | 'cancelar_orcamento_avulso'
  | 'mostrar_itens_orcamento'
  | 'orcamento_avulso_desativado'
  // Fase 3a: Save confirmação
  | 'salvar_cotacao_confirmada'
  | 'cancelar_save_cotacao'
  | 'editar_antes_save'
  | 'proposta_ja_salva'
  // Confirmação de cliente pendente
  | 'confirmar_cliente_pendente'
  | 'consultar_fretes_cotacao'
  // Cotação ativa conversável
  | 'consultar_cotacao_ativa'
  | 'trocar_frete_cotacao_ativa'
  | 'iniciar_troca_endereco_cotacao'
  | 'frete_nao_disponivel';

export interface RouterStep {
  tool: AllowedToolName;
  params: {
    id_cliente?: number;
    campo?: 'padrao_pagamento' | 'telefone' | 'cnpj' | 'email' | 'cidade' | 'vendedor' | 'credito' | 'restricao' | 'ativo' | 'risco_credito' | 'nome' | 'fundacao' | 'enderecos' | 'contatos' | 'socios';
    busca?: string;
    filtro?: 'todos' | 'atrasados' | 'abertos';
    status?: 'abertas' | 'aprovadas' | 'todas';
    mesesRetroativos?: number;
    meses?: RouterPeriodoMeses[];
    periodo?: RouterPeriodo;
    itens?: { quantidade: number; termo: string }[];
    addressIndex?: number;
    documentPartial?: boolean;
    documentType?: 'cpf' | 'cnpj';
    /** Para consultar_cotacao_ativa: tipo de consulta */
    query?: string;
    /** Para trocar_frete_cotacao_ativa: id do frete escolhido */
    freteId?: string;
    /** Para frete_nao_disponivel: transportadora mencionada */
    mentioned?: string;
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
  'revalidarUltimaConsulta',
  'simularOrcamentoAvulso',
  'perguntar_tipo_orcamento',
  'perguntar_continuacao_orcamento',
  'limpar_orcamento_avulso',
  'voltar_orcamento_anterior',
  'perguntar_quantidade_orcamento',
  'recuperacao_orcamento_avulso',
  'cancelar_orcamento_avulso',
  'mostrar_itens_orcamento',
  'orcamento_avulso_desativado',
  // Fase 3a
  'salvar_cotacao_confirmada',
  'cancelar_save_cotacao',
  'editar_antes_save',
  'proposta_ja_salva',
  // Confirmação de cliente pendente
  'confirmar_cliente_pendente',
  'consultar_fretes_cotacao',
  // Cotação ativa conversável
  'consultar_cotacao_ativa',
  'trocar_frete_cotacao_ativa',
  'iniciar_troca_endereco_cotacao',
  'frete_nao_disponivel',
];

/**
 * Extrai intenção de cliente de uma query mista (produto + cliente).
 * Aceita: id_cliente NNN, cliente NNN, cli NNN, cadastro NNN, liente NNN, clinte NNN, ciente NNN.
 * NÃO aceita: "id 8469" sozinho sem prefixo de cliente.
 */
function extrairClienteDaQuery(query: string): { tipo: 'id' | 'nome'; valor: string } | null {
  const norm = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // id_cliente 8469 (com underscore ou espaço)
  const matchIdCliente = /\bid[_\s]cliente\s*:?\s*(\d+)/i.exec(norm);
  if (matchIdCliente) return { tipo: 'id', valor: matchIdCliente[1] };

  // cliente 8469 / cli 8469 / cadastro 8469 + typos aceitos
  const matchPrefixo = /\b(cliente|cli|cadastro|liente|clinte|ciente)\s*:?\s*(\d+)/i.exec(norm);
  if (matchPrefixo) return { tipo: 'id', valor: matchPrefixo[2] };

  // cliente Lisiton / cli Lisiton (nome textual — mínimo 3 chars, sem dígitos)
  const matchNome = /\b(cliente|cli|cadastro|liente|clinte|ciente)\s+([a-z][a-z\s]{2,30})$/i.exec(norm);
  if (matchNome) {
    const nome = matchNome[2].trim();
    if (!/^\d+$/.test(nome) && nome.length >= 3) return { tipo: 'nome', valor: nome };
  }

  return null;
}

/**
 * Roteia a query do usuário para um plano de ferramentas financeiras ou cadastrais estruturado (JSON).
 */
export async function routeToolSimple(
  query: string,
  activeClient: SimpleClientContext | null,
  lastAnswer: LastAnswerRecord | null,
  v2Ctx: MaestroV2Context,
  currentDateIso: string = new Date().toISOString()
): Promise<RouterResult> {
  // 1. Feature Flag check
  if (process.env.MAESTRO_V2_ENABLED !== 'true') {
    return { routed: false };
  }

  // 1z. CONTINUAÇÃO DE CONTEXTO ATIVO
  const continuation = handleContextContinuation(query, v2Ctx, activeClient);
  if (continuation) {
    const firstStep = continuation.plan.steps[0];
    console.log('====== [MaestroV2Router] LOG DE DEV ======');
    console.log(`- Domínio ativo: "${v2Ctx.domain}"`);
    console.log(`- Mensagem recebida: "${query}"`);
    console.log(`- Decisão: continuação`);
    console.log(`- Tool/handler usado: "${firstStep?.tool}"`);
    console.log(`- Estado atualizado: ${JSON.stringify(v2Ctx.orcamentoItens ?? [])}`);
    console.log('==========================================');
    return continuation;
  }

  // Interceptador para escolha de endereço pendente
  if (v2Ctx.pendingAddressChoice) {
    const isChoosing = /^(?:use|escolho|escolha|pode usar|quero)?\s*(?:o\s*|endere[cç]o\s*)?(\d+)\b/i.exec(query.trim());
    if (isChoosing) {
      console.log(`[MaestroV2Router] Escolha de endereço detectada: índice ${isChoosing[1]}`);
      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'simularOrcamentoAvulso',
              params: { addressIndex: parseInt(isChoosing[1], 10) }
            }
          ]
        }
      };
    }
  }

  // 1a. REGRA DETERMINÍSTICA DE ORÇAMENTO AVULSO
  const engineResult = processarOrcamentoAvulso(query, { 
    itens: v2Ctx.domain === 'orcamento_avulso' ? (v2Ctx.orcamentoItens || []) : [], 
    pendingAmbiguity: false 
  });
  if (engineResult.action === 'ADD' || engineResult.action === 'REPLACE') {
    const isAvulsoEnabled = process.env.MAESTRO_AVULSO_ENABLED === 'true';

    if (!isAvulsoEnabled) {
      console.log('====== [MaestroV2Router] LOG DE DEV ======');
      console.log(`- Domínio ativo: "${v2Ctx.domain}"`);
      console.log(`- Mensagem recebida: "${query}"`);
      console.log(`- Decisão: router normal (orçamento avulso detectado mas desativado via feature flag)`);
      console.log(`- Tool escolhida: "orcamento_avulso_desativado"`);
      console.log('==========================================');

      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'orcamento_avulso_desativado',
              params: {}
            }
          ]
        }
      };
    }

    // ── VERIFICAÇÃO DE CLIENTE NA QUERY (ANTES de avulso puro) ──────────────
    // Se a query contém produto + sinal de cliente, busca o cliente primeiro.
    // Nunca transforma em avulso puro quando há intenção clara de cliente.
    const clienteNaQuery = extrairClienteDaQuery(query);
    if (clienteNaQuery) {
      // Salva os itens no contexto para uso após resolução do cliente
      v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
      v2Ctx.orcamentoItens = engineResult.items;
      v2Ctx.lastExplicitBudgetItems = engineResult.items;
      v2Ctx.lastExplicitBudgetRequestText = query;
      v2Ctx.domain = 'orcamento_avulso'; // mantém domínio para retomada posterior

      // ── OTIMIZAÇÃO: cliente já ativo com mesmo ID → ir direto para cotação ──
      // Se o cliente mencionado é um ID numérico E esse cliente já está ativo
      // no contexto, podemos pular o buscarCliente e ir direto para a cotação.
      const clienteJaAtivo = clienteNaQuery.tipo === 'id' && (
        activeClient?.clientDisplayCode === clienteNaQuery.valor ||
        String(v2Ctx.activeEntities?.clientInternalId) === clienteNaQuery.valor ||
        // Aceita também o código display numérico
        (activeClient && /^\d+$/.test(clienteNaQuery.valor) && 
          activeClient.clientDisplayCode === clienteNaQuery.valor)
      );

      if (clienteJaAtivo) {
        console.log('====== [MaestroV2Router] LOG DE DEV ======');
        console.log(`- Decisão: intenção composta + cliente já ativo → simularOrcamentoAvulso direto`);
        console.log(`- Cliente ativo: ${activeClient?.clientName} (${activeClient?.clientDisplayCode})`);
        console.log(`- Itens: ${JSON.stringify(engineResult.items)}`);
        console.log('==========================================');
        return {
          routed: true,
          plan: {
            steps: [
              { tool: 'simularOrcamentoAvulso', params: { itens: engineResult.items } }
            ]
          }
        };
      }

      console.log('====== [MaestroV2Router] LOG DE DEV ======');
      console.log(`- Domínio ativo: "${v2Ctx.domain}"`);
      console.log(`- Mensagem recebida: "${query}"`);
      console.log(`- Decisão: produto + cliente detectados → buscarCliente primeiro`);
      console.log(`- Cliente extraído: ${JSON.stringify(clienteNaQuery)}`);
      console.log(`- Itens preservados: ${JSON.stringify(engineResult.items)}`);
      console.log('==========================================');

      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'buscarCliente',
              params: { busca: clienteNaQuery.valor }
            }
          ]
        }
      };
    }

    // Sem sinal de cliente — orçamento avulso puro
    v2Ctx.domain = 'orcamento_avulso';
    v2Ctx.previousOrcamentoItens = JSON.parse(JSON.stringify(v2Ctx.orcamentoItens || []));
    v2Ctx.orcamentoItens = engineResult.items;
    v2Ctx.lastRequestedQuantity = engineResult.items[0].quantidade;
    v2Ctx.lastExplicitBudgetItems = engineResult.items;
    v2Ctx.lastExplicitBudgetRequestText = query;

    console.log('====== [MaestroV2Router] LOG DE DEV ======');
    console.log(`- Domínio ativo: "${v2Ctx.domain}"`);
    console.log(`- Mensagem recebida: "${query}"`);
    console.log(`- Decisão: router normal (inicialização determinística delegada ao motor)`);
    console.log(`- Tool escolhida: "simularOrcamentoAvulso"`);
    console.log(`- Itens extraídos: ${JSON.stringify(engineResult.items)}`);
    console.log('==========================================');

    return {
      routed: true,
      plan: {
        steps: [
          {
            tool: 'simularOrcamentoAvulso',
            params: { itens: engineResult.items }
          }
        ]
      }
    };
  }


  // 1b. REGRA DETERMINÍSTICA DE FALLBACK INTELIGENTE (ESCLARECIMENTO)
  const cleanQuery = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const hasBudgetKeyword = /\b(orcamento|valor|preco|cotacao|custa)\b/i.test(cleanQuery);
  const clientPattern = /\b(cliente|cli|c|cadastro)\s*(\d+|[a-z]+)\b/i;
  const isClientFlow = clientPattern.test(cleanQuery) || /\b(boleto|pagamento|faturamento|limite|historico|cadastro|ativo|vendedor|risco|cnpj|telefone|email|cidade)\b/i.test(cleanQuery);

  if (hasBudgetKeyword && !isClientFlow && !activeClient) {
    const isAvulsoEnabled = process.env.MAESTRO_AVULSO_ENABLED === 'true';

    if (!isAvulsoEnabled) {
      console.log('====== [MaestroV2Router] LOG DE DEV ======');
      console.log(`- Domínio ativo: "${v2Ctx.domain}"`);
      console.log(`- Mensagem recebida: "${query}"`);
      console.log(`- Decisão: router normal (esclarecimento redirecionado para bypass)`);
      console.log(`- Tool escolhida: "orcamento_avulso_desativado"`);
      console.log('==========================================');

      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'orcamento_avulso_desativado',
              params: {}
            }
          ]
        }
      };
    } else {
      console.log('====== [MaestroV2Router] LOG DE DEV ======');
      console.log(`- Domínio ativo: "${v2Ctx.domain}"`);
      console.log(`- Mensagem recebida: "${query}"`);
      console.log(`- Decisão: router normal (esclarecimento)`);
      console.log(`- Tool escolhida: "perguntar_tipo_orcamento"`);
      console.log('==========================================');

      return {
        routed: true,
        plan: {
          steps: [
            {
              tool: 'perguntar_tipo_orcamento',
              params: {}
            }
          ]
        }
      };
    }
  }

  // 1c. Evita chamar LLM para comandos estáticos imediatos seguros
  const initialIntent = detectIntent(query);
  const isImmediateStatic = ['client_lookup', 'client_switch', 'help', 'closure', 'wait_user'].includes(initialIntent.type);
  if (isImmediateStatic) {
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
   - Parâmetros: { campo: "padrao_pagamento" | "telefone" | "cnpj" | "email" | "cidade" | "vendedor" | "credito" | "restricao" | "ativo" | "risco_credito" | "nome" | "fundacao" | "enderecos" | "contatos" | "socios" }
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
10. "simularOrcamentoAvulso": Acionar para simular orçamentos de produtos avulsos por apelido e quantidade ("qual o valor de 2 placas triband e 10 rolos"). NÃO exige cliente ativo.
   - Parâmetros: { itens: [{ quantidade: number, termo: string }] }

REGRAS DE DECISÃO RÍGIDAS E PERÍODOS:
- ORÇAMENTO AVULSO (PRIORIDADE ALTA): Se o usuário pedir "valor", "preço", "cotação" ou "orçamento" com QUANTIDADE e PRODUTO, escolha SEMPRE "simularOrcamentoAvulso".
  - NÃO exija cliente para Orçamento Avulso.
  - Reconheça a quantidade ANTES ("2000 triband"), DEPOIS ("triband 2000"), GRUDADA ("2000triband") ou ABREVIADA ("10k" = 10000).
  - Reconheça múltiplos itens unidos por "e", "+" ou vírgula ("1560 triband + 60 cordão jacaré").
  - NÃO extraia nomes fixos, passe o termo EXATO que o usuário digitou (a tool busca no banco).
- CLIENTE ESPECÍFICO (PRIORIDADE MÁXIMA): Se a frase citar expressamente um cliente (ex: "cliente 14", "cliente João"), histórico, boleto ou propostas reais ("último orçamento do cliente 14"), NÃO use orçamento avulso. Priorize ferramentas de cliente (ex: "consultarUltimoOrcamento", "consultarPropostasCliente", "buscarCliente").
- "Últimos X meses": Significa SEMPRE o mês atual da DATA REFERÊNCIA + os (X-1) meses imediatamente anteriores. Exemplo: Se hoje é Julho/2026, os últimos 3 meses são Maio, Junho e Julho de 2026. NUNCA projete meses futuros.
- Ano Ausente: Se o usuário citar apenas um mês (ex: "maio"), assuma obrigatoriamente o ano da DATA REFERÊNCIA (ex: 2026).
- Edição de Comparação: Se o usuário pedir para alterar a comparação ("traga maio e tire agosto", "troca agosto por maio", "inclui maio", "remove agosto"), leia o JSON "Última resposta dados", modifique a lista de meses conforme solicitado (preenchendo anos ausentes com o ano atual), e chame "compararRecebimentoClienteMeses" emitindo a nova lista COMPLETA de meses.
- Perguntas sobre "padrão de pagamento", "como ele paga", "ele é faturado?" usam "consultarCampoCadastro" com campo="padrao_pagamento".
- Perguntas contextuais sobre relacionamentos ou dados estruturados do cliente ativo como endereços (ex: "e os endereços?", "onde entrega?", "endereço de entrega", "endereços dele", "endereços desse cliente"), contatos (ex: "quem são os contatos?", "contatos dele", "quem são os contatos dele?", "e os contatos?") e sócios/vínculos (ex: "tem sócios?", "sócios dele", "quais os sócios?", "vínculos", "e os vínculos?") usam obrigatoriamente "consultarCampoCadastro" com campo="enderecos", campo="contatos" ou campo="socios". NUNCA use a tool "buscarCliente" ou tente pesquisar por "quem são os contatos" como se fosse o nome de um cliente.
- NOMES PRÓPRIOS SOLTOS: Se o usuário digitar um nome próprio, mesmo curto (ex: "Edison Santos?", "Edison Jr?", "Lisiton?"), e NÃO contiver palavras de relação ("dele", "contato", "socio"), ISSO É UMA NOVA BUSCA DE CLIENTE. OBRIGATORIAMENTE use a tool "buscarCliente", independente de haver um cliente ativo. NUNCA assuma que um nome próprio solto é uma pergunta sobre contatos do cliente ativo.
- A ferramenta "buscarCliente" não deve ser usada se o usuário já estiver se referindo ao cliente ativo usando pronomes ("ele", "dele", "desse cliente").

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
      if (
        step.tool !== 'requisicao_nao_suportada' && 
        step.tool !== 'buscarCliente' && 
        step.tool !== 'simularOrcamentoAvulso' &&
        step.tool !== 'perguntar_tipo_orcamento' &&
        step.tool !== 'perguntar_continuacao_orcamento' &&
        step.tool !== 'limpar_orcamento_avulso' &&
        step.tool !== 'voltar_orcamento_anterior' &&
        step.tool !== 'perguntar_quantidade_orcamento'
      ) {
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
          'credito', 'restricao', 'ativo', 'risco_credito', 'nome', 'fundacao',
          'enderecos', 'contatos', 'socios'
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

    const firstStep = plan.steps[0];
    console.log('====== [MaestroV2Router] LOG DE DEV ======');
    console.log(`- Mensagem recebida: "${query}"`);
    console.log(`- Intenção detectada: Fluxo LLM`);
    console.log(`- Tool escolhida: "${firstStep?.tool}"`);
    console.log(`- Itens extraídos: ${JSON.stringify(firstStep?.params?.itens ?? [])}`);
    console.log('==========================================');

    return {
      routed: true,
      plan
    };

  } catch (err) {
    console.error('[MaestroSimpleRouter] Falha ao parsear ou executar roteamento:', err);
    return { routed: false };
  }
}

