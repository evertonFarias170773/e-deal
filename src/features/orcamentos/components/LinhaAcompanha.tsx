"use client";

import { useEffect, useState } from "react";
import { buscarEstadoAcompanhar } from "../services/acompanhar.client";
import { linhaAcompanha } from "../lib/visualizacao-da-proposta";

/**
 * "Acompanha: #A, #B" na visualizacao do pedido (Fase 7). Só leitura: nao
 * aciona nada. Se a leitura falhar ou o pedido nao estiver em grupo, nao
 * aparece nada.
 */
export function LinhaAcompanha({ idInt }: { idInt: number }) {
  const [texto, setTexto] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    void buscarEstadoAcompanhar(idInt).then((r) => {
      if (!ativo || !r.success) return;
      setTexto(linhaAcompanha(r.estado.membros.filter((m) => !m.proprio).map((m) => m.idInt)));
    });
    return () => {
      ativo = false;
    };
  }, [idInt]);
  if (!texto) return null;
  return (
    <p className="text-xs font-semibold text-rose-700 dark:text-rose-300" data-testid="linha-acompanha-leitura">
      {texto}
    </p>
  );
}
