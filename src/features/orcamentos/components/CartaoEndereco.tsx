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

      {/*
        SELOS (12/10/2026): numa linha PROPRIA, abaixo do cabecalho, alinhada a esquerda do
        texto. Antes ficavam ao lado do cabecalho dentro de um `div` sem quebra de linha, e na
        lateral estreita de Fretes o texto de cada selo se partia em 3 linhas dentro de uma
        pilula. Os selos chegam prontos de `badgeForItem` (cores, textos e regras de quando
        aparecem sao de la e nao mudam); aqui so o LAYOUT. A linha ocupa a LARGURA INTEIRA do
        cartao, logo abaixo do cabecalho (e nao a coluna entre o icone e os botoes, que no
        celular deixava ~110 px e quebrava o texto em 3 linhas):
          - `[&>div]:contents` desfaz o `div` que agrupa os selos, para cada selo virar item
            da linha e o `flex-wrap` poder joga-los um por linha quando o espaco e curto;
          - cada selo e um retangulo arredondado (nao pilula), com a mesma altura minima, a
            mesma fonte e o mesmo padding (o selo vermelho ganha uma borda transparente, como a do
            azul, para os dois terem a mesma altura sem mudar a cor); `max-w-full` faz o texto ficar numa linha quando
            cabe e quebrar no maximo em duas quando nao cabe.
        No tema escuro, sobre o azul claro do destaque, o selo azul (cores proprias e
        translucidas) sumia: ganha atras o mesmo tom que tem no cartao comum, so que solido.
      */}
      {badge ? (
        <div
          className={`mt-2 flex flex-wrap items-start gap-1.5 [&>div]:contents [&_span]:min-h-6 [&_span]:max-w-full [&_span]:items-center [&_span]:rounded-md [&_span]:px-2.5 [&_span]:py-1 [&_span]:text-left [&_span]:text-[10px] [&_span]:font-semibold [&_span]:leading-4 [&_span]:whitespace-normal [&_span]:break-words [&_span.bg-red-500]:border [&_span.bg-red-500]:border-transparent ${
            destaque ? "dark:[&_span.bg-blue-100]:!bg-[color-mix(in_srgb,#60a5fa_16%,var(--card))]" : ""
          }`}
        >
          {badge}
        </div>
      ) : null}

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
