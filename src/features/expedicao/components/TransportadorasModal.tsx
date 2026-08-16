"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Search, X } from "lucide-react";
import { getTransportadoras } from "@/features/nfe/services/nfe.service";

type Transportadora = {
  id_cliente: number;
  nome: string | null;
  fantasia: string | null;
  documento: string | null;
  cidade_uf: string | null;
};

export function TransportadorasModal({ onClose }: { onClose: () => void }) {
  const [lista, setLista] = useState<Transportadora[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let ativo = true;
    void getTransportadoras().then((rows) => {
      if (!ativo) return;
      setLista(rows as Transportadora[]);
      setCarregando(false);
    });
    return () => {
      ativo = false;
    };
  }, []);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((t) =>
      [t.nome, t.fantasia, t.documento, t.cidade_uf].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [lista, busca]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Transportadoras</h2>
          <div className="flex items-center gap-2">
            <Link
              href="/cadastros/novo?categoria=TRANSPORTADORA"
              className="inline-flex items-center gap-1.5 rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#123f61]"
            >
              <Plus className="h-4 w-4" /> Nova transportadora
            </Link>
            <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="border-b border-slate-100 p-4 dark:border-slate-800">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, CNPJ ou cidade..."
              className="w-full bg-transparent text-sm outline-none dark:text-slate-100"
            />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {carregando ? (
            <p className="p-6 text-center text-sm text-slate-500">Carregando...</p>
          ) : filtradas.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">Nenhuma transportadora encontrada.</p>
          ) : (
            filtradas.map((t) => (
              <div key={t.id_cliente} className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{t.fantasia || t.nome}</p>
                  <p className="truncate text-xs text-slate-500">
                    {[t.documento, t.cidade_uf].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <Link
                  href={`/cadastros/${t.id_cliente}/editar`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar
                </Link>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
