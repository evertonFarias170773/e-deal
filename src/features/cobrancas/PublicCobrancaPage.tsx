"use client";

import Link from "next/link";
import { useAppToast } from "@/components/common/AppToast";
import { CobrancaStatusBadge } from "@/features/cobrancas/CobrancaStatusBadge";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { getTipoCobrancaLabel } from "@/features/cobrancas/cobrancas-utils";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDate } from "@/lib/formatters/date";

type PublicCobrancaPageProps = {
  token: string;
};

export function PublicCobrancaPage({ token }: PublicCobrancaPageProps) {
  const { showToast } = useAppToast();
  const { getCobrancaByToken, confirmPagamento } = useCobrancas();
  const cobranca = getCobrancaByToken(token) as NonNullable<ReturnType<typeof getCobrancaByToken>>;

  if (!cobranca) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">Página pública mockada</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-950">Cobrança não encontrada</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">O token informado não existe no estado mockado atual.</p>
        </div>
      </main>
    );
  }

  function handleSimulatePayment() {
    confirmPagamento(cobranca.id);
    showToast({ type: "success", title: "Pagamento confirmado no mock." });
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">Página pública mockada</p>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-950">{cobranca.cliente}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Cobrança vinculada à proposta #{cobranca.id_int} • {getTipoCobrancaLabel(cobranca.tipo_cobranca)}
              </p>
            </div>
            <CobrancaStatusBadge cobranca={cobranca} showConfirmed />
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1fr_320px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <InfoRow label="Cliente" value={cobranca.cliente} />
              <InfoRow label="Documento" value={cobranca.documento} />
              <InfoRow label="Tipo de cobrança" value={getTipoCobrancaLabel(cobranca.tipo_cobranca)} />
              <InfoRow label="OS Ideal" value={cobranca.os_ideal} />
              <InfoRow label="Valor" value={formatCurrency(cobranca.cartao_valor_final ?? cobranca.valor)} />
              <InfoRow label="Status" value={cobranca.status} />
              <InfoRow label="Vencimento" value={cobranca.vencimento ? formatDate(cobranca.vencimento) : "Sem vencimento"} />
              <InfoRow label="PIX copia e cola" value={cobranca.pix_copia_cola ?? "Não se aplica"} />
              <InfoRow label="Checkout / boleto" value={cobranca.cartao_checkout_url ?? cobranca.url_pdf ?? cobranca.url_cobranca ?? "Link mockado indisponível"} />
            </div>

            <div className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5">
              <p className="font-semibold text-slate-900">Ambiente 100% mockado</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Este token público existe apenas para validar o fluxo visual. Nenhum gateway, banco ou backend externo foi acionado.
              </p>
            </div>
          </div>

          <aside className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Ações mockadas</p>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                onClick={handleSimulatePayment}
                disabled={cobranca.status === "PAID" || cobranca.status === "CANCELADO"}
                className="w-full rounded-2xl bg-[#0b2f4a] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                Simular pagamento
              </button>
              <Link
                href={`/cobrancas/${cobranca.id}`}
                className="block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-700"
              >
                Abrir detalhe interno
              </Link>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
