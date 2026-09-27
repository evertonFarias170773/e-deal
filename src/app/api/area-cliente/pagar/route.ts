import { NextResponse } from "next/server";

import { criarClientServiceRole, ipDaRequisicao } from "@/features/cadastros/services/cadastro-online.server";
import {
  areaClienteFlagAtiva,
  hashIpAreaCliente,
  iniciarPagamentoAreaCliente,
  resolverTokenAreaCliente,
  type MetodoAreaCliente
} from "@/features/area-cliente/services/area-cliente.server";
import { rateLimitCheck } from "@/lib/security/rate-limit-memory";

/**
 * "Pagar" da área do cliente: cria ou reaproveita a cobrança do valor que
 * falta e aciona o provedor (PIX Inter ou Cartão Asas).
 *
 * O corpo só diz o método. Valor, pagador, empresa e vencimento saem do banco,
 * no servidor — nada do navegador vira dado da cobrança.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// O Cartão Asas espera o n8n gravar o checkout: até 6 leituras de 1,5 s.
export const maxDuration = 30;

type Corpo = {
  token?: string;
  metodo?: string;
  /** HONEYPOT: campo escondido que só robô preenche. */
  site?: string;
};

const RESPOSTA_INDISPONIVEL = { ok: false, codigo: "LINK_INDISPONIVEL", mensagem: "Este link não está mais disponível." } as const;

function responder(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!areaClienteFlagAtiva()) return responder(RESPOSTA_INDISPONIVEL, 404);

  const ip = ipDaRequisicao(request);
  if (!rateLimitCheck(`area-cliente:pagar:${ip}`, 10, 10 * 60_000)) {
    return responder({ ok: false, codigo: "LIMITE", mensagem: "Muitas tentativas. Aguarde alguns minutos." }, 429);
  }

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return responder(RESPOSTA_INDISPONIVEL, 400);
  }

  if (String(corpo.site ?? "").trim()) {
    // Robô. Resposta neutra, sem tocar no banco.
    return responder({ ok: false, codigo: "INTERNO", mensagem: "Não foi possível preparar o pagamento. Tente novamente." });
  }

  const idInt = resolverTokenAreaCliente(String(corpo.token ?? ""));
  if (!idInt) return responder(RESPOSTA_INDISPONIVEL, 404);

  const metodo = String(corpo.metodo ?? "").toUpperCase();
  if (metodo !== "PIX" && metodo !== "CARTAO") {
    return responder({ ok: false, codigo: "BLOQUEADO", mensagem: "Forma de pagamento inválida." }, 400);
  }

  const service = criarClientServiceRole();
  if (!service) {
    console.error("[area-cliente/pagar] service_role indisponivel.");
    return responder({ ok: false, codigo: "INTERNO", mensagem: "Serviço indisponível no momento." }, 500);
  }

  const resultado = await iniciarPagamentoAreaCliente(service, idInt, metodo as MetodoAreaCliente, hashIpAreaCliente(ip));
  return responder(resultado, resultado.ok ? 200 : 409);
}
