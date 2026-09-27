"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

import type {
  CobrancaAbertaPublica,
  MetodoAreaCliente,
  SituacaoAreaCliente
} from "@/features/area-cliente/services/area-cliente.server";

/**
 * Tela do cliente. Recebe a situacao ja resolvida pelo servidor e so fala com
 * /api/area-cliente/* — nunca com o Supabase.
 *
 * ANTIDUPLICIDADE NO NAVEGADOR: o botao desabilita enquanto a requisicao
 * corre. A garantia de verdade fica no servidor (reaproveitamento da cobranca
 * aberta e chave de idempotencia deterministica): duas abas, "voltar" ou dois
 * cliques caem na mesma cobranca.
 */

type Props = { token: string; inicial: SituacaoAreaCliente };

const INTERVALO_POLLING_MS = 5000;

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function dataBr(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return a && m && d ? `${d}/${m}/${a}` : iso;
}

export function AreaClienteView({ token, inicial }: Props) {
  const [situacao, setSituacao] = useState<SituacaoAreaCliente>(inicial);
  const [cobranca, setCobranca] = useState<CobrancaAbertaPublica | null>(inicial.cobrancaAberta);
  const [trabalhando, setTrabalhando] = useState<MetodoAreaCliente | null>(null);
  const [aviso, setAviso] = useState<string>("");
  // QR gerado por codigo: so e mostrado quando pertence ao PIX em tela.
  const [qr, setQr] = useState<{ codigo: string; url: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const honeypotRef = useRef<HTMLInputElement>(null);

  const recarregar = useCallback(async () => {
    try {
      const resposta = await fetch("/api/area-cliente/situacao", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token })
      });
      const json = (await resposta.json().catch(() => null)) as { ok?: boolean; situacao?: SituacaoAreaCliente } | null;
      if (json?.ok && json.situacao) {
        setSituacao(json.situacao);
        // A cobranca em tela so troca quando o servidor devolve outra (ou
        // nenhuma, porque foi paga/cancelada). Nao apaga o PIX que o cliente
        // esta lendo por causa de uma leitura vazia.
        setCobranca((atual) => json.situacao?.cobrancaAberta ?? (json.situacao?.situacao === "AGUARDANDO_PAGAMENTO" ? atual : null));
      }
    } catch {
      // Silencio: a proxima rodada tenta de novo.
    }
  }, [token]);

  // Polling enquanto ha o que esperar.
  useEffect(() => {
    if (situacao.situacao !== "AGUARDANDO_PAGAMENTO" || !cobranca) return;
    const id = window.setInterval(() => void recarregar(), INTERVALO_POLLING_MS);
    return () => window.clearInterval(id);
  }, [situacao.situacao, cobranca, recarregar]);

  // QR do PIX, gerado aqui a partir do copia-e-cola. Nada e limpo de forma
  // sincrona: o QR antigo simplesmente deixa de casar com o codigo em tela.
  const codigoPix = cobranca?.metodo === "PIX" ? cobranca.pixCopiaCola : null;
  useEffect(() => {
    if (!codigoPix) return;
    let ativo = true;
    void QRCode.toDataURL(codigoPix, { margin: 1, width: 260 }).then((url) => {
      if (ativo) setQr({ codigo: codigoPix, url });
    });
    return () => {
      ativo = false;
    };
  }, [codigoPix]);
  const qrAtual = qr && codigoPix && qr.codigo === codigoPix ? qr.url : "";

  async function pagar(metodo: MetodoAreaCliente) {
    if (trabalhando) return;
    setTrabalhando(metodo);
    setAviso("");
    try {
      const resposta = await fetch("/api/area-cliente/pagar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, metodo, site: honeypotRef.current?.value ?? "" })
      });
      const json = (await resposta.json().catch(() => null)) as
        | { ok: true; cobranca: CobrancaAbertaPublica }
        | { ok: false; mensagem?: string }
        | null;
      if (json?.ok) {
        setCobranca(json.cobranca);
        if (json.cobranca.metodo === "CARTAO" && json.cobranca.urlCheckout) {
          window.open(json.cobranca.urlCheckout, "_blank", "noopener,noreferrer");
        }
        void recarregar();
      } else {
        setAviso(json?.mensagem || "Não foi possível preparar o pagamento. Tente novamente.");
      }
    } catch {
      setAviso("Não foi possível falar com o servidor. Tente novamente.");
    } finally {
      setTrabalhando(null);
    }
  }

  async function copiarPix() {
    if (!cobranca?.pixCopiaCola) return;
    try {
      await navigator.clipboard.writeText(cobranca.pixCopiaCola);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2500);
    } catch {
      setAviso("Não foi possível copiar. Selecione o código e copie manualmente.");
    }
  }

  const titulo = {
    AGUARDANDO_PAGAMENTO: "Pagamento do pedido",
    PAGO: "Pedido pago",
    EM_ANDAMENTO: "Pedido em andamento",
    CANCELADO: "Pedido cancelado",
    INDISPONIVEL: "Pedido"
  }[situacao.situacao];

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{situacao.empresa}</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{titulo}</h1>
        <p className="mt-1 text-sm text-slate-600">Pedido nº {situacao.idInt}</p>

        <dl className="mt-5 grid grid-cols-3 gap-3 text-center">
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">Total do pedido</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">{moeda.format(situacao.total)}</dd>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">Já pago</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">{moeda.format(situacao.pago)}</dd>
          </div>
          <div className="rounded-xl bg-teal-50 p-3">
            <dt className="text-xs text-teal-700">A pagar</dt>
            <dd className="mt-1 text-base font-bold text-teal-800">{moeda.format(situacao.aPagar)}</dd>
          </div>
        </dl>

        {situacao.pagador.nome ? (
          <p className="mt-4 text-xs text-slate-500">
            Pagador: <span className="font-medium text-slate-700">{situacao.pagador.nome}</span>
            {situacao.pagador.documento ? ` · ${situacao.pagador.documento}` : ""}
          </p>
        ) : null}

        {situacao.credito ? (
          <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Você tem {moeda.format(situacao.credito)} de crédito com a gráfica. Para usar no pedido, fale com seu atendente.
          </p>
        ) : null}
      </section>

      {situacao.situacao === "AGUARDANDO_PAGAMENTO" && situacao.podePagar ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {!cobranca ? (
            <>
              <h2 className="text-base font-semibold text-slate-900">Como você quer pagar?</h2>
              <p className="mt-1 text-sm text-slate-600">O pedido entra em produção depois da confirmação do pagamento.</p>
              <input ref={honeypotRef} type="text" name="site" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {situacao.metodos.pix ? (
                  <button
                    type="button"
                    disabled={trabalhando !== null}
                    onClick={() => void pagar("PIX")}
                    className="rounded-2xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {trabalhando === "PIX" ? "Gerando PIX..." : `Pagar ${moeda.format(situacao.aPagar)} com PIX`}
                  </button>
                ) : null}
                {situacao.metodos.cartao ? (
                  <button
                    type="button"
                    disabled={trabalhando !== null}
                    onClick={() => void pagar("CARTAO")}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {trabalhando === "CARTAO" ? "Abrindo checkout..." : `Pagar ${moeda.format(situacao.aPagar)} com cartão`}
                  </button>
                ) : null}
              </div>
            </>
          ) : cobranca.metodo === "PIX" ? (
            <>
              <h2 className="text-base font-semibold text-slate-900">Pague com PIX</h2>
              <p className="mt-1 text-sm text-slate-600">
                {moeda.format(cobranca.valor)}
                {cobranca.vencimento ? ` · válido até ${dataBr(cobranca.vencimento)}` : ""}
              </p>
              {cobranca.pixCopiaCola ? (
                <>
                  {qrAtual ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={qrAtual} alt="QR Code do PIX" className="mx-auto mt-4 h-[260px] w-[260px] rounded-xl border border-slate-200" />
                  ) : null}
                  <p className="mt-4 break-all rounded-xl bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-700">{cobranca.pixCopiaCola}</p>
                  <button
                    type="button"
                    onClick={() => void copiarPix()}
                    className="mt-3 w-full rounded-2xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-teal-700"
                  >
                    {copiado ? "Código copiado" : "Copiar código PIX"}
                  </button>
                  <p className="mt-3 text-center text-xs text-slate-500">Assim que o banco confirmar, esta página atualiza sozinha.</p>
                </>
              ) : (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Seu PIX está sendo preparado.
                  <button type="button" onClick={() => void pagar("PIX")} disabled={trabalhando !== null} className="ml-2 font-semibold underline">
                    {trabalhando === "PIX" ? "Gerando..." : "Tentar de novo"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold text-slate-900">Pague com cartão</h2>
              <p className="mt-1 text-sm text-slate-600">{moeda.format(cobranca.valor)} · à vista, em ambiente seguro do provedor.</p>
              {cobranca.urlCheckout ? (
                <a
                  href={cobranca.urlCheckout}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 block w-full rounded-2xl bg-teal-600 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-teal-700"
                >
                  Abrir pagamento com cartão
                </a>
              ) : (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  Seu pagamento por cartão está sendo preparado.
                  <button type="button" onClick={() => void pagar("CARTAO")} disabled={trabalhando !== null} className="ml-2 font-semibold underline">
                    {trabalhando === "CARTAO" ? "Preparando..." : "Tentar de novo"}
                  </button>
                </div>
              )}
              <p className="mt-3 text-center text-xs text-slate-500">Depois de pagar, esta página atualiza sozinha.</p>
            </>
          )}
          {aviso ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{aviso}</p> : null}
        </section>
      ) : situacao.motivoBloqueio && situacao.situacao === "AGUARDANDO_PAGAMENTO" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">{situacao.motivoBloqueio}</section>
      ) : null}

      {situacao.pagamentos.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Pagamentos recebidos</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {situacao.pagamentos.map((p, i) => (
              <li key={i} className="flex items-center justify-between py-2">
                <span className="text-slate-700">{p.metodo}</span>
                <span className="text-right">
                  <span className="font-semibold text-slate-900">{moeda.format(p.valor)}</span>
                  <span className="ml-2 text-xs text-slate-500">{p.emConferencia ? "em conferência" : "confirmado"}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {situacao.itens.length > 0 ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Itens do pedido</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {situacao.itens.map((item, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2">
                <span className="text-slate-700">{item.descricao}</span>
                <span className="whitespace-nowrap text-slate-500">{item.quantidade} un.</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="px-2 text-center text-xs text-slate-500">Dúvidas sobre o pedido? Fale com seu atendente.</p>
    </div>
  );
}
