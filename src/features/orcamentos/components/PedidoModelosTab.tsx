"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Edit2, Trash2, Package, CheckCircle, Copy, AlertOctagon, ChevronDown, ListPlus, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { LotesGrid } from "@/features/orcamentos/components/LotesGrid";
import type { PedidoModeloRow, ModeloInput } from "@/features/orcamentos/services/pedidos-modelos.service";
import {
  buscarArquivoCorPapel,
  criarModelo,
  atualizarModeloParcial,
  excluirModelo,
} from "@/features/orcamentos/services/pedidos-modelos.service";
import { getSupabaseClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  formatVariacoesItem,
  isItemPrateleira,
  novoModeloTempId,
  propostaDispensaArte,
  STATUS_INICIAL_MODELO,
} from "@/features/orcamentos/orcamento-utils";
import { StatusBadge } from "@/components/common/StatusBadge";
import type { StatusTone } from "@/lib/types";
import type { PropostaItem, PedidoModeloState } from "@/features/orcamentos/types";
import {
  TIPO_CAMAROTE,
  TIPO_TICKET,
  normalizarTipoNumeracao,
  findNumeracaoByName,
  resolverMultiplicadorNumeracao,
  derivarCamposNumeracao,
  calcularQtdCamarote,
  parseNumeroOpcional,
} from "@/features/orcamentos/numeracao-modelo-utils";

// ─── Styles ──────────────────────────────────────────────────────────────────

const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition";
const labelClass = "text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1";

// ─── Arte do modelo ──────────────────────────────────────────────────────────

/**
 * Estados em que a arte conta como aprovada. Mesma lista usada pela engine de
 * status (status-engine.service.ts) — aqui só muda a apresentação do card,
 * a regra de aprovação continua sendo dela.
 */
const STATUS_ARTE_APROVADA = [
  "APROVADA",
  "APROVADO",
  "APROVADA_CLIENTE",
  "LIBERADA",
  "IMPRESSA",
  "NAO_NECESSARIA",
];

function isArteAprovada(status?: string): boolean {
  return !!status && STATUS_ARTE_APROVADA.includes(status.toUpperCase());
}

function getArteStatusTone(status?: string): StatusTone {
  const normalizado = (status || "PENDENTE").toUpperCase();
  if (isArteAprovada(normalizado)) return "success";
  if (normalizado === "REPROVADA_CLIENTE") return "danger";
  if (normalizado === "AGUARDANDO_CLIENTE" || normalizado === "AGUARDANDO") return "warning";
  if (normalizado === "EM_CRIACAO" || normalizado === "EM_REVISAO_INTERNA") return "info";
  return "neutral";
}

/**
 * Resolve o src exibível de pedidos_modelos.amostra_arte_base64.
 *
 * A coluna não guarda só base64: o gerador da OS
 * (api/pedidos/imprimir-os) já a trata como candidata a URL, fazendo fetch
 * quando não é data URI. Por isso os quatro casos abaixo. Retorna null quando
 * o conteúdo não é renderizável em <img> (PDF/vetor), para não exibir imagem
 * quebrada.
 */
function toImageSrc(valor: string): string | null {
  const bruto = valor.trim();
  if (!bruto) return null;

  // 1. Já é data URI — não duplicar o prefixo.
  if (bruto.startsWith("data:")) {
    return bruto.startsWith("data:image/") ? bruto : null;
  }

  // 2. URL absoluta ou protocolo-relativa.
  if (/^(https?:)?\/\//i.test(bruto)) {
    return /\.(pdf|ai|eps|cdr)(\?|$)/i.test(bruto) ? null : bruto;
  }

  // 3. Base64 puro: mime pela assinatura do conteúdo. Vem ANTES do caminho
  //    relativo porque base64 de JPEG começa com "/9j/".
  const base64 = bruto.replace(/\s/g, "");
  if (!base64) return null;

  if (base64.startsWith("JVBER")) return null; // %PDF — não renderiza em <img>
  if (base64.startsWith("/9j/")) return `data:image/jpeg;base64,${base64}`;
  if (base64.startsWith("iVBORw0KGgo")) return `data:image/png;base64,${base64}`;
  if (base64.startsWith("R0lGOD")) return `data:image/gif;base64,${base64}`;
  if (base64.startsWith("UklGR")) return `data:image/webp;base64,${base64}`;
  if (base64.startsWith("PHN2Zy") || base64.startsWith("PD94bW")) {
    return `data:image/svg+xml;base64,${base64}`;
  }

  // 4. Caminho do próprio site.
  if (bruto.startsWith("/")) {
    return /\.(pdf|ai|eps|cdr)(\?|$)/i.test(bruto) ? null : bruto;
  }

  // 5. Base64 sem assinatura reconhecida: assume PNG.
  return `data:image/png;base64,${base64}`;
}

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

// ─── Prévia da cor do papel (produto de prateleira) ──────────────────────────

/**
 * Classifica o conteúdo de producao_cores.pdf_base64.
 *
 * Apesar do nome, a coluna guarda hoje PDF (`data:application/pdf;base64,...`
 * em todas as linhas preenchidas), mas aceita qualquer conteúdo — por isso a
 * detecção é pelo que está lá, não pelo nome da coluna. Base64 puro (sem
 * prefixo Data URI) é identificado pela assinatura, igual ao toImageSrc.
 */
function classificarArquivoCor(valor: string): { tipo: "imagem" | "pdf"; mime: string; base64: string } | null {
  const bruto = valor.trim();
  if (!bruto) return null;

  if (bruto.startsWith("data:")) {
    // Sem a flag /s (o target de compilação não a aceita): [\s\S] cobre o
    // conteúdo inteiro, inclusive quebras de linha dentro do base64.
    const casamento = bruto.match(/^data:([^;]+);base64,([\s\S]*)$/);
    if (!casamento) return null;
    const [, mime, base64] = casamento;
    if (mime.startsWith("image/")) return { tipo: "imagem", mime, base64 };
    if (mime === "application/pdf") return { tipo: "pdf", mime, base64 };
    return null;
  }

  const base64 = bruto.replace(/\s/g, "");
  if (!base64) return null;
  if (base64.startsWith("JVBER")) return { tipo: "pdf", mime: "application/pdf", base64 };
  if (base64.startsWith("iVBORw0KGgo")) return { tipo: "imagem", mime: "image/png", base64 };
  if (base64.startsWith("/9j/")) return { tipo: "imagem", mime: "image/jpeg", base64 };
  if (base64.startsWith("R0lGOD")) return { tipo: "imagem", mime: "image/gif", base64 };
  if (base64.startsWith("UklGR")) return { tipo: "imagem", mime: "image/webp", base64 };
  return null;
}

/** Blob URL a partir do base64 — `data:application/pdf` não renderiza em frame. */
function base64ParaBlobUrl(base64: string, mime: string): string | null {
  try {
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch (err) {
    console.error("[PedidoModelos] base64 da cor inválido:", err);
    return null;
  }
}

/**
 * Prévia do papel da cor selecionada, exibida apenas em item de prateleira.
 *
 * A imagem continua vindo de producao_cores a cada consulta — nada é copiado
 * para pedidos_modelos. Sem conteúdo, ou com conteúdo não renderizável, não
 * desenha nada: nem imagem quebrada, nem placeholder.
 */
function PreviaCorPapel({ nomeCor }: { nomeCor: string | null | undefined }) {
  const [arquivo, setArquivo] = useState<{
    tipo: "imagem" | "pdf";
    src: string;
    /** Proporção da página (mm), quando o cadastro informa. */
    proporcao: number | null;
  } | null>(null);

  // O componente é remontado a cada cor (key no uso), então o estado já começa
  // vazio — não há reset a fazer aqui dentro.
  useEffect(() => {
    let ativo = true;
    let urlCriada: string | null = null;

    const cor = nomeCor?.trim();
    if (!cor) return;

    // Sem visualizador de PDF (navegador móvel, WebView, ambiente sem plugin) o
    // <embed> desenharia uma caixa de erro. Melhor não mostrar nada do que
    // mostrar "Couldn't load plugin". Imagem não depende disso.
    const suportaPdf = typeof navigator !== "undefined" && navigator.pdfViewerEnabled !== false;

    void buscarArquivoCorPapel(cor).then((arq) => {
      if (!ativo || !arq) return;
      const classificado = classificarArquivoCor(arq.conteudo);
      if (!classificado) return;

      const proporcao =
        arq.larguraMm && arq.alturaMm && arq.alturaMm > 0 ? arq.larguraMm / arq.alturaMm : null;

      if (classificado.tipo === "imagem") {
        setArquivo({
          tipo: "imagem",
          src: `data:${classificado.mime};base64,${classificado.base64}`,
          proporcao,
        });
        return;
      }
      if (!suportaPdf) return;
      urlCriada = base64ParaBlobUrl(classificado.base64, classificado.mime);
      if (urlCriada) setArquivo({ tipo: "pdf", src: urlCriada, proporcao });
    });

    return () => {
      ativo = false;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
  }, [nomeCor]);

  if (!arquivo) return null;

  return (
    <div className="mt-4 border-t border-teal-100 pt-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Papel · {nomeCor}
      </p>
      {arquivo.tipo === "imagem" ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={arquivo.src}
          alt={`Papel ${nomeCor}`}
          className="block h-auto max-h-[300px] w-auto max-w-full rounded-xl border border-slate-200 bg-white object-contain sm:max-w-[630px]"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      ) : (
        // PDF: a caixa recebe a proporção real da página (producao_cores
        // width_mm × height_mm) e o visualizador ajusta à largura. Sem isso
        // sobrava o fundo escuro do visualizador — as pulseiras são tiras de
        // 245×20 mm (12,25:1) dentro de uma caixa quase quadrada.
        // Sem dimensões cadastradas, cai numa altura fixa.
        <div
          className="w-full max-w-[630px] overflow-hidden rounded-xl border border-slate-200 bg-white"
          style={
            arquivo.proporcao
              ? { aspectRatio: String(arquivo.proporcao), maxHeight: 300 }
              : { height: 300 }
          }
        >
          {/* O visualizador desenha a página sobre um fundo escuro próprio, que
              nenhum CSS externo alcança. Ampliar o embed e cortar no contêiner
              (overflow-hidden) joga essa moldura para fora da área visível —
              inclusive a barra de rolagem, que `scrollbar=0` não remove. */}
          <embed
            src={`${arquivo.src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            type="application/pdf"
            className="block h-[calc(100%+12px)] w-[calc(100%+28px)] -ml-[6px] -mt-[6px]"
          />
        </div>
      )}
    </div>
  );
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
 * Mínimo para o modelo novo virar linha no banco — os três campos marcados com
 * asterisco no formulário. Enquanto não estiverem preenchidos o modelo vive só
 * no estado local; nada é gravado pela metade.
 */
function temDadosMinimos(mod: PedidoModeloState, idInt?: number): boolean {
  return Boolean(
    idInt &&
    mod.id_produto_proposta_origem &&
    mod.nome_modelo?.trim() &&
    mod.padrao?.trim() &&
    mod.quantidade > 0
  );
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
  onRemove: () => void;
  onClose: () => void;
  onUpdateParent: (partial: Partial<PedidoModeloState>) => void;
}) {
  const isNew = !modelo.isPersisted;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);
  const isCustomInit = modelo.bloco ? !["10", "15", "20", "25", "40", "50", "75", "100"].includes(modelo.bloco) : false;
  const [showCustomBloco, setShowCustomBloco] = useState(isCustomInit);

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
      if (!temDadosMinimos(mod, idInt)) {
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
      }).catch((e) => ({ success: false as const, data: undefined, errorMessage: String(e?.message || e) }));

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

      const res = await atualizarModeloParcial(mod.id, montarPayloadParcial(mod, campos))
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
    if (!isNew || !temDadosMinimos(modelo, idInt)) return;
    // Só a primeira vez: depois quem agenda é o handleChange.
    criacaoInicialRef.current = true;
    agendarSave(false);
  }, [isNew, modelo, idInt]);

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

  const filteredCores = hasConfig ? coresOpcoes.filter((c) => {
    return String(c.formato_id) === String(itemIdFormato);
  }) : [];

  const corSelecionada = modelo.padrao ? coresOpcoes.find((c) => c.name === modelo.padrao) : null;
  const formatoReferencia = corSelecionada?.formato_id ? String(corSelecionada.formato_id) : String(itemIdFormato);

  const filteredNum = (formatoReferencia && numeracoesOpcoes) ? numeracoesOpcoes.filter((n) => {
    if (String(n.formato_id) === formatoReferencia) return true;
    if (Array.isArray(n.formato_ids) && n.formato_ids.some((id: any) => String(id) === formatoReferencia)) return true;
    return false;
  }) : [];

  // Numerador selecionado (busca na lista completa: o gravado pode estar fora do filtro por formato)
  const numeracaoSelecionada = findNumeracaoByName(numeracoesOpcoes, modelo.gabarito_operacional);
  const tipoNumeracaoSelecionada = normalizarTipoNumeracao(numeracaoSelecionada?.tipo);
  const isCamarote = tipoNumeracaoSelecionada === TIPO_CAMAROTE;
  const isTicket = tipoNumeracaoSelecionada === TIPO_TICKET;
  const qtdCamaroteCalculada = calcularQtdCamarote(modelo.Q_CAM, modelo.L_CAM);
  const { multiplicador: ticketMultiplicador, erro: erroTicket } = isTicket
    ? resolverMultiplicadorNumeracao(numeracaoSelecionada)
    : { multiplicador: 1, erro: null };

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
              : isNew && !temDadosMinimos(modelo, idInt)
                ? simplificado
                  ? "Preencha Qtd e Cor do papel — a gravação é automática a partir daí."
                  : "Preencha Modelo, Qtd e Cor do papel — a gravação é automática a partir daí."
                : "As alterações são gravadas automaticamente."}
        </p>
      )}

      <div className="flex flex-wrap xl:flex-nowrap xl:items-end gap-3">
        {!simplificado && (
          <div className="flex-[2] min-w-[110px]">
            <label className={labelClass}>Modelo *</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Ex: Talão"
              value={modelo.nome_modelo}
              onChange={(e) => handleChange({ nome_modelo: e.target.value })}
              onBlur={flushSave}
            />
          </div>
        )}

        <div className={cn("flex-[0.8] min-w-[60px]", simplificado && "order-2")}>
          <label className={labelClass}>Qtd *</label>
          <input
            type="number"
            className={isCamarote ? `${inputClass} bg-slate-50` : inputClass}
            value={modelo.quantidade || ""}
            readOnly={isCamarote}
            title={isCamarote ? "Calculado automaticamente: Q CAM × L CAM" : undefined}
            placeholder={isCamarote ? "Auto" : undefined}
            onChange={(e) => {
              if (isCamarote) return;
              const val = Number(e.target.value);
              if (!isNaN(val)) {
                handleChange({ quantidade: Math.min(val, maxQtd) });
              }
            }}
            onBlur={flushSave}
          />
        </div>

        {isCamarote && (
          <>
            <div className="flex-[0.8] min-w-[70px]">
              <label className={labelClass}>Q CAM *</label>
              <input
                type="number"
                min={1}
                className={inputClass}
                placeholder="Ex: 10"
                title="Quantidade total de camarotes"
                value={modelo.Q_CAM ?? ""}
                onChange={(e) => handleChange({ Q_CAM: parseNumeroOpcional(e.target.value) })}
                onBlur={flushSave}
              />
            </div>

            <div className="flex-[0.8] min-w-[70px]">
              <label className={labelClass}>L CAM *</label>
              <input
                type="number"
                min={1}
                className={inputClass}
                placeholder="Ex: 8"
                title="Lugares por camarote"
                value={modelo.L_CAM ?? ""}
                onChange={(e) => handleChange({ L_CAM: parseNumeroOpcional(e.target.value) })}
                onBlur={flushSave}
              />
            </div>

            <div className="flex-[0.8] min-w-[70px]">
              <label className={labelClass}>C INI</label>
              <input
                type="number"
                className={inputClass}
                placeholder="Ex: 1"
                title="Número inicial do camarote"
                value={modelo.C_INI ?? ""}
                onChange={(e) => handleChange({ C_INI: parseNumeroOpcional(e.target.value) })}
                onBlur={flushSave}
              />
            </div>
          </>
        )}

        {!simplificado && (
          <>
            <div className="flex-[0.8] min-w-[70px]">
              <label className={labelClass}>Nº Inicial</label>
              <input
                type="number"
                className={inputClass}
                placeholder="Ex: 1"
                value={modelo.numeracao_inicio ?? ""}
                onChange={(e) => handleChange({ numeracao_inicio: Number(e.target.value) || null })}
                onBlur={flushSave}
              />
            </div>

            <div className="flex-[0.8] min-w-[70px]">
              <label className={labelClass}>Nº Final</label>
              <input
                type="number"
                className={`${inputClass} bg-slate-50`}
                placeholder="Auto"
                value={modelo.numeracao_fim ?? ""}
                readOnly
              />
            </div>
          </>
        )}

        <div className={cn("flex-[1.5] min-w-[100px]", simplificado && "order-1")}>
          <label className={labelClass}>Cor papel *</label>
            <select
              className={inputClass}
              value={modelo.padrao || ""}
              onChange={(e) => handleChange({ padrao: e.target.value }, true)}
              disabled={!hasConfig}
            >
              {!hasConfig ? (
                <option value="">Sem formato</option>
              ) : (
              <>
                <option value="">Selecione...</option>
                {filteredCores.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </>
              )}
            </select>
        </div>

        {!simplificado && (
          <div className="flex-[1.2] min-w-[90px]">
            <label className={labelClass}>Bloco</label>
            {showCustomBloco ? (
              <div className="flex gap-1">
                <input
                  type="text"
                  className={inputClass}
                  placeholder="Ex: 50x2"
                  value={modelo.bloco || ""}
                  onChange={(e) => handleChange({ bloco: e.target.value || null })}
                  onBlur={flushSave}
                />
                <button 
                  type="button" 
                  onClick={() => {
                    setShowCustomBloco(false);
                    handleChange({ bloco: null }, true);
                  }}
                  className="rounded-xl border border-slate-200 bg-white px-2 py-2 text-slate-500 hover:bg-slate-50"
                  title="Voltar para opções fixas"
                >
                  X
                </button>
              </div>
            ) : (
              <select
                className={inputClass}
                value={modelo.bloco || ""}
                onChange={(e) => {
                  if (e.target.value === "Outro") {
                    setShowCustomBloco(true);
                    handleChange({ bloco: null }, true);
                  } else {
                    handleChange({ bloco: e.target.value || null }, true);
                  }
                }}
              >
                <option value="">Nenhum</option>
                <option value="10">10</option>
                <option value="15">15</option>
                <option value="20">20</option>
                <option value="25">25</option>
                <option value="40">40</option>
                <option value="50">50</option>
                <option value="75">75</option>
                <option value="100">100</option>
                <option value="Outro">Outro</option>
              </select>
            )}
          </div>
        )}

        <div className={cn("flex-[1.2] min-w-[100px]", simplificado && "order-3")}>
          <label className={labelClass}>Verso</label>
          <select
            className={inputClass}
            value={modelo.verso_tipo || ""}
            onChange={(e) => handleChange({ verso_tipo: e.target.value }, true)}
          >
            <option value="SÓ FRENTE">SÓ FRENTE</option>
            <option value="FRENTE E VERSO">FRENTE E VERSO</option>
            <option value="VERSO FIXO">VERSO FIXO</option>
            <option value="VERSO VARIÁVEL">VERSO VARIÁVEL</option>
          </select>
        </div>

        <div className={cn("flex-[1.5] min-w-[100px]", simplificado && "order-4")}>
          <label className={labelClass}>Numerador</label>
          <select
            className={inputClass}
            value={modelo.gabarito_operacional || ""}
            onChange={(e) => {
              const val = e.target.value;
              handleChange({ gabarito_operacional: val || null, tipo_numeracao: "SEQUENCIAL" }, true);
            }}
            disabled={!hasConfig}
          >
            {!hasConfig ? (
              <option value="">Sem formato</option>
            ) : (
              <>
                <option value="">Selecione...</option>
                {filteredNum.map((n) => (
                  <option key={n.id} value={n.name}>{n.name}</option>
                ))}
              </>
            )}
          </select>
        </div>
      </div>

      {isCamarote && (
        <p className={`mt-3 text-[11px] font-semibold ${qtdCamaroteCalculada !== null && qtdCamaroteCalculada > maxQtd ? "text-red-600" : "text-slate-500"}`}>
          Numerador tipo Camarote: QTD = Q CAM × L CAM
          {qtdCamaroteCalculada !== null
            ? ` = ${qtdCamaroteCalculada}${qtdCamaroteCalculada > maxQtd ? ` — excede o saldo disponível do item (${maxQtd})` : ""}`
            : " — preencha Q CAM e L CAM"}
        </p>
      )}

      {isTicket && (
        erroTicket ? (
          <p className="mt-3 text-[11px] font-bold text-red-600">{erroTicket}</p>
        ) : (
          <p className="mt-3 text-[11px] font-semibold text-slate-500">
            Numerador tipo Ticket ({ticketMultiplicador} numerações por unidade): Nº Final = Nº Inicial + (QTD × {ticketMultiplicador}) − 1
          </p>
        )
      )}

      {/* Produto de prateleira: papel da cor escolhida, direto de producao_cores.
          Troca de cor troca a prévia porque a chave é o próprio `padrao`. */}
      {itemPrateleira && <PreviaCorPapel key={modelo.padrao || "sem-cor"} nomeCor={modelo.padrao} />}
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

    // Default de Cor do papel (padrao) vindo do cadastro do produto
    const defaultCor = coresOpcoes.find(c => 
      item.produto?.id_modelo_cor && String(c.id_modelo_cor_num) === String(item.produto.id_modelo_cor)
    );
    const defaultCorName = defaultCor ? defaultCor.name : null;

    // Default de Numerador (gabarito_operacional) vindo de id_gabarito do produto
    const defaultNum = numeracoesOpcoes.find((n) => 
      item.produto?.id_gabarito && String(n.id_gabarito) === String(item.produto.id_gabarito)
    );
    const defaultNumName = defaultNum ? defaultNum.name : null;

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
      padrao: defaultCorName || null,
      quantidade: 0,
      tipo_numeracao: defaultNumName ? "SEQUENCIAL" : "SEM_NUMERACAO",
      numeracao_inicio: defaultNumName ? 1 : null,
      numeracao_fim: null,
      verso_tipo: "SÓ FRENTE",
      bloco: "50",
      gabarito_operacional: defaultNumName || null,
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

  function startCopy(modelo: PedidoModeloState) {
    const newId = novoModeloTempId();
    const newModel: PedidoModeloState = {
      ...modelo,
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
                        item={{
                          id_produto_proposta_origem: idNoBanco,
                          nome: item.nome,
                          quantidade: item.quantidade || 0
                        }}
                        cores={coresDoItem}
                        numeracoes={numeracoesOpcoes}
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
                          variacoes_texto: m.variacoes_texto ?? null
                        }))}
                        onGravado={({ qtdItem, freteMensagem, lotes }) => {
                          // Troca os lotes deste item pelo que o banco devolveu,
                          // COM os ids. Sem isso a tela ficava com a versao
                          // anterior e o "Fechar lote" seguinte inseria tudo de
                          // novo em vez de atualizar.
                          onModelosChange((prev) => [
                            ...prev.filter(
                              (m) => Number(m.id_produto_proposta_origem) !== Number(idNoBanco)
                            ),
                            ...lotes.map((l) => {
                              const linha = l as Record<string, unknown>;
                              return {
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
                                status_arte: (linha.status_arte as string | undefined) ?? undefined,
                                status_producao: (linha.status_producao as string | undefined) ?? undefined,
                                variacoes_texto: (linha.variacoes_texto as string | null) ?? null,
                                ordem: linha.ordem == null ? undefined : Number(linha.ordem)
                              } as PedidoModeloState;
                            })
                          ]);
                          onLotesGravados?.(idNoBanco, qtdItem, freteMensagem);
                          setEmModoGrade((atual) => ({ ...atual, [item.id]: false }));
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
                  const arteSrc = m.amostra_arte_base64 ? toImageSrc(m.amostra_arte_base64) : null;
                  // Verso resolvido pelo mesmo tratamento da frente (data URI,
                  // URL ou base64 puro). Null quando a coluna está vazia ou o
                  // conteúdo não é renderizável em <img>.
                  const versoSrc = m.verso_amostra_arte_base64 ? toImageSrc(m.verso_amostra_arte_base64) : null;
                  const abrirArte = () =>
                    arteSrc && setArteAmpliada({ frente: arteSrc, verso: versoSrc, nome: m.nome_modelo || "" });

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
                        </div>
                      </div>

                      {/* Variações do item ao qual este modelo pertence */}
                      {variacoesDoItem && (
                        <div className="mb-3">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Variações:</p>
                          <p className="mt-1 text-sm font-medium text-slate-700">{variacoesDoItem}</p>
                        </div>
                      )}

                      {/* Status da arte + amostra renderizada (quando existir).
                          Produto de prateleira é vendido pronto e não passa pelo
                          fluxo de arte — mostrar "Arte: PENDENTE" ali seria uma
                          pendência que não existe. */}
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        {!itemPrateleira && (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Arte:</span>
                            <StatusBadge
                              status={m.status_arte || "PENDENTE"}
                              tone={getArteStatusTone(m.status_arte)}
                            />
                          </div>
                        )}
                        {arteSrc ? (
                          // Prévia sem caixa: a borda abraça a própria imagem. Com
                          // largura e altura automáticas, o navegador respeita a
                          // proporção original e para no primeiro limite atingido —
                          // 90% da largura / 200px de altura no mobile, 70% / 260px
                          // de tablet para cima (md). Sem object-fit: as dimensões
                          // são intrínsecas, então não há como esticar nem cortar.
                          // Verso, quando existir, entra logo abaixo da frente com
                          // as mesmas regras. Clique (ou Enter/Espaço) em qualquer
                          // uma abre a arte ampliada com as duas.
                          <div className="mt-3 space-y-2">
                            {[
                              { src: arteSrc, lado: "Frente" as const },
                              ...(versoSrc ? [{ src: versoSrc, lado: "Verso" as const }] : []),
                            ].map(({ src, lado }) => (
                              <div key={lado}>
                                {/* Rótulo só quando há os dois lados: com uma
                                    imagem só ele não acrescenta informação. */}
                                {versoSrc && (
                                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    {lado}
                                  </p>
                                )}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={src}
                                  alt={`${lado} da arte do modelo ${m.nome_modelo || ""}`}
                                  className="block h-auto max-h-[200px] w-auto max-w-[90%] cursor-zoom-in rounded-xl border border-slate-200 bg-white transition hover:border-blue-400 md:max-h-[260px] md:max-w-[70%]"
                                  loading="lazy"
                                  role="button"
                                  tabIndex={0}
                                  title="Clique para ampliar"
                                  onClick={abrirArte}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      abrirArte();
                                    }
                                  }}
                                  onError={(e) => {
                                    // Conteúdo inválido/inacessível: esconde a imagem
                                    // e o rótulo dela, sem afetar o outro lado.
                                    e.currentTarget.parentElement?.style.setProperty("display", "none");
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>

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
                            onClick={() => startCopy(m)}
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
