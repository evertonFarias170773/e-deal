"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ActionMenuItem } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { urlDownloadXmlNfe } from "@/lib/fiscal/download-xml-nfe";
import { abrirLinkDeDocumentoFiscal } from "@/lib/fiscal/documento-nota";
import type { OrcamentoListItem } from "@/features/orcamentos/mappers";
import type { Proposta } from "@/features/orcamentos/types";
import { lerLinhaDaListaDaProposta } from "@/features/orcamentos/services/linha-da-lista.service";
import {
  getPropostaDetailById,
  liberarPropostaParaProducaoPeloServidor,
  STATUS_ACEITAM_PEDIDO_COMPLEMENTAR
} from "@/features/orcamentos/services/orcamentos.service";
import { buscarRastreioDasPropostas, type RastreioDaProposta } from "@/features/orcamentos/services/rastreio-lista.service";
import { encerrarTeste, reabrirTeste } from "@/features/pedidos/services/encerrar-teste.client";
import { desmarcarFaturadoNoSistemaAntigo } from "@/features/fiscal/services/faturado-fora.client";
import { podeVerDesfazerNotaAntecipada, podeVerLiberarNotaAntecipada } from "@/features/orcamentos/lib/nota-antecipada";
import { desfazerNotaAntecipada, liberarNotaAntecipada } from "@/features/orcamentos/services/nota-antecipada.client";
import { podeVerMarcarComoEntregue } from "@/features/orcamentos/lib/marcar-entregue";
import { marcarPedidoComoEntreguePeloServidor } from "@/features/orcamentos/services/marcar-entregue.service";
import { estaNaFilaSemProducao } from "@/features/orcamentos/lib/enviar-fila-faturamento";
import { podeVerConfirmarConferenciaNaLista, rotuloDaOpcaoDeConferencia } from "@/features/orcamentos/lib/cobrancas-na-fila";
import { isFilaPadrao } from "@/features/cobrancas/cobrancas-utils";
import { lerCobrancaPorId, listarCobrancasDaProposta } from "@/features/cobrancas/services/pagamentos-v2.service";
import type { Cobranca } from "@/features/cobrancas/types";
import { PortaoDaCargaCompleta } from "@/features/cobrancas/CobrancasSobDemanda";
import { PropostaCobrancaPanel } from "@/features/cobrancas/PropostaCobrancaPanel";
import { ConfirmarLiberacaoModal } from "@/features/cobrancas/ConfirmarLiberacaoModal";
import { CancelPropostaModal } from "@/features/orcamentos/components/CancelPropostaModal";
import { LiberarProducaoModal } from "@/features/orcamentos/components/LiberarProducaoModal";
import { CriarComplementoModal } from "@/features/orcamentos/components/CriarComplementoModal";
import { MarcarEntregueModal } from "@/features/orcamentos/components/MarcarEntregueModal";
import { RastreioPropostaModal } from "@/features/orcamentos/components/RastreioPropostaModal";
import { VerConhecimentoModal } from "@/features/expedicao/components/VerConhecimentoModal";

/**
 * AS AÇÕES DO MENU DA LISTA DE PEDIDOS DENTRO DA PROPOSTA (05/11/2026).
 *
 * O comercial confere e põe em produção sem sair da proposta. Cada ação aqui é
 * ESPELHO de `getActions` em OrcamentosListPageReal: mesma permissão, mesma
 * condição de status, mesma confirmação (o mesmo modal ou o mesmo
 * `window.confirm`, com o mesmo texto) e a mesma função que grava. Nada é ação
 * nova. Mudou a regra lá, muda aqui.
 *
 * As condições leem a linha da lista, montada pela mesma leitura
 * (`lerLinhaDaListaDaProposta`). Ao concluir, a linha é relida e a proposta
 * recarrega (`onConcluir`), sem sair da tela.
 *
 * Gerar cobrança, Cancelar proposta e Confirmar Conferência usam o
 * `CobrancasProvider` que a tela da proposta já tem (o mesmo da aba
 * Pagamentos), atrás do mesmo portão de carga completa da lista.
 *
 * As ações vêm em três blocos, para entrar no menu da proposta na ordem da lista.
 */
export function useAcoesDaListaNaProposta({
  idInt,
  versao,
  onConcluir
}: {
  /** Proposta aberta; null = proposta nova, sem ações. */
  idInt: number | null;
  /** Muda quando a proposta é relida: a linha da lista é relida junto. */
  versao: unknown;
  /** Recarrega a proposta na tela. */
  onConcluir: () => void;
}): {
  item: OrcamentoListItem | null;
  aposDuplicar: ActionMenuItem[];
  aposGerarOc: ActionMenuItem[];
  aposEnviarFila: ActionMenuItem[];
  modais: ReactNode;
} {
  const { user } = useAuth();
  const { showToast } = useAppToast();

  const [item, setItem] = useState<OrcamentoListItem | null>(null);
  const [rastreio, setRastreio] = useState<RastreioDaProposta | null>(null);

  useEffect(() => {
    if (!idInt) return;
    let ativo = true;
    void (async () => {
      try {
        const [linha, rastreios] = await Promise.all([
          lerLinhaDaListaDaProposta(idInt),
          buscarRastreioDasPropostas([idInt]).catch(() => ({} as Record<number, RastreioDaProposta>))
        ]);
        if (!ativo) return;
        setItem(linha);
        setRastreio(rastreios[idInt] ?? null);
      } catch (erro) {
        console.error("[useAcoesDaListaNaProposta] Falha ao ler a linha da lista:", erro);
        if (ativo) setItem(null);
      }
    })();
    return () => {
      ativo = false;
    };
  }, [idInt, versao]);

  /**
   * Depois de qualquer ação a proposta recarrega; a proposta nova muda `versao`,
   * e a linha da lista é relida junto (o efeito acima).
   */
  const concluir = useCallback(() => {
    onConcluir();
  }, [onConcluir]);

  // Permissões: as mesmas da lista.
  const canCancelarProposta = Boolean(user?.isSuperAdmin || hasPermissao(user, "propostas.cancel"));
  const canEncerrarTeste = hasPermissao(user, "propostas.encerrar_teste");
  const canLiberarProducao = Boolean(user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "propostas.release_producao"));
  const canConfirmarConferenciaNaLista = podeVerConfirmarConferenciaNaLista(user);
  const canDesmarcarFaturadoFora = Boolean(user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "propostas.release_nf"));

  // Estados das confirmações e modais.
  const [complementoAberto, setComplementoAberto] = useState(false);
  const [cobrancaProposta, setCobrancaProposta] = useState<Proposta | null>(null);
  const [carregandoCobranca, setCarregandoCobranca] = useState(false);
  const [cobrancaParaConferir, setCobrancaParaConferir] = useState<Cobranca | null>(null);
  const [abrindoConferenciaId, setAbrindoConferenciaId] = useState<string | null>(null);
  const [cancelarAberto, setCancelarAberto] = useState(false);
  const [liberarAberto, setLiberarAberto] = useState(false);
  const [liberando, setLiberando] = useState(false);
  const [rastreioAberto, setRastreioAberto] = useState(false);
  const [conhecimentoAberto, setConhecimentoAberto] = useState(false);
  const [encerrandoTeste, setEncerrandoTeste] = useState(false);
  const [notaAntecipadaEmCurso, setNotaAntecipadaEmCurso] = useState(false);
  const [desmarcandoFaturadoFora, setDesmarcandoFaturadoFora] = useState(false);
  const [marcarEntregueAberto, setMarcarEntregueAberto] = useState(false);
  const [marcandoEntregue, setMarcandoEntregue] = useState(false);

  // ── Ações (o corpo de cada uma é o da lista) ─────────────────────────────

  async function abrirConferenciaDaCobranca(idCobranca: string) {
    if (abrindoConferenciaId) return;
    setAbrindoConferenciaId(idCobranca);
    try {
      const cobranca = await lerCobrancaPorId(idCobranca);
      if (!cobranca) {
        showToast({ type: "error", title: "Não foi possível abrir a conferência", description: "A cobrança não foi encontrada. Atualize a lista e tente de novo." });
        return;
      }
      if (!isFilaPadrao(cobranca)) {
        showToast({ type: "info", title: "Esta cobrança já não está na Fila de Conferência", description: "A lista foi atualizada." });
        concluir();
        return;
      }
      setCobrancaParaConferir(cobranca);
    } finally {
      setAbrindoConferenciaId(null);
    }
  }

  async function abrirGerarCobranca(alvo: OrcamentoListItem) {
    if (carregandoCobranca) return;
    setCarregandoCobranca(true);
    showToast({ type: "info", title: "Carregando proposta", description: "Aguarde enquanto os dados da proposta são carregados..." });
    try {
      const [data, cobrancasDaProposta] = await Promise.all([
        getPropostaDetailById(alvo.id_int),
        listarCobrancasDaProposta(alvo.id_int)
      ]);
      if (!data) throw new Error("Proposta não encontrada.");
      if (!cobrancasDaProposta) {
        showToast({ type: "error", title: "Não foi possível conferir as cobranças", description: "As cobranças desta proposta não carregaram. Tente de novo em instantes." });
        return;
      }
      const cobrancasAtivas = cobrancasDaProposta.filter((c) => c.status !== "CANCELADO");
      const totalCobradoReal = cobrancasAtivas.reduce((total, c) => total + (c.cartao_valor_final ?? c.valor), 0);
      const saldoRestante = Math.round(data.resumo.valorTotal * 100) / 100 - Math.round(totalCobradoReal * 100) / 100;
      if (saldoRestante <= 0) {
        showToast({ type: "warning", title: "Ação bloqueada", description: "Esta proposta já foi totalmente cobrada (saldo restante é R$ 0,00)." });
        return;
      }
      setCobrancaProposta(data);
    } catch (err) {
      console.error("[useAcoesDaListaNaProposta] Erro ao carregar a proposta para a cobrança:", err);
      showToast({ type: "error", title: "Erro ao carregar proposta", description: err instanceof Error ? err.message : "Não foi possível carregar os detalhes." });
    } finally {
      setCarregandoCobranca(false);
    }
  }

  async function confirmarLiberarProducao() {
    if (!item) return;
    setLiberando(true);
    showToast({ type: "info", title: "Liberando para produção...", description: "Aguarde a validação das regras." });
    try {
      const res = await liberarPropostaParaProducaoPeloServidor(item.id_int);
      if (!res.success) throw new Error(res.errorMessage || "Erro desconhecido.");
      showToast({ type: "success", title: "Proposta liberada", description: "A proposta agora está na lista de Produção/Pedidos." });
      setLiberarAberto(false);
      concluir();
    } catch (err) {
      console.error("[useAcoesDaListaNaProposta] Erro ao liberar para produção:", err);
      showToast({ type: "error", title: "Erro de Validação", description: err instanceof Error ? err.message : "Não foi possível enviar para produção." });
    } finally {
      setLiberando(false);
    }
  }

  async function handleEncerrarTeste(alvo: OrcamentoListItem, encerrar: boolean) {
    if (encerrandoTeste) return;
    const ok = window.confirm(
      encerrar
        ? `Encerrar a proposta #${alvo.id_int} como pedido de TESTE?\n\n` +
            `Ela sai do painel de Producao, do Kanban, da fila de impressao e da Expedicao.\n` +
            `Continua nesta lista, com badge, e segue contando no faturamento.`
        : `Reabrir a proposta #${alvo.id_int}?\n\nEla volta a aparecer nas listas operacionais.`
    );
    if (!ok) return;
    setEncerrandoTeste(true);
    try {
      const res = encerrar ? await encerrarTeste(alvo.id_int) : await reabrirTeste(alvo.id_int);
      if (res.success) {
        showToast({
          type: "success",
          title: encerrar ? "Teste encerrado" : "Proposta reaberta",
          description: encerrar ? `#${alvo.id_int} saiu das listas operacionais.` : `#${alvo.id_int} voltou para as listas operacionais.`
        });
        concluir();
      } else {
        showToast({ type: "error", title: "Erro na marcacao", description: res.errorMessage || "Nao foi possivel concluir." });
      }
    } finally {
      setEncerrandoTeste(false);
    }
  }

  async function handleNotaAntecipada(alvo: OrcamentoListItem, liberar: boolean) {
    if (notaAntecipadaEmCurso) return;
    const ok = window.confirm(
      liberar
        ? `Liberar o pedido #${alvo.id_int} para nota antecipada?\n\n` +
            `Ele entra na Fila de Faturamento ainda em AGUARDANDO, antes do pagamento, e a NF-e sai pelo Faturar.\n` +
            `Status, produção e cobranças não mudam. Depois de emitida a nota, não dá para desfazer.`
        : `Desfazer a liberação de nota antecipada do pedido #${alvo.id_int}?\n\n` +
            `Ele sai da Fila de Faturamento. Só vale enquanto não houver NF-e de venda (nem rascunho).`
    );
    if (!ok) return;
    setNotaAntecipadaEmCurso(true);
    try {
      const res = liberar ? await liberarNotaAntecipada(alvo.id_int) : await desfazerNotaAntecipada(alvo.id_int);
      if (res.success) {
        showToast({ type: res.aviso ? "warning" : "success", title: res.message, description: res.aviso || undefined });
        concluir();
      } else {
        showToast({ type: "error", title: "Não foi possível concluir", description: res.message });
      }
    } finally {
      setNotaAntecipadaEmCurso(false);
    }
  }

  async function handleDesmarcarFaturadoFora(alvo: OrcamentoListItem) {
    if (desmarcandoFaturadoFora) return;
    const ok = window.confirm(
      `Voltar o pedido #${alvo.id_int} para a Fila de Faturamento?\n\n` +
        `Remove a marca de nota emitida no sistema antigo. O pedido volta a aparecer na fila quando estiver liberado para nota, e o Faturar deixa de recusá-lo.`
    );
    if (!ok) return;
    setDesmarcandoFaturadoFora(true);
    try {
      const res = await desmarcarFaturadoNoSistemaAntigo(alvo.id_int);
      if (res.success) {
        showToast({ type: "success", title: "Marca removida", description: `#${alvo.id_int}: marca de nota no sistema antigo removida.` });
        concluir();
      } else {
        showToast({ type: "error", title: "Erro ao desfazer", description: res.errorMessage || "Nao foi possivel concluir." });
      }
    } finally {
      setDesmarcandoFaturadoFora(false);
    }
  }

  async function confirmarMarcarEntregue() {
    if (!item || marcandoEntregue) return;
    const id = item.id_int;
    setMarcandoEntregue(true);
    try {
      const resposta = await marcarPedidoComoEntreguePeloServidor(id);
      if (!resposta.success) {
        showToast({ type: "error", title: "Não foi possível marcar como entregue", description: resposta.message });
      } else if (resposta.idempotente) {
        showToast({ type: "info", title: "Já estava entregue", description: resposta.message });
      } else if (resposta.aviso) {
        showToast({ type: "warning", title: `Proposta #${id} marcada como entregue, com aviso`, description: resposta.aviso });
      } else {
        showToast({ type: "success", title: "Pedido marcado como entregue", description: resposta.message });
      }
      // Em qualquer desfecho a tela relê, como a lista.
      setMarcarEntregueAberto(false);
      concluir();
    } finally {
      setMarcandoEntregue(false);
    }
  }

  // ── Itens do menu, nas condições da lista ────────────────────────────────

  const aposDuplicar: ActionMenuItem[] = [];
  const aposGerarOc: ActionMenuItem[] = [];
  const aposEnviarFila: ActionMenuItem[] = [];

  if (item) {
    const isClienteNaoCadastrado = !item.clienteId || item.clienteId === "0" || item.clienteId === "null";

    if (
      hasPermissao(user, "propostas.complementar") &&
      item.isAvulsoRaw !== true &&
      item.idIntPedidoPrincipal == null &&
      STATUS_ACEITAM_PEDIDO_COMPLEMENTAR.includes(String(item.statusInterno || "").trim().toUpperCase())
    ) {
      aposDuplicar.push({ label: "Criar Complemento", onClick: () => setComplementoAberto(true) });
    }

    if (item.notaEmitida?.urlDanfe) {
      const url = item.notaEmitida.urlDanfe;
      aposGerarOc.push({ label: "Abrir DANFE (PDF)", onClick: () => { abrirLinkDeDocumentoFiscal(url); } });
    }
    if (item.notaEmitida?.urlXml && item.notaEmitida.ref) {
      const ref = item.notaEmitida.ref;
      aposGerarOc.push({ label: "Baixar XML", onClick: () => { window.open(urlDownloadXmlNfe(ref), "_blank"); } });
    }
    if (!isClienteNaoCadastrado) {
      aposGerarOc.push({ label: "Gerar cobrança", onClick: () => void abrirGerarCobranca(item) });
    }
    if (canConfirmarConferenciaNaLista) {
      for (const naFila of item.cobrancasNaFila) {
        aposGerarOc.push({
          label: rotuloDaOpcaoDeConferencia(naFila, item.cobrancasNaFila.length),
          disabled: abrindoConferenciaId !== null,
          onClick: () => void abrirConferenciaDaCobranca(naFila.id)
        });
      }
    }
    if (canCancelarProposta && item.status !== "CANCELADO") {
      aposGerarOc.push({ label: "Cancelar proposta", destructive: true, onClick: () => setCancelarAberto(true) });
    }
    if (!item.is_prd_aprovado && item.isAvulsoRaw !== true && item.statusInterno === "REVISAO ATENDENTE" && canLiberarProducao) {
      aposGerarOc.push({ label: "Liberar para Produção", onClick: () => setLiberarAberto(true) });
    }
    if (item.is_prd_aprovado && item.isAvulsoRaw !== true) {
      aposGerarOc.push({ label: "✓ Liberada para produção", disabled: true });
    }

    if (rastreio?.ehCorreios && rastreio.codigo) {
      aposEnviarFila.push({ label: "Rastrear objeto", onClick: () => setRastreioAberto(true) });
    }
    if (rastreio?.ehConhecimento && rastreio.codigo) {
      aposEnviarFila.push({ label: "Ver conhecimento", onClick: () => setConhecimentoAberto(true) });
    }
    if (canEncerrarTeste) {
      aposEnviarFila.push(
        item.encerradoTesteEm
          ? { label: encerrandoTeste ? "Reabrindo..." : "Reabrir (desfazer encerramento de teste)", onClick: () => void handleEncerrarTeste(item, false) }
          : { label: encerrandoTeste ? "Encerrando teste..." : "Encerrar teste", destructive: true, onClick: () => void handleEncerrarTeste(item, true) }
      );
    }
    const estadoNota = { statusInterno: item.statusInterno, liberaNf: item.libera_nf, isPrdAprovado: item.is_prd_aprovado, faturadoForaEm: item.faturadoForaEm };
    if (podeVerLiberarNotaAntecipada(canDesmarcarFaturadoFora, estadoNota)) {
      aposEnviarFila.push({
        label: notaAntecipadaEmCurso ? "Liberando..." : "Liberar nota antecipada (Fila de Faturamento)",
        onClick: () => void handleNotaAntecipada(item, true)
      });
    }
    if (podeVerDesfazerNotaAntecipada(canDesmarcarFaturadoFora, estadoNota)) {
      aposEnviarFila.push({
        label: notaAntecipadaEmCurso ? "Desfazendo..." : "Desfazer nota antecipada",
        onClick: () => void handleNotaAntecipada(item, false)
      });
    }
    if (item.faturadoForaEm && canDesmarcarFaturadoFora) {
      aposEnviarFila.push({
        label: desmarcandoFaturadoFora ? "Voltando para a fila..." : "Voltar para a Fila de Faturamento (desfazer nota no sistema antigo)",
        onClick: () => void handleDesmarcarFaturadoFora(item)
      });
    }
    if (podeVerMarcarComoEntregue(user, item.statusInterno, { liberaNf: item.libera_nf, isPrdAprovado: item.is_prd_aprovado })) {
      aposEnviarFila.push({ label: "Marcar como entregue", destructive: true, onClick: () => setMarcarEntregueAberto(true) });
    }
  }

  // ── Modais: os mesmos da lista ───────────────────────────────────────────

  const modais = item ? (
    <>
      {complementoAberto && (
        <CriarComplementoModal isOpen idInt={item.id_int} onClose={() => setComplementoAberto(false)} />
      )}

      {cobrancaProposta && (
        <PortaoDaCargaCompleta onFechar={() => setCobrancaProposta(null)}>
          <PropostaCobrancaPanel
            proposta={cobrancaProposta}
            isModalOpen
            onOpenModal={() => {}}
            onCloseModal={() => {
              setCobrancaProposta(null);
              concluir();
            }}
            onlyModal
          />
        </PortaoDaCargaCompleta>
      )}

      {cobrancaParaConferir && (
        <PortaoDaCargaCompleta onFechar={() => setCobrancaParaConferir(null)}>
          <ConfirmarLiberacaoModal
            isOpen
            cobranca={cobrancaParaConferir}
            onClose={() => setCobrancaParaConferir(null)}
            onSuccess={() => concluir()}
          />
        </PortaoDaCargaCompleta>
      )}

      {cancelarAberto && (
        <PortaoDaCargaCompleta onFechar={() => setCancelarAberto(false)}>
          <CancelPropostaModal
            isOpen
            idInt={item.id_int}
            onClose={() => setCancelarAberto(false)}
            onSuccess={() => concluir()}
          />
        </PortaoDaCargaCompleta>
      )}

      <LiberarProducaoModal
        propostaId={item.id_int}
        isOpen={liberarAberto}
        isSubmitting={liberando}
        onClose={() => setLiberarAberto(false)}
        onConfirm={() => void confirmarLiberarProducao()}
      />

      {marcarEntregueAberto && (
        <MarcarEntregueModal
          isOpen
          propostaId={item.id_int}
          daFilaSemProducao={estaNaFilaSemProducao({ statusInterno: item.statusInterno, liberaNf: item.libera_nf, isPrdAprovado: item.is_prd_aprovado })}
          isSubmitting={marcandoEntregue}
          onClose={() => setMarcarEntregueAberto(false)}
          onConfirm={() => void confirmarMarcarEntregue()}
        />
      )}

      {conhecimentoAberto && rastreio?.codigo && (
        <VerConhecimentoModal idInt={item.id_int} numero={rastreio.codigo} onClose={() => setConhecimentoAberto(false)} />
      )}

      {rastreioAberto && rastreio?.codigo && (
        <RastreioPropostaModal idInt={item.id_int} codigo={rastreio.codigo} onClose={() => setRastreioAberto(false)} />
      )}
    </>
  ) : null;

  return { item, aposDuplicar, aposGerarOc, aposEnviarFila, modais };
}
