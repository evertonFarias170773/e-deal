"use client";

import { useState, useEffect } from "react";
import { FormSection } from "@/features/orcamentos/OrcamentoFormPage";
import { useAuth } from "@/features/auth/AuthProvider";
import { useAppToast } from "@/components/common/AppToast";
import { anexarArquivoReferencia, listarArquivosDaProposta, excluirArquivo } from "@/features/pedidos/services/pedidos-artes.service";
import { FileText, Download, Trash2, Image as ImageIcon } from "lucide-react";

interface ArtesUploadArquivosCardProps {
  propostaStatus: "NOVO" | "EDIT";
  idInt: string | null;
  arquivos: any[];
  onUploadSuccess: () => void;
}

export function ArtesUploadArquivosCard({
  propostaStatus,
  idInt,
  arquivos: arquivosJsonb,
  onUploadSuccess
}: ArtesUploadArquivosCardProps) {
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const [modalOpen, setModalOpen] = useState(false);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const handleOpenModal = () => {
    if (propostaStatus === "NOVO" || !idInt) {
      showToast({ type: "warning", title: "Salve a proposta antes de anexar arquivos de referência." });
      return;
    }
    setModalOpen(true);
  };

  const handleExcluirArquivo = async (arquivoId: string) => {
    if (!window.confirm("Deseja realmente excluir este arquivo de referência?")) {
      return;
    }

    try {
      const result = await excluirArquivo(Number(idInt), arquivoId);
      if (result.success) {
        showToast({ type: "success", title: "Arquivo excluído com sucesso." });
        onUploadSuccess(); // trigger reload in parent
      } else {
        showToast({ type: "error", title: "Falha ao excluir arquivo", description: result.error });
      }
    } catch (err: any) {
      showToast({ type: "error", title: `Erro inesperado: ${err.message}` });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      const allowed = ["image/jpeg", "image/png", "application/pdf"];
      
      const invalidFiles = selected.filter(f => !allowed.includes(f.type));
      if (invalidFiles.length > 0) {
        showToast({ 
          type: "error", 
          title: "Formato inválido", 
          description: "Formato de arquivo não suportado. Apenas JPEG, PNG e PDF são permitidos." 
        });
        e.target.value = "";
        setArquivos([]);
        return;
      }

      setArquivos(selected);
    }
  };

  const handleUpload = async () => {
    if (arquivos.length === 0) {
      showToast({ type: "error", title: "Selecione ao menos um arquivo." });
      return;
    }
    if (!idInt) return;

        if (!user) {
      showToast({ type: "error", title: "Usuário não autenticado. Faça login para anexar arquivos." });
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    for (const file of arquivos) {
      try {
        const result = await anexarArquivoReferencia({
          idInt: Number(idInt),
          arquivo: file,
          enviadoPor: user?.name || user?.email || "Sistema",
          enviadoPorUid: user?.id,
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
      onUploadSuccess();
    }
  };

  return (
    <>
      <FormSection
        title="Arquivos de referência"
        description="Anexe referências visuais, logos, planilhas de formandos ou arquivos que ajudem os designers a montar as artes."
      >
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col items-center justify-center py-6">
            <button
              type="button"
              onClick={handleOpenModal}
              className="rounded-xl bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
            >
              Adicionar arquivos de referência
            </button>
          </div>

          {arquivosJsonb && arquivosJsonb.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-6">
              <h4 className="text-sm font-bold text-slate-800 mb-4">Arquivos Anexados</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {arquivosJsonb.map((arq) => (
                  <div key={arq.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm border border-slate-100 text-teal-600">
                      {arq.mime_type?.includes("pdf") ? <FileText size={20} /> : <ImageIcon size={20} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-700" title={arq.nome_arquivo}>
                        {arq.nome_arquivo}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {arq.enviado_por ? `Enviado por: ${arq.enviado_por}` : "Enviado por: Sistema"}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {arq.tamanho_bytes ? (arq.tamanho_bytes / 1024 / 1024).toFixed(2) + " MB" : ""} 
                        {arq.created_at && ` • ${new Date(arq.created_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {arq.storage_path && arq.storage_bucket && (
                        <a
                          href={`https://cctmvwzftbptcctmvwzft.supabase.co/storage/v1/object/public/${arq.storage_bucket}/${arq.storage_path}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-teal-600 hover:shadow-sm transition"
                          title="Abrir arquivo"
                        >
                          <Download size={18} />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleExcluirArquivo(arq.id)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-red-500 hover:shadow-sm transition"
                        title="Excluir arquivo"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </FormSection>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-800 border-b border-slate-100 pb-4 mb-4">
              Anexar Referência
            </h3>
            <div className="space-y-4">
              <div className="flex flex-col">
                <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500">
                  Arquivos
                </label>
                <input
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.pdf"
                  onChange={handleFileChange}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 file:mr-4 file:rounded-xl file:border-0 file:bg-teal-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-teal-700 hover:file:bg-teal-100"
                />
                {arquivos.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    {arquivos.length} arquivo(s) selecionado(s)
                  </p>
                )}
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  setArquivos([]);
                }}
                className="rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleUpload}
                disabled={isUploading || arquivos.length === 0}
                className="rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isUploading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
                    Enviando...
                  </>
                ) : (
                  "Adicionar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
