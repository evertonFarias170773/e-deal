import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarEscopoPropostaServerSide } from "@/lib/auth/verificar-escopo-proposta";
import { montarUrlPublicaCobranca } from "@/features/cobrancas/cobrancas-utils";
import { recusaDoGatilhoNoErro, recusaDoTipoNoPedido } from "@/features/cobrancas/lib/tipo-x-retrabalho";
import { lerContextoRetrabalhoDoPedido } from "@/features/cobrancas/services/tipo-x-retrabalho.service";
import { CODIGO_PEDIDO_ENTREGUE, MENSAGEM_PEDIDO_ENTREGUE, statusEhEntregue } from "@/features/orcamentos/services/pedido-entregue";
import { getPropostaDetailById } from "@/features/orcamentos/services/orcamentos.service";
import { centavosDoValor } from "@/features/orcamentos/lib/total-no-centavo";
import {
  FORMAS_DA_ENTRADA,
  dividirFaturadoComEntrada,
  mensagemHistoricoFaturadoComEntrada,
  montarLinhasFaturadoComEntrada,
  type CondicaoDoFaturado,
  type FormaDaEntrada
} from "@/features/cobrancas/lib/faturado-com-entrada";

/**
 * Faturado com entrada (06/11/2026): cria de uma vez a cobrança A da entrada
 * (PIX ou boleto) e a cobrança B Faturado com o restante.
 *
 * ATÔMICO: as duas linhas entram num ÚNICO insert. Se a B não puder ser gravada
 * (gatilho, permissão, qualquer erro), a A também não existe — nenhuma fica
 * sozinha. É diferente do combinado de E-Crédito, que grava a parte do crédito
 * antes e, se a segunda falhar, avisa e abre tarefa: aquele fluxo não muda.
 *
 * Esta rota só GRAVA as duas linhas. Depois a tela segue o caminho normal de
 * cada uma: a A é emitida no banco pela mesma rota do PIX/boleto de sempre
 * (gerar-pix / gerar-boleto); a B passa pela liberação automática do faturado
 * (aprovar-faturado-automatico) e, depois da Conferência, pelo Registro de
 * recebíveis. Se a emissão da A falhar, as duas continuam existindo e a A fica
 * pendente de emissão, como no PIX/boleto normal.
 *
 * O total é o da tela, em centavos exatos (resumo carregado por
 * `getPropostaDetailById`, regra publicada em 06/11/2026), e A + B = total.
 * Só vale para proposta SEM cobrança ativa: é o pagamento inteiro do pedido.
 */
export const runtime = "nodejs";

function erro(status: number, message: string, code?: string) {
  return NextResponse.json({ success: false, ...(code ? { code } : {}), message }, { status });
}

/** Data de hoje em São Paulo + dias, "AAAA-MM-DD". */
function hojeMaisDias(dias: number): string {
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [a, m, d] = hoje.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return erro(500, "Configuração de ambiente incompleta.");

    const authHeader = request.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return erro(401, "Sessão não encontrada.");

    const supabase = createSupabaseClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return erro(401, "Sessão inválida.");

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const idInt = Number(body.idInt) || 0;
    const formaEntrada = String(body.formaEntrada ?? "").toUpperCase() as FormaDaEntrada;
    const idModelo = String(body.idModeloCobranca ?? "").trim();
    const idEmpresa = Number(body.idEmpresa) || 0;
    const empresa = String(body.empresa ?? "").trim();
    if (!idInt) return erro(400, "Proposta não informada.");
    if (!FORMAS_DA_ENTRADA.includes(formaEntrada)) return erro(400, "Escolha a forma da entrada: PIX ou Boleto.");
    if (!idModelo) return erro(400, "Selecione uma condição de pagamento.");
    if (![1, 2, 3].includes(idEmpresa) || !empresa) return erro(400, "Empresa recebedora inválida.");

    // Proposta, escopo e pedido entregue.
    const { data: prop, error: propErr } = await supabase
      .from("propostas")
      .select("id_int, id_cliente, id_faturado, empresa, vendedor, status_interno, is_avulso")
      .eq("id_int", idInt)
      .maybeSingle<{ id_int: number; id_cliente: number | null; id_faturado: number | null; empresa: string | null; vendedor: string | null; status_interno: string | null; is_avulso: boolean | null }>();
    if (propErr) return erro(503, "Não foi possível ler a proposta.");
    if (!prop) return erro(404, "Proposta não encontrada.");
    const escopoOk = await verificarEscopoPropostaServerSide(supabase, authData.user.id, { empresa: prop.empresa, vendedor: prop.vendedor });
    if (!escopoOk) return erro(403, "Acesso negado a esta proposta.");
    if (statusEhEntregue(prop.status_interno)) return erro(409, MENSAGEM_PEDIDO_ENTREGUE, CODIGO_PEDIDO_ENTREGUE);
    if (prop.is_avulso) return erro(409, "Faturado com entrada não vale para proposta avulsa.");

    // Retrabalho só aceita E-Retrabalho (o gatilho do banco também recusa).
    const contexto = await lerContextoRetrabalhoDoPedido(supabase, idInt);
    const recusaRetrabalho = contexto
      ? recusaDoTipoNoPedido(formaEntrada, contexto) ?? recusaDoTipoNoPedido("E-FATURADO", contexto)
      : null;
    if (recusaRetrabalho) return erro(422, recusaRetrabalho);

    // Sem cobrança ativa: é o pagamento inteiro do pedido.
    const { data: ativas, error: ativasErr } = await supabase
      .from("pagamentos_v2")
      .select("id")
      .eq("id_int", idInt)
      .neq("status", "CANCELADO");
    if (ativasErr) return erro(503, "Não foi possível ler as cobranças da proposta.");
    if ((ativas ?? []).length > 0) {
      return erro(409, "Faturado com entrada só vale para proposta sem cobrança ativa. Cancele as cobranças atuais ou use as formas de pagamento uma a uma.", "TEM_COBRANCA");
    }

    // Total da tela, em centavos exatos.
    const propostaDaTela = await getPropostaDetailById(idInt, supabase);
    if (!propostaDaTela?.resumo) return erro(503, "Não foi possível calcular o total da proposta.");
    const totalCentavos = centavosDoValor(propostaDaTela.resumo.valorTotal);
    const divisao = dividirFaturadoComEntrada(totalCentavos, centavosDoValor(body.valorEntrada as number));
    if (!divisao.ok) return erro(400, divisao.message, divisao.code);

    // Condição do faturado, lida do catálogo (não do navegador).
    const { data: modelo, error: modeloErr } = await supabase
      .from("modelos_cobranca")
      .select("id, resultado, qtd_parcela, inicio, intervalo, entrada_porcento")
      .eq("id", idModelo)
      .maybeSingle<CondicaoDoFaturado>();
    if (modeloErr) return erro(503, "Não foi possível ler a condição de pagamento.");
    if (!modelo || !modelo.resultado || modelo.qtd_parcela == null || modelo.inicio == null || modelo.intervalo == null) {
      return erro(400, "Selecione uma condição de pagamento válida.");
    }

    // Pagador: o mesmo do fluxo normal e do combinado (propostas.id_faturado,
    // e o cliente da proposta quando não há).
    const idPagador = Number(prop.id_faturado || prop.id_cliente) || 0;
    const { data: pagadorRow, error: pagadorErr } = await supabase
      .from("clientes")
      .select("id_cliente, nome, documento")
      .eq("id_cliente", idPagador)
      .maybeSingle<{ id_cliente: number; nome: string | null; documento: string | null }>();
    if (pagadorErr || !pagadorRow) return erro(404, "Pagador da proposta não encontrado no cadastro.");

    const { data: usuarioRow } = await supabase
      .from("usuarios")
      .select("nome_usuario")
      .eq("user_id", authData.user.id)
      .maybeSingle<{ nome_usuario: string | null }>();
    const autor = usuarioRow?.nome_usuario || authData.user.email || "Sistema";

    const ids = { entrada: crypto.randomUUID(), faturado: crypto.randomUUID() };
    const osIdeal = Number(body.osIdeal);
    const linhas = montarLinhasFaturadoComEntrada({
      comuns: {
        idInt,
        pagador: { idCliente: Number(pagadorRow.id_cliente), nome: String(pagadorRow.nome || ""), documento: pagadorRow.documento || null },
        empresa,
        idEmpresa,
        osIdeal: Number.isInteger(osIdeal) && osIdeal > 0 ? osIdeal : null,
        atendente: prop.vendedor || "Sistema",
        observacao: body.observacao ? String(body.observacao) : null
      },
      divisao,
      formaEntrada,
      vencimentoEntrada: hojeMaisDias(3),
      vencimentoFaturado: hojeMaisDias(Number(modelo.inicio)),
      condicao: modelo,
      ids,
      urlEntrada: montarUrlPublicaCobranca({ tipoCobranca: formaEntrada, tokenPublico: ids.entrada.split("-")[0] })
    });

    // UM insert, duas linhas: ou as duas, ou nenhuma.
    const { data: gravadas, error: insertErr } = await supabase
      .from("pagamentos_v2")
      .insert(linhas)
      .select("id, id_pagamento, tipo_cobranca, valor");
    if (insertErr || !Array.isArray(gravadas) || gravadas.length !== 2) {
      const recusa = recusaDoGatilhoNoErro(insertErr?.message);
      return erro(recusa ? 422 : 500, recusa || "Não foi possível criar as cobranças. Nenhuma das duas foi gravada.");
    }
    const linhaA = gravadas.find((g) => g.id === ids.entrada);
    const linhaB = gravadas.find((g) => g.id === ids.faturado);

    const { error: chatErr } = await supabase.from("propostas_chat").insert([
      {
        id_int: idInt,
        id_cliente: prop.id_cliente,
        mensagem: mensagemHistoricoFaturadoComEntrada({
          idPagamentoEntrada: linhaA?.id_pagamento || ids.entrada,
          idPagamentoFaturado: linhaB?.id_pagamento || ids.faturado,
          formaEntrada,
          entradaCentavos: divisao.entradaCentavos,
          restanteCentavos: divisao.restanteCentavos,
          condicao: modelo.resultado,
          autor
        }),
        tipo: "SISTEMA",
        autor_nome: autor,
        setor: "Financeiro",
        visivel_externo: false
      }
    ]);
    if (chatErr) console.warn("[faturado-com-entrada] Falha ao registrar o Histórico:", chatErr.message);

    return NextResponse.json({
      success: true,
      entrada: { id: ids.entrada, id_pagamento: linhaA?.id_pagamento ?? null, valor: divisao.entradaCentavos / 100, tipo: formaEntrada },
      faturado: { id: ids.faturado, id_pagamento: linhaB?.id_pagamento ?? null, valor: divisao.restanteCentavos / 100 }
    });
  } catch (e) {
    console.error("[faturado-com-entrada]", e);
    return erro(500, "Erro interno ao criar o Faturado com entrada.");
  }
}
