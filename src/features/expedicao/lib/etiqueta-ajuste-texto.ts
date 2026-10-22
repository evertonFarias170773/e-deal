import { ETIQUETA_LARGURA_PT, ETIQUETA_PADDING_PT } from "./etiqueta-apresentacao";
import { LARGURAS_HELVETICA, LARGURAS_HELVETICA_BOLD } from "./etiqueta-metricas-helvetica";

/**
 * AJUSTE DE TEXTO DA ETIQUETA 10x15 — a regra unica dos campos longos (22/10/2026).
 *
 * O DEFEITO (pedido 23095, IMPRIZIL SISTEMAS DE IDENTIFICACAO E IMPRESSOS DE SEGURANCA LTDA, Goiania/GO)
 *   O bloco do destinatario tinha `maxHeight: 80` e cada campo era um `Text` solto. Nome em duas linhas, A/C
 *   igual ao nome em duas, endereco com "LOTE 8 E 9 SALA 3 E 4" em duas, bairro e fone: 12 linhas para 80 pt.
 *   O react-pdf (yoga) nao corta o conteudo para caber no maxHeight — ele ENCOLHE as caixas dos filhos, e as
 *   linhas de um campo passam a ser desenhadas por cima das do vizinho: o nome invadia o A/C, o endereco, o
 *   bairro e o fone. As observacoes tinham o mesmo desenho (`maxHeight: 24`, corte por caracteres).
 *
 * A REGRA
 *   1. O texto e medido de verdade (metricas Helvetica do pdfkit, `etiqueta-metricas-helvetica.ts`), com 3% de
 *      folga na largura — nao por contagem de caracteres.
 *   2. Se o bloco nao cabe na altura reservada, TODOS os campos descem juntos, em degraus de 0,5 pt, ate o
 *      minimo legivel (7 pt). Campo que chega ao minimo para; os outros seguem descendo.
 *   3. Se ainda nao cabe no minimo, TRUNCAMENTO CONTROLADO: o campo de menor prioridade (A/C primeiro, depois
 *      bairro, endereco e, por ultimo, o nome) perde linhas e termina em "…".
 *   4. A altura que sai daqui e a que o desenho usa; nenhum campo e encolhido pelo layout, entao um nao
 *      sobrepoe o outro. Texto curto (cabe no tamanho cheio) sai com os MESMOS tamanhos de antes.
 *
 * Funcoes puras: sem React, sem react-pdf, sem Supabase.
 */

export type FonteEtiqueta = "Helvetica" | "Helvetica-Bold";

/** Menor corpo que a etiqueta aceita. Abaixo disso o termico nao imprime legivel. */
export const TAMANHO_MINIMO_PT = 7;
/** Degrau da reducao. */
export const PASSO_PT = 0.5;
/** Altura de uma linha / tamanho da fonte, MEDIDA no react-pdf com Helvetica (12 pt -> 13,2 pt; 10 pt -> 11 pt). */
export const ALTURA_LINHA = 1.1;
/** Folga na largura: a medicao nunca fica abaixo do que o react-pdf desenha (ele nao usa kerning aqui). */
const FOLGA_LARGURA = 0.97;

/** Largura util de um campo dentro da moldura: pagina - margens - borda (2 + 2) - padding horizontal (10 + 10). */
export const LARGURA_UTIL_PT = ETIQUETA_LARGURA_PT - 2 * ETIQUETA_PADDING_PT - 2 * 2 - 2 * 10;
/** Altura reservada ao bloco do destinatario (rotulo + campos). Era 80; 96 deixa >= 15 pt de folga no pior caso. */
export const ALTURA_BLOCO_DESTINATARIO_PT = 96;
/** Altura reservada as observacoes (3 linhas de 7 pt com entrelinha 1,2). */
export const ALTURA_OBSERVACAO_PT = 26;
/** Altura do rotulo "DESTINATÁRIO:" (7 pt). */
const ALTURA_ROTULO_PT = 7 * ALTURA_LINHA;

/** Espacos repetidos (o cadastro traz "QUADRA22        LOTE  8 E 9") viram um so; pontas aparadas. */
export function normalizarTexto(texto: string | null | undefined): string {
  return String(texto ?? "").replace(/\s+/g, " ").trim();
}

function larguraDoCaractere(c: number, fonte: FonteEtiqueta): number {
  const tabela = fonte === "Helvetica-Bold" ? LARGURAS_HELVETICA_BOLD : LARGURAS_HELVETICA;
  const w = c >= 32 && c <= 255 ? tabela[c - 32] : 0;
  return w > 0 ? w : 600;
}

/** Largura em pt de uma linha. */
export function larguraDoTexto(texto: string, fonte: FonteEtiqueta, tamanhoPt: number): number {
  let soma = 0;
  for (let i = 0; i < texto.length; i++) soma += larguraDoCaractere(texto.charCodeAt(i), fonte);
  return (soma * tamanhoPt) / 1000;
}

/**
 * Quebra por palavra, como o react-pdf; palavra mais larga que a linha e partida por caractere (ele hifeniza,
 * o que NUNCA gera mais linhas do que isto — a conta e a favor da seguranca).
 */
export function quebrarEmLinhas(texto: string, fonte: FonteEtiqueta, tamanhoPt: number, larguraPt: number): string[] {
  const limite = larguraPt * FOLGA_LARGURA;
  const palavras = normalizarTexto(texto).split(" ").filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  const cabe = (t: string) => larguraDoTexto(t, fonte, tamanhoPt) <= limite;

  for (const palavra of palavras) {
    const tentativa = atual ? `${atual} ${palavra}` : palavra;
    if (cabe(tentativa)) {
      atual = tentativa;
      continue;
    }
    if (atual) linhas.push(atual);
    atual = "";
    if (cabe(palavra)) {
      atual = palavra;
      continue;
    }
    let pedaco = "";
    for (const ch of palavra) {
      if (pedaco && !cabe(pedaco + ch)) {
        linhas.push(pedaco);
        pedaco = "";
      }
      pedaco += ch;
    }
    atual = pedaco;
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** Texto cortado para caber em `maxLinhas`, terminado em "…" (corte na ultima palavra inteira que couber). */
export function truncarEmLinhas(texto: string, fonte: FonteEtiqueta, tamanhoPt: number, larguraPt: number, maxLinhas: number): string {
  const linhas = quebrarEmLinhas(texto, fonte, tamanhoPt, larguraPt);
  if (linhas.length <= maxLinhas) return normalizarTexto(texto);
  const mantidas = linhas.slice(0, maxLinhas);
  let ultima = mantidas[maxLinhas - 1];
  const limite = larguraPt * FOLGA_LARGURA;
  while (ultima.length > 1 && larguraDoTexto(`${ultima}…`, fonte, tamanhoPt) > limite) {
    const espaco = ultima.lastIndexOf(" ");
    ultima = espaco > 0 ? ultima.slice(0, espaco) : ultima.slice(0, -1);
  }
  mantidas[maxLinhas - 1] = `${ultima.trimEnd()}…`;
  return mantidas.join(" ");
}

export type CampoAjustavel = {
  id: string;
  texto: string;
  fonte: FonteEtiqueta;
  /** Corpo cheio, o de hoje. */
  tamanhoCheio: number;
  /** `marginTop` do campo no desenho. */
  margemTopo: number;
  /** Menor numero perde linhas primeiro quando nem o minimo cabe. */
  prioridadeDeCorte: number;
};

export type CampoAjustado = {
  id: string;
  texto: string;
  tamanho: number;
  linhas: number;
  truncado: boolean;
};

export type BlocoAjustado = {
  campos: CampoAjustado[];
  /** Altura que o bloco ocupa, com o desenho do react-pdf (linhas x tamanho x ALTURA_LINHA + margens + rotulo). */
  alturaPt: number;
  /** Quantos pt os campos desceram do cheio (0 = nada mudou). */
  reducaoPt: number;
  truncado: boolean;
};

type Opcoes = {
  larguraPt?: number;
  alturaMaxPt: number;
  /** Altura fixa antes dos campos (o rotulo). */
  cabecalhoPt?: number;
  /** Entrelinha, quando o campo declara `lineHeight` proprio. */
  alturaLinha?: number;
  tamanhoMinimoPt?: number;
};

const arredonda = (n: number) => Math.round(n * 100) / 100;

export function ajustarBloco(campos: CampoAjustavel[], opcoes: Opcoes): BlocoAjustado {
  const largura = opcoes.larguraPt ?? LARGURA_UTIL_PT;
  const cabecalho = opcoes.cabecalhoPt ?? 0;
  const linhaFator = opcoes.alturaLinha ?? ALTURA_LINHA;
  const minimo = opcoes.tamanhoMinimoPt ?? TAMANHO_MINIMO_PT;
  const ativos = campos.map((c) => ({ ...c, texto: normalizarTexto(c.texto) })).filter((c) => c.texto !== "");

  const montar = (reducao: number, limiteLinhas: Map<string, number>): BlocoAjustado => {
    let altura = cabecalho;
    let truncado = false;
    const saida: CampoAjustado[] = ativos.map((c) => {
      const tamanho = Math.max(Math.min(minimo, c.tamanhoCheio), arredonda(c.tamanhoCheio - reducao));
      let texto = c.texto;
      let linhas = quebrarEmLinhas(texto, c.fonte, tamanho, largura).length;
      const limite = limiteLinhas.get(c.id);
      let foiTruncado = false;
      if (limite !== undefined && linhas > limite) {
        texto = truncarEmLinhas(texto, c.fonte, tamanho, largura, limite);
        linhas = quebrarEmLinhas(texto, c.fonte, tamanho, largura).length;
        foiTruncado = true;
        truncado = true;
      }
      altura += c.margemTopo + linhas * tamanho * linhaFator;
      return { id: c.id, texto, tamanho, linhas, truncado: foiTruncado };
    });
    return { campos: saida, alturaPt: arredonda(altura), reducaoPt: reducao, truncado };
  };

  // 1) degraus de reducao, todos os campos juntos, ate o minimo.
  const maiorReducao = Math.max(0, ...ativos.map((c) => c.tamanhoCheio - minimo));
  const semLimite = new Map<string, number>();
  for (let r = 0; r <= maiorReducao + 1e-9; r += PASSO_PT) {
    const bloco = montar(arredonda(r), semLimite);
    if (bloco.alturaPt <= opcoes.alturaMaxPt) return bloco;
  }

  // 2) no minimo e ainda nao cabe: tira linhas do campo de menor prioridade, uma a uma.
  const limites = new Map<string, number>();
  let bloco = montar(arredonda(maiorReducao), limites);
  const ordem = [...ativos].sort((a, b) => a.prioridadeDeCorte - b.prioridadeDeCorte);
  while (bloco.alturaPt > opcoes.alturaMaxPt) {
    const alvo = ordem.find((c) => {
      const atual = bloco.campos.find((x) => x.id === c.id);
      return atual !== undefined && atual.linhas > 1;
    });
    if (!alvo) break; // uma linha por campo: nada mais a cortar
    const linhasAgora = bloco.campos.find((x) => x.id === alvo.id)!.linhas;
    limites.set(alvo.id, linhasAgora - 1);
    bloco = montar(arredonda(maiorReducao), limites);
  }
  return bloco;
}

// ── os dois usos da etiqueta de envio ─────────────────────────────────────────

export type DestinatarioParaAjuste = {
  nome: string;
  recebedor: string;
  endereco: string;
  bairro: string;
  /** "Fone: (62) 3100-4253" ou vazio. */
  telefoneLinha: string;
};

/** Nome (12 pt bold), A/C, endereco+complemento, bairro e fone (10 pt), numa altura reservada. */
export function ajustarDestinatario(d: DestinatarioParaAjuste): BlocoAjustado {
  const campos: CampoAjustavel[] = [
    { id: "nome", texto: d.nome, fonte: "Helvetica-Bold", tamanhoCheio: 12, margemTopo: 1.5, prioridadeDeCorte: 4 },
    { id: "recebedor", texto: d.recebedor ? `A/C: ${d.recebedor}` : "", fonte: "Helvetica", tamanhoCheio: 10, margemTopo: 1.2, prioridadeDeCorte: 0 },
    { id: "endereco", texto: d.endereco, fonte: "Helvetica", tamanhoCheio: 10, margemTopo: 1.2, prioridadeDeCorte: 3 },
    { id: "bairro", texto: d.bairro ? `BAIRRO: ${d.bairro}` : "", fonte: "Helvetica", tamanhoCheio: 10, margemTopo: 1.2, prioridadeDeCorte: 1 },
    { id: "telefone", texto: d.telefoneLinha, fonte: "Helvetica", tamanhoCheio: 10, margemTopo: 1.2, prioridadeDeCorte: 2 }
  ];
  return ajustarBloco(campos, { alturaMaxPt: ALTURA_BLOCO_DESTINATARIO_PT, cabecalhoPt: ALTURA_ROTULO_PT });
}

/** Observacao impressa (9 pt bold, entrelinha 1,2), numa altura reservada. */
export function ajustarObservacao(texto: string): BlocoAjustado {
  return ajustarBloco(
    [{ id: "obs", texto, fonte: "Helvetica-Bold", tamanhoCheio: 9, margemTopo: 0, prioridadeDeCorte: 0 }],
    { alturaMaxPt: ALTURA_OBSERVACAO_PT, alturaLinha: 1.2 }
  );
}
