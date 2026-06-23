"use client";

import { Calendar, MapPin, Clock, FileText, AlignLeft } from "lucide-react";
import { FormSection } from "@/features/orcamentos/OrcamentoFormPage";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import type { PropostaItem } from "@/features/orcamentos/types";

interface ArtesDadosEventoCardProps {
  itens: PropostaItem[];
  nomeEvento: string;
  setNomeEvento: (val: string) => void;
  dataEvento: string;
  setDataEvento: (val: string) => void;
  localEvento: string;
  setLocalEvento: (val: string) => void;
  observacoesItens: Record<string, string>;
  setObservacoesItens: (val: Record<string, string>) => void;
}

export function ArtesDadosEventoCard({
  itens,
  nomeEvento,
  setNomeEvento,
  dataEvento,
  setDataEvento,
  localEvento,
  setLocalEvento,
  observacoesItens,
  setObservacoesItens,
}: ArtesDadosEventoCardProps) {
  return (
    <FormSection
      title="Briefing Base do Evento"
      description="Dados preenchidos pelo comercial para guiar a criação da arte."
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Nome do Evento */}
          <div className="sm:col-span-2">
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <FileText className="h-4 w-4 text-slate-400" />
              Nome do Evento / Tema
            </label>
            <input
              type="text"
              value={nomeEvento}
              onChange={(e) => setNomeEvento(e.target.value)}
              placeholder="Ex: Formatura Direito USP 2024"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 transition focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-teal-500/10"
            />
          </div>

          {/* Data do Evento */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <Calendar className="h-4 w-4 text-slate-400" />
              Data do Evento
            </label>
            <input
              type="date"
              value={dataEvento}
              onChange={(e) => setDataEvento(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 transition focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-teal-500/10"
            />
          </div>

          {/* Local */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-700">
              <MapPin className="h-4 w-4 text-slate-400" />
              Local da Festa/Evento
            </label>
            <input
              type="text"
              value={localEvento}
              onChange={(e) => setLocalEvento(e.target.value)}
              placeholder="Ex: Expo Center Norte"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900 transition focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-teal-500/10"
            />
          </div>
        </div>

        {/* Observações Específicas dos Itens */}
        {itens.length > 0 && (
          <div className="mt-8 space-y-4">
            <h4 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2 flex items-center gap-2">
              <AlignLeft className="h-4 w-4 text-teal-600" />
              Observações por produto
            </h4>
            <div className="flex flex-col gap-6">
              {itens.map((item) => (
                <div key={item.id} className="flex flex-col">
                  <RichTextEditor
                    label={`${item.quantidade} un. - ${item.nome}`}
                    placeholder={`Detalhes para a arte deste produto (ex: cor principal azul, logo na tampa...)`}
                    value={observacoesItens[item.id] || ""}
                    onChange={(val) =>
                      setObservacoesItens({
                        ...observacoesItens,
                        [item.id]: val,
                      })
                    }
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
