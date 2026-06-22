"use client";

import { Calendar, MapPin, Clock, FileText, AlignLeft } from "lucide-react";
import { FormSection } from "@/features/orcamentos/OrcamentoFormPage";
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
          <div className="mt-8 border-t border-slate-100 pt-8">
            <label className="mb-4 flex items-center gap-1.5 text-sm font-bold text-slate-800">
              <AlignLeft className="h-4 w-4 text-teal-600" />
              Observações Específicas por Produto
            </label>
            <div className="space-y-4">
              {itens.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      {item.quantidade} un.
                    </span>
                    <span className="text-sm font-bold text-slate-700">{item.nome}</span>
                  </div>
                  <textarea
                    rows={2}
                    value={observacoesItens[item.id] || ""}
                    onChange={(e) =>
                      setObservacoesItens({
                        ...observacoesItens,
                        [item.id]: e.target.value,
                      })
                    }
                    placeholder="Detalhes para a arte deste produto (ex: cor principal azul, logo na tampa...)"
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder-slate-400 transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
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
