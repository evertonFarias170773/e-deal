import { AlertTriangle } from "lucide-react";
import { textoDeEntrega } from "@/features/pedidos/lib/instrucoes-entrega";

/**
 * Instrucoes de entrega do pedido (`propostas.obs_entrega`) na Expedicao.
 *
 * Dois formatos, um texto so:
 *  - "icone": aviso discreto para o card do Kanban e o cartao do celular. O
 *    texto inteiro fica na dica (`title`) e no `aria-label`.
 *  - "texto": o texto inteiro, com as quebras de linha, para a lista e a
 *    janela Despachar.
 *
 * Sem texto nao renderiza nada — nem icone, nem caixa, nem espaco. Nao mexe nas
 * cores de fase, nos chips de vinculo nem no bairro do Motoboy: e um elemento a
 * mais, com a cor ambar de aviso que o painel ja usa.
 */
export function AvisoInstrucaoEntrega({
  texto,
  formato,
  className = ""
}: {
  texto: string | null | undefined;
  formato: "icone" | "texto";
  className?: string;
}) {
  const instrucao = textoDeEntrega(texto);
  if (!instrucao) return null;

  if (formato === "icone") {
    const dica = `Instruções de entrega:\n${instrucao}`;
    return (
      <span
        role="img"
        aria-label={dica}
        title={dica}
        data-testid="aviso-instrucao-entrega"
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-amber-600 dark:text-amber-400 ${className}`}
      >
        <AlertTriangle className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
    );
  }

  return (
    <div
      data-testid="instrucao-entrega-texto"
      className={`flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">Instruções de entrega</p>
        <p className="whitespace-pre-line break-words text-[13px] font-medium leading-5">{instrucao}</p>
      </div>
    </div>
  );
}
