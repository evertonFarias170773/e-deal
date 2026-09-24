"use client";

/**
 * Lista rápida dos lotes de um item: colar a lista do cliente, digitar, e o
 * banco acompanha.
 *
 * POR QUE ELA EXISTE
 *   Montar um pedido de 20 lotes pela pilha de cards custa 4 idas ao servidor
 *   e a reabertura do formulário por lote — medido em produção: 3min42s para
 *   13 lotes, 18,5 s cada. E como cada lote é validado contra a quantidade do
 *   item já gravada, distribuir uma lista nova obrigava a ir antes à aba
 *   Orçamento aumentar a quantidade, voltar, e repetir a cada ajuste.
 *
 * A REGRA QUE ELA INVERTE
 *   Aqui a lista manda: a quantidade do item passa a ser a soma dos lotes,
 *   gravada junto, numa chamada só (POST /api/pedidos/lotes-em-massa). Por
 *   isso a grade não tem trava de saldo nem corta número digitado — não existe
 *   saldo a estourar quando o item acompanha a soma.
 *
 * OS CAMPOS SÃO OS DO CARD (23/09/2026), NUMA LINHA POR LOTE (24/09/2026)
 *   Cada lote é editado com `ModeloCampos` — o mesmo bloco de campos, ordem e
 *   regras de exibição do modo cards. Na grade os campos não têm rótulo: há
 *   UM cabeçalho por produto (`CabecalhoDaLista`), e cada lote é uma linha
 *   só — células no grid de `colunasDaLista`, o status da arte e os botões
 *   de duplicar e excluir. O número do modelo vai dentro do campo Modelo. A
 *   janela de amostra (`AmostraDoModelo`, frente e verso lado a lado) só
 *   aparece com o botão "Amostras" do produto ligado (`amostrasVisiveis`).
 *   O que continua sendo só da grade: colar a lista, Enter criar a próxima
 *   linha, "+ N linhas", os modos de numeração e a soma que manda na
 *   quantidade do item. Gravar não fecha a grade: sair dela é "Ver como
 *   cards", e ela já abre aberta ao entrar na aba.
 *   Item de prateleira (24/09/2026): só Qtd e Cor papel, sem janela de
 *   amostra — a regra vive em `ModeloCampos` (`modo="lista"`). O nome do
 *   lote, que não tem campo ali, é o do produto (`nomeDoLote`).
 *
 * GRAVA SOZINHA, PELA ROTA DA PRÓPRIA GRADE (23/09/2026)
 *   A cada campo ou dropdown alterado a lista inteira vai para a rota em
 *   massa, com debounce nos campos digitados e na hora nos selects — o mesmo
 *   ritmo do card. Não é o caminho do card (`criarModelo` /
 *   `atualizarModeloParcial`) de propósito: aquele valida cada lote contra o
 *   saldo do item, que é justamente a regra que a lista inverte. Decisão do
 *   dono, depois de mapeadas as duas opções.
 *
 *   O que segura a gravação:
 *     - linha NOVA sem os obrigatórios (nome, Qtd, cor quando o produto a
 *       imprime) fica de fora do envio, e não conta na soma;
 *     - linha que JÁ EXISTE no banco e ficou incompleta segura o envio inteiro:
 *       mandar sem ela faria a rota calcular a quantidade do item sem um lote
 *       que continua lá; mandar com ela seria recusado;
 *     - a Qtd digitada só grava ao sair do campo (blur ou Enter), nunca no
 *       meio da digitação: "3" a caminho de "30" reduziria a soma e abriria a
 *       confirmação de redução antes de o número existir.
 *   A quantidade do item só é regravada quando a soma mudou de fato — a rota
 *   compara antes de escrever; cor, bloco e numerador não mexem nela.
 *
 * O CHECKLIST DO BOLETIM (Etapa 6b)
 *   Coluna de campo que o produto não tem marcado em `produto_boletim_campos`
 *   não aparece, e lote NOVO não recebe valor nela — nem a cor do produto, nem
 *   o "Sequencial" que o numerador do cadastro sugeriria, nem a faixa. Lote que
 *   já existe segue com o que tem: a grade devolve o valor intacto e a rota
 *   tira a coluna do UPDATE. A mesma regra do formulário do PCP, em
 *   lib/checklist-lote; produto sem checklist fica como sempre foi.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { StatusBadge } from "@/components/common/StatusBadge";
import { fetchComSessao, SessaoExpiradaError } from "@/lib/supabase/sessao";
import { interpretarColagem, somaQuantidades, type CorOpcao } from "@/features/orcamentos/services/lotes-colagem";
import {
  calcularNumeracaoFim,
  derivarCamposNumeracao,
  findNumeracaoByName,
  resolverMultiplicadorNumeracao,
  type ModeloNumeracaoCampos,
  type NumeracaoOpcao
} from "@/features/orcamentos/numeracao-modelo-utils";
import { aplicarNumeracao, type ModoNumeracao } from "@/features/orcamentos/services/lotes-numeracao";
import { anularColunasEscondidas, checklistVisivel, mostraCampo } from "@/features/orcamentos/lib/checklist-lote";
import { listChecklistDeProdutos } from "@/features/produtos/services/produto-boletim-campos.service";
import {
  AmostraDoModelo,
  CabecalhoDaLista,
  colunasDaLista,
  getArteStatusTone,
  gridDaLista,
  ModeloCampos,
  modeloCompleto,
  type CorDoPapelOpcao
} from "@/features/orcamentos/components/ModeloCampos";
import type { PedidoModeloState } from "@/features/orcamentos/types";

/** Teto para a criação em lote: acima disso é engano de digitação, não pedido. */
const MAX_LINHAS_DE_UMA_VEZ = 200;

/** Espera antes de gravar campos digitados — o mesmo valor do card. */
const DEBOUNCE_MS = 600;

export type LinhaLote = {
  /** `pedidos_modelos.id` quando a linha já existe no banco. */
  id?: number | null;
  nome_modelo: string;
  quantidade: number | "";
  padrao: string | null;
  /** Campos herdados que a grade devolve intactos quando o campo está escondido. */
  tipo_numeracao?: string | null;
  numeracao_inicio?: number | null;
  numeracao_fim?: number | null;
  verso_tipo?: string | null;
  bloco?: string | null;
  gabarito_operacional?: string | null;
  variacoes_texto?: string | null;
  /** Camarote (numerador tipo CAMAROTE): os mesmos três campos do card. */
  Q_CAM?: number | null;
  L_CAM?: number | null;
  C_INI?: number | null;
  /** Somente leitura na grade: alimentam a janela de amostra. */
  status_arte?: string;
  amostra_arte_base64?: string | null;
  verso_amostra_arte_base64?: string | null;
  /** Só na tela: cor colada que não casou com o cadastro. */
  corNaoReconhecida?: string | null;
};

/**
 * A linha como a grade a guarda: `chave` é a identidade na tela, estável da
 * criação ao id do banco — é a key do React e o que casa a resposta da rota
 * com a linha nova. Índice como key faria o campo Bloco de uma linha herdar o
 * estado "Outro" da vizinha removida.
 */
type LinhaDaGrade = LinhaLote & { chave: string };

let contadorDeChaves = 0;
function novaChave(): string {
  contadorDeChaves += 1;
  return `lote_${Date.now()}_${contadorDeChaves}`;
}

/**
 * Como nasce um lote novo deste item: cor do papel e numerador vindos do
 * cadastro do produto, mais os defaults de verso e bloco.
 *
 * Quem monta isso é o PedidoModelosTab, num lugar só, e o mesmo objeto
 * alimenta o card "Adicionar modelo" e esta grade. Antes a grade criava linha
 * sem numerador, e o vendedor tinha que abrir lote por lote depois só para
 * escolher o que o cadastro já sabia.
 */
export type PadroesDeLote = {
  padrao: string | null;
  gabarito_operacional: string | null;
  tipo_numeracao: string;
  numeracao_inicio: number | null;
  verso_tipo: string;
  bloco: string;
};

type Lote = LinhaDaGrade;

/** O que a linha entrega ao `ModeloCampos`: os mesmos valores do card. */
function valoresDoCard(l: Lote) {
  return {
    nome_modelo: l.nome_modelo,
    quantidade: Number(l.quantidade) || 0,
    padrao: l.padrao ?? null,
    tipo_numeracao: l.tipo_numeracao ?? null,
    numeracao_inicio: l.numeracao_inicio ?? null,
    numeracao_fim: l.numeracao_fim ?? null,
    verso_tipo: l.verso_tipo ?? null,
    bloco: l.bloco ?? null,
    gabarito_operacional: l.gabarito_operacional ?? null,
    Q_CAM: l.Q_CAM ?? null,
    L_CAM: l.L_CAM ?? null,
    C_INI: l.C_INI ?? null
  };
}

export function LotesGrid({
  idInt,
  idProduto,
  item,
  itemPrateleira,
  linhasIniciais,
  cores,
  numeracoes,
  padroes,
  coresOpcoes,
  itemIdFormato,
  simplificado,
  autoSaveHabilitado,
  amostrasVisiveis,
  onGravado,
  onSair,
  onAmpliarArte
}: {
  idInt: number;
  /**
   * `produtos_proposta.id_produto` do item: é por ele que a grade lê o checklist
   * do boletim do produto. Nulo ou zero = sem produto de catálogo, sem regra.
   */
  idProduto: number | null;
  item: { id_produto_proposta_origem: number; nome: string; quantidade: number };
  /**
   * Produto de prateleira (`produtos_proposta.is_estoque`): vendido pronto, sem
   * arte e sem lote desenhado. O lote não tem nome próprio a inventar — o que
   * identifica a peça é o próprio produto, e é ele que a grade usa.
   */
  itemPrateleira: boolean;
  linhasIniciais: LinhaLote[];
  /** Cores do formato do item: a colagem casa a lista do cliente com elas. */
  cores: CorOpcao[];
  /** Cadastro de numerações: só para saber quantos números cada unidade consome (TICKET). */
  numeracoes: NumeracaoOpcao[];
  /** Com o que um lote novo deste item já nasce preenchido. */
  padroes: PadroesDeLote;
  /** Cadastro completo de cores, para os dropdowns do card (`ModeloCampos` filtra pelo formato). */
  coresOpcoes: CorDoPapelOpcao[];
  /** UUID do formato do item — o que o card usa para filtrar cor e numerador. */
  itemIdFormato: string | null;
  /** Proposta 100% de prateleira: só Cor papel, Qtd, Verso e Numerador, como no card. */
  simplificado: boolean;
  /**
   * Proposta com cobrança: sem auto-save. O botão "Fechar lote" continua sendo
   * o caminho de gravação de hoje — e a rota recusa a proposta cobrada, como
   * sempre recusou.
   */
  autoSaveHabilitado: boolean;
  /** Botão "Amostras" do produto: mostra a amostra da arte abaixo de cada lote. */
  amostrasVisiveis: boolean;
  /** Chamado depois de cada gravação: o pai espelha os lotes com os ids e, se a quantidade mudou, o item. */
  onGravado: (resultado: {
    qtdItem: number;
    qtdAnterior: number;
    freteMensagem: string | null;
    /** Lotes como ficaram no banco, com os ids — o pai precisa deles para nao duplicar no proximo salvamento. */
    lotes: Record<string, unknown>[];
  }) => void;
  onSair: () => void;
  /** A arte ampliada abre no mesmo modal do modo cards. */
  onAmpliarArte: (arte: { frente: string; verso: string | null; nome: string }) => void;
}) {
  const { showToast } = useAppToast();

  /**
   * Checklist do boletim do produto. `null` enquanto não carregou E para
   * produto sem registro — nos dois casos a grade fica como sempre foi. Quem
   * garante a regra no banco é a rota; aqui é para a tela não oferecer nem
   * pré-preencher o que o produto não imprime.
   *
   * Declarado ANTES de `linhas`: o estado inicial das linhas chama
   * `novaLinha()`, que lê `visivel`.
   */
  const [camposDoProduto, setCamposDoProduto] = useState<string[] | null>(null);
  const visivel = useMemo(() => checklistVisivel(camposDoProduto), [camposDoProduto]);
  const mostraCor = mostraCampo(visivel, "cor");
  const mostraFaixa = mostraCampo(visivel, "numeracao_faixa");

  /**
   * AS LINHAS VIVEM NA REF, E O ESTADO ESPELHA A REF.
   *
   * A gravação roda em respostas assíncronas e em timers, que leem a versão
   * mais nova das linhas — não a que o render capturou. Todo mutador passa por
   * `mutar`, que escreve na ref e no estado na mesma chamada, então a fila de
   * gravação nunca manda uma lista velha. É o mesmo desenho do `latestModelo`
   * do card.
   */
  const [linhas, setLinhas] = useState<Lote[]>(() =>
    (linhasIniciais.length > 0 ? linhasIniciais : [novaLinha()]).map((l) => ({ ...l, chave: novaChave() }))
  );
  const linhasRef = useRef<Lote[]>(linhas);
  const removidosRef = useRef<number[]>([]);
  const [modoNumeracao, setModoNumeracao] = useState<ModoNumeracao | null>(null);
  const modoRef = useRef<ModoNumeracao | null>(null);
  const [gravando, setGravando] = useState(false);
  const [quantasLinhas, setQuantasLinhas] = useState<number | "">(1);

  // Estado do auto-save, igual ao do card: fila serial, um pedido em voo por
  // vez, o seguinte espera e dispara ao terminar.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const salvandoRef = useRef(false);
  const pendenteRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const okTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const montadoRef = useRef(true);
  /** O que já está no banco. Igual ao que seria enviado = nada a gravar. */
  const ultimaAssinaturaRef = useRef<string | null>(null);

  function mutar(fn: (atual: Lote[]) => Lote[]) {
    const proximo = fn(linhasRef.current);
    linhasRef.current = proximo;
    setLinhas(proximo);
  }

  // ─── A grade segue o pai quando os lotes mudam por fora dela ───────────────
  // As linhas são semeadas uma vez, no mount. Desde que a grade abre sozinha ao
  // entrar na aba (24/09/2026) ela monta ANTES de `pedidos_modelos` chegar — e
  // ficava com uma linha vazia enquanto os cards mostravam tudo (o Salvar
  // recarrega a página em ?tab=pedido). Quando o CONJUNTO DE IDS que o pai
  // manda muda e a grade não tem nada seu por gravar, ressemeia: o que veio do
  // banco entra, e linha nova com algo digitado é preservada no fim. Ids iguais
  // = o que mudou já é o espelho do onGravado, ou edição em curso: não mexe,
  // para não tirar o foco de quem está digitando.
  const chaveIniciais = JSON.stringify(
    linhasIniciais.map((l) => [
      l.id, l.nome_modelo, l.quantidade, l.padrao, l.tipo_numeracao, l.numeracao_inicio, l.numeracao_fim,
      l.verso_tipo, l.bloco, l.gabarito_operacional, l.Q_CAM, l.L_CAM, l.C_INI
    ])
  );
  const chaveSemeadaRef = useRef(chaveIniciais);
  useEffect(() => {
    if (chaveSemeadaRef.current === chaveIniciais) return;
    chaveSemeadaRef.current = chaveIniciais;
    if (salvandoRef.current || pendenteRef.current || timerRef.current) return;
    const idsDaGrade = new Set(linhasRef.current.map((l) => l.id).filter((id): id is number => id != null));
    const idsDoPai = new Set(linhasIniciais.map((l) => l.id).filter((id): id is number => id != null));
    const mesmosIds = idsDaGrade.size === idsDoPai.size && [...idsDoPai].every((id) => idsDaGrade.has(id));
    if (mesmosIds) return;
    const novasComAlgo = linhasRef.current.filter(
      (l) => !l.id && (l.nome_modelo.trim() || l.quantidade !== "" || l.padrao)
    );
    const proximo: Lote[] = [...linhasIniciais.map((l) => ({ ...l, chave: novaChave() })), ...novasComAlgo];
    linhasRef.current = proximo;
    setLinhas(proximo);
    // A base do "nada a gravar" é recalculada no efeito abaixo, já com as linhas novas.
    ultimaAssinaturaRef.current = null;
  }, [chaveIniciais, linhasIniciais]);

  useEffect(() => {
    const id = Number(idProduto);
    if (!Number.isInteger(id) || id <= 0) return;

    let ativo = true;
    void (async () => {
      const mapa = await listChecklistDeProdutos([id]);
      if (!ativo) return;
      const campos = mapa.get(id) ?? [];
      setCamposDoProduto(campos);
      // Linhas NOVAS criadas antes de o checklist chegar nasceram com os
      // defaults do cadastro: limpa nelas o que o produto não imprime. Linha
      // que já existe no banco não é tocada.
      const regra = checklistVisivel(campos);
      mutar((atual) => atual.map((l) => (l.id ? l : anularColunasEscondidas(l, regra))));
    })();

    return () => {
      ativo = false;
    };
  }, [idProduto]);

  const soma = useMemo(() => somaQuantidades(linhas), [linhas]);
  const naoReconhecidas = linhas.filter((l) => l.corNaoReconhecida).length;

  // A numeração é DERIVADA, nunca guardada em estado: assim ela nunca fica
  // velha depois de mudar uma quantidade, remover ou reordenar um lote.
  // Faixa escondida: nenhum modo de numeração se aplica, e a linha fica como
  // está (lote novo sem Nº inicial não ganha faixa).
  const modoEfetivo = mostraFaixa ? modoNumeracao : null;

  const numerar = useCallback(
    (lista: Lote[], modo: ModoNumeracao | null): Lote[] =>
      aplicarNumeracao(lista, mostraFaixa ? modo : null, (inicio, qtd, linha) => {
        const { multiplicador } = resolverMultiplicadorNumeracao(
          findNumeracaoByName(numeracoes, linha.gabarito_operacional)
        );
        return calcularNumeracaoFim(inicio, qtd, multiplicador);
      }),
    [numeracoes, mostraFaixa]
  );

  const linhasNumeradas = useMemo(() => numerar(linhas, modoEfetivo), [linhas, modoEfetivo, numerar]);

  const quantasCriar = Math.min(MAX_LINHAS_DE_UMA_VEZ, Math.max(1, Number(quantasLinhas) || 1));

  /**
   * Nome do lote como vai para o banco. Prateleira não tem campo Modelo na
   * lista: sem nome, vai o do produto — a mesma regra de `novaLinha` e da
   * colagem, e sem ela a linha nunca ficaria "completa". Produto normal e
   * lote já batizado seguem com o que têm, sem mexer.
   */
  const nomeDoLote = (l: Lote) => (itemPrateleira && !l.nome_modelo?.trim() ? item.nome : l.nome_modelo);

  const completa = (l: Lote) =>
    modeloCompleto({ ...l, nome_modelo: nomeDoLote(l), quantidade: Number(l.quantidade) || 0 }, visivel);

  function novaLinha(base?: LinhaLote): Lote {
    // Herda da linha anterior o que não costuma variar entre lotes do mesmo
    // produto e, quando não há de quem herdar, cai no cadastro do produto — é
    // o que evita lote nascendo sem numerador. A quantidade nasce em branco de
    // propósito, para ninguém gravar por engano o número da linha anterior.
    return anularColunasEscondidas({
      chave: novaChave(),
      // Prateleira nasce com o nome do produto: não há arte nem lote desenhado a
      // batizar, e exigir digitação era barrar o fechamento por um vazio que a
      // própria grade tinha acabado de criar. O caminho de COLAR já fazia isto
      // (`nomePadrao`, abaixo) — o "+" ficava de fora, na mesma tela.
      // Produto normal segue nascendo vazio: ali o nome do lote é informação de
      // verdade, e a validação continua inteira.
      nome_modelo: base?.nome_modelo ?? (itemPrateleira ? item.nome : ""),
      quantidade: "" as const,
      padrao: base?.padrao ?? padroes.padrao,
      tipo_numeracao: base?.tipo_numeracao ?? padroes.tipo_numeracao,
      numeracao_inicio: base?.numeracao_inicio ?? padroes.numeracao_inicio,
      verso_tipo: base?.verso_tipo ?? padroes.verso_tipo,
      bloco: base?.bloco ?? padroes.bloco,
      gabarito_operacional: base?.gabarito_operacional ?? padroes.gabarito_operacional,
      variacoes_texto: base?.variacoes_texto ?? null
    } as Lote, visivel);
  }

  // ─── Auto-save ─────────────────────────────────────────────────────────────

  const setStatusSeMontado = (s: typeof saveStatus, erro: string | null = null) => {
    if (!montadoRef.current) return;
    setSaveStatus(s);
    setErroSalvar(erro);
    if (s === "saved") {
      if (okTimerRef.current) clearTimeout(okTimerRef.current);
      okTimerRef.current = setTimeout(() => { if (montadoRef.current) setSaveStatus("idle"); }, 2000);
    }
  };

  /** O lote como a rota o recebe. */
  function montarLote(l: Lote) {
    const lote = {
      id: l.id ?? null,
      nome_modelo: nomeDoLote(l),
      quantidade: Number(l.quantidade),
      padrao: l.padrao,
      tipo_numeracao: l.tipo_numeracao,
      numeracao_inicio: l.numeracao_inicio,
      numeracao_fim: l.numeracao_fim,
      verso_tipo: l.verso_tipo,
      bloco: l.bloco,
      gabarito_operacional: l.gabarito_operacional,
      variacoes_texto: l.variacoes_texto,
      Q_CAM: l.Q_CAM ?? null,
      L_CAM: l.L_CAM ?? null,
      C_INI: l.C_INI ?? null
    };
    // Novo: coluna escondida vai null. Existente: vai como veio do banco,
    // e a rota a tira do UPDATE.
    return l.id ? lote : anularColunasEscondidas(lote, visivel);
  }

  /** O que seria enviado agora, ou o motivo de não enviar. */
  function prepararEnvio(): { lotes: ReturnType<typeof montarLote>[]; removerIds: number[] } | { segurar: string } {
    const numeradas = numerar(linhasRef.current, modoRef.current);
    const existenteIncompleta = numeradas.find((l) => l.id && !completa(l));
    if (existenteIncompleta) {
      return { segurar: `Complete os campos obrigatórios do modelo #${existenteIncompleta.id} para voltar a gravar.` };
    }
    const enviaveis = numeradas.filter((l) => l.id || completa(l));
    const removerIds = removidosRef.current;
    if (enviaveis.length === 0 && removerIds.length === 0) return { segurar: "" };
    // Mesma regra do "Gravar lote" (ex-"Fechar lote") de sempre: sem quantidade nenhuma não há o que gravar.
    if (somaQuantidades(enviaveis) <= 0) return { segurar: "Informe a quantidade de pelo menos um lote." };
    return { lotes: enviaveis.map(montarLote), removerIds };
  }

  const assinaturaDe = (envio: { lotes: unknown[]; removerIds: number[] }) =>
    JSON.stringify({ lotes: envio.lotes, removerIds: envio.removerIds });

  // Ao abrir, o banco é o que a tela mostra: nada a gravar até alguém mexer.
  // Roda depois do primeiro render (antes de qualquer interação) e uma vez só:
  // a guarda pela ref segura as passagens seguintes.
  useEffect(() => {
    if (ultimaAssinaturaRef.current !== null) return;
    const inicial = prepararEnvio();
    ultimaAssinaturaRef.current = "segurar" in inicial ? "" : assinaturaDe(inicial);
  });

  async function executarSave(opcoes: { forcado?: boolean; confirmarReducao?: boolean } = {}) {
    const { forcado = false, confirmarReducao = false } = opcoes;
    if (!autoSaveHabilitado && !forcado) return;

    // Requisição em voo: enfileira e sai. O próprio término reprocessa.
    if (salvandoRef.current) {
      pendenteRef.current = true;
      return;
    }

    const envio = prepararEnvio();
    if ("segurar" in envio) {
      if (envio.segurar) setStatusSeMontado(forcado ? "error" : "idle", envio.segurar);
      return;
    }
    const assinatura = assinaturaDe(envio);
    if (assinatura === ultimaAssinaturaRef.current) {
      if (forcado) setStatusSeMontado("saved");
      return;
    }

    salvandoRef.current = true;
    setGravando(true);
    setStatusSeMontado("saving");

    try {
      const resposta = await fetchComSessao("/api/pedidos/lotes-em-massa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idInt,
          idProdutoProposta: item.id_produto_proposta_origem,
          confirmarReducao,
          removerIds: envio.removerIds,
          lotes: envio.lotes
        })
      });

      const dados = await resposta.json().catch(() => null);

      if (!resposta.ok || !dados?.success) {
        if (dados?.code === "CONFIRMAR_REDUCAO" && !confirmarReducao) {
          // Reduzir a quantidade do item derruba subtotal e peso: a mesma
          // confirmação de sempre, uma vez, no fim da edição do campo.
          const ok = window.confirm(
            `${dados.message}\n\nA quantidade do item vai de ${dados.qtdAtual} para ${dados.novaQtd}, ` +
            "e o subtotal e o peso acompanham. Confirmar?"
          );
          salvandoRef.current = false;
          setGravando(false);
          if (ok) {
            await executarSave({ forcado, confirmarReducao: true });
            return;
          }
          // O que foi digitado fica na tela; o banco fica como estava.
          setStatusSeMontado("error", "Redução não confirmada: a quantidade do item não foi alterada.");
          return;
        }
        setStatusSeMontado("error", dados?.message || "Não foi possível gravar os lotes.");
        return;
      }

      // Os ids das linhas novas: a rota devolve os lotes do item em ordem, e os
      // que a tela ainda não conhecia são os recém-inseridos, na ordem em que
      // foram enviados. Só o id e o que vem do banco entram na linha; o que o
      // usuário digitou enquanto o pedido estava em voo continua na tela.
      const devolvidos = (Array.isArray(dados.lotes) ? dados.lotes : []) as Record<string, unknown>[];
      const idsConhecidos = new Set(envio.lotes.map((l) => Number(l.id)).filter((id) => id > 0));
      const novosDevolvidos = devolvidos.filter((d) => !idsConhecidos.has(Number(d.id)));
      const chavesNovas = numerar(linhasRef.current, modoRef.current)
        .filter((l) => !l.id && completa(l))
        .map((l) => l.chave);
      const idPorChave = new Map<string, number>();
      if (novosDevolvidos.length === chavesNovas.length) {
        chavesNovas.forEach((chave, i) => idPorChave.set(chave, Number(novosDevolvidos[i].id)));
      }
      const porId = new Map(devolvidos.map((d) => [Number(d.id), d] as const));
      mutar((atual) =>
        atual.map((l) => {
          const id = l.id ? Number(l.id) : idPorChave.get(l.chave);
          if (!id) return l;
          const doBanco = porId.get(id);
          return {
            ...l,
            id,
            status_arte: (doBanco?.status_arte as string | undefined) ?? l.status_arte
          };
        })
      );
      removidosRef.current = [];
      const depois = prepararEnvio();
      ultimaAssinaturaRef.current = "segurar" in depois ? "" : assinaturaDe(depois);

      setStatusSeMontado("saved");
      onGravado({
        qtdItem: Number(dados.qtdItem),
        qtdAnterior: Number(dados.qtdAnterior),
        freteMensagem: dados.freteMensagem || null,
        lotes: devolvidos
      });
    } catch (erro) {
      setStatusSeMontado(
        "error",
        erro instanceof SessaoExpiradaError
          ? erro.message
          : erro instanceof Error
            ? erro.message
            : "Falha ao gravar."
      );
    } finally {
      salvandoRef.current = false;
      if (montadoRef.current) setGravando(false);
    }

    if (pendenteRef.current) {
      pendenteRef.current = false;
      await executarSave({ forcado });
    }
  }

  // A limpeza do efeito de desmontagem captura a função do primeiro render;
  // esta ref garante que ela chame sempre a versão atual.
  const saveRef = useRef(executarSave);
  useEffect(() => {
    saveRef.current = executarSave;
  });

  const agendarSave = (imediato: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (imediato) {
      void saveRef.current();
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void saveRef.current();
    }, DEBOUNCE_MS);
  };

  /** Libera a gravação pendente (blur dos campos digitados, Enter na Qtd). */
  const flushSave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    void saveRef.current();
  };

  // Sair da grade ou trocar de aba com alteração pendente: grava antes de sumir.
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
      if (okTimerRef.current) clearTimeout(okTimerRef.current);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        void saveRef.current();
      }
    };
  }, []);

  // ─── Edição das linhas ─────────────────────────────────────────────────────

  /**
   * Uma alteração vinda do `ModeloCampos`, com as mesmas derivações do card
   * (Qtd do camarote, Nº Final do ticket). `imediato` vem do próprio campo:
   * selects gravam na hora, texto e número esperam o debounce ou o blur.
   */
  function alterar(indice: number, partial: Partial<PedidoModeloState>, imediato = false) {
    mutar((atual) =>
      atual.map((l, i) => {
        if (i !== indice) return l;
        const base: ModeloNumeracaoCampos = {
          quantidade: Number(l.quantidade) || 0,
          tipo_numeracao: l.tipo_numeracao ?? null,
          numeracao_inicio: l.numeracao_inicio ?? null,
          numeracao_fim: l.numeracao_fim ?? null,
          gabarito_operacional: l.gabarito_operacional ?? null,
          Q_CAM: l.Q_CAM ?? null,
          L_CAM: l.L_CAM ?? null,
          C_INI: l.C_INI ?? null
        };
        const derivados = derivarCamposNumeracao(base, partial as Partial<ModeloNumeracaoCampos>, numeracoes);
        return {
          ...l,
          ...partial,
          ...derivados,
          // Escolher a cor no dropdown resolve a cor colada que não casou.
          ...(partial.padrao !== undefined ? { corNaoReconhecida: null } : {})
        } as Lote;
      })
    );
    // A Qtd digitada só grava ao sair do campo — ver o cabeçalho do arquivo.
    if (partial.quantidade !== undefined && !imediato) return;
    agendarSave(imediato);
  }

  function acrescentar(indice?: number, quantas = 1) {
    mutar((atual) => {
      const base = indice !== undefined ? atual[indice] : atual[atual.length - 1];
      // novaLinha por índice, não uma cópia do mesmo objeto: linhas que
      // compartilhassem referência editariam umas às outras.
      return [...atual, ...Array.from({ length: quantas }, () => novaLinha(base))];
    });
    // Linha nova nasce incompleta: nada a gravar por enquanto.
  }

  function remover(indice: number) {
    mutar((atual) => {
      const alvo = atual[indice];
      if (alvo?.id) removidosRef.current = [...removidosRef.current, Number(alvo.id)];
      const resto = atual.filter((_, i) => i !== indice);
      return resto.length > 0 ? resto : [novaLinha()];
    });
    agendarSave(true);
  }

  function colar(evento: React.ClipboardEvent, indice: number) {
    const texto = evento.clipboardData.getData("text");
    if (!texto.includes("\n") && !texto.includes("\t")) return; // colagem de um valor só: comportamento normal

    evento.preventDefault();
    // Sem coluna de cor, a cor da lista é descartada — não há onde mostrá-la e
    // o lote não deve recebê-la.
    const lidas = interpretarColagem(texto, cores).map((l) =>
      mostraCor ? l : { ...l, padrao: null, corNaoReconhecida: null }
    );
    if (lidas.length === 0) {
      showToast({
        type: "warning",
        title: "Nada reconhecido na lista",
        description: "Esperado uma linha por lote, com a cor e a quantidade — como sai da planilha."
      });
      return;
    }

    // Colar SEMPRE acrescenta. Substituir apagaria trabalho já digitado, e o
    // gesto é o mais perigoso da tela.
    const nomePadrao = linhasRef.current[indice]?.nome_modelo?.trim() || item.nome;
    mutar((atual) => {
      const semVaziaFinal = atual.filter((l) => l.id || l.nome_modelo.trim() || l.quantidade !== "" || l.padrao);
      const base = atual[atual.length - 1];
      // O que veio da lista (cor e quantidade) manda; o resto do lote vem dos
      // padrões, senão colar 20 linhas geraria 20 lotes sem numerador.
      return [
        ...semVaziaFinal,
        ...lidas.map((l) => ({ ...novaLinha(base), ...l, nome_modelo: nomePadrao }))
      ];
    });

    const semCor = lidas.filter((l) => l.corNaoReconhecida).length;
    showToast({
      type: semCor > 0 ? "warning" : "success",
      title: `${lidas.length} lote(s) lidos da lista`,
      description: semCor > 0 ? `${semCor} cor(es) não reconhecidas — escolha na Cor papel.` : undefined
    });
    // As linhas coladas já chegam completas: gravam depois do debounce.
    agendarSave(false);
  }

  function alternarModo(modo: ModoNumeracao) {
    const proximo = modoRef.current === modo ? null : modo;
    modoRef.current = proximo;
    setModoNumeracao(proximo);
    // A faixa de todos os lotes muda de uma vez: grava na hora.
    agendarSave(true);
  }

  const colunas = colunasDaLista({ simplificado, visivel, itemPrateleira });

  const incompletas = linhas.filter((l) => !l.id && !completa(l) && (l.nome_modelo.trim() || l.quantidade !== "" || l.padrao)).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-semibold text-slate-800">{linhas.length} lote(s)</span>
          <span className="text-slate-300">·</span>
          <span className="font-semibold text-slate-800">{soma.toLocaleString("pt-BR")} un</span>
          {soma !== item.quantidade && (
            <span className="ml-1 text-xs font-semibold text-amber-600">
              quantidade do item: {item.quantidade.toLocaleString("pt-BR")} → {soma.toLocaleString("pt-BR")}
            </span>
          )}
          <span className="ml-2 flex items-center gap-1.5 text-[11px] font-bold">
            {saveStatus === "idle" && <span className="flex h-2 w-2 rounded-full bg-slate-300" title="Sem alterações pendentes"></span>}
            {saveStatus === "saving" && <span className="text-amber-600">Salvando...</span>}
            {saveStatus === "saved" && <span className="text-teal-600">Salvo</span>}
            {saveStatus === "error" && <span className="text-red-500">Erro ao salvar</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={MAX_LINHAS_DE_UMA_VEZ}
            value={quantasLinhas}
            onChange={(e) =>
              setQuantasLinhas(
                e.target.value === ""
                  ? ""
                  : Math.min(MAX_LINHAS_DE_UMA_VEZ, Math.max(1, Number(e.target.value) || 1))
              )
            }
            title="Quantas linhas criar de uma vez"
            aria-label="Quantas linhas criar de uma vez"
            className="w-16 rounded-xl border border-slate-200 px-2 py-2 text-center text-xs font-bold text-slate-700 outline-none"
          />
          <button
            type="button"
            onClick={() => acrescentar(undefined, quantasCriar)}
            className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
          >
            <Plus className="h-4 w-4" /> {quantasCriar > 1 ? `${quantasCriar} linhas` : "Linha"}
          </button>
          <button
            type="button"
            onClick={onSair}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
          >
            Ver como cards
          </button>
          {/* O caminho de gravação de sempre: grava o que estiver pendente e
              fica na grade. Em proposta com cobrança é o único caminho — o
              auto-save fica desligado, como no card. */}
          <button
            type="button"
            onClick={() => void executarSave({ forcado: true })}
            disabled={gravando}
            className="rounded-xl bg-[#0b2f4a] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#123f61] disabled:opacity-60"
          >
            {gravando ? "Gravando..." : "Gravar lote"}
          </button>
        </div>
      </div>

      {/* Motivo da recusa no próprio contexto: redução não confirmada, obrigatório
          faltando num lote gravado, cobrança ativa, falha de rede. */}
      {erroSalvar && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
          {erroSalvar}
        </div>
      )}

      {mostraFaixa && (
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Numeração</span>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={modoNumeracao === "CADA_DO_1"}
            onChange={() => alternarModo("CADA_DO_1")}
            className="h-4 w-4 rounded border-slate-300"
          />
          Cada modelo começa do 1
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={modoNumeracao === "SEQUENCIAL"}
            onChange={() => alternarModo("SEQUENCIAL")}
            className="h-4 w-4 rounded border-slate-300"
          />
          Sequencial entre os modelos
        </label>
        <span className="text-[11px] text-slate-500">
          {modoNumeracao === "CADA_DO_1"
            ? "1–300, 1–150, 1–80"
            : modoNumeracao === "SEQUENCIAL"
              ? "1–300, 301–450, 451–530"
              : "Sem marcar, cada lote mantém o Nº inicial que já tem."}
        </span>
      </div>
      )}

      <p className="px-1 text-[11px] text-slate-500">
        {autoSaveHabilitado
          ? "As alterações são gravadas automaticamente; a Qtd grava ao sair do campo. "
          : "Proposta com cobrança: use “Gravar lote” para gravar. "}
        Cole a lista do cliente em qualquer campo de texto (uma linha por lote, cor e quantidade).
        Enter na Qtd cria a próxima linha herdando a cor.
        {incompletas > 0 && ` ${incompletas} lote(s) ainda sem os obrigatórios — não são gravados até ficarem completos.`}
      </p>

      <div className="space-y-2">
        {/* Um cabeçalho por produto: as mesmas colunas das células de cada lote,
            mais a coluna do status da arte e o espaço dos botões. */}
        <div className="flex items-end gap-2 px-3">
          <CabecalhoDaLista colunas={colunas} className="min-w-0 flex-1" />
          <span className="w-28 shrink-0 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {itemPrateleira ? "" : "Arte"}
          </span>
          <span className="w-16 shrink-0" />
        </div>

        {linhasNumeradas.map((linha, indice) => (
          <div
            key={linha.chave}
            className={`rounded-xl border px-3 py-2 ${
              linha.corNaoReconhecida ? "border-red-300 bg-red-50/40" : "border-slate-200 bg-white"
            }`}
          >
            <div className="flex items-center gap-2">
              <div className="grid min-w-0 flex-1 items-center gap-2" style={{ gridTemplateColumns: gridDaLista(colunas) }}>
                <ModeloCampos
                  modelo={valoresDoCard(linha)}
                  coresOpcoes={coresOpcoes}
                  numeracoesOpcoes={numeracoes}
                  itemIdFormato={itemIdFormato}
                  simplificado={simplificado}
                  visivel={visivel}
                  itemPrateleira={itemPrateleira}
                  modo="lista"
                  identificador={linha.id ? `#${linha.id}` : "novo"}
                  onChange={(partial, imediato) => alterar(indice, partial, imediato)}
                  onBlurCampo={flushSave}
                  onPaste={(e) => colar(e, indice)}
                  onEnterQtd={() => {
                    flushSave();
                    acrescentar(indice);
                  }}
                  numeracaoInicioTravada={
                    modoEfetivo
                      ? "Com um modo de numeração marcado acima, o Nº Inicial é calculado. Desmarque para editar."
                      : null
                  }
                />
              </div>
              {/* Status da arte na própria linha. Prateleira não entra em arte. */}
              <div className="flex w-28 shrink-0 justify-center">
                {!itemPrateleira && (
                  <StatusBadge status={linha.status_arte || "PENDENTE"} tone={getArteStatusTone(linha.status_arte)} />
                )}
              </div>
              <div className="flex w-16 shrink-0 justify-end gap-1">
                <button
                  type="button"
                  title="Duplicar (quantidade em branco)"
                  onClick={() => acrescentar(indice)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  title="Remover lote"
                  onClick={() => remover(indice)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {linha.corNaoReconhecida && (
              <p className="mt-1 text-[11px] font-semibold text-red-600">
                cor da lista não reconhecida: “{linha.corNaoReconhecida}” — escolha na Cor papel
              </p>
            )}

            {/* A janela de amostra do modo cards, só com "Amostras" ligado — prateleira não tem. */}
            {amostrasVisiveis && (
              <AmostraDoModelo modelo={linha} itemPrateleira={itemPrateleira} modo="lista" onAmpliar={onAmpliarArte} />
            )}
          </div>
        ))}
      </div>

      {naoReconhecidas > 0 && (
        <p className="px-1 text-[11px] font-semibold text-red-600">
          {naoReconhecidas} cor(es) da lista não existem no cadastro deste produto — escolha na Cor papel de cada lote.
        </p>
      )}
    </div>
  );
}
