"use client";

import { useState, useEffect, useRef } from "react";
import type { PropostaFormState } from "@/features/orcamentos/types";
import { ArtesDadosEventoCard } from "./ArtesDadosEventoCard";
import { ArtesUploadArquivosCard } from "./ArtesUploadArquivosCard";
import { ArtesDesignersListCard } from "./ArtesDesignersListCard";
import { ArtesUltimosPedidosCard } from "./ArtesUltimosPedidosCard";
import { carregarBriefingArtes, salvarBriefingArtes } from "@/features/pedidos/services/pedidos-artes.service";
import { useAppToast } from "@/components/common/AppToast";

interface ArtesTabProps {
  form: PropostaFormState;
}

export function ArtesTab({ form }: ArtesTabProps) {
  const idCliente = form.clienteId || null;
  const { showToast } = useAppToast();

  // Estado global do briefing
  const [nomeEvento, setNomeEvento] = useState("");
  const [dataEvento, setDataEvento] = useState("");
  const [horaEvento, setHoraEvento] = useState("");
  const [localEvento, setLocalEvento] = useState("");
  const [observacoesItens, setObservacoesItens] = useState<Record<string, string>>({});
  const [selectedDesignerId, setSelectedDesignerId] = useState<string | null>(null);
  const [selectedDesignerNome, setSelectedDesignerNome] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const prevIdIntRef = useRef<string | number>(form.id_int);

  // Efeito 1: Carregamento Inicial & Limpeza ao trocar id_int
  useEffect(() => {
    let isMounted = true;

    // Se trocou de proposta, limpa tudo
    if (form.id_int !== prevIdIntRef.current) {
      setNomeEvento("");
      setDataEvento("");
      setHoraEvento("");
      setLocalEvento("");
      setObservacoesItens({});
      setSelectedDesignerId(null);
      setSelectedDesignerNome(null);
      prevIdIntRef.current = form.id_int;
      setIsInitialLoad(true);
    }

    if (form.id_int === "NOVO") {
      setIsInitialLoad(false);
      return;
    }

    // Carregar do banco
    carregarBriefingArtes(Number(form.id_int)).then((data) => {
      if (!isMounted) return;
      if (data) {
        setNomeEvento(data.nome_evento || "");
        if (data.data_evento) {
          const parts = data.data_evento.split("T");
          setDataEvento(parts[0] || "");
          setHoraEvento(parts[1] || "");
        }
        setLocalEvento(data.local_evento || "");
        setObservacoesItens(data.observacoes || {});
        setSelectedDesignerId(data.designer_uid || null);
        setSelectedDesignerNome(data.designer_nome || null);
      }
      setIsInitialLoad(false);
    });

    return () => {
      isMounted = false;
    };
  }, [form.id_int]);

  const handleSaveBriefing = async () => {
    if (form.id_int === "NOVO" || !form.id_int) return;
    setIsSaving(true);
    try {
      let finalDate = null;
      if (dataEvento) {
        finalDate = horaEvento ? `${dataEvento}T${horaEvento}` : `${dataEvento}T00:00:00`;
      }
      const savedData = await salvarBriefingArtes(Number(form.id_int), {
        nome_evento: nomeEvento,
        data_evento: finalDate,
        local_evento: localEvento,
        observacoes: observacoesItens,
        designer_uid: selectedDesignerId,
        designer_nome: selectedDesignerNome,
      });

      if (savedData) {
        setNomeEvento(savedData.nome_evento || "");
        if (savedData.data_evento) {
          const parts = savedData.data_evento.split("T");
          setDataEvento(parts[0] || "");
          setHoraEvento(parts[1] || "");
        }
        setLocalEvento(savedData.local_evento || "");
        setObservacoesItens(savedData.observacoes || {});
        setSelectedDesignerId(savedData.designer_uid || null);
        setSelectedDesignerNome(savedData.designer_nome || null);
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

  // Efeito 2: Auto-save debounced (1500ms)
  useEffect(() => {
    if (isInitialLoad || form.id_int === "NOVO") return;

    const timerId = setTimeout(() => {
      handleSaveBriefing();
    }, 1500);

    return () => clearTimeout(timerId);
  }, [
    nomeEvento,
    dataEvento,
    horaEvento,
    localEvento,
    observacoesItens,
    selectedDesignerId,
    selectedDesignerNome,
    isInitialLoad,
    form.id_int,
  ]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6">
        <ArtesDadosEventoCard 
          itens={form.itens} 
          nomeEvento={nomeEvento} setNomeEvento={setNomeEvento}
          dataEvento={dataEvento} setDataEvento={setDataEvento}
          horaEvento={horaEvento} setHoraEvento={setHoraEvento}
          localEvento={localEvento} setLocalEvento={setLocalEvento}
          observacoesItens={observacoesItens} setObservacoesItens={setObservacoesItens}
          onSave={handleSaveBriefing}
          isSaving={isSaving}
        />
        <ArtesUploadArquivosCard 
          propostaStatus={form.id_int === "NOVO" ? "NOVO" : "EDIT"} 
          idInt={form.id_int !== "NOVO" ? form.id_int : null}
          modelos={form.pedidosModelos || []}
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
    </div>
  );
}
