"use client";

import { useState, useEffect } from "react";
import { FormSection } from "@/features/orcamentos/OrcamentoFormPage";
import type { Proposta, PropostaFormState } from "@/features/orcamentos/types";
import { useAppToast } from "@/components/common/AppToast";
import { anexarArteVersao1, listarArquivosDaProposta, excluirArte } from "@/features/pedidos/services/pedidos-artes.service";
import type { PedidoArte } from "@/features/producao/types";
import { FileText, Download, Trash2, Image as ImageIcon } from "lucide-react";

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
  const [arquivosSalvos, setArquivosSalvos] = useState<PedidoArte[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [observacoesLote, setObservacoesLote] = useState("");

  const carregarLista = async () => {
    if (!idInt || idInt === "NOVO") {
      setIsLoadingList(false);
      return;
    }
    setIsLoadingList(true);
    const lista = await listarArquivosDaProposta(Number(idInt));
    setArquivosSalvos(lista);
    setIsLoadingList(false);
  };

  useEffect(() => {
    carregarLista();
  }, [idInt]);

  const handleOpenModal = () => {
    console.log('[ARTES] id_int atual:', idInt);
    console.log('[ARTES] Buscando modelos da proposta... (Dados recebidos via prop form.pedidosModelos da raiz)');
    console.log('[ARTES] Modelos retornados:', modelos);

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

  const handleExcluirArquivo = async (id: number) => {
    if (!window.confirm("Deseja realmente excluir este arquivo de referência?")) {
      return;
    }

    try {
      const result = await excluirArte(id);
      if (result.success) {
        showToast({ type: "success", title: "Arquivo excluído com sucesso." });
        carregarLista();
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
      carregarLista();
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

          {!isLoadingList && arquivosSalvos.length > 0 && (
            <div className="mt-6 border-t border-slate-100 pt-6">
              <h4 className="text-sm font-bold text-slate-800 mb-4">Arquivos Anexados</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                {arquivosSalvos.map((arq) => (
                  <div key={arq.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm border border-slate-100 text-teal-600">
                      {arq.mime_type?.includes("pdf") ? <FileText size={20} /> : <ImageIcon size={20} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-700" title={arq.nome_arquivo ?? undefined}>
                        {arq.nome_arquivo}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {(() => {
                          const modeloIdStr = arq.id_modelo ? String(arq.id_modelo) : null;
                          const modelFound = modelos.find(m => String(m.id) === modeloIdStr);
                          return modelFound ? `Modelo: ${modelFound.nome_modelo}` : "Modelo não identificado";
                        })()}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {arq.tamanho_bytes ? (arq.tamanho_bytes / 1024 / 1024).toFixed(2) + " MB" : ""} 
                        {arq.created_at && ` • ${new Date(arq.created_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {arq.url_arquivo && (
                        <a
                          href={arq.url_arquivo}
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
                        onClick={() => handleExcluirArquivo(Number(arq.id))}
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
                  accept=".jpg,.jpeg,.png,.pdf"
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
