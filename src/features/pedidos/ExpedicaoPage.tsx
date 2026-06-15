"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listarPedidosOperacionais } from "./services/pedidos-producao.service";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  Truck,
  Scale,
  CheckCircle2,
  AlertCircle,
  Search,
  Layers,
  ArrowLeft,
  Calendar,
  Flame,
  ArrowRight,
  Clipboard,
  Tv,
  Minimize2,
  Clock,
  RefreshCw
} from "lucide-react";
import { formatDate } from "@/lib/formatters/date";
import type { PedidoProducaoListItem } from "./types";

export function ExpedicaoPage() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [pedidos, setPedidos] = useState<PedidoProducaoListItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const data = await listarPedidosOperacionais();
        setPedidos(data);
      } catch (err) {
        console.error("Erro ao carregar pedidos para expedição:", err);
      } finally {
        setIsLoaded(true);
      }
    }
    void load();
  }, []);

  const [search, setSearch] = useState("");
  const [filterUrgente, setFilterUrgente] = useState(false);
  const [pesoInputs, setPesoInputs] = useState<Record<string, string>>({}); // key: `${pedidoId}-${volIdx}`
  const [volumesCounts, setVolumesCounts] = useState<Record<number, number>>({});
  const [currentTime, setCurrentTime] = useState("");
  const [isCompact, setIsCompact] = useState(false);

  const resetLocalStorage = () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("erp_ideal_mock_pedidos_db");
      window.location.reload();
      showToast({
        type: "info",
        title: "Banco resetado",
        description: "Os dados do protótipo de UX foram restaurados para os originais."
      });
    }
  };

  const getVolumesCount = (pedidoId: number, defaultVal?: number) => {
    return volumesCounts[pedidoId] || defaultVal || 1;
  };

  const handleVolumeWeightChange = (pedidoId: number, idx: number, val: string) => {
    setPesoInputs((prev) => ({ ...prev, [`${pedidoId}-${idx}`]: val }));
  };

  const handleVolumesCountChange = (pedidoId: number, count: number) => {
    setVolumesCounts((prev) => ({ ...prev, [pedidoId]: count }));
  };

  const getPedidoTotalWeight = (pedidoId: number, expectedVolumes: number) => {
    const count = getVolumesCount(pedidoId, expectedVolumes);
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const w = Number(pesoInputs[`${pedidoId}-${i}`] || 0);
      sum += w;
    }
    return sum;
  };

  const isPedidoWeighed = (pedidoId: number, expectedVolumes: number) => {
    const count = getVolumesCount(pedidoId, expectedVolumes);
    for (let i = 0; i < count; i++) {
      const val = pesoInputs[`${pedidoId}-${i}`];
      if (!val || isNaN(Number(val)) || Number(val) <= 0) return false;
    }
    return true;
  };

  const getCarrierInfo = (pedidoId: number) => {
    const val = pedidoId % 3;
    if (val === 0) {
      return {
        name: "Motoboy Express",
        color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/20 dark:text-purple-400 dark:border-purple-900",
        icon: "🛵"
      };
    }
    if (val === 1) {
      return {
        name: "Correios SEDEX",
        color: "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/20 dark:text-yellow-400 dark:border-yellow-900",
        icon: "📦"
      };
    }
    return {
      name: "Retirada Balcão",
      color: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/20 dark:text-teal-400 dark:border-teal-900",
      icon: "🏪"
    };
  };

  // Tick Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString("pt-BR"));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Keyboard Navigation & Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA" ||
        document.activeElement?.tagName === "SELECT"
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (key === "l") {
        router.push("/pedidos");
      } else if (key === "k") {
        router.push("/pedidos/kanban");
      } else if (key === "i") {
        router.push("/pedidos/impressao");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  if (!isLoaded) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#0b2f4a] border-t-transparent mx-auto"></div>
          <p className="text-slate-500 font-semibold text-sm">Carregando painel de expedição...</p>
        </div>
      </div>
    );
  }

  // Safe no-op for mock action
  const despacharPedido = (_idInt: number, _pesoAferido: number, _volumes: number) => {};

  // Filter lists
  const aguardandoExpedicao = pedidos.filter((p) => {
    // Pedidos with status_expedicao === 'BLOQUEADO' are NOT active expedition items.
    if (p.status_expedicao === "BLOQUEADO") return false;

    const matchesStatus = p.statusPedido === "PRONTO_EXPEDICAO" || p.status_expedicao === "PRONTO_EXPEDICAO";
    const matchesSearch =
      p.clienteNome.toLowerCase().includes(search.toLowerCase()) ||
      String(p.id_int).includes(search);
    const matchesUrgente = !filterUrgente || p.urgente;
    return matchesStatus && matchesSearch && matchesUrgente;
  });

  const despachadosHoje = pedidos.filter((p) => {
    const matchesStatus = p.statusPedido === "EXPEDIDO" || p.status_expedicao === "EXPEDIDO";
    const matchesSearch =
      p.clienteNome.toLowerCase().includes(search.toLowerCase()) ||
      String(p.id_int).includes(search);
    return matchesStatus && matchesSearch;
  });

  const handleDispatchWeight = (pedido: PedidoProducaoListItem) => {
    const expectedVol = pedido.volumes || 1;
    const count = getVolumesCount(pedido.id_int, expectedVol);
    
    // Ensure all volumes are filled
    if (!isPedidoWeighed(pedido.id_int, expectedVol)) {
      showToast({
        type: "warning",
        title: "Pesagem incompleta",
        description: "Preencha o peso real de todos os volumes antes de despachar."
      });
      return;
    }

    const totalWeight = getPedidoTotalWeight(pedido.id_int, expectedVol);

    // Calcula desvio do peso (margem de tolerância de 5%)
    const desvio = Math.abs(totalWeight - pedido.pesoTeorico) / pedido.pesoTeorico;
    if (desvio > 0.05) {
      showToast({
        type: "error",
        title: "Bloqueado para segurança",
        description: `Divergência de peso acima de 5% (${(desvio * 100).toFixed(1)}%). Corrija a quantidade física antes de despachar.`
      });
      return;
    }

    despacharPedido(pedido.id_int, totalWeight, count);
    showToast({
      type: "success",
      title: "Pedido Despachado!",
      description: `Pesagem de ${totalWeight.toFixed(2)}kg conforme (${count} volume(s)). Pacote liberado para transportadora.`
    });
  };

  const renderHeaderSelector = () => (
    <div className="flex justify-between items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800/40 p-2.5 rounded-xl shadow-sm text-xs">
      <div className="flex gap-2">
        <Link
          href="/pedidos"
          className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 transition"
        >
          Fila Geral
        </Link>
        <Link
          href="/pedidos/kanban"
          className="px-3.5 py-2 font-bold rounded-xl text-slate-600 hover:bg-slate-100 transition"
        >
          Kanban Board
        </Link>
        <Link
          href="/pedidos/impressao"
          className="px-3.5 py-2 font-bold rounded-xl text-slate-605 hover:bg-slate-100 transition"
        >
          Fila de Impressão
        </Link>
        <Link
          href="/expedicao"
          className="px-3.5 py-2 font-bold rounded-xl bg-[#0b2f4a] text-white transition"
        >
          Expedição
        </Link>
      </div>
      {currentTime && (
        <div className="h-8 px-3.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono font-extrabold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 shadow-sm text-xs">
          <Clock className="h-3.5 w-3.5 text-blue-600" />
          <span>{currentTime}</span>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {renderHeaderSelector()}

      {/* Barra de Filtro */}
      <section className="rounded-xl border border-slate-200/50 dark:border-slate-800/40 bg-white dark:bg-slate-900 p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="relative w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por ID ou Cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-4 rounded-2xl border border-slate-200 text-xs focus:outline-none"
              />
            </div>
            <div className="flex items-center">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={filterUrgente}
                  onChange={(e) => setFilterUrgente(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <Flame className="h-4 w-4 text-red-500" />
                <span>Priorizar Urgentes</span>
              </label>
            </div>
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
              <span>{isCompact ? "Modo Compacto: Ligado" : "Modo Compacto: Desligado"}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Lista Principal */}
      {aguardandoExpedicao.length === 0 && despachadosHoje.length === 0 ? (
        <div className="rounded-xl border p-12 text-center text-slate-400 dark:text-slate-600 bg-white dark:bg-slate-900 border-slate-200/40 dark:border-slate-800/30">
          <Truck className="h-8 w-8 mx-auto mb-2 text-slate-300 dark:text-slate-700" />
          <p className="font-bold text-slate-900 dark:text-slate-100 text-sm">Nenhum pedido em expedição</p>
          <p className="text-[11px] mt-0.5 text-slate-500">Os pedidos aparecerão aqui quando forem concluídos na produção.</p>
        </div>
      ) : (
        <div className={`grid ${isCompact ? "gap-4" : "gap-6"} md:grid-cols-2`}>
        {/* Lado Esquerdo: Aguardando Pesagem/Despacho */}
        <div className={`bg-slate-50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800/80 rounded-xl ${isCompact ? "p-3.5 space-y-3" : "p-5 space-y-4"}`}>
          <div className="border-b border-slate-200 dark:border-slate-800 pb-2 flex justify-between items-center text-xs font-black uppercase text-slate-500">
            <span className="flex items-center gap-1.5">
              <Scale className="h-4 w-4 text-blue-600" />
              Aguardando Despacho / Pesagem
            </span>
            <span className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 rounded-full font-bold">
              {aguardandoExpedicao.length}
            </span>
          </div>

          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
            {aguardandoExpedicao.length > 0 ? (
              aguardandoExpedicao.map((pedido) => {
                const carrier = getCarrierInfo(pedido.id_int);
                const expectedVol = pedido.volumes || 1;
                const currentVol = getVolumesCount(pedido.id_int, expectedVol);
                const totalWeight = getPedidoTotalWeight(pedido.id_int, expectedVol);
                
                // check if any volume is weighed
                const hasAnyWeight = Array.from({ length: currentVol }).some((_, i) => pesoInputs[`${pedido.id_int}-${i}`]);
                const isAllWeighed = isPedidoWeighed(pedido.id_int, expectedVol);
                const desvio = Math.abs(totalWeight - pedido.pesoTeorico) / pedido.pesoTeorico;
                const isDivergente = desvio > 0.05;

                return (
                  <div
                    key={pedido.id_int}
                    className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm relative ${
                      isCompact ? "p-3 space-y-3" : "p-4 space-y-4"
                    } ${pedido.urgente ? "border-l-4 border-l-red-500" : ""}`}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`font-extrabold text-[#0b2f4a] dark:text-blue-400 ${isCompact ? "text-xs" : "text-sm"}`}>
                            OS #{pedido.id_int}
                          </span>
                          <span className={`text-slate-400 font-semibold uppercase ${isCompact ? "text-[9px]" : "text-[10px]"}`}>
                            {pedido.empresa}
                          </span>
                          {pedido.urgente && (
                            <span className="bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400 px-1 rounded text-[8px] font-extrabold animate-pulse">
                              URGENTE
                            </span>
                          )}
                        </div>
                        <h4 className={`font-bold text-slate-900 dark:text-slate-100 truncate ${isCompact ? "text-[11px] leading-tight" : "text-xs"}`}>
                          {pedido.clienteNome}
                        </h4>
                      </div>
                      
                      {/* Carrier Tag */}
                      <span className={`text-[9px] border px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${carrier.color}`}>
                        <span>{carrier.icon}</span>
                        <span>{carrier.name}</span>
                      </span>
                    </div>

                    {/* Ficha da pesagem */}
                    <div className={`bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-2 ${
                      isCompact ? "p-2.5 text-[10px]" : "p-3 text-[11px]"
                    }`}>
                      <div>
                        <span className="text-slate-400 block">Qtd Modelos:</span>
                        <strong className="text-slate-800 dark:text-slate-200">{pedido.modelos.length} lote(s)</strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Peso Esperado:</span>
                        <strong className="text-slate-800 dark:text-slate-200">
                          {pedido.pesoTeorico.toFixed(2)} kg
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Prazo:</span>
                        <strong className="text-slate-800 dark:text-slate-200">
                          {formatDate(pedido.dataPrevistaEntrega)}
                        </strong>
                      </div>
                    </div>

                    {/* Multi-volume selector */}
                    <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-2 text-[11px]">
                      <span className="text-slate-500 font-semibold">Configuração de Embalagem:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">Volumes:</span>
                        <select
                          disabled={true}
                          value={currentVol}
                          onChange={(e) => handleVolumesCountChange(pedido.id_int, Number(e.target.value))}
                          className="h-7 px-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800 text-slate-400 focus:outline-none cursor-not-allowed"
                        >
                          <option value={1}>1 volume</option>
                          <option value={2}>2 volumes</option>
                          <option value={3}>3 volumes</option>
                          <option value={4}>4 volumes</option>
                          <option value={5}>5 volumes</option>
                        </select>
                      </div>
                    </div>

                    {/* Formulário da Balança (Multi-volume ou volume único) */}
                    <div className="space-y-2.5">
                      {currentVol === 1 ? (
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Scale className="absolute left-3 top-2 h-3.5 w-3.5 text-slate-400" />
                            <input
                              type="text"
                              disabled={true}
                              placeholder="Pesagem desativada nesta etapa..."
                              value=""
                              onChange={(e) => handleVolumeWeightChange(pedido.id_int, 0, e.target.value)}
                              className="w-full h-8 pl-9 pr-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs focus:outline-none bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed font-medium"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={true}
                            className="h-8 px-4 bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-550 font-extrabold rounded-lg text-xs flex items-center gap-1 cursor-not-allowed opacity-60"
                          >
                            <Truck className="h-3.5 w-3.5" />
                            <span>Despachar</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-2">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Balança - Peso por volume:</span>
                          <div className="grid grid-cols-2 gap-2">
                            {Array.from({ length: currentVol }).map((_, idx) => (
                              <div key={idx} className="relative flex items-center gap-1">
                                <span className="text-[10px] text-slate-400 shrink-0 font-medium w-11">Vol {idx + 1}:</span>
                                <div className="relative flex-1">
                                  <Scale className="absolute left-2.5 top-1.5 h-3 w-3 text-slate-400" />
                                  <input
                                    type="text"
                                    disabled={true}
                                    placeholder="kg"
                                    value=""
                                    onChange={(e) => handleVolumeWeightChange(pedido.id_int, idx, e.target.value)}
                                    className="w-full h-7 pl-7 pr-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px] bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                          
                          <button
                            type="button"
                            disabled={true}
                            className="w-full h-8 bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-550 font-extrabold rounded-lg text-xs flex items-center justify-center gap-1 cursor-not-allowed opacity-60 mt-2"
                          >
                            <Truck className="h-3.5 w-3.5" />
                            <span>Despachar Desativado</span>
                          </button>
                        </div>
                      )}

                      {pedido.financialBlock && (
                        <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-2 rounded-lg text-[10px] font-bold border border-red-200 dark:border-red-900/40 flex items-center gap-1.5 animate-pulse mt-1">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>EXPEDIÇÃO BLOQUEADA: AGUARDANDO CONFIRMAÇÃO FINANCEIRA</span>
                        </div>
                      )}

                      {/* Feedback do Desvio em tempo real */}
                      {hasAnyWeight && (
                        <div
                          className={`p-2 rounded-lg text-[10px] font-semibold flex items-center gap-1.5 ${
                            !isAllWeighed
                              ? "bg-slate-50 text-slate-600 border border-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
                              : isDivergente
                              ? "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 border border-red-100 dark:border-red-900/40"
                              : "bg-teal-50 text-teal-700 dark:bg-teal-950/20 dark:text-teal-400 border border-teal-100 dark:border-teal-900/40"
                          }`}
                        >
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {!isAllWeighed
                              ? `PESANDO: Total parcial aferido: ${totalWeight.toFixed(2)}kg. Preencha o peso de todos os volumes.`
                              : isDivergente
                              ? `DIVERGÊNCIA: Desvio de ${(desvio * 100).toFixed(1)}% (limite 5%). Despacho físico bloqueado pela balança.`
                              : `CONFORME: Peso total de ${totalWeight.toFixed(2)}kg com desvio de ${(desvio * 100).toFixed(1)}%. Pronto para liberar.`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs">
                Nenhum pedido aguardando despacho no momento.
              </div>
            )}
          </div>
        </div>

        {/* Lado Direito: Despachados Hoje */}
        <div className={`bg-slate-50 dark:bg-slate-950/20 border border-slate-100 dark:border-slate-800/80 rounded-xl ${isCompact ? "p-3.5 space-y-3" : "p-5 space-y-4"}`}>
          <div className="border-b border-slate-200 dark:border-slate-800 pb-2 flex justify-between items-center text-xs font-black uppercase text-slate-500">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Despachados Hoje
            </span>
            <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-full font-bold">
              {despachadosHoje.length}
            </span>
          </div>

          <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1">
            {despachadosHoje.length > 0 ? (
              despachadosHoje.map((pedido) => {
                const carrier = getCarrierInfo(pedido.id_int);
                return (
                  <div
                    key={pedido.id_int}
                    className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl shadow-sm space-y-3 opacity-80"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <span className="font-extrabold text-slate-400 text-xs">OS #{pedido.id_int}</span>
                        <h4 className="font-bold text-slate-700 dark:text-slate-300 text-xs mt-0.5">
                          {pedido.clienteNome}
                        </h4>
                      </div>
                      
                      {/* Carrier Tag */}
                      <span className={`text-[9px] border px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${carrier.color}`}>
                        <span>{carrier.icon}</span>
                        <span>{carrier.name}</span>
                      </span>
                    </div>

                    <div className="text-[10px] text-slate-400 flex justify-between items-center border-t border-slate-100 dark:border-slate-800 pt-2">
                      <span>Despachado: {pedido.volumes || 1} vol(s) • {pedido.pesoAferido?.toFixed(2) || pedido.pesoTeorico.toFixed(2)} kg</span>
                      <Link
                        href={`/pedidos/${pedido.id_int}`}
                        className="text-blue-500 font-bold hover:underline"
                      >
                        Ver detalhes
                      </Link>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12 text-slate-400 text-xs">
                Nenhum pedido despachado hoje ainda.
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
