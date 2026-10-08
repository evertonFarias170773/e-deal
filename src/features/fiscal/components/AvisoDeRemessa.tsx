import { AlertTriangle, MapPin } from "lucide-react";
import { ACAO_DA_REMESSA, dicaDoAvisoDeRemessa, type AvisoDeRemessa } from "@/features/fiscal/lib/aviso-remessa";

/**
 * O aviso de nota de remessa, em duas roupas: o SELO da Fila de Faturamento e a
 * FAIXA do rascunho da NF-e. Nenhum dos dois decide nada — o nível e os textos
 * vêm prontos de `avaliarRemessa` (lib/aviso-remessa).
 *
 * É só aviso: não bloqueia o Faturar nem a emissão.
 */
const APARENCIA = {
  FORTE: { chave: "forte", selo: "bg-red-50 text-red-800 ring-red-200", faixa: "border-red-200 bg-red-50", titulo: "text-red-900", texto: "text-red-800", icone: "text-red-600" },
  LEVE: { chave: "leve", selo: "bg-amber-50 text-amber-900 ring-amber-300", faixa: "border-amber-200 bg-amber-50", titulo: "text-amber-900", texto: "text-amber-800", icone: "text-amber-600" }
} as const;

/** Texto curto do selo: a coluna da Fila é estreita, e o detalhe fica na dica. */
const TEXTO_DO_SELO = { FORTE: "Remessa necessária", LEVE: "Conferir remessa" } as const;

/** O selo da linha da Fila. Sem aviso (ou leitura não pronta), não renderiza nada. */
export function SeloDeRemessa({ aviso }: { aviso: AvisoDeRemessa }) {
  if (aviso.nivel === "NENHUM") return null;
  const aparencia = APARENCIA[aviso.nivel];
  return (
    <span
      data-aviso-remessa={aparencia.chave}
      title={dicaDoAvisoDeRemessa(aviso)}
      className={`inline-flex max-w-full items-center gap-0.5 self-start whitespace-nowrap rounded-full px-1.5 py-0.5 ring-1 ring-inset text-xs font-semibold tracking-tight ${aparencia.selo}`}
    >
      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
      {TEXTO_DO_SELO[aviso.nivel]}
    </span>
  );
}

/** A faixa do rascunho da NF-e, com os dois endereços lado a lado. */
export function FaixaDeRemessa({ aviso }: { aviso: AvisoDeRemessa | null | undefined }) {
  if (!aviso || aviso.nivel === "NENHUM") return null;
  const aparencia = APARENCIA[aviso.nivel];
  return (
    <div data-aviso-remessa={aparencia.chave} className={`rounded-2xl border p-4 ${aparencia.faixa}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${aparencia.icone}`} aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className={`text-sm font-bold ${aparencia.titulo}`}>{aviso.titulo}</p>
          <p className={`text-xs ${aparencia.texto}`}>{aviso.texto}.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-white/70 p-2.5">
              <p className={`text-[11px] font-bold uppercase tracking-wide ${aparencia.titulo}`}>Entrega do pedido</p>
              <p className="break-words text-xs text-slate-800">{aviso.entrega}</p>
            </div>
            <div className="rounded-xl bg-white/70 p-2.5">
              <p className={`text-[11px] font-bold uppercase tracking-wide ${aparencia.titulo}`}>Endereço da NF-e</p>
              <p className="break-words text-xs text-slate-800">{aviso.nfe}</p>
            </div>
          </div>
          <p className={`text-xs ${aparencia.texto}`}>É só um aviso: não impede a emissão. {ACAO_DA_REMESSA}</p>
        </div>
      </div>
    </div>
  );
}
