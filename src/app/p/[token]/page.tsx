import type { Metadata } from "next";

import { criarClientServiceRole } from "@/features/cadastros/services/cadastro-online.server";
import {
  areaClienteFlagAtiva,
  montarSituacaoAreaCliente,
  resolverTokenAreaCliente
} from "@/features/area-cliente/services/area-cliente.server";

import { AreaClienteView } from "./area-cliente-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Pagamento do pedido",
  robots: { index: false, follow: false },
  referrer: "no-referrer"
};

type Props = { params: Promise<{ token: string }> };

/**
 * Area do cliente: pagamento do pedido pelo link.
 *
 * O TOKEN VIAJA NO CAMINHO, como no /c: e o que cabe num WhatsApp. Por isso
 * `Referrer-Policy: no-referrer` esta em next.config.ts para /p/:path*, e o
 * unico link externo desta pagina — o checkout do cartao — abre em nova aba
 * sem referrer. Se alguem acrescentar outro link para fora daqui, o token vaza
 * com ele.
 *
 * A RESOLUCAO ACONTECE NO SERVIDOR. O token nunca chega ao browser resolvido,
 * e o `service_role` nunca sai daqui. O client recebe a situacao ja montada —
 * valores, itens sem preco, pagador com documento mascarado — e o proprio
 * token, que devolve nas chamadas de /api/area-cliente/*.
 */
export default async function AreaClientePage({ params }: Props) {
  const { token } = await params;

  if (!areaClienteFlagAtiva()) {
    return <PaginaNeutra />;
  }

  const idInt = resolverTokenAreaCliente(token);
  if (!idInt) {
    // Token mal formado, HMAC errado ou segredo ausente caem todos aqui. Nao
    // se diz qual: quem sonda nao aprende nada.
    return <PaginaNeutra />;
  }

  const service = criarClientServiceRole();
  if (!service) {
    console.error("[area-cliente] service_role indisponivel ao abrir /p.");
    return <PaginaNeutra />;
  }

  const situacao = await montarSituacaoAreaCliente(service, idInt);
  if (!situacao) {
    return <PaginaNeutra />;
  }

  return <AreaClienteView token={token} inicial={situacao} />;
}

function PaginaNeutra() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-slate-800">Link indisponível</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        Este link não está mais disponível. Fale com seu atendente para receber um link novo.
      </p>
    </div>
  );
}
