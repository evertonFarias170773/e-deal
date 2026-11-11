import type { PropostaFrete } from "@/features/orcamentos/types";
import { CotacaoSemValorError, separarCardsSemValor } from "@/features/orcamentos/lib/cotacao-sem-valor";

/**
 * Resposta do webhook `sedex_vibe` -> cards dos Correios (SEDEX e PAC).
 *
 * Desde 11/11/2026 (caso 25058) item sem valor não vira card: antes, um item
 * sem `servico`, `valor` e `prazo` virava "Correios / SEDEX / R$ 0,00 / Sob
 * consulta". Nenhum item com valor = `CotacaoSemValorError`, para a tela dizer
 * que o SEDEX não cotou. Itens sem valor ao lado de itens com valor saem da
 * lista e vão para `aoDescartarSemValor`.
 */
export function cardsDaRespostaSedex(
  data: unknown,
  input: { peso: number; id_int?: number | string; volumes: number },
  aoDescartarSemValor?: (servicos: string[]) => void
): PropostaFrete[] {
  let arrayData: Record<string, unknown>[];
  if (Array.isArray(data)) {
    arrayData = data as Record<string, unknown>[];
  } else if (data && typeof data === "object") {
    arrayData = [data as Record<string, unknown>];
  } else {
    throw new Error("Resposta inválida do serviço de frete.");
  }

  const cards = arrayData.map((item, idx): PropostaFrete => {
    const prazo = item.prazo as number | undefined;
    const servico = item.servico as string | undefined;
    const valor = item.valor as number | undefined;
    const texto_entrega = item.texto_entrega as string | undefined;

    const prazoText = prazo ? (prazo === 1 ? "1 dia útil" : `${prazo} dias úteis`) : "Sob consulta";

    return {
      id: `frete_${String(servico || "sedex").toLowerCase()}_${idx}`,
      id_int: typeof input.id_int === "number" ? input.id_int : Number(input.id_int) || 0,
      transportadora: servico === "SEDEX" ? "Correios SEDEX" : servico === "PAC" ? "Correios PAC" : servico || "Correios",
      servico: servico || "SEDEX",
      valor: Number(valor || 0),
      prazo: prazoText,
      observacao: texto_entrega || "",
      escolhido: false,
      pesoUsado: input.peso,
      volumes: input.volumes
    };
  });

  const { comValor, semValor } = separarCardsSemValor(cards);
  if (comValor.length === 0) throw new CotacaoSemValorError("SEDEX");
  if (semValor.length > 0) {
    console.warn("[FreteService] Correios: opção sem valor descartada:", semValor.map((c) => c.servico));
    aoDescartarSemValor?.(semValor.map((c) => c.servico));
  }
  return comValor;
}
