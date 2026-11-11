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
  /**
   * EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS — Superintendência Estadual RS
   * (CNPJ 34028316002661, com inscrição estadual). É o cadastro que o orçamento
   * passa a gravar em `propostas.id_transportadora_cliente` desde 08/10/2026,
   * por decisão do dono. O cadastro antigo (663, a matriz em Brasília, sem
   * inscrição estadual) continua reconhecido como Correios — ver `IDS_CORREIOS`.
   */
  CORREIOS: 39975,
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
 * TODOS os cadastros que SÃO os Correios, e a resposta única para
 * "este cadastro é dos Correios?".
 *
 * POR QUE DOIS IDS (08/10/2026)
 *   O orçamento passou a gravar o 39975, mas 63 propostas e 26 expedições já
 *   gravadas apontam para o 663, e elas não são alteradas. Enquanto houver
 *   pedido com o id antigo, os dois precisam ser lidos como Correios — senão o
 *   envio viraria "transportadora" e a prepostagem sumiria do painel.
 *
 *   `TRANSPORTADORAS_PARCEIRAS.CORREIOS` responde "qual id gravar"; esta lista
 *   responde "qual id reconhecer". Os números ficam SÓ aqui.
 */
export const IDS_CORREIOS: readonly number[] = [TRANSPORTADORAS_PARCEIRAS.CORREIOS, 663];

/** Nome dos Correios na tela. A fantasia do cadastro não serve: ver `nomeTransportadoraCadastro`. */
export const NOME_EXIBIDO_CORREIOS = "Correios";

/** O cadastro vinculado é dos Correios? Vale para o id novo e para o antigo. */
export function ehCadastroCorreios(id: number | null | undefined): boolean {
  if (id === null || id === undefined || !Number.isFinite(Number(id))) return false;
  return IDS_CORREIOS.includes(Number(id));
}

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
  120001: TRANSPORTADORAS_PARCEIRAS.CORREIOS,
  /**
   * CORREIOS SEDE (matriz em Brasília, sem inscrição estadual) -> Superintendência
   * RS. Decisão do financeiro em 09/11/2026: na nota, a transportadora dos
   * Correios é SEMPRE o 39975. O 663 segue reconhecido como Correios
   * (`IDS_CORREIOS`) pela Expedição e pela prepostagem; só não vai mais para a nota.
   */
  663: TRANSPORTADORAS_PARCEIRAS.CORREIOS
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
 * A transportadora de um card relido: `cotacao_frete` guarda só o serviço.
 *
 * Os cards padrão que a proposta sem cotação mostra (orcamentos.service) são
 * "Correios SEDEX" com serviço "Entrega Expressa" e "Correios PAC" com
 * "Entrega Econômica". Só o serviço ia para o banco, e o card relido perdia os
 * Correios: virava "frete manual" e o Salvar seguinte gravava "Entrega
 * Expressa" em `frete_escolhido` (25052, 11/11/2026).
 */
export function transportadoraDoServicoGravado(servico: string | null | undefined): string {
  if (servico === "SEDEX") return "Correios SEDEX";
  if (servico === "PAC") return "Correios PAC";
  const servicoNormalizado = normalizar(servico);
  if (servicoNormalizado === "ENTREGA EXPRESSA") return "Correios SEDEX";
  if (servicoNormalizado === "ENTREGA ECONOMICA") return "Correios PAC";
  return servico || "Transportadora";
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

/**
 * O vínculo que o SALVAR grava, dado o card de frete escolhido (09/11/2026).
 *
 * Até aqui só o CLIQUE no card gravava o vínculo. O card que ficava escolhido
 * sozinho — cotação automática, "Atualizar fretes", proposta do Maestro — ia
 * para o banco sem transportadora, e a NF-e nascia sem transportador: em
 * novembro, 3 de cada 4 pedidos de Correios.
 *
 * A regra é a do clique, com uma diferença: card que não é de parceira NÃO
 * apaga o vínculo da tela (aqui não houve escolha nova para justificar apagar).
 *   FOB ............ o da tela: vem do drop, escolha explícita do vendedor.
 *   RETIRA ......... o da tela (a tela já zera ao virar retirada).
 *   CIF / sem modalidade, card de parceira ... a parceira do card.
 *   CIF / sem modalidade, outro card ......... o da tela, MENOS os Correios.
 *
 * CORREIOS SÓ COM FRETE DOS CORREIOS (11/11/2026). Card escolhido que não é dos
 * Correios (frete manual, transportadora avulsa) com os Correios na tela é
 * vínculo que sobrou de um SEDEX escolhido antes: grava nulo. Era o que a tela
 * mostrava como "SUPERINTENDENCIA ESTADUAL RS" num frete manual. O clique no
 * card já zerava; aqui o Salvar segue a mesma regra.
 */
export function vinculoPeloCardEscolhido(args: {
  modalidade: string | null | undefined;
  card: { transportadora?: string | null; servico?: string | null } | null | undefined;
  idDaTela: number | null | undefined;
}): number | null {
  const idDaTela = args.idDaTela === undefined || args.idDaTela === null ? null : Number(args.idDaTela);
  const modalidade = normalizar(args.modalidade);
  if (modalidade === "FOB" || modalidade === "RETIRA") return idDaTela;
  const doCard = resolverTransportadoraParceira(args.card);
  if (doCard !== null) return doCard;
  if (cardTemServico(args.card) && ehCadastroCorreios(idDaTela)) return null;
  return idDaTela;
}

/** O card escolhido diz alguma coisa? Card sem texto não decide nada. */
function cardTemServico(card: { transportadora?: string | null; servico?: string | null } | null | undefined): boolean {
  return Boolean(card && (normalizar(card.servico) || normalizar(card.transportadora)));
}

/**
 * O vínculo gravado precisa de correção do admin? (11/11/2026)
 *
 * O quadro "Corrigir a transportadora (admin)" só aparece quando sim. É a
 * mesma pergunta do Salvar, ao contrário: a transportadora gravada é a do
 * frete escolhido?
 *   RETIRA ..... com vínculo: sim (balcão não tem transportadora).
 *   FOB ........ sem vínculo e sem motoboy: sim.
 *   CIF ........ card de parceira: o vínculo tem de ser ela (Correios aceita 663).
 *                outro card: sem vínculo, ou com os Correios, sim.
 *                sem card: não há com o que comparar.
 */
export function transportadoraPrecisaCorrecao(args: {
  modalidade: string | null | undefined;
  card: { transportadora?: string | null; servico?: string | null } | null | undefined;
  idVinculo: number | null | undefined;
  motoboyFob?: boolean;
}): boolean {
  const id = args.idVinculo === undefined || args.idVinculo === null ? null : Number(args.idVinculo);
  const modalidade = normalizar(args.modalidade);
  if (modalidade === "RETIRA") return id !== null;
  if (modalidade === "FOB") return id === null && !args.motoboyFob;
  if (!cardTemServico(args.card)) return false;
  const doCard = resolverTransportadoraParceira(args.card);
  if (doCard === TRANSPORTADORAS_PARCEIRAS.CORREIOS) return !ehCadastroCorreios(id);
  if (doCard !== null) return canonizarTransportadora(id) !== doCard;
  return id === null || ehCadastroCorreios(id);
}

/**
 * O pedido é dos Correios? Para a NF-e de pedido sem vínculo (09/11/2026).
 *
 * Qualquer um dos sinais basta: o card escolhido (SEDEX, PAC, Correios), a
 * categoria do transporte ou a coluna do painel da Expedição. Retirada nunca é.
 * Em FOB o card não conta: o SEDEX que sobra ali é resíduo de cotação que
 * ninguém contratou (o mesmo de `correiosResiduoDeCotacaoFob`).
 *
 * Fora de FOB, CARD ESCOLHIDO DECIDE (11/11/2026): com card, só é Correios se o
 * card for dos Correios. A categoria gravada pode ter sobrado de um SEDEX
 * trocado por frete manual (25052), e não pode pôr os Correios na nota de um
 * frete que eles não levam. As categorias valem só sem card.
 */
export function pedidoEhDosCorreios(args: {
  modalidade?: string | null;
  card?: { transportadora?: string | null; servico?: string | null } | null;
  transporteCategoria?: string | null;
  categoriaFrete?: string | null;
  categoriaFreteExpedicao?: string | null;
}): boolean {
  const modalidade = normalizar(args.modalidade);
  if (modalidade === "RETIRA") return false;
  if (modalidade !== "FOB" && cardTemServico(args.card)) {
    return resolverTransportadoraParceira(args.card) === TRANSPORTADORAS_PARCEIRAS.CORREIOS;
  }
  return [args.transporteCategoria, args.categoriaFrete, args.categoriaFreteExpedicao].some(
    (valor) => normalizar(valor) === "CORREIOS"
  );
}
