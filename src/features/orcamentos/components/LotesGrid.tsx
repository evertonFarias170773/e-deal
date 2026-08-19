"use client";

/**
 * Grade de lotes de um item: colar a lista do cliente, digitar e fechar.
 *
 * POR QUE ELA EXISTE
 *   Montar um pedido de 20 lotes pela pilha de cards custa 4 idas ao servidor
 *   e a reabertura do formulário por lote — medido em produção: 3min42s para
 *   13 lotes, 18,5 s cada. E como cada lote é validado contra a quantidade do
 *   item já gravada, distribuir uma lista nova obrigava a ir antes à aba
 *   Orçamento aumentar a quantidade, voltar, e repetir a cada ajuste.
 *
 * A REGRA QUE ELA INVERTE
 *   Aqui a lista manda: a quantidade do item passa a ser a soma dos lotes,
 *   gravada junto, numa chamada só (POST /api/pedidos/lotes-em-massa). Por
 *   isso a grade não tem trava de saldo nem corta número digitado — não existe
 *   saldo a estourar quando o item acompanha a soma.
 *
 * O RASCUNHO É LOCAL DE PROPÓSITO
 *   Nada sai daqui antes de "Fechar lote". Sair da aba é o desfazer natural, e
 *   digitar não dispara render da página inteira a cada tecla.
 */

import { useMemo, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { fetchComSessao, SessaoExpiradaError } from "@/lib/supabase/sessao";
import { interpretarColagem, somaQuantidades, type CorOpcao } from "@/features/orcamentos/services/lotes-colagem";
import {
  calcularNumeracaoFim,
  findNumeracaoByName,
  resolverMultiplicadorNumeracao,
  type NumeracaoOpcao
} from "@/features/orcamentos/numeracao-modelo-utils";
import { aplicarNumeracao, rotuloFaixa, type ModoNumeracao } from "@/features/orcamentos/services/lotes-numeracao";

/** Teto para a criação em lote: acima disso é engano de digitação, não pedido. */
const MAX_LINHAS_DE_UMA_VEZ = 200;

export type LinhaLote = {
  /** `pedidos_modelos.id` quando a linha já existe no banco. */
  id?: number | null;
  nome_modelo: string;
  quantidade: number | "";
  padrao: string | null;
  /** Campos herdados que a grade não edita, mas precisa devolver intactos. */
  tipo_numeracao?: string | null;
  numeracao_inicio?: number | null;
  numeracao_fim?: number | null;
  verso_tipo?: string | null;
  bloco?: string | null;
  gabarito_operacional?: string | null;
  variacoes_texto?: string | null;
  /** Só na tela: cor colada que não casou com o cadastro. */
  corNaoReconhecida?: string | null;
};

/**
 * Como nasce um lote novo deste item: cor do papel e numerador vindos do
 * cadastro do produto, mais os defaults de verso e bloco.
 *
 * Quem monta isso é o PedidoModelosTab, num lugar só, e o mesmo objeto
 * alimenta o card "Adicionar modelo" e esta grade. Antes a grade criava linha
 * sem numerador, e o vendedor tinha que abrir lote por lote depois só para
 * escolher o que o cadastro já sabia.
 */
export type PadroesDeLote = {
  padrao: string | null;
  gabarito_operacional: string | null;
  tipo_numeracao: string;
  numeracao_inicio: number | null;
  verso_tipo: string;
  bloco: string;
};

export function LotesGrid({
  idInt,
  item,
  itemPrateleira,
  linhasIniciais,
  cores,
  numeracoes,
  padroes,
  onGravado,
  onSair
}: {
  idInt: number;
  item: { id_produto_proposta_origem: number; nome: string; quantidade: number };
  /**
   * Produto de prateleira (`produtos_proposta.is_estoque`): vendido pronto, sem
   * arte e sem lote desenhado. O lote não tem nome próprio a inventar — o que
   * identifica a peça é o próprio produto, e é ele que a grade usa.
   */
  itemPrateleira: boolean;
  linhasIniciais: LinhaLote[];
  cores: CorOpcao[];
  /** Cadastro de numerações: só para saber quantos números cada unidade consome (TICKET). */
  numeracoes: NumeracaoOpcao[];
  /** Com o que um lote novo deste item já nasce preenchido. */
  padroes: PadroesDeLote;
  /** Chamado depois de gravar: o pai atualiza a quantidade do item e relê os lotes. */
  onGravado: (resultado: {
    qtdItem: number;
    freteMensagem: string | null;
    /** Lotes como ficaram no banco, com os ids — o pai precisa deles para nao duplicar no proximo salvamento. */
    lotes: Record<string, unknown>[];
  }) => void;
  onSair: () => void;
}) {
  const { showToast } = useAppToast();
  const [linhas, setLinhas] = useState<LinhaLote[]>(
    linhasIniciais.length > 0 ? linhasIniciais : [novaLinha()]
  );
  const [removidos, setRemovidos] = useState<number[]>([]);
  const [gravando, setGravando] = useState(false);
  const [quantasLinhas, setQuantasLinhas] = useState<number | "">(1);
  const [modoNumeracao, setModoNumeracao] = useState<ModoNumeracao | null>(null);
  const qtdVista = useRef(item.quantidade);

  const soma = useMemo(() => somaQuantidades(linhas), [linhas]);
  const naoReconhecidas = linhas.filter((l) => l.corNaoReconhecida).length;
  const semNome = linhas.filter((l) => !l.nome_modelo.trim()).length;

  // A numeração é DERIVADA, nunca guardada em estado: assim ela nunca fica
  // velha depois de mudar uma quantidade, remover ou reordenar um lote.
  const linhasNumeradas = useMemo(
    () =>
      aplicarNumeracao(linhas, modoNumeracao, (inicio, qtd, linha) => {
        const { multiplicador } = resolverMultiplicadorNumeracao(
          findNumeracaoByName(numeracoes, linha.gabarito_operacional)
        );
        return calcularNumeracaoFim(inicio, qtd, multiplicador);
      }),
    [linhas, modoNumeracao, numeracoes]
  );

  const quantasCriar = Math.min(MAX_LINHAS_DE_UMA_VEZ, Math.max(1, Number(quantasLinhas) || 1));

  function atualizar(indice: number, patch: Partial<LinhaLote>) {
    setLinhas((atual) => atual.map((l, i) => (i === indice ? { ...l, ...patch } : l)));
  }

  function novaLinha(base?: LinhaLote) {
    // Herda da linha anterior o que não costuma variar entre lotes do mesmo
    // produto e, quando não há de quem herdar, cai no cadastro do produto — é
    // o que evita lote nascendo sem numerador. A quantidade nasce em branco de
    // propósito, para ninguém gravar por engano o número da linha anterior.
    return {
      // Prateleira nasce com o nome do produto: não há arte nem lote desenhado a
      // batizar, e exigir digitação era barrar o fechamento por um vazio que a
      // própria grade tinha acabado de criar. O caminho de COLAR já fazia isto
      // (`nomePadrao`, abaixo) — o "+" ficava de fora, na mesma tela.
      // Produto normal segue nascendo vazio: ali o nome do lote é informação de
      // verdade, e a validação continua inteira.
      nome_modelo: base?.nome_modelo ?? (itemPrateleira ? item.nome : ""),
      quantidade: "" as const,
      padrao: base?.padrao ?? padroes.padrao,
      tipo_numeracao: base?.tipo_numeracao ?? padroes.tipo_numeracao,
      numeracao_inicio: base?.numeracao_inicio ?? padroes.numeracao_inicio,
      verso_tipo: base?.verso_tipo ?? padroes.verso_tipo,
      bloco: base?.bloco ?? padroes.bloco,
      gabarito_operacional: base?.gabarito_operacional ?? padroes.gabarito_operacional,
      variacoes_texto: base?.variacoes_texto ?? null
    } as LinhaLote;
  }

  function acrescentar(indice?: number, quantas = 1) {
    setLinhas((atual) => {
      const base = indice !== undefined ? atual[indice] : atual[atual.length - 1];
      // novaLinha por índice, não uma cópia do mesmo objeto: linhas que
      // compartilhassem referência editariam umas às outras.
      return [...atual, ...Array.from({ length: quantas }, () => novaLinha(base))];
    });
  }

  function remover(indice: number) {
    setLinhas((atual) => {
      const alvo = atual[indice];
      if (alvo?.id) setRemovidos((r) => [...r, Number(alvo.id)]);
      const resto = atual.filter((_, i) => i !== indice);
      return resto.length > 0 ? resto : [novaLinha()];
    });
  }

  function colar(evento: React.ClipboardEvent, indice: number) {
    const texto = evento.clipboardData.getData("text");
    if (!texto.includes("\n") && !texto.includes("\t")) return; // colagem de um valor só: comportamento normal

    evento.preventDefault();
    const lidas = interpretarColagem(texto, cores);
    if (lidas.length === 0) {
      showToast({
        type: "warning",
        title: "Nada reconhecido na lista",
        description: "Esperado uma linha por lote, com a cor e a quantidade — como sai da planilha."
      });
      return;
    }

    // Colar SEMPRE acrescenta. Substituir apagaria trabalho já digitado, e o
    // gesto é o mais perigoso da tela.
    const nomePadrao = linhas[indice]?.nome_modelo?.trim() || item.nome;
    setLinhas((atual) => {
      const semVaziaFinal = atual.filter((l) => l.nome_modelo.trim() || l.quantidade !== "" || l.padrao);
      const base = atual[atual.length - 1];
      // O que veio da lista (cor e quantidade) manda; o resto do lote vem dos
      // padrões, senão colar 20 linhas geraria 20 lotes sem numerador.
      return [
        ...semVaziaFinal,
        ...lidas.map((l) => ({ ...novaLinha(base), ...l, nome_modelo: nomePadrao }))
      ];
    });

    const semCor = lidas.filter((l) => l.corNaoReconhecida).length;
    showToast({
      type: semCor > 0 ? "warning" : "success",
      title: `${lidas.length} lote(s) lidos da lista`,
      description: semCor > 0 ? `${semCor} cor(es) não reconhecidas — escolha na coluna Cor.` : undefined
    });
  }

  async function fecharLote(confirmarReducao = false) {
    if (semNome > 0) {
      showToast({ type: "error", title: "Falta o nome do modelo", description: `${semNome} lote(s) sem nome.` });
      return;
    }
    if (soma <= 0) {
      showToast({ type: "error", title: "Nenhuma quantidade informada" });
      return;
    }

    setGravando(true);
    try {
      const resposta = await fetchComSessao("/api/pedidos/lotes-em-massa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idInt,
          idProdutoProposta: item.id_produto_proposta_origem,
          qtdItemVista: qtdVista.current,
          confirmarReducao,
          removerIds: removidos,
          lotes: linhasNumeradas.map((l) => ({
            id: l.id ?? null,
            nome_modelo: l.nome_modelo,
            quantidade: Number(l.quantidade),
            padrao: l.padrao,
            tipo_numeracao: l.tipo_numeracao,
            numeracao_inicio: l.numeracao_inicio,
            numeracao_fim: l.numeracao_fim,
            verso_tipo: l.verso_tipo,
            bloco: l.bloco,
            gabarito_operacional: l.gabarito_operacional,
            variacoes_texto: l.variacoes_texto
          }))
        })
      });

      const dados = await resposta.json().catch(() => null);

      if (!resposta.ok || !dados?.success) {
        if (dados?.code === "CONFIRMAR_REDUCAO" && !confirmarReducao) {
          const ok = window.confirm(
            `${dados.message}\n\nA quantidade do item vai de ${dados.qtdAtual} para ${dados.novaQtd}, ` +
            "e o subtotal e o peso acompanham. Confirmar?"
          );
          if (ok) {
            setGravando(false);
            await fecharLote(true);
            return;
          }
          setGravando(false);
          return;
        }
        showToast({
          type: "error",
          title: "Lotes não gravados",
          description: dados?.message || "Não foi possível gravar os lotes."
        });
        return;
      }

      qtdVista.current = dados.qtdItem;
      setRemovidos([]);
      showToast({
        type: "success",
        title: `${dados.lotesGravados} lote(s) gravados`,
        description: `Quantidade do item: ${dados.qtdItem}.`
      });
      onGravado({
        qtdItem: dados.qtdItem,
        freteMensagem: dados.freteMensagem || null,
        lotes: Array.isArray(dados.lotes) ? dados.lotes : []
      });
    } catch (erro) {
      showToast({
        type: "error",
        title: erro instanceof SessaoExpiradaError ? "Sessão expirada" : "Falha ao gravar",
        description: erro instanceof Error ? erro.message : "Erro desconhecido."
      });
    } finally {
      setGravando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-sm">
          <span className="font-semibold text-slate-800">{linhas.length} lote(s)</span>
          <span className="mx-2 text-slate-300">·</span>
          <span className="font-semibold text-slate-800">{soma.toLocaleString("pt-BR")} un</span>
          {soma !== item.quantidade && (
            <span className="ml-2 text-xs font-semibold text-amber-600">
              quantidade do item: {item.quantidade.toLocaleString("pt-BR")} → {soma.toLocaleString("pt-BR")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={MAX_LINHAS_DE_UMA_VEZ}
            value={quantasLinhas}
            onChange={(e) =>
              setQuantasLinhas(
                e.target.value === ""
                  ? ""
                  : Math.min(MAX_LINHAS_DE_UMA_VEZ, Math.max(1, Number(e.target.value) || 1))
              )
            }
            title="Quantas linhas criar de uma vez"
            aria-label="Quantas linhas criar de uma vez"
            className="w-16 rounded-xl border border-slate-200 px-2 py-2 text-center text-xs font-bold text-slate-700 outline-none"
          />
          <button
            type="button"
            onClick={() => acrescentar(undefined, quantasCriar)}
            className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-200"
          >
            <Plus className="h-4 w-4" /> {quantasCriar > 1 ? `${quantasCriar} linhas` : "Linha"}
          </button>
          <button
            type="button"
            onClick={onSair}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
          >
            Ver como cards
          </button>
          <button
            type="button"
            onClick={() => void fecharLote()}
            disabled={gravando}
            className="rounded-xl bg-[#0b2f4a] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#123f61] disabled:opacity-60"
          >
            {gravando ? "Gravando..." : "Fechar lote"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Numeração</span>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={modoNumeracao === "CADA_DO_1"}
            onChange={() => setModoNumeracao((atual) => (atual === "CADA_DO_1" ? null : "CADA_DO_1"))}
            className="h-4 w-4 rounded border-slate-300"
          />
          Cada modelo começa do 1
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
          <input
            type="checkbox"
            checked={modoNumeracao === "SEQUENCIAL"}
            onChange={() => setModoNumeracao((atual) => (atual === "SEQUENCIAL" ? null : "SEQUENCIAL"))}
            className="h-4 w-4 rounded border-slate-300"
          />
          Sequencial entre os modelos
        </label>
        <span className="text-[11px] text-slate-500">
          {modoNumeracao === "CADA_DO_1"
            ? "1–300, 1–150, 1–80"
            : modoNumeracao === "SEQUENCIAL"
              ? "1–300, 301–450, 451–530"
              : "Sem marcar, cada lote mantém o Nº inicial que já tem."}
        </span>
      </div>

      <p className="px-1 text-[11px] text-slate-500">
        Cole a lista do cliente em qualquer campo (uma linha por lote, cor e quantidade).
        Enter cria a próxima linha herdando a cor.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-bold">Cor do papel</th>
              <th className="w-28 px-3 py-2 text-left font-bold">Qtd</th>
              <th className="px-3 py-2 text-left font-bold">Modelo</th>
              <th className="w-32 px-3 py-2 text-left font-bold">Numeração</th>
              <th className="w-20 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {linhasNumeradas.map((linha, indice) => (
              <tr key={indice} className={linha.corNaoReconhecida ? "bg-red-50" : "border-t border-slate-100"}>
                <td className="px-3 py-2">
                  <select
                    value={linha.padrao ?? ""}
                    onChange={(e) => atualizar(indice, { padrao: e.target.value || null, corNaoReconhecida: null })}
                    onPaste={(e) => colar(e, indice)}
                    className={`w-full rounded-xl border px-2 py-1.5 text-sm outline-none ${
                      linha.corNaoReconhecida ? "border-red-300 bg-white" : "border-slate-200"
                    }`}
                  >
                    <option value="">{linha.corNaoReconhecida ? `? ${linha.corNaoReconhecida}` : "Selecione..."}</option>
                    {cores.map((c) => (
                      <option key={String(c.id ?? c.name)} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    value={linha.quantidade}
                    onChange={(e) => atualizar(indice, { quantidade: e.target.value === "" ? "" : Math.max(0, Number(e.target.value)) })}
                    onPaste={(e) => colar(e, indice)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        acrescentar(indice);
                      }
                    }}
                    className="w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm outline-none"
                    placeholder="0"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={linha.nome_modelo}
                    onChange={(e) => atualizar(indice, { nome_modelo: e.target.value })}
                    onPaste={(e) => colar(e, indice)}
                    className="w-full rounded-xl border border-slate-200 px-2 py-1.5 text-sm outline-none"
                    placeholder={item.nome}
                  />
                </td>
                <td className="px-3 py-2 text-xs font-semibold tabular-nums text-slate-600">
                  {rotuloFaixa(linha.numeracao_inicio, linha.numeracao_fim)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      title="Duplicar (quantidade em branco)"
                      onClick={() => acrescentar(indice)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      title="Remover lote"
                      onClick={() => remover(indice)}
                      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {naoReconhecidas > 0 && (
        <p className="px-1 text-[11px] font-semibold text-red-600">
          {naoReconhecidas} cor(es) da lista não existem no cadastro deste produto — escolha na coluna Cor antes de fechar.
        </p>
      )}
    </div>
  );
}
