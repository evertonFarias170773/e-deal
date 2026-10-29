"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, Download, FileArchive, FileText, Loader2, Printer } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SummaryCard } from "@/components/common/SummaryCard";
import { EmptyState } from "@/components/common/EmptyState";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { codecs, type UrlFiltersSchema } from "@/lib/url-state";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDataCivil } from "@/lib/formatters/date";
import { tokenDaSessao } from "@/lib/supabase/bearer";
import { baixarBlob, imprimirPdf } from "./lib/arquivo";
import { baixarCsv, montarCsv } from "./lib/csv";
import { resolverPeriodo, ROTULO_PRESET } from "./lib/periodo";
import { AREAS, buscarRelatorio } from "./registro";
import type {
  ColunaDef,
  FiltroDef,
  LinhaRelatorio,
  Opcao,
  PaginaDoRelatorio,
  PresetPeriodo,
  RelatorioDef,
  ResultadoRelatorio,
  Subtotal
} from "./types";

/**
 * Página base de relatório (24/10/2026). Não conhece relatório nenhum: recebe o
 * `slug`, busca a definição em `registro.ts` e monta cabeçalho, filtros na URL,
 * cards, tabela ordenável com linha de total e CSV a partir dela.
 *
 * Os números vêm prontos do banco (rota `/api/relatorios/[slug]`); aqui só se
 * ordena e se exibe. A linha de total também vem do banco.
 */

const PRESETS_VALORES = ["hoje", "mes", "mes_completo", "proximo_mes", "mes_anterior", "custom"] as const;

type Ordenacao = { coluna: string; direcao: "asc" | "desc" };

const estiloCampo = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  color: "var(--foreground)"
} as const;

function alinhamentoDe(coluna: ColunaDef) {
  if (coluna.alinhamento) return coluna.alinhamento;
  return coluna.tipo === "moeda" || coluna.tipo === "inteiro" || coluna.tipo === "percentual" ? "right" : "left";
}

function textoDaCelula(coluna: ColunaDef, valor: string | number | null | undefined) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (coluna.tipo === "moeda") return formatCurrency(Number(valor));
  if (coluna.tipo === "percentual") {
    return `${Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }
  if (coluna.tipo === "data") return formatDataCivil(String(valor));
  return String(valor);
}

function comparar(a: string | number | null, b: string | number | null, direcao: "asc" | "desc") {
  // Vazios sempre no fim, qualquer que seja a direção.
  const aVazio = a === null || a === "";
  const bVazio = b === null || b === "";
  if (aVazio || bVazio) return aVazio === bVazio ? 0 : aVazio ? 1 : -1;
  const base =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), "pt-BR", { numeric: true });
  return direcao === "asc" ? base : -base;
}

function nomeDoArquivo(slug: string, inicio: string, fim: string) {
  return `${slug}_${inicio}_a_${fim}.csv`;
}

export function ReportPage({ slug }: { slug: string }) {
  const relatorio = buscarRelatorio(slug);
  if (!relatorio) {
    return <EmptyState title="Relatório não encontrado" description="Este relatório não existe." />;
  }
  return <ReportPageCorpo relatorio={relatorio} />;
}

function ReportPageCorpo({ relatorio }: { relatorio: RelatorioDef }) {
  const schema = useMemo(() => {
    const s: UrlFiltersSchema = {
      p: { codec: codecs.enumOf(PRESETS_VALORES), default: relatorio.periodo.padrao },
      ini: { codec: codecs.dataIso(), default: "" },
      fim: { codec: codecs.dataIso(), default: "" }
    };
    for (const filtro of relatorio.filtros) {
      s[filtro.chave] = { codec: codecs.texto(), default: "" };
    }
    return s;
  }, [relatorio]);

  const { filters, setFilters, clearFilters, hasActiveFilters } = useUrlFilters(schema);

  const preset = (relatorio.periodo.presets.includes(filters.p as PresetPeriodo)
    ? filters.p
    : relatorio.periodo.padrao) as PresetPeriodo;
  const periodo = useMemo(
    () => resolverPeriodo(preset, String(filters.ini), String(filters.fim)),
    [preset, filters.ini, filters.fim]
  );

  // Opções vindas do banco (vendedores etc.), carregadas uma vez.
  const [opcoesCarregadas, setOpcoesCarregadas] = useState<Record<string, Opcao[]>>({});
  useEffect(() => {
    let ativo = true;
    for (const filtro of relatorio.filtros) {
      if (!filtro.carregarOpcoes) continue;
      filtro
        .carregarOpcoes()
        .then((opcoes) => ativo && setOpcoesCarregadas((atual) => ({ ...atual, [filtro.chave]: opcoes })))
        .catch(() => undefined);
    }
    return () => {
      ativo = false;
    };
  }, [relatorio]);

  // Dados: um pedido por combinação de período + filtros.
  const valoresDosFiltros = relatorio.filtros.map((f) => String(filters[f.chave] ?? ""));
  const chaveDosFiltros = [relatorio.slug, periodo.inicio, periodo.fim, ...valoresDosFiltros].join("|");

  // Lista longa (`paginacao`): a página faz parte do pedido e volta à 1 quando período ou filtro mudam.
  const paginado = Boolean(relatorio.paginacao);
  const [paginaPedida, setPaginaPedida] = useState({ chave: "", pagina: 1 });
  const pagina = paginado && paginaPedida.chave === chaveDosFiltros ? paginaPedida.pagina : 1;
  const irParaPagina = (n: number) => setPaginaPedida({ chave: chaveDosFiltros, pagina: n });
  const chaveDaConsulta = paginado ? `${chaveDosFiltros}|p${pagina}` : chaveDosFiltros;
  const [estado, setEstado] = useState<{
    chave: string;
    resultado: ResultadoRelatorio | null;
    erro: string | null;
  }>({ chave: "", resultado: null, erro: null });

  useEffect(() => {
    const controle = new AbortController();
    (async () => {
      const token = await tokenDaSessao();
      const params = new URLSearchParams({ ini: periodo.inicio, fim: periodo.fim });
      relatorio.filtros.forEach((f, i) => {
        if (valoresDosFiltros[i]) params.set(f.chave, valoresDosFiltros[i]);
      });
      if (paginado) params.set("pagina", String(pagina));
      try {
        const resposta = await fetch(`/api/relatorios/${relatorio.slug}?${params.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controle.signal,
          cache: "no-store"
        });
        const corpo = (await resposta.json().catch(() => null)) as
          | (ResultadoRelatorio & { success?: boolean; error?: string })
          | null;
        if (!resposta.ok || !corpo || corpo.success === false) {
          setEstado({
            chave: chaveDaConsulta,
            resultado: null,
            erro: corpo?.error ?? "Não foi possível gerar o relatório."
          });
          return;
        }
        setEstado({ chave: chaveDaConsulta, resultado: corpo, erro: null });
      } catch (erro) {
        if ((erro as { name?: string })?.name === "AbortError") return;
        setEstado({ chave: chaveDaConsulta, resultado: null, erro: "Não foi possível gerar o relatório." });
      }
    })();
    return () => controle.abort();
    // valoresDosFiltros está coberto por chaveDaConsulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDaConsulta]);

  const carregando = estado.chave !== chaveDaConsulta;
  const resultado = estado.chave === chaveDaConsulta ? estado.resultado : null;
  const erro = estado.chave === chaveDaConsulta ? estado.erro : null;

  // Ordenação: só reordena as linhas que o banco devolveu. Lista paginada segue a ordem do
  // servidor (reordenar só a página daria uma ordem falsa).
  const [ordem, setOrdem] = useState<Ordenacao>(relatorio.ordenacaoPadrao);
  const linhasOrdenadas = useMemo(() => {
    const linhas = resultado?.linhas ?? [];
    if (paginado) return linhas;
    return [...linhas].sort((a, b) => comparar(a[ordem.coluna] ?? null, b[ordem.coluna] ?? null, ordem.direcao));
  }, [resultado, ordem, paginado]);

  const alternarOrdem = useCallback((coluna: string) => {
    setOrdem((atual) =>
      atual.coluna === coluna
        ? { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" }
        : { coluna, direcao: "asc" }
    );
  }, []);

  // PDF (só para relatório que declara `pdf`): gerado no servidor com os mesmos filtros da tela.
  const [pdfOcupado, setPdfOcupado] = useState<"baixar" | "imprimir" | "zip" | null>(null);
  const [pdfErro, setPdfErro] = useState<string | null>(null);
  const pdfDaTela = async (acao: "baixar" | "imprimir" | "zip") => {
    if ((acao === "zip" ? !relatorio.zip : !relatorio.pdf) || pdfOcupado) return;
    setPdfOcupado(acao);
    setPdfErro(null);
    try {
      const token = await tokenDaSessao();
      const params = new URLSearchParams({ ini: periodo.inicio, fim: periodo.fim });
      relatorio.filtros.forEach((f, i) => {
        if (valoresDosFiltros[i]) params.set(f.chave, valoresDosFiltros[i]);
      });
      if (acao === "baixar") params.set("baixar", "1");
      const destino = acao === "zip" ? "xml" : "pdf";
      const resposta = await fetch(`/api/relatorios/${relatorio.slug}/${destino}?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store"
      });
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => null)) as { error?: string } | null;
        setPdfErro(corpo?.error ?? (acao === "zip" ? "Não foi possível gerar o zip." : "Não foi possível gerar o PDF."));
        return;
      }
      const arquivo = await resposta.blob();
      const consultaAtual = {
        inicio: periodo.inicio,
        fim: periodo.fim,
        filtros: Object.fromEntries(relatorio.filtros.map((f, i) => [f.chave, valoresDosFiltros[i]]))
      };
      if (acao === "zip" && relatorio.zip) {
        baixarBlob(relatorio.zip.nomeArquivo(consultaAtual), arquivo);
      } else if (acao === "baixar" && relatorio.pdf) {
        baixarBlob(
          relatorio.pdf.nomeArquivo({
            inicio: periodo.inicio,
            fim: periodo.fim,
            filtros: Object.fromEntries(relatorio.filtros.map((f, i) => [f.chave, valoresDosFiltros[i]]))
          }),
          arquivo
        );
      } else if (acao === "imprimir") {
        imprimirPdf(arquivo);
      }
    } catch {
      setPdfErro(acao === "zip" ? "Não foi possível gerar o zip." : "Não foi possível gerar o PDF.");
    } finally {
      setPdfOcupado(null);
    }
  };

  const [csvOcupado, setCsvOcupado] = useState(false);
  const exportar = async () => {
    if (!resultado) return;
    if (!paginado) {
      baixarCsv(
        nomeDoArquivo(relatorio.slug, periodo.inicio, periodo.fim),
        montarCsv(relatorio.colunas, linhasOrdenadas, resultado.total)
      );
      return;
    }
    // Lista paginada: o CSV leva o período inteiro, pedido à mesma rota (mesma permissão).
    if (csvOcupado) return;
    setCsvOcupado(true);
    setPdfErro(null);
    try {
      const token = await tokenDaSessao();
      const params = new URLSearchParams({ ini: periodo.inicio, fim: periodo.fim, pagina: "todas" });
      relatorio.filtros.forEach((f, i) => {
        if (valoresDosFiltros[i]) params.set(f.chave, valoresDosFiltros[i]);
      });
      const resposta = await fetch(`/api/relatorios/${relatorio.slug}?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store"
      });
      const corpo = (await resposta.json().catch(() => null)) as
        | (ResultadoRelatorio & { success?: boolean; error?: string })
        | null;
      if (!resposta.ok || !corpo || corpo.success === false) {
        setPdfErro(corpo?.error ?? "Não foi possível gerar o CSV.");
        return;
      }
      baixarCsv(
        nomeDoArquivo(relatorio.slug, periodo.inicio, periodo.fim),
        montarCsv(relatorio.colunas, corpo.linhas, corpo.total)
      );
    } catch {
      setPdfErro("Não foi possível gerar o CSV.");
    } finally {
      setCsvOcupado(false);
    }
  };

  const area = AREAS.find((a) => a.id === relatorio.area);

  return (
    <div className="space-y-6">
      <PageHeader
        context={area ? `Relatórios · ${area.rotulo}` : "Relatórios"}
        title={relatorio.titulo}
        subtitle={relatorio.descricao}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {relatorio.pdf ? (
              <>
                <button
                  type="button"
                  onClick={() => pdfDaTela("baixar")}
                  disabled={!resultado || resultado.linhas.length === 0 || pdfOcupado !== null}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)" }}
                >
                  {pdfOcupado === "baixar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Baixar PDF
                </button>
                <button
                  type="button"
                  onClick={() => pdfDaTela("imprimir")}
                  disabled={!resultado || resultado.linhas.length === 0 || pdfOcupado !== null}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)" }}
                >
                  {pdfOcupado === "imprimir" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                  Imprimir
                </button>
              </>
            ) : null}
            {relatorio.zip ? (
              <button
                type="button"
                onClick={() => pdfDaTela("zip")}
                disabled={!resultado || resultado.linhas.length === 0 || pdfOcupado !== null}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)" }}
              >
                {pdfOcupado === "zip" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileArchive className="h-4 w-4" />}
                {relatorio.zip.rotulo}
              </button>
            ) : null}
            <button
              type="button"
              onClick={exportar}
              disabled={!resultado || resultado.linhas.length === 0 || csvOcupado}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "var(--card)", color: "var(--foreground)", border: "1px solid var(--border)" }}
            >
              {csvOcupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Exportar CSV
            </button>
          </div>
        }
      />

      <section
        className="flex items-start gap-3 rounded-2xl p-4 text-sm"
        style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--muted)" }}
      >
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong style={{ color: "var(--foreground)" }}>Data usada: {relatorio.dataReferencia.rotulo}.</strong>{" "}
          {relatorio.dataReferencia.criterio}{" "}
          {relatorio.notaDosFiltros ? (
            <strong style={{ color: "var(--foreground)" }}>
              {relatorio.notaDosFiltros(
                Object.fromEntries(relatorio.filtros.map((f) => [f.chave, String(filters[f.chave] ?? "")]))
              )}{" "}
            </strong>
          ) : null}
          <span style={{ color: "var(--foreground)" }}>
            Período: {formatDataCivil(periodo.inicio)} a {formatDataCivil(periodo.fim)}.
          </span>
        </p>
      </section>

      <section
        className="space-y-4 rounded-2xl p-4"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          {relatorio.periodo.presets.map((p) => {
            const selecionado = p === preset;
            return (
              <button
                key={p}
                type="button"
                aria-pressed={selecionado}
                onClick={() => setFilters({ p, ini: "", fim: "" })}
                className="rounded-full px-4 py-1.5 text-sm font-semibold transition"
                style={
                  selecionado
                    ? { background: "var(--primary)", color: "var(--primary-foreground)", border: "1px solid var(--primary)" }
                    : estiloCampo
                }
              >
                {ROTULO_PRESET[p]}
              </button>
            );
          })}
          {preset === "custom" ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="Data inicial"
                value={periodo.inicio}
                max={periodo.fim}
                onChange={(e) => e.target.value && setFilters({ ini: e.target.value, fim: periodo.fim })}
                className="rounded-xl px-3 py-1.5 text-sm"
                style={estiloCampo}
              />
              <span style={{ color: "var(--muted)" }}>até</span>
              <input
                type="date"
                aria-label="Data final"
                value={periodo.fim}
                min={periodo.inicio}
                onChange={(e) => e.target.value && setFilters({ ini: periodo.inicio, fim: e.target.value })}
                className="rounded-xl px-3 py-1.5 text-sm"
                style={estiloCampo}
              />
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {relatorio.filtros.map((filtro) => (
            <CampoSelecao
              key={filtro.chave}
              filtro={filtro}
              // Opções do resultado ficam as da última resposta enquanto a próxima carrega.
              opcoes={
                filtro.opcoes ??
                estado.resultado?.opcoesDosFiltros?.[filtro.chave] ??
                opcoesCarregadas[filtro.chave] ??
                []
              }
              valor={String(filters[filtro.chave] ?? "")}
              onChange={(valor) => setFilters({ [filtro.chave]: valor })}
            />
          ))}
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="self-end rounded-xl px-4 py-2 text-sm font-semibold"
              style={{ color: "var(--muted)" }}
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      </section>

      {pdfErro ? (
        <div
          role="alert"
          className="rounded-2xl p-4 text-sm"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          {pdfErro}
        </div>
      ) : null}

      {erro ? (
        <div
          role="alert"
          className="rounded-2xl p-4 text-sm"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          {erro}
        </div>
      ) : null}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {(resultado?.cards ?? []).map((card) => (
          <SummaryCard
            key={card.titulo}
            title={card.titulo}
            value={card.valor}
            description={card.descricao}
            tone={card.tom ?? "neutral"}
          />
        ))}
      </section>

      {resultado?.avisos && resultado.avisos.length > 0 ? (
        <section
          className="flex items-start gap-3 rounded-2xl p-4 text-sm"
          style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--muted)" }} />
          <div className="space-y-1">
            {resultado.avisos.map((aviso) => (
              <p key={aviso}>{aviso}</p>
            ))}
          </div>
        </section>
      ) : null}

      {resultado?.subtotais && resultado.subtotais.length > 0 ? (
        <Subtotais subtotais={resultado.subtotais} />
      ) : null}

      <section
        className="overflow-hidden rounded-2xl"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        {carregando ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm" style={{ color: "var(--muted)" }}>
            <Loader2 className="h-4 w-4 animate-spin" />
            Gerando relatório…
          </div>
        ) : resultado && resultado.linhas.length === 0 ? (
          <EmptyState title="Nada neste período" description="Nenhum registro encontrado com estes filtros." />
        ) : resultado ? (
          <>
            <TabelaRelatorio
              colunas={relatorio.colunas}
              linhas={linhasOrdenadas}
              total={resultado.total}
              ordem={ordem}
              onOrdenar={paginado ? undefined : alternarOrdem}
            />
            {resultado.paginacao ? <Paginador paginacao={resultado.paginacao} onIr={irParaPagina} /> : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

const TITULO_GRUPO: Record<Subtotal["grupo"], string> = {
  forma: "Subtotal por forma de pagamento",
  empresa: "Subtotal por empresa",
  total: "Totais"
};

/** Subtotais e totais que o banco calculou (ex.: por forma de pagamento), abaixo dos cards. */
function Subtotais({ subtotais }: { subtotais: Subtotal[] }) {
  const grupos = (["forma", "empresa", "total"] as const).filter((g) => subtotais.some((s) => s.grupo === g));
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {grupos.map((grupo) => (
        <div
          key={grupo}
          className="overflow-hidden rounded-2xl"
          style={{ background: "var(--card)", border: "1px solid var(--border)" }}
        >
          <h2 className="px-4 pt-3 text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            {TITULO_GRUPO[grupo]}
          </h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {subtotais
                .filter((s) => s.grupo === grupo)
                .map((s) => (
                  <tr key={s.chave} style={{ borderTop: "1px solid var(--border)", color: "var(--foreground)" }}>
                    <td className="px-4 py-2">
                      <span className={s.chave === "TOTAL" ? "font-bold" : undefined}>{s.rotulo}</span>
                      {s.nota ? (
                        <span className="block text-xs" style={{ color: "var(--muted)" }}>
                          {s.nota}
                        </span>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right" style={{ color: "var(--muted)" }}>
                      {s.quantidade}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-2 text-right${s.chave === "TOTAL" ? " font-bold" : ""}`}>
                      {formatCurrency(s.valor)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function CampoSelecao({
  filtro,
  opcoes,
  valor,
  onChange
}: {
  filtro: FiltroDef;
  opcoes: Opcao[];
  valor: string;
  onChange: (valor: string) => void;
}) {
  // Valor vindo de um link que não está na lista continua visível, em vez de sumir.
  const fora = valor !== "" && !opcoes.some((o) => o.valor === valor);
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
      {filtro.rotulo}
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-xl px-3 py-2 text-sm font-normal"
        style={estiloCampo}
      >
        <option value="">{filtro.todasRotulo}</option>
        {fora ? <option value={valor}>{valor}</option> : null}
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Rodapé da lista paginada: onde está e Anterior / Próxima. */
function Paginador({ paginacao, onIr }: { paginacao: PaginaDoRelatorio; onIr: (pagina: number) => void }) {
  const { pagina, tamanho, totalLinhas, totalPaginas } = paginacao;
  const de = totalLinhas === 0 ? 0 : (pagina - 1) * tamanho + 1;
  const ate = Math.min(pagina * tamanho, totalLinhas);
  const botao =
    "rounded-xl px-3 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 text-sm"
      style={{ borderTop: "1px solid var(--border)", color: "var(--muted)" }}
    >
      <span>
        {de.toLocaleString("pt-BR")}–{ate.toLocaleString("pt-BR")} de {totalLinhas.toLocaleString("pt-BR")} · Página{" "}
        {pagina} de {totalPaginas}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" className={botao} style={estiloCampo} disabled={pagina <= 1} onClick={() => onIr(pagina - 1)}>
          Anterior
        </button>
        <button
          type="button"
          className={botao}
          style={estiloCampo}
          disabled={pagina >= totalPaginas}
          onClick={() => onIr(pagina + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}

function TabelaRelatorio({
  colunas,
  linhas,
  total,
  ordem,
  onOrdenar
}: {
  colunas: ColunaDef[];
  linhas: LinhaRelatorio[];
  total: Record<string, string | number | null>;
  ordem: Ordenacao;
  /** Sem ele (lista paginada), os títulos não ordenam. */
  onOrdenar?: (coluna: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
            {colunas.map((coluna) => {
              const alinhamento = alinhamentoDe(coluna);
              if (!onOrdenar) {
                return (
                  <th key={coluna.id} scope="col" className="whitespace-nowrap px-3 py-3 font-semibold" style={{ textAlign: alinhamento }}>
                    {coluna.titulo}
                  </th>
                );
              }
              const ativa = ordem.coluna === coluna.id;
              const Seta = !ativa ? ArrowUpDown : ordem.direcao === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={coluna.id}
                  scope="col"
                  aria-sort={ativa ? (ordem.direcao === "asc" ? "ascending" : "descending") : "none"}
                  className="whitespace-nowrap px-3 py-3 font-semibold"
                  style={{ textAlign: alinhamento }}
                >
                  <button
                    type="button"
                    onClick={() => onOrdenar(coluna.id)}
                    className="inline-flex items-center gap-1"
                    style={{ color: ativa ? "var(--foreground)" : "inherit" }}
                  >
                    {coluna.titulo}
                    <Seta className="h-3.5 w-3.5" />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, indice) => (
            <tr key={indice} style={{ borderBottom: "1px solid var(--border)", color: "var(--foreground)" }}>
              {colunas.map((coluna) => (
                <td
                  key={coluna.id}
                  className={coluna.tipo === "texto" ? "min-w-[8rem] px-3 py-2" : "whitespace-nowrap px-3 py-2"}
                  style={{ textAlign: alinhamentoDe(coluna) }}
                >
                  {textoDaCelula(coluna, linha[coluna.id])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: "2px solid var(--border)", color: "var(--foreground)" }}>
            {colunas.map((coluna, i) => {
              const valor = total[coluna.id];
              return (
                <td
                  key={coluna.id}
                  className="whitespace-nowrap px-3 py-3 font-bold"
                  style={{ textAlign: alinhamentoDe(coluna) }}
                >
                  {valor === undefined || valor === null ? (i === 0 ? "Total" : "") : textoDaCelula(coluna, valor)}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
