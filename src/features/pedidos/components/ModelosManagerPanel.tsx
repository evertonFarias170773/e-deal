"use client";

import { useState } from "react";
import { useAppToast } from "@/components/common/AppToast";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ProdutoMock, ModeloMock, ArteStatus, PedidoStatus } from "../types";
import {
  Link2,
  Upload,
  FileText,
  CheckCircle,
  AlertTriangle,
  RefreshCw,
  Eye,
  QrCode,
  Barcode,
  MessageSquare,
  User,
  Clock,
  Check,
  X,
  ShieldAlert,
  Sparkles,
  Plus,
  ChevronRight,
  Download,
  Wrench,
  Send,
  History
} from "lucide-react";
import Link from "next/link";

interface ModelosManagerPanelProps {
  idInt: number;
  produtos: ProdutoMock[];
  onUploadArte: (idModelo: string, fileName: string) => void;
  onLiberarArte: (idModelo: string) => void;
  onEnviarAprovacaoCliente: (idModelo: string) => void;
  onAdicionarComentarioInterno: (idModelo: string, comentario: string) => void;
  onRegistrarDecisaoCliente: (
    token: string,
    status: "APROVADA_CLIENTE" | "REPROVADA_CLIENTE",
    comentario?: string,
    clienteNome?: string
  ) => void;
}

export default function ModelosManagerPanel({
  idInt,
  produtos,
  onUploadArte,
  onLiberarArte,
  onEnviarAprovacaoCliente,
  onAdicionarComentarioInterno,
  onRegistrarDecisaoCliente
}: ModelosManagerPanelProps) {
  const { showToast } = useAppToast();

  // Active Designer simulation state
  const [selectedDesigner, setSelectedDesigner] = useState("Everton Farias");
  const designersList = ["Everton Farias", "Aline Gráfica", "Carlos Biro"];
  const designerStats: Record<string, { total: number; pendentes: number; revisoes: number; atrasos: number }> = {
    "Everton Farias": { total: 5, pendentes: 2, revisoes: 1, atrasos: 1 },
    "Aline Gráfica": { total: 3, pendentes: 1, revisoes: 0, atrasos: 0 },
    "Carlos Biro": { total: 4, pendentes: 1, revisoes: 2, atrasos: 1 }
  };

  // States for simulators
  const [selectedFileNames, setSelectedFileNames] = useState<Record<string, string>>({});
  const [clientNameSimulators, setClientNameSimulators] = useState<Record<string, string>>({});
  const [rejectionReasonSimulators, setRejectionReasonSimulators] = useState<Record<string, string>>({});
  const [internalCommentSimulators, setInternalCommentSimulators] = useState<Record<string, string>>({});

  // WhatsApp Simulated Tracker States
  const [whatsappTracker, setWhatsappTracker] = useState<Record<string, { viewed: boolean; waitTime: string }>>({});

  const handleFileChange = (modeloId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFileNames((prev) => ({ ...prev, [modeloId]: file.name }));
    }
  };

  const triggerUpload = (modeloId: string) => {
    const fileName = selectedFileNames[modeloId];
    if (!fileName) {
      showToast({
        type: "warning",
        title: "Nenhum arquivo selecionado",
        description: "Selecione um arquivo para simular o upload."
      });
      return;
    }
    onUploadArte(modeloId, fileName);

    // Clear selected file state
    setSelectedFileNames((prev) => {
      const next = { ...prev };
      delete next[modeloId];
      return next;
    });
    showToast({
      type: "success",
      title: "Arte carregada (Mock)",
      description: `Arquivo ${fileName} enviado para revisão interna.`
    });
  };

  const copyAprovacaoLink = (token: string, modeloId: string) => {
    const publicUrl = `${window.location.origin}/pedidos/aprovacao/${token}`;
    navigator.clipboard.writeText(publicUrl).then(() => {
      // Simulate that the customer viewed it shortly after sending the link
      setWhatsappTracker((prev) => ({
        ...prev,
        [modeloId]: { viewed: true, waitTime: "2m aguardando" }
      }));
      
      showToast({
        type: "success",
        title: "Link copiado!",
        description: "Link público de aprovação copiado. Rastreamento simulador ativado."
      });
    });
  };

  const simulateSendAction = (modeloId: string, token: string) => {
    onEnviarAprovacaoCliente(modeloId);
    setWhatsappTracker((prev) => ({
      ...prev,
      [modeloId]: { viewed: false, waitTime: "Menos de 1m aguardando" }
    }));
    showToast({
      type: "success",
      title: "Prova enviada!",
      description: "Prova digital gerada. Simulação de envio para o WhatsApp do cliente iniciada."
    });
  };

  const simularDecisaoCliente = (modeloId: string, token: string, status: "APROVADA_CLIENTE" | "REPROVADA_CLIENTE") => {
    const nome = clientNameSimulators[modeloId]?.trim() || "Cliente Final";
    const motivo = rejectionReasonSimulators[modeloId]?.trim() || "";

    if (status === "REPROVADA_CLIENTE" && !motivo) {
      showToast({
        type: "warning",
        title: "Motivo obrigatório",
        description: "Descreva o motivo da reprovação da arte para simular."
      });
      return;
    }

    onRegistrarDecisaoCliente(token, status, status === "REPROVADA_CLIENTE" ? motivo : undefined, status === "APROVADA_CLIENTE" ? nome : undefined);

    // Reset inputs
    setClientNameSimulators((prev) => ({ ...prev, [modeloId]: "" }));
    setRejectionReasonSimulators((prev) => ({ ...prev, [modeloId]: "" }));

    showToast({
      type: status === "APROVADA_CLIENTE" ? "success" : "error",
      title: status === "APROVADA_CLIENTE" ? "Aprovado via simulador" : "Reprovado via simulador",
      description: status === "APROVADA_CLIENTE"
        ? `Arte aprovada por: ${nome}.`
        : `Arte reprovada. Motivo: ${motivo}`
    });
  };

  const salvarComentarioInterno = (modeloId: string) => {
    const texto = internalCommentSimulators[modeloId]?.trim() || "";
    if (!texto) {
      showToast({
        type: "warning",
        title: "Anotação vazia",
        description: "Digite sua anotação interna antes de salvar."
      });
      return;
    }

    onAdicionarComentarioInterno(modeloId, texto);
    setInternalCommentSimulators((prev) => ({ ...prev, [modeloId]: "" }));
    showToast({
      type: "success",
      title: "Comentário interno salvo",
      description: "Anotação registrada e salva no localStorage."
    });
  };

  const getStatusTone = (status: ArteStatus) => {
    if (status === "LIBERADA" || status === "IMPRESSA" || status === "APROVADA_CLIENTE") return "success";
    if (status === "PENDENTE" || status === "EM_CRIACAO") return "neutral";
    if (status === "REPROVADA_CLIENTE") return "danger";
    return "info";
  };

  const getMaterialBgColor = (colorName: string) => {
    const name = colorName?.toLowerCase() || "";
    if (name.includes("verde") || name.includes("limão")) return "from-emerald-500 to-teal-600";
    if (name.includes("azul") || name.includes("tiffany")) return "from-cyan-500 to-blue-600";
    if (name.includes("vermelho")) return "from-rose-500 to-red-600";
    if (name.includes("amarelo") || name.includes("ouro")) return "from-amber-400 to-orange-500";
    if (name.includes("preto") || name.includes("black")) return "from-slate-800 to-slate-950";
    if (name.includes("rosa") || name.includes("pink")) return "from-pink-500 to-rose-600";
    return "from-indigo-500 to-blue-650";
  };

  const getStepIndex = (status: ArteStatus) => {
    if (status === "PENDENTE" || status === "EM_CRIACAO") return 0;
    if (status === "EM_REVISAO_INTERNA") return 1;
    if (status === "AGUARDANDO_CLIENTE") return 2;
    if (status === "REPROVADA_CLIENTE") return 3;
    if (status === "APROVADA_CLIENTE") return 4;
    if (status === "LIBERADA" || status === "IMPRESSA") return 6;
    return -1;
  };

  const stepsList = [
    { label: "EM DESENVOLVIMENTO", desc: "Design / Criação" },
    { label: "EM REVISÃO INTERNA", desc: "Verificação" },
    { label: "AGUARDANDO CLIENTE", desc: "Prova WhatsApp" },
    { label: "ALTERAÇÃO SOLICITADA", desc: "Ajuste pendente" },
    { label: "APROVADO CLIENTE", desc: "Assinatura digital" },
    { label: "HOMOLOGADO", desc: "Aprovação Vendedor" },
    { label: "LIBERADO PRODUÇÃO", desc: "Fila de Produção" }
  ];

  // Calculations for partial approval warning
  const totalModelos = produtos.flatMap((p) => p.modelos).length;
  const modelosLiberados = produtos
    .flatMap((p) => p.modelos)
    .filter((m) => m.statusArte === "LIBERADA" || m.statusArte === "NAO_NECESSARIA").length;
  const allLiberados = modelosLiberados === totalModelos;

  return (
    <div className="space-y-6 font-sans">
      {/* Banner Informativo */}
      <div className="rounded-xl border border-teal-200/40 bg-teal-50/50 p-4 text-teal-900 dark:bg-teal-950/10 dark:text-teal-300 flex items-start gap-3">
        <Sparkles className="h-5 w-5 text-teal-650 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-extrabold text-sm uppercase tracking-wide">Central de Pré-produção Gráfica & Homologação</h4>
          <p className="text-[11px] text-teal-700 dark:text-teal-400 mt-1 leading-relaxed">
            Painel industrial para controle de arquivos de arte, aprovação de prova digital e homologação final comercial.
            A impressão física dos lotes é bloqueada preventivamente até a liberação técnica das artes correspondentes.
          </p>
        </div>
      </div>

      {/* Painel do Designer / Mesa do Prepress */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 rounded-xl p-4 shadow-xs space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div className="space-y-1">
            <h4 className="font-extrabold text-xs text-[#0b2f4a] dark:text-blue-400 uppercase tracking-wider flex items-center gap-2">
              <User className="h-4.5 w-4.5" />
              <span>Mesa Operacional de Prepress & Design</span>
            </h4>
            <p className="text-[10px] text-slate-500 font-semibold">Monitoramento de carga de trabalho e gargalos dos designers gráficos</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500">Designer:</span>
            <select
              value={selectedDesigner}
              onChange={(e) => setSelectedDesigner(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-slate-200/60 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-xs text-slate-700 dark:text-slate-300 font-bold focus:outline-none"
            >
              {designersList.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Designer metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/40 dark:border-slate-800/20 rounded-xl flex flex-col justify-between">
            <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Lotes Atribuídos</span>
            <strong className="text-lg font-mono font-black mt-0.5 text-[#0b2f4a] dark:text-slate-250">
              {designerStats[selectedDesigner].total}
            </strong>
          </div>
          <div className="p-3 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/40 dark:border-slate-800/20 rounded-xl flex flex-col justify-between">
            <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Criação / Ajuste Pendente</span>
            <strong className="text-lg font-mono font-black mt-0.5 text-amber-600 dark:text-amber-450">
              {designerStats[selectedDesigner].pendentes}
            </strong>
          </div>
          <div className="p-3 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/40 dark:border-slate-800/20 rounded-xl flex flex-col justify-between">
            <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Aguardando Revisão</span>
            <strong className="text-lg font-mono font-black mt-0.5 text-blue-650 dark:text-blue-450">
              {designerStats[selectedDesigner].revisoes}
            </strong>
          </div>
          <div className="p-3 bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/40 dark:border-slate-800/20 rounded-xl flex flex-col justify-between border-l-4 border-l-red-500">
            <span className="text-[9px] text-slate-400 uppercase font-bold tracking-wider">Artes em Atraso</span>
            <strong className="text-lg font-mono font-black mt-0.5 text-red-650 dark:text-red-400">
              {designerStats[selectedDesigner].atrasos}
            </strong>
          </div>
        </div>
      </div>

      {/* Alerta de Aprovação Parcial / Bloqueio de OS */}
      <div className={`rounded-xl border p-4 text-xs ${
        allLiberados 
          ? "border-emerald-200/50 bg-emerald-50/30 text-emerald-900 dark:border-emerald-950/40 dark:bg-emerald-950/10 dark:text-emerald-300"
          : "border-amber-200/50 bg-amber-50/30 text-amber-900 dark:border-amber-950/40 dark:bg-amber-950/10 dark:text-amber-300"
      }`}>
        <div className="flex items-start gap-3">
          {allLiberados ? (
            <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0" />
          )}
          <div className="space-y-1">
            <h5 className="font-extrabold uppercase tracking-wide text-xs">
              {allLiberados 
                ? "✓ PROVA DE ENGENHARIA 100% HOMOLOGADA" 
                : "⚠️ PROVA DE ENGENHARIA PARCIALMENTE BLOQUEADA"}
            </h5>
            <p className="text-[11px] leading-relaxed font-medium">
              {allLiberados
                ? `Todas as artes desta OS foram homologadas pelo cliente e aprovadas pelo prepress. O pedido está liberado para o Chão de Fábrica.`
                : `A produção física deste pedido está retida. Apenas ${modelosLiberados} de ${totalModelos} lotes foram homologados e liberados pelo comercial. A gráfica não iniciará a impressão antes da liberação final de todos os modelos.`}
            </p>
          </div>
        </div>
      </div>

      {/* Lista de Produtos -> Modelos */}
      <div className="space-y-6">
        {produtos.map((prod) => {
          const prodModelos = prod.modelos || [];
          const prodLiberados = prodModelos.filter(m => m.statusArte === "LIBERADA" || m.statusArte === "NAO_NECESSARIA").length;
          
          return (
            <div key={prod.id} className="bg-white dark:bg-slate-900 border border-slate-200/40 dark:border-slate-800/30 rounded-xl p-4 shadow-xs space-y-4">
              {/* Cabeçalho do Agrupador de Produto */}
              <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800/60">
                <div className="space-y-0.5">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">GRUPO DE PRODUTOS</span>
                  <h4 className="text-sm font-black text-slate-900 dark:text-slate-100">{prod.nome}</h4>
                </div>
                <span className="bg-slate-50 dark:bg-slate-950/30 text-slate-600 dark:text-slate-400 text-[10px] font-black px-3 py-1 rounded border border-slate-200/60 dark:border-slate-850">
                  {prodLiberados} / {prodModelos.length} Lotes Liberados
                </span>
              </div>

              {/* Modelos do Produto */}
              <div className="grid gap-5">
                {prodModelos.map((m) => {
                  const hasFileSelected = Boolean(selectedFileNames[m.id]);
                  const isApproved = m.statusArte === "LIBERADA" || m.statusArte === "IMPRESSA";
                  const isAprovedByClient = m.statusArte === "APROVADA_CLIENTE";
                  const isRejected = m.statusArte === "REPROVADA_CLIENTE";
                  const tracker = whatsappTracker[m.id] || { viewed: false, waitTime: "Sem envio recente" };

                  return (
                    <div
                      key={m.id}
                      className={`border rounded-xl p-4 space-y-4 hover:shadow-xs transition duration-150 relative ${
                        isRejected 
                          ? "border-red-200 dark:border-red-950/60 bg-red-500/[0.01]" 
                          : isApproved
                            ? "border-slate-200/40 dark:border-slate-800/30"
                            : "border-slate-200/60 dark:border-slate-800/40"
                      }`}
                    >
                      {/* Linha Principal do Modelo */}
                      <div className="flex flex-wrap justify-between items-start gap-3 pb-2.5 border-b border-slate-100 dark:border-slate-800/40">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[#0b2f4a] dark:text-blue-400">
                              OS-{m.id}
                            </span>
                            <h5 className="font-extrabold text-xs text-[#0b2f4a] dark:text-slate-100">{m.nomeModelo}</h5>
                          </div>
                          <div className="text-[10px] text-slate-500 font-medium">
                            Setor: <strong className="text-slate-750 dark:text-slate-350 uppercase">{m.setor}</strong> • Quantidade: <strong className="text-slate-800 dark:text-slate-300">{m.quantidade.toLocaleString("pt-BR")} un.</strong>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Fase do Lote</span>
                          <StatusBadge status={m.statusArte} tone={getStatusTone(m.statusArte)} />
                        </div>
                      </div>

                      {/* Informações Operacionais de Pré-produção (11 Campos Obrigatórios) */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 bg-slate-50/40 dark:bg-slate-950/10 p-3 rounded-lg border border-slate-200/40 dark:border-slate-800/20 text-[10px] font-medium text-slate-650 dark:text-slate-450">
                        <div>
                          <span className="text-slate-400 block font-bold text-[8px] uppercase">VERSÃO ATUAL</span>
                          <strong className="text-slate-800 dark:text-slate-200 text-xs font-mono font-black">
                            v{m.arteAtual?.versao ?? 1}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-bold text-[8px] uppercase">DESIGNER RESP.</span>
                          <strong className="text-slate-800 dark:text-slate-200 text-[10px] font-black block truncate">
                            {m.designerResponsavel || "Everton Farias"}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-bold text-[8px] uppercase">AGUARDANDO QUEM?</span>
                          <strong className="text-[#0b2f4a] dark:text-blue-400 text-[9px] font-black uppercase">
                            {m.statusArte === "PENDENTE" || m.statusArte === "EM_CRIACAO" ? "Designer (Criação)" :
                             m.statusArte === "EM_REVISAO_INTERNA" ? "Atendente (Revisão)" :
                             m.statusArte === "AGUARDANDO_CLIENTE" ? "Cliente (Aprovação)" :
                             m.statusArte === "REPROVADA_CLIENTE" ? "Designer (Ajuste)" :
                             m.statusArte === "APROVADA_CLIENTE" ? "Vendedor (Homologar)" : "Fábrica (Impressão)"}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-bold text-[8px] uppercase">CLIENTE APROVOU?</span>
                          <strong className={`text-[9px] font-black uppercase ${
                            m.statusArte === "LIBERADA" || m.statusArte === "APROVADA_CLIENTE" ? "text-emerald-600" :
                            m.statusArte === "REPROVADA_CLIENTE" ? "text-red-650" : "text-amber-600"
                          }`}>
                            {m.statusArte === "LIBERADA" || m.statusArte === "APROVADA_CLIENTE" ? "APROVADO" :
                             m.statusArte === "REPROVADA_CLIENTE" ? "REPROVADO" : "PENDENTE"}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-bold text-[8px] uppercase">IMP. VERSO?</span>
                          <span className={`px-1.5 py-0.2 rounded font-black text-[9px] inline-block ${
                            m.verso 
                              ? "bg-purple-50 text-purple-700 dark:bg-purple-950/20 dark:text-purple-400 border border-purple-100 dark:border-purple-900/35"
                              : "bg-slate-100 text-slate-500 dark:bg-slate-800"
                          }`}>
                            {m.verso ? "SIM (F+V)" : "NÃO (SÓ F)"}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400 block font-bold text-[8px] uppercase">VARIÁVEIS</span>
                          <span className="text-slate-800 dark:text-slate-250 font-bold block truncate">
                            {m.configImpressao.qrCode ? "QR Code" : ""}
                            {m.configImpressao.codBarras ? (m.configImpressao.qrCode ? " + Cód" : "Cód Barras") : ""}
                            {!m.configImpressao.qrCode && !m.configImpressao.codBarras ? "Nenhum" : ""}
                          </span>
                        </div>
                      </div>

                      {/* Alertas de Gargalo Técnico */}
                      <div className="flex flex-wrap gap-1.5">
                        {m.statusArte === "PENDENTE" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[8px] font-black uppercase tracking-wider animate-pulse">
                            <Clock className="h-3 w-3" />
                            <span>Aguardando Designer (Criação)</span>
                          </span>
                        )}
                        {m.statusArte === "REPROVADA_CLIENTE" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400 text-[8px] font-black uppercase tracking-wider animate-pulse">
                            <X className="h-3 w-3" />
                            <span>Alteração Pendente (Arte Reprovada)</span>
                          </span>
                        )}
                        {m.statusArte === "AGUARDANDO_CLIENTE" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-955 dark:text-blue-400 text-[8px] font-black uppercase tracking-wider animate-pulse">
                            <Clock className="h-3 w-3 animate-spin" />
                            <span>Cliente Sem Resposta (Prova Digital)</span>
                          </span>
                        )}
                        {m.statusArte === "APROVADA_CLIENTE" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-850 dark:bg-amber-955 dark:text-amber-400 text-[8px] font-black uppercase tracking-wider animate-pulse">
                            <AlertTriangle className="h-3 w-3" />
                            <span>Homologação Comercial Pendente</span>
                          </span>
                        )}
                      </div>

                      {/* Stepper Visual de Pré-produção */}
                      <div className="flex justify-between items-center gap-1 text-[8px] font-mono font-black pt-2 pb-1 border-t border-slate-100 dark:border-slate-800/40">
                        {stepsList.map((step, idx) => {
                          const currentStepIdx = getStepIndex(m.statusArte);
                          const isActive = idx === currentStepIdx;
                          const isCompleted = idx < currentStepIdx;

                          let stepColor = "bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-650";
                          if (isActive) {
                            if (m.statusArte === "REPROVADA_CLIENTE") {
                              stepColor = "bg-red-500 text-white animate-pulse shadow-sm";
                            } else if (m.statusArte === "AGUARDANDO_CLIENTE") {
                              stepColor = "bg-amber-500 text-white animate-pulse shadow-sm";
                            } else if (m.statusArte === "APROVADA_CLIENTE") {
                              stepColor = "bg-indigo-600 text-white shadow-sm";
                            } else {
                              stepColor = "bg-[#0b2f4a] text-white shadow-sm";
                            }
                          } else if (isCompleted) {
                            stepColor = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-450";
                          } else if (m.statusArte === "LIBERADA" || m.statusArte === "IMPRESSA") {
                            stepColor = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-450";
                          }

                          return (
                            <div key={step.label} className="flex-1 flex flex-col items-center text-center">
                              <span className={`px-1.5 py-0.5 rounded uppercase tracking-tight font-extrabold w-full text-center truncate ${stepColor}`}>
                                {step.label}
                              </span>
                              <span className="text-[7px] text-slate-400 font-bold mt-0.5 truncate hidden sm:inline">{step.desc}</span>
                            </div>
                          );
                        })}
                      </div>

                      {/* Corpo do Detalhe em 2 Colunas */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
                        {/* COLUNA ESQUERDA: PREVIEW DO MOCKUP & HISTÓRICO */}
                        <div className="space-y-4">
                          <span className="text-[9px] font-bold text-slate-450 uppercase tracking-wider block">Mockup de Homologação</span>

                          {m.arteAtual ? (
                            <div className="relative rounded-xl overflow-hidden border border-slate-150 dark:border-slate-800 shadow-xs bg-slate-950 h-28 flex flex-col justify-between p-3 select-none">
                              {/* Background gradiente dinâmico */}
                              <div className={`absolute inset-0 bg-gradient-to-r ${getMaterialBgColor(m.corMaterial || "")} opacity-40 blur-xs`}></div>
                              <div className="absolute inset-0 bg-radial-gradient from-transparent to-black/60 z-0"></div>

                              <div className="relative z-10 flex justify-between items-start text-white text-[8px] font-mono">
                                <span className="bg-black/40 px-1.5 py-0.5 rounded font-extrabold tracking-wider">MESA OPERACIONAL</span>
                                <span className="text-slate-350 font-bold">Layout Versão v{m.arteAtual.versao}</span>
                              </div>

                              <div className="relative z-10 text-center my-auto">
                                <p className="text-white font-black text-xs uppercase tracking-wide drop-shadow-md">
                                  {m.nomeModelo}
                                </p>
                                <p className="text-[8px] text-slate-300 font-mono mt-0.5 drop-shadow-sm">
                                  {m.setor.toUpperCase()} • Qtd: {m.quantidade.toLocaleString("pt-BR")} • {m.corMaterial || "Padrão"}
                                </p>
                              </div>

                              <div className="relative z-10 flex justify-between items-end border-t border-white/10 pt-1">
                                <div className="flex gap-2">
                                  {m.configImpressao.qrCode && <QrCode className="h-3.5 w-3.5 text-white" />}
                                  {m.configImpressao.codBarras && <Barcode className="h-3.5 w-5 text-white" />}
                                </div>
                                <span className="text-white font-black font-mono text-[9px] drop-shadow-sm">
                                  {m.verso ? "FRENTE & VERSO" : "SÓ FRENTE"}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-slate-205 dark:border-slate-800 p-6 bg-slate-50/50 dark:bg-slate-950/20 text-center text-slate-400 dark:text-slate-650 text-xs flex flex-col items-center justify-center h-28">
                              <AlertTriangle className="h-5 w-5 text-slate-300 dark:text-slate-700 mb-1" />
                              <p className="font-bold text-slate-500">Sem Arquivo de Arte</p>
                              <p className="text-[9px] mt-0.5">Faça o upload do primeiro layout técnico abaixo.</p>
                            </div>
                          )}

                          {/* Versão Atual Detalhes */}
                          {m.arteAtual && (
                            <div className="bg-slate-50/40 dark:bg-slate-950/20 border border-slate-200/40 dark:border-slate-800/20 rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{m.arteAtual.nomeArquivo}</p>
                                  <p className="text-[9px] text-slate-450 mt-0.5">Upload em {new Date(m.arteAtual.dataUpload).toLocaleDateString()}</p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => alert(`Simulando visualização do arquivo PDF original: ${m.arteAtual?.nomeArquivo}`)}
                                className="h-8 px-2.5 rounded-lg border border-slate-200/60 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-[10px] font-bold transition flex items-center gap-1 shrink-0 bg-white dark:bg-slate-900"
                              >
                                <Eye className="h-3 w-3" />
                                <span>Ver PDF</span>
                              </button>
                            </div>
                          )}

                          {/* Upload Input */}
                          {(m.statusArte === "PENDENTE" || m.statusArte === "REPROVADA_CLIENTE" || m.statusArte === "EM_CRIACAO") && (
                            <div className="space-y-1.5">
                              <label className="text-[9px] font-bold text-slate-450 uppercase tracking-wider block">Upload Nova Versão de Layout</label>
                              <div className="flex gap-2 items-center">
                                <div className="relative flex-1">
                                  <input
                                    type="file"
                                    id={`file-upload-input-${m.id}`}
                                    onChange={(e) => handleFileChange(m.id, e)}
                                    className="hidden"
                                    accept=".pdf,.png,.ai"
                                  />
                                  <label
                                    htmlFor={`file-upload-input-${m.id}`}
                                    className="w-full h-9 rounded-xl border border-slate-200/60 dark:border-slate-850 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-650 dark:text-slate-400 flex items-center px-3 gap-2 cursor-pointer truncate hover:bg-slate-50/50"
                                  >
                                    <Upload className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                    <span className="truncate">{selectedFileNames[m.id] || "Carregar arquivo PDF/Layout..."}</span>
                                  </label>
                                </div>
                                {hasFileSelected && (
                                  <button
                                    type="button"
                                    onClick={() => triggerUpload(m.id)}
                                    className="h-9 px-3 rounded-xl bg-blue-650 hover:bg-blue-700 text-white text-xs font-bold transition shrink-0"
                                  >
                                    Carregar
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Timeline de Versões Visual */}
                          <div className="space-y-2 pt-2">
                            <span className="text-[9px] font-bold text-slate-450 uppercase tracking-wider block flex items-center gap-1">
                              <History className="h-3.5 w-3.5 text-slate-400" />
                              Histórico de Layouts
                            </span>
                            <div className="relative border-l border-slate-100 dark:border-slate-800/80 pl-4 ml-1.5 space-y-3">
                              {m.historicoArtes.length === 0 ? (
                                <div className="relative text-[10px] font-medium">
                                  <div className="absolute -left-[20.5px] top-1 h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-700"></div>
                                  <span className="font-bold text-slate-700 dark:text-slate-400">v1 (Sem Arquivo)</span>
                                  <p className="text-[9px] text-slate-400">Aguardando o upload inicial do designer gráfico.</p>
                                </div>
                              ) : (
                                m.historicoArtes.map((h, hIdx) => {
                                  let bulletColor = "bg-slate-300 dark:bg-slate-700";
                                  if (h.status === "LIBERADA" || h.status === "APROVADA_CLIENTE") {
                                    bulletColor = "bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.4)]";
                                  } else if (h.status === "REPROVADA_CLIENTE") {
                                    bulletColor = "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.4)]";
                                  } else if (h.status === "EM_REVISAO_INTERNA" || h.status === "AGUARDANDO_CLIENTE") {
                                    bulletColor = "bg-blue-500 shadow-[0_0_4px_rgba(59,130,246,0.4)]";
                                  }

                                  return (
                                    <div key={hIdx} className="relative text-[10px] font-medium space-y-0.5">
                                      <div className={`absolute -left-[21px] top-1 h-2 w-2 rounded-full ${bulletColor}`}></div>
                                      <div className="flex justify-between items-center text-slate-700 dark:text-slate-300">
                                        <span className="font-extrabold text-[10px]">v{h.versao} • {h.nomeArquivo}</span>
                                        <span className="text-[8px] text-slate-400 font-mono">{new Date(h.dataUpload).toLocaleDateString()}</span>
                                      </div>
                                      <p className="text-[9px] text-slate-400">
                                        Status: <strong className="uppercase">{h.status.replace(/_/g, " ")}</strong>
                                        {h.status === "REPROVADA_CLIENTE" && m.comentarioCliente && ` — "${m.comentarioCliente}"`}
                                        {h.status === "APROVADA_CLIENTE" && m.aprovadoPorNome && ` — Aprovado por ${m.aprovadoPorNome}`}
                                      </p>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>

                        {/* COLUNA DIREITA: COMENTÁRIOS E RASTREIO WHATSAPP */}
                        <div className="space-y-4">
                          <span className="text-[9px] font-bold text-slate-450 uppercase tracking-wider block">Homologação Comercial</span>

                          {/* Observações do Cliente (Se houver Rejeição) */}
                          {isRejected && m.comentarioCliente && (
                            <div className="bg-red-50/70 dark:bg-red-950/10 border border-red-200/50 dark:border-red-900/40 text-red-800 dark:text-red-300 rounded-xl p-3 text-xs space-y-1">
                              <span className="font-bold flex items-center gap-1 text-[10px] text-red-750 uppercase">
                                <ShieldAlert className="h-4 w-4" />
                                Motivo de Rejeição:
                              </span>
                              <p className="italic font-semibold text-[11px]">"{m.comentarioCliente}"</p>
                            </div>
                          )}

                          {/* Detalhes de Aprovação do Cliente */}
                          {isAprovedByClient && m.aprovadoPorNome && (
                            <div className="bg-emerald-50/70 dark:bg-emerald-950/10 border border-emerald-250/50 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-350 rounded-xl p-3 text-xs space-y-1">
                              <span className="font-bold flex items-center gap-1 text-[10px] text-emerald-700 uppercase">
                                <CheckCircle className="h-4 w-4" />
                                Prova Aprovada pelo Cliente:
                              </span>
                              <p className="font-semibold text-[10px] text-slate-650 dark:text-slate-400">
                                Aprovado por: <strong>{m.aprovadoPorNome}</strong> {m.aprovadoEm && `em ${new Date(m.aprovadoEm).toLocaleDateString()}`}
                              </p>
                            </div>
                          )}

                          {/* Anotações Internas */}
                          <div className="space-y-2">
                            <span className="text-[9px] font-bold text-slate-450 uppercase tracking-wider block">Notas de Produção Interna</span>

                            {m.comentarioInterno ? (
                              <div className="bg-amber-50/40 dark:bg-amber-950/10 border border-amber-200/40 dark:border-amber-900/30 rounded-xl p-3 text-xs relative space-y-1">
                                <span className="font-black text-amber-800 dark:text-amber-450 block text-[8px] uppercase tracking-wider">Anotação Operacional:</span>
                                <p className="text-slate-800 dark:text-slate-350 italic font-medium leading-relaxed">"{m.comentarioInterno}"</p>
                                <button
                                  type="button"
                                  onClick={() => onAdicionarComentarioInterno(m.id, "")}
                                  className="absolute top-2.5 right-2.5 text-slate-400 hover:text-slate-650 dark:hover:text-slate-300 font-extrabold text-[9px]"
                                  title="Remover anotação"
                                >
                                  Limpar
                                </button>
                              </div>
                            ) : (
                              <div className="text-xs text-slate-400 dark:text-slate-600 italic pl-1">
                                Nenhuma anotação técnica registrada.
                              </div>
                            )}

                            {/* Campo Notas */}
                            <div className="flex gap-2">
                              <input
                                type="text"
                                placeholder="Adicionar observação técnica..."
                                value={internalCommentSimulators[m.id] || ""}
                                onChange={(e) => setInternalCommentSimulators(prev => ({ ...prev, [m.id]: e.target.value }))}
                                className="flex-1 h-9 px-3 rounded-xl border border-slate-200/60 dark:border-slate-850 bg-white dark:bg-slate-950 text-xs focus:outline-none text-slate-800 dark:text-slate-200"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") salvarComentarioInterno(m.id);
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => salvarComentarioInterno(m.id)}
                                className="h-9 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl transition border border-slate-200/60 dark:border-slate-750"
                              >
                                Salvar
                              </button>
                            </div>
                          </div>

                          {/* Rastreio Whatsapp / Prova Digital (Apenas se enviado) */}
                          {m.statusArte === "AGUARDANDO_CLIENTE" && (
                            <div className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/40 dark:border-slate-800/30 rounded-xl p-3 space-y-2.5">
                              <div className="flex justify-between items-center text-xs">
                                <span className="font-extrabold text-[9px] text-slate-450 uppercase tracking-wider flex items-center gap-1.5">
                                  <Link2 className="h-3.5 w-3.5 text-blue-500" />
                                  Simulador WhatsApp Cliente
                                </span>
                                <span className="font-mono text-[8px] px-1.5 py-0.2 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-650 dark:text-blue-400 font-extrabold uppercase">
                                  Prova Digital
                                </span>
                              </div>

                              <div className="grid grid-cols-3 gap-2 text-center text-[9px] font-mono font-bold bg-white dark:bg-slate-900/60 p-2 rounded-lg border border-slate-100 dark:border-slate-800/40">
                                <div>
                                  <span className="text-slate-400 block uppercase text-[8px] mb-0.5">Enviado</span>
                                  <span className="text-emerald-600 dark:text-emerald-450 uppercase">SIM</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block uppercase text-[8px] mb-0.5">Visualizado</span>
                                  <span className="text-emerald-600 dark:text-emerald-450 uppercase">{tracker.viewed ? "SIM (✓✓)" : "NÃO (✓)"}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 block uppercase text-[8px] mb-0.5">Aguardando</span>
                                  <span className="text-amber-600 dark:text-amber-450 uppercase">{tracker.viewed ? tracker.waitTime : "Enviando..."}</span>
                                </div>
                              </div>

                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => copyAprovacaoLink(m.tokenAprovacao, m.id)}
                                  className="flex-1 h-8 rounded-lg bg-[#0b2f4a] hover:bg-[#123f61] text-white text-[10px] font-black transition flex items-center justify-center gap-1 shadow-sm"
                                >
                                  <Link2 className="h-3 w-3" />
                                  <span>Copiar Link</span>
                                </button>
                                <Link
                                  href={`/pedidos/aprovacao/${m.tokenAprovacao}`}
                                  target="_blank"
                                  className="h-8 px-2 rounded-lg border border-slate-200/60 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-350 text-[10px] font-bold flex items-center gap-0.5 hover:bg-slate-50 shrink-0"
                                >
                                  <Eye className="h-3 w-3" />
                                  <span>Abrir Prova</span>
                                </Link>
                              </div>
                            </div>
                          )}

                          {/* Simulador Decisão Cliente */}
                          {m.statusArte === "AGUARDANDO_CLIENTE" && (
                            <div className="bg-slate-50/50 dark:bg-slate-950/20 border border-slate-200/40 dark:border-slate-800/30 rounded-xl p-3 space-y-3">
                              <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-450">
                                <ShieldAlert className="h-4 w-4 text-blue-500 shrink-0" />
                                <span>Simulação de Decisão do Cliente (Mock)</span>
                              </div>
                              <div className="space-y-2">
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-450 uppercase block">Nome do Cliente:</label>
                                  <input
                                    type="text"
                                    placeholder="Ex: Everton Farias"
                                    value={clientNameSimulators[m.id] || ""}
                                    onChange={(e) => setClientNameSimulators(prev => ({ ...prev, [m.id]: e.target.value }))}
                                    className="w-full h-8 px-2.5 rounded-lg border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                                  />
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-450 uppercase block">Motivo Rejeição (Se reprovar):</label>
                                  <input
                                    type="text"
                                    placeholder="Motivo da reprovação..."
                                    value={rejectionReasonSimulators[m.id] || ""}
                                    onChange={(e) => setRejectionReasonSimulators(prev => ({ ...prev, [m.id]: e.target.value }))}
                                    className="w-full h-8 px-2.5 rounded-lg border border-slate-200/60 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 focus:outline-none"
                                  />
                                </div>
                                <div className="flex gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => simularDecisaoCliente(m.id, m.tokenAprovacao, "APROVADA_CLIENTE")}
                                    className="flex-1 h-8 rounded-lg bg-teal-650 hover:bg-teal-700 text-white font-bold text-[10px] transition flex items-center justify-center gap-1"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                    <span>Simular Aprovação</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => simularDecisaoCliente(m.id, m.tokenAprovacao, "REPROVADA_CLIENTE")}
                                    className="flex-1 h-8 rounded-lg bg-red-650 hover:bg-red-700 text-white font-bold text-[10px] transition flex items-center justify-center gap-1"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                    <span>Simular Rejeição</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Ações de Etapa de Aprovação */}
                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800/40 flex flex-col gap-2">
                            {m.statusArte === "EM_REVISAO_INTERNA" && (
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => simulateSendAction(m.id, m.tokenAprovacao)}
                                  className="flex-1 h-9 rounded-xl bg-[#0b2f4a] hover:bg-[#123f61] text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm"
                                >
                                  <Send className="h-3.5 w-3.5" />
                                  <span>Gerar e Enviar p/ Cliente</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onLiberarArte(m.id)}
                                  className="h-9 px-3.5 rounded-xl border border-slate-205 dark:border-slate-800 text-slate-600 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-850 text-xs font-semibold bg-white dark:bg-slate-900"
                                >
                                  Forçar Liberação
                                </button>
                              </div>
                            )}

                            {m.statusArte === "AGUARDANDO_CLIENTE" && (
                              <button
                                type="button"
                                onClick={() => copyAprovacaoLink(m.tokenAprovacao, m.id)}
                                className="w-full h-9 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-850 dark:text-slate-200 text-xs font-bold transition flex items-center justify-center gap-1.5 border border-slate-200/60 dark:border-slate-750"
                              >
                                <Link2 className="h-3.5 w-3.5" />
                                <span>Reenviar Link de Homologação</span>
                              </button>
                            )}

                            {isAprovedByClient && (
                              <button
                                type="button"
                                onClick={() => onLiberarArte(m.id)}
                                className="w-full h-9 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 shadow-sm"
                              >
                                <CheckCircle className="h-4 w-4" />
                                <span>Liberar para Produção (OS)</span>
                              </button>
                            )}

                            {isApproved && (
                              <div className="text-center text-xs text-teal-650 bg-teal-50/40 dark:bg-teal-950/10 border border-teal-150 dark:border-teal-900 rounded-xl py-2 font-bold flex items-center justify-center gap-1.5 select-none">
                                <CheckCircle className="h-4 w-4" />
                                <span>Lote Técnica e Comercial Aberto p/ Fábrica</span>
                              </div>
                            )}
                          </div>

                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
