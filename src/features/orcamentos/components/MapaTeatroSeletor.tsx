"use client";

/**
 * Seletor do Mapa de Teatro — abre no botão "Mapa Teatro" da aba Pedido.
 *
 * Lista os mapas de `public.producao_mapas_teatro` e, para cada um, os setores
 * e os lugares contados pela MESMA função que o servidor usa
 * (`lib/mapa-teatro`). A tela só escolhe: quem grava o vínculo — e confere que
 * o setor é mesmo do mapa — é a rota de lotes.
 *
 * Mapa que não pode ser vinculado (cadeiras no formato antigo, setor sem id)
 * aparece na lista, apagado, com o motivo: esconder faria o usuário procurar
 * um mapa que existe. A busca do topo só filtra a lista pelo nome.
 *
 * O ícone de baixar de cada mapa traz o PDF do mapa COMPLETO, para o vendedor
 * enviar ao cliente. Ele não escolhe o mapa e funciona também no mapa apagado.
 * A consulta só acontece no clique, pela rota do Vibe que repassa o pedido ao
 * parceiro com a sessão de quem clicou (`lib/mapa-teatro-pdf`).
 */
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Search, X } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { fetchComSessao, SessaoExpiradaError } from "@/lib/supabase/sessao";
import {
  AVISO_PDF_INDISPONIVEL,
  AVISO_PDF_PENDENTE,
  avisoDoStatusDoPdf,
  filtrarMapasPorNome,
  nomeDoArquivoPdf,
  pdfRecebidoConfere,
} from "@/features/orcamentos/lib/mapa-teatro-pdf";
import {
  lerSetoresDoMapaTeatro,
  totalDeLugares,
  type SetorDoMapaTeatro,
} from "@/features/orcamentos/lib/mapa-teatro";

export type MapaTeatroEscolhido = {
  id: string;
  nome: string;
  setores: SetorDoMapaTeatro[];
};

type MapaDaLista = {
  id: string;
  nome: string;
  leitura: ReturnType<typeof lerSetoresDoMapaTeatro>;
};

export function MapaTeatroSeletor({
  nomeDoProduto,
  mapaAtualId,
  onEscolher,
  onClose,
}: {
  nomeDoProduto: string;
  /** O mapa que o produto já usa: os outros ficam indisponíveis (um mapa por produto). */
  mapaAtualId: string | null;
  onEscolher: (mapa: MapaTeatroEscolhido) => void;
  onClose: () => void;
}) {
  const [mapas, setMapas] = useState<MapaDaLista[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const campoDeBusca = useRef<HTMLInputElement>(null);
  /** Mapas com download em andamento e o aviso do último download de cada um. */
  const [baixando, setBaixando] = useState<Record<string, boolean>>({});
  const [avisosDoPdf, setAvisosDoPdf] = useState<Record<string, string>>({});

  useEffect(() => {
    campoDeBusca.current?.focus();
  }, []);

  const baixarPdf = async (mapa: MapaDaLista) => {
    if (baixando[mapa.id]) return;
    const avisar = (texto: string | null) =>
      setAvisosDoPdf((atual) => {
        const proximo = { ...atual };
        if (texto) proximo[mapa.id] = texto;
        else delete proximo[mapa.id];
        return proximo;
      });
    setBaixando((atual) => ({ ...atual, [mapa.id]: true }));
    avisar(null);
    try {
      // 401: o fetchComSessao renova a sessão e tenta mais uma vez.
      const resposta = await fetchComSessao(
        `/api/pedidos/mapa-teatro/${encodeURIComponent(mapa.id)}/pdf`,
        {
          cache: "no-store",
        },
      );
      if (!resposta.ok) {
        avisar(avisoDoStatusDoPdf(resposta.status));
        return;
      }
      const tipoDoConteudo = resposta.headers.get("content-type");
      if ((tipoDoConteudo || "").includes("application/json")) {
        const corpo = (await resposta.json().catch(() => null)) as {
          estado?: string;
        } | null;
        avisar(
          corpo?.estado === "pendente"
            ? AVISO_PDF_PENDENTE
            : AVISO_PDF_INDISPONIVEL,
        );
        return;
      }
      const arquivo = await resposta.blob();
      const confere = pdfRecebidoConfere({
        tipoDoConteudo,
        tamanho: arquivo.size,
        tamanhoEsperado: resposta.headers.get("x-mapa-tamanho"),
      });
      if (!confere) {
        avisar("O PDF do mapa chegou incompleto. Tente de novo.");
        return;
      }
      const endereco = URL.createObjectURL(
        new Blob([arquivo], { type: "application/pdf" }),
      );
      const link = document.createElement("a");
      link.href = endereco;
      link.download = nomeDoArquivoPdf(mapa.nome);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(endereco), 60_000);
    } catch (falha) {
      avisar(
        falha instanceof SessaoExpiradaError
          ? "Sua sessão expirou. Entre novamente para baixar o PDF."
          : AVISO_PDF_INDISPONIVEL,
      );
    } finally {
      setBaixando((atual) => {
        const proximo = { ...atual };
        delete proximo[mapa.id];
        return proximo;
      });
    }
  };

  useEffect(() => {
    let ativo = true;
    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        if (ativo) setErro("Sessão não disponível. Recarregue a página.");
        return;
      }
      const { data, error } = await supabase
        .from("producao_mapas_teatro")
        .select("id, name, config")
        .order("name", { ascending: true });
      if (!ativo) return;
      if (error) {
        setErro("Não foi possível ler os Mapas de Teatro. Tente de novo.");
        return;
      }
      setMapas(
        (data || []).map((m) => ({
          id: String(m.id),
          nome: String(m.name || "Mapa sem nome"),
          leitura: lerSetoresDoMapaTeatro(m.config),
        })),
      );
    })();
    return () => {
      ativo = false;
    };
  }, []);

  useEffect(() => {
    const fecharComEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fecharComEsc);
    return () => window.removeEventListener("keydown", fecharComEsc);
  }, [onClose]);

  const mapasFiltrados = filtrarMapasPorNome(mapas || [], busca);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mapa-teatro-titulo"
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2
              id="mapa-teatro-titulo"
              className="text-xl font-semibold text-slate-950"
            >
              Mapa Teatro
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Escolha o mapa de{" "}
              <span className="font-semibold text-slate-700">
                {nomeDoProduto}
              </span>
              . Cada setor com cadeiras vira um modelo, com o nome do setor e a
              quantidade de lugares.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={campoDeBusca}
            id="mapa-teatro-busca"
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar mapa pelo nome"
            aria-label="Buscar mapa pelo nome"
            autoComplete="off"
            className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100"
          />
        </div>

        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">
          {erro && (
            <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              {erro}
            </p>
          )}
          {!erro && mapas === null && (
            <p className="p-4 text-sm text-slate-500">Carregando os mapas...</p>
          )}
          {!erro && mapas !== null && mapas.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              Nenhum Mapa de Teatro cadastrado.
            </p>
          )}
          {!erro &&
            mapas !== null &&
            mapas.length > 0 &&
            mapasFiltrados.length === 0 && (
              <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                Nenhum mapa encontrado
              </p>
            )}
          {mapasFiltrados.map((mapa) => {
            const deOutroMapa =
              mapaAtualId !== null &&
              mapaAtualId.toLowerCase() !== mapa.id.toLowerCase();
            const motivo = !mapa.leitura.ok
              ? mapa.leitura.motivo
              : deOutroMapa
                ? "Este produto já usa outro mapa. Para este, use outro produto."
                : null;
            const setores = mapa.leitura.ok ? mapa.leitura.setores : [];
            const carregandoPdf = baixando[mapa.id] === true;
            const avisoDoPdf = avisosDoPdf[mapa.id];
            return (
              <div key={mapa.id} className="relative" data-mapa-id={mapa.id}>
                <button
                  type="button"
                  disabled={motivo !== null}
                  onClick={() =>
                    onEscolher({ id: mapa.id, nome: mapa.nome, setores })
                  }
                  className="block w-full rounded-2xl border border-slate-200 bg-white p-4 pr-14 text-left transition hover:border-teal-300 hover:bg-teal-50/40 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:bg-white"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-bold text-slate-900">
                      {mapa.nome}
                    </span>
                    {mapa.leitura.ok && (
                      <span className="text-xs font-semibold text-slate-500">
                        {setores.length}{" "}
                        {setores.length === 1 ? "setor" : "setores"} ·{" "}
                        {totalDeLugares(setores).toLocaleString("pt-BR")}{" "}
                        lugares
                      </span>
                    )}
                  </div>
                  {mapa.leitura.ok && (
                    <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                      {setores.map((setor) => (
                        <li
                          key={setor.id}
                          className="flex justify-between gap-3"
                        >
                          <span>{setor.nome || setor.id}</span>
                          <span
                            className={
                              setor.lugares > 0
                                ? "font-semibold"
                                : "font-semibold text-amber-600"
                            }
                          >
                            {setor.lugares > 0
                              ? `${setor.lugares.toLocaleString("pt-BR")} lugares`
                              : "sem cadeiras"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {motivo && (
                    <p className="mt-2 text-xs font-semibold text-amber-700">
                      {motivo}
                    </p>
                  )}
                </button>
                {/* Fora do botão do mapa: baixar não escolhe, e vale no mapa apagado. */}
                <button
                  type="button"
                  onClick={() => void baixarPdf(mapa)}
                  disabled={carregandoPdf}
                  aria-label="Baixar PDF do mapa"
                  title="Baixar PDF do mapa"
                  aria-busy={carregandoPdf}
                  className="absolute right-3 top-3 rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-teal-300 hover:text-teal-700 disabled:cursor-wait"
                >
                  {carregandoPdf ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </button>
                {avisoDoPdf && (
                  <p
                    role="status"
                    className="mt-1 px-4 text-xs font-semibold text-amber-700"
                  >
                    {avisoDoPdf}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
