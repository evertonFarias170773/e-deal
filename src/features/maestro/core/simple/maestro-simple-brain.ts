/**
 * maestro-simple-brain.ts
 *
 * Camada de humanização do Maestro Simple v1.
 *
 * Responsabilidade:
 *   Receber a resposta determinística do Presenter e reescrevê-la em
 *   linguagem natural, simpática e contextual usando um LLM.
 *
 * O que o Brain NUNCA faz:
 *   - Consultar banco de dados
 *   - Inventar campos ausentes
 *   - Escolher tool ou action
 *   - Expor tokens, chaves ou dados sensíveis
 *   - Implementar Fase 2 (propostas, pedidos, financeiro)
 *
 * Feature flag:
 *   MAESTRO_SIMPLE_LLM_ENABLED=true  → humaniza com LLM (OpenAI)
 *   MAESTRO_SIMPLE_LLM_ENABLED!=true → retorna resposta determinística (fallback)
 *
 * Segurança:
 *   - OPENAI_API_KEY lida APENAS no servidor (nunca NEXT_PUBLIC_)
 *   - Dados sanitizados antes de enviar ao LLM (CNPJ/CPF parcialmente mascarados)
 *   - Timeout de 8 segundos; fallback gracioso em qualquer erro
 *
 * Prompt Base:
 *   Lido em runtime de docs/MAESTRO-PROMPT-BASE.md via fs (server-side only).
 *   Se o arquivo não existir ou falhar, usa a constante MAESTRO_SYSTEM_PROMPT como fallback.
 *   Cache por processo — reiniciar o servidor reflete edições no .md.
 *   O prompt NUNCA é enviado ao client nem aparece em logs.
 *
 * ⚠️  Este módulo deve ser importado APENAS em contexto server-side.
 *     Nunca importar em 'use client' ou hooks de browser.
 */

import type { SimpleClientContext, SimpleMaestroContext } from './maestro-simple-context';

// ─── Prompt Base — constante fallback (derivada de docs/MAESTRO-PROMPT-BASE.md) ─
// Usada automaticamente quando o arquivo .md não estiver acessível (deploy, CI, etc.).
// Para alterar o comportamento do Maestro em produção sem reiniciar o servidor,
// edite docs/MAESTRO-PROMPT-BASE.md e reinicie o servidor de desenvolvimento.

const MAESTRO_SYSTEM_PROMPT = `
Você é o Maestro, assistente inteligente do ERP Ideal (Ideal Gráfica).
Trabalha para a equipe interna: vendedores, gestores, operadores de produção e financeiro.
Seu papel é responder perguntas reais do dia a dia de forma rápida, precisa e humana.

TOM DE RESPOSTA:
- Direto e objetivo, sem rodeios
- Amigável e profissional — como um colega que conhece o sistema muito bem
- Português brasileiro — sem anglicismos desnecessários
- Resposta curta para perguntas simples; completa para perguntas complexas
- Nunca use jargões técnicos ao usuário (não diga "tool", "presenter", "policy engine", "id_int", "executor")
- Nunca exiba mensagens de sistema como "Execução concluída", "Ação realizada" ou "Processo finalizado"
- Nunca repita "você pode perguntar sobre..." a cada resposta — diga isso apenas quando fizer sentido

REGRA FUNDAMENTAL — NÃO INVENTAR:
- Use APENAS os fatos fornecidos no bloco [DADOS DISPONÍVEIS]. Nunca estime ou complete valores.
- Se um dado estiver marcado como "não cadastrado": diga isso claramente e com naturalidade
- Nunca exiba "—" sem explicação
- Nunca crie dados que não existem nos fatos fornecidos

FASE ATUAL — Fase 2: Inteligência Comercial e Financeira (Conectada)
Disponível nesta fase:
- Dados cadastrais, crédito, vínculos, endereços, etc.
- Histórico de pedidos reais (propostas)
- Faturamento comercial (propostas aprovadas)
- Faturamento financeiro/recebimento real (pagamentos_v2)
- Boletos em aberto/atrasados (boletos)

NÃO disponível ainda (próximas fases):
- Detalhe de produtos e itens específicos do pedido
- Produção, OS e frete
- Emissão de nota fiscal

Quando a pergunta depender de algo não disponível, explique de forma objetiva, sem enrolação.

CONTEXTO ATIVO:
Se há um cliente ativo, perguntas com "ele", "ela", "desse cliente", "deste" referem-se a ele.
Não faça nova consulta se o dado já está nos fatos fornecidos.

REGRA DE FONTE:
Ao citar dado real do ERP, mencione a origem com naturalidade:
"Conforme o cadastro..." / "No ERP, consta que..." / "Pelo cadastro do cliente..."

REGRA DE TABELAS/COMPONENTES:
Se o sistema retornar dados estruturados que serão renderizados pela UI como tabelas ou componentes ricos, NÃO desenhe ou crie tabelas manuais de texto Markdown no "content". Deixe a tabela ser renderizada pelo componente nativo. Limite-se a dar uma introdução curta e amigável.
`.trim();

// ─── Loader do Prompt Base (fs server-side) ───────────────────────────────────
// Cache por processo: reflete edições após reiniciar o servidor.
// O conteúdo NUNCA é logado nem exposto ao client.

let _promptCache: string | null = null;

function loadPromptBase(): string {
  if (_promptCache !== null) return _promptCache;

  // Tenta ler o arquivo .md a partir da raiz do projeto (process.cwd())
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs   = require('fs')   as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');

  const candidates = [
    path.join(process.cwd(), 'docs', 'MAESTRO-PROMPT-BASE.md'),
    path.join(process.cwd(), '..', 'docs', 'MAESTRO-PROMPT-BASE.md'),
  ];

  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content.length > 50) {
        _promptCache = content;
        console.info('[MaestroSimpleBrain] Prompt Base carregado de:', path.basename(path.dirname(filePath)) + '/MAESTRO-PROMPT-BASE.md');
        return _promptCache;
      }
    } catch {
      // Arquivo não encontrado neste path — tenta o próximo
    }
  }

  // Fallback: constante TypeScript
  console.warn('[MaestroSimpleBrain] docs/MAESTRO-PROMPT-BASE.md não encontrado — usando constante fallback.');
  _promptCache = MAESTRO_SYSTEM_PROMPT;
  return _promptCache;
}

// ─── Campos proibidos no prompt ───────────────────────────────────────────────

const FORBIDDEN_PATTERNS = [
  'pix_copia_cola', 'linha_digitavel', 'token_publico',
  'url_cobranca', 'boleto_pdf', 'OPENAI_API_KEY',
  'api_key', 'senha', 'password', 'Bearer ',
];

function sanitizeText(text: string, maxChars = 3000): string {
  let s = text;
  for (const p of FORBIDDEN_PATTERNS) {
    s = s.replace(new RegExp(`.{0,60}${p}.{0,60}`, 'gi'), '[REDACTED]');
  }
  return s.slice(0, maxChars);
}

// ─── Sanitização do Cliente para o LLM ───────────────────────────────────────
// CPF/CNPJ parcialmente mascarados — LLM recebe apenas tipo e sufixo, nunca o número completo.

interface ClientFacts {
  codigo: string;
  nome: string;
  fantasia?: string;
  documento?: string;       // parcialmente mascarado
  tipoPessoa?: string;
  cidade?: string;
  telefone?: string;
  email?: string;
  vendedor?: string;
  ativo?: string;
  bonus?: string;
  riscoCredito?: string;
  restricao?: string;
  dataFundacao?: string;
  qtdPedidos?: string;
  dataUltPedido?: string;
  padraoPagamento?: string;
  categoria?: string;
  enderecos?: string[];
  contatos?: string[];      // sem whatsapp no payload do LLM
  socios?: string[];
}

function maskDocument(doc: string): string {
  const digits = doc.replace(/\D/g, '');
  if (digits.length >= 14) {
    // CNPJ: mostra prefixo e sufixo
    return `${digits.slice(0, 2)}.***.***/****-${digits.slice(-2)}`;
  }
  if (digits.length >= 11) {
    // CPF
    return `***.${digits.slice(3, 6)}.***-${digits.slice(-2)}`;
  }
  return '***';
}

function buildClientFacts(c: SimpleClientContext): ClientFacts {
  const f: ClientFacts = {
    codigo: c.clientDisplayCode,
    nome: c.clientName,
  };

  if (c.clientFantasia && c.clientFantasia !== c.clientName) f.fantasia = c.clientFantasia;
  if (c.clientDocument) f.documento = maskDocument(c.clientDocument);
  if (c.tipoPessoa) f.tipoPessoa = c.tipoPessoa;
  if (c.clientCityUf) f.cidade = c.clientCityUf;
  if (c.clientPhone) f.telefone = c.clientPhone;
  if (c.clientEmail) f.email = c.clientEmail;
  if (c.clientSeller) f.vendedor = c.clientSeller;
  if (c.ativo != null) f.ativo = c.ativo ? 'Sim' : 'Não';
  if (c.restricao != null) f.restricao = c.restricao ? 'Sim' : 'Não';
  if (c.riscoCredito) f.riscoCredito = c.riscoCredito;
  if (c.padraoPagamento) f.padraoPagamento = c.padraoPagamento;
  if (c.categoria) f.categoria = c.categoria;

  if (c.isBonus != null) {
    f.bonus = c.isBonus
      ? `Sim${c.percentualBonus ? ` (${c.percentualBonus}%)` : ''}`
      : 'Não';
  }

  if (c.clientDataFundacao) f.dataFundacao = c.clientDataFundacao;
  if (c.clientQtdPedidos != null) f.qtdPedidos = String(c.clientQtdPedidos);
  if (c.clientDataUltPedido) f.dataUltPedido = c.clientDataUltPedido;

  // Endereços — somente tipo/cidade/UF (sem dados pessoais)
  if (c.enderecos.length > 0) {
    f.enderecos = c.enderecos.map(e => {
      const tipo = e.tipoEndereco || 'endereço';
      const local = [e.cidade, e.uf].filter(Boolean).join(' - ');
      return local ? `${tipo}: ${local}` : tipo;
    });
  }

  // Contatos — nome e cargo apenas (sem whatsapp no payload do LLM)
  if (c.contatos.length > 0) {
    f.contatos = c.contatos
      .map(ct => [ct.nomeContato, ct.cargo ? `(${ct.cargo})` : ''].filter(Boolean).join(' '))
      .filter(Boolean);
  }

  // Sócios — nome e tipo de relação
  if (c.socios.length > 0) {
    f.socios = c.socios.map(s => {
      const nome = s.nomeSocio || `Cliente ${s.idClienteSocio}`;
      return s.tipoRelacao ? `${nome} — ${s.tipoRelacao}` : nome;
    });
  }

  return f;
}

function factsToText(f: ClientFacts): string {
  const lines: string[] = [];
  lines.push(`Cliente: ${f.nome}${f.fantasia && f.fantasia !== f.nome ? ` / Fantasia: ${f.fantasia}` : ''} (código: ${f.codigo})`);
  if (f.documento) lines.push(`CNPJ/CPF: ${f.documento}`);
  if (f.tipoPessoa) lines.push(`Tipo de pessoa: ${f.tipoPessoa}`);
  if (f.cidade) lines.push(`Cidade/UF: ${f.cidade}`);
  if (f.telefone) lines.push(`Telefone: ${f.telefone}`);
  if (f.email) lines.push(`E-mail: ${f.email}`);
  if (f.vendedor) lines.push(`Vendedor responsável: ${f.vendedor}`);
  if (f.ativo != null) lines.push(`Ativo: ${f.ativo}`);
  if (f.restricao != null) lines.push(`Possui restrição: ${f.restricao}`);
  if (f.riscoCredito) lines.push(`Risco de crédito: ${f.riscoCredito}`);
  if (f.padraoPagamento) lines.push(`Padrão de pagamento: ${f.padraoPagamento}`);
  if (f.categoria) lines.push(`Categoria: ${f.categoria}`);
  if (f.bonus != null) lines.push(`Bônus ativo: ${f.bonus}`);
  if (f.dataFundacao) lines.push(`Data de fundação: ${f.dataFundacao}`);
  if (f.qtdPedidos != null) lines.push(`Pedidos registrados no histórico: ${f.qtdPedidos}`);
  if (f.dataUltPedido) lines.push(`Data do último pedido: ${f.dataUltPedido}`);

  // REGRA: só mencionar endereços/contatos se foram CARREGADOS (array não-vazio).
  // Array vazio pode significar "não carregado neste turno", não "ausente no banco".
  // Não emitir falso negativo "nenhum" quando os dados não foram consultados.
  if (f.enderecos && f.enderecos.length > 0) {
    lines.push(`Endereços: ${f.enderecos.join(' | ')}`);
  }
  // se vazio: omitir — o LLM não deve afirmar ausência sem consulta real

  if (f.contatos && f.contatos.length > 0) {
    lines.push(`Contatos secundários: ${f.contatos.join(', ')}`);
  }
  // se vazio: omitir — o LLM não deve afirmar ausência sem consulta real

  if (f.socios && f.socios.length > 0) {
    lines.push(`Sócios/vínculos: ${f.socios.join(', ')}`);
  }

  return lines.join('\n');
}

// ─── Tipos de Entrada e Saída ─────────────────────────────────────────────────

export interface BrainInput {
  /** Mensagem original do usuário */
  userQuery: string;
  /** Intent detectado pelo motor simples */
  intentType: string;
  /** Texto determinístico gerado pelo Presenter — usado como base e como fallback */
  fallbackText: string;
  /** Contexto da sessão (cliente ativo + última resposta) */
  maestroCtx: SimpleMaestroContext;
  /** Nome do usuário logado (para humanização) */
  userName?: string;
  /** Snapshot da cotação ativa — permite ao Brain responder perguntas sobre a cotação */
  activeQuote?: {
    clientName: string;
    itens: Array<{ nome: string; quantidade: number; subtotal: number; pesoUnitario?: number }>;
    enderecoFull: string;
    cep?: string;
    fretes: Array<{ transportadora: string; servico: string; valor: number; prazo?: string }>;
    freteSelecionado: { transportadora: string; servico: string; valor: number; prazo?: string };
    subtotalProdutos: number;
    total: number;
    pesoTotalGramas: number;
    status: string;
    savedIdInt?: number;
  } | null;
}

export interface BrainResult {
  /** Texto final a ser exibido ao usuário */
  humanizedText: string;
  /** Indica se o LLM foi usado (true) ou se foi usado o fallback determinístico (false) */
  usedLLM: boolean;
}

// ─── Brain Principal ──────────────────────────────────────────────────────────

/**
 * Humaniza a resposta determinística do Presenter usando LLM.
 * Se o LLM falhar, demorar ou estiver desabilitado: retorna o fallbackText intacto.
 *
 * Flag de controle: MAESTRO_SIMPLE_LLM_ENABLED=true no .env.local
 */
export async function humanizeWithBrain(input: BrainInput): Promise<BrainResult> {
  // ── Feature flag — retorno imediato se desabilitado ────────────────────────
  if (process.env.MAESTRO_SIMPLE_LLM_ENABLED !== 'true') {
    return { humanizedText: input.fallbackText, usedLLM: false };
  }

  // ── Verificação da chave server-side ──────────────────────────────────────
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[MaestroSimpleBrain] OPENAI_API_KEY não configurada — usando fallback determinístico.');
    return { humanizedText: input.fallbackText, usedLLM: false };
  }

  const { maestroCtx, userQuery, intentType, fallbackText } = input;
  const activeClient = maestroCtx.activeClient;

  // ── Monta bloco de fatos sanitizados — cliente ───────────────────────────
  const factsBlock = activeClient
    ? factsToText(buildClientFacts(activeClient))
    : 'Nenhum cliente ativo nesta conversa.';

  // ── Monta bloco de fatos da cotação ativa (quando existe) ────────────────
  const q = input.activeQuote;
  const quoteBlock = q ? [
    `--- COTAÇÃO ATIVA ---`,
    `Cliente: ${q.clientName}`,
    `Endereço de entrega: ${q.enderecoFull}${q.cep ? ` (CEP: ${q.cep})` : ''}`,
    ``,
    `Itens:`,
    ...q.itens.map((it, i) =>
      `  ${i + 1}. ${it.nome} — ${it.quantidade.toLocaleString('pt-BR')} un. — Subtotal: R$ ${it.subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` +
      (it.pesoUnitario ? ` (peso unit.: ${it.pesoUnitario} g)` : '')
    ),
    ``,
    `Subtotal produtos: R$ ${q.subtotalProdutos.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    `Peso total calculado (c/ margem 2%): ${q.pesoTotalGramas.toLocaleString('pt-BR')} g`,
    ``,
    `Opções de frete:`,
    ...q.fretes.map((f, i) =>
      `  ${i + 1}. ${f.transportadora} (${f.servico}): R$ ${f.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` +
      (f.prazo ? ` — Prazo: ${f.prazo}` : '')
    ),
    ``,
    `Frete selecionado: ${q.freteSelecionado.transportadora} — R$ ${q.freteSelecionado.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}${q.freteSelecionado.prazo ? ` (${q.freteSelecionado.prazo})` : ''}`,
    `Total final: R$ ${q.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
    q.status === 'salva' && q.savedIdInt ? `Status: Salva como proposta #${q.savedIdInt}` : `Status: Não salva ainda`,
  ].join('\n') : '';

  const userPrompt = `
Pergunta do usuário: "${sanitizeText(userQuery, 500)}"
Intenção detectada pelo sistema: ${intentType}

[DADOS DISPONÍVEIS NO ERP]
${sanitizeText(factsBlock, 2000)}
${quoteBlock ? '\n' + sanitizeText(quoteBlock, 1500) : ''}

[SUGESTÃO DE RESPOSTA PREPARADA PELO SISTEMA]
${sanitizeText(fallbackText, 1000)}

Responda à pergunta do usuário seguindo as regras do seu Prompt Base.
Use os DADOS DISPONÍVEIS NO ERP (incluindo a COTAÇÃO ATIVA acima, se presente) e a SUGESTÃO DE RESPOSTA como suas únicas fontes de fatos.
A SUGESTÃO foi gerada pelo motor determinístico do Maestro com dados reais dos adapters read-only.
Você pode humanizar e organizar a resposta, mas não pode alterar, corrigir, inventar, arredondar ou remover valores, datas, IDs, status ou totais.
Se a COTAÇÃO ATIVA estiver presente, use APENAS os dados dela para responder perguntas sobre subtotal, total, frete, peso, itens e endereço.
NÃO diga que não tem acesso a esses dados quando a COTAÇÃO ATIVA estiver no bloco acima.
- ATENÇÃO: Se a SUGESTÃO contiver dados para tabelas estruturadas, NÃO reescreva a tabela em Markdown. Mantenha o content como texto introdutório curto.
Se faltar dado, diga que não está disponível.
Responda em português brasileiro, com tom humano, simpático e profissional.
${input.userName ? `\nO nome do usuário logado é "${input.userName}". Use-o com naturalidade em saudações, confirmações ou encerramentos — não em toda frase.` : ''}
`.trim();

  // ── Chamada ao LLM com timeout ────────────────────────────────────────────
  try {
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ apiKey });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);

    const completion = await openai.chat.completions.create(
      {
        model: process.env.MAESTRO_OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: 'system', content: loadPromptBase() },
          { role: 'user',   content: userPrompt },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const content = completion.choices[0]?.message?.content?.trim();

    if (!content || content.length < 10) {
      console.warn('[MaestroSimpleBrain] Resposta LLM vazia ou muito curta — usando fallback determinístico.');
      return { humanizedText: fallbackText, usedLLM: false };
    }

    return { humanizedText: content, usedLLM: true };

  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.warn(
      `[MaestroSimpleBrain] ${isTimeout ? 'Timeout (8s)' : 'Erro'} na chamada LLM — usando fallback determinístico.`
    );
    return { humanizedText: fallbackText, usedLLM: false };
  }
}
