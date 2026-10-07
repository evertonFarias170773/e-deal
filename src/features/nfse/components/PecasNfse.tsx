"use client";

/**
 * Peças visuais da janela "Gerar NFS-e".
 *
 * Seguem os mesmos tokens da tela de rascunho da NF-e (NfeDetailPage): cartão
 * de seção com borda `#d7e5e8`, cartões de resumo em `bg-slate-50/50`, ícone de
 * conferido em verde e o banner verde de "validado". São peças PRÓPRIAS da
 * NFS-e: as da NF-e estão amarradas aos blocos dela e não são alteradas.
 * Nenhuma tem regra — só desenham o que recebem.
 */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

export type EstadoDaSecao = "ok" | "atencao" | "neutro";

function IconeDoEstado({ estado }: { estado: EstadoDaSecao }) {
  if (estado === "atencao") return <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />;
  if (estado === "neutro") return <Info className="h-5 w-5 shrink-0 text-slate-400" />;
  return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />;
}

/** Uma seção da janela: cartão com título, ícone do estado e um detalhe curto à direita. */
export function SecaoNfse({
  titulo,
  estado = "ok",
  detalhe,
  children,
  ...resto
}: {
  titulo: string;
  estado?: EstadoDaSecao;
  detalhe?: string;
  children: ReactNode;
  "data-secao"?: string;
}) {
  return (
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm" {...resto}>
      <header className="mb-4 flex items-center gap-2.5">
        <IconeDoEstado estado={estado} />
        <h3 className="text-base font-bold text-slate-900">{titulo}</h3>
        {detalhe && <span className="ml-auto text-xs font-semibold text-slate-500">{detalhe}</span>}
      </header>
      {children}
    </section>
  );
}

/** Um dos três cartões do resumo. */
export function CartaoDeResumo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/50 p-5">
      <h4 className="text-sm font-bold text-slate-800">{titulo}</h4>
      {children}
    </div>
  );
}

/** Linha "rótulo: valor" dos cartões de resumo. */
export function LinhaDeResumo({ rotulo, children, forte }: { rotulo: string; children: ReactNode; forte?: boolean }) {
  return (
    <p className={forte ? "flex justify-between gap-3 border-t border-slate-200 pt-2 text-sm font-bold text-slate-900" : "flex justify-between gap-3 text-sm text-slate-600"}>
      <span>{rotulo}</span>
      <span className="text-right font-semibold text-slate-900">{children}</span>
    </p>
  );
}

const TOM_DO_SELO: Record<"neutro" | "aviso" | "sucesso" | "erro", string> = {
  neutro: "border-slate-200 bg-slate-100 text-slate-700",
  aviso: "border-orange-200 bg-orange-50 text-orange-700",
  sucesso: "border-teal-200 bg-teal-50 text-teal-700",
  erro: "border-red-200 bg-red-50 text-red-700"
};

/** Selo do status da nota, no cabeçalho. */
export function SeloDeStatus({ rotulo, tom, statusReal }: { rotulo: string; tom: "neutro" | "aviso" | "sucesso" | "erro"; statusReal?: string }) {
  return (
    <span
      data-status-nfse={statusReal ?? ""}
      title={statusReal ? `Status: ${statusReal}` : undefined}
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${TOM_DO_SELO[tom]}`}
    >
      {rotulo}
    </span>
  );
}

/** Faixa do ambiente: amarela em homologação, vermelha em produção. */
export function FaixaDoAmbiente({ ambiente }: { ambiente: "producao" | "homologacao" | null }) {
  return (
    <div
      data-ambiente={ambiente ?? "indefinido"}
      className={
        ambiente === "producao"
          ? "rounded-2xl border-2 border-red-700 bg-red-600 px-4 py-2.5 text-center text-sm font-extrabold tracking-wide text-white"
          : "rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-center text-sm font-bold text-amber-900"
      }
    >
      {ambiente === "producao" && "PRODUÇÃO: NOTA COM VALOR FISCAL"}
      {ambiente === "homologacao" && "HOMOLOGAÇÃO: NOTA DE TESTE, sem valor fiscal"}
      {ambiente === null && "Ambiente da NFS-e não definido no cadastro da empresa"}
    </div>
  );
}

/** O banner verde de "validado", igual ao da NF-e. */
export function BannerValidado({ children }: { children: ReactNode }) {
  return (
    <div data-banner-validado className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
      {children}
    </div>
  );
}

/** Aviso em destaque: âmbar para atenção, vermelho para o que impede. */
export function AvisoEmDestaque({ tom, children }: { tom: "atencao" | "impede"; children: ReactNode }) {
  return (
    <div
      className={
        tom === "impede"
          ? "flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800"
          : "flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800"
      }
    >
      <AlertTriangle className={tom === "impede" ? "mt-0.5 h-4 w-4 shrink-0 text-red-600" : "mt-0.5 h-4 w-4 shrink-0 text-amber-600"} />
      <span>{children}</span>
    </div>
  );
}

export const CAMPO_NFSE =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#0b2f4a] disabled:bg-slate-50 disabled:text-slate-500";
export const ROTULO_NFSE = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";
export const BOTAO_SECUNDARIO_NFSE =
  "inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50";
export const BOTAO_PRIMARIO_NFSE =
  "inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#061d2e] disabled:opacity-50";
