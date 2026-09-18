"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

/**
 * O drop "Todos produtos" da barra de Orcamentos — dropdown com busca, escolha
 * unica (18/09/2026).
 *
 * POR QUE UM COMPONENTE, E NAO UM `<select>`
 *   Sao 89 produtos cadastrados e o operador procura por CODIGO ("102") ou por
 *   parte do nome ("colorband"). Um `<select>` nativo so casa pelo comeco do
 *   texto e nao aceita busca por pedaco — na pratica obrigaria a rolar a lista
 *   inteira. Os outros drops da barra continuam `<select>`: eles tem 4 ou 5
 *   opcoes e nao precisam disto.
 *
 * MINIMO DE PROPOSITO. Nao ha componente de combo com busca no projeto (o
 * `SelectorPainel` de Orcamentos e um painel de cartoes, de outra natureza), e
 * esta tarefa nao e o lugar de criar um compartilhado: o que existe aqui e o
 * necessario para este filtro — abre, filtra, escolhe, limpa, fecha no clique
 * fora e no Esc.
 *
 * INATIVOS ENTRAM NA LISTA: ha orcamento antigo com produto hoje inativo, e sem
 * eles esses pedidos ficariam inalcancaveis. O rotulo avisa qual e qual.
 */

export type OpcaoProduto = {
  /** `produtos.id_produto` — o codigo que aparece no rotulo. */
  id: number;
  nome: string;
  ativo: boolean;
};

type Props = {
  opcoes: OpcaoProduto[];
  /** `null` = "Todos produtos". */
  selecionado: number | null;
  onSelecionar: (id: number | null) => void;
  className: string;
  carregando?: boolean;
};

/** Sem acento e sem caixa: "colorband" acha "COLORBAND", "pulseira" acha "Pulseira". */
function chave(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function rotuloProduto(opcao: OpcaoProduto): string {
  return `${opcao.id} - ${opcao.nome}`;
}

export function FiltroProdutoDrop({ opcoes, selecionado, onSelecionar, className, carregando }: Props) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const caixa = useRef<HTMLDivElement | null>(null);

  const escolhido = useMemo(
    () => opcoes.find((o) => o.id === selecionado) ?? null,
    [opcoes, selecionado]
  );

  const filtradas = useMemo(() => {
    const termo = chave(busca);
    if (!termo) return opcoes;
    return opcoes.filter((o) => chave(rotuloProduto(o)).includes(termo));
  }, [opcoes, busca]);

  // Fecha no clique fora e no Esc — sem isso o painel fica aberto por cima da
  // lista enquanto o operador tenta ler o resultado do filtro.
  useEffect(() => {
    if (!aberto) return;
    function aoClicar(evento: MouseEvent) {
      if (caixa.current && !caixa.current.contains(evento.target as Node)) setAberto(false);
    }
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAberto(false);
    }
    document.addEventListener("mousedown", aoClicar);
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("mousedown", aoClicar);
      document.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  function escolher(id: number | null) {
    onSelecionar(id);
    setAberto(false);
    setBusca("");
  }

  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        title={escolhido ? rotuloProduto(escolhido) : "Todos produtos"}
        className={`${className} flex items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">
          {carregando && opcoes.length === 0
            ? "Carregando produtos..."
            : escolhido
              ? rotuloProduto(escolhido)
              : "Todos produtos"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>

      {aberto ? (
        <div className="absolute left-0 right-0 z-30 mt-1 min-w-[16rem] rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
          <label className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-[#0f9f9a]" />
            <input
              autoFocus
              value={busca}
              onChange={(evento) => setBusca(evento.target.value)}
              placeholder="Código ou nome"
              aria-label="Buscar produto"
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
            />
            {busca ? (
              <button
                type="button"
                onClick={() => setBusca("")}
                aria-label="Limpar busca"
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-200 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <div role="listbox" className="max-h-72 space-y-1 overflow-y-auto pr-1">
            <button
              type="button"
              role="option"
              aria-selected={selecionado === null}
              onClick={() => escolher(null)}
              className={`w-full rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-100 ${
                selecionado === null ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700"
              }`}
            >
              Todos produtos
            </button>

            {filtradas.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-500">Nenhum produto para “{busca.trim()}”.</p>
            ) : (
              filtradas.map((opcao) => (
                <button
                  key={opcao.id}
                  type="button"
                  role="option"
                  aria-selected={opcao.id === selecionado}
                  onClick={() => escolher(opcao.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-slate-100 ${
                    opcao.id === selecionado ? "bg-slate-100 font-semibold text-slate-900" : "text-slate-700"
                  }`}
                >
                  <span className="truncate">{rotuloProduto(opcao)}</span>
                  {!opcao.ativo ? (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-500">
                      inativo
                    </span>
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
