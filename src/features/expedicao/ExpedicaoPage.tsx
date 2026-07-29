"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { listarExpedicoes } from "./services/expedicao.service";
import type { ExpedicaoListItem } from "./types";
import { useAppToast } from "@/components/common/AppToast";
import { codecs } from "@/lib/url-state";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { useSessionState } from "@/hooks/useSessionState";
import {
  Truck,
  PackageCheck,
  Search,
  Layers,
  MapPin,
  Clock,
  AlertCircle,
  Hash,
  Box,
  Map
} from "lucide-react";

export function ExpedicaoPage() {
  const { showToast } = useAppToast();
  const [items, setItems] = useState<ExpedicaoListItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Filtros da tela na URL: sobrevivem a atualizar a página, sair e voltar, ao
  // histórico do navegador e a um link copiado. A filtragem é em memória sobre a
  // lista já carregada — nada aqui muda a consulta.
  // Padrão oficial: docs/technical/PADRAO-FILTROS-URL-NAVEGACAO.md
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      status: { codec: codecs.texto(), default: "TODOS" }
    }),
    []
  );

  // Sem pageKey: esta tela não tem paginação.
  const { filters, setFilter } = useUrlFilters(filtrosSchema);

  const filterStatus = filters.status;

  // A filtragem é em memória, então continua respondendo a cada tecla; o que
  // espera a pausa é apenas a gravação na URL.
  const [search, setSearch] = useDebouncedInput(filters.q, (valor) => setFilter("q", valor));

  // Preferência visual: fica na sessão, não na URL — não faz sentido em um link
  // compartilhado, que deve abrir a lista filtrada e não o modo de exibição de
  // quem enviou.
  const [isCompact, setIsCompact] = useSessionState("ui:/expedicao:compacto", false);

  useEffect(() => {
    async function load() {
      try {
        const data = await listarExpedicoes();
        setItems(data);
      } catch (err) {
        console.error("Erro ao carregar expedições:", err);
      } finally {
        setIsLoaded(true);
      }
    }
    void load();
  }, []);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchSearch = item.cliente.toLowerCase().includes(search.toLowerCase()) || 
                          String(item.id_int).includes(search) || 
                          (item.codigoRastreamento || "").toLowerCase().includes(search.toLowerCase());
      
      const matchStatus = filterStatus === "TODOS" || item.statusLogistico === filterStatus;

      return matchSearch && matchStatus;
    });
  }, [items, search, filterStatus]);

  const aguardandoExpedicao = filteredItems.filter(p => p.statusLogistico === "EXPEDICAO" || p.statusLogistico === "PRONTO_EXPEDICAO");
  const aRetirar = filteredItems.filter(p => p.statusLogistico === "A RETIRAR");
  const emTransito = filteredItems.filter(p => p.statusLogistico === "EM TRANSITO" || p.statusLogistico === "EXPEDIDO");
  const entregues = filteredItems.filter(p => p.statusLogistico === "ENTREGUE");
  const semFrete = filteredItems.filter(p => !p.freteDefinido);

  const handleAction = () => {
    showToast({
      type: "warning",
      title: "Função indisponível",
      description: "Função será liberada na Fase 1B."
    });
  };

  if (!isLoaded) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0b2f4a] border-t-transparent mx-auto"></div>
          <p className="text-slate-500 font-semibold text-sm">Carregando expedição...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/40 p-2.5 rounded-xl shadow-sm text-xs">
        <div className="flex gap-2">
          <Link
            href="/pedidos"
            className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 transition"
          >
            Voltar para Fila Geral (OS)
          </Link>
          <div className="px-3.5 py-2 font-bold rounded-xl bg-[#0b2f4a] text-white transition">
            Expedição e Logística
          </div>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/40 rounded-xl p-4 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase">A Expedir</div>
          <div className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{aguardandoExpedicao.length}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/40 rounded-xl p-4 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase">A Retirar</div>
          <div className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{aRetirar.length}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/40 rounded-xl p-4 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase">Em Trânsito</div>
          <div className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{emTransito.length}</div>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/40 rounded-xl p-4 shadow-sm">
          <div className="text-slate-500 text-xs font-bold uppercase">Entregues</div>
          <div className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">{entregues.length}</div>
        </div>
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 rounded-xl p-4 shadow-sm">
          <div className="text-red-600 dark:text-red-400 text-xs font-bold uppercase">Sem Frete</div>
          <div className="text-2xl font-black text-red-700 dark:text-red-300 mt-1">{semFrete.length}</div>
        </div>
      </div>

      {/* Barra de Filtro */}
      <section className="rounded-xl border border-slate-200/50 dark:border-slate-800/40 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="relative w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por ID, Cliente ou Rastreio..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-4 rounded-2xl border border-slate-200 text-xs focus:outline-none dark:bg-slate-800 dark:border-slate-700 dark:text-white"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilter("status", e.target.value)}
              className="h-9 px-3 rounded-xl border border-slate-200 text-xs focus:outline-none dark:bg-slate-800 dark:border-slate-700 dark:text-white font-semibold text-slate-700"
            >
              <option value="TODOS">Todos os Status</option>
              <option value="EXPEDICAO">A Expedir (EXPEDICAO)</option>
              <option value="A RETIRAR">A Retirar</option>
              <option value="EM TRANSITO">Em Trânsito</option>
              <option value="ENTREGUE">Entregues</option>
            </select>
          </div>
          <div>
            <button
              onClick={() => setIsCompact(prev => !prev)}
              className={`h-9 px-4 rounded-xl border text-xs font-bold transition flex items-center gap-1.5 ${
                isCompact
                  ? "bg-[#0b2f4a] border-[#0b2f4a] text-white"
                  : "border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>{isCompact ? "Modo Compacto" : "Modo Expandido"}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Lista */}
      <div className="space-y-4">
        {filteredItems.length === 0 ? (
          <div className="rounded-xl border p-12 text-center text-slate-400 bg-white dark:bg-slate-900 border-slate-200/40">
            <Truck className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">Nenhuma expedição encontrada</p>
          </div>
        ) : (
          filteredItems.map(item => (
            <div key={item.id_int} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm p-4 relative overflow-hidden">
              {item.isLegacy && (
                <div className="absolute top-0 right-0 bg-yellow-100 text-yellow-800 text-[9px] px-2 py-0.5 rounded-bl-lg font-bold">
                  DADO LEGADO (OS)
                </div>
              )}
              <div className="flex flex-col md:flex-row justify-between gap-4">
                
                {/* Info Base */}
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-[#0b2f4a] dark:text-blue-400 text-sm">#{item.id_int}</span>
                    <h3 className="font-bold text-slate-900 dark:text-slate-100">{item.cliente}</h3>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className={`px-2 py-1 rounded-md font-bold ${
                      item.statusLogistico === "ENTREGUE" ? "bg-green-100 text-green-700" :
                      item.statusLogistico === "EM TRANSITO" ? "bg-blue-100 text-blue-700" :
                      item.statusLogistico === "A RETIRAR" ? "bg-purple-100 text-purple-700" :
                      "bg-amber-100 text-amber-700"
                    }`}>
                      {item.statusLogistico}
                    </span>
                    
                    {item.idPedido ? (
                      <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-600 font-medium flex items-center gap-1">
                        <Box className="w-3 h-3"/> OS: {item.idPedido.split('-')[0]}
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-md bg-slate-100 text-slate-400 font-medium italic">Sem OS vinculada</span>
                    )}
                  </div>
                </div>

                {/* Frete Info */}
                <div className="flex-1 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-100 dark:border-slate-800 p-3 text-xs space-y-2">
                  {!item.freteDefinido ? (
                    <div className="flex items-center gap-1 text-red-500 font-bold h-full justify-center">
                      <AlertCircle className="w-4 h-4"/> Frete não definido ou Retirada/entrega não informada
                    </div>
                  ) : item.isRetiradaLocal ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1 text-teal-600 font-bold uppercase">
                        <MapPin className="w-4 h-4"/> Retirada Local
                      </div>
                      <div className="text-slate-600 font-medium">{item.frete?.observacao}</div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Transportadora</span>
                        <strong className="text-slate-700 dark:text-slate-200">{item.frete?.transportadora}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Serviço</span>
                        <strong className="text-slate-700 dark:text-slate-200">{item.frete?.servico}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Prazo</span>
                        <strong className="text-slate-700 dark:text-slate-200 flex items-center gap-1">
                          <Clock className="w-3 h-3"/> {item.frete?.prazo}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Volumes/Peso</span>
                        <strong className="text-slate-700 dark:text-slate-200">{item.frete?.volumes} vol | {item.frete?.pesoUsado}g</strong>
                      </div>
                    </div>
                  )}
                </div>

                {/* Rastreio & Ações (Futuras) */}
                <div className="w-full md:w-56 space-y-3 flex flex-col justify-between">
                  <div className="space-y-1">
                    <span className="text-slate-400 block text-[10px] uppercase font-bold flex items-center gap-1">
                      <Hash className="w-3 h-3"/> Rastreamento
                    </span>
                    {item.codigoRastreamento ? (
                      <div className="bg-slate-100 dark:bg-slate-800 px-2 py-1.5 rounded-lg text-slate-700 font-mono text-xs font-bold break-all">
                        {item.codigoRastreamento}
                      </div>
                    ) : (
                      <div className="text-slate-400 text-xs italic">Não informado</div>
                    )}
                  </div>

                  <button
                    onClick={handleAction}
                    className="w-full h-8 bg-slate-200 dark:bg-slate-800 text-slate-500 font-bold rounded-lg text-xs flex items-center justify-center gap-1 hover:bg-slate-300 transition"
                  >
                    <Truck className="h-3.5 w-3.5" />
                    <span>Ação de Expedição</span>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
