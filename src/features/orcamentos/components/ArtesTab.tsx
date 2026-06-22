"use client";

import type { PropostaFormState, Proposta } from "@/features/orcamentos/types";
import { ArtesDadosEventoCard } from "./ArtesDadosEventoCard";
import { ArtesUploadArquivosCard } from "./ArtesUploadArquivosCard";
import { ArtesDesignersListCard } from "./ArtesDesignersListCard";
import { ArtesUltimosPedidosCard } from "./ArtesUltimosPedidosCard";

interface ArtesTabProps {
  form: PropostaFormState;
}

export function ArtesTab({ form }: ArtesTabProps) {
  const idCliente = form.clienteId || null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6">
        <ArtesDadosEventoCard itens={form.itens} />
        <ArtesUploadArquivosCard 
          propostaStatus={form.id_int === "NOVO" ? "NOVO" : "EDIT"} 
          idInt={form.id_int !== "NOVO" ? form.id_int : null}
          modelos={form.pedidosModelos || []}
        />
        
        <div className="grid gap-6 md:grid-cols-2">
          <ArtesDesignersListCard />
          <ArtesUltimosPedidosCard idCliente={idCliente} idIntAtual={form.id_int} />
        </div>
      </div>
    </div>
  );
}
