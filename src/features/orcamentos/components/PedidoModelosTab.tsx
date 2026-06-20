"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Edit2, Trash2, X, Package, CheckCircle, AlertTriangle, AlertOctagon } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import type { PedidoModeloRow, ItemComModelos, ModeloInput } from "@/features/orcamentos/services/pedidos-modelos.service";
import {
  listarItensComModelos,
  criarModelo,
  atualizarModelo,
  excluirModelo,
} from "@/features/orcamentos/services/pedidos-modelos.service";

// ─── Types ───────────────────────────────────────────────────────────────────

type ModalMode = "create" | "edit";

interface ModeloDraft {
  nome_modelo: string;
  padrao: string;
  quantidade: string;
  tipo_numeracao: string;
  numeracao_inicio: string;
  numeracao_fim: string;
  frente_verso: boolean;
  rfid_nfc: boolean;
  gabarito_operacional: string;
  especificacao_dados: string;
  obs_impressao: string;
}

const EMPTY_DRAFT: ModeloDraft = {
  nome_modelo: "",
  padrao: "",
  quantidade: "",
  tipo_numeracao: "SEM_NUMERACAO",
  numeracao_inicio: "",
  numeracao_fim: "",
  frente_verso: false,
  rfid_nfc: false,
  gabarito_operacional: "",
  especificacao_dados: "",
  obs_impressao: "",
};

function draftFromModelo(m: PedidoModeloRow): ModeloDraft {
  return {
    nome_modelo: m.nome_modelo,
    padrao: m.padrao || "",
    quantidade: m.quantidade.toString(),
    tipo_numeracao: m.tipo_numeracao || "SEM_NUMERACAO",
    numeracao_inicio: m.numeracao_inicio !== null ? m.numeracao_inicio.toString() : "",
    numeracao_fim: m.numeracao_fim !== null ? m.numeracao_fim.toString() : "",
    frente_verso: Boolean(m.frente_verso),
    rfid_nfc: Boolean(m.rfid_nfc),
    gabarito_operacional: m.gabarito_operacional || "",
    especificacao_dados: m.especificacao_dados || "",
    obs_impressao: m.obs_impressao || "",
  };
}

function draftToInput(draft: ModeloDraft, idInt: number, idProdutoProposta: number): ModeloInput {
  return {
    id_int: idInt,
    id_produto_proposta_origem: idProdutoProposta,
    nome_modelo: draft.nome_modelo.trim(),
    padrao: draft.padrao.trim() || null,
    quantidade: Number(draft.quantidade) || 0,
    tipo_numeracao: draft.tipo_numeracao || null,
    numeracao_inicio: draft.numeracao_inicio ? Number(draft.numeracao_inicio) : null,
    numeracao_fim: draft.numeracao_fim ? Number(draft.numeracao_fim) : null,
    frente_verso: draft.frente_verso,
    rfid_nfc: draft.rfid_nfc,
    gabarito_operacional: draft.gabarito_operacional.trim() || null,
    especificacao_dados: draft.especificacao_dados.trim() || null,
    obs_impressao: draft.obs_impressao.trim() || null,
  };
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const inputClass = "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white transition";
const labelClass = "text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1";
const btnPrimary = "rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white hover:bg-[#123f61] disabled:opacity-60";
const btnSecondary = "rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50";

// ─── Component ───────────────────────────────────────────────────────────────

export function PedidoModelosTab({ idInt }: { idInt: number }) {
  const { showToast } = useAppToast();
  const [itens, setItens] = useState<ItemComModelos[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [modalItemId, setModalItemId] = useState<number>(0);
  const [editingModeloId, setEditingModeloId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ModeloDraft>(EMPTY_DRAFT);

  // Delete confirmation
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingModelo, setDeletingModelo] = useState<PedidoModeloRow | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await listarItensComModelos(idInt);
    if (result.success && result.data) {
      setItens(result.data);
    } else {
      showToast({ type: "error", title: "Erro", description: result.errorMessage || "Falha ao carregar itens." });
    }
    setLoading(false);
  }, [idInt, showToast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // ─── Modal handlers ────────────────────────────────────────────────────────

  function openCreateModal(itemId: number) {
    setModalMode("create");
    setModalItemId(itemId);
    setEditingModeloId(null);
    setDraft(EMPTY_DRAFT);
    setModalOpen(true);
  }

  function openEditModal(itemId: number, modelo: PedidoModeloRow) {
    setModalMode("edit");
    setModalItemId(itemId);
    setEditingModeloId(modelo.id);
    setDraft(draftFromModelo(modelo));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setDraft(EMPTY_DRAFT);
    setEditingModeloId(null);
  }

  async function handleSaveModelo() {
    const input = draftToInput(draft, idInt, modalItemId);
    setSaving(true);

    if (modalMode === "create") {
      const result = await criarModelo(input);
      if (result.success) {
        showToast({ type: "success", title: "Modelo criado", description: `Modelo "${input.nome_modelo}" adicionado com sucesso.` });
        closeModal();
        void fetchData();
      } else {
        showToast({ type: "error", title: "Erro ao criar", description: result.errorMessage || "Falha ao criar modelo." });
      }
    } else if (editingModeloId !== null) {
      const result = await atualizarModelo(editingModeloId, input);
      if (result.success) {
        showToast({ type: "success", title: "Modelo atualizado", description: `Modelo "${input.nome_modelo}" atualizado com sucesso.` });
        closeModal();
        void fetchData();
      } else {
        showToast({ type: "error", title: "Erro ao atualizar", description: result.errorMessage || "Falha ao atualizar modelo." });
      }
    }

    setSaving(false);
  }

  // ─── Delete handlers ───────────────────────────────────────────────────────

  function openDeleteConfirm(modelo: PedidoModeloRow) {
    setDeletingModelo(modelo);
    setDeleteConfirmOpen(true);
  }

  async function handleConfirmDelete() {
    if (!deletingModelo) return;
    setSaving(true);
    const result = await excluirModelo(deletingModelo.id);
    if (result.success) {
      showToast({ type: "success", title: "Modelo excluído", description: `Modelo "${deletingModelo.nome_modelo}" foi removido.` });
      void fetchData();
    } else {
      showToast({ type: "error", title: "Erro ao excluir", description: result.errorMessage || "Falha ao excluir modelo." });
    }
    setSaving(false);
    setDeleteConfirmOpen(false);
    setDeletingModelo(null);
  }

  // ─── Render helpers ────────────────────────────────────────────────────────

  function renderSaldoBadge(saldo: number) {
    if (saldo === 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 border border-emerald-200">
          <CheckCircle className="h-3.5 w-3.5" /> Completo
        </span>
      );
    }
    if (saldo > 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 border border-amber-200">
          <AlertTriangle className="h-3.5 w-3.5" /> Incompleto ({saldo})
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700 border border-red-200">
        <AlertOctagon className="h-3.5 w-3.5" /> Excedido ({Math.abs(saldo)})
      </span>
    );
  }

  function renderTipoNumeracao(tipo: string | null) {
    if (!tipo || tipo === "SEM_NUMERACAO") return "Sem numeração";
    if (tipo === "SEQUENCIAL") return "Sequencial";
    if (tipo === "MANUAL") return "Manual";
    return tipo;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-[#0b2f4a]" />
        <span className="ml-3 text-sm text-slate-500">Carregando itens e modelos...</span>
      </div>
    );
  }

  if (itens.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
        <Package className="mx-auto h-10 w-10 text-slate-400" />
        <p className="mt-3 text-sm font-semibold text-slate-600">Nenhum item nesta proposta</p>
        <p className="mt-1 text-xs text-slate-400">Adicione produtos na aba &quot;Proposta / Orçamento&quot; para poder gerenciar modelos.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5">
        {itens.map((item) => (
          <div key={item.id} className="rounded-3xl border border-[#d7e5e8] bg-white shadow-sm overflow-hidden">
            {/* Item Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
              <div className="flex items-center gap-3 min-w-0">
                <Package className="h-5 w-5 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{item.nome_produto}</p>
                  {item.modelo_descri && (
                    <p className="text-xs text-slate-500 truncate">{item.modelo_descri}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-full px-3 py-1">
                  Qtd: {item.qtd.toLocaleString("pt-BR")}
                </span>
                {renderSaldoBadge(item.saldo_a_distribuir)}
              </div>
            </div>

            {/* Modelos List */}
            <div className="p-5 space-y-3">
              {item.modelos.length === 0 ? (
                <p className="text-xs text-slate-400 italic text-center py-4">Nenhum modelo cadastrado para este item.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        <th className="py-2 pr-3">Modelo</th>
                        <th className="py-2 pr-3">Padrão</th>
                        <th className="py-2 pr-3 text-right">Qtd</th>
                        <th className="py-2 pr-3">Numeração</th>
                        <th className="py-2 pr-3 text-center">F/V</th>
                        <th className="py-2 pr-3 text-center">RFID</th>
                        <th className="py-2 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {item.modelos.map((m) => (
                        <tr key={m.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition">
                          <td className="py-2.5 pr-3 font-semibold text-slate-900">{m.nome_modelo}</td>
                          <td className="py-2.5 pr-3 text-slate-600">{m.padrao || "—"}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold text-slate-800">{m.quantidade.toLocaleString("pt-BR")}</td>
                          <td className="py-2.5 pr-3 text-slate-500">
                            {renderTipoNumeracao(m.tipo_numeracao)}
                            {m.tipo_numeracao === "SEQUENCIAL" && m.numeracao_inicio !== null && m.numeracao_fim !== null && (
                              <span className="ml-1 text-slate-400">({m.numeracao_inicio}–{m.numeracao_fim})</span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 text-center">{m.frente_verso ? "Sim" : "—"}</td>
                          <td className="py-2.5 pr-3 text-center">{m.rfid_nfc ? "Sim" : "—"}</td>
                          <td className="py-2.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openEditModal(item.id, m)}
                                className="rounded-xl p-1.5 text-slate-400 hover:bg-blue-50 hover:text-blue-600 transition"
                                title="Editar modelo"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openDeleteConfirm(m)}
                                className="rounded-xl p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                                title="Excluir modelo"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button
                type="button"
                onClick={() => openCreateModal(item.id)}
                className="inline-flex items-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-600 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 transition"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar modelo
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ─── Modal: Criar / Editar Modelo ───────────────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="mx-auto mt-8 max-w-2xl rounded-3xl bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 p-5">
              <h2 className="text-lg font-semibold text-slate-950">
                {modalMode === "create" ? "Adicionar Modelo" : "Editar Modelo"}
              </h2>
              <button type="button" onClick={closeModal} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Nome do Modelo */}
                <div>
                  <label className={labelClass}>Nome do Modelo *</label>
                  <input
                    value={draft.nome_modelo}
                    onChange={(e) => setDraft({ ...draft, nome_modelo: e.target.value })}
                    className={inputClass}
                    placeholder="Ex: CAMAROTE, PISTA VIP"
                  />
                </div>

                {/* Padrão */}
                <div>
                  <label className={labelClass}>Padrão</label>
                  <input
                    value={draft.padrao}
                    onChange={(e) => setDraft({ ...draft, padrao: e.target.value })}
                    className={inputClass}
                    placeholder="Ex: ROSA, AZUL, BRANCO"
                  />
                </div>

                {/* Quantidade */}
                <div>
                  <label className={labelClass}>Quantidade *</label>
                  <input
                    type="number"
                    min="1"
                    value={draft.quantidade}
                    onChange={(e) => setDraft({ ...draft, quantidade: e.target.value })}
                    className={inputClass}
                    placeholder="0"
                  />
                </div>

                {/* Tipo Numeração */}
                <div>
                  <label className={labelClass}>Tipo de Numeração</label>
                  <select
                    value={draft.tipo_numeracao}
                    onChange={(e) => setDraft({ ...draft, tipo_numeracao: e.target.value })}
                    className={inputClass}
                  >
                    <option value="SEM_NUMERACAO">Sem numeração</option>
                    <option value="SEQUENCIAL">Sequencial</option>
                    <option value="MANUAL">Manual</option>
                  </select>
                </div>

                {/* Numeração Início/Fim (conditional) */}
                {draft.tipo_numeracao === "SEQUENCIAL" && (
                  <>
                    <div>
                      <label className={labelClass}>Numeração Início *</label>
                      <input
                        type="number"
                        value={draft.numeracao_inicio}
                        onChange={(e) => setDraft({ ...draft, numeracao_inicio: e.target.value })}
                        className={inputClass}
                        placeholder="1"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Numeração Fim *</label>
                      <input
                        type="number"
                        value={draft.numeracao_fim}
                        onChange={(e) => setDraft({ ...draft, numeracao_fim: e.target.value })}
                        className={inputClass}
                        placeholder="1500"
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Toggles row */}
              <div className="flex flex-wrap items-center gap-6 pt-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={draft.frente_verso}
                    onChange={(e) => setDraft({ ...draft, frente_verso: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-xs font-semibold text-slate-700">Frente e Verso</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={draft.rfid_nfc}
                    onChange={(e) => setDraft({ ...draft, rfid_nfc: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                  />
                  <span className="text-xs font-semibold text-slate-700">RFID / NFC</span>
                </label>
              </div>

              {/* Gabarito Operacional */}
              <div>
                <label className={labelClass}>Gabarito Operacional</label>
                <input
                  value={draft.gabarito_operacional}
                  onChange={(e) => setDraft({ ...draft, gabarito_operacional: e.target.value })}
                  className={inputClass}
                  placeholder="Referência do gabarito de produção"
                />
              </div>

              {/* Especificação de Dados */}
              <div>
                <label className={labelClass}>Especificação de Dados</label>
                <textarea
                  value={draft.especificacao_dados}
                  onChange={(e) => setDraft({ ...draft, especificacao_dados: e.target.value })}
                  className={`${inputClass} min-h-[60px] resize-y`}
                  rows={2}
                  placeholder="Dados variáveis, campos personalizados, etc."
                />
              </div>

              {/* Obs Impressão */}
              <div>
                <label className={labelClass}>Observações de Impressão</label>
                <textarea
                  value={draft.obs_impressao}
                  onChange={(e) => setDraft({ ...draft, obs_impressao: e.target.value })}
                  className={`${inputClass} min-h-[60px] resize-y`}
                  rows={2}
                  placeholder="Observações técnicas para a produção"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={closeModal} className={btnSecondary}>Cancelar</button>
              <button type="button" onClick={handleSaveModelo} disabled={saving} className={btnPrimary}>
                {saving ? "Salvando..." : modalMode === "create" ? "Adicionar" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Modal: Confirmação de Exclusão ─────────────────────────────────── */}
      {deleteConfirmOpen && deletingModelo && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
            <div className="p-6">
              <h2 className="text-lg font-semibold text-slate-950">Excluir modelo</h2>
              <p className="mt-2 text-sm text-slate-500">
                Deseja excluir o modelo <strong>&quot;{deletingModelo.nome_modelo}&quot;</strong>? Esta ação é irreversível.
              </p>
            </div>
            <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => { setDeleteConfirmOpen(false); setDeletingModelo(null); }}
                className={btnSecondary}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={saving}
                className="rounded-2xl bg-red-600 px-5 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {saving ? "Excluindo..." : "Confirmar exclusão"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
