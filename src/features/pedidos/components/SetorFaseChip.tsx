"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { coresDoSetor } from "../setores";
import { CORES_FASE, FASES_SETOR, ROTULO_FASE, type FaseSetor } from "../status-setor";

/**
 * Chip de um setor na lista de OS: cor do setor, ponto colorido da fase e menu
 * para mover a fase daquele setor.
 *
 * Substitui os antigos rádios IMPRESSÃO/ACABAMENTO/REVISÃO, que eram do pedido
 * inteiro — com dois setores em fases diferentes eles se sobrescreviam.
 *
 * O menu é `fixed`, ancorado no botão: a tabela da lista tem
 * `overflow-hidden` e um menu absoluto seria cortado na última linha.
 */

interface SetorFaseChipProps {
  setor: string;
  fase: FaseSetor;
  /** Sem boletim aberto não há onde gravar a fase — o chip vira só rótulo. */
  temBoletim: boolean;
  salvando?: boolean;
  somenteLeitura?: boolean;
  onSelecionar: (fase: FaseSetor) => void;
}

const LARGURA_MENU = 208;
const MARGEM = 12;

export function SetorFaseChip({
  setor,
  fase,
  temBoletim,
  salvando = false,
  somenteLeitura = false,
  onSelecionar
}: SetorFaseChipProps) {
  const cores = coresDoSetor(setor);
  const [aberto, setAberto] = useState(false);
  const [posicao, setPosicao] = useState<{ top: number; left: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);

  const podeMover = temBoletim && !somenteLeitura;

  useEffect(() => {
    if (!aberto) return;

    function aoClicarFora(evento: MouseEvent) {
      if (!wrapperRef.current?.contains(evento.target as Node)) setAberto(false);
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }
    function reposicionar() {
      const botao = botaoRef.current;
      if (!botao) return;
      const rect = botao.getBoundingClientRect();
      const altura = FASES_SETOR.length * 36 + 12;
      const abaixo = window.innerHeight - rect.bottom - MARGEM >= altura;
      setPosicao({
        top: abaixo ? rect.bottom + 6 : Math.max(MARGEM, rect.top - altura - 6),
        left: Math.min(Math.max(rect.left, MARGEM), window.innerWidth - LARGURA_MENU - MARGEM)
      });
    }

    reposicionar();
    document.addEventListener("mousedown", aoClicarFora);
    document.addEventListener("keydown", aoTeclar);
    window.addEventListener("resize", reposicionar);
    window.addEventListener("scroll", reposicionar, true);
    return () => {
      document.removeEventListener("mousedown", aoClicarFora);
      document.removeEventListener("keydown", aoTeclar);
      window.removeEventListener("resize", reposicionar);
      window.removeEventListener("scroll", reposicionar, true);
    };
  }, [aberto]);

  const rotulo = temBoletim ? ROTULO_FASE[fase] : "Sem boletim";

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <button
        ref={botaoRef}
        type="button"
        disabled={!podeMover || salvando}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        title={podeMover ? `Mover a fase do setor ${setor}` : `Setor ${setor}`}
        className={`inline-flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-[11px] transition ${cores.borda} ${cores.fundo} ${cores.texto} ${
          podeMover ? "cursor-pointer hover:brightness-95" : "cursor-default opacity-80"
        } ${salvando ? "opacity-60" : ""}`}
      >
        <span
          aria-hidden
          className={`h-2 w-2 shrink-0 rounded-full ${temBoletim ? CORES_FASE[fase] : "bg-slate-300"}`}
        />
        <span className="font-bold uppercase tracking-wide">{setor}</span>
        <span className="font-medium opacity-80">{rotulo}</span>
        {podeMover && <ChevronDown className="h-3 w-3 opacity-70" />}
      </button>

      {aberto && posicao && (
        <div
          role="menu"
          className="fixed z-50 rounded-2xl border border-slate-200 bg-white p-1 shadow-xl"
          style={{ top: posicao.top, left: posicao.left, width: LARGURA_MENU }}
        >
          <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Fase do setor {setor}
          </p>
          {FASES_SETOR.map((opcao) => (
            <button
              key={opcao}
              type="button"
              role="menuitem"
              onClick={() => {
                setAberto(false);
                if (opcao !== fase) onSelecionar(opcao);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-700 transition hover:bg-slate-50"
            >
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${CORES_FASE[opcao]}`} />
              <span className="flex-1">{ROTULO_FASE[opcao]}</span>
              {opcao === fase && <Check className="h-3.5 w-3.5 text-emerald-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
