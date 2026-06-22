"use client";

import { useState } from "react";
import { FormSection } from "@/features/orcamentos/OrcamentoFormPage";
import type { Proposta, PropostaFormState } from "@/features/orcamentos/types";
import { useAppToast } from "@/components/common/AppToast";
import { anexarArteVersao1 } from "@/features/pedidos/services/pedidos-artes.service";

interface PedidoModeloState {
  id?: string;
  id_produto_proposta_origem: string | null;
  id_int: string | null;
  nome_modelo: string;
}

interface ArtesUploadArquivosCardProps {
  propostaStatus: "NOVO" | "EDIT";
  idInt: string | null;
  modelos: any[];
}

export function ArtesUploadArquivosCard({
  propostaStatus,
  idInt,
  modelos,
}: ArtesUploadArquivosCardProps) {
  const { showToast } = useAppToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedModeloId, setSelectedModeloId] = useState<string>("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [observacoesLote, setObservacoesLote] = useState("");

  const handleOpenModal = () => {
    if (propostaStatus === "NOVO" || !idInt) {
      showToast({ type: "warning", title: "Salve a proposta antes de anexar arquivos de referência." });
      return;
    }
    if (modelos.length === 0) {
      showToast({ type: "warning", title: "Crie ao menos um modelo na aba Pedido antes de anexar arquivos de arte." });
      return;
    }
    setModalOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setArquivos(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (!selectedModeloId) {
      showToast({ type: "error", title: "Selecione um modelo relacionado." });
      return;
    }
    if (arquivos.length === 0) {
      showToast({ type: "error", title: "Selecione ao menos um arquivo." });
      return;
    }
    if (!idInt) return;

    setIsUploading(true);
    let successCount = 0;
    for (const file of arquivos) {
      try {
        const result = await anexarArteVersao1({
          idInt: Number(idInt),
          idModelo: selectedModeloId,
          arquivo: file,
          enviadoPor: "Vendedor", // Could be from logged user, but currently hardcoded fallback
        });
        if (result.success) {
          successCount++;
        } else {
          showToast({ type: "error", title: `Erro ao subir ${file.name}`, description: result.error });
        }
      } catch (err: any) {
        showToast({ type: "error", title: `Erro inesperado: ${err.message}` });
      }
    }
    setIsUploading(false);

    if (successCount > 0) {
      showToast({ type: "success", title: `${successCount} arquivo(s) anexado(s) com sucesso!` });
      setModalOpen(false);
      setArquivos([]);
      setSelectedModeloId("");
      setObservacoesLote("");
    }
  };

  return (
    <>
      <FormSection
        title="Arquivos de referência"
        description="Anexe referências visuais, logos, planilhas de formandos ou arquivos que ajudem os designers a montar as artes."
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col items-center justify-center py-10">
          <button
            type="button"
            onClick={handleOpenModal}
            className="rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
          >
            Adicionar arquivos de referência
          </button>
        </div>
      </FormSection>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-4 mb-4">
              Selecione um Arquivo
            </h3>
            <div className="space-y-4">
              <div className="flex flex-col">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Modelo relacionado
                </label>
                <select
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 transition focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/10"
                  value={selectedModeloId}
                  onChange={(e) => setSelectedModeloId(e.target.value)}
                >
                  <option value="">-- Selecione um modelo --</option>
                  {modelos.filter(m => m.id).map(m => (
                    <option key={m.id} value={m.id}>
                      {m.nome_modelo}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Arquivos
                </label>
                <input
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100"
                />
              </div>

              {arquivos.length > 0 && (
                <div className="flex flex-col">
                  <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                    {arquivos.length === 1 ? "Título do Documento" : "Título do Lote"}
                  </label>
                  <input
                    type="text"
                    disabled
                    value={arquivos.length === 1 ? arquivos[0].name : `${arquivos.length} arquivos selecionados`}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 cursor-not-allowed"
                  />
                </div>
              )}

              <div className="flex flex-col">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  {arquivos.length === 1 ? "Observações do documento" : "Observações do lote"}
                </label>
                <textarea
                  rows={2}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 transition focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/10 resize-none"
                  value={observacoesLote}
                  onChange={(e) => setObservacoesLote(e.target.value)}
                  placeholder="Instruções específicas para o designer..."
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition"
                  disabled={isUploading}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={isUploading || !selectedModeloId || arquivos.length === 0}
                  className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 transition disabled:opacity-50"
                >
                  {isUploading ? "Enviando..." : "Adicionar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
