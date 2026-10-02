/**
 * maestro-agent-trava-pedido.ts
 *
 * Trava: número de pedido citado na resposta = pedido CONSULTADO nesta pergunta.
 *
 * O CASO (02/10/2026, maestro_mensagens 1725, auditoria 761)
 *   Na mesma conversa o usuário perguntou a situação do pedido 23020 e, depois,
 *   a do 23071. Na segunda o modelo fez ZERO consultas: copiou do histórico a
 *   resposta do 23020 (Glaucius, R$ 146,18), trocou o número e fechou com
 *   "Fonte: Pedido 23071 e cobranças (ERP)". O 23071 era da Lisiton, R$ 491,69.
 *
 * POR QUE A GUARDA DE CITAÇÕES NÃO PEGOU
 *   Ela aceita como "confirmado" todo número que o usuário digitou na pergunta
 *   — existe para o modelo poder dizer "não encontrei o 12345". Só que aí o
 *   número perguntado nunca é suspeito, mesmo sem consulta nenhuma.
 *
 * A REGRA NOVA
 *   1. Número apresentado como pedido ou proposta ("pedido 23071", "N° prop.
 *      23071", "#23071") só passa se uma ferramenta foi chamada com esse número,
 *      ou devolveu esse número, NESTA pergunta. A pergunta do usuário e o
 *      histórico não contam.
 *   2. Linha de "Fonte:" só passa se alguma consulta deu certo nesta pergunta.
 *
 * Funções puras — sem banco, sem modelo. Quem aplica é o loop.
 */

/** Todo número de 3+ dígitos de um JSON de argumentos de ferramenta. */
export function coletarNumerosDosArgumentos(json: string, destino: Set<string>): void {
  const re = /\d{3,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) destino.add(m[0]);
}

/**
 * Números que a resposta apresenta EXPLICITAMENTE como pedido ou proposta.
 * Diferente de `extrairNumerosDePropostaCitados` (do loop), não pega número
 * solto: quantidade, valor e código de cliente não entram aqui.
 */
export function extrairPedidosCitados(texto: string): string[] {
  const achados = new Set<string>();
  const padroes = [
    // "pedido 23071", "Pedido nº 23071", "proposta #23071", "orçamento n. 23071"
    /(?<![\wÀ-ú])(?:propostas?|pedidos?|or[çc]amentos?)\s+(?:reais?\s+)?(?:n(?:[º°o]|\.|[úu]mero)\.?\s*)?#?\s*(\d{3,7})(?![\d.,/]\d)/gi,
    // "N° prop. 23071", "prop. 23071"
    /(?<![\wÀ-ú])prop\.?\s*#?\s*(\d{3,7})(?![\d.,/]\d)/gi,
    // "#23071"
    /#(\d{4,7})(?![\d.,/]\d)/g,
  ];
  for (const re of padroes) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) {
      // "pedido 1000 unidades" é quantidade, não número de pedido.
      const depois = texto.slice(m.index + m[0].length, m.index + m[0].length + 14);
      if (/^\s*(unidades|un\b|pe[çc]as|pulseiras|ingressos|itens)/i.test(depois)) continue;
      achados.add(m[1]);
    }
  }
  return [...achados];
}

/** Pedidos citados na resposta que NÃO foram consultados nesta pergunta. */
export function pedidosCitadosSemConsulta(texto: string, consultados: ReadonlySet<string>): string[] {
  return extrairPedidosCitados(texto).filter(n => !consultados.has(n));
}

const LINHA_DE_FONTE = /(^|\n)[ \t]*(?:[*_>-]+\s*)?fontes?(?:\*\*|__|\*|_)?\s*:[^\n]*/gi;

/** A resposta declara uma fonte sem que nenhuma consulta tenha dado certo nesta pergunta. */
export function citaFonteSemConsulta(texto: string, consultasComSucesso: number): boolean {
  if (consultasComSucesso > 0) return false;
  LINHA_DE_FONTE.lastIndex = 0;
  return LINHA_DE_FONTE.test(texto);
}

export function removerLinhasDeFonte(texto: string): string {
  return texto.replace(LINHA_DE_FONTE, '$1').replace(/\n{3,}/g, '\n\n').trim();
}

export function correcaoDePedidoSemConsulta(pedidos: readonly string[], fonteSemConsulta: boolean): string {
  const partes: string[] = ['CORREÇÃO OBRIGATÓRIA:'];
  if (pedidos.length > 0) {
    partes.push(
      `a sua resposta cita o(s) pedido(s) ${pedidos.join(', ')} sem ter consultado esse número NESTA pergunta. ` +
        'O histórico da conversa NÃO é fonte: os dados que você escreveu são de outra consulta, possivelmente de OUTRO pedido. ' +
        `Chame AGORA consultar_pedido com numero=${pedidos[0]}${pedidos.length > 1 ? ' (e os demais, um por chamada)' : ''} e responda de novo SOMENTE com o que a ferramenta devolver. ` +
        'Não reaproveite cliente, valor, status, cobrança nem data de respostas anteriores.',
    );
  }
  if (fonteSemConsulta) {
    partes.push(
      'A sua resposta declara uma "Fonte" mas você não consultou nada nesta pergunta. Fonte só pode citar consulta feita AGORA: ' +
        'chame a ferramenta adequada e responda de novo, ou responda sem dados e sem a linha de Fonte.',
    );
  }
  return partes.join(' ');
}

/** Texto fixo quando, mesmo depois da correção, o pedido citado não foi consultado. */
export function respostaDePedidoSemConsulta(pedidos: readonly string[]): string {
  const quais = pedidos.length === 1 ? `o pedido ${pedidos[0]}` : `os pedidos ${pedidos.join(', ')}`;
  return (
    `Não consegui consultar ${quais} nesta resposta, então não vou informar dados ${pedidos.length === 1 ? 'dele' : 'deles'}. ` +
    'Pergunte de novo que eu consulto na hora.'
  );
}

export const AVISO_SEM_CONSULTA =
  '⚠️ Não consultei o ERP nesta resposta: o que está acima veio da conversa anterior e pode estar desatualizado.';
