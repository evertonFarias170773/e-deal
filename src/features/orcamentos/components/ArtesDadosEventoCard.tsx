"use client";

import { useState } from "react";
import { FormSection } from "@/features/orcamentos/OrcamentoFormPage";
import type { PropostaItem } from "@/features/orcamentos/types";
import { RichTextEditor } from "@/components/common/RichTextEditor";

interface ArtesDadosEventoCardProps {
  itens: PropostaItem[];
}

export function ArtesDadosEventoCard({ itens }: ArtesDadosEventoCardProps) {
  const [nomeEvento, setNomeEvento] = useState("");
  const [dataEvento, setDataEvento] = useState("");
  const [horaEvento, setHoraEvento] = useState("");
  const [localEvento, setLocalEvento] = useState("");
  const [observacoesItens, setObservacoesItens] = useState<Record<string, string>>({});

  const handleItemObsChange = (itemId: string, value: string) => {
    setObservacoesItens((prev) => ({ ...prev, [itemId]: value }));
  };

  const inputClass =
    "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 transition placeholder:text-slate-400 hover:border-slate-300 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/10";
  const labelClass = "mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500";

  return (
    <FormSection
      title="Dados do evento"
      description="Preencha as informações principais do evento. Estes dados não são salvos permanentemente nesta versão."
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col">
            <label className={labelClass}>Nome do Evento</label>
            <input
              type="text"
              placeholder="Ex: Formatura Direito 2026"
              className={inputClass}
              value={nomeEvento}
              onChange={(e) => setNomeEvento(e.target.value)}
            />
          </div>
          <div className="flex flex-col">
            <label className={labelClass}>Data e Hora</label>
            <div className="flex gap-2">
              <input
                type="date"
                className={inputClass}
                value={dataEvento}
                onChange={(e) => setDataEvento(e.target.value)}
              />
              <input
                type="time"
                className={inputClass}
                value={horaEvento}
                onChange={(e) => setHoraEvento(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col">
            <label className={labelClass}>Local do Evento</label>
            <input
              type="text"
              placeholder="Ex: Centro de Eventos"
              className={inputClass}
              value={localEvento}
              onChange={(e) => setLocalEvento(e.target.value)}
            />
          </div>
        </div>

        {itens.length > 0 && (
          <div className="mt-8 space-y-4">
            <h4 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
              Observações por produto
            </h4>
            <div className="flex flex-col gap-6">
              {itens.map((item) => (
                <div key={item.id} className="flex flex-col">
                  <label className={labelClass}>Ref: {item.nome}</label>
                  <RichTextEditor
                    placeholder={`Observações da arte para ${item.nome}...`}
                    value={observacoesItens[item.id] || ""}
                    onChange={(val) => handleItemObsChange(item.id, val)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </FormSection>
  );
}
