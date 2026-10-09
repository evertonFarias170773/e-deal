"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  buscarEstadoAcompanhar,
  soltarAcompanhar,
  vincularAcompanhar,
  type EstadoAcompanhar,
  type RespostaAcompanhar
} from "../services/acompanhar.client";

/**
 * ACOMPANHAR PEDIDO (Fase 7) — checkbox e seletor da aba Fretes.
 *
 * Os pedidos marcados so saem da Expedicao juntos; cada um segue com o seu
 * proprio despacho, a sua etiqueta e a sua cobranca. Nao existe vinculo
 * financeiro nem divisao de frete.
 *
 * GRAVA NA HORA, por rota propria: marcar e escolher um pedido vincula; tirar
 * um pedido do seletor solta aquele; desmarcar o checkbox tira SO este pedido.
 * Nada passa pelo Salvar do orcamento nem toca em `propostas` — por isso o
 * bloco fica FORA do `<fieldset disabled>` da aba e funciona com a edicao
 * bloqueada por cobranca (que e o caso em que um fieldset desabilitaria tudo).
 */

const APOIO =
  "Os pedidos marcados só saem da Expedição juntos; cada um segue com o seu próprio despacho, a sua etiqueta e a sua cobrança.";

function dataCurta(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR");
}

export function AcompanharPedidoCard({ idInt }: { idInt: number }) {
  const [estado, setEstado] = useState<EstadoAcompanhar | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falhaLeitura, setFalhaLeitura] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [marcadoLocal, setMarcadoLocal] = useState(false);
  const [busca, setBusca] = useState("");
  const sequencia = useRef(0);

  const aplicar = useCallback((r: RespostaAcompanhar) => {
    if (r.success) {
      setEstado(r.estado);
      setErro(null);
      return true;
    }
    setErro(r.errorMessage);
    return false;
  }, []);

  useEffect(() => {
    const minha = ++sequencia.current;
    const espera = setTimeout(async () => {
      const r = await buscarEstadoAcompanhar(idInt, busca);
      if (minha !== sequencia.current) return;
      if (r.success) {
        setEstado(r.estado);
        setFalhaLeitura(null);
      } else {
        setFalhaLeitura(r.errorMessage);
      }
      setCarregando(false);
    }, busca ? 350 : 0);
    return () => clearTimeout(espera);
  }, [idInt, busca]);

  if (carregando && !estado) return null;
  // Sem a leitura nao ha o que mostrar: o resto da aba segue como sempre foi.
  if (!estado) {
    return falhaLeitura ? (
      <p className="mt-6 text-xs text-slate-500" role="status">
        Acompanhar Pedido indisponível agora: {falhaLeitura}
      </p>
    ) : null;
  }

  const membrosOutros = estado.membros.filter((m) => !m.proprio);
  const noGrupo = estado.grupoId !== null;
  const somenteLeitura = estado.somenteLeitura !== null || !estado.podeEditar;
  const marcado = noGrupo || marcadoLocal;
  const outrosIds = membrosOutros.map((m) => m.idInt);

  async function executar(fn: () => Promise<RespostaAcompanhar>) {
    setTrabalhando(true);
    setErro(null);
    try {
      aplicar(await fn());
    } finally {
      setTrabalhando(false);
    }
  }

  function alternarCheckbox(valor: boolean) {
    if (somenteLeitura || trabalhando) return;
    if (valor) {
      setMarcadoLocal(true);
      return;
    }
    if (!noGrupo) {
      setMarcadoLocal(false);
      return;
    }
    void executar(async () => {
      const r = await soltarAcompanhar(idInt, "desmarcado pelo usuário");
      if (r.success) setMarcadoLocal(false);
      return r;
    });
  }

  function alternarPedido(outro: number, jaMarcado: boolean) {
    if (somenteLeitura || trabalhando) return;
    void executar(() =>
      jaMarcado ? soltarAcompanhar(idInt, "retirado do grupo pelo usuário", outro) : vincularAcompanhar(idInt, [outro])
    );
  }

  const acompanha = outrosIds.map((i) => `#${i}`).join(", ");

  return (
    <section
      className="mt-6 space-y-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900 dark:bg-rose-950/20"
      aria-label="Acompanhar Pedido"
      data-testid="acompanhar-pedido"
    >
      <label className={`flex items-center gap-2 text-sm font-semibold text-rose-800 dark:text-rose-200 ${somenteLeitura ? "opacity-70" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          checked={marcado}
          disabled={somenteLeitura || trabalhando}
          onChange={(e) => alternarCheckbox(e.target.checked)}
          className="h-4 w-4 accent-rose-600"
        />
        Acompanhar Pedido
      </label>

      <p className="text-[12px] text-slate-600 dark:text-slate-300">{APOIO}</p>

      {acompanha && (
        <p className="text-[12px] font-semibold text-rose-800 dark:text-rose-200" data-testid="linha-acompanha">
          Acompanha: {acompanha}
        </p>
      )}

      {estado.somenteLeitura && <p className="text-[12px] text-slate-500">Somente leitura: {estado.somenteLeitura}</p>}
      {!estado.somenteLeitura && !estado.podeEditar && (
        <p className="text-[12px] text-slate-500">Somente leitura: você não tem permissão para alterar o grupo.</p>
      )}

      {marcado && !somenteLeitura && (
        <div className="space-y-2">
          <input
            type="text"
            inputMode="numeric"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pedido por número"
            aria-label="Buscar pedido por número"
            className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs outline-none focus:border-rose-400 dark:border-rose-900 dark:bg-slate-900"
          />
          <ul className="max-h-64 space-y-1 overflow-auto" aria-label="Pedidos para acompanhar">
            {membrosOutros.map((m) => (
              <li key={m.idInt}>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs hover:bg-rose-100/60 dark:hover:bg-rose-950/40">
                  <input type="checkbox" checked disabled={trabalhando} onChange={() => alternarPedido(m.idInt, true)} className="accent-rose-600" />
                  <span className="font-bold">#{m.idInt}</span>
                  <span className="truncate">{m.cliente}</span>
                  <span className="text-slate-500">{m.statusInterno}</span>
                  <span className="text-slate-500">{dataCurta(m.criadoEm)}</span>
                </label>
              </li>
            ))}
            {estado.candidatos.map((c) => (
              <li key={c.idInt}>
                <label
                  className={`flex items-center gap-2 rounded-lg px-2 py-1 text-xs ${c.desabilitado ? "opacity-60" : "cursor-pointer hover:bg-rose-100/60 dark:hover:bg-rose-950/40"}`}
                  title={c.motivo ?? undefined}
                >
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={c.desabilitado || trabalhando}
                    onChange={() => alternarPedido(c.idInt, false)}
                    className="accent-rose-600"
                  />
                  <span className="font-bold">#{c.idInt}</span>
                  <span className="truncate">{c.cliente}</span>
                  <span className="text-slate-500">{c.statusInterno}</span>
                  <span className="text-slate-500">{dataCurta(c.criadoEm)}</span>
                  {c.motivo && <span className="text-[11px] text-amber-700 dark:text-amber-300">{c.motivo}</span>}
                </label>
              </li>
            ))}
            {estado.candidatos.length === 0 && membrosOutros.length === 0 && (
              <li className="px-2 py-1 text-xs text-slate-500">Nenhum pedido do mesmo cliente ou pagador disponível.</li>
            )}
          </ul>
          <p className="text-[11px] text-slate-500">
            Mostra até 10 pedidos do mesmo cliente ou pagador (APROVADO até EXPEDICAO, ainda não despachados); use a busca para achar outro pelo número.
          </p>
        </div>
      )}

      {noGrupo && somenteLeitura && membrosOutros.length > 0 && (
        <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
          {membrosOutros.map((m) => (
            <li key={m.idInt}>
              <span className="font-bold">#{m.idInt}</span> {m.cliente} · {m.statusInterno}
            </li>
          ))}
        </ul>
      )}

      {trabalhando && <p className="text-[11px] text-slate-500">Gravando…</p>}
      {erro && (
        <p className="text-[12px] font-medium text-red-700 dark:text-red-300" role="alert">
          {erro}
        </p>
      )}
    </section>
  );
}
