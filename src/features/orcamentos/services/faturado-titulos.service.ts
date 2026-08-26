/**
 * Títulos do Contas a Receber ligados a uma cobrança faturada a vencer.
 *
 * Alterar uma proposta com faturado a vencer muda o valor da cobrança, e com
 * isso os títulos já gerados deixam de valer. Este módulo lê esses títulos e
 * os retira do Contas a Receber, devolvendo a cobrança para Registros de
 * Recebíveis — de onde o financeiro gera os títulos de novo, já com o valor
 * novo.
 *
 * O cancelamento bancário NÃO é reimplementado aqui: `deleteBoletoFromBankViaN8n`
 * já resolve o roteamento por empresa (Inter para a Ideal Birô, fluxo legado
 * para as demais) e é o mesmo caminho que a tela de Contas a Receber usa.
 *
 * Regras de quando isso é permitido vivem em `faturado-editavel.ts`; aqui é só
 * execução.
 */
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  tituloExigeCancelamentoBancario,
  rotuloTitulo,
  type TituloParaFaturado
} from "./faturado-editavel";

const MOTIVO_PADRAO = "Proposta alterada com cobranca faturada a vencer.";

const COLUNAS_TITULO =
  "id, id_pagamento, parcela, total_parcelas, valor, vencimento, status, paid_at, deposito_conta, id_boleto_c6, id_empresa";

export type ResultadoExclusaoTitulos = {
  success: boolean;
  excluidos: number;
  /** Títulos que falharam, com o motivo que o banco ou o Supabase devolveu. */
  falhas: { rotulo: string; erro: string }[];
  /** A cobrança foi cancelada em cascata pelo n8n e teve de ser reativada. */
  cobrancaReativada?: boolean;
};

/** Status em que a cobrança deixa de ser considerada ativa. */
const STATUS_COBRANCA_INATIVA = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

/** Todos os títulos da proposta. A seleção de quais pertencem ao faturado é do avaliador. */
export async function listarTitulosDaProposta(idInt: number): Promise<TituloParaFaturado[] | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("boletos")
    .select(COLUNAS_TITULO)
    .eq("id_int", idInt)
    .returns<TituloParaFaturado[]>();

  if (error) {
    console.error("[faturado-titulos] Falha ao ler os titulos da proposta:", error.message);
    return null;
  }

  return data ?? [];
}

/**
 * Retira os títulos do Contas a Receber e devolve a cobrança para Registros de
 * Recebíveis.
 *
 * Um título por vez, e para no primeiro erro: cancelamento bancário é
 * irreversível, então seguir adiante depois de uma falha só aumentaria o
 * estrago. O que já saiu permanece fora — é recuperável, porque o financeiro
 * regera os títulos pelo Registro de Recebíveis.
 */
export async function excluirTitulosDoFaturado(params: {
  titulos: TituloParaFaturado[];
  faturadoId: string;
  motivo?: string;
}): Promise<ResultadoExclusaoTitulos> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, excluidos: 0, falhas: [{ rotulo: "Conexão", erro: "Supabase não configurado." }] };
  }

  const motivo = String(params.motivo || "").trim() || MOTIVO_PADRAO;
  const falhas: ResultadoExclusaoTitulos["falhas"] = [];
  let excluidos = 0;

  for (const titulo of params.titulos) {
    try {
      if (tituloExigeCancelamentoBancario(titulo)) {
        const { deleteBoletoFromBankViaN8n } = await import("@/features/nfe/services/nfe.service");
        await deleteBoletoFromBankViaN8n(
          titulo.id,
          String(titulo.id_boleto_c6 ?? ""),
          Number(titulo.id_empresa || 1),
          motivo
        );
      }

      // O caminho do Inter já exclui a linha; o legado e o depósito não. Marcar
      // CANCELADO na linha que sobrou mantém o histórico e tira o título das
      // telas — é o mesmo padrão do Contas a Receber.
      const { data: aindaExiste } = await client
        .from("boletos")
        .select("id")
        .eq("id", titulo.id)
        .maybeSingle<{ id: string }>();

      if (aindaExiste) {
        const { error: updateError } = await client
          .from("boletos")
          .update({ status: "CANCELADO" })
          .eq("id", titulo.id);

        if (updateError) throw new Error(updateError.message);
      }

      excluidos += 1;
    } catch (erro) {
      falhas.push({
        rotulo: rotuloTitulo(titulo),
        erro: erro instanceof Error ? erro.message : String(erro)
      });
      break;
    }
  }

  if (falhas.length > 0) {
    return { success: false, excluidos, falhas };
  }

  // DEFESA IDEMPOTENTE contra cancelamento em cascata da cobrança.
  //
  // Este bloco nasceu descrito como reação a algo observado: "o workflow marca
  // a cobrança inteira como CANCELADO quando não resta parcela ativa". Lido o
  // fluxo vivo em 25 e 26/08/2026, o ramo de cancelamento do
  // VIBE-BOLETO-FATURADO-INTER **não escreve em `pagamentos_v2`** — a cascata
  // não acontece, e este ramo NÃO dispara hoje.
  //
  // Fica assim mesmo, por três razões: é barato, é no-op quando não há o que
  // reativar, e o workflow já perdeu correções duas vezes por save/reimport na
  // UI do n8n — se a cascata voltar, o efeito seria exatamente o que o
  // financeiro não pediu: ele quer trocar o valor e registrar de novo, não
  // cancelar. Uma cobrança cancelada sai da lista de ativas e o save seguinte
  // deixaria a proposta com o valor novo e a cobrança com o valor velho, fora
  // do faturamento e sem rastro.
  //
  // A decisão sai da RELEITURA abaixo, nunca do retorno do webhook.
  const { data: cobrancaAtual } = await client
    .from("pagamentos_v2")
    .select("status, motivo_cancela")
    .eq("id", params.faturadoId)
    .maybeSingle<{ status: string | null; motivo_cancela: string | null }>();

  const foiCanceladaEmCascata = STATUS_COBRANCA_INATIVA.includes(
    String(cobrancaAtual?.status ?? "").trim().toUpperCase()
  );

  const patch: Record<string, unknown> = { boleto_enviadoo: false };
  if (foiCanceladaEmCascata) {
    patch.status = "A_VENCER";
    patch.motivo_cancela = null;
  }

  const { error: cobrancaError } = await client
    .from("pagamentos_v2")
    .update(patch)
    .eq("id", params.faturadoId);

  if (cobrancaError) {
    return {
      success: false,
      excluidos,
      falhas: [
        {
          rotulo: foiCanceladaEmCascata ? "Cobrança cancelada em cascata" : "Registros de Recebíveis",
          erro: foiCanceladaEmCascata
            ? `A exclusão do título cancelou a cobrança inteira e não foi possível reativá-la: ${cobrancaError.message}. NÃO salve a proposta — acerte a cobrança na aba Pagamentos antes.`
            : `Títulos excluídos, mas a cobrança não voltou para a lista: ${cobrancaError.message}`
        }
      ]
    };
  }

  return { success: true, excluidos, falhas: [], cobrancaReativada: foiCanceladaEmCascata };
}
