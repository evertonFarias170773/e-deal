"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Edit2, Trash2, Package, CheckCircle, Copy, AlertOctagon, ChevronDown, ListPlus, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { LotesGrid, type PadroesDeLote } from "@/features/orcamentos/components/LotesGrid";
// Campos, janela de amostra e helpers da arte: o que o card e a lista rapida
// compartilham (23/09/2026). Sairam daqui sem mudar marcacao nem regra.
import {
  AmostraDoModelo,
  ModeloCampos,
  isArteAprovada,
  modeloCompleto,
} from "@/features/orcamentos/components/ModeloCampos";
import { rotuloFaixaExtenso } from "@/features/orcamentos/services/lotes-numeracao";
import {
  anularColunasEscondidas,
  checklistVisivel,
  mostraCampo,
  type ChecklistVisivel
} from "@/features/orcamentos/lib/checklist-lote";
import { listChecklistDeProdutos } from "@/features/produtos/services/produto-boletim-campos.service";
import type { PedidoModeloRow, ModeloInput } from "@/features/orcamentos/services/pedidos-modelos.service";
import {
  criarModelo,
  atualizarModeloParcial,
  excluirModelo,
} from "@/features/orcamentos/services/pedidos-modelos.service";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  formatVariacoesItem,
  isItemPrateleira,
  novoModeloTempId,
  propostaDispensaArte,
  STATUS_INICIAL_MODELO,
} from "@/features/orcamentos/orcamento-utils";
import type { PropostaItem, PedidoModeloState } from "@/features/orcamentos/types";
import {
  TIPO_CAMAROTE,
  TIPO_TICKET,
  normalizarTipoNumeracao,
  findNumeracaoByName,
  resolverMultiplicadorNumeracao,
  derivarCamposNumeracao,
  calcularQtdCamarote,
} from "@/features/orcamentos/numeracao-modelo-utils";

/**
 * Texto de variações exibido no card: o persistido em
 * pedidos_modelos.variacoes_texto é a fonte principal; o cálculo a partir do
 * item só entra quando o modelo ainda não tem o valor gravado (modelo novo,
 * ou registro anterior à coluna).
 */
function resolverVariacoesTexto(modelo: PedidoModeloState, item: PropostaItem): string {
  const persistido = modelo.variacoes_texto?.trim();
  if (persistido) return persistido;
  if (modelo.variacoes_texto === "") return "";
  return formatVariacoesItem(item);
}

// ─── Identidade do modelo no estado ──────────────────────────────────────────

/**
 * Chave estável de um modelo dentro de form.pedidosModelos.
 *
 * O modelo criado na tela nasce só com tempId e ganha id ao ser gravado, mas
 * mantém o tempId — por isso o tempId tem precedência: a chave não muda no meio
 * da edição. Modelo carregado do banco só tem id. Retorna "" quando não há
 * identidade (não deve acontecer); quem usa precisa ignorar esse caso em vez de
 * casar com todos.
 */
function modeloKey(m: Pick<PedidoModeloState, "tempId" | "id">): string {
  if (m.tempId) return `tmp:${m.tempId}`;
  if (m.id) return `id:${m.id}`;
  return "";
}

/** Opção de cadastro (cores do papel ou numerações) no que interessa aqui. */
type OpcaoCadastro = {
  name?: string | null;
  id_modelo_cor_num?: unknown;
  id_gabarito?: unknown;
};

/**
 * Com o que um lote novo deste produto já nasce preenchido.
 *
 * Fonte única: o card "Adicionar modelo" e a grade da Lista rápida chamam esta
 * função. Enquanto a grade tinha os seus próprios defaults (nenhum), lote
 * criado por ali nascia sem numerador e o vendedor abria um por um depois só
 * para escolher o que o cadastro do produto já sabia.
 */
function padroesDeNovoLote(
  produto: { id_modelo_cor?: unknown; id_gabarito?: unknown } | null | undefined,
  cores: OpcaoCadastro[],
  numeracoes: OpcaoCadastro[]
): PadroesDeLote {
  const cor = cores.find(
    (c) => produto?.id_modelo_cor && String(c.id_modelo_cor_num) === String(produto.id_modelo_cor)
  );
  const numerador = numeracoes.find(
    (n) => produto?.id_gabarito && String(n.id_gabarito) === String(produto.id_gabarito)
  );
  const nomeNumerador = numerador?.name ?? null;

  return {
    padrao: cor?.name ?? null,
    gabarito_operacional: nomeNumerador,
    // Sem numerador não há numeração — é o mesmo par que os cards mantêm.
    tipo_numeracao: nomeNumerador ? "SEQUENCIAL" : "SEM_NUMERACAO",
    numeracao_inicio: nomeNumerador ? 1 : null,
    verso_tipo: "SÓ FRENTE",
    bloco: "50"
  };
}

// ─── Auto-save ───────────────────────────────────────────────────────────────

/** Espera antes de gravar campos digitados. Curto o bastante para não parecer manual. */
const DEBOUNCE_MS = 600;

/**
 * Campos do modelo que o auto-save envia. São exatamente os editáveis no card —
 * status de arte/produção, amostra e variacoes_texto ficam de fora porque
 * pertencem a outros fluxos e nunca devem ser reescritos daqui.
 */
const CAMPOS_AUTOSAVE = [
  "nome_modelo",
  "padrao",
  "quantidade",
  "tipo_numeracao",
  "numeracao_inicio",
  "numeracao_fim",
  "verso_tipo",
  "bloco",
  "gabarito_operacional",
  "Q_CAM",
  "L_CAM",
  "C_INI",
] as const;

type CampoAutoSave = (typeof CAMPOS_AUTOSAVE)[number];

/**
 * A recusa veio do saldo conferido NO BANCO?
 *
 * Só nesse caso a orientação é gravar o item na aba Orçamento. O padrão casa
 * exclusivamente com a mensagem de `validarSaldoModelo`
 * (services/pedidos-modelos.service.ts): "Quantidade (N) excede o saldo...".
 *
 * Existe uma segunda mensagem com "excede o saldo" nesta mesma tela — a do
 * numerador Camarote, em `motivoBloqueio` ("A QTD calculada (N) excede o saldo
 * disponível do item (M)"). Aquela é calculada em memória, com a quantidade
 * que o cabeçalho já mostra: mandar gravar o item ali seria orientação falsa,
 * porque não muda a conta. Daí o padrão exigir o início "Quantidade (N)".
 */
function ehErroDeSaldoDoBanco(mensagem: string | null): boolean {
  return Boolean(mensagem && /quantidade\s*\(\d+\)\s*excede o saldo/i.test(mensagem));
}

/** Monta o payload com SOMENTE os campos alterados — nunca sobrescreve o resto. */
function montarPayloadParcial(mod: PedidoModeloState, campos: Set<CampoAutoSave>): Partial<ModeloInput> {
  const p: Partial<ModeloInput> = {};
  if (campos.has("nome_modelo")) p.nome_modelo = mod.nome_modelo;
  if (campos.has("padrao")) p.padrao = mod.padrao || null;
  if (campos.has("quantidade")) {
    p.quantidade = mod.quantidade;
    // Não é gravado pelo update: vai junto para o saldo ser validado contra o
    // item certo (o mesmo produto pode ocupar várias linhas da proposta).
    p.id_produto_proposta_origem = mod.id_produto_proposta_origem ?? undefined;
  }
  if (campos.has("tipo_numeracao")) p.tipo_numeracao = mod.tipo_numeracao || null;
  if (campos.has("numeracao_inicio")) p.numeracao_inicio = mod.numeracao_inicio ?? null;
  if (campos.has("numeracao_fim")) p.numeracao_fim = mod.numeracao_fim ?? null;
  if (campos.has("verso_tipo")) p.verso_tipo = mod.verso_tipo || null;
  if (campos.has("bloco")) p.bloco = mod.bloco || null;
  if (campos.has("gabarito_operacional")) p.gabarito_operacional = mod.gabarito_operacional || null;
  if (campos.has("Q_CAM")) p.Q_CAM = mod.Q_CAM ?? null;
  if (campos.has("L_CAM")) p.L_CAM = mod.L_CAM ?? null;
  if (campos.has("C_INI")) p.C_INI = mod.C_INI ?? null;
  return p;
}

/**
 * Mínimo para o modelo novo virar linha no banco — os campos marcados com
 * asterisco no formulário. Enquanto não estiverem preenchidos o modelo vive só
 * no estado local; nada é gravado pela metade.
 *
 * A Cor do papel só é exigida quando o produto a imprime: se o checklist do
 * boletim a esconde, o campo nem aparece, e cobrá-lo trancaria o lote para
 * sempre. Nome e quantidade são sempre obrigatórios.
 */
function temDadosMinimos(mod: PedidoModeloState, idInt: number | undefined, visivel: ChecklistVisivel): boolean {
  // Os asteriscos do formulario sao os mesmos da lista rapida: `modeloCompleto`.
  return Boolean(idInt && mod.id_produto_proposta_origem && modeloCompleto(mod, visivel));
}

// ─── Component ───────────────────────────────────────────────────────────────

function ModeloInlineCard({
  modelo,
  maxQtd,
  itemIdModeloCorNum,
  itemIdFormato,
  produtoIdFormato,
  coresOpcoes,
  numeracoesOpcoes,
  formatosOpcoes,
  idInt,
  autoSaveHabilitado,
  itemPrateleira,
  simplificado,
  visivel,
  onRemove,
  onClose,
  onUpdateParent,
}: {
  modelo: PedidoModeloState;
  maxQtd: number;
  itemIdModeloCorNum?: string | null;
  itemIdFormato?: string | null;
  produtoIdFormato?: string | null;
  coresOpcoes: any[];
  numeracoesOpcoes: any[];
  formatosOpcoes: any[];
  idInt?: number;
  /** Desligado em proposta paga/bloqueada — lá a gravação continua manual. */
  autoSaveHabilitado: boolean;
  /**
   * Item de prateleira: mostra a prévia do papel da cor selecionada. É por
   * ITEM, não por proposta — numa proposta mista só o item de prateleira
   * ganha a prévia.
   */
  itemPrateleira: boolean;
  /**
   * Proposta 100% de prateleira: o formulário mostra só Cor papel, Qtd, Verso e
   * Numerador. Modelo, Nº Inicial, Nº Final e Bloco continuam no estado e no
   * banco com os defaults — apenas somem da tela, porque produto vendido pronto
   * não tem nome de modelo nem blocagem a definir.
   */
  simplificado: boolean;
  /**
   * Checklist do boletim do produto do item (lib/checklist-lote). O card não
   * mostra o campo que o produto não imprime, e os serviços não o gravam: o
   * lote novo nasce null nele e o auto-save nunca o escreve. `null` = produto
   * sem checklist, card como sempre foi.
   */
  visivel: ChecklistVisivel;
  onRemove: () => void;
  onClose: () => void;
  onUpdateParent: (partial: Partial<PedidoModeloState>) => void;
}) {
  const mostraCor = mostraCampo(visivel, "cor");
  const isNew = !modelo.isPersisted;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  // Mantém uma referência sempre atualizada do modelo para o onBlur ler os dados mais frescos
  const latestModelo = useRef(modelo);
  useEffect(() => {
    latestModelo.current = modelo;
  }, [modelo]);

  // ─── Estado do auto-save ───────────────────────────────────────────────────
  // sujosRef: campos alterados desde a última gravação bem-sucedida. É a fonte
  //   do payload — o que não está aqui não é enviado, então nada é sobrescrito.
  // salvandoRef/pendenteRef: fila serial por modelo. Enquanto há requisição em
  //   voo, a alteração seguinte fica pendente e dispara ao terminar; nunca duas
  //   requisições simultâneas do mesmo modelo, nem ordem invertida.
  // criandoRef: trava o INSERT — um modelo novo é criado uma única vez.
  const sujosRef = useRef<Set<CampoAutoSave>>(new Set());
  const salvandoRef = useRef(false);
  const pendenteRef = useRef(false);
  const criandoRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const montadoRef = useRef(true);
  const okTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setStatusSeMontado = (s: typeof saveStatus, erro: string | null = null) => {
    if (!montadoRef.current) return;
    setSaveStatus(s);
    setErroSalvar(erro);
    if (s === "saved") {
      if (okTimerRef.current) clearTimeout(okTimerRef.current);
      okTimerRef.current = setTimeout(() => { if (montadoRef.current) setSaveStatus("idle"); }, 2000);
    }
  };

  /** Impedimentos verificáveis sem ida ao servidor. Null = pode gravar. */
  const motivoBloqueio = (mod: PedidoModeloState): string | null => {
    const numeracaoSel = findNumeracaoByName(numeracoesOpcoes, mod.gabarito_operacional);
    const tipoSel = normalizarTipoNumeracao(numeracaoSel?.tipo);

    if (tipoSel === TIPO_CAMAROTE) {
      const qtdCamarote = calcularQtdCamarote(mod.Q_CAM, mod.L_CAM);
      if (qtdCamarote === null) return "Informe Q CAM e L CAM (maiores que zero) para o numerador do tipo Camarote.";
      if (Number(mod.quantidade) !== qtdCamarote) return `A QTD (${mod.quantidade}) deve ser igual a Q CAM × L CAM (${qtdCamarote}).`;
      // A QTD do camarote é calculada, não digitada: não passa pelo clamp do input
      if (qtdCamarote > maxQtd) return `A QTD calculada (${qtdCamarote}) excede o saldo disponível do item (${maxQtd}).`;
    }

    if (tipoSel === TIPO_TICKET) {
      const { erro } = resolverMultiplicadorNumeracao(numeracaoSel);
      if (erro) return erro;
    }

    return null;
  };

  const executarSave = async (forcado = false) => {
    if (!autoSaveHabilitado && !forcado) return;

    // Requisição em voo: enfileira e sai. O próprio término reprocessa.
    if (salvandoRef.current) {
      pendenteRef.current = true;
      return;
    }

    const mod = latestModelo.current;

    const bloqueio = motivoBloqueio(mod);
    if (bloqueio) {
      setStatusSeMontado("error", bloqueio);
      return;
    }

    if (!mod.isPersisted && !criandoRef.current) {
      // Sem os dados mínimos o modelo permanece só no estado local.
      if (!temDadosMinimos(mod, idInt, visivel)) {
        setStatusSeMontado("idle");
        return;
      }

      criandoRef.current = true;
      salvandoRef.current = true;
      setStatusSeMontado("saving");
      sujosRef.current.clear();

      const res = await criarModelo({
        id_int: idInt!,
        id_produto_proposta_origem: mod.id_produto_proposta_origem!,
        nome_modelo: mod.nome_modelo,
        padrao: mod.padrao || null,
        quantidade: mod.quantidade,
        tipo_numeracao: "SEQUENCIAL",
        numeracao_inicio: mod.numeracao_inicio || null,
        numeracao_fim: mod.numeracao_fim || null,
        verso_tipo: mod.verso_tipo || null,
        bloco: mod.bloco || null,
        gabarito_operacional: mod.gabarito_operacional || null,
        // Snapshot das variações do item de origem.
        variacoes_texto: mod.variacoes_texto ?? null,
        Q_CAM: mod.Q_CAM ?? null,
        L_CAM: mod.L_CAM ?? null,
        C_INI: mod.C_INI ?? null,
        // O checklist do produto: o serviço anula o que ele não imprime — o
        // "SEQUENCIAL" fixo acima inclusive, quando o tipo está escondido.
      }, visivel).catch((e) => ({ success: false as const, data: undefined, errorMessage: String(e?.message || e) }));

      salvandoRef.current = false;
      criandoRef.current = false;

      if (res.success && res.data) {
        const sincronizado = {
          id: res.data.id,
          isPersisted: true,
          ordem: res.data.ordem,
          status_arte: res.data.status_arte,
          status_producao: res.data.status_producao,
          variacoes_texto: res.data.variacoes_texto ?? null,
        };
        // A ref precisa refletir a persistência ANTES de qualquer reprocesso da
        // fila: o re-render do pai chega depois, e sem isto a alteração pendente
        // veria isPersisted=false e criaria a mesma linha de novo.
        latestModelo.current = { ...latestModelo.current, ...sincronizado };
        // O tempId é mantido de propósito: é a chave que identifica este modelo
        // no estado e não pode mudar no meio da edição.
        onUpdateParent(sincronizado);
        setStatusSeMontado("saved");
      } else {
        setStatusSeMontado("error", res.errorMessage || "Falha ao criar modelo.");
      }
    } else if (mod.isPersisted && mod.id && mod.id > 0) {
      const campos = new Set(sujosRef.current);
      if (campos.size === 0) {
        if (forcado) setStatusSeMontado("saved");
        return;
      }

      sujosRef.current.clear();
      salvandoRef.current = true;
      setStatusSeMontado("saving");

      // O serviço tira do UPDATE a coluna que o produto não imprime.
      const res = await atualizarModeloParcial(mod.id, montarPayloadParcial(mod, campos), visivel)
        .catch((e) => ({ success: false as const, errorMessage: String(e?.message || e) }));

      salvandoRef.current = false;

      if (res.success) {
        setStatusSeMontado("saved");
      } else {
        // Falha (inclusive de rede): devolve os campos à fila e NÃO toca no
        // estado local — o que o usuário digitou continua na tela.
        campos.forEach((c) => sujosRef.current.add(c));
        setStatusSeMontado("error", res.errorMessage || "Falha ao salvar o modelo.");
      }
    } else {
      return;
    }

    if (pendenteRef.current) {
      pendenteRef.current = false;
      await executarSave(forcado);
    }
  };

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

  // Fecha o card ou troca de aba com alteração pendente: grava antes de sumir.
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

  // Default numeracao_inicio to 1 if new and not set
  useEffect(() => {
    if (isNew && modelo.numeracao_inicio == null) {
      onUpdateParent({ numeracao_inicio: 1 });
    }
  }, [isNew, modelo.numeracao_inicio, onUpdateParent]);

  // Modelo novo que já nasce completo — o caso da duplicata, que herda nome,
  // cor e quantidade do original — é gravado sem esperar uma edição. Sem isto a
  // cópia ficava só no estado local até o usuário mexer em algum campo.
  // O modelo em branco não entra aqui: nasce com quantidade 0.
  const criacaoInicialRef = useRef(false);
  useEffect(() => {
    if (criacaoInicialRef.current) return;
    if (!isNew || !temDadosMinimos(modelo, idInt, visivel)) return;
    // Só a primeira vez: depois quem agenda é o handleChange.
    criacaoInicialRef.current = true;
    agendarSave(false);
  }, [isNew, modelo, idInt, visivel]);

  /**
   * @param imediato true para selects e toggles (valor discreto, não existe
   * estado intermediário inválido); false para texto/número, que passam pelo
   * debounce e são liberados também no blur.
   */
  const handleChange = (partial: Partial<PedidoModeloState>, imediato = false) => {
    const atual = latestModelo.current;

    // QTD (tipo CAMAROTE) e Nº Final (NI + QTD × ticket_qtd - 1 no tipo TICKET)
    // são derivados de forma síncrona a partir do numerador em vigor.
    const derivados = derivarCamposNumeracao(atual, partial, numeracoesOpcoes);
    const updated: Partial<PedidoModeloState> = { ...partial, ...derivados };

    // Atualiza a ref imediatamente para o onBlur capturar caso dispare antes do render
    latestModelo.current = { ...atual, ...updated };
    onUpdateParent(updated);

    // Marca o que mudou (inclusive os derivados) e agenda a gravação.
    for (const campo of CAMPOS_AUTOSAVE) {
      if (campo in updated) sujosRef.current.add(campo);
    }
    agendarSave(imediato);
  };

  /** Libera o debounce pendente (usado no blur dos campos digitados). */
  const flushSave = () => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    void saveRef.current();
  };

  const hasConfig = Boolean(itemIdFormato);

  // Numerador selecionado (busca na lista completa: o gravado pode estar fora
  // do filtro por formato). So para o realinhamento do camarote abaixo — o
  // resto da derivacao vive em `ModeloCampos`.
  const numeracaoSelecionada = findNumeracaoByName(numeracoesOpcoes, modelo.gabarito_operacional);
  const isCamarote = normalizarTipoNumeracao(numeracaoSelecionada?.tipo) === TIPO_CAMAROTE;
  const qtdCamaroteCalculada = calcularQtdCamarote(modelo.Q_CAM, modelo.L_CAM);

  // Camarote: QTD é derivada. Realinha ao abrir o modelo (cobre registros gravados
  // antes desta regra) para que QTD nunca fique divergente de Q_CAM × L_CAM.
  useEffect(() => {
    if (!isCamarote || qtdCamaroteCalculada === null) return;
    if (Number(modelo.quantidade) === qtdCamaroteCalculada) return;
    handleChange({ quantidade: qtdCamaroteCalculada });
    // handleChange é recriada a cada render; o guard acima impede reexecução em loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCamarote, qtdCamaroteCalculada, modelo.quantidade]);

  return (
    <div className="relative rounded-2xl border-2 border-teal-500 bg-teal-50/30 p-5 shadow-sm transition-all">
      <div className="mb-4 flex items-center justify-between border-b border-teal-100 pb-3">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-bold text-teal-800">
            {isNew ? "Novo modelo" : `Modelo #${modelo.id}`}
          </h4>
          <div className="flex items-center gap-1.5 text-[11px] font-bold">
            {saveStatus === "idle" && <span className="flex h-2 w-2 rounded-full bg-slate-300" title="Sem alterações pendentes"></span>}
            {saveStatus === "saving" && <span className="text-amber-600">Salvando...</span>}
            {saveStatus === "saved" && <span className="text-teal-600">Salvo</span>}
            {saveStatus === "error" && <span className="text-red-500">Erro ao salvar</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
          >
            Fechar
          </button>
          {/* Em proposta paga/bloqueada o auto-save não age: a gravação manual
              continua sendo o único caminho, então o botão permanece lá. */}
          {!autoSaveHabilitado && (
            <button
              onClick={() => { void executarSave(true); }}
              disabled={saveStatus === "saving"}
              className="flex items-center gap-2 rounded-xl border border-teal-500 bg-teal-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-teal-700 disabled:opacity-50"
            >
              {saveStatus === "saving" ? "Salvando..." : "Salvar modelo"}
            </button>
          )}
          <button
            onClick={onRemove}
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100"
          >
            {isNew ? "Cancelar" : "Remover"}
          </button>
        </div>
      </div>

      {/* Motivo da recusa no próprio contexto do modelo — saldo estourado,
          camarote divergente, numerador inválido, falha de rede. */}
      {erroSalvar && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-700">
          {erroSalvar}
          {/* O saldo é conferido no banco, e a quantidade do item só chega lá
              quando o item é gravado. Sem esta linha o usuário lê dois números
              que se contradizem: o cabeçalho já mostra a quantidade nova e o
              erro fala da antiga. */}
          {ehErroDeSaldoDoBanco(erroSalvar) && (
            <span className="mt-1 block font-medium">
              A quantidade do item ainda não foi gravada. Volte à aba Orçamento, clique em “Salvar item” e tente de novo.
            </span>
          )}
        </div>
      )}

      {!erroSalvar && (
        <p className="mb-4 text-[11px] font-medium text-slate-500">
          {!autoSaveHabilitado
            ? "Proposta com cobrança: use “Salvar modelo” para gravar."
            : !hasConfig
              ? "Produto sem formato configurado: cor e numerador indisponíveis, o modelo não pode ser gravado."
              : isNew && !temDadosMinimos(modelo, idInt, visivel)
                ? simplificado
                  ? mostraCor
                    ? "Preencha Qtd e Cor do papel — a gravação é automática a partir daí."
                    : "Preencha Qtd — a gravação é automática a partir daí."
                  : mostraCor
                    ? "Preencha Modelo, Qtd e Cor do papel — a gravação é automática a partir daí."
                    : "Preencha Modelo e Qtd — a gravação é automática a partir daí."
                : "As alterações são gravadas automaticamente."}
        </p>
      )}

      {/* Os campos sao os mesmos da lista rapida — `ModeloCampos`, extraido
          daqui sem mudar marcacao nem regra. O card fica com o que e so dele:
          o auto-save por `criarModelo` / `atualizarModeloParcial`. */}
      <ModeloCampos
        modelo={modelo}
        coresOpcoes={coresOpcoes}
        numeracoesOpcoes={numeracoesOpcoes}
        itemIdFormato={itemIdFormato}
        simplificado={simplificado}
        visivel={visivel}
        itemPrateleira={itemPrateleira}
        modo="card"
        maxQtd={maxQtd}
        onChange={handleChange}
        onBlurCampo={flushSave}
      />
    </div>
  );
}

export function PedidoModelosTab({
  idInt,
  idCliente,
  itens,
  modelos,
  autoSaveHabilitado = true,
  onModelosChange,
  onLotesGravados,
}: {
  idInt?: number;
  /** propostas.id_cliente — filtra as numerações exclusivas de cliente. */
  idCliente?: number;
  itens: PropostaItem[];
  modelos: PedidoModeloState[];
  /**
   * Auto-save dos modelos. Desligado em proposta com cobrança ativa ou form
   * bloqueado — nesse caso o card volta a exibir o botão "Salvar modelo".
   */
  autoSaveHabilitado?: boolean;
  /**
   * Só aceita atualizador funcional: a lista é montada a partir do estado
   * corrente, nunca do array capturado no render. Com vários modelos abertos ao
   * mesmo tempo (o caso de duplicar várias vezes) e com respostas assíncronas
   * chegando depois, montar a partir do array capturado fazia uma alteração
   * descartar a outra.
   */
  onModelosChange: (atualizar: (prev: PedidoModeloState[]) => PedidoModeloState[]) => void;
  /** Lotes gravados em massa: o pai acerta a quantidade do item e relê os lotes. */
  onLotesGravados?: (idProdutoPropostaOrigem: number, novaQtd: number, freteMensagem: string | null) => void;
}) {
  const { showToast } = useAppToast();
  // Proposta 100% de prateleira: mesma definição usada para dispensar a arte.
  // Produto vendido pronto não tem nome de modelo, numeração nem blocagem a
  // definir, então o formulário fica só com Cor papel, Qtd, Verso e Numerador.
  const formularioSimplificado = propostaDispensaArte(itens);
  const [loading, setLoading] = useState(false);

  /**
   * Checklist do boletim de cada produto dos itens (`produto_boletim_campos`,
   * cadastro de hoje), por id_produto. Produto fora do mapa = sem checklist,
   * card e criação como sempre foram.
   */
  const [checklistPorProduto, setChecklistPorProduto] = useState<Map<number, string[]>>(new Map());
  const idsProdutoDosItens = itens
    .map((it) => Number(it.id_produto))
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    const ids = idsProdutoDosItens.split(",").map(Number).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return;
    let ativo = true;
    void (async () => {
      const mapa = await listChecklistDeProdutos(ids);
      if (ativo) setChecklistPorProduto(mapa as Map<number, string[]>);
    })();
    return () => {
      ativo = false;
    };
  }, [idsProdutoDosItens]);

  /** A regra do checklist para este item (mesma de grade, rota e PCP). */
  const visivelDoItem = (item: PropostaItem): ChecklistVisivel =>
    checklistVisivel(checklistPorProduto.get(Number(item.id_produto)));
  const [coresOpcoes, setCoresOpcoes] = useState<any[]>([]);
  /** Itens exibindo a lista rápida em vez da pilha de cards. */
  const [emModoGrade, setEmModoGrade] = useState<Record<string, boolean>>({});
  const [numeracoesOpcoes, setNumeracoesOpcoes] = useState<any[]>([]);
  const [formatosOpcoes, setFormatosOpcoes] = useState<any[]>([]);
  const [deletingModelo, setDeletingModelo] = useState<PedidoModeloState | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});
  const [openModelos, setOpenModelos] = useState<Record<string, boolean>>({});
  // Arte ampliada: guarda os srcs já resolvidos pelo card, então abrir o modal
  // não refaz nenhuma consulta. `verso` só vem preenchido quando o modelo tem
  // verso_amostra_arte_base64 com conteúdo renderizável.
  const [arteAmpliada, setArteAmpliada] = useState<{
    frente: string;
    verso: string | null;
    nome: string;
  } | null>(null);

  useEffect(() => {
    if (!arteAmpliada) return;
    const fecharComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArteAmpliada(null);
    };
    window.addEventListener("keydown", fecharComEsc);
    return () => window.removeEventListener("keydown", fecharComEsc);
  }, [arteAmpliada]);


  const fetchOpcoes = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // producao_numeracoes.Cli_Num delimita o dono da numeração: nulo = numeração
    // geral, disponível como sempre foi; preenchido = exclusiva daquele cliente,
    // só entra no drop quando bate com propostas.id_cliente. Proposta sem cliente
    // definido (cliente não cadastrado) fica só com as gerais, porque nenhum
    // Cli_Num pode corresponder. Os demais filtros do drop (formato, cor) seguem
    // sendo aplicados adiante, em filteredNum.
    const numeracoesBase = supabase
      .from("producao_numeracoes")
      .select("id, name, formato_id, formato_ids, id_gabarito, tipo, ticket_qtd")
      .order("name", { ascending: true });
    const queryNumeracoes =
      Number.isInteger(idCliente) && (idCliente as number) > 0
        ? numeracoesBase.or(`Cli_Num.is.null,Cli_Num.eq.${idCliente}`)
        : numeracoesBase.is("Cli_Num", null);

    const [resFormatos, resCores, resNum] = await Promise.all([
      supabase.from("producao_formatos").select("id, name, id_formato_num"),
      supabase.from("producao_cores").select("id, name, formato_id, id_modelo_cor_num").order("id_modelo_cor_num", { ascending: true }),
      queryNumeracoes,
    ]);

    if (resFormatos.data) setFormatosOpcoes(resFormatos.data);
    if (resCores.data) setCoresOpcoes(resCores.data);
    if (resNum.data) setNumeracoesOpcoes(resNum.data);
  }, [idCliente]);

  // Recarrega quando o cliente da proposta muda — na edição o cliente pode ser
  // trocado sem sair da tela, e o drop precisa acompanhar.
  useEffect(() => {
    void fetchOpcoes();
  }, [fetchOpcoes]);

  // ─── Inline Actions ────────────────────────────────────────────────────────

  function startCreate(item: PropostaItem, maxQtd: number) {
    if (maxQtd <= 0) {
      showToast({ type: "error", title: "Ação bloqueada", description: "Não há saldo disponível para adicionar novo modelo." });
      return;
    }

    // Cor do papel e numerador vindos do cadastro do produto — mesma fonte
    // que a grade da Lista rápida usa. Passam pela regra do checklist: o que o
    // produto não imprime nasce null (nada de SEQUENCIAL a partir do numerador).
    const padroes = anularColunasEscondidas(
      padroesDeNovoLote(item.produto, coresOpcoes, numeracoesOpcoes),
      visivelDoItem(item)
    );

    const newId = novoModeloTempId();
    const newModel: PedidoModeloState = {
      tempId: newId,
      item_temp_id: item.id_produto_proposta_origem ? undefined : item.id,
      isPersisted: false,
      status_arte: STATUS_INICIAL_MODELO,
      status_producao: STATUS_INICIAL_MODELO,
      id_produto_proposta_origem: item.id_produto_proposta_origem || null,
      // No formulário simplificado o campo Modelo não aparece, mas
      // pedidos_modelos.nome_modelo é NOT NULL e o serviço exige o nome.
      // O padrão passa a ser o nome do produto — nada fica em branco e o
      // usuário não precisa preencher um campo que não vê.
      nome_modelo: formularioSimplificado ? item.nome || "" : "",
      padrao: padroes.padrao,
      quantidade: 0,
      tipo_numeracao: padroes.tipo_numeracao,
      numeracao_inicio: padroes.numeracao_inicio,
      numeracao_fim: null,
      verso_tipo: padroes.verso_tipo,
      bloco: padroes.bloco,
      gabarito_operacional: padroes.gabarito_operacional,
      // Texto consolidado das variações do item de origem (não do produto).
      variacoes_texto: formatVariacoesItem(item),
      Q_CAM: null,
      L_CAM: null,
      C_INI: null,
    };

    onModelosChange((prev) => [...prev, newModel]);
    setCollapsedItems((prev) => ({ ...prev, [item.id]: false }));
    setOpenModelos((prev) => ({ ...prev, [newId]: true }));
  }

  function startCopy(modelo: PedidoModeloState, item: PropostaItem) {
    const newId = novoModeloTempId();
    const newModel: PedidoModeloState = {
      // A cópia é lote NOVO: não leva valor em campo que o produto não imprime.
      ...anularColunasEscondidas(modelo, visivelDoItem(item)),
      id: undefined,
      tempId: newId,
      isPersisted: false,
      // A amostra pertence à linha original em pedidos_modelos; a cópia ainda
      // não existe no banco e não deve exibir a arte do outro modelo.
      amostra_arte_base64: null,
      verso_amostra_arte_base64: null,
      // A cópia é um modelo novo: entra no status inicial do fluxo. Herdar o
      // status do original fazia a duplicata de um modelo aprovado nascer
      // aprovada, sem nunca ter passado pela aprovação.
      status_arte: STATUS_INICIAL_MODELO,
      status_producao: STATUS_INICIAL_MODELO,
      // A ordem é atribuída na gravação; herdar a do original empilhava
      // duplicatas na mesma posição.
      ordem: undefined,
    };
    onModelosChange((prev) => [...prev, newModel]);
    setOpenModelos((prev) => ({ ...prev, [newId]: true }));
  }

  async function handleDeleteConfirm() {
    if (!deletingModelo) return;

    // Remove pela chave do modelo, não por id/tempId soltos: a mesma chave que
    // identifica o modelo na edição identifica ele aqui.
    const chave = modeloKey(deletingModelo);

    if (deletingModelo.isPersisted && deletingModelo.id) {
      const result = await excluirModelo(deletingModelo.id);
      if (result.success) {
        showToast({ type: "success", title: "Excluído", description: "Modelo removido com sucesso." });
        // Sem recarregar a lista: o filtro local já remove a linha excluída, e
        // o reload descartaria os modelos novos ainda não gravados.
        onModelosChange((prev) => prev.filter((m) => modeloKey(m) !== chave));
      } else {
        showToast({ type: "error", title: "Erro", description: result.errorMessage || "Falha ao excluir." });
      }
    } else {
      onModelosChange((prev) => prev.filter((m) => modeloKey(m) !== chave));
    }

    setDeleteConfirmOpen(false);
    setDeletingModelo(null);
  }

  // ─── Renders ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-teal-500"></div>
      </div>
    );
  }

  if (!itens || itens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Package className="mb-4 h-16 w-16 text-slate-300" />
        <h3 className="text-lg font-bold text-slate-700">Nenhum produto encontrado</h3>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          Você precisa adicionar produtos (blocos, cadernos, etc) na aba &quot;Produtos&quot; para depois configurar seus modelos de impressão (Artes/Lotes) aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-bold text-[#0b2f4a]">Boletim Técnico & Lotes</h2>
        <p className="text-sm text-slate-500">
          Distribua a quantidade de cada produto em modelos de impressão e defina regras de numeração/vias.
        </p>
      </div>

      <div className="space-y-6">
        {itens.map((item) => {
          const modelosDoItem = modelos.filter((m) => {
            if (m.id_produto_proposta_origem && item.id_produto_proposta_origem) {
              return m.id_produto_proposta_origem === item.id_produto_proposta_origem;
            }
            if (m.item_temp_id && item.id) {
              return m.item_temp_id === item.id;
            }
            return false;
          });
          
          const qtyUsed = modelosDoItem.reduce((acc, m) => acc + (m.quantidade || 0), 0);
          const saldo = (item.quantidade || 0) - qtyUsed;
          const isFull = saldo <= 0;

          return (
            <div key={item.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/50 p-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setCollapsedItems(prev => ({...prev, [item.id]: !prev[item.id]}))}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-100 text-teal-600 transition hover:bg-teal-200"
                  >
                    <ChevronDown className={`h-5 w-5 transition-transform ${collapsedItems[item.id] ? "-rotate-90" : ""}`} />
                  </button>
                  <div>
                    <h3 className="font-bold text-slate-800">{item.nome}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500">
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">Qtd: {item.quantidade}</span>
                      <span className={saldo > 0 ? "text-amber-600" : "text-teal-600"}>
                        {saldo > 0 ? `Restam: ${saldo}` : "Saldo distribuído 100%"}
                      </span>
                      {item.descricaoModelo && <span className="max-w-[200px] truncate">Ref: {item.descricaoModelo}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {/* Lista rápida: para o pedido de 12, 20, 30 lotes do mesmo
                      produto, onde os cards custam 4 idas ao servidor cada. */}
                  <button
                    onClick={() => setEmModoGrade((atual) => ({ ...atual, [item.id]: !atual[item.id] }))}
                    disabled={!autoSaveHabilitado}
                    title={
                      autoSaveHabilitado
                        ? "Digitar ou colar vários lotes de uma vez"
                        : "Proposta com cobrança: a lista rápida fica indisponível"
                    }
                    className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${
                      emModoGrade[item.id]
                        ? "bg-[#0b2f4a] text-white hover:bg-[#123f61]"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    <ListPlus className="h-4 w-4" />
                    Lista rápida
                  </button>
                  {!emModoGrade[item.id] && (
                    <button
                      onClick={() => startCreate(item, saldo)}
                      disabled={isFull}
                      className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Adicionar modelo
                    </button>
                  )}
                </div>
              </div>

              {!collapsedItems[item.id] && (
                <div className="p-5 space-y-4 bg-slate-50/30">
                {emModoGrade[item.id] ? (
                  (() => {
                    const numFormatId = item.produto?.id_formato;
                    const formatoObj = formatosOpcoes.find(
                      (f) => String(f.id_formato_num) === String(numFormatId) || String(f.id) === String(numFormatId)
                    );
                    const formatoUUID = formatoObj ? formatoObj.id : null;
                    const coresDoItem = formatoUUID
                      ? coresOpcoes.filter((c) => String(c.formato_id) === String(formatoUUID))
                      : [];
                    const idNoBanco = Number(item.id_produto_proposta_origem);

                    // Item ainda não gravado não tem onde pendurar os lotes: a
                    // grade grava direto no banco, pelo id da linha do item.
                    if (!Number.isFinite(idNoBanco) || idNoBanco <= 0) {
                      return (
                        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-6 text-center text-sm font-semibold text-amber-700">
                          Salve a proposta uma vez antes de montar os lotes deste produto.
                        </div>
                      );
                    }

                    return (
                      <LotesGrid
                        idInt={Number(idInt)}
                        // Por ele a grade le o checklist do boletim do produto.
                        idProduto={Number(item.id_produto) || null}
                        item={{
                          id_produto_proposta_origem: idNoBanco,
                          nome: item.nome,
                          quantidade: item.quantidade || 0
                        }}
                        itemPrateleira={isItemPrateleira(item)}
                        cores={coresDoItem}
                        numeracoes={numeracoesOpcoes}
                        // Os campos de cada lote sao os do card (`ModeloCampos`),
                        // com as mesmas listas: cores e numeradores completos,
                        // filtrados pelo formato do item dentro do componente.
                        coresOpcoes={coresOpcoes}
                        itemIdFormato={formatoUUID}
                        simplificado={formularioSimplificado}
                        autoSaveHabilitado={autoSaveHabilitado}
                        // Cores restritas ao formato do item, que e o que a grade
                        // oferece no dropdown: um padrao fora dessa lista viraria
                        // um valor selecionado que ninguem consegue ver.
                        padroes={padroesDeNovoLote(item.produto, coresDoItem, numeracoesOpcoes)}
                        linhasIniciais={modelosDoItem.map((m) => ({
                          id: m.isPersisted && m.id ? Number(m.id) : null,
                          nome_modelo: m.nome_modelo || "",
                          quantidade: m.quantidade || "",
                          padrao: m.padrao ?? null,
                          tipo_numeracao: m.tipo_numeracao ?? null,
                          numeracao_inicio: m.numeracao_inicio ?? null,
                          numeracao_fim: m.numeracao_fim ?? null,
                          verso_tipo: m.verso_tipo ?? null,
                          bloco: m.bloco ?? null,
                          gabarito_operacional: m.gabarito_operacional ?? null,
                          variacoes_texto: m.variacoes_texto ?? null,
                          Q_CAM: m.Q_CAM ?? null,
                          L_CAM: m.L_CAM ?? null,
                          C_INI: m.C_INI ?? null,
                          // Somente leitura na grade: alimentam a janela de amostra.
                          status_arte: m.status_arte,
                          amostra_arte_base64: m.amostra_arte_base64 ?? null,
                          verso_amostra_arte_base64: m.verso_amostra_arte_base64 ?? null
                        }))}
                        onAmpliarArte={setArteAmpliada}
                        onGravado={({ qtdItem, qtdAnterior, freteMensagem, lotes }) => {
                          // Espelha no estado o que o banco devolveu, COM os ids,
                          // SEM sair da grade (o auto-save grava a cada campo) e
                          // SEM perder a amostra da arte, que a rota nao devolve:
                          // o lote que ja existia no estado mantem os campos que
                          // a resposta nao traz. Sem os ids a tela ficava com a
                          // versao anterior e a gravacao seguinte inseria tudo de
                          // novo em vez de atualizar.
                          onModelosChange((prev) => {
                            const anteriores = new Map(
                              prev
                                .filter((m) => Number(m.id_produto_proposta_origem) === Number(idNoBanco) && m.id)
                                .map((m) => [Number(m.id), m] as const)
                            );
                            return [
                              ...prev.filter(
                                (m) => Number(m.id_produto_proposta_origem) !== Number(idNoBanco)
                              ),
                              ...lotes.map((l) => {
                                const linha = l as Record<string, unknown>;
                                const anterior = anteriores.get(Number(linha.id));
                                return {
                                  ...(anterior ?? {}),
                                  id: Number(linha.id),
                                  isPersisted: true,
                                  id_produto_proposta_origem: idNoBanco,
                                  nome_modelo: String(linha.nome_modelo ?? ""),
                                  padrao: (linha.padrao as string | null) ?? null,
                                  quantidade: Number(linha.quantidade) || 0,
                                  tipo_numeracao: (linha.tipo_numeracao as string | null) ?? null,
                                  numeracao_inicio:
                                    linha.numeracao_inicio == null ? null : Number(linha.numeracao_inicio),
                                  numeracao_fim:
                                    linha.numeracao_fim == null ? null : Number(linha.numeracao_fim),
                                  verso_tipo: (linha.verso_tipo as string | null) ?? null,
                                  bloco: (linha.bloco as string | null) ?? null,
                                  gabarito_operacional: (linha.gabarito_operacional as string | null) ?? null,
                                  Q_CAM: linha.Q_CAM == null ? null : Number(linha.Q_CAM),
                                  L_CAM: linha.L_CAM == null ? null : Number(linha.L_CAM),
                                  C_INI: linha.C_INI == null ? null : Number(linha.C_INI),
                                  status_arte: (linha.status_arte as string | undefined) ?? anterior?.status_arte,
                                  status_producao: (linha.status_producao as string | undefined) ?? anterior?.status_producao,
                                  variacoes_texto: (linha.variacoes_texto as string | null) ?? null,
                                  ordem: linha.ordem == null ? undefined : Number(linha.ordem)
                                } as PedidoModeloState;
                              })
                            ];
                          });
                          // A quantidade do item so muda no formulario quando mudou
                          // no banco: cor, bloco ou numerador nao mexem nela.
                          if (qtdItem !== qtdAnterior) onLotesGravados?.(idNoBanco, qtdItem, freteMensagem);
                        }}
                        onSair={() => setEmModoGrade((atual) => ({ ...atual, [item.id]: false }))}
                      />
                    );
                  })()
                ) : (
                <>
                {modelosDoItem.length === 0 && (
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 py-8 text-center bg-white">
                    <CheckCircle className="mb-2 h-8 w-8 text-slate-300" />
                    <p className="text-sm font-bold text-slate-600">Nenhum modelo configurado</p>
                    <p className="mt-1 text-xs text-slate-500">Clique em &quot;Adicionar modelo&quot; para configurar.</p>
                  </div>
                )}

                {modelosDoItem.map((m) => {
                  const numFormatId = item.produto?.id_formato;
                  const formatoObj = formatosOpcoes.find(f => String(f.id_formato_num) === String(numFormatId) || String(f.id) === String(numFormatId));
                  const realFormatoUUID = formatoObj ? formatoObj.id : null;
                  
                  const modId = m.tempId || String(m.id);
                  const isOpen = openModelos[modId];

                  if (isOpen) {
                    return (
                      <ModeloInlineCard
                        key={modId}
                        modelo={m}
                        maxQtd={saldo + (m.quantidade || 0)}
                        itemIdModeloCorNum={item.produto?.id_modelo_cor?.toString()}
                        itemIdFormato={realFormatoUUID}
                        produtoIdFormato={item.produto?.id_formato?.toString()}
                        coresOpcoes={coresOpcoes}
                        numeracoesOpcoes={numeracoesOpcoes}
                        formatosOpcoes={formatosOpcoes}
                        visivel={visivelDoItem(item)}
                        onRemove={() => {
                           setDeletingModelo(m);
                           setDeleteConfirmOpen(true);
                        }}
                        onClose={() => setOpenModelos((prev) => ({ ...prev, [modId]: false }))}
                        onUpdateParent={(partial) => {
                           // Patch sobre o estado corrente, atingindo só a linha
                           // desta chave. Antes o array era remontado a partir do
                           // `modelos` capturado no render, então uma resposta
                           // assíncrona (ou outro card editado em seguida)
                           // reescrevia por cima do que já havia mudado.
                           const chave = modeloKey(m);
                           if (!chave) return;
                           onModelosChange((prev) =>
                             prev.map((mod) => (modeloKey(mod) === chave ? { ...mod, ...partial } : mod))
                           );
                        }}
                        idInt={idInt}
                        autoSaveHabilitado={autoSaveHabilitado}
                        itemPrateleira={isItemPrateleira(item)}
                        simplificado={formularioSimplificado}
                      />
                    );
                  }

                  const arteAprovada = isArteAprovada(m.status_arte);
                  const itemPrateleira = isItemPrateleira(item);
                  const variacoesDoItem = resolverVariacoesTexto(m, item);

                  return (
                    <div
                      key={modId}
                      className={`relative rounded-2xl border p-5 shadow-sm transition ${
                        arteAprovada
                          ? "border-blue-400 bg-blue-50 hover:border-blue-500 dark:border-blue-500/60 dark:bg-blue-950/30"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="mb-3 pr-24">
                        <h4 className="text-base font-bold text-[#0b2f4a]">{m.nome_modelo || "Modelo sem nome"}</h4>
                        {/* O número do modelo saiu: é identificador interno e
                            competia com a informação que o usuário procura.
                            A quantidade fica no peso do título; cor e numerador
                            ficam em segundo plano. */}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="rounded bg-slate-100 px-2.5 py-1 text-base font-bold text-[#0b2f4a]">
                            Qtd: {m.quantidade}
                          </span>
                          {m.padrao && (
                            <span className="rounded bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-500">
                              Cor: {m.padrao}
                            </span>
                          )}
                          <span className="rounded bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-500">
                            Numerador: {m.gabarito_operacional || "-"}
                          </span>
                          {/* A faixa fecha a leitura do lote sem precisar abrir:
                              qual pedaço da numeração é este. Só aparece quando
                              o lote de fato tem numeração. */}
                          {m.tipo_numeracao !== "SEM_NUMERACAO" &&
                            (() => {
                              const faixa = rotuloFaixaExtenso(m.numeracao_inicio, m.numeracao_fim);
                              return faixa ? (
                                <span className="rounded bg-slate-100 px-2.5 py-1 text-sm font-medium text-slate-500 tabular-nums">
                                  {faixa}
                                </span>
                              ) : null;
                            })()}
                        </div>
                      </div>

                      {/* Variações do item ao qual este modelo pertence */}
                      {variacoesDoItem && (
                        <div className="mb-3">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Variações:</p>
                          <p className="mt-1 text-sm font-medium text-slate-700">{variacoesDoItem}</p>
                        </div>
                      )}

                      {/* Janela de amostra: a mesma da lista rapida (`AmostraDoModelo`). */}
                      <AmostraDoModelo modelo={m} itemPrateleira={itemPrateleira} modo="card" onAmpliar={setArteAmpliada} />

                      <div className="absolute right-4 top-4 flex gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setOpenModelos((prev) => ({ ...prev, [modId]: true }))}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-blue-500 transition hover:bg-blue-50 hover:text-blue-600"
                            title="Editar Modelo"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startCopy(m, item)}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                            title="Duplicar Modelo"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingModelo(m);
                              setDeleteConfirmOpen(true);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-red-400 transition hover:bg-red-50 hover:text-red-600"
                            title="Remover Modelo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                </>
                )}
              </div>
              )}
            </div>
          );
        })}
      </div>

      {deleteConfirmOpen && deletingModelo && (
        <div className="fixed inset-0 z-[99] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md scale-100 rounded-3xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-4 text-red-600">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100">
                <AlertOctagon className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold">Excluir modelo?</h3>
            </div>
            <p className="mb-6 text-sm text-slate-600">
              Deseja excluir este modelo? Esta ação removerá o modelo da proposta.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirmOpen(false)} className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-semibold text-slate-700 transition hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleDeleteConfirm} className="flex-1 rounded-2xl bg-red-600 px-4 py-3 font-semibold text-white transition hover:bg-red-700">
                Sim, excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Arte ampliada: ocupa quase toda a viewport para dar a ver o detalhe.
          Fecha no fundo, no X ou no Esc; o clique na imagem não fecha. */}
      {arteAmpliada && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm"
          onClick={() => setArteAmpliada(null)}
        >
          <button
            type="button"
            onClick={() => setArteAmpliada(null)}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 shadow-lg transition hover:bg-white"
            title="Fechar (Esc)"
            aria-label="Fechar arte ampliada"
          >
            <X className="h-5 w-5" />
          </button>
          {/* Frente e verso na mesma área de visualização: uma coluna, verso
              logo abaixo da frente. Cada imagem mantém a proporção original
              (object-contain, sem largura/altura forçadas) e a área rola
              quando as duas juntas passam da altura da tela. */}
          <div
            className="flex max-h-[92vh] w-full max-w-[95vw] flex-col items-center gap-5 overflow-y-auto py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <figure className="flex flex-col items-center gap-1.5">
              <figcaption className="text-[11px] font-bold uppercase tracking-wider text-white/80">
                Frente
              </figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={arteAmpliada.frente}
                alt={`Frente da arte do modelo ${arteAmpliada.nome}`}
                className={`max-w-[95vw] rounded-xl bg-white object-contain shadow-2xl ${
                  arteAmpliada.verso ? "max-h-[40vh]" : "max-h-[85vh]"
                }`}
              />
            </figure>

            {arteAmpliada.verso && (
              <figure className="flex flex-col items-center gap-1.5">
                <figcaption className="text-[11px] font-bold uppercase tracking-wider text-white/80">
                  Verso
                </figcaption>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={arteAmpliada.verso}
                  alt={`Verso da arte do modelo ${arteAmpliada.nome}`}
                  className="max-h-[40vh] max-w-[95vw] rounded-xl bg-white object-contain shadow-2xl"
                  onError={(e) => {
                    // Verso inacessível: some em vez de deixar imagem quebrada,
                    // sem afetar a exibição da frente.
                    e.currentTarget.parentElement?.style.setProperty("display", "none");
                  }}
                />
              </figure>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
