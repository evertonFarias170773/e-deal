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
 *   3. Número SOLTO de 4 a 6 dígitos ("o 23071 está APROVADO") entra na mesma
 *      regra quando a frase o trata como um pedido e há dado de pedido ao lado.
 *      Quantidade, CEP, valor, telefone, data e código de cliente não entram.
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
/**
 * A chamada de consultar_pedido traz um número de pedido de verdade? Recebe os
 * argumentos como o modelo mandou (JSON). Sem número, zero, negativo, fracionado
 * ou texto que não é número: falso — a consulta não deve nem rodar.
 */
export function chamadaTemNumeroDePedido(argumentosJson: string | null | undefined): boolean {
  let numero: unknown;
  try {
    numero = (JSON.parse(argumentosJson || '{}') as { numero?: unknown }).numero;
  } catch {
    return false;
  }
  if (typeof numero === 'string' && /^\d{1,9}$/.test(numero.trim())) numero = Number(numero.trim());
  return typeof numero === 'number' && Number.isInteger(numero) && numero > 0;
}

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

// ─── Número solto ────────────────────────────────────────────────────────────
// "Qual a situação do 23071?" → "O 23071 está APROVADO, R$ 146,18". Sem a
// palavra pedido/proposta a regra acima não vê o número. Aqui entra o inteiro
// de 4 a 6 dígitos que a frase trata como UM pedido (artigo antes, título de
// linha ou verbo de situação depois) e que tem dado de pedido por perto.
// Quantidade, CEP, valor, telefone, data, ano e código de cliente ficam fora.

/** Dado de pedido perto do número: cliente, valor, status, cobrança, produção. */
const DADO_DE_PEDIDO =
  /R\$\s*\d|\bclientes?\b|\bvendedor|\bstatus\b|cobran[çc]a|\bpag[oa]s?\b|pagamento|\bpix\b|\bboletos?\b|produ[çc][ãa]o|aprovad|aguardando|liberad|entregue|cancelad|reprovad|faturad|\bfrete\b|nota fiscal|expedi[çc]/i;

/** O número vem rotulado como outra coisa (na mesma linha, logo antes). */
const ROTULO_DE_OUTRA_COISA =
  /(?:quantidades?|qtde?s?|clientes?|c[óo]digos?|c[óo]d|id|cep|o\.?s\.?|ordem|nf-?e?|notas?|protocolos?|telefones?|fone|tel|whats(?:app)?|celular|ramal|ano|parcelas?|estoque|saldo|total|subtotal|valor|pre[çc]o|cnpj|cpf|lote)\b[^\n\d]{0,15}$/i;

/** O número vem rotulado como pedido, com pontuação no meio ("**Pedido:** 23071"). */
const ROTULO_DE_PEDIDO = /(?<![\wÀ-ú])(?:pedidos?|propostas?|or[çc]amentos?)[\s:*_.\-–—]*(?:n[º°o.]{1,2}[\s:*_]*)?$/i;

/** Palavra logo antes que faz do número uma quantidade ou faixa ("de 5000", "até 5000"). */
const ANTES_E_QUANTIDADE = /(?:^|[\s(])(?:de|com|por|para|cada|e|ou|at[ée]|entre|s[ãa]o|os|as|x|×|mais|menos|acima|partir)\s+[*_]*$/i;

/** Unidade ou coisa contada logo depois ("5000 unidades", "5000 tribands"). */
const DEPOIS_E_UNIDADE =
  /^[*_]*\s*(?:unidades?|unid\b|un\b|p[çc]s?\b|pe[çc]as?|pulseiras?|ingressos?|itens|cart[õo]es|crach[áa]s?|cord[õo]es|copos?|adesivos?|folhas?|tribands?|mobi\b|mil\b|milheiros?|kg\b|g\b|mm\b|cm\b|ml\b|m\b|dias?|horas?|reais|vezes|x\b|×|%)/i;

/** Verbo ou advérbio de situação logo depois ("23071 está", "23071 já foi"). */
const DEPOIS_E_SITUACAO =
  /^[*_]*\s+(?:est[áa]|est[ãa]o|[ée]|foi|foram|consta|encontra-se|pertence|segue|permanece|continua|aguarda|tem|j[áa]|ainda|n[ãa]o|tamb[ée]m)(?![\wÀ-ú])/i;

/** Depois de um artigo, o número é pedido salvo se vier um substantivo contado ("a 5000 pulseiras"). */
const CONECTIVO_DEPOIS =
  /^(?:est[áa]|est[ãa]o|[ée]|foi|foram|consta|encontra-se|pertence|segue|permanece|continua|aguarda|tem|j[áa]|ainda|n[ãa]o|tamb[ée]m|da|do|de|em|com|para|e|ou|que|no|na)$/i;

/**
 * Números de 4 a 6 dígitos que a resposta trata como um pedido SEM usar as
 * palavras pedido, proposta ou orçamento, e que vêm ao lado de dados de pedido.
 */
export function extrairNumerosSoltosDePedido(texto: string): string[] {
  const achados = new Set<string>();
  const re = /(?<!\d)\d{4,6}(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const n = m[0];
    const ini = m.index;
    const fim = ini + n.length;
    const inicioDaLinha = texto.lastIndexOf('\n', ini - 1) + 1;
    const fimDaLinha = texto.indexOf('\n', fim);
    const antes = texto.slice(inicioDaLinha, ini);
    const depois = texto.slice(fim, fimDaLinha === -1 ? texto.length : fimDaLinha);

    // Formato de outra coisa: valor, CEP, telefone, data, hora, ano.
    if (/[\d.,/\-:+#]$/.test(antes)) continue;               // 49.941 · 02/10/2026 · 99999-1234 · #23071 (regra de cima)
    if (/R\$\s*$/.test(antes)) continue;                      // R$ 5000
    if (/\)\s*$/.test(antes)) continue;                       // (51) 99999...
    if (/\d{2,}\s$/.test(antes)) continue;                    // 51 99999 1234
    if (/^(?:[.,]\d|[/:]\d|-\d|\s\d{3,4}(?!\d))/.test(depois)) continue; // 5000,00 · 96810-400 · 3333 4444
    const valor = Number(n);
    if (n.length === 4 && valor >= 1990 && valor <= 2099) continue; // ano
    if (ROTULO_DE_OUTRA_COISA.test(antes)) continue;          // Quantidade: 5000 · cliente 63708 · CEP 96810
    if (DEPOIS_E_UNIDADE.test(depois)) continue;              // 5000 unidades · 5000 tribands

    // Rotulado como pedido, com pontuação no meio: vale como a regra de cima.
    if (ROTULO_DE_PEDIDO.test(antes)) {
      achados.add(n);
      continue;
    }

    // A frase trata o número como UM pedido?
    const aposArtigo =
      /(?:^|[\s(*_"'“])(?:o|a|do|da|ao|à|no|na|pelo|pela|n[º°]\.?|n\.|n[úu]mero)\s+[*_]*$/i.test(antes) &&
      !/\d\s+a\s+[*_]*$/i.test(antes); // "de 1000 a 5000" é faixa
    const palavraSeguinte = /^[*_]*\s+([a-zà-ú][\wÀ-ú-]*)/.exec(depois)?.[1];
    const artigoEPedido = aposArtigo && (!palavraSeguinte || CONECTIVO_DEPOIS.test(palavraSeguinte));

    const comecoDeLinha = /^[^\p{L}\p{N}]*$/u.test(antes);
    const tituloDeLinha =
      comecoDeLinha && (/^[*_]*\s*$/.test(depois) || /^[*_]*\s*(?:[—–:(]|-\s)(?!\s*(?:R\$|\d))/.test(depois));

    const seguidoDeSituacao = DEPOIS_E_SITUACAO.test(depois) && !ANTES_E_QUANTIDADE.test(antes);

    if (!artigoEPedido && !tituloDeLinha && !seguidoDeSituacao) continue;

    // Só conta se houver dado de pedido ao lado (não barra "você quis dizer o 23071?").
    const vizinhanca = texto.slice(Math.max(0, ini - 200), Math.min(texto.length, fim + 600));
    if (!DADO_DE_PEDIDO.test(vizinhanca)) continue;

    achados.add(n);
  }
  return [...achados];
}

/**
 * Pedidos citados na resposta que NÃO foram consultados nesta pergunta.
 * `codigosDaSessao`: códigos que o servidor já conhece (cliente ativo, candidatos)
 * — valem só para o número solto, que pode ser um código de cliente sem rótulo.
 */
export function pedidosCitadosSemConsulta(
  texto: string,
  consultados: ReadonlySet<string>,
  codigosDaSessao: ReadonlySet<string> = new Set(),
): string[] {
  const faltando = new Set(extrairPedidosCitados(texto).filter(n => !consultados.has(n)));
  for (const n of extrairNumerosSoltosDePedido(texto)) {
    if (!consultados.has(n) && !codigosDaSessao.has(n)) faltando.add(n);
  }
  return [...faltando];
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
        'Não reaproveite cliente, valor, status, cobrança nem data de respostas anteriores. ' +
        'Vale também para o número escrito sozinho, sem a palavra pedido. Se o número NÃO for um pedido, reescreva dizendo o que ele é (quantidade, código do cliente, CEP).',
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
