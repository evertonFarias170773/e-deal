"use client";

/**
 * Cartao de um grupo de enderecos de ENTREGA iguais (25/11/2026). Mostra o
 * endereco uma vez, "usado em N pedidos" com os numeros, e abre as linhas
 * individuais num clique — a edicao continua por linha, dentro de `children`.
 * A obs "portal-entrega-pedido:..." nao aparece aqui: e marca tecnica.
 * Regra do agrupamento em `lib/agrupar-enderecos-entrega.ts`.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MapPin } from "lucide-react";
import type { CadastroEndereco } from "@/features/cadastros/types";
import { textoUsadoEmPedidos } from "@/features/cadastros/lib/agrupar-enderecos-entrega";

export function GrupoEnderecosEntregaCard({
  endereco,
  quantidadeDeLinhas,
  pedidos,
  carregandoPedidos,
  children
}: {
  /** Qualquer linha do grupo: todas tem os mesmos campos mostrados. */
  endereco: CadastroEndereco;
  quantidadeDeLinhas: number;
  pedidos: number[];
  carregandoPedidos: boolean;
  /** As linhas individuais, como a tela ja as desenha. */
  children: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50" data-grupo-enderecos-entrega={quantidadeDeLinhas}>
      <button
        type="button"
        onClick={() => setAberto((valor) => !valor)}
        aria-expanded={aberto}
        className="flex w-full items-start gap-4 rounded-3xl p-4 text-left hover:bg-slate-100"
      >
        <span className="mt-1 rounded-2xl bg-[#dff8f6] p-3 text-[#0b7774]">
          <MapPin className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <span className="font-semibold text-slate-950">
              {endereco.endereco}, {endereco.numero}
            </span>
            <span className="inline-flex shrink-0 items-center rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700">
              ENTREGA
            </span>
          </span>
          <span className="mt-1 block text-sm text-slate-500">
            {endereco.bairro} - {endereco.cidade}/{endereco.uf} - CEP {endereco.cep}
          </span>
          {endereco.complemento ? (
            <span className="mt-1 block text-sm text-slate-500">Complemento: {endereco.complemento}</span>
          ) : null}
          {endereco.recebedor || endereco.cpfRecebedor ? (
            <span className="mt-1 block text-sm text-slate-500">
              Recebedor: {[endereco.recebedor, endereco.cpfRecebedor].filter(Boolean).join(" · ")}
            </span>
          ) : null}
          <span className="mt-2 block text-sm font-semibold text-[#0b2f4a]" data-usado-em-pedidos>
            {carregandoPedidos
              ? "Carregando pedidos..."
              : `${textoUsadoEmPedidos(pedidos.length)[0].toUpperCase()}${textoUsadoEmPedidos(pedidos.length).slice(1)}${pedidos.length ? `: ${pedidos.join(", ")}` : ""}`}
          </span>
          <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500">
            {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            {aberto ? "Fechar" : "Ver"} as {quantidadeDeLinhas} linhas iguais deste endereço
          </span>
        </span>
      </button>
      {aberto ? <div className="space-y-4 border-t border-slate-200 p-4">{children}</div> : null}
    </div>
  );
}
