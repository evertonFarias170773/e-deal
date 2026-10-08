import { CalendarDays } from "lucide-react";
import type { LinhaDaPrevisao } from "@/features/fiscal/lib/fila-producao-desde";

/**
 * O selo da previsão de entrega da produção — a segunda linha da coluna
 * "Em produção desde" da Fila de Faturamento. Um componente só, usado pela
 * tabela e pelo cartão do celular: a aparência muda aqui, e só aqui.
 *
 * O ESTADO vem pronto de `linhaDaPrevisao` (lib/fila-producao-desde) — este
 * arquivo não decide nada, só veste. O texto já diz o estado ("Previsão",
 * "Previsão: hoje", "Atrasado", "Sem previsão"); a cor só reforça.
 *
 * Contraste do texto sobre o fundo do selo (Tailwind, fundo claro), todos acima
 * do AA (4,5:1): sky-900/sky-50, amber-900/amber-50, red-800/red-50 e
 * slate-600/slate-50.
 */
const APARENCIA = {
  NO_PRAZO: { chave: "no-prazo", classes: "bg-sky-50 text-sky-900 ring-sky-200", dica: "Previsão de entrega definida na produção" },
  HOJE: { chave: "hoje", classes: "bg-amber-50 text-amber-900 ring-amber-300", dica: "A previsão de entrega da produção é hoje" },
  ATRASADO: { chave: "vencida", classes: "bg-red-50 text-red-800 ring-red-200", dica: "A previsão de entrega da produção já passou" },
  SEM_PREVISAO: { chave: "sem", classes: "bg-slate-50 text-slate-600 ring-slate-200", dica: "A produção ainda não definiu a previsão de entrega" }
} as const;

/**
 * `compacto`: na TABELA a coluna é estreita e o selo inteiro empurrava o botão
 * Faturar para fora da tela (medido em 1700 px). Ali o atraso sai sem "(N dias)"
 * e o de hoje sem repetir a data; o texto inteiro fica na dica. No cartão do
 * celular há largura, e o texto vai inteiro.
 */
export function SeloDaPrevisao({ previsao, compacto = false }: { previsao: LinhaDaPrevisao; compacto?: boolean }) {
  // Leitura das previsões não pronta (carregando ou com falha): a linha não aparece.
  if (previsao.tipo === "OCULTA") return null;
  const aparencia = previsao.tipo === "SEM_PREVISAO" ? APARENCIA.SEM_PREVISAO : APARENCIA[previsao.estado];
  return (
    <span
      data-previsao={aparencia.chave}
      title={previsao.tipo === "PREVISAO" && previsao.texto !== previsao.textoCurto ? `${aparencia.dica} — ${previsao.texto}` : aparencia.dica}
      className={`inline-flex items-center gap-0.5 whitespace-nowrap rounded-full px-1.5 py-0.5 ring-1 ring-inset text-xs font-semibold tracking-tight ${aparencia.classes}`}
    >
      <CalendarDays className="h-3 w-3 shrink-0" aria-hidden="true" />
      {previsao.tipo === "PREVISAO" && compacto ? previsao.textoCurto : previsao.texto}
    </span>
  );
}
