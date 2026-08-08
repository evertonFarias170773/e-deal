"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Plus, Edit2, Trash2, Package, CheckCircle, Copy, AlertOctagon, ChevronDown, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import type { PedidoModeloRow, ModeloInput } from "@/features/orcamentos/services/pedidos-modelos.service";
import {
  criarModelo,
  atualizarModeloParcial,
  excluirModelo,
} from "@/features/orcamentos/services/pedidos-modelos.service";
import { getSupabaseClient } from "@/lib/supabase/client";
import { formatVariacoesItem } from "@/features/orcamentos/orcamento-utils";
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
  onRemove,
  onClose,
  onUpdateParent,
  onReloadModelos,
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
  onRemove: () => void;
  onClose: () => void;
  onUpdateParent: (partial: Partial<PedidoModeloState>) => void;
  onReloadModelos?: () => void;
}) {
  const { showToast } = useAppToast();
  const isNew = !modelo.isPersisted;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const isCustomInit = modelo.bloco ? !["10", "15", "20", "25", "40", "50", "75", "100"].includes(modelo.bloco) : false;
  const [showCustomBloco, setShowCustomBloco] = useState(isCustomInit);

  // Mantém uma referência sempre atualizada do modelo para o onBlur ler os dados mais frescos
  const latestModelo = useRef(modelo);
  useEffect(() => {
    latestModelo.current = modelo;
  }, [modelo]);

  // Default numeracao_inicio to 1 if new and not set
  useEffect(() => {
    if (isNew && modelo.numeracao_inicio == null) {
      onUpdateParent({ numeracao_inicio: 1 });
    }
  }, [isNew, modelo.numeracao_inicio, onUpdateParent]);

  const handleChange = (partial: Partial<PedidoModeloState>) => {
    const atual = latestModelo.current;

    // QTD (tipo CAMAROTE) e Nº Final (NI + QTD × ticket_qtd - 1 no tipo TICKET)
    // são derivados de forma síncrona a partir do numerador em vigor.
    const derivados = derivarCamposNumeracao(atual, partial, numeracoesOpcoes);
    const updated: Partial<PedidoModeloState> = { ...partial, ...derivados };

    // Atualiza a ref imediatamente para o onBlur capturar caso dispare antes do render
    latestModelo.current = { ...atual, ...updated };
    onUpdateParent(updated);
  };

  const handleSaveModelo = () => {
    const mod = latestModelo.current;
    if (!mod.quantidade || mod.quantidade <= 0) {
      showToast({ type: "warning", title: "Atenção", description: "A quantidade deve ser maior que zero para salvar." });
      return;
    }

    const numeracaoSel = findNumeracaoByName(numeracoesOpcoes, mod.gabarito_operacional);
    const tipoSel = normalizarTipoNumeracao(numeracaoSel?.tipo);

    if (tipoSel === TIPO_CAMAROTE) {
      const qtdCamarote = calcularQtdCamarote(mod.Q_CAM, mod.L_CAM);
      if (qtdCamarote === null) {
        showToast({ type: "warning", title: "Atenção", description: "Informe Q CAM e L CAM (maiores que zero) para numerador do tipo Camarote." });
        return;
      }
      if (Number(mod.quantidade) !== qtdCamarote) {
        showToast({ type: "warning", title: "Atenção", description: `A QTD (${mod.quantidade}) deve ser igual a Q CAM × L CAM (${qtdCamarote}).` });
        return;
      }
      // A QTD do camarote é calculada, não digitada: não passa pelo clamp do input
      if (qtdCamarote > maxQtd) {
        showToast({ type: "warning", title: "Atenção", description: `A QTD calculada (${qtdCamarote}) excede o saldo disponível do item (${maxQtd}).` });
        return;
      }
    }

    if (tipoSel === TIPO_TICKET) {
      const { erro } = resolverMultiplicadorNumeracao(numeracaoSel);
      if (erro) {
        showToast({ type: "error", title: "Numerador inválido", description: erro });
        return;
      }
    }

    if (isNew) {
      if (!mod.nome_modelo) return; // Não salva modelo vazio
      if (!idInt || !mod.id_produto_proposta_origem) {
        showToast({ type: "warning", title: "Atenção", description: "Salve o orçamento principal antes de configurar modelos persistentes." });
        return;
      }

      setSaveStatus("saving");
      criarModelo({
         id_int: idInt,
         id_produto_proposta_origem: mod.id_produto_proposta_origem,
         nome_modelo: mod.nome_modelo,
         padrao: mod.padrao || null,
         quantidade: mod.quantidade,
         tipo_numeracao: "SEQUENCIAL",
         numeracao_inicio: mod.numeracao_inicio || null,
         numeracao_fim: mod.numeracao_fim || null,
         verso_tipo: mod.verso_tipo || null,
         bloco: mod.bloco || null,
         gabarito_operacional: mod.gabarito_operacional || null,
         Q_CAM: mod.Q_CAM ?? null,
         L_CAM: mod.L_CAM ?? null,
         C_INI: mod.C_INI ?? null,
      }).then(res => {
         if (res.success && res.data) {
           setSaveStatus("saved");
           onUpdateParent({ id: res.data.id, isPersisted: true });
           setTimeout(() => setSaveStatus("idle"), 2000);
           // Mantemos o reload ao criar para puxar datas e IDs defaults caso existam
           if (onReloadModelos) onReloadModelos();
         } else {
           setSaveStatus("error");
           showToast({ type: "error", title: "Erro", description: res.errorMessage || "Falha ao criar modelo" });
         }
      });
    } else {
      const draftId = mod.id;
      if (draftId && draftId > 0) {
         setSaveStatus("saving");
         atualizarModeloParcial(draftId, {
           nome_modelo: mod.nome_modelo,
           padrao: mod.padrao || null,
           quantidade: mod.quantidade,
           tipo_numeracao: "SEQUENCIAL",
           numeracao_inicio: mod.numeracao_inicio || null,
           numeracao_fim: mod.numeracao_fim || null,
           verso_tipo: mod.verso_tipo || null,
           bloco: mod.bloco || null,
           gabarito_operacional: mod.gabarito_operacional || null,
           Q_CAM: mod.Q_CAM ?? null,
           L_CAM: mod.L_CAM ?? null,
           C_INI: mod.C_INI ?? null,
         }).then(res => {
           if(res.success) {
             setSaveStatus("saved");
             setTimeout(() => setSaveStatus("idle"), 2000);
             // Sem reload automático aqui para evitar race conditions com edições locais
           } else {
             setSaveStatus("error");
           }
         });
      }
    }
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
          {!isNew && (
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
              {saveStatus === "idle" && <span className="flex h-2 w-2 rounded-full bg-slate-300" title="Sem alterações pendentes"></span>}
              {saveStatus === "saving" && <span className="text-amber-600">Salvando...</span>}
              {saveStatus === "saved" && <span className="text-teal-600">Salvo</span>}
              {saveStatus === "error" && <span className="text-red-500">Erro ao salvar</span>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
          >
            Fechar
          </button>
          <button
            onClick={handleSaveModelo}
            disabled={saveStatus === "saving"}
            className="flex items-center gap-2 rounded-xl border border-teal-500 bg-teal-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-teal-700 disabled:opacity-50"
          >
            {saveStatus === "saving" ? "Salvando..." : "Salvar modelo"}
          </button>
          <button
            onClick={onRemove}
            className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-600 transition hover:bg-red-100"
          >
            {isNew ? "Cancelar" : "Remover"}
          </button>
        </div>
      </div>
      
      <p className="mb-4 text-[11px] font-medium text-amber-600">
        Alterações neste modelo só são gravadas ao clicar em &quot;Salvar modelo&quot;.
      </p>

      <div className="flex flex-wrap xl:flex-nowrap xl:items-end gap-3">
        <div className="flex-[2] min-w-[110px]">
          <label className={labelClass}>Modelo *</label>
          <input
            type="text"
            className={inputClass}
            placeholder="Ex: Talão"
            value={modelo.nome_modelo}
            onChange={(e) => handleChange({ nome_modelo: e.target.value })}
          />
        </div>

        <div className="flex-[0.8] min-w-[60px]">
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
              />
            </div>
          </>
        )}

        <div className="flex-[0.8] min-w-[70px]">
          <label className={labelClass}>Nº Inicial</label>
          <input
            type="number"
            className={inputClass}
            placeholder="Ex: 1"
            value={modelo.numeracao_inicio ?? ""}
            onChange={(e) => handleChange({ numeracao_inicio: Number(e.target.value) || null })}
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

        <div className="flex-[1.5] min-w-[100px]">
          <label className={labelClass}>Cor papel *</label>
            <select
              className={inputClass}
              value={modelo.padrao || ""}
              onChange={(e) => handleChange({ padrao: e.target.value })}
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
              />
              <button 
                type="button" 
                onClick={() => {
                  setShowCustomBloco(false);
                  handleChange({ bloco: null });
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
                  handleChange({ bloco: null });
                } else {
                  handleChange({ bloco: e.target.value || null });
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

        <div className="flex-[1.2] min-w-[100px]">
          <label className={labelClass}>Verso</label>
          <select
            className={inputClass}
            value={modelo.verso_tipo || ""}
            onChange={(e) => handleChange({ verso_tipo: e.target.value })}
          >
            <option value="SÓ FRENTE">SÓ FRENTE</option>
            <option value="FRENTE E VERSO">FRENTE E VERSO</option>
            <option value="VERSO FIXO">VERSO FIXO</option>
            <option value="VERSO VARIÁVEL">VERSO VARIÁVEL</option>
          </select>
        </div>

        <div className="flex-[1.5] min-w-[100px]">
          <label className={labelClass}>Numerador</label>
          <select
            className={inputClass}
            value={modelo.gabarito_operacional || ""}
            onChange={(e) => {
              const val = e.target.value;
              handleChange({ gabarito_operacional: val || null, tipo_numeracao: "SEQUENCIAL" });
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
    </div>
  );
}

export function PedidoModelosTab({
  idInt,
  idCliente,
  itens,
  modelos,
  onModelosChange,
  onReloadModelos,
}: {
  idInt?: number;
  /** propostas.id_cliente — filtra as numerações exclusivas de cliente. */
  idCliente?: number;
  itens: PropostaItem[];
  modelos: PedidoModeloState[];
  onModelosChange: (m: PedidoModeloState[]) => void;
  onReloadModelos?: () => void;
}) {
  const { showToast } = useAppToast();
  const [loading, setLoading] = useState(false);
  const [coresOpcoes, setCoresOpcoes] = useState<any[]>([]);
  const [numeracoesOpcoes, setNumeracoesOpcoes] = useState<any[]>([]);
  const [formatosOpcoes, setFormatosOpcoes] = useState<any[]>([]);
  const [deletingModelo, setDeletingModelo] = useState<PedidoModeloState | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [collapsedItems, setCollapsedItems] = useState<Record<string, boolean>>({});
  const [openModelos, setOpenModelos] = useState<Record<string, boolean>>({});
  // Arte ampliada: guarda o src já resolvido pelo card, então abrir o modal não
  // refaz nenhuma consulta — é a mesma imagem, sem limite de tamanho.
  const [arteAmpliada, setArteAmpliada] = useState<{ src: string; nome: string } | null>(null);

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

    const newId = `new_${Date.now()}`;
    const newModel: PedidoModeloState = {
      tempId: newId,
      item_temp_id: item.id_produto_proposta_origem ? undefined : item.id,
      isPersisted: false,
      id_produto_proposta_origem: item.id_produto_proposta_origem || null,
      nome_modelo: "",
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

    onModelosChange([...modelos, newModel]);
    setCollapsedItems((prev) => ({ ...prev, [item.id]: false }));
    setOpenModelos((prev) => ({ ...prev, [newId]: true }));
  }

  function startCopy(modelo: PedidoModeloState) {
    const newId = `new_${Date.now()}`;
    const newModel: PedidoModeloState = {
      ...modelo,
      id: undefined,
      tempId: newId,
      isPersisted: false,
      // A amostra pertence à linha original em pedidos_modelos; a cópia ainda
      // não existe no banco e não deve exibir a arte do outro modelo.
      amostra_arte_base64: null,
    };
    onModelosChange([...modelos, newModel]);
    setOpenModelos((prev) => ({ ...prev, [newId]: true }));
  }

  async function handleDeleteConfirm() {
    if (!deletingModelo) return;
    
    if (deletingModelo.isPersisted && deletingModelo.id) {
      const result = await excluirModelo(deletingModelo.id);
      if (result.success) {
        showToast({ type: "success", title: "Excluído", description: "Modelo removido com sucesso." });
        onModelosChange(modelos.filter((m) => m.id !== deletingModelo.id));
        if (onReloadModelos) onReloadModelos();
      } else {
        showToast({ type: "error", title: "Erro", description: result.errorMessage || "Falha ao excluir." });
      }
    } else {
      onModelosChange(modelos.filter((m) => m.tempId !== deletingModelo.tempId));
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

                <button
                  onClick={() => startCreate(item, saldo)}
                  disabled={isFull}
                  className="flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  Adicionar modelo
                </button>
              </div>

              {!collapsedItems[item.id] && (
                <div className="p-5 space-y-4 bg-slate-50/30">
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
                           const updated = modelos.map(mod => {
                             if (m.tempId && mod.tempId === m.tempId) return { ...mod, ...partial };
                             if (m.id && mod.id === m.id) return { ...mod, ...partial };
                             return mod;
                           });
                           onModelosChange(updated);
                        }}
                        idInt={idInt}
                        onReloadModelos={onReloadModelos}
                      />
                    );
                  }

                  const arteAprovada = isArteAprovada(m.status_arte);
                  const variacoesDoItem = resolverVariacoesTexto(m, item);
                  const arteSrc = m.amostra_arte_base64 ? toImageSrc(m.amostra_arte_base64) : null;

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
                        <div className="mt-2 flex flex-wrap gap-2 text-sm font-medium text-slate-600">
                          {m.id && m.id > 0 ? (
                            <span className="rounded bg-slate-100 px-2.5 py-1">N°: {m.id}</span>
                          ) : (
                            <span className="rounded bg-slate-100 px-2.5 py-1">N°: novo</span>
                          )}
                          <span className="rounded bg-slate-100 px-2.5 py-1">Qtd: {m.quantidade}</span>
                          {m.padrao && <span className="rounded bg-slate-100 px-2.5 py-1">Cor: {m.padrao}</span>}
                          <span className="rounded bg-slate-100 px-2.5 py-1">Numerador: {m.gabarito_operacional || "-"}</span>
                        </div>
                      </div>

                      {/* Variações do item ao qual este modelo pertence */}
                      {variacoesDoItem && (
                        <div className="mb-3">
                          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Variações:</p>
                          <p className="mt-1 text-sm font-medium text-slate-700">{variacoesDoItem}</p>
                        </div>
                      )}

                      {/* Status da arte + amostra renderizada (quando existir) */}
                      <div className="mt-3 border-t border-slate-100 pt-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Arte:</span>
                          <StatusBadge
                            status={m.status_arte || "PENDENTE"}
                            tone={getArteStatusTone(m.status_arte)}
                          />
                        </div>
                        {arteSrc ? (
                          // Prévia sem caixa: a borda abraça a própria imagem. Com
                          // largura e altura automáticas, o navegador respeita a
                          // proporção original e para no primeiro limite atingido —
                          // 90% da largura / 200px de altura no mobile, 70% / 260px
                          // de tablet para cima (md). Sem object-fit: as dimensões
                          // são intrínsecas, então não há como esticar nem cortar.
                          // Clique (ou Enter/Espaço) abre a arte ampliada.
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={arteSrc}
                            alt={`Amostra da arte do modelo ${m.nome_modelo || ""}`}
                            className="mt-3 block h-auto max-h-[200px] w-auto max-w-[90%] cursor-zoom-in rounded-xl border border-slate-200 bg-white transition hover:border-blue-400 md:max-h-[260px] md:max-w-[70%]"
                            loading="lazy"
                            role="button"
                            tabIndex={0}
                            title="Clique para ampliar"
                            onClick={() => setArteAmpliada({ src: arteSrc, nome: m.nome_modelo || "" })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setArteAmpliada({ src: arteSrc, nome: m.nome_modelo || "" });
                              }
                            }}
                            onError={(e) => {
                              // Conteúdo inválido/inacessível: esconde em vez de
                              // deixar o ícone de imagem quebrada no card.
                              e.currentTarget.style.display = "none";
                            }}
                          />
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={arteAmpliada.src}
            alt={`Arte ampliada do modelo ${arteAmpliada.nome}`}
            className="max-h-[90vh] max-w-[95vw] rounded-xl bg-white object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

    </div>
  );
}
