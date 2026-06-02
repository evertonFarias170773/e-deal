"use client";

import { useState, useEffect } from "react";
import { usePedidosMockDb } from "./hooks/usePedidosMockDb";
import { useAppToast } from "@/components/common/AppToast";
import { AlertCircle, CheckCircle2, XCircle, ZoomIn, ZoomOut, FileText, Send, User } from "lucide-react";

interface ClienteAprovacaoPageProps {
  token: string;
}

export function ClienteAprovacaoPage({ token }: ClienteAprovacaoPageProps) {
  const { showToast } = useAppToast();
  const { pedidos, isLoaded, registrarDecisaoCliente } = usePedidosMockDb();

  const [zoomLevel, setZoomLevel] = useState(1);
  const [approverName, setApproverName] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showApprovalForm, setShowApprovalForm] = useState(false);
  const [showRejectForm, setShowRejectForm] = useState(false);

  // Find the target order and model by token
  let targetPedido: any = null;
  let targetModelo: any = null;

  for (const p of pedidos) {
    const found = p.modelos.find((m) => m.tokenAprovacao === token);
    if (found) {
      targetPedido = p;
      targetModelo = found;
      break;
    }
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-white">
        <div className="text-center space-y-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent mx-auto"></div>
          <p className="text-slate-400 font-semibold text-sm">Carregando painel de aprovação...</p>
        </div>
      </div>
    );
  }

  if (!targetPedido || !targetModelo) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
          <h2 className="text-lg font-bold text-white">Link de Aprovação Inválido</h2>
          <p className="text-sm text-slate-400">
            Este token de aprovação não corresponde a nenhum lote ou modelo ativo no sistema local.
          </p>
        </div>
      </div>
    );
  }

  const handleApprove = () => {
    if (!approverName.trim()) {
      showToast({
        type: "warning",
        title: "Nome do responsável",
        description: "Digite seu nome para assinar a aprovação da arte."
      });
      return;
    }

    registrarDecisaoCliente(token, "APROVADA_CLIENTE", undefined, approverName);
    setShowApprovalForm(false);
    showToast({
      type: "success",
      title: "Arte aprovada com sucesso!",
      description: "Obrigado! A equipe de pré-impressão foi notificada para liberação da OS."
    });
  };

  const handleReject = () => {
    if (!rejectReason.trim()) {
      showToast({
        type: "warning",
        title: "Motivo obrigatório",
        description: "Descreva brevemente o ajuste necessário para orientar o designer."
      });
      return;
    }

    registrarDecisaoCliente(token, "REPROVADA_CLIENTE", rejectReason);
    setShowRejectForm(false);
    showToast({
      type: "info",
      title: "Solicitação de alteração enviada",
      description: "Ajustes enviados para a fila do designer responsável."
    });
  };

  const zoomIn = () => setZoomLevel((z) => Math.min(z + 0.25, 2));
  const zoomOut = () => setZoomLevel((z) => Math.max(z - 0.25, 0.75));

  const isPending =
    targetModelo.statusArte === "AGUARDANDO_CLIENTE" ||
    targetModelo.statusArte === "EM_REVISAO_INTERNA";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center py-8 px-4">
      {/* Header Banner - UX Prototype Alert */}
      <div className="max-w-md w-full mb-6 bg-blue-950/80 border border-blue-800 rounded-2xl p-4 text-xs text-blue-300 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-extrabold text-blue-200 uppercase">VISÃO DO CLIENTE (SIMULAÇÃO)</h4>
          <p className="mt-1">
            Esta tela simula o portal de aprovação que o cliente final acessa no celular. Aprovar ou reprovar aqui atualizará instantaneamente a fila interna do ERP.
          </p>
        </div>
      </div>

      <main className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-xl space-y-6">
        {/* Lote Title */}
        <div className="border-b border-slate-800 pb-3 flex justify-between items-start">
          <div className="space-y-1">
            <span className="text-[10px] bg-slate-800 font-extrabold text-slate-300 px-2 py-0.5 rounded uppercase">
              Ideal Gráfica Expressa
            </span>
            <h2 className="font-extrabold text-lg text-white">{targetModelo.nomeModelo}</h2>
            <p className="text-xs text-slate-400">
              Qtd: <strong className="text-slate-200">{targetModelo.quantidade.toLocaleString("pt-BR")} un.</strong>
            </p>
          </div>
        </div>

        {/* Art Preview Panel */}
        <div className="space-y-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-bold text-slate-400">Layout para Aprovação</span>
            <div className="flex gap-1.5">
              <button
                onClick={zoomOut}
                className="h-7 w-7 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition"
                title="Zoom Out"
              >
                <ZoomOut className="h-4 w-4 text-slate-300" />
              </button>
              <button
                onClick={zoomIn}
                className="h-7 w-7 rounded bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition"
                title="Zoom In"
              >
                <ZoomIn className="h-4 w-4 text-slate-300" />
              </button>
            </div>
          </div>

          {/* Art canvas mockup */}
          <div className="relative border border-slate-800 bg-slate-950 rounded-2xl h-48 flex items-center justify-center overflow-hidden">
            <div
              className="w-80 h-28 rounded-xl border border-slate-700/50 shadow-lg flex flex-col justify-between p-3 select-none transition-transform duration-200"
              style={{
                transform: `scale(${zoomLevel})`,
                background: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)"
              }}
            >
              {/* Wristband details simulator */}
              <div className="flex justify-between items-start">
                <span className="text-[9px] font-bold tracking-wider text-blue-200">IDEAL WRISTBAND</span>
                <span className="text-[9px] font-mono text-white tracking-widest">#0001</span>
              </div>
              <div className="text-center py-1">
                <p className="text-[11px] font-extrabold text-white uppercase tracking-wider">EVENTOS BRASIL S/A</p>
                <p className="text-[8px] text-blue-100 tracking-wide mt-0.5">ACESSO VIP • 15/JUNHO/2026</p>
              </div>
              <div className="flex justify-between items-end">
                <div className="h-5 w-5 bg-white rounded flex items-center justify-center p-0.5">
                  {/* Mock QR Code */}
                  <div className="w-full h-full bg-slate-950 flex flex-wrap p-px gap-[2px]">
                    <div className="w-1 h-1 bg-white"></div>
                    <div className="w-1.5 h-1.5 bg-white"></div>
                    <div className="w-1 h-1 bg-white"></div>
                  </div>
                </div>
                <span className="text-[8px] font-semibold text-blue-300">IDEAL BILÔ</span>
              </div>
            </div>
          </div>
        </div>

        {/* State Alerts */}
        {!isPending && (
          <div className="pt-2">
            {targetModelo.statusArte === "APROVADA_CLIENTE" && (
              <div className="rounded-2xl border border-teal-900 bg-teal-950/30 p-4 text-teal-400 space-y-1">
                <span className="font-bold flex items-center gap-1.5 text-sm">
                  <CheckCircle2 className="h-4.5 w-4.5 text-teal-500" />
                  Arte Aprovada por Você
                </span>
                <p className="text-xs text-teal-500/90">
                  Responsável: <strong className="text-teal-400">{targetModelo.aprovadoPorNome}</strong> em{" "}
                  {new Date(targetModelo.aprovadoEm ?? "").toLocaleDateString()}.
                </p>
              </div>
            )}

            {targetModelo.statusArte === "REPROVADA_CLIENTE" && (
              <div className="rounded-2xl border border-red-900 bg-red-950/30 p-4 text-red-400 space-y-1">
                <span className="font-bold flex items-center gap-1.5 text-sm">
                  <XCircle className="h-4.5 w-4.5 text-red-500" />
                  Alteração Solicitada
                </span>
                <p className="text-xs text-red-500/90">
                  Aguarde. O designer já foi notificado dos ajustes sugeridos.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Actions section for Pending approvals */}
        {isPending && !showApprovalForm && !showRejectForm && (
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowApprovalForm(true)}
              className="flex-1 h-11 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-2xl transition flex items-center justify-center gap-1.5"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Aprovar Arte</span>
            </button>
            <button
              onClick={() => setShowRejectForm(true)}
              className="flex-1 h-11 bg-red-950/40 hover:bg-red-950/60 border border-red-900 text-red-400 text-sm font-bold rounded-2xl transition flex items-center justify-center gap-1.5"
            >
              <XCircle className="h-4 w-4" />
              <span>Pedir Ajustes</span>
            </button>
          </div>
        )}

        {/* Approval Form */}
        {showApprovalForm && (
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              Confirmar Aprovação
            </h4>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-slate-400">Nome do Responsável:</label>
              <input
                type="text"
                placeholder="Ex: Maria Comercial / Diretor X"
                value={approverName}
                onChange={(e) => setApproverName(e.target.value)}
                className="w-full h-9 px-3 rounded-xl border border-slate-800 bg-slate-900 text-xs text-white placeholder-slate-600 focus:outline-none"
              />
            </div>
            <div className="flex gap-2 text-xs">
              <button
                onClick={handleApprove}
                className="flex-1 h-9 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-xl transition"
              >
                Confirmar
              </button>
              <button
                onClick={() => setShowApprovalForm(false)}
                className="h-9 px-3 border border-slate-800 rounded-xl text-slate-400 font-semibold"
              >
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* Rejection/Ajustes Form */}
        {showRejectForm && (
          <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" />
              Descrever Ajustes Necessários
            </h4>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold text-slate-400">Descreva as alterações:</label>
              <textarea
                placeholder="Ex: Corrigir data do evento para 16/junho, ou aproximar logo..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full h-16 px-3 py-2 rounded-xl border border-slate-800 bg-slate-900 text-xs text-white placeholder-slate-600 resize-none focus:outline-none"
              />
            </div>
            <div className="flex gap-2 text-xs">
              <button
                onClick={handleReject}
                className="flex-1 h-9 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl transition flex items-center justify-center gap-1"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Enviar Ajustes</span>
              </button>
              <button
                onClick={() => setShowRejectForm(false)}
                className="h-9 px-3 border border-slate-800 rounded-xl text-slate-400 font-semibold"
              >
                Voltar
              </button>
            </div>
          </div>
        )}

        {/* History of versions */}
        {targetModelo.historicoArtes.length > 0 && (
          <div className="border-t border-slate-800 pt-4 space-y-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wide block">Histórico de Layouts</span>
            <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
              {targetModelo.historicoArtes.map((hist: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between text-[11px] text-slate-500 py-0.5">
                  <span className="flex items-center gap-1 truncate">
                    <FileText className="h-3 w-3 text-slate-600" />
                    v{hist.versao} — {hist.nomeArquivo}
                  </span>
                  <span className={`font-bold ${
                    hist.status === "LIBERADA" || hist.status === "APROVADA_CLIENTE" ? "text-teal-600" :
                    hist.status === "REPROVADA_CLIENTE" ? "text-red-600" : "text-slate-600"
                  }`}>
                    {hist.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
