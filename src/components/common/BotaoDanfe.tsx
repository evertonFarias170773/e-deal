"use client";

/**
 * O botão de baixar a DANFE, onde a nota do pedido é assunto.
 *
 * POR QUE EXISTE
 *   A DANFE só podia ser baixada no Histórico de Notas Fiscais: quem estava na
 *   Expedição com a caixa na mão, ou no Orçamento com o cliente ao telefone,
 *   tinha de sair da tela, achar o pedido no meio das notas e voltar. O arquivo
 *   é o mesmo; o que faltava era a porta.
 *
 * UM CLIQUE QUANDO HÁ UMA NOTA, ESCOLHA QUANDO HÁ MAIS
 *   Pedido com uma DANFE baixa direto — perguntar "qual?" com uma resposta só é
 *   burocracia. Com faturamento parcial ou remessa o pedido passa a ter duas ou
 *   três, e aí o menu abre e diz qual é qual: "NF venda", "NF complementar",
 *   "NF remessa", cada uma com número e ref. Baixar a errada e mandar para o
 *   cliente é um erro caro e silencioso.
 *
 * NÃO DECIDE NADA SOBRE AS NOTAS
 *   Quem filtra e rotula é `danfesDoPedido`. Este arquivo é só o gatilho e o
 *   menu. Sem DANFE, ele não renderiza — nenhum botão morto na tela.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { FileDown } from "lucide-react";
import { ACTIONS_MENU_OPEN_EVENT } from "@/components/common/ActionsMenu";
import { rotuloDaDanfe, type DanfeDoPedido } from "@/lib/fiscal/danfes-do-pedido";

const LARGURA_DO_MENU = 260;
const MARGEM_DA_JANELA = 12;

type BotaoDanfeProps = {
  /**
   * O que este pedido tem para baixar, já filtrado e rotulado por
   * `danfesDoPedido` — quem monta a lista é quem carrega as notas em lote, para
   * que nenhuma tela precise consultar por linha.
   */
  danfes: readonly DanfeDoPedido[] | null | undefined;
  /** `card` é o do Kanban da Expedição, menor; `linha` é o das listas. */
  tamanho?: "linha" | "card";
  className?: string;
};

export function BotaoDanfe({ danfes: recebidas, tamanho = "linha", className }: BotaoDanfeProps) {
  const danfes = recebidas ?? [];
  const menuId = useId();
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function cliqueFora(evento: MouseEvent) {
      if (!caixaRef.current?.contains(evento.target as Node)) setAberto(false);
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }
    // Um menu de ações abriu em outro lugar: dois menus abertos ao mesmo tempo
    // é ruído, e o de ações usa este mesmo evento para se fechar.
    function outroMenuAbriu(evento: Event) {
      if ((evento as CustomEvent<string>).detail !== menuId) setAberto(false);
    }
    document.addEventListener("mousedown", cliqueFora);
    document.addEventListener("keydown", tecla);
    window.addEventListener(ACTIONS_MENU_OPEN_EVENT, outroMenuAbriu);
    return () => {
      document.removeEventListener("mousedown", cliqueFora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener(ACTIONS_MENU_OPEN_EVENT, outroMenuAbriu);
    };
  }, [menuId]);

  useEffect(() => {
    if (!aberto) return;
    function posicionar() {
      const botao = botaoRef.current;
      if (!botao) return;
      const retangulo = botao.getBoundingClientRect();
      const left = Math.min(
        Math.max(retangulo.right - LARGURA_DO_MENU, MARGEM_DA_JANELA),
        Math.max(MARGEM_DA_JANELA, window.innerWidth - LARGURA_DO_MENU - MARGEM_DA_JANELA)
      );
      const altura = Math.min(danfes.length * 44 + 12, 320);
      const cabeAbaixo = window.innerHeight - retangulo.bottom - MARGEM_DA_JANELA >= altura;
      const top = cabeAbaixo
        ? retangulo.bottom + 8
        : Math.max(MARGEM_DA_JANELA, retangulo.top - altura - 8);
      setPosicao({ top, left });
    }
    posicionar();
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [aberto, danfes.length]);

  if (danfes.length === 0) return null;

  const ehCard = tamanho === "card";
  const uma = danfes.length === 1;
  const titulo = uma
    ? `Baixar DANFE - ${rotuloDaDanfe(danfes[0])}`
    : `Baixar DANFE (${danfes.length} notas)`;

  function baixar(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
    setAberto(false);
  }

  function aoClicar(evento: React.MouseEvent) {
    // O card do Kanban e a linha da lista abrem o pedido ao clique: sem isto, a
    // DANFE viria junto com uma navegação que ninguém pediu.
    evento.stopPropagation();
    evento.preventDefault();
    if (uma) {
      baixar(danfes[0].url);
      return;
    }
    if (aberto) {
      setAberto(false);
      return;
    }
    window.dispatchEvent(new CustomEvent(ACTIONS_MENU_OPEN_EVENT, { detail: menuId }));
    setAberto(true);
  }

  return (
    <div ref={caixaRef} className={`relative inline-flex ${className ?? ""}`}>
      <button
        ref={botaoRef}
        type="button"
        onClick={aoClicar}
        title={titulo}
        aria-label={titulo}
        aria-expanded={uma ? undefined : aberto}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg transition ${ehCard ? "h-8 w-8" : "h-9 w-9"}`}
        style={{ background: "transparent", color: "var(--muted)" }}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.background = "color-mix(in srgb, var(--foreground) 8%, transparent)";
          el.style.color = "var(--foreground)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.background = "transparent";
          el.style.color = "var(--muted)";
        }}
      >
        <FileDown className={ehCard ? "h-4 w-4" : "h-[18px] w-[18px]"} />
        {/* Com mais de uma nota o botão avisa quantas, antes do clique. */}
        {!uma && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none"
            style={{ background: "var(--secondary)", color: "var(--card)" }}
          >
            {danfes.length}
          </span>
        )}
      </button>

      {aberto && !uma ? (
        <div
          className="fixed z-50 overflow-y-auto rounded-2xl p-1 shadow-xl"
          style={
            {
              top: posicao?.top,
              left: posicao?.left,
              width: LARGURA_DO_MENU,
              maxHeight: 320,
              background: "var(--card)",
              border: "1px solid var(--border)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)"
            } satisfies CSSProperties
          }
          onClick={(evento) => evento.stopPropagation()}
        >
          <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--secondary)" }}>
            Baixar DANFE
          </p>
          {danfes.map((danfe) => (
            <button
              key={danfe.ref || danfe.numero}
              type="button"
              onClick={(evento) => {
                evento.stopPropagation();
                baixar(danfe.url);
              }}
              className="flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition"
              style={{ color: "var(--foreground)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--card-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <span className="text-sm font-semibold">{`${danfe.rotulo} - nº ${danfe.numero}`}</span>
              {danfe.ref ? (
                <span className="text-[11px]" style={{ color: "var(--muted)" }}>{danfe.ref}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
