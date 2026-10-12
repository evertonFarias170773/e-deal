import React from "react";
import { Check, Copy, Edit2 } from "lucide-react";
import { camposDoCartaoDeEndereco, type EnderecoParaCartao } from "@/features/orcamentos/lib/campos-do-endereco";

/**
 * O CARTAO FECHADO do endereco de entrega (box 5), UM so para os dois casos
 * (12/10/2026): o endereco SELECIONADO e cada "Outra opcao de entrega". O unico
 * parametro de aparencia e `destaque`: o selecionado sai em fundo escuro com
 * texto branco; o resto do layout e identico. Mostra todos os campos que o
 * endereco ja tem (`camposDoCartaoDeEndereco`) e abre para edicao pelo lapis.
 *
 * TEMA ESCURO. O destaque usa o par `bg-[#0b2f4a] text-white` que o sistema ja
 * usa (botao primario). No tema escuro o global.css troca esse fundo pelo azul
 * claro do `--primary` e a cor do TEXTO do proprio contêiner pelo
 * `--primary-foreground` — so do contêiner. Por isso os rotulos, valores e botoes
 * daqui NAO fixam cor: herdam (`opacity` e `currentColor`), e leem bem nos dois
 * temas. O cartao comum usa as classes slate que o global.css ja remapeia.
 *
 * CONTRASTE medido (WCAG, texto pequeno exige 4,5:1): com a opacidade dos rotulos em 80%
 * e a dos valores vazios em 75%, o pior caso dos quatro cenarios (destaque e opcao, em tema
 * claro e escuro) fica acima de 4,5:1. Baixar essas opacidades reabre o problema.
 *
 * So desenho. Quem escolhe, edita, copia e grava continua sendo quem chama:
 * `onClick` (so nas opcoes), `onEdit` e `onCopy` chegam como sempre chegaram.
 */
export function CartaoEndereco({
  endereco,
  origem,
  destaque,
  badge,
  onClick,
  onCopy,
  onEdit
}: {
  endereco: EnderecoParaCartao;
  /** Linha pequena de origem: "Endereço do comprador" / "Endereço do pagador selecionado". */
  origem: string;
  destaque: boolean;
  badge?: React.ReactNode;
  /** Trocar para este endereco. Só nas opções; o selecionado nao é clicável. */
  onClick?: () => void;
  onCopy?: (event: React.MouseEvent) => void;
  onEdit?: (event: React.MouseEvent) => void;
}) {
  const campos = camposDoCartaoDeEndereco(endereco);
  const clicavel = !destaque && Boolean(onClick);

  const cor = destaque
    ? "border-[#0b2f4a] bg-[#0b2f4a] text-white"
    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

  const botaoAcao =
    "inline-flex h-8 w-8 items-center justify-center rounded-full border border-current/30 opacity-90 transition hover:bg-current/15 hover:opacity-100";

  const largura = (l: 1 | 2 | "linha") => (l === 2 ? "@md:col-span-2" : l === "linha" ? "@md:col-span-full" : "");

  return (
    <div
      {...(clicavel
        ? {
            role: "option",
            "aria-selected": false,
            tabIndex: 0,
            onClick,
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick?.();
              }
            }
          }
        : {})}
      className={`@container rounded-2xl border px-4 py-3 transition ${cor} ${clicavel ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
            destaque ? "bg-current/20" : "border-2 border-slate-300"
          }`}
          aria-hidden="true"
        >
          {destaque ? <Check className="h-3 w-3" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">
              {destaque ? "Selecionado" : "Opção"} · {origem}
            </p>
            {/* No tema escuro o destaque vira azul claro e o selo (cores proprias, translucídas) sumia nele: um fundo sólido atrás o devolve ao contraste que tem no cartão comum. */}
            {badge ? <span className={`inline-flex rounded-full ${destaque ? "dark:bg-[var(--card)]" : ""}`}>{badge}</span> : null}
          </div>
        </div>
        {(onCopy || onEdit) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {onCopy && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onCopy(event);
                }}
                className={botaoAcao}
                title="Copiar endereço"
                aria-label="Copiar endereço"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(event);
                }}
                className={botaoAcao}
                title="Editar"
                aria-label="Editar"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      <dl className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-2 @md:grid-cols-2 @2xl:grid-cols-3">
        {campos.map((campo) => (
          <div key={campo.chave} className={`min-w-0 ${largura(campo.largura)}`}>
            <dt className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{campo.rotulo}</dt>
            <dd
              className={`break-words ${campo.principal ? "text-base font-bold leading-snug" : "text-sm font-semibold"} ${
                campo.apagado ? "font-medium opacity-75" : ""
              }`}
            >
              {campo.valor}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
