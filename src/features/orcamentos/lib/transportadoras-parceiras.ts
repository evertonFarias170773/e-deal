/**
 * As transportadoras parceiras, e como reconhecê-las a partir de uma cotação.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *   Até aqui `propostas.id_transportadora_cliente` era, na prática, campo de
 *   FOB: medido em 26/08/2026, as 291 propostas CIF de agosto tinham o vínculo
 *   nulo em 100% dos casos — inclusive as marcadas CORREIOS. Em CIF o usuário
 *   escolhe um card de cotação e o sistema gravava só o rótulo em
 *   `frete_escolhido`, nunca QUEM é a transportadora. Sem isso a NF-e não tem de
 *   onde puxar o transportador, e alguém digita à mão na emissão.
 *
 *   Os ids ficam SÓ aqui. Espalhá-los pelo código faria o mesmo estrago que a
 *   regra de peso espalhada em quatro lugares já fez em `lib/peso.ts`.
 *
 * O CRITÉRIO DE IDENTIFICAÇÃO, E POR QUE ELE É CONFIÁVEL
 *   Casa por NOME, sobre `transportadora` + `servico` do card, normalizados
 *   (sem acento, maiúsculas). Os dois campos entram juntos porque cada um é
 *   confiável num momento diferente:
 *
 *     - card recém-cotado ....... `transportadora` é constante FIXA do nosso
 *                                 próprio gerador ("Azul Cargo", "VEPPO",
 *                                 "Transportadora São Miguel", "Motoboy",
 *                                 "Correios SEDEX");
 *     - card relido do banco .... `cotacao_frete` não guarda `transportadora`, e
 *                                 o mapper reconstrói o campo a partir de
 *                                 `servico` — que para São Miguel, Motoboy e
 *                                 VEPPO também é constante nossa.
 *
 *   Três das cinco são 100% determinísticas: SÃO MIGUEL, MOTOBOY e VEPPO têm o
 *   `servico` escrito por nós, literal, em `frete.service.ts`. Correios vem da
 *   API dos Correios, mas o código só ramifica em SEDEX e PAC.
 *
 * A EXCEÇÃO HONESTA: AZUL
 *   O `servico` da Azul é ecoado da API dela (`item.Servico`, default "ECOMM") —
 *   string de terceiro, que não controlamos. Por isso a regra aceita AZUL **ou**
 *   ECOMM. Medido nas 2.851 cotações da base: as 114 linhas da Azul são pegas
 *   pelas duas palavras, e as 8 cotações de integração que a regra NÃO resolve
 *   são todas de não-parceiras (BRASPESS, UNESUL, TROCA, TRANSPORTADORA).
 *
 *   Se um dia a Azul devolver um produto sem nenhuma das duas palavras, o
 *   vínculo fica NULO — nunca errado. Nenhum token de parceira aparece no nome
 *   de outra, então não há risco de trocar uma pela outra: o pior caso é o
 *   comportamento de hoje.
 *
 * O QUE ESTA FUNÇÃO NÃO DECIDE
 *   Modalidade, valor do frete e o rótulo em `frete_escolhido` seguem como
 *   estão. Ela responde uma pergunta só: "este card é de qual parceira?".
 */

/** Cadastros em `clientes` das parceiras. Ponto único — não replicar ids. */
export const TRANSPORTADORAS_PARCEIRAS = {
  /** EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS */
  CORREIOS: 663,
  /** Loja parceira da Azul, cadastrada como SVT PROVEDOR LOGISTICO LTDA */
  AZUL: 808,
  /** B M EXPRESS SERVICOS DE TELE ENTREGA (motoboy) */
  MOTOBOY: 997,
  /** VEPPO CIA LIMITADA */
  VEPPO: 120018,
  /** EXPRESSO SAO MIGUEL S/A */
  SAO_MIGUEL: 120026
} as const;

export type TransportadoraParceira = keyof typeof TRANSPORTADORAS_PARCEIRAS;

/**
 * Cadastros que NÃO devem constar como transportador, e para quem eles apontam.
 *
 * POR QUE EXISTE
 *   O mesmo transportador chegou ao sistema com dois cadastros, e a Expedição
 *   vinculou os despachos ao errado. Os Correios são o caso: 9 despachos foram
 *   para a agência franqueada Beluno (120001, CNPJ 73415572000105), enquanto o
 *   transportador que deve constar na NF-e é a ECT (663, CNPJ 34028316000103).
 *   Decisão do dono em 26/08/2026.
 *
 *   Como a NF-e semeia a transportadora lendo a expedição PRIMEIRO, sem esta
 *   tradução a nota levava o CNPJ da franquia. Foi o que aconteceu no rascunho
 *   NFE-20961-001.
 *
 * POR QUE TRADUZIR EM VEZ DE SÓ DESATIVAR O CADASTRO
 *   Desativar tira o 120001 dos drops daqui para frente, mas não desfaz os 9
 *   vínculos já gravados — e não se mexe em expedição já despachada. Enquanto
 *   esses vínculos existirem, alguém vai faturar um deles. A tradução é o que
 *   protege a nota; a desativação evita vínculos novos. As duas coisas juntas.
 *
 * O MAPA DA ETAPA 1 É A FONTE DA VERDADE. Um cadastro só entra aqui quando o
 * dono decide qual dos dois é o transportador legítimo.
 */
const CADASTROS_CANONIZADOS: Readonly<Record<number, number>> = {
  /** AGENCIA DE CORREIOS FRANQUEADA BELUNO LTDA -> EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS */
  120001: TRANSPORTADORAS_PARCEIRAS.CORREIOS
};

/**
 * O cadastro que deve constar como transportador, dado um id qualquer.
 *
 * Devolve o próprio id quando não há substituição — que é o caso de quase todos.
 * `null` e valores inválidos passam direto como `null`.
 */
export function canonizarTransportadora(id: number | null | undefined): number | null {
  if (id === null || id === undefined || !Number.isFinite(Number(id))) return null;
  const numero = Number(id);
  return CADASTROS_CANONIZADOS[numero] ?? numero;
}

/** Se este id é um cadastro que foi substituído por outro. */
export function ehCadastroSubstituido(id: number | null | undefined): boolean {
  if (id === null || id === undefined) return false;
  return Object.prototype.hasOwnProperty.call(CADASTROS_CANONIZADOS, Number(id));
}

/** Sem acento, maiúsculas, espaços colapsados. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Qual parceira é o card de cotação — ou `null` quando não é nenhuma delas.
 *
 * `null` é resposta legítima e comum: cotação manual, transportadora avulsa
 * (Braspress, Troca), Unesul (descontinuada) e retirada caem todas aqui, e o
 * rótulo continua vivo em `frete_escolhido`, como sempre esteve.
 */
export function resolverTransportadoraParceira(
  frete: { transportadora?: string | null; servico?: string | null } | null | undefined
): number | null {
  if (!frete) return null;

  const texto = `${normalizar(frete.transportadora)} ${normalizar(frete.servico)}`.trim();
  if (!texto) return null;

  // Retirada primeiro: não há transporte, logo não há transportadora. Sai antes
  // de qualquer outra checagem para nenhum rótulo de balcão cair em parceira.
  if (texto.includes("RETIRA") || texto.includes("BALCAO")) return null;

  // SEDEX e PAC com fronteira de palavra: "PAC" solto casaria dentro de outras
  // palavras (PACOTE, EMPACOTADO) e roubaria a cotação para os Correios.
  if (/(^|[^A-Z])(SEDEX|PAC)([^A-Z]|$)/.test(texto)) return TRANSPORTADORAS_PARCEIRAS.CORREIOS;
  if (texto.includes("CORREIOS")) return TRANSPORTADORAS_PARCEIRAS.CORREIOS;

  if (texto.includes("MOTOBOY")) return TRANSPORTADORAS_PARCEIRAS.MOTOBOY;
  if (texto.includes("SAO MIGUEL")) return TRANSPORTADORAS_PARCEIRAS.SAO_MIGUEL;
  if (texto.includes("VEPPO")) return TRANSPORTADORAS_PARCEIRAS.VEPPO;

  // AZUL por último: é a de critério mais frouxo (ver cabeçalho), então só fica
  // com o que nenhuma das determinísticas reivindicou.
  if (texto.includes("AZUL") || texto.includes("ECOMM")) return TRANSPORTADORAS_PARCEIRAS.AZUL;

  return null;
}
