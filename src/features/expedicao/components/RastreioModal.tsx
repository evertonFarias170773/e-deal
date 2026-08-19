"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, MapPin, RefreshCw, X } from "lucide-react";
import { rastrearObjeto } from "../services/rastro.service";
import type { RastroResultado } from "../services/rastro.service";
import type { PedidoExpedicao } from "../types";

export function RastreioModal({
  pedido,
  permitirMarcarEntregue,
  onClose,
  onMarcarEntregue
}: {
  pedido: PedidoExpedicao;
  permitirMarcarEntregue: boolean;
  onClose: () => void;
  onMarcarEntregue: () => void;
}) {
  const [resultado, setResultado] = useState<RastroResultado | null>(null);
  // Geração da consulta em voo: incrementada a cada `consultar()` (mount, troca
  // de pedido ou clique em "Atualizar") e no unmount/cleanup do efeito. Uma
  // resposta só é aplicada se ninguém mais novo tiver começado nesse meio-tempo
  // — evita setState pós-unmount e resposta velha sobrepondo a mais recente
  // (dois cliques rápidos em "Atualizar"). Mesmo espírito do `ativo` do
  // TransportadorasModal, generalizado para múltiplos pontos de disparo.
  const geracaoRef = useRef(0);

  async function consultar() {
    const minhaGeracao = ++geracaoRef.current;
    setResultado(null);
    const res = await rastrearObjeto(pedido.codigoRastreamento, pedido.idInt);
    if (minhaGeracao !== geracaoRef.current) return;
    setResultado(res);
  }

  useEffect(() => {
    void (async () => {
      await consultar();
    })();
    return () => {
      geracaoRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido.codigoRastreamento]);

  const podeMarcarEntregue =
    permitirMarcarEntregue && resultado?.ok === true && resultado.parse.entregue && pedido.etapa === "EM_TRANSITO";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Rastreamento #{pedido.idInt}</h2>
            <p className="font-mono text-xs font-bold text-slate-500">{pedido.codigoRastreamento}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void consultar()} title="Atualizar" className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {resultado === null && (
            <p className="text-center text-sm text-slate-500">
              Consultando os Correios — se o objeto não estiver no primeiro contrato, os demais são tentados antes de
              desistir.
            </p>
          )}

          {resultado?.ok === false && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <p className="font-semibold">{resultado.erro}</p>
              {resultado.detalhe && <p className="mt-1.5 text-xs opacity-90">{resultado.detalhe}</p>}
            </div>
          )}

          {resultado?.ok === true && (
            <>
              <p className="text-xs text-slate-500">
                {resultado.fonte === "correios"
                  ? `Consultado na API dos Correios${resultado.empresaNome ? ` · contrato da ${resultado.empresaNome}` : ""}.`
                  : "Consultado no rastreador externo (os Correios não reconheceram este objeto nos contratos configurados)."}
              </p>

              {Object.keys(resultado.parse.resumo).length > 0 ? (
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm dark:border-slate-800 dark:bg-slate-800/50">
                  {["Status", "Situação atual", "Local atual", "Última atualização", "Previsão de entrega", "Peso"].map((chave) =>
                    resultado.parse.resumo[chave] ? (
                      <div key={chave}>
                        <p className="text-[10px] font-bold uppercase text-slate-400">{chave}</p>
                        <p className="font-semibold text-slate-800 dark:text-slate-200">{resultado.parse.resumo[chave]}</p>
                      </div>
                    ) : null
                  )}
                </div>
              ) : null}

              {resultado.parse.eventos.length > 0 ? (
                <ol className="space-y-3">
                  {resultado.parse.eventos.map((ev, i) => (
                    <li key={i} className="rounded-2xl border border-slate-100 p-3 text-sm dark:border-slate-800">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{ev.titulo}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        {ev.data && <span>{ev.data}</span>}
                        {ev.local && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {ev.local}
                          </span>
                        )}
                      </p>
                      {ev.detalhe && <p className="mt-1 text-xs italic text-slate-500">{ev.detalhe}</p>}
                    </li>
                  ))}
                </ol>
              ) : (
                // Sem evento algum: objeto existe mas ainda não movimentou, ou o
                // formato do rastreador externo mudou. Mostra o bruto, nunca quebra.
                <>
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    O objeto existe, mas ainda não tem nenhum evento registrado pelos Correios.
                  </p>
                  <pre className="whitespace-pre-wrap rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                    {resultado.mensagemBruta}
                  </pre>
                </>
              )}
            </>
          )}
        </div>

        {podeMarcarEntregue && (
          <div className="border-t border-slate-100 bg-emerald-50 p-4 dark:border-slate-800 dark:bg-emerald-950/30">
            <button
              type="button"
              onClick={onMarcarEntregue}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <CheckCircle2 className="h-4 w-4" /> Correios confirmam a entrega — marcar ENTREGUE no sistema
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
