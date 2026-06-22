"use client";

import { useState, useEffect } from "react";
import { FormSection } from "@/features/orcamentos/OrcamentoFormPage";
import { getSupabaseClient } from "@/lib/supabase/client";

interface ArtesUltimosPedidosCardProps {
  idCliente: number | string | null;
  idIntAtual: string | null;
}

interface UltimoPedido {
  id: string;
  id_int: string;
  created_at: string;
  updated_at: string;
}

export function ArtesUltimosPedidosCard({ idCliente, idIntAtual }: ArtesUltimosPedidosCardProps) {
  const [pedidos, setPedidos] = useState<UltimoPedido[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUltimosPedidos() {
      if (!idCliente) {
        setLoading(false);
        return;
      }

      const client = getSupabaseClient();
      if (!client) {
        setLoading(false);
        return;
      }

      try {
        let query = client
          .from("propostas")
          .select("id, id_int, created_at, updated_at")
          .eq("id_cliente", idCliente)
          .order("updated_at", { ascending: false })
          .limit(5);

        if (idIntAtual && idIntAtual !== "NOVO") {
          query = query.neq("id_int", idIntAtual);
        }

        const { data, error } = await query;
        if (error) {
          console.error("Erro ao buscar últimos pedidos:", error);
        } else if (data) {
          setPedidos(data as UltimoPedido[]);
        }
      } catch (err) {
        console.error("Exceção ao buscar últimos pedidos:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchUltimosPedidos();
  }, [idCliente, idIntAtual]);

  return (
    <FormSection
      title="Últimos pedidos"
      description="Histórico de propostas aprovadas para o mesmo cliente."
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-500">Carregando pedidos...</p>
        ) : !idCliente ? (
          <p className="text-sm text-slate-500">Nenhum cliente selecionado nesta proposta.</p>
        ) : pedidos.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum pedido anterior encontrado para este cliente.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-600">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold rounded-tl-lg rounded-bl-lg">ID Proposta</th>
                  <th className="px-4 py-3 font-semibold">Nome do Evento</th>
                  <th className="px-4 py-3 font-semibold rounded-tr-lg rounded-br-lg text-right">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pedidos.map((pedido) => (
                  <tr key={pedido.id} className="transition hover:bg-slate-50">
                    <td className="px-4 py-3 font-bold text-slate-800">#{pedido.id_int}</td>
                    <td className="px-4 py-3 text-slate-500 italic">Evento não informado</td>
                    <td className="px-4 py-3 text-right text-xs">
                      {new Date(pedido.updated_at || pedido.created_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 flex justify-center border-t border-slate-100 pt-4">
              <a href="#" onClick={(e) => e.preventDefault()} className="text-sm font-semibold text-teal-600 hover:text-teal-700 transition">
                Ver histórico completo
              </a>
            </div>
          </div>
        )}
      </div>
    </FormSection>
  );
}
