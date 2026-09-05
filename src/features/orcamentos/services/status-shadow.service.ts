import { getSupabaseClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calcularStatusRecomendado } from "./status-engine.service";
// `import type` porque os dois SAO interfaces: nao existem em runtime. Escritos
// como import de valor, o Next elide na compilacao e ninguem percebia, mas
// qualquer carregador que apenas remove tipos — o `--experimental-strip-types`
// do node, usado pelos testes .mts — tenta importa-los e quebra o modulo.
import type { EngineStatusResult, EvidenciaStatus } from "./status-engine.service";
import { calcularSituacaoQuitacaoProposta } from "@/features/cobrancas/services/conferencia-financeira.service";

/**
 * Coleta dados do Supabase (leitura) e roda a Engine Pura para calcular o status
 * recomendado. A regra financeira é a MESMA regra oficial de quitação usada em
 * pagamentos_v2/confirmar e editar-paga (calcularSituacaoQuitacaoProposta) — não
 * há uma segunda fórmula de soma de pagamentos aqui.
 *
 * @param idInt O ID inteiro da Proposta
 * @param isAvulso Se a proposta é avulsa
 * @param statusInternoAtual O status atual que já está gravado
 * @param supabaseClient Cliente autenticado opcional — obrigatório quando chamado
 *   a partir de uma rota server-side (Route Handler), já que getSupabaseClient()
 *   só funciona no navegador.
 */
export async function validarStatusProposta(
  idInt: string | number,
  isAvulso: boolean,
  statusInternoAtual: string,
  supabaseClient?: SupabaseClient
): Promise<EngineStatusResult | null> {
  try {
    const supabase = supabaseClient || getSupabaseClient();
    if (!supabase) return null;

    const numericIdInt = Number(idInt);

    // Regra oficial de quitação reutilizada (não duplicada): mesma fonte usada em
    // /api/cobrancas/confirmar e /api/orcamentos/editar-paga.
    const situacao = await calcularSituacaoQuitacaoProposta(supabase, numericIdInt);

    // ALERTA DE DADO INCONSISTENTE (não altera a regra da engine).
    // A guarda `totalCents > 0` do status-engine é proposital: proposta sem
    // valor nunca pode ser dada como quitada. Mas total 0/nulo COM pagamento
    // confirmado é dado corrompido, não fluxo normal — e antes disso passava
    // silencioso, indistinguível de "nada a fazer" (caso #18792, avulsa paga
    // com `propostas.valor_total` nulo, parada em AGUARDANDO por ~1 mês).
    if (situacao.valorTotalProposta <= 0 && situacao.valorQuitadoAtual > 0) {
      console.error(
        `[StatusEngine][DADO INCONSISTENTE] Proposta #${numericIdInt}: pagamento confirmado de R$ ${situacao.valorQuitadoAtual.toFixed(2)} ` +
        `com valor_total = ${situacao.valorTotalProposta}. O status NÃO será promovido enquanto o total não for corrigido ` +
        `(is_avulso=${isAvulso}, status atual=${statusInternoAtual}).`
      );
    }

    // Buscar modelos/produtos físicos
    const { data: modelos, error: errModelos } = await supabase
      .from("pedidos_modelos")
      .select("status_arte, status_producao")
      .eq("id_int", numericIdInt);

    if (errModelos) {
      console.error("Erro ao buscar modelos para engine de status", errModelos);
      return null;
    }

    // Produto de prateleira: dispensa arte quando a proposta tem ao menos um
    // item ativo e TODOS são de prateleira. Mesma definição de
    // check_and_promote_proposta no banco — item cancelado fora da conta, zero
    // itens nunca dispensa. A fonte é o snapshot do item (produtos_proposta),
    // não o cadastro atual do produto.
    const { data: itens, error: errItens } = await supabase
      .from("produtos_proposta")
      .select("is_estoque, status_item")
      .eq("id_int", numericIdInt);

    if (errItens) {
      console.error("Erro ao buscar itens para engine de status", errItens);
      return null;
    }

    const itensAtivos = (itens || []).filter(
      (i) => String(i.status_item || "PENDENTE").toUpperCase() !== "CANCELADO"
    );
    const arteDispensada = itensAtivos.length > 0 && itensAtivos.every((i) => i.is_estoque === true);

    const evidencias: EvidenciaStatus = {
      statusInternoAtual,
      valorTotalProposta: situacao.valorTotalProposta,
      valorPagoConfirmado: situacao.valorQuitadoAtual,
      temCobrancaAtiva: situacao.cobrancasAtivas.length > 0,
      modelos: modelos || [],
      isAvulso,
      arteDispensada
    };

    // Chamar engine pura sem efeitos colaterais
    return calcularStatusRecomendado(evidencias);

  } catch (err) {
    console.error("Falha ao rodar engine de status", err);
    return null;
  }
}
