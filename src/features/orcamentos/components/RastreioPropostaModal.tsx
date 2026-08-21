"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin, RefreshCw, X } from "lucide-react";
import { rastrearObjeto, type RastroResultado } from "@/features/expedicao/services/rastro.service";

/**
 * Rastreio de um objeto dos Correios a partir da lista de Orcamentos.
 *
 * Reaproveita `rastrearObjeto` da Expedicao — a MESMA consulta, com as mesmas
 * duas fontes (API dos Correios pelo nosso servidor e, como reserva, o fluxo
 * n8n). Nada da Expedicao foi alterado: este componente so consome o servico.
 *
 * Nao usa o `RastreioModal` da Expedicao de proposito: aquele exige um
 * `PedidoExpedicao` inteiro e sabe marcar entrega, coisas que a lista de
 * Orcamentos nao tem nem deve fazer. Aqui e leitura pura.
 */
export function RastreioPropostaModal({
  idInt,
  codigo,
  onClose
}: {
  idInt: number;
  codigo: string;
  onClose: () => void;
}) {
  const [resultado, setResultado] = useState<RastroResultado | null>(null);
  // Mesma guarda de geracao do modal da Expedicao: resposta antiga nunca
  // sobrepoe a mais recente quando se clica "Atualizar" duas vezes.
  const geracaoRef = useRef(0);

  async function consultar() {
    const minhaGeracao = ++geracaoRef.current;
    setResultado(null);
    const res = await rastrearObjeto(codigo, idInt);
    if (minhaGeracao !== geracaoRef.current) return;
    setResultado(res);
  }

  useEffect(() => {
    // Envolvido numa async auto-invocada, igual ao modal da Expedicao: chamar
    // `consultar()` direto executaria o `setResultado(null)` de forma sincrona
    // dentro do efeito, o que dispara render em cascata (e o lint do projeto).
    void (async () => {
      await consultar();
    })();
    return () => {
      geracaoRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codigo, idInt]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Rastreio do pedido #{idInt}</h2>
            <p className="mt-1 font-mono text-sm text-slate-600">{codigo}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5">
          {resultado === null ? (
            <p className="text-sm text-slate-500">Consultando os Correios...</p>
          ) : resultado.ok ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-500">
                Fonte: {resultado.fonte === "correios" ? "Correios" : "rastreador de reserva"}
                {resultado.empresaNome ? ` — contrato ${resultado.empresaNome}` : ""}
              </p>
              {resultado.parse.eventos.length === 0 ? (
                <p className="text-sm text-slate-600">Sem eventos registrados para este objeto.</p>
              ) : (
                <ol className="space-y-3">
                  {resultado.parse.eventos.map((evento, indice) => (
                    <li key={`${evento.titulo}-${indice}`} className="flex gap-3">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{evento.titulo}</p>
                        <p className="text-xs text-slate-500">
                          {[evento.data, evento.local].filter(Boolean).join(" — ")}
                        </p>
                        {evento.detalhe ? (
                          <p className="text-xs text-slate-600">{evento.detalhe}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">{resultado.erro}</p>
              {resultado.detalhe ? (
                <p className="mt-1 text-xs text-amber-800">{resultado.detalhe}</p>
              ) : null}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void consultar()}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#123f61]"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
