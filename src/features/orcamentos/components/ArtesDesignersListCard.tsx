"use client";

import { useState, useEffect } from "react";
import { FormSection } from "@/features/orcamentos/OrcamentoFormPage";
import { listarDesigners } from "@/features/pedidos/services/boletim-propostas.service";

interface Designer {
  user_id: string;
  nome_usuario: string;
  email: string;
}

interface ArtesDesignersListCardProps {
  selectedDesignerId: string | null;
  setSelectedDesignerId: (id: string | null) => void;
  setSelectedDesignerNome: (nome: string | null) => void;
}

export function ArtesDesignersListCard({ 
  selectedDesignerId, 
  setSelectedDesignerId,
  setSelectedDesignerNome 
}: ArtesDesignersListCardProps) {
  const [designers, setDesigners] = useState<Designer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDesigners() {
      try {
        const data = await listarDesigners();
        setDesigners(data);
      } catch (err) {
        console.error("Erro ao buscar designers:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchDesigners();
  }, []);

  return (
    <FormSection
      title="Designers Ideal"
      description="Equipe de design responsável pela criação de artes."
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-500">Carregando designers...</p>
        ) : designers.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhum designer encontrado.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {designers.map((designer) => {
              const isSelected = selectedDesignerId === designer.user_id;
              return (
                <div 
                  key={designer.user_id}
                  onClick={() => {
                    if (isSelected) {
                      setSelectedDesignerId(null);
                      setSelectedDesignerNome(null);
                    } else {
                      setSelectedDesignerId(designer.user_id);
                      setSelectedDesignerNome(designer.nome_usuario);
                    }
                  }}
                  className={`cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between rounded-xl border p-4 transition-all ${
                    isSelected ? "border-teal-500 bg-teal-50 shadow-sm ring-1 ring-teal-500" : "border-slate-100 bg-slate-50 hover:border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-800 font-bold uppercase">
                      {designer.nome_usuario.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-800">{designer.nome_usuario}</p>
                        {isSelected && (
                          <span className="rounded-full bg-teal-500 px-2 py-0.5 text-[10px] font-bold text-white">
                            Selecionado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">{designer.email}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-col sm:mt-0 sm:flex-row sm:items-center sm:gap-6 text-xs text-slate-600">
                    <div className="flex justify-between sm:justify-start items-center gap-2">
                      <span className="font-medium">Pedidos:</span>
                      <span className="font-bold text-slate-800">0</span>
                    </div>
                    <div className="flex justify-between sm:justify-start items-center gap-2 mt-1 sm:mt-0">
                      <span className="font-medium">Modelos:</span>
                      <span className="font-bold text-slate-800">0</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </FormSection>
  );
}
