/**
 * maestro-agent-trava-manual.ts
 *
 * Trava contra passo a passo inventado (defesa deterministica, irma da guarda
 * de citacoes do loop). O prompt ja proibe; esta camada confere no servidor.
 *
 * O que ela pega:
 *   1. PASSOS SEM MANUAL — a resposta ensina a usar uma tela (lista de passos no
 *      imperativo, ou nomes de menu/botao apresentados como tais) e nenhuma
 *      pagina do manual foi lida neste turno.
 *   2. NOME FORA DA PAGINA — o manual foi lido, mas a resposta apresenta como
 *      menu, aba, botao ou campo um nome que nao esta em nenhuma pagina lida,
 *      nem nos dados consultados, nem na pergunta.
 *
 * E deliberadamente conservadora: so olha nome em **negrito** ou entre aspas
 * que venha LOGO DEPOIS de uma palavra de tela ("clique em", "aba", "botao"...),
 * e caminhos de menu com seta. Negrito de enfase ("**Importante:**", valores)
 * nao conta. Funcoes puras — sem banco, sem modelo.
 */

/** Minusculas, sem acento, sem marcacao e com espaco unico — para comparar nomes. */
export function normalizarParaComparar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[*_`"“”'‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palavras que, logo antes de um nome em destaque, dizem "isto e um elemento de tela".
const PALAVRA_DE_TELA =
  /(?<![\wÀ-ú])(clique|clicar|cliquem|toque|aperte|selecione|selecionar|escolha|escolher|marque|marcar|use|usar|utilize|abra|abrir|acesse|acessar|entre|va|vá|confirme|confirmar|botao|botão|botoes|botões|menu|aba|abas|opcao|opção|opcoes|opções|tela|janela|item|campo|filtro|cartao|cartão|acao|ação|acoes|ações|coluna|grupo)(?![\wÀ-ú])/i;

const VERBO_DE_PASSO =
  /^(acesse|abra|clique|selecione|localize|utilize|use|confirme|escolha|va|vá|entre|marque|preencha|informe|busque|procure|filtre|digite|navegue)(?![\wÀ-ú])/i;

const SETA = /\s*(?:→|->|›|»|>)\s*/;

// Palavras que podem vir GRUDADAS no destaque antes do nome de verdade:
// "**Acesse o menu Financeiro → Carteira**" → o nome e "Financeiro".
const PREFIXO_DE_TELA = new Set([
  'acesse', 'abra', 'clique', 'selecione', 'escolha', 'use', 'va', 'entre', 'confirme', 'em', 'no', 'na', 'o', 'a',
  'os', 'as', 'de', 'do', 'da', 'para', 'ate', 'pelo', 'pela', 'menu', 'aba', 'tela', 'janela', 'botao', 'opcao', 'item', 'campo',
]);

function limparRotulo(bruto: string): string {
  const palavras = bruto
    .replace(/^\s*\d+[.)]\s+/, '') // numeracao de lista ou de titulo: "1. Cancelar..."
    .replace(/^[\s:;,.\-–—]+|[\s:;,.\-–—]+$/g, '')
    .trim()
    .split(/\s+/);
  while (palavras.length > 1 && PREFIXO_DE_TELA.has(normalizarParaComparar(palavras[0]))) palavras.shift();
  return palavras.join(' ');
}

function ehValorOuNumero(rotulo: string): boolean {
  return /^(r\$\s*)?[\d.,/%\s-]+$/i.test(rotulo) || /^\d/.test(rotulo) && rotulo.length <= 12;
}

/**
 * Nomes que a resposta apresenta como menu, aba, botao, campo ou tela.
 * Caminho de menu ("Financeiro → Carteira") vira um nome por trecho.
 */
export function extrairRotulosDeTela(texto: string): string[] {
  const achados = new Set<string>();
  const guardar = (bruto: string) => {
    for (const parte of bruto.split(SETA)) {
      const rotulo = limparRotulo(parte);
      if (rotulo.length >= 3 && rotulo.length <= 70 && !ehValorOuNumero(rotulo)) achados.add(rotulo);
    }
  };

  // (a) destaque (negrito ou aspas) logo depois de uma palavra de tela
  const destaque = /\*\*([^*\n]{2,90})\*\*|"([^"\n]{2,90})"|“([^”\n]{2,90})”/g;
  let m: RegExpExecArray | null;
  while ((m = destaque.exec(texto)) !== null) {
    const conteudo = m[1] ?? m[2] ?? m[3] ?? '';
    // So a MESMA linha conta: titulo em negrito no comeco da linha nao herda o
    // "clique em" do paragrafo de cima.
    const inicioDaLinha = texto.lastIndexOf('\n', m.index - 1) + 1;
    const antes = texto.slice(Math.max(inicioDaLinha, m.index - 45), m.index);
    // So a frase corrente: corta no ultimo ponto final / dois-pontos de titulo.
    const frase = antes.slice(Math.max(antes.lastIndexOf('. '), antes.lastIndexOf('! '), antes.lastIndexOf('? ')) + 1);
    if (PALAVRA_DE_TELA.test(frase)) guardar(conteudo);
    // Destaque que JA e um caminho de menu vale mesmo sem palavra antes.
    else if (/→|›|»/.test(conteudo)) guardar(conteudo);
  }

  // (b) caminho de menu com seta fora de destaque: "Financeiro → Carteira"
  const caminho = /([A-ZÀ-Ú][\wÀ-ú]*(?: [\wÀ-ú]+){0,3})\s*(?:→|›|»)\s*([A-ZÀ-Ú][\wÀ-ú]*(?: [\wÀ-ú]+){0,4})/g;
  while ((m = caminho.exec(texto)) !== null) {
    guardar(m[1]);
    guardar(m[2]);
  }

  return [...achados];
}

/** Quantos itens de lista comecam mandando fazer algo na tela ("1. **Acesse o modulo..."). */
export function contarPassosImperativos(texto: string): number {
  let n = 0;
  for (const linha of texto.split('\n')) {
    const item = /^\s*(?:\d+[.)]|[-•*])\s+(.*)$/.exec(linha);
    if (!item) continue;
    const inicio = item[1].replace(/^[*_"“]+/, '').trim();
    if (VERBO_DE_PASSO.test(inicio.normalize('NFC'))) n++;
  }
  return n;
}

/** A resposta ensina a operar uma tela? (dois passos no imperativo, ou dois nomes de tela) */
export function pareceInstrucaoDeTela(texto: string): boolean {
  return contarPassosImperativos(texto) >= 2 || extrairRotulosDeTela(texto).length >= 2;
}

export type VereditoDaTrava =
  | { tipo: 'ok' }
  | { tipo: 'passos_sem_manual' }
  | { tipo: 'nomes_fora_da_pagina'; nomes: string[] };

export interface EntradaDaTrava {
  /** Resposta candidata do modelo */
  texto: string;
  /** Alguma pagina do manual foi lida com sucesso neste turno? */
  manualLido: boolean;
  /**
   * Tudo o que pode legitimar um nome: paginas lidas, saidas de consulta do
   * turno, a pergunta do usuario e o indice do manual.
   */
  fontes: readonly string[];
}

export function avaliarTravaDoManual(entrada: EntradaDaTrava): VereditoDaTrava {
  if (!entrada.manualLido) {
    return pareceInstrucaoDeTela(entrada.texto) ? { tipo: 'passos_sem_manual' } : { tipo: 'ok' };
  }

  const corpo = normalizarParaComparar(entrada.fontes.join('\n'));
  const fora = extrairRotulosDeTela(entrada.texto).filter(rotulo => {
    const alvo = normalizarParaComparar(rotulo);
    return alvo.length >= 3 && !corpo.includes(alvo);
  });
  return fora.length > 0 ? { tipo: 'nomes_fora_da_pagina', nomes: fora } : { tipo: 'ok' };
}

const OFERTA_FINAL =
  /(s[oó] avisar|[eé] s[oó] (me )?(avisar|chamar|pedir|falar|dizer)|estou [aà] disposi[cç][aã]o|fico [aà] disposi[cç][aã]o|posso ajudar em algo mais|qualquer d[uú]vida|^se (precisar|quiser)\b.*\b(posso|avise|me chame)\b)/i;

/**
 * Tira a despedida do fim de uma resposta de uso ("Qualquer dúvida, só avisar!").
 * O prompt base já proíbe; o modelo insiste. Só remove o ÚLTIMO parágrafo, e só
 * se ele for uma linha curta de oferta — pergunta de verdade ("Quer que eu...?")
 * e conteúdo ficam.
 */
export function removerOfertaFinal(texto: string): string {
  const blocos = texto.trimEnd().split(/\n\s*\n/);
  if (blocos.length < 2) return texto;
  const ultimo = blocos[blocos.length - 1].trim();
  if (ultimo.includes('\n') || ultimo.length > 200 || !OFERTA_FINAL.test(ultimo)) return texto;
  blocos.pop();
  // Sobrou um separador "---" pendurado no fim? Sai junto.
  while (blocos.length > 1 && /^[-*_]{3,}$/.test(blocos[blocos.length - 1].trim())) blocos.pop();
  return blocos.join('\n\n');
}

export const RESPOSTA_SEM_PAGINA_NO_MANUAL =
  'Ainda não tenho o passo a passo dessa tela no manual do Vibe, e não vou improvisar os cliques. ' +
  'Posso consultar a situação real de um pedido para você, ou procurar outra página do manual se você me disser a tela. ' +
  'Para esta dúvida, vale perguntar a quem cuida dessa área.';

export function instrucaoDeCorrecao(veredito: VereditoDaTrava): string | null {
  if (veredito.tipo === 'passos_sem_manual') {
    return (
      'CORREÇÃO OBRIGATÓRIA: a sua resposta ensina a usar uma tela do Vibe, mas você NÃO leu nenhuma página do manual neste turno. ' +
      'Passo a passo só pode sair de consultar_manual. Chame AGORA consultar_manual com a página do índice que cobre o assunto e responda de novo ' +
      'usando somente os nomes de menu, aba e botão que estão na página. Se nenhuma página do índice cobre o assunto, diga com clareza que ainda não tem ' +
      'esse passo a passo no manual — sem descrever cliques, menus ou botões.'
    );
  }
  if (veredito.tipo === 'nomes_fora_da_pagina') {
    return (
      `CORREÇÃO OBRIGATÓRIA: estes nomes aparecem na sua resposta como menu, aba, botão ou campo, mas NÃO estão em nenhuma página do manual lida neste turno: ${veredito.nomes.map(n => `"${n}"`).join(', ')}. ` +
      'Reescreva a MESMA resposta — mantenha os dados do caso consultado, a ordem e todos os outros passos — trocando apenas esses nomes pelos que estão na página, exatamente como escritos. ' +
      'Se o passo não está em nenhuma página lida, leia a página certa com consultar_manual ou diga que o manual não cobre esse ponto — não invente o nome.'
    );
  }
  return null;
}
