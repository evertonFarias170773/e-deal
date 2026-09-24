"use client";

/**
 * O que o modo cards e a lista rápida da aba Pedido têm em comum (23/09/2026).
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *   A lista rápida passou a editar cada lote com os MESMOS campos, dropdowns,
 *   ordem e regras de exibição do card de modelo, e a mostrar embaixo a mesma
 *   janela de amostra da arte. Duplicar o JSX do card seria a segunda cópia de
 *   uma regra que já tem três consumidores (card, grade e PCP) — e a próxima
 *   coluna do checklist teria de ser lembrada em dois lugares.
 *
 *   Tudo aqui SAIU de PedidoModelosTab.tsx sem mudar uma classe ou um `if`:
 *   `ModeloCampos` é o bloco de campos do `ModeloInlineCard`, `AmostraDoModelo`
 *   é o bloco da arte do card fechado, e `PreviaCorPapel` veio junto porque os
 *   campos a exibem em produto de prateleira. O card continua se comportando
 *   como antes; o que ele guarda para si é o auto-save (`criarModelo` /
 *   `atualizarModeloParcial`), que NÃO é o caminho da lista rápida.
 *
 * O QUE MUDA POR PROP, E SÓ NA LISTA RÁPIDA
 *   - `maxQtd` ausente: sem corte de saldo no campo Qtd — na lista a quantidade
 *     do item é a soma dos lotes, não uma trava;
 *   - `onPaste` / `onEnterQtd`: colar a lista do cliente e Enter criar a
 *     próxima linha, que a grade já fazia;
 *   - `numeracaoInicioTravada`: com "cada do 1" ou "sequencial" marcados, o
 *     Nº Inicial é derivado e não se edita.
 *   O card não passa nenhuma delas.
 *
 * PRATELEIRA NA LISTA RÁPIDA (`modo="lista"` + `itemPrateleira`, 24/09/2026)
 *   Produto de prateleira não entra em arte: sem janela de arte e sem status
 *   de arte. Na lista rápida o lote dele mostra só Qtd e Cor papel — na
 *   prática o que a grade antiga fazia (o Modelo vinha preenchido com o nome
 *   do produto e não havia janela de amostra). O card fica como era: em
 *   proposta mista o item de prateleira mostra todos os campos, com a prévia
 *   do papel no lugar da arte, e a janela de amostra sem o status.
 *   `simplificado` segue sendo a regra da PROPOSTA (100% prateleira); esta é
 *   a do ITEM, e vale só na lista.
 *
 * UMA LINHA POR MODELO NA LISTA (24/09/2026)
 *   Na lista os campos não têm rótulo: o cabeçalho é um só por produto
 *   (`CabecalhoDaLista`) e as células saem de `colunasDaLista`, a mesma
 *   função que decide o que aparece — checklist, `simplificado`, prateleira —
 *   e a largura de cada coluna (`gridDaLista`). O número do modelo vai
 *   dentro do campo Modelo (`identificador`). Os campos de camarote, que só
 *   existem quando o numerador é CAMAROTE, ficam numa sublinha com rótulo.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/common/StatusBadge";
import type { StatusTone } from "@/lib/types";
import type { PedidoModeloState } from "@/features/orcamentos/types";
import { mostraCampo, type ChecklistVisivel } from "@/features/orcamentos/lib/checklist-lote";
import { buscarArquivoCorPapel } from "@/features/orcamentos/services/pedidos-modelos.service";
import {
  TIPO_CAMAROTE,
  TIPO_TICKET,
  normalizarTipoNumeracao,
  findNumeracaoByName,
  resolverMultiplicadorNumeracao,
  calcularQtdCamarote,
  parseNumeroOpcional,
  type NumeracaoOpcao,
} from "@/features/orcamentos/numeracao-modelo-utils";

/** Cor do papel como vem de `producao_cores`, no que os dropdowns usam. */
export type CorDoPapelOpcao = {
  id?: string | number | null;
  name: string;
  formato_id?: string | number | null;
};

// ─── Styles ──────────────────────────────────────────────────────────────────

export const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition";
export const labelClass = "text-[11px] font-bold uppercase tracking-wider text-slate-500 block mb-1";

// ─── Arte do modelo ──────────────────────────────────────────────────────────

/**
 * Estados em que a arte conta como aprovada. Mesma lista usada pela engine de
 * status (status-engine.service.ts) — aqui só muda a apresentação do card,
 * a regra de aprovação continua sendo dela.
 */
const STATUS_ARTE_APROVADA = [
  "APROVADA",
  "APROVADO",
  "APROVADA_CLIENTE",
  "LIBERADA",
  "IMPRESSA",
  "NAO_NECESSARIA",
];

export function isArteAprovada(status?: string): boolean {
  return !!status && STATUS_ARTE_APROVADA.includes(status.toUpperCase());
}

export function getArteStatusTone(status?: string): StatusTone {
  const normalizado = (status || "PENDENTE").toUpperCase();
  if (isArteAprovada(normalizado)) return "success";
  if (normalizado === "REPROVADA_CLIENTE") return "danger";
  if (normalizado === "AGUARDANDO_CLIENTE" || normalizado === "AGUARDANDO") return "warning";
  if (normalizado === "EM_CRIACAO" || normalizado === "EM_REVISAO_INTERNA") return "info";
  return "neutral";
}

/**
 * Resolve o src exibível de pedidos_modelos.amostra_arte_base64.
 *
 * A coluna não guarda só base64: o gerador da OS
 * (api/pedidos/imprimir-os) já a trata como candidata a URL, fazendo fetch
 * quando não é data URI. Por isso os quatro casos abaixo. Retorna null quando
 * o conteúdo não é renderizável em <img> (PDF/vetor), para não exibir imagem
 * quebrada.
 */
export function toImageSrc(valor: string): string | null {
  const bruto = valor.trim();
  if (!bruto) return null;

  // 1. Já é data URI — não duplicar o prefixo.
  if (bruto.startsWith("data:")) {
    return bruto.startsWith("data:image/") ? bruto : null;
  }

  // 2. URL absoluta ou protocolo-relativa.
  if (/^(https?:)?\/\//i.test(bruto)) {
    return /\.(pdf|ai|eps|cdr)(\?|$)/i.test(bruto) ? null : bruto;
  }

  // 3. Base64 puro: mime pela assinatura do conteúdo. Vem ANTES do caminho
  //    relativo porque base64 de JPEG começa com "/9j/".
  const base64 = bruto.replace(/\s/g, "");
  if (!base64) return null;

  if (base64.startsWith("JVBER")) return null; // %PDF — não renderiza em <img>
  if (base64.startsWith("/9j/")) return `data:image/jpeg;base64,${base64}`;
  if (base64.startsWith("iVBORw0KGgo")) return `data:image/png;base64,${base64}`;
  if (base64.startsWith("R0lGOD")) return `data:image/gif;base64,${base64}`;
  if (base64.startsWith("UklGR")) return `data:image/webp;base64,${base64}`;
  if (base64.startsWith("PHN2Zy") || base64.startsWith("PD94bW")) {
    return `data:image/svg+xml;base64,${base64}`;
  }

  // 4. Caminho do próprio site.
  if (bruto.startsWith("/")) {
    return /\.(pdf|ai|eps|cdr)(\?|$)/i.test(bruto) ? null : bruto;
  }

  // 5. Base64 sem assinatura reconhecida: assume PNG.
  return `data:image/png;base64,${base64}`;
}

// ─── Prévia da cor do papel (produto de prateleira) ──────────────────────────

/**
 * Classifica o conteúdo de producao_cores.pdf_base64.
 *
 * Apesar do nome, a coluna guarda hoje PDF (`data:application/pdf;base64,...`
 * em todas as linhas preenchidas), mas aceita qualquer conteúdo — por isso a
 * detecção é pelo que está lá, não pelo nome da coluna. Base64 puro (sem
 * prefixo Data URI) é identificado pela assinatura, igual ao toImageSrc.
 */
function classificarArquivoCor(valor: string): { tipo: "imagem" | "pdf"; mime: string; base64: string } | null {
  const bruto = valor.trim();
  if (!bruto) return null;

  if (bruto.startsWith("data:")) {
    // Sem a flag /s (o target de compilação não a aceita): [\s\S] cobre o
    // conteúdo inteiro, inclusive quebras de linha dentro do base64.
    const casamento = bruto.match(/^data:([^;]+);base64,([\s\S]*)$/);
    if (!casamento) return null;
    const [, mime, base64] = casamento;
    if (mime.startsWith("image/")) return { tipo: "imagem", mime, base64 };
    if (mime === "application/pdf") return { tipo: "pdf", mime, base64 };
    return null;
  }

  const base64 = bruto.replace(/\s/g, "");
  if (!base64) return null;
  if (base64.startsWith("JVBER")) return { tipo: "pdf", mime: "application/pdf", base64 };
  if (base64.startsWith("iVBORw0KGgo")) return { tipo: "imagem", mime: "image/png", base64 };
  if (base64.startsWith("/9j/")) return { tipo: "imagem", mime: "image/jpeg", base64 };
  if (base64.startsWith("R0lGOD")) return { tipo: "imagem", mime: "image/gif", base64 };
  if (base64.startsWith("UklGR")) return { tipo: "imagem", mime: "image/webp", base64 };
  return null;
}

/** Blob URL a partir do base64 — `data:application/pdf` não renderiza em frame. */
function base64ParaBlobUrl(base64: string, mime: string): string | null {
  try {
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  } catch (err) {
    console.error("[PedidoModelos] base64 da cor inválido:", err);
    return null;
  }
}

/**
 * Prévia do papel da cor selecionada, exibida apenas em item de prateleira.
 *
 * A imagem continua vindo de producao_cores a cada consulta — nada é copiado
 * para pedidos_modelos. Sem conteúdo, ou com conteúdo não renderizável, não
 * desenha nada: nem imagem quebrada, nem placeholder.
 */
export function PreviaCorPapel({ nomeCor }: { nomeCor: string | null | undefined }) {
  const [arquivo, setArquivo] = useState<{
    tipo: "imagem" | "pdf";
    src: string;
    /** Proporção da página (mm), quando o cadastro informa. */
    proporcao: number | null;
  } | null>(null);

  // O componente é remontado a cada cor (key no uso), então o estado já começa
  // vazio — não há reset a fazer aqui dentro.
  useEffect(() => {
    let ativo = true;
    let urlCriada: string | null = null;

    const cor = nomeCor?.trim();
    if (!cor) return;

    // Sem visualizador de PDF (navegador móvel, WebView, ambiente sem plugin) o
    // <embed> desenharia uma caixa de erro. Melhor não mostrar nada do que
    // mostrar "Couldn't load plugin". Imagem não depende disso.
    const suportaPdf = typeof navigator !== "undefined" && navigator.pdfViewerEnabled !== false;

    void buscarArquivoCorPapel(cor).then((arq) => {
      if (!ativo || !arq) return;
      const classificado = classificarArquivoCor(arq.conteudo);
      if (!classificado) return;

      const proporcao =
        arq.larguraMm && arq.alturaMm && arq.alturaMm > 0 ? arq.larguraMm / arq.alturaMm : null;

      if (classificado.tipo === "imagem") {
        setArquivo({
          tipo: "imagem",
          src: `data:${classificado.mime};base64,${classificado.base64}`,
          proporcao,
        });
        return;
      }
      if (!suportaPdf) return;
      urlCriada = base64ParaBlobUrl(classificado.base64, classificado.mime);
      if (urlCriada) setArquivo({ tipo: "pdf", src: urlCriada, proporcao });
    });

    return () => {
      ativo = false;
      if (urlCriada) URL.revokeObjectURL(urlCriada);
    };
  }, [nomeCor]);

  if (!arquivo) return null;

  return (
    <div className="mt-4 border-t border-teal-100 pt-3">
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        Papel · {nomeCor}
      </p>
      {arquivo.tipo === "imagem" ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={arquivo.src}
          alt={`Papel ${nomeCor}`}
          className="block h-auto max-h-[300px] w-auto max-w-full rounded-xl border border-slate-200 bg-white object-contain sm:max-w-[630px]"
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      ) : (
        // PDF: a caixa recebe a proporção real da página (producao_cores
        // width_mm × height_mm) e o visualizador ajusta à largura. Sem isso
        // sobrava o fundo escuro do visualizador — as pulseiras são tiras de
        // 245×20 mm (12,25:1) dentro de uma caixa quase quadrada.
        // Sem dimensões cadastradas, cai numa altura fixa.
        <div
          className="w-full max-w-[630px] overflow-hidden rounded-xl border border-slate-200 bg-white"
          style={
            arquivo.proporcao
              ? { aspectRatio: String(arquivo.proporcao), maxHeight: 300 }
              : { height: 300 }
          }
        >
          {/* O visualizador desenha a página sobre um fundo escuro próprio, que
              nenhum CSS externo alcança. Ampliar o embed e cortar no contêiner
              (overflow-hidden) joga essa moldura para fora da área visível —
              inclusive a barra de rolagem, que `scrollbar=0` não remove. */}
          <embed
            src={`${arquivo.src}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`}
            type="application/pdf"
            className="block h-[calc(100%+12px)] w-[calc(100%+28px)] -ml-[6px] -mt-[6px]"
          />
        </div>
      )}
    </div>
  );
}

// ─── Completude ──────────────────────────────────────────────────────────────

/**
 * Os campos com asterisco do formulário: nome, quantidade e — só quando o
 * produto a imprime — a cor do papel. É o mínimo para um lote existir no
 * banco; o card usa isto para decidir quando criar o modelo, e a lista rápida
 * para decidir quais linhas entram na gravação.
 */
export function modeloCompleto(
  mod: Pick<PedidoModeloState, "nome_modelo" | "padrao" | "quantidade">,
  visivel: ChecklistVisivel
): boolean {
  return Boolean(
    mod.nome_modelo?.trim() &&
    (!mostraCampo(visivel, "cor") || mod.padrao?.trim()) &&
    mod.quantidade > 0
  );
}

// ─── Campos do modelo ────────────────────────────────────────────────────────

export type ModeloCamposValores = Pick<
  PedidoModeloState,
  | "nome_modelo"
  | "quantidade"
  | "padrao"
  | "tipo_numeracao"
  | "numeracao_inicio"
  | "numeracao_fim"
  | "verso_tipo"
  | "bloco"
  | "gabarito_operacional"
  | "Q_CAM"
  | "L_CAM"
  | "C_INI"
>;

// ─── Colunas da lista rápida ─────────────────────────────────────────────────

export type ColunaDaLista = { chave: string; rotulo: string; largura: string };

/**
 * As colunas que a lista rápida mostra para um produto, na ordem do card e com
 * a MESMA regra de exibição dos campos. Fonte única: o cabeçalho e as células
 * de cada lote saem daqui — coluna nova entra aqui e aparece nos dois.
 */
export function colunasDaLista({
  simplificado,
  visivel,
  itemPrateleira,
}: {
  simplificado: boolean;
  visivel: ChecklistVisivel;
  itemPrateleira: boolean;
}): ColunaDaLista[] {
  const completo = !simplificado && !itemPrateleira;
  const colunas: ColunaDaLista[] = [];
  if (completo) colunas.push({ chave: "modelo", rotulo: "Modelo", largura: "minmax(150px, 2fr)" });
  colunas.push({ chave: "qtd", rotulo: "Qtd *", largura: "76px" });
  if (completo && mostraCampo(visivel, "numeracao_faixa")) {
    colunas.push({ chave: "num_inicio", rotulo: "Nº Inicial", largura: "84px" });
    colunas.push({ chave: "num_fim", rotulo: "Nº Final", largura: "84px" });
  }
  if (mostraCampo(visivel, "cor")) colunas.push({ chave: "cor", rotulo: "Cor papel *", largura: "minmax(130px, 1.5fr)" });
  if (completo) colunas.push({ chave: "bloco", rotulo: "Bloco", largura: "96px" });
  if (!itemPrateleira && mostraCampo(visivel, "impressao_fv")) {
    colunas.push({ chave: "verso", rotulo: "Verso", largura: "132px" });
  }
  if (!itemPrateleira && mostraCampo(visivel, "num_gabarito")) {
    colunas.push({ chave: "numerador", rotulo: "Numerador", largura: "minmax(130px, 1.3fr)" });
  }
  return colunas;
}

/** `grid-template-columns` da lista: as larguras das colunas visíveis. */
export function gridDaLista(colunas: ColunaDaLista[]): string {
  return colunas.map((c) => c.largura).join(" ");
}

const rotuloListaClass = "truncate text-[11px] font-bold uppercase tracking-wider text-slate-500";

/** A linha de títulos, uma por produto — as mesmas colunas das células. */
export function CabecalhoDaLista({ colunas, className }: { colunas: ColunaDaLista[]; className?: string }) {
  return (
    <div className={cn("grid items-end gap-2", className)} style={{ gridTemplateColumns: gridDaLista(colunas) }}>
      {colunas.map((c) => (
        <span key={c.chave} className={rotuloListaClass}>{c.rotulo}</span>
      ))}
    </div>
  );
}

const inputListaClass = "w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition";
const rotuloSublinhaClass = "text-[10px] font-bold uppercase tracking-wider text-slate-500";

export function ModeloCampos({
  modelo,
  coresOpcoes,
  numeracoesOpcoes,
  itemIdFormato,
  simplificado,
  visivel,
  itemPrateleira,
  modo,
  identificador = null,
  maxQtd,
  onChange,
  onBlurCampo,
  onPaste,
  onEnterQtd,
  numeracaoInicioTravada = null,
}: {
  modelo: ModeloCamposValores;
  coresOpcoes: CorDoPapelOpcao[];
  numeracoesOpcoes: NumeracaoOpcao[];
  itemIdFormato?: string | null;
  /** Proposta 100% de prateleira: só Cor papel, Qtd, Verso e Numerador. */
  simplificado: boolean;
  /** Checklist do boletim do produto (lib/checklist-lote). */
  visivel: ChecklistVisivel;
  /** Item de prateleira: no card, a prévia do papel da cor; na lista, só Qtd e Cor papel. */
  itemPrateleira: boolean;
  /**
   * Quem renderiza. No card os campos têm rótulo e fluem num flex; na lista são
   * células sem rótulo, colocadas pelo chamador num grid de `colunasDaLista`.
   */
  modo: "card" | "lista";
  /** Lista: o número do modelo, mostrado dentro do campo Modelo ("#1001304" ou "novo"). */
  identificador?: string | null;
  /** Saldo do item, que corta a Qtd. Ausente = sem trava (lista rápida). */
  maxQtd?: number;
  /**
   * @param imediato true para selects e toggles (valor discreto, não existe
   * estado intermediário inválido); false para texto/número.
   */
  onChange: (partial: Partial<PedidoModeloState>, imediato?: boolean) => void;
  /** Blur dos campos digitados: libera a gravação pendente. */
  onBlurCampo: () => void;
  /** Colar nos campos de texto (lista rápida: a lista do cliente). */
  onPaste?: (evento: React.ClipboardEvent) => void;
  /** Enter no campo Qtd (lista rápida: cria a próxima linha). */
  onEnterQtd?: () => void;
  /** Motivo para o Nº Inicial ficar somente leitura, ou null. */
  numeracaoInicioTravada?: string | null;
}) {
  const mostraCor = mostraCampo(visivel, "cor");
  const mostraFaixa = mostraCampo(visivel, "numeracao_faixa");
  const mostraVerso = mostraCampo(visivel, "impressao_fv");
  const mostraNumerador = mostraCampo(visivel, "num_gabarito");
  const lista = modo === "lista";
  // Prateleira na lista rápida: só Qtd e Cor papel (ver cabeçalho do arquivo).
  const soQtdECor = lista && itemPrateleira;
  const isCustomInit = modelo.bloco ? !["10", "15", "20", "25", "40", "50", "75", "100"].includes(modelo.bloco) : false;
  const [showCustomBloco, setShowCustomBloco] = useState(isCustomInit);

  const handleChange = onChange;
  const flushSave = onBlurCampo;

  // Na lista as células não têm rótulo nem largura própria: o grid do chamador
  // (colunasDaLista) é quem posiciona. No card fica tudo como sempre foi.
  const campo = lista ? inputListaClass : inputClass;
  const cel = (classeDoCard: string) => (lista ? "min-w-0" : classeDoCard);
  const rotulo = (texto: string) => (lista ? null : <label className={labelClass}>{texto}</label>);

  const hasConfig = Boolean(itemIdFormato);

  const filteredCores = hasConfig ? coresOpcoes.filter((c) => {
    return String(c.formato_id) === String(itemIdFormato);
  }) : [];

  const corSelecionada = modelo.padrao ? coresOpcoes.find((c) => c.name === modelo.padrao) : null;
  const formatoReferencia = corSelecionada?.formato_id ? String(corSelecionada.formato_id) : String(itemIdFormato);

  const filteredNum = (formatoReferencia && numeracoesOpcoes) ? numeracoesOpcoes.filter((n) => {
    if (String(n.formato_id) === formatoReferencia) return true;
    if (Array.isArray(n.formato_ids) && n.formato_ids.some((id: unknown) => String(id) === formatoReferencia)) return true;
    return false;
  }) : [];

  // Numerador selecionado (busca na lista completa: o gravado pode estar fora do filtro por formato)
  const numeracaoSelecionada = findNumeracaoByName(numeracoesOpcoes, modelo.gabarito_operacional);
  const tipoNumeracaoSelecionada = normalizarTipoNumeracao(numeracaoSelecionada?.tipo);
  // Sem campo Numerador na tela, as regras dele (Qtd do camarote, aviso do
  // ticket) também não aparecem.
  const isCamarote = !soQtdECor && tipoNumeracaoSelecionada === TIPO_CAMAROTE;
  const isTicket = !soQtdECor && tipoNumeracaoSelecionada === TIPO_TICKET;
  const qtdCamaroteCalculada = calcularQtdCamarote(modelo.Q_CAM, modelo.L_CAM);
  const { multiplicador: ticketMultiplicador, erro: erroTicket } = isTicket
    ? resolverMultiplicadorNumeracao(numeracaoSelecionada)
    : { multiplicador: 1, erro: null };
  const camaroteExcedeSaldo =
    maxQtd !== undefined && qtdCamaroteCalculada !== null && qtdCamaroteCalculada > maxQtd;

  const inputModelo = (
    <input
      type="text"
      className={campo}
      placeholder="Ex: Talão"
      value={modelo.nome_modelo}
      onChange={(e) => handleChange({ nome_modelo: e.target.value })}
      onBlur={flushSave}
      onPaste={onPaste}
      // Na lista, o número do modelo fica dentro do campo: abre espaço para ele.
      style={lista && identificador ? { paddingLeft: `${12 + identificador.length * 6}px` } : undefined}
    />
  );

  const camposCamarote = (
    <>
      <div className={cel("flex-[0.8] min-w-[70px]")}>
        <label className={lista ? rotuloSublinhaClass : labelClass}>Q CAM *</label>
        <input
          type="number"
          min={1}
          className={campo}
          placeholder="Ex: 10"
          title="Quantidade total de camarotes"
          value={modelo.Q_CAM ?? ""}
          onChange={(e) => handleChange({ Q_CAM: parseNumeroOpcional(e.target.value) })}
          onBlur={flushSave}
        />
      </div>

      <div className={cel("flex-[0.8] min-w-[70px]")}>
        <label className={lista ? rotuloSublinhaClass : labelClass}>L CAM *</label>
        <input
          type="number"
          min={1}
          className={campo}
          placeholder="Ex: 8"
          title="Lugares por camarote"
          value={modelo.L_CAM ?? ""}
          onChange={(e) => handleChange({ L_CAM: parseNumeroOpcional(e.target.value) })}
          onBlur={flushSave}
        />
      </div>

      <div className={cel("flex-[0.8] min-w-[70px]")}>
        <label className={lista ? rotuloSublinhaClass : labelClass}>C INI</label>
        <input
          type="number"
          className={campo}
          placeholder="Ex: 1"
          title="Número inicial do camarote"
          value={modelo.C_INI ?? ""}
          onChange={(e) => handleChange({ C_INI: parseNumeroOpcional(e.target.value) })}
          onBlur={flushSave}
        />
      </div>
    </>
  );

  const celulas = (
    <>
      {!simplificado && !soQtdECor && (
        <div className={cel("flex-[2] min-w-[110px]")}>
          {rotulo("Modelo *")}
          {lista && identificador ? (
            <div className="relative">
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">
                {identificador}
              </span>
              {inputModelo}
            </div>
          ) : (
            inputModelo
          )}
        </div>
      )}

      <div className={cel(cn("flex-[0.8] min-w-[60px]", simplificado && "order-2"))}>
        {rotulo("Qtd *")}
        <input
          type="number"
          className={isCamarote ? `${campo} bg-slate-50` : campo}
          value={modelo.quantidade || ""}
          readOnly={isCamarote}
          title={isCamarote ? "Calculado automaticamente: Q CAM × L CAM" : undefined}
          placeholder={isCamarote ? "Auto" : undefined}
          onChange={(e) => {
            if (isCamarote) return;
            const val = Number(e.target.value);
            if (!isNaN(val)) {
              handleChange({ quantidade: maxQtd === undefined ? val : Math.min(val, maxQtd) });
            }
          }}
          onBlur={flushSave}
          onPaste={onPaste}
          onKeyDown={
            onEnterQtd
              ? (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onEnterQtd();
                  }
                }
              : undefined
          }
        />
      </div>

      {/* No card os campos de camarote entram aqui, na sequência; na lista vão
          para uma sublinha, para não desalinhar as colunas do cabeçalho. */}
      {isCamarote && !lista && camposCamarote}

      {!simplificado && !soQtdECor && mostraFaixa && (
        <>
          <div className={cel("flex-[0.8] min-w-[70px]")}>
            {rotulo("Nº Inicial")}
            <input
              type="number"
              className={numeracaoInicioTravada ? `${campo} bg-slate-50` : campo}
              placeholder="Ex: 1"
              value={modelo.numeracao_inicio ?? ""}
              readOnly={Boolean(numeracaoInicioTravada)}
              title={numeracaoInicioTravada ?? undefined}
              onChange={(e) => handleChange({ numeracao_inicio: Number(e.target.value) || null })}
              onBlur={flushSave}
            />
          </div>

          <div className={cel("flex-[0.8] min-w-[70px]")}>
            {rotulo("Nº Final")}
            <input
              type="number"
              className={`${campo} bg-slate-50`}
              placeholder="Auto"
              value={modelo.numeracao_fim ?? ""}
              readOnly
            />
          </div>
        </>
      )}

      {mostraCor && (
      <div className={cel(cn("flex-[1.5] min-w-[100px]", simplificado && "order-1"))}>
        {rotulo("Cor papel *")}
          <select
            className={campo}
            value={modelo.padrao || ""}
            onChange={(e) => handleChange({ padrao: e.target.value }, true)}
            onPaste={onPaste}
            disabled={!hasConfig}
          >
            {!hasConfig ? (
              <option value="">Sem formato</option>
            ) : (
            <>
              <option value="">Selecione...</option>
              {filteredCores.map((c) => (
                <option key={String(c.id ?? c.name)} value={c.name}>{c.name}</option>
              ))}
            </>
            )}
          </select>
      </div>
      )}

      {!simplificado && !soQtdECor && (
        <div className={cel("flex-[1.2] min-w-[90px]")}>
          {rotulo("Bloco")}
          {showCustomBloco ? (
            <div className="flex gap-1">
              <input
                type="text"
                className={campo}
                placeholder="Ex: 50x2"
                value={modelo.bloco || ""}
                onChange={(e) => handleChange({ bloco: e.target.value || null })}
                onBlur={flushSave}
              />
              <button
                type="button"
                onClick={() => {
                  setShowCustomBloco(false);
                  handleChange({ bloco: null }, true);
                }}
                className={lista
                  ? "rounded-lg border border-slate-200 bg-white px-1.5 text-xs text-slate-500 hover:bg-slate-50"
                  : "rounded-xl border border-slate-200 bg-white px-2 py-2 text-slate-500 hover:bg-slate-50"}
                title="Voltar para opções fixas"
              >
                X
              </button>
            </div>
          ) : (
            <select
              className={campo}
              value={modelo.bloco || ""}
              onChange={(e) => {
                if (e.target.value === "Outro") {
                  setShowCustomBloco(true);
                  handleChange({ bloco: null }, true);
                } else {
                  handleChange({ bloco: e.target.value || null }, true);
                }
              }}
            >
              <option value="">Nenhum</option>
              <option value="10">10</option>
              <option value="15">15</option>
              <option value="20">20</option>
              <option value="25">25</option>
              <option value="40">40</option>
              <option value="50">50</option>
              <option value="75">75</option>
              <option value="100">100</option>
              <option value="Outro">Outro</option>
            </select>
          )}
        </div>
      )}

      {mostraVerso && !soQtdECor && (
      <div className={cel(cn("flex-[1.2] min-w-[100px]", simplificado && "order-3"))}>
        {rotulo("Verso")}
        <select
          className={campo}
          value={modelo.verso_tipo || ""}
          onChange={(e) => handleChange({ verso_tipo: e.target.value }, true)}
        >
          <option value="SÓ FRENTE">SÓ FRENTE</option>
          <option value="FRENTE E VERSO">FRENTE E VERSO</option>
          <option value="VERSO FIXO">VERSO FIXO</option>
          <option value="VERSO VARIÁVEL">VERSO VARIÁVEL</option>
        </select>
      </div>
      )}

      {mostraNumerador && !soQtdECor && (
      <div className={cel(cn("flex-[1.5] min-w-[100px]", simplificado && "order-4"))}>
        {rotulo("Numerador")}
        <select
          className={campo}
          value={modelo.gabarito_operacional || ""}
          onChange={(e) => {
            const val = e.target.value;
            handleChange({ gabarito_operacional: val || null, tipo_numeracao: "SEQUENCIAL" }, true);
          }}
          disabled={!hasConfig}
        >
          {!hasConfig ? (
            <option value="">Sem formato</option>
          ) : (
            <>
              <option value="">Selecione...</option>
              {filteredNum.map((n) => (
                <option key={String(n.id ?? n.name)} value={n.name ?? ""}>{n.name}</option>
              ))}
            </>
          )}
        </select>
      </div>
      )}
    </>
  );

  // Avisos de numerador: no card ficam abaixo do flex; na lista ocupam a linha
  // inteira do grid (col-span-full), abaixo das células.
  const classeAviso = lista ? "col-span-full text-[11px]" : "mt-3 text-[11px]";
  const avisos = (
    <>
      {isCamarote && (
        <p className={`${classeAviso} font-semibold ${camaroteExcedeSaldo ? "text-red-600" : "text-slate-500"}`}>
          Numerador tipo Camarote: QTD = Q CAM × L CAM
          {qtdCamaroteCalculada !== null
            ? ` = ${qtdCamaroteCalculada}${camaroteExcedeSaldo ? ` — excede o saldo disponível do item (${maxQtd})` : ""}`
            : " — preencha Q CAM e L CAM"}
        </p>
      )}

      {isTicket && (
        erroTicket ? (
          <p className={`${classeAviso} font-bold text-red-600`}>{erroTicket}</p>
        ) : (
          <p className={`${classeAviso} font-semibold text-slate-500`}>
            Numerador tipo Ticket ({ticketMultiplicador} numerações por unidade): Nº Final = Nº Inicial + (QTD × {ticketMultiplicador}) − 1
          </p>
        )
      )}
    </>
  );

  if (lista) {
    return (
      <>
        {celulas}
        {isCamarote && <div className="col-span-full flex flex-wrap gap-3">{camposCamarote}</div>}
        {avisos}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-wrap xl:flex-nowrap xl:items-end gap-3">
        {celulas}
      </div>

      {avisos}

      {/* Produto de prateleira: papel da cor escolhida, direto de producao_cores.
          Troca de cor troca a prévia porque a chave é o próprio `padrao`. */}
      {itemPrateleira && <PreviaCorPapel key={modelo.padrao || "sem-cor"} nomeCor={modelo.padrao} />}
    </>
  );
}

// ─── Janela de amostra ───────────────────────────────────────────────────────

/**
 * Status da arte e a amostra renderizada (frente e, quando existir, verso),
 * com clique para ampliar. É o bloco do card fechado; a lista rápida o mostra
 * embaixo de cada lote, sempre aberto.
 */
export function AmostraDoModelo({
  modelo,
  itemPrateleira,
  modo,
  onAmpliar,
}: {
  modelo: Pick<PedidoModeloState, "nome_modelo" | "status_arte" | "amostra_arte_base64" | "verso_amostra_arte_base64">;
  /**
   * Produto de prateleira é vendido pronto e não passa pelo fluxo de arte —
   * mostrar "Arte: PENDENTE" ali seria uma pendência que não existe.
   */
  itemPrateleira: boolean;
  /**
   * Card fechado: status + imagens empilhadas, como sempre. Lista rápida (botão
   * "Amostras" do produto): só as imagens, frente e verso lado a lado — o
   * status já está na linha do lote.
   */
  modo: "card" | "lista";
  onAmpliar: (arte: { frente: string; verso: string | null; nome: string }) => void;
}) {
  // Na lista rápida, prateleira não tem janela de amostra — nem a moldura.
  // No card fechado a moldura fica (sem o status), como sempre foi.
  if (modo === "lista" && itemPrateleira) return null;

  const lista = modo === "lista";
  const arteSrc = modelo.amostra_arte_base64 ? toImageSrc(modelo.amostra_arte_base64) : null;
  // Verso resolvido pelo mesmo tratamento da frente (data URI, URL ou base64
  // puro). Null quando a coluna está vazia ou o conteúdo não é renderizável
  // em <img>.
  const versoSrc = modelo.verso_amostra_arte_base64 ? toImageSrc(modelo.verso_amostra_arte_base64) : null;
  const abrirArte = () =>
    arteSrc && onAmpliar({ frente: arteSrc, verso: versoSrc, nome: modelo.nome_modelo || "" });

  return (
    <div className={lista ? "mt-2 border-t border-slate-100 pt-2" : "mt-3 border-t border-slate-100 pt-3"}>
      {!itemPrateleira && !lista && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Arte:</span>
          <StatusBadge
            status={modelo.status_arte || "PENDENTE"}
            tone={getArteStatusTone(modelo.status_arte)}
          />
        </div>
      )}
      {arteSrc ? (
        // Prévia sem caixa: a borda abraça a própria imagem. Com
        // largura e altura automáticas, o navegador respeita a
        // proporção original e para no primeiro limite atingido —
        // 90% da largura / 200px de altura no mobile, 70% / 260px
        // de tablet para cima (md). Sem object-fit: as dimensões
        // são intrínsecas, então não há como esticar nem cortar.
        // Verso, quando existir, entra logo abaixo da frente com
        // as mesmas regras (na lista, ao lado). Clique (ou
        // Enter/Espaço) em qualquer uma abre a arte ampliada com as duas.
        // Na lista, frente e verso lado a lado; o tamanho de cada imagem segue
        // as MESMAS regras do card (90%/200px, 70%/260px de md para cima).
        <div className={lista ? "flex flex-wrap items-start gap-4" : "mt-3 space-y-2"}>
          {[
            { src: arteSrc, lado: "Frente" as const },
            ...(versoSrc ? [{ src: versoSrc, lado: "Verso" as const }] : []),
          ].map(({ src, lado }) => (
            <div key={lado} className={lista ? "max-w-[90%] md:max-w-[70%]" : undefined}>
              {/* Rótulo só quando há os dois lados: com uma
                  imagem só ele não acrescenta informação. */}
              {versoSrc && (
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {lado}
                </p>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`${lado} da arte do modelo ${modelo.nome_modelo || ""}`}
                className={lista
                  ? "block h-auto max-h-[200px] w-auto max-w-full cursor-zoom-in rounded-xl border border-slate-200 bg-white transition hover:border-blue-400 md:max-h-[260px]"
                  : "block h-auto max-h-[200px] w-auto max-w-[90%] cursor-zoom-in rounded-xl border border-slate-200 bg-white transition hover:border-blue-400 md:max-h-[260px] md:max-w-[70%]"}
                loading="lazy"
                role="button"
                tabIndex={0}
                title="Clique para ampliar"
                onClick={abrirArte}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    abrirArte();
                  }
                }}
                onError={(e) => {
                  // Conteúdo inválido/inacessível: esconde a imagem
                  // e o rótulo dela, sem afetar o outro lado.
                  e.currentTarget.parentElement?.style.setProperty("display", "none");
                }}
              />
            </div>
          ))}
        </div>
      ) : lista ? (
        <p className="text-[11px] font-semibold text-slate-400">Sem amostra de arte.</p>
      ) : null}
    </div>
  );
}
