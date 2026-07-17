"use client";

import { useState, useEffect } from "react";
import { useAppToast } from "@/components/common/AppToast";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";
import { getSaldoCredito } from "@/features/cobrancas/services/movimento-credito.service";
import type { MovimentoCredito } from "@/features/cobrancas/types";
import { X } from "lucide-react";

interface AjusteContaCorrenteModalProps {
  isOpen: boolean;
  onClose: () => void;
  idCliente: number;
  nomeCliente: string;
  onSuccess: () => void;
}

export function AjusteContaCorrenteModal({ isOpen, onClose, idCliente, nomeCliente, onSuccess }: AjusteContaCorrenteModalProps) {
  const [tab, setTab] = useState<"AJUSTE" | "HISTORICO">("AJUSTE");
  const { showToast } = useAppToast();

  // Saldo
  const [saldo, setSaldo] = useState<number | null>(null);

  // Campos Ajuste
  const [tipo, setTipo] = useState<"CREDITO" | "DEBITO">("CREDITO");
  const [valor, setValor] = useState<string>("");
  const [observacao, setObservacao] = useState<string>("");
  const [loadingAjuste, setLoadingAjuste] = useState(false);

  // Histórico
  const [historico, setHistorico] = useState<MovimentoCredito[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(false);
  const [estornandoId, setEstornandoId] = useState<number | null>(null);

  // Carregar saldo ao abrir modal
  useEffect(() => {
    if (isOpen) {
      carregarSaldo();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && tab === "HISTORICO") {
      carregarHistorico();
    }
  }, [isOpen, tab]);

  async function carregarSaldo() {
    try {
      const s = await getSaldoCredito(idCliente);
      setSaldo(s);
    } catch {
      setSaldo(0);
    }
  }

  async function carregarHistorico() {
    setLoadingHistorico(true);
    try {
      const { getSupabaseClient } = await import("@/lib/supabase/client");
      const { listarHistoricoCredito } = await import("@/features/cobrancas/services/movimento-credito.service");
      const client = getSupabaseClient();
      if (client) {
        const hist = await listarHistoricoCredito(idCliente, client);
        setHistorico(hist);
      }
    } catch (e: any) {
      showToast({ title: "Erro", description: e.message, type: "error" });
    } finally {
      setLoadingHistorico(false);
    }
  }

  async function handleAjuste(e: any) {
    e.preventDefault();
    if (!valor || Number(valor) <= 0) {
      showToast({ title: "Atenção", description: "O valor deve ser maior que zero.", type: "warning" });
      return;
    }
    if (!observacao.trim()) {
      showToast({ title: "Atenção", description: "A observação é obrigatória.", type: "warning" });
      return;
    }

    const tipoLabel = tipo === "CREDITO" ? "crédito" : "débito";
    if (!confirm(`Confirmar lançamento de ${tipoLabel} de R$ ${valor}?`)) return;

    setLoadingAjuste(true);
    try {
      const res = await fetch("/api/cobrancas/ajuste-credito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_cliente: idCliente,
          tipo,
          valor: Number(valor),
          observacao
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao registrar ajuste");

      showToast({ title: "Sucesso", description: "Ajuste registrado com sucesso.", type: "success" });
      setValor("");
      setObservacao("");
      await carregarSaldo();
      onSuccess();
      if (tab === "HISTORICO") carregarHistorico();
    } catch (e: any) {
      showToast({ title: "Erro", description: e.message, type: "error" });
    } finally {
      setLoadingAjuste(false);
    }
  }

  async function handleEstornar(idMovimento: number) {
    if (!confirm("Tem certeza que deseja estornar este lançamento? O saldo do cliente será recalculado.")) return;
    
    setEstornandoId(idMovimento);
    try {
      const res = await fetch("/api/cobrancas/estorno-credito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_movimento: idMovimento })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao estornar");

      showToast({ title: "Sucesso", description: "Estorno realizado com sucesso.", type: "success" });
      carregarHistorico();
      await carregarSaldo();
      onSuccess();
    } catch (e: any) {
      showToast({ title: "Estorno bloqueado", description: e.message, type: "error" });
    } finally {
      setEstornandoId(null);
    }
  }

  if (!isOpen) return null;

  const inputStyle = {
    background: 'var(--input)',
    color: 'var(--foreground)',
    borderColor: 'var(--border)'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl shadow-2xl"
        style={{ background: 'var(--card)' }}
      >
        <header
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-lg font-bold" style={{ color: 'var(--card-foreground)' }}>
            Conta Corrente - {nomeCliente}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-2 transition-colors hover:opacity-80"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Saldo display */}
          <div
            className="flex items-center justify-between rounded-xl px-4 py-3 mb-4"
            style={{ background: 'var(--accent)', color: 'var(--accent-foreground)' }}
          >
            <span className="text-sm font-medium">Saldo atual</span>
            <span className="text-lg font-bold">
              {saldo !== null ? formatCurrency(saldo) : '...'}
            </span>
          </div>

          {/* Tabs */}
          <div className="flex border-b mb-4" style={{ borderColor: 'var(--border)' }}>
            <button
              className={`pb-2 px-4 ${tab === "AJUSTE" ? "border-b-2 border-emerald-600 font-bold" : ""}`}
              style={{ color: tab === "AJUSTE" ? 'var(--foreground)' : 'var(--muted-foreground)' }}
              onClick={() => setTab("AJUSTE")}
            >
              Novo Lançamento
            </button>
            <button
              className={`pb-2 px-4 ${tab === "HISTORICO" ? "border-b-2 border-emerald-600 font-bold" : ""}`}
              style={{ color: tab === "HISTORICO" ? 'var(--foreground)' : 'var(--muted-foreground)' }}
              onClick={() => setTab("HISTORICO")}
            >
              Extrato / Histórico
            </button>
          </div>

          {tab === "AJUSTE" && (
            <form onSubmit={handleAjuste} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                    Tipo de Lançamento
                  </label>
                  <select
                    className="w-full rounded-xl border px-4 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    style={inputStyle}
                    value={tipo}
                    onChange={e => setTipo(e.target.value as any)}
                  >
                    <option value="CREDITO">Adicionar Crédito (+)</option>
                    <option value="DEBITO">Registrar Débito Manual (-)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                    Valor (R$)
                  </label>
                  <input
                    className="w-full rounded-xl border px-4 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                    style={inputStyle}
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={valor}
                    onChange={e => setValor(e.target.value)}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--foreground)' }}>
                  Observação Justificada
                </label>
                <textarea
                  className="w-full rounded-xl border px-4 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 resize-none"
                  style={inputStyle}
                  rows={2}
                  value={observacao}
                  onChange={e => setObservacao(e.target.value)}
                  placeholder="Justifique o motivo deste lançamento..."
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:opacity-80"
                  style={{ color: 'var(--muted-foreground)' }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loadingAjuste}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-700 transition disabled:opacity-50"
                >
                  {loadingAjuste ? "Registrando..." : "Registrar Lançamento"}
                </button>
              </div>
            </form>
          )}

          {tab === "HISTORICO" && (
            <div className="max-h-[400px] overflow-y-auto">
              {loadingHistorico ? (
                <p className="text-center py-4" style={{ color: 'var(--muted-foreground)' }}>
                  Carregando extrato...
                </p>
              ) : historico.length === 0 ? (
                <p className="text-center py-4" style={{ color: 'var(--muted-foreground)' }}>
                  Nenhum lançamento encontrado para este cliente.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead style={{ background: 'var(--muted)' }}>
                    <tr>
                      <th className="p-2 text-left" style={{ color: 'var(--foreground)' }}>Data</th>
                      <th className="p-2 text-left" style={{ color: 'var(--foreground)' }}>Tipo</th>
                      <th className="p-2 text-right" style={{ color: 'var(--foreground)' }}>Valor</th>
                      <th className="p-2 text-center" style={{ color: 'var(--foreground)' }}>Origem</th>
                      <th className="p-2 text-left" style={{ color: 'var(--foreground)' }}>Obs</th>
                      <th className="p-2 text-right" style={{ color: 'var(--foreground)' }}>Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {historico.map(mov => (
                      <tr
                        key={mov.id}
                        className={mov.cancelado ? "opacity-50 line-through" : ""}
                        style={mov.cancelado ? { background: 'var(--muted)' } : undefined}
                      >
                        <td className="p-2" style={{ color: 'var(--foreground)' }}>
                          {formatDate(mov.created_at)}
                        </td>
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded text-xs ${mov.tipo === 'CREDITO' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                            {mov.tipo}
                          </span>
                        </td>
                        <td className="p-2 text-right font-mono" style={{ color: 'var(--foreground)' }}>
                          {formatCurrency(mov.valor)}
                        </td>
                        <td className="p-2 text-center text-xs truncate max-w-[100px]" style={{ color: 'var(--muted-foreground)' }}>
                          {mov.origem}
                        </td>
                        <td
                          className="p-2 text-xs truncate max-w-[120px]"
                          title={mov.observacao || ""}
                          style={{ color: 'var(--muted-foreground)' }}
                        >
                          {mov.observacao || "—"}
                        </td>
                        <td className="p-2 text-right">
                          {!mov.cancelado && (
                            <button
                              className="text-xs font-semibold text-red-500 hover:bg-red-50 px-2 py-1 rounded transition disabled:opacity-50"
                              onClick={() => handleEstornar(mov.id)}
                              disabled={estornandoId === mov.id}
                            >
                              {estornandoId === mov.id ? "..." : "Estornar"}
                            </button>
                          )}
                          {mov.cancelado && (
                            <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                              Cancelado{mov.cancelado_em ? ` em ${formatDate(mov.cancelado_em)}` : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
