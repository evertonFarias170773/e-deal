import React, { useState, useEffect } from "react";
import { Plus, Trash2, Loader2, AlertCircle } from "lucide-react";
import { listProdutos } from "@/features/produtos/services/produtos.service";
import type { Produto } from "@/features/produtos/types";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  fetchPrecosFixosByCliente,
  upsertPrecoFixo,
  deletePrecoFixo,
  type ClientePrecoFixoRow
} from "../services/cadastros-precos-fixos.service";

type PrecoFixoPanelProps = {
  idCliente: number | string;
  usaPrecoFixo: boolean;
};

export function PrecoFixoPanel({ idCliente, usaPrecoFixo }: PrecoFixoPanelProps) {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [precosFixos, setPrecosFixos] = useState<ClientePrecoFixoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProdutos, setLoadingProdutos] = useState(false);

  const [selectedProdutoId, setSelectedProdutoId] = useState<string>("");
  const [precoInput, setPrecoInput] = useState<string>("");

  const idNum = Number(idCliente);
  const isNewClient = isNaN(idNum) || idNum <= 0;

  useEffect(() => {
    if (!usaPrecoFixo) return;

    let mounted = true;
    const loadCatalog = async () => {
      setLoadingProdutos(true);
      try {
        const list = await listProdutos({ pageSize: 1000, ativo: true });
        if (mounted) setProdutos(list);
      } catch (err) {
        console.error("Erro ao carregar catálogo:", err);
      } finally {
        if (mounted) setLoadingProdutos(false);
      }
    };
    loadCatalog();

    return () => {
      mounted = false;
    };
  }, [usaPrecoFixo]);

  useEffect(() => {
    if (!usaPrecoFixo || isNewClient) return;

    let mounted = true;
    const loadPrecos = async () => {
      setLoading(true);
      try {
        const data = await fetchPrecosFixosByCliente(idNum);
        if (mounted) setPrecosFixos(data);
      } catch (err) {
        console.error("Erro ao carregar precos fixos:", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadPrecos();

    return () => {
      mounted = false;
    };
  }, [usaPrecoFixo, idNum, isNewClient]);

  if (!usaPrecoFixo) return null;

  if (isNewClient) {
    return (
      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center gap-2 text-amber-800">
          <AlertCircle className="h-5 w-5" />
          <p className="font-medium">Salve o cliente primeiro</p>
        </div>
        <p className="mt-1 text-sm text-amber-700">
          Você ativou a opção "Usa Preço Fixo", mas é necessário salvar este cliente (botão Salvar no fim da página) para gerar um ID válido antes de adicionar os preços fixos dos produtos.
        </p>
      </div>
    );
  }

  const handleAdd = async () => {
    if (!selectedProdutoId || !precoInput) return;
    const pid = Number(selectedProdutoId);
    const preco = Number(precoInput.replace(",", "."));
    if (isNaN(pid) || isNaN(preco)) return;

    try {
      setLoading(true);
      await upsertPrecoFixo(idNum, pid, preco);
      const data = await fetchPrecosFixosByCliente(idNum);
      setPrecosFixos(data);
      setSelectedProdutoId("");
      setPrecoInput("");
    } catch (err) {
      alert("Erro ao salvar preço fixo. " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: number) => {
    if (!confirm("Deseja realmente remover este preço fixo?")) return;
    try {
      setLoading(true);
      await deletePrecoFixo(id);
      const data = await fetchPrecosFixosByCliente(idNum);
      setPrecosFixos(data);
    } catch (err) {
      alert("Erro ao remover preço fixo.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-800 mb-4">Tabela de Preços Fixos</h3>
      
      <div className="flex flex-col sm:flex-row gap-3 mb-6 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Produto</label>
          <select
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            value={selectedProdutoId}
            onChange={(e) => setSelectedProdutoId(e.target.value)}
            disabled={loading || loadingProdutos}
          >
            <option value="">Selecione um produto do catálogo...</option>
            {produtos.map(p => (
              <option key={p.id_produto} value={p.id_produto}>
                {p.id_produto} - {p.nomeReal || p.descricao} (Base: {formatCurrency(p.valorUnt)})
              </option>
            ))}
          </select>
        </div>
        
        <div className="w-full sm:w-32">
          <label className="block text-sm font-medium text-gray-700 mb-1">Preço Fixo (R$)</label>
          <input
            type="number"
            step="0.01"
            className="w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            value={precoInput}
            onChange={(e) => setPrecoInput(e.target.value)}
            placeholder="0.00"
            disabled={loading}
          />
        </div>
        
        <button
          type="button"
          className="flex h-[38px] items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
          onClick={handleAdd}
          disabled={loading || !selectedProdutoId || !precoInput}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          <span>Adicionar</span>
        </button>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-500">Produto</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Preço Fixo</th>
              <th className="px-4 py-3 text-right font-medium text-gray-500">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {precosFixos.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                  {loading ? "Carregando..." : "Nenhum preço fixo cadastrado para este cliente."}
                </td>
              </tr>
            ) : (
              precosFixos.map(pf => (
                <tr key={pf.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-900">
                    <span className="font-medium">#{pf.id_produto}</span> - {pf.produto?.descricao || "Produto não encontrado"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-indigo-700">
                    {formatCurrency(pf.preco_fixo)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="text-red-500 hover:text-red-700 disabled:opacity-50"
                      onClick={() => handleRemove(pf.id)}
                      disabled={loading}
                    >
                      <Trash2 className="h-4 w-4 inline-block" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
