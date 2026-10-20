import { rotuloDoSeloRetrabalho } from "@/lib/retrabalho";

/**
 * Selo de texto do retrabalho (17/10/2026; compartilhado desde 19/10/2026). O
 * destaque nunca depende só da cor: contorno, número na cor do token e este selo.
 * A cor é a do token `--retrabalho` (claro e escuro em `globals.css`).
 * Com o pedido original (20/10/2026), "Retrabalho de #X" (`rotuloDoSeloRetrabalho`).
 */
export function SeloRetrabalho({ idIntOriginal = null }: { idIntOriginal?: number | null } = {}) {
  return (
    <span
      data-selo-retrabalho
      data-retrabalho-original={idIntOriginal ?? undefined}
      className="inline-flex items-center rounded-md border border-[var(--retrabalho)] px-1.5 py-0.5 text-[11px] font-bold normal-case tracking-normal text-[var(--retrabalho)]"
    >
      {rotuloDoSeloRetrabalho(idIntOriginal)}
    </span>
  );
}

/** O contorno do card ou da linha com retrabalho (estilo inline, por cima das classes de estado). */
export const CONTORNO_RETRABALHO = { outline: "2px solid var(--retrabalho)", outlineOffset: "-2px" } as const;
