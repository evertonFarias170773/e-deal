"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppToast } from "@/components/common/AppToast";
import { DuplicarPropostaModal } from "@/features/orcamentos/components/DuplicarPropostaModal";
import { motivosPermitidos, type MotivoDaCopia } from "@/features/orcamentos/lib/motivo-copia";
import { duplicarProposta, lerSePropostaEhCopia } from "@/features/orcamentos/services/orcamentos.service";

type Pedido = { idInt: number; ehCopia: boolean | null; conferido: boolean };

/**
 * "Duplicar proposta" das três portas (lista de Pedidos, detalhe e edição),
 * 19/10/2026. `pedirDuplicacao(idInt)` abre o modal "Duplicação ou Retrabalho?",
 * confere no banco se o pedido já é cópia (cópia só oferece Retrabalho) e só
 * chama `duplicarProposta` depois da escolha. Fechar o modal não cria nada.
 */
export function useDuplicarProposta() {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [criando, setCriando] = useState(false);

  function pedirDuplicacao(idInt: number) {
    if (!idInt || criando) return;
    setPedido({ idInt, ehCopia: null, conferido: false });
    void lerSePropostaEhCopia(idInt).then((ehCopia) => {
      setPedido((atual) => (atual && atual.idInt === idInt ? { idInt, ehCopia, conferido: true } : atual));
    });
  }

  async function escolher(motivo: MotivoDaCopia) {
    if (!pedido || criando) return;
    const idInt = pedido.idInt;
    setCriando(true);
    const rotulo = motivo === "RETRABALHO" ? "retrabalho" : "duplicação";
    showToast({ type: "info", title: motivo === "RETRABALHO" ? "Criando retrabalho" : "Duplicando proposta", description: "Aguarde..." });
    try {
      const res = await duplicarProposta(idInt, motivo);
      if (res.success && res.novoIdInt) {
        setPedido(null);
        showToast({
          type: "success",
          title: motivo === "RETRABALHO" ? "Retrabalho criado" : "Proposta duplicada",
          description: `Pedido #${res.novoIdInt} criado. Redirecionando...`
        });
        window.setTimeout(() => router.push(`/orcamentos/${res.novoIdInt}/editar`), 1200);
      } else {
        showToast({ type: "error", title: `Erro na ${rotulo}`, description: res.errorMessage || "Não foi possível criar a cópia." });
      }
    } catch (err) {
      console.error("[Duplicação] Erro:", err);
      showToast({ type: "error", title: "Erro inesperado", description: "Ocorreu um erro ao tentar duplicar." });
    } finally {
      setCriando(false);
    }
  }

  const modalDuplicar = (
    <DuplicarPropostaModal
      isOpen={pedido !== null}
      propostaId={pedido?.idInt ?? 0}
      ehCopia={pedido?.ehCopia ?? null}
      motivos={pedido?.conferido ? motivosPermitidos(pedido.ehCopia) : null}
      isSubmitting={criando}
      onClose={() => {
        if (!criando) setPedido(null);
      }}
      onEscolher={(motivo) => void escolher(motivo)}
    />
  );

  return { pedirDuplicacao, duplicando: criando, modalDuplicar };
}
