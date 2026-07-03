"use client";

import { useState, useEffect, useRef } from "react";
import type { PropostaFormState } from "@/features/orcamentos/types";
import { ArtesDadosEventoCard } from "./ArtesDadosEventoCard";
import { ArtesUploadArquivosCard } from "./ArtesUploadArquivosCard";
import { ArtesDesignersListCard } from "./ArtesDesignersListCard";
import { ArtesUltimosPedidosCard } from "./ArtesUltimosPedidosCard";
import { carregarBriefingArtes, salvarBriefingArtes, listarArquivosDaProposta } from "@/features/pedidos/services/pedidos-artes.service";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { Save, Send } from "lucide-react";

interface ArtesTabProps {
  form: PropostaFormState;
  onBriefingChange?: (draft: any) => void;
}

export function ArtesTab({ form, onBriefingChange }: ArtesTabProps) {
  const idCliente = form.clienteId || null;
  const { showToast } = useAppToast();
  const { user } = useAuth();

  const [nomeEvento, setNomeEvento] = useState("");
  const [dataEvento, setDataEvento] = useState("");
  const [localEvento, setLocalEvento] = useState("");
  const [observacoesItens, setObservacoesItens] = useState<Record<string, string>>({});
  const [selectedDesignerId, setSelectedDesignerId] = useState<string | null>(null);
  const [selectedDesignerNome, setSelectedDesignerNome] = useState<string | null>(null);
  const [arquivos, setArquivos] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const prevIdIntRef = useRef<string | number>(form.id_int);

  const loadData = async (mounted: boolean) => {
    if (form.id_int === "NOVO") {
      if (mounted) setIsInitialLoad(false);
      return;
    }
    const data = await carregarBriefingArtes(Number(form.id_int));
    if (!mounted) return;
    
    if (data) {
      setNomeEvento(data.nome_evento || "");
      if (data.data_evento) {
        const parts = data.data_evento.split("T");
        setDataEvento(parts[0] || "");
      }
      setLocalEvento(data.local_evento || "");
      setObservacoesItens(data.observacoes || {});
      setSelectedDesignerId(data.designer_uid || null);
      setSelectedDesignerNome(data.designer_nome || null);
      setArquivos(data.arquivos || []);
    } else {
      setArquivos([]);
    }
    setIsInitialLoad(false);
  };

  useEffect(() => {
    let isMounted = true;

    // Se mudou de orçamento e o componente continuou montado
    if (form.id_int !== prevIdIntRef.current) {
      setNomeEvento(form.briefingArtesDraft?.nome_evento || "");
      setDataEvento(form.briefingArtesDraft?.data_evento ? form.briefingArtesDraft.data_evento.split("T")[0] : "");
      setLocalEvento(form.briefingArtesDraft?.local_evento || "");
      setObservacoesItens(form.briefingArtesDraft?.observacoes || {});
      setSelectedDesignerId(form.briefingArtesDraft?.designer_uid || null);
      setSelectedDesignerNome(form.briefingArtesDraft?.designer_nome || null);
      setArquivos(form.briefingArtesDraft?.arquivos || []);
      prevIdIntRef.current = form.id_int;
      setIsInitialLoad(true);
      loadData(isMounted);
    } else if (isInitialLoad && form.briefingArtesDraft) {
      // Se acabou de montar e já tem draft em memória (ex: voltou pra aba)
      setNomeEvento(form.briefingArtesDraft.nome_evento || "");
      setDataEvento(form.briefingArtesDraft.data_evento ? form.briefingArtesDraft.data_evento.split("T")[0] : "");
      setLocalEvento(form.briefingArtesDraft.local_evento || "");
      setObservacoesItens(form.briefingArtesDraft.observacoes || {});
      setSelectedDesignerId(form.briefingArtesDraft.designer_uid || null);
      setSelectedDesignerNome(form.briefingArtesDraft.designer_nome || null);
      setArquivos(form.briefingArtesDraft.arquivos || []);
      setIsInitialLoad(false);
    } else if (isInitialLoad) {
      // Primeira montagem sem draft
      loadData(isMounted);
    }

    return () => {
      isMounted = false;
    };
  }, [form.id_int, form.briefingArtesDraft, isInitialLoad]);

  // Sincroniza estado local da aba com o estado global do Form
  useEffect(() => {
    if (!isInitialLoad && onBriefingChange) {
      onBriefingChange({
        nome_evento: nomeEvento,
        data_evento: dataEvento ? `${dataEvento}T00:00:00` : null,
        local_evento: localEvento,
        observacoes: observacoesItens,
        designer_uid: selectedDesignerId,
        designer_nome: selectedDesignerNome,
        arquivos: arquivos,
      });
    }
  }, [nomeEvento, dataEvento, localEvento, observacoesItens, selectedDesignerId, selectedDesignerNome, arquivos, isInitialLoad, onBriefingChange]);

  const handleUploadSuccess = async () => {
    if (form.id_int === "NOVO") return;
    const novosArquivos = await listarArquivosDaProposta(Number(form.id_int));
    setArquivos(novosArquivos || []);
  };

  const handleSaveBriefing = async () => {
    if (form.id_int === "NOVO" || !form.id_int) return;
    
    // Validação de obrigatoriedade ao enviar para arte
    if (selectedDesignerId && !nomeEvento.trim()) {
      showToast({ type: "warning", title: "Atenção", description: "Informe o Nome do Evento / Tema antes de enviar para arte." });
      return;
    }

    setIsSaving(true);
    try {
      const finalDate = dataEvento ? `${dataEvento}T00:00:00` : null;
      const rawStatus = selectedDesignerId ? "EM ARTE" : "AGUARDANDO";

      const savedData = await salvarBriefingArtes(Number(form.id_int), {
        nome_evento: nomeEvento,
        data_evento: finalDate,
        local_evento: localEvento,
        observacoes: observacoesItens,
        designer_uid: selectedDesignerId,
        designer_nome: selectedDesignerNome,
        status: rawStatus as any,
        enviado_por: user?.name || user?.email || "Usuário do Sistema",
        enviado_por_uid: user?.id,
      });

      if (savedData) {
        setNomeEvento(savedData.nome_evento || "");
        if (savedData.data_evento) {
          const parts = savedData.data_evento.split("T");
          setDataEvento(parts[0] || "");
        }
        setLocalEvento(savedData.local_evento || "");
        setObservacoesItens(savedData.observacoes || {});
        setSelectedDesignerId(savedData.designer_uid || null);
        setSelectedDesignerNome(savedData.designer_nome || null);
        setArquivos(savedData.arquivos || []);
        showToast({ type: "success", title: "Dados da arte salvos com sucesso!" });
      } else {
        showToast({ type: "error", title: "Falha ao salvar dados da arte. Verifique o console." });
      }
    } catch (err) {
      showToast({ type: "error", title: "Erro inesperado ao salvar dados da arte." });
    } finally {
      setIsSaving(false);
    }
  };

  const hasDesigner = !!selectedDesignerId;
  const hasModels = form.pedidosModelos && form.pedidosModelos.length > 0;

  if (!hasModels) {
    return (
      <div className="space-y-6 relative pb-24">
        <div className="rounded-3xl border border-dashed border-amber-300 bg-amber-50 p-10 text-center">
          <p className="text-sm font-semibold text-amber-800">Configure os modelos/lotes na aba Pedido antes de iniciar a etapa de Artes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative pb-24">
      <div className="grid gap-6">
        <ArtesDadosEventoCard 
          itens={form.itens} 
          nomeEvento={nomeEvento} setNomeEvento={setNomeEvento}
          dataEvento={dataEvento} setDataEvento={setDataEvento}
          localEvento={localEvento} setLocalEvento={setLocalEvento}
          observacoesItens={observacoesItens} setObservacoesItens={setObservacoesItens}
        />
        <ArtesUploadArquivosCard 
          propostaStatus={form.id_int === "NOVO" ? "NOVO" : "EDIT"} 
          idInt={form.id_int !== "NOVO" ? form.id_int : null}
          arquivos={arquivos}
          onUploadSuccess={handleUploadSuccess}
        />
        
        <div className="grid gap-6 md:grid-cols-2">
          <ArtesDesignersListCard 
            selectedDesignerId={selectedDesignerId} 
            setSelectedDesignerId={setSelectedDesignerId}
            setSelectedDesignerNome={setSelectedDesignerNome}
          />
          <ArtesUltimosPedidosCard idCliente={idCliente} idIntAtual={form.id_int} />
        </div>
      </div>

      {/* Floating Button Container */}
      <div className="sticky bottom-28 md:bottom-24 z-40 w-full pointer-events-none flex justify-center md:justify-start md:pl-8">
        <button
          type="button"
          disabled={isSaving || form.id_int === "NOVO"}
          onClick={handleSaveBriefing}
          className={`pointer-events-auto flex items-center gap-2 rounded-full px-6 py-4 shadow-xl transition-all font-bold ${
            hasDesigner 
              ? "bg-indigo-600 hover:bg-indigo-700 text-white hover:scale-105" 
              : "bg-slate-800 hover:bg-slate-900 text-white"
          }`}
        >
          {isSaving ? (
            <span className="flex items-center gap-2">
               Salvando...
            </span>
          ) : hasDesigner ? (
            <>
              <Send size={20} />
              Enviar para arte
            </>
          ) : (
            <>
              <Save size={20} />
              Salvar dados da arte
            </>
          )}
        </button>
      </div>
    </div>
  );
}
