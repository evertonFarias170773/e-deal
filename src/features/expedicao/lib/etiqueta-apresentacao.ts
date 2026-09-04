import type { EtiquetaViewModel } from "../services/etiqueta-viewmodel.service";

/**
 * REGRAS DE APRESENTACAO DA ETIQUETA 10x15 — fonte unica do PDF e da previa
 * (04/09/2026).
 *
 * Viviam dentro de `pdf/EtiquetaPdfDocument.tsx`. Sairam de la quando o modal
 * Despachar ganhou uma PREVIA da etiqueta em HTML: ela precisa cortar a
 * observacao, separar cidade de UF, montar a linha do telefone e escolher o
 * que imprimir sem transportadora EXATAMENTE como o papel faz — e o componente
 * do PDF importa `@react-pdf/renderer`, que nao pode ir para o bundle do
 * browser. Este modulo e puro: sem React, sem react-pdf, sem Supabase.
 *
 * O que fica em cada lado e so o DESENHO (View/Text de um lado, div/span do
 * outro). Toda decisao sobre CONTEUDO passa por aqui.
 */

/** Conteudo do QR "SITE:" — o mesmo no PDF e na previa. */
export const SITE_QR_ETIQUETA = "https://www.ingressoideal.com.br";

/** 100 x 150 mm em pontos (1 mm = 2.83465 pt) — o papel e a previa usam os mesmos numeros. */
export const ETIQUETA_LARGURA_PT = 283.46;
export const ETIQUETA_ALTURA_PT = 425.2;
/** Margem de impressao da pagina, nos quatro lados. */
export const ETIQUETA_PADDING_PT = 8;

/**
 * Cidade e UF separadas a partir de `cidadeUf`.
 *
 * O view model entrega "Rio Grande - RS" (ou o `cidade_uf` cru do cadastro, no
 * fallback). O layout imprime "CIDADE / UF" em corpo grande, então a divisão
 * acontece aqui — na APRESENTAÇÃO — em vez de abrir dois campos novos no view
 * model, que a Declaração de Conteúdo também consome.
 *
 * Sem separador reconhecível, tudo vira cidade e a UF sai vazia: melhor a linha
 * inteira legível do que um pedaço arbitrário promovido a estado.
 */
export function separarCidadeUf(cidadeUf: string): { cidade: string; uf: string } {
  const texto = String(cidadeUf ?? "").trim();
  if (!texto) return { cidade: "", uf: "" };

  const m = texto.match(/^(.*?)\s*[-/·]\s*([A-Za-z]{2})$/) ?? texto.match(/^(.*?)\s+([A-Za-z]{2})$/);
  if (m) return { cidade: m[1].trim(), uf: m[2].toUpperCase() };
  return { cidade: texto, uf: "" };
}

/**
 * Observação cortada para caber nas linhas que o layout reserva.
 *
 * `maxLines` do react-pdf não existe nesta versão dos tipos, então o limite é
 * imposto aqui, em caracteres: com 8,5pt bold e ~245pt de largura útil cabem
 * ~52 caracteres por linha, e 105 é o teto de DUAS linhas.
 *
 * Caiu de 140 (três linhas) para 105 em 02/09/2026, junto do reaperto do
 * layout: o bloco do destinatário podia crescer mais do que a conta previa e a
 * etiqueta quebrava para uma segunda página. Duas linhas de observação deixam
 * folga para um endereço de duas linhas com A/C.
 *
 * POR QUE CORTAR, E NÃO DEIXAR FLUIR
 *   A moldura tem altura FIXA. Uma observação longa empurraria REMETENTE, QR,
 *   data e volume para fora do papel — e esses são os campos que fazem o volume
 *   chegar. Perder o fim de um recado é ruim; perder o remetente é pior.
 *
 * O corte cai no último espaço antes do limite, para não partir palavra ao
 * meio, e marca o que ficou de fora com reticências.
 */
export const LIMITE_OBSERVACAO = 105;

export function cortarObservacao(texto: string): string {
  const limpo = texto.trim();
  if (limpo.length <= LIMITE_OBSERVACAO) return limpo;
  const corte = limpo.slice(0, LIMITE_OBSERVACAO);
  const ultimoEspaco = corte.lastIndexOf(" ");
  return `${(ultimoEspaco > LIMITE_OBSERVACAO * 0.6 ? corte.slice(0, ultimoEspaco) : corte).trimEnd()}…`;
}

/** As linhas derivadas que PDF e previa imprimem identicas. */
export type ApresentacaoEtiqueta = {
  /** "Novo Hamburgo / RS" — ou "—" quando nao ha cidade. */
  cidadeUfLinha: string;
  /** Transportadora em caixa alta, "A DEFINIR" quando vazia. */
  transportadoraExibida: string;
  /** "Fone: (51) 99110-7694" — vazia quando nao ha telefone, e ai a linha nao sai. */
  telefoneLinha: string;
  /** Observacao cortada e em caixa alta — vazia quando nao ha, e ai o bloco nao sai. */
  observacaoImpressa: string;
  /** Numero da NF ao lado do PEDIDO — "—" sem nota, como o CEP e a cidade fazem. */
  nfExibida: string;
  /** CEP ou "—". */
  cepExibido: string;
};

export function apresentacaoEtiqueta(vm: EtiquetaViewModel): ApresentacaoEtiqueta {
  const { cidade, uf } = separarCidadeUf(vm.destinatario.cidadeUf);
  const cidadeUfLinha = [cidade, uf].filter(Boolean).join(" / ");
  return {
    cidadeUfLinha: cidadeUfLinha || "—",
    transportadoraExibida: (vm.transportadora || "A DEFINIR").toUpperCase(),
    telefoneLinha: vm.destinatario.telefone ? `Fone: ${vm.destinatario.telefone}` : "",
    observacaoImpressa: vm.obsEtiqueta ? cortarObservacao(vm.obsEtiqueta).toUpperCase() : "",
    nfExibida: String(vm.nfNumero ?? "").trim() || "—",
    cepExibido: vm.destinatario.cep || "—"
  };
}
