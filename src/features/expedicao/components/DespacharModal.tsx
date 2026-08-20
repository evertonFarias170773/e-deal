"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { getTransportadoras } from "@/features/nfe/services/nfe.service";
import { formatCurrency } from "@/lib/formatters/currency";
import { labelTipoFrete, modalidadeInicialDoDespacho } from "../lib/tipo-frete";
import { despachar, salvarDadosExpedicao } from "../services/expedicao-acoes.service";
import type { AtorExpedicao, DespachoInput } from "../services/expedicao-acoes.service";
import { listarEnderecosCliente } from "../services/enderecos.service";
import type { EnderecoCliente } from "../services/enderecos.service";
import { correiosStatus, gerarPrepostagem } from "../services/correios.client";
import { camposMinimosDespacho, frasearFaltantes } from "../lib/campos-minimos-despacho";
import { divergenciaFreteDoDespacho, formatarCep, frasearMotivos } from "../lib/divergencia-frete-despacho";
import { recotarFrete, aplicarRecotacao } from "../services/recotacao.client";
import type { RecotacaoResult, OpcaoRecotacao, AplicacaoRecotacao } from "../services/recotacao.client";
import { LABEL_MODALIDADE, MODALIDADES_OFERECIDAS, TRANSPORTES_POR_MODALIDADE } from "../types";
import type { ModalidadeFrete, PedidoExpedicao, TipoFreteNormalizado } from "../types";

const TIPOS_VOLUME = ["Pacote", "Caixa", "Envelope", "Outro"];

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const labelClass = "block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1";

type Transportadora = { id_cliente: number; nome: string | null; fantasia: string | null };

/**
 * "1.234,5" -> 1234.5 (vírgula decimal, pontos de milhar removidos); "12.4" ->
 * 12.4 (só ponto = decimal, não mexe). Compartilhada por handleConfirmar e
 * handleGerarPrepostagem para os dois lerem o peso do mesmo jeito.
 */
function parsePesoKg(valor: string): number | null {
  const trim = valor.trim();
  if (trim === "") return null;
  const normalizado = trim.includes(",") ? trim.replace(/\./g, "").replace(",", ".") : trim;
  return Number(normalizado);
}

function parseQtdVolumes(valor: string): number | null {
  const trim = valor.trim();
  return trim === "" ? null : Math.trunc(Number(trim));
}

/**
 * Default do endereço de entrega quando não há um já salvo (spec §4.6): (1) o
 * que casa com o CEP da cotação escolhida; (2) senão o marcado como endereço
 * de entrega (tipo_endereco contendo "ENTREG"); (3) senão, o mais recente da
 * lista (que já cobre o caso de sobrar um único cadastro).
 */
/**
 * Transporte com que o formulário abre. `SEM_CUSTO`, `INDEFINIDO` e
 * `RETIRA_BALCAO` não são opções do passo 2 (os dois primeiros são leitura de
 * cotação legada; o último vem da modalidade), então o form abre em
 * TRANSPORTADORA e o expedidor confirma o que de fato vai acontecer.
 */
function transporteInicial(tipo: TipoFreteNormalizado): TipoFreteNormalizado {
  return tipo === "CORREIOS" || tipo === "MOTOBOY" || tipo === "TRANSPORTADORA" ? tipo : "TRANSPORTADORA";
}

function escolherEnderecoDefault(lista: EnderecoCliente[], freteCep: string | null): EnderecoCliente | null {
  if (lista.length === 0) return null;
  const cepAlvo = freteCep ? freteCep.replace(/\D/g, "") : "";
  const porCep = cepAlvo ? lista.find((e) => (e.cep ?? "").replace(/\D/g, "") === cepAlvo) : undefined;
  if (porCep) return porCep;
  const porTipoEntrega = lista.find((e) => (e.tipo ?? "").toUpperCase().includes("ENTREG"));
  if (porTipoEntrega) return porTipoEntrega;
  return lista[0];
}

export function DespacharModal({
  pedido,
  modoEdicao,
  ator,
  onClose,
  onDone
}: {
  pedido: PedidoExpedicao;
  modoEdicao: boolean;
  ator: AtorExpedicao;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useAppToast();
  const exp = pedido.expedicao;

  const tipoInicial: TipoFreteNormalizado = exp?.tipoFrete ?? pedido.tipoFrete;

  /**
   * Modalidade (quem paga) é a escolha do PASSO 1 e comanda o resto do modal.
   *
   * A precedência vive em `lib/tipo-frete.ts` (`modalidadeInicialDoDespacho`),
   * com o raciocínio inteiro documentado lá: despacho > cotação de balcão >
   * orçamento > nada, com FOB imune ao degrau da cotação. Aqui fica só a
   * chamada — a regra é testada fora da tela.
   *
   * Discordar da sugestão continua livre e não altera a proposta; a divergência
   * aparece no aviso abaixo e informa, não trava.
   */
  const [modalidade, setModalidade] = useState<ModalidadeFrete | null>(
    modalidadeInicialDoDespacho(exp?.modalidadeFrete, pedido.modalidadeOrcamento, tipoInicial)
  );
  const [tipoFrete, setTipoFrete] = useState<TipoFreteNormalizado>(transporteInicial(tipoInicial));
  const [transportadoraNome, setTransportadoraNome] = useState(
    exp?.transportadoraNome ?? (pedido.tipoFrete === "INDEFINIDO" ? "" : pedido.transportadoraNome)
  );
  /** Mesma precedência da modalidade: despacho > orçamento > nada. */
  const [idTransportadoraCliente, setIdTransportadoraCliente] = useState<number | null>(
    exp?.idTransportadoraCliente ?? pedido.idTransportadoraOrcamento ?? null
  );
  const [pesoKg, setPesoKg] = useState(exp?.pesoKg?.toString() ?? pedido.pesoKg?.toFixed(2) ?? "");
  const [qtdVolumes, setQtdVolumes] = useState(exp?.qtdVolumes?.toString() ?? pedido.volumes?.toString() ?? "1");
  const [tipoVolume, setTipoVolume] = useState(exp?.tipoVolume ?? "Pacote");
  const [codigoRastreamento, setCodigoRastreamento] = useState(pedido.codigoRastreamento);
  const [obs, setObs] = useState(exp?.obs ?? "");
  const [idEnderecoEntrega, setIdEnderecoEntrega] = useState<string | null>(exp?.idEnderecoEntrega ?? null);

  const [enderecos, setEnderecos] = useState<EnderecoCliente[]>([]);
  const [transportadoras, setTransportadoras] = useState<Transportadora[]>([]);
  const [confirmaSemNf, setConfirmaSemNf] = useState(false);
  const [confirmaTrocaCorreios, setConfirmaTrocaCorreios] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [correiosOk, setCorreiosOk] = useState(false);
  const [gerandoPrepostagem, setGerandoPrepostagem] = useState(false);

  /**
   * Recotação (Parte C, Etapa 1) — SÓ CONSULTA. Nada é gravado por este bloco:
   * nem o valor do frete, nem a proposta, nem a Conta Corrente. Serve para o
   * expedidor ver o número real antes de trocar transportadora ou endereço.
   */
  const [recotando, setRecotando] = useState(false);
  const [recotacao, setRecotacao] = useState<RecotacaoResult | null>(null);
  const [erroRecotacao, setErroRecotacao] = useState<string | null>(null);

  /**
   * Aplicacao (Parte C, Etapa 2) — ESTA grava: `propostas.valor_frete`, o
   * `valor_total` movido pelo delta do frete, e uma linha no ledger
   * `expedicao_recotacoes`. Continua sem tocar `cotacao_frete` e sem lancar
   * nada na Conta Corrente.
   *
   * `chavesPorOpcao` e a idempotencia: uma uuid POR OPCAO, gerada quando o
   * resultado da cotacao chega — nunca no clique. Clicar duas vezes manda a
   * mesma chave, e quem recusa a segunda e o unique do banco, nao o estado
   * desta tela (que ja falhou nesse papel quatro vezes neste projeto).
   */
  const [aplicandoId, setAplicandoId] = useState<string | null>(null);
  const [aplicacao, setAplicacao] = useState<AplicacaoRecotacao | null>(null);
  const [erroAplicacao, setErroAplicacao] = useState<string | null>(null);
  const [chavesPorOpcao, setChavesPorOpcao] = useState<Record<string, string>>({});

  /**
   * O botão só aparece no despacho de um pedido CIF. `modalidade` já nasce da
   * precedência despacho > cotação de balcão > orçamento (ver
   * `modalidadeInicialDoDespacho`), então um modal recém-aberto obedece
   * exatamente a regra do banco — e marcar CIF agora também libera, o que é o
   * momento em que o expedidor mais precisa do número. A rota revalida o gate
   * contra o banco de qualquer forma.
   */
  const podeRecotar = pedido.statusInterno === "EXPEDICAO" && modalidade === "CIF";

  /**
   * Desde 20/08/2026 o expedidor NAO recota por conta propria: um admin libera
   * caso a caso pelo menu Acoes da Expedicao. A liberacao vem carregada com a
   * lista (`PedidoExpedicao.liberacaoRecotacao`), nao por fetch daqui — assim o
   * menu e este modal leem a mesma fonte e nunca se contradizem.
   *
   * O bloco continua VISIVEL sem liberacao, com o botao desabilitado e o motivo
   * escrito: o expedidor precisa saber que a funcao existe e de quem depende,
   * nao concluir que ela sumiu.
   */
  const liberacao = pedido.liberacaoRecotacao;
  const recotacaoLiberada = Boolean(liberacao);

  /** Resultado velho ao lado de destino novo é pior que resultado nenhum. */
  function limparRecotacao() {
    setRecotacao(null);
    setErroRecotacao(null);
    setAplicacao(null);
    setErroAplicacao(null);
    setChavesPorOpcao({});
  }

  async function handleRecotar() {
    if (recotando) return;
    setRecotando(true);
    setErroRecotacao(null);
    setAplicacao(null);
    setErroAplicacao(null);
    const res = await recotarFrete(pedido.idInt, idEnderecoEntrega);
    setRecotando(false);
    if (res.success) {
      setRecotacao(res);
      // Uma chave por opcao, AGORA — nao no clique.
      const chaves: Record<string, string> = {};
      for (const o of res.opcoes ?? []) chaves[o.id] = crypto.randomUUID();
      setChavesPorOpcao(chaves);
    } else {
      setRecotacao(null);
      setChavesPorOpcao({});
      setErroRecotacao(res.errorMessage || "Não foi possível recotar agora.");
    }
  }

  /**
   * Com NF-e autorizada so entra o que BARATEIA: empatar nao justifica mexer no
   * valor de um pedido que ja tem nota. Encarecer depende da alcada e fica para
   * a etapa seguinte. A rota e a RPC repetem os dois gates contra o banco.
   */
  function podeAplicar(o: OpcaoRecotacao): boolean {
    if (o.diferenca > 0) return false;
    if (pedido.nfStatus === "AUTORIZADA" && o.diferenca >= 0) return false;
    return true;
  }

  function motivoBloqueio(o: OpcaoRecotacao): string {
    if (o.diferenca > 0) return "Encarece: depende da alçada, ainda não liberado.";
    return "Com NF-e autorizada, só o que barateia.";
  }

  async function handleAplicar(o: OpcaoRecotacao) {
    if (aplicandoId) return;
    const chave = chavesPorOpcao[o.id];
    if (!chave) {
      setErroAplicacao("Recote antes de aplicar.");
      return;
    }
    setAplicandoId(o.id);
    setErroAplicacao(null);
    const res = await aplicarRecotacao({
      idInt: pedido.idInt,
      chave,
      opcaoId: o.id,
      valorVisto: o.valor,
      idEnderecoEntrega
    });
    setAplicandoId(null);
    if (res.success) setAplicacao(res);
    else setErroAplicacao(res.errorMessage || "Não foi possível aplicar agora.");
  }

  /**
   * O service continua decidindo o status destino por `tipoEntrega`
   * (RETIRADA → "A RETIRAR", TRANSPORTE → "EM TRANSITO"). Ele agora é derivado
   * da modalidade, em vez de ser um toggle próprio.
   */
  const tipoEntrega: "TRANSPORTE" | "RETIRADA" = modalidade === "RETIRA" ? "RETIRADA" : "TRANSPORTE";

  /**
   * O que ainda falta para despachar. O botao passa a olhar isto, e nao so o
   * `salvando` — ate 20/08/2026 dava para confirmar sem definir nada, porque a
   * unica guarda de campo obrigatorio era a modalidade, e ela parou de barrar
   * quando CIF virou o padrao das propostas novas.
   *
   * Em modo edicao a lista e sempre vazia de proposito: o pedido ja saiu, e
   * exigir campo agora impediria corrigir o que existe.
   */
  const faltantes = useMemo(
    () =>
      camposMinimosDespacho(
        {
          tipoEntrega,
          modalidadeFrete: modalidade,
          transportadoraNome,
          idTransportadoraCliente,
          qtdVolumes: parseQtdVolumes(qtdVolumes),
          idEnderecoEntrega
        },
        modoEdicao ? "EDICAO" : "DESPACHO"
      ),
    [tipoEntrega, modalidade, transportadoraNome, idTransportadoraCliente, qtdVolumes, idEnderecoEntrega, modoEdicao]
  );

  /**
   * O envio que esta na tela ainda corresponde ao frete que a proposta cobra?
   * Recalculado a cada mudanca de peso ou de endereco. INFORMA, nao bloqueia —
   * mesma regra da falta de NF-e.
   */
  const cepDoEnderecoEscolhido = useMemo(
    () => enderecos.find((e) => e.id === idEnderecoEntrega)?.cep ?? pedido.freteCep ?? null,
    [enderecos, idEnderecoEntrega, pedido.freteCep]
  );

  /**
   * A "cotacao vigente" e a ULTIMA recotacao aplicada, quando houver — nao a
   * `cotacao_frete`, que e imutavel para a Expedicao e nao muda quando uma
   * recotacao e aplicada. `aplicacao` cobre o caso da MESMA sessao: aplicar
   * limpa o bloqueio na hora, sem reabrir o modal; `pedido.recotacaoVigente`
   * cobre a reabertura, vindo carregado com a lista.
   */
  const cotacaoVigente = useMemo(() => {
    const daSessao =
      aplicacao?.success && aplicacao.pesoGramas !== undefined
        ? { pesoGramas: aplicacao.pesoGramas ?? null, cep: aplicacao.cep ?? null }
        : null;
    const referencia = daSessao ?? pedido.recotacaoVigente;
    return {
      pesoGramas: referencia ? referencia.pesoGramas : pedido.pesoCotadoGramas,
      cep: referencia ? referencia.cep : pedido.freteCep,
      valor: aplicacao?.success ? aplicacao.freteNovo ?? pedido.freteValor : pedido.freteValor,
      servico: pedido.freteServico,
      existe: pedido.freteValor !== null
    };
  }, [aplicacao, pedido.recotacaoVigente, pedido.pesoCotadoGramas, pedido.freteCep, pedido.freteValor, pedido.freteServico]);

  const divergencia = useMemo(() => {
    const pesoNum = parsePesoKg(pesoKg);
    return divergenciaFreteDoDespacho({
      cotacao: cotacaoVigente,
      pesoAferidoGramas: pesoNum !== null ? Math.round(pesoNum * 1000) : null,
      cepDestino: cepDoEnderecoEscolhido,
      modalidadeEfetiva: modalidade,
      tipoFreteEscolhido: tipoFrete,
      tipoFreteJaDespachado: exp?.tipoFrete ?? null
    });
  }, [pesoKg, cepDoEnderecoEscolhido, cotacaoVigente, modalidade, tipoFrete, exp?.tipoFrete]);


  /**
   * Pedido cujo envio JÁ existe nos Correios. Marcar FOB nele significaria
   * rebaixar o transporte para TRANSPORTADORA e perder a informação de que a
   * encomenda foi postada pelos Correios — por isso a troca nunca acontece
   * sozinha: exige a confirmação explícita do bloco de aviso abaixo. A
   * prepostagem, o código de objeto e o rastreio NÃO são apagados em nenhum
   * caso; só o rótulo do transporte muda.
   */
  const gravadoComoCorreios = tipoInicial === "CORREIOS";
  const prepostagemCorreios = exp?.correiosCodigoObjeto ?? exp?.correiosIdPrepostagem ?? null;
  const trocaCorreiosPendente = gravadoComoCorreios && modalidade === "FOB" && !confirmaTrocaCorreios;

  const precisaAvisoNf = !modoEdicao && pedido.nfStatus !== "AUTORIZADA";

  /**
   * Divergência entre o que o vendedor declarou no orçamento e o que o expedidor
   * está escolhendo agora. Aparece na tela, nomeando o que veio do orçamento —
   * mas NÃO bloqueia e NÃO reescreve `propostas`: quem despacha sabe o que
   * saiu pela porta, e a proposta continua sendo o registro comercial.
   */
  const nomeTransportadoraOrcamento = useMemo(() => {
    if (pedido.idTransportadoraOrcamento === null) return null;
    const t = transportadoras.find((x) => x.id_cliente === pedido.idTransportadoraOrcamento);
    return t ? t.fantasia || t.nome || `#${t.id_cliente}` : `#${pedido.idTransportadoraOrcamento}`;
  }, [pedido.idTransportadoraOrcamento, transportadoras]);

  const modalidadeDivergente =
    pedido.modalidadeOrcamento !== null && modalidade !== null && modalidade !== pedido.modalidadeOrcamento;
  const transportadoraDivergente =
    pedido.idTransportadoraOrcamento !== null &&
    idTransportadoraCliente !== null &&
    idTransportadoraCliente !== pedido.idTransportadoraOrcamento;

  useEffect(() => {
    let ativo = true;
    if (pedido.idCliente !== null) {
      void listarEnderecosCliente(pedido.idCliente).then((lista) => {
        if (!ativo) return;
        setEnderecos(lista);
        // Default (só quando não há endereço já salvo — spec §4.6): CEP da
        // cotação > tipo de entrega > único/mais recente.
        if (!idEnderecoEntrega && lista.length > 0) {
          const escolhido = escolherEnderecoDefault(lista, pedido.freteCep);
          if (escolhido) setIdEnderecoEntrega(escolhido.id);
        }
      });
    }
    void getTransportadoras().then((lista) => {
      if (!ativo) return;
      const transps = lista as Transportadora[];
      setTransportadoras(transps);
      // Transportadora veio pré-selecionada do orçamento e o despacho ainda não
      // tem nome próprio gravado: resolve o nome pelo cadastro, senão o campo
      // ficaria mostrando o texto da cotação, que pode dizer outra coisa.
      if (!exp?.transportadoraNome && idTransportadoraCliente !== null) {
        const t = transps.find((x) => x.id_cliente === idTransportadoraCliente);
        if (t) setTransportadoraNome(t.fantasia || t.nome || `#${t.id_cliente}`);
      }
    });
    void correiosStatus().then((s) => {
      if (ativo) setCorreiosOk(s.configurado);
    });
    return () => {
      ativo = false;
    };
    // Roda só quando o cliente muda: idEnderecoEntrega e pedido.freteCep são
    // lidos apenas para decidir o default (linha acima) — incluí-los nas deps
    // reexecutaria o efeito a cada seleção de endereço, refazendo as buscas à toa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido.idCliente]);

  const nomeExibicao = useMemo(
    () => (t: Transportadora) => t.fantasia || t.nome || `#${t.id_cliente}`,
    []
  );

  async function handleConfirmar() {
    if (salvando) return;
    if (modalidade === null) {
      showToast({
        type: "warning",
        title: "Escolha a modalidade do frete",
        description: "Diga quem paga o transporte: Retira, FOB ou CIF."
      });
      return;
    }
    if (trocaCorreiosPendente) {
      showToast({
        type: "warning",
        title: "Confirme a troca do transporte",
        description: "Este envio está gravado como Correios. Marque a confirmação para trocá-lo por transportadora."
      });
      return;
    }
    if (precisaAvisoNf && !confirmaSemNf) {
      showToast({ type: "warning", title: "Confirme o despacho sem NF", description: "Marque a caixa de confirmação para despachar sem nota autorizada." });
      return;
    }
    if (faltantes.length > 0) {
      showToast({
        type: "warning",
        title: "Faltam dados para despachar",
        description: `Informe ${frasearFaltantes(faltantes)}.`
      });
      return;
    }
    if (divergencia.bloqueia) {
      showToast({
        type: "warning",
        title: "Despacho bloqueado",
        description: `Recote o frete antes de despachar: ${frasearMotivos(divergencia.motivos)}.`
      });
      return;
    }
    const pesoNum = parsePesoKg(pesoKg);
    if (pesoNum !== null && (!Number.isFinite(pesoNum) || pesoNum <= 0)) {
      showToast({ type: "error", title: "Peso inválido", description: "Informe o peso em kg (ex.: 12,4) ou deixe vazio." });
      return;
    }
    const volNum = parseQtdVolumes(qtdVolumes);
    if (volNum !== null && (!Number.isFinite(volNum) || volNum <= 0 || volNum > 50)) {
      showToast({ type: "error", title: "Volumes inválidos", description: "Quantidade de volumes deve ser entre 1 e 50." });
      return;
    }

    const input: DespachoInput = {
      tipoEntrega,
      modalidadeFrete: modalidade,
      tipoFrete: tipoEntrega === "RETIRADA" ? "RETIRA_BALCAO" : tipoFrete,
      transportadoraNome: tipoEntrega === "RETIRADA" ? "Retira balcão" : transportadoraNome.trim(),
      idTransportadoraCliente: tipoEntrega === "RETIRADA" ? null : idTransportadoraCliente,
      pesoKg: pesoNum,
      qtdVolumes: volNum,
      tipoVolume,
      idEnderecoEntrega,
      codigoRastreamento: codigoRastreamento.trim(),
      obs: obs.trim()
    };

    setSalvando(true);
    const res = modoEdicao
      ? await salvarDadosExpedicao(pedido.idInt, input)
      : await despachar(pedido.idInt, input, ator);
    setSalvando(false);

    if (res.success) {
      showToast({
        type: "success",
        title: modoEdicao ? "Dados de expedição salvos" : tipoEntrega === "RETIRADA" ? "Pedido aguardando retirada" : "Pedido despachado",
        description: `#${pedido.idInt} · ${pedido.cliente}`
      });
      onDone();
    } else {
      showToast({ type: "error", title: "Não foi possível salvar", description: res.error });
    }
  }

  /**
   * A rota de prepostagem lê endereço/peso PERSISTIDOS em expedicoes — num
   * despacho novo a linha nem existe ainda, e mesmo editando, o que está só na
   * tela (não salvo) seria ignorado. Por isso salva o form ANTES de gerar, com
   * a mesma normalização de peso/volumes do handleConfirmar, e só chama os
   * Correios se o salvamento confirmar sucesso — o servidor sempre lê
   * exatamente o que está na tela.
   */
  async function handleGerarPrepostagem(servico: "SEDEX" | "PAC") {
    if (gerandoPrepostagem) return;
    const pesoNum = parsePesoKg(pesoKg);
    if (pesoNum !== null && (!Number.isFinite(pesoNum) || pesoNum <= 0)) {
      showToast({ type: "error", title: "Peso inválido", description: "Informe o peso em kg (ex.: 12,4) ou deixe vazio." });
      return;
    }
    const volNum = parseQtdVolumes(qtdVolumes);
    if (volNum !== null && (!Number.isFinite(volNum) || volNum <= 0 || volNum > 50)) {
      showToast({ type: "error", title: "Volumes inválidos", description: "Quantidade de volumes deve ser entre 1 e 50." });
      return;
    }

    setGerandoPrepostagem(true);
    const salvo = await salvarDadosExpedicao(pedido.idInt, {
      modalidadeFrete: modalidade,
      tipoFrete,
      transportadoraNome: transportadoraNome.trim(),
      idTransportadoraCliente,
      pesoKg: pesoNum,
      qtdVolumes: volNum,
      tipoVolume,
      idEnderecoEntrega,
      codigoRastreamento: codigoRastreamento.trim(),
      obs: obs.trim()
    });
    if (!salvo.success) {
      setGerandoPrepostagem(false);
      showToast({ type: "error", title: "Não foi possível salvar antes de gerar", description: salvo.error });
      return;
    }

    const res = await gerarPrepostagem(pedido.idInt, servico);
    setGerandoPrepostagem(false);
    if (res.success && res.codigoObjeto) {
      setCodigoRastreamento(res.codigoObjeto);
      showToast({ type: "success", title: "Prepostagem criada", description: `Rastreio ${res.codigoObjeto} preenchido.` });
    } else {
      showToast({ type: "error", title: "Correios recusaram a prepostagem", description: res.errorMessage });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
            {modoEdicao ? "Editar dados de expedição" : "Despachar pedido"} #{pedido.idInt}
          </h2>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {pedido.cliente}
            {pedido.cidadeUf ? ` · ${pedido.cidadeUf}` : ""} · frete cotado: {pedido.freteServico || "—"}
          </p>

          {/* PASSO 1 — Modalidade: quem paga o transporte. Comanda o resto do
              modal e é editável também em modo edição, porque é informação nova:
              pedido despachado antes de 18/08/2026 não tem modalidade e precisa
              poder ganhar uma. */}
          <div>
            <span className={labelClass}>Modalidade do frete</span>
            <div className="flex flex-col gap-2 sm:flex-row">
              {MODALIDADES_OFERECIDAS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setModalidade(m);
                    // Sair do FOB desfaz exatamente o que a confirmação fez:
                    // devolve o transporte gravado e volta a exigir confirmação.
                    if (m !== "FOB" && confirmaTrocaCorreios) {
                      setConfirmaTrocaCorreios(false);
                      setTipoFrete("CORREIOS");
                    }
                  }}
                  className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
                    modalidade === m
                      ? "border-[#0b2f4a] bg-[#0b2f4a] text-white"
                      : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  }`}
                >
                  {LABEL_MODALIDADE[m]}
                </button>
              ))}
            </div>
            {modalidade === null && (
              <p className="mt-1.5 text-xs text-slate-500">
                Escolha a modalidade para liberar as opções de transportadora.
              </p>
            )}
            {modalidade === "CIF" && (
              <p className="mt-1.5 text-xs text-slate-500">
                CIF aqui é só o registro de quem paga: não cota, não altera o valor da proposta e não lança nada na Conta Corrente.
              </p>
            )}
            {pedido.modalidadeOrcamento !== null && !modalidadeDivergente && (
              <p className="mt-1.5 text-xs text-slate-500">
                Veio do orçamento: {LABEL_MODALIDADE[pedido.modalidadeOrcamento]}
                {nomeTransportadoraOrcamento ? ` · ${nomeTransportadoraOrcamento}` : ""}.
              </p>
            )}
          </div>

          {/* Divergência com o orçamento: informa, não trava. A proposta não é
              reescrita — o despacho tem a palavra final sobre o que saiu. */}
          {(modalidadeDivergente || transportadoraDivergente) && (
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
              <p className="font-bold">Diferente do que o orçamento declarou</p>
              <ul className="mt-1.5 space-y-0.5">
                {modalidadeDivergente && pedido.modalidadeOrcamento !== null && (
                  <li>
                    Modalidade: orçamento <strong>{LABEL_MODALIDADE[pedido.modalidadeOrcamento]}</strong> · despacho{" "}
                    <strong>{modalidade !== null ? LABEL_MODALIDADE[modalidade] : "—"}</strong>
                  </li>
                )}
                {transportadoraDivergente && (
                  <li>
                    Transportadora: orçamento <strong>{nomeTransportadoraOrcamento}</strong> · despacho{" "}
                    <strong>{transportadoraNome || "—"}</strong>
                  </li>
                )}
              </ul>
              <p className="mt-1.5 text-xs">
                Vale o que você declarar aqui. O orçamento não é alterado — a diferença fica registrada nas duas pontas.
              </p>
            </div>
          )}

          {/* Guarda do envio já existente nos Correios: nada é trocado sem o
              expedidor dizer que quer. */}
          {trocaCorreiosPendente && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <p className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4" />
                {prepostagemCorreios
                  ? `Este envio já tem prepostagem dos Correios (${prepostagemCorreios}).`
                  : "Este pedido está definido para ir pelos Correios."}
              </p>
              <p className="mt-1.5">
                Em FOB não existe envio pelos Correios — a postagem sai pelo cartão da empresa. Confirmar troca o
                transporte para transportadora.
                {prepostagemCorreios
                  ? " A prepostagem, o código de rastreio e a etiqueta oficial continuam gravados."
                  : ""}{" "}
                Se o envio realmente vai pelos Correios, escolha CIF.
              </p>
              <label className="mt-2 flex items-center gap-2 font-semibold">
                <input
                  type="checkbox"
                  checked={confirmaTrocaCorreios}
                  onChange={(e) => {
                    setConfirmaTrocaCorreios(e.target.checked);
                    if (e.target.checked) setTipoFrete("TRANSPORTADORA");
                  }}
                  className="h-4 w-4"
                />
                Confirmo: este pedido deixa de ir pelos Correios.
              </label>
            </div>
          )}

          {/* PASSO 2 em diante — modalidades de envio (FOB e CIF). Retira não
              tem transporte a definir, e o FOB pendente de confirmação fica
              fechado até o expedidor resolver a troca acima. */}
          {(modalidade === "FOB" || modalidade === "CIF") && !trocaCorreiosPendente && (
            <>
              <div>
                <label className={labelClass}>Como vai</label>
                <select value={tipoFrete} onChange={(e) => setTipoFrete(e.target.value as TipoFreteNormalizado)} className={inputClass}>
                  {TRANSPORTES_POR_MODALIDADE[modalidade].map((t) => (
                    <option key={t} value={t}>{labelTipoFrete(t)}</option>
                  ))}
                </select>
                {modalidade === "FOB" && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Correios não entra em FOB: a prepostagem sai pelo cartão de postagem da empresa. Para enviar pelos
                    Correios, marque CIF.
                  </p>
                )}
              </div>

              {/* PASSO 3 — transportadora só depois de definir como vai. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Transportadora cadastrada</label>
                  <select
                    value={idTransportadoraCliente ?? ""}
                    onChange={(e) => {
                      const id = e.target.value === "" ? null : Number(e.target.value);
                      setIdTransportadoraCliente(id);
                      limparRecotacao();
                      const t = transportadoras.find((x) => x.id_cliente === id);
                      if (t) setTransportadoraNome(nomeExibicao(t));
                    }}
                    className={inputClass}
                  >
                    <option value="">— sem vínculo / digitar nome —</option>
                    {transportadoras.map((t) => (
                      <option key={t.id_cliente} value={t.id_cliente}>{nomeExibicao(t)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Nome da transportadora / serviço</label>
                  <input value={transportadoraNome} onChange={(e) => setTransportadoraNome(e.target.value)} placeholder='Ex.: "Expresso São Miguel"' className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Endereço de entrega (vai para a etiqueta)</label>
                <select
                  value={idEnderecoEntrega ?? ""}
                  onChange={(e) => {
                    setIdEnderecoEntrega(e.target.value === "" ? null : e.target.value);
                    limparRecotacao();
                  }}
                  className={inputClass}
                >
                  <option value="">— não informar —</option>
                  {enderecos.map((e) => (
                    <option key={e.id} value={e.id}>{e.rotulo}</option>
                  ))}
                </select>
              </div>

              {/* Recotação — SÓ CONSULTA. Fica embaixo do endereço porque é dele
                  que o resultado depende. Nada aqui grava nada. */}
              {podeRecotar && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        Recotar frete {!recotacaoLiberada && <span title="Depende de liberação">🔒</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        Cota de novo com o endereço e o peso deste pedido. Frete atual da proposta:{" "}
                        <strong>{formatCurrency(pedido.freteValor ?? 0)}</strong>.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleRecotar}
                      disabled={recotando || !recotacaoLiberada}
                      className="rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {recotando ? "Cotando..." : recotacaoLiberada ? "Recotar frete" : "Bloqueado"}
                    </button>
                  </div>

                  {recotacaoLiberada ? (
                    <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
                      🔓 Liberado{liberacao?.liberadoPorNome ? ` por ${liberacao.liberadoPorNome}` : ""} em{" "}
                      {new Date(liberacao!.liberadoEm).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                      {" — vale para UMA aplicação."}
                    </p>
                  ) : (
                    <p className="mt-2 rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-600">
                      A recotação deste pedido depende de liberação de um administrador. Peça a liberação no menu
                      <strong> Ações</strong> da lista de Expedição.
                    </p>
                  )}

                  {erroRecotacao && (
                    <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs font-medium text-amber-900">
                      {erroRecotacao}
                    </p>
                  )}

                  {recotacao?.success && (
                    <div className="mt-3 space-y-2">
                      <p className="text-xs text-slate-500">
                        Peso usado: <strong>{((recotacao.pesoGramas ?? 0) / 1000).toFixed(2)} kg</strong>
                        {recotacao.pesoOrigem ? ` (${recotacao.pesoOrigem})` : ""} · Destino:{" "}
                        {recotacao.endereco ? `${recotacao.endereco.cidade}/${recotacao.endereco.uf}` : "—"}
                      </p>

                      {(recotacao.opcoes ?? []).map((o) => (
                        <div
                          key={o.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="text-xs">
                            <strong className="text-slate-800">{o.transportadora}</strong>
                            {o.servico ? <span className="text-slate-500"> · {o.servico}</span> : null}
                            <span className="text-slate-400"> · {o.prazo}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-slate-900">{formatCurrency(o.valor)}</span>
                            <span
                              className={
                                o.diferenca < 0
                                  ? "font-semibold text-emerald-700"
                                  : o.diferenca > 0
                                    ? "font-semibold text-amber-700"
                                    : "text-slate-400"
                              }
                            >
                              {o.diferenca === 0
                                ? "sem diferença"
                                : `${o.diferenca > 0 ? "+" : "−"}${formatCurrency(Math.abs(o.diferenca))}`}
                            </span>
                            {!o.dentroDaAlcada && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                                acima da alçada
                              </span>
                            )}
                            {podeAplicar(o) ? (
                              <button
                                type="button"
                                onClick={() => handleAplicar(o)}
                                disabled={Boolean(aplicandoId) || Boolean(aplicacao)}
                                className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                              >
                                {aplicandoId === o.id ? "Aplicando..." : "Aplicar"}
                              </button>
                            ) : (
                              <span
                                title={motivoBloqueio(o)}
                                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-400"
                              >
                                Aplicar
                              </span>
                            )}
                          </div>
                        </div>
                      ))}

                      {(recotacao.avisos ?? []).map((aviso, i) => (
                        <p key={i} className="text-xs italic text-slate-500">{aviso}</p>
                      ))}

                      {erroAplicacao && (
                        <p className="rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs font-medium text-rose-900">
                          {erroAplicacao}
                        </p>
                      )}

                      {aplicacao?.success ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                          <p className="font-semibold">
                            Frete atualizado{aplicacao.idempotente ? " (já estava aplicado)" : ""}
                          </p>
                          <p className="mt-1">
                            {aplicacao.transportadora}
                            {aplicacao.servico ? ` · ${aplicacao.servico}` : ""} —{" "}
                            {formatCurrency(aplicacao.freteAnterior ?? 0)} → <strong>{formatCurrency(aplicacao.freteNovo ?? 0)}</strong>{" "}
                            ({(aplicacao.diferenca ?? 0) < 0 ? "−" : ""}
                            {formatCurrency(Math.abs(aplicacao.diferenca ?? 0))})
                          </p>
                          <p>
                            Total do pedido: {formatCurrency(aplicacao.totalAnterior ?? 0)} →{" "}
                            <strong>{formatCurrency(aplicacao.totalNovo ?? 0)}</strong>
                          </p>
                          <p className="mt-2 font-semibold">
                            A diferença de {formatCurrency(Math.abs(aplicacao.diferenca ?? 0))} ainda NÃO foi lançada na
                            conta do cliente. Registrado na timeline do pedido.
                          </p>
                          <p className="mt-1">
                            A liberação foi consumida. Uma nova recotação deste pedido depende de nova liberação.
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs font-semibold text-slate-500">
                          Aplicar grava o frete novo na proposta e move o total pelo mesmo valor. A diferença NÃO vai
                          para a conta do cliente nesta fase.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className={labelClass}>Código de rastreio (manual)</label>
                <input value={codigoRastreamento} onChange={(e) => setCodigoRastreamento(e.target.value)} placeholder="Ex.: AD173823345BR — ou gere pelos Correios na Fase 4" className={inputClass} />
              </div>
              {/* Prepostagem é sempre CIF: sai pelo cartão de postagem da
                  empresa. A modalidade entra na condição de propósito, para um
                  pedido legado marcado FOB nunca reabrir o botão. */}
              {modalidade === "CIF" && tipoFrete === "CORREIOS" && correiosOk && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={gerandoPrepostagem}
                    onClick={() => void handleGerarPrepostagem("SEDEX")}
                    className="rounded-2xl bg-[#0f9f9a] px-4 py-2 text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                  >
                    {gerandoPrepostagem ? "Gerando..." : "Gerar prepostagem SEDEX"}
                  </button>
                  <button
                    type="button"
                    disabled={gerandoPrepostagem}
                    onClick={() => void handleGerarPrepostagem("PAC")}
                    className="rounded-2xl border border-[#0f9f9a] px-4 py-2 text-xs font-bold text-[#0f9f9a] transition hover:bg-teal-50 disabled:opacity-50"
                  >
                    PAC
                  </button>
                </div>
              )}
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass}>Peso aferido (kg)</label>
              <input value={pesoKg} onChange={(e) => setPesoKg(e.target.value)} inputMode="decimal" placeholder={pedido.pesoKg ? `previsto ${pedido.pesoKg.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "ex.: 12,4"} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Qtd. volumes</label>
              <input value={qtdVolumes} onChange={(e) => setQtdVolumes(e.target.value)} inputMode="numeric" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Tipo de volume</label>
              <select value={tipoVolume} onChange={(e) => setTipoVolume(e.target.value)} className={inputClass}>
                {TIPOS_VOLUME.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Observação logística</label>
            <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} placeholder="Ex.: frágil, entregar no turno da manhã..." className={inputClass} />
          </div>

          {precisaAvisoNf && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <p className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4" /> Este pedido NÃO tem NF-e autorizada.
              </p>
              <label className="mt-2 flex items-center gap-2 font-semibold">
                <input type="checkbox" checked={confirmaSemNf} onChange={(e) => setConfirmaSemNf(e.target.checked)} className="h-4 w-4" />
                Despachar mesmo assim (há justificativa: remessa sem NF, retirada, etc.)
              </label>
            </div>
          )}
        </div>

        {divergencia.temAviso && !modoEdicao && (
          <div
            className={
              divergencia.bloqueia
                ? "mx-5 mb-1 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-200"
                : "mx-5 mb-1 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
            }
          >
            <p className="font-semibold">
              {divergencia.bloqueia
                ? "⛔ Despacho bloqueado: este envio não é o que foi cotado"
                : "⚠ O frete cobrado pode não refletir este envio"}
            </p>
            {divergencia.transporteMudou && (
              <p className="mt-1">
                Transporte: cotado como <strong>{labelTipoFrete(divergencia.transporteReferencia!)}</strong>, despacho
                como <strong>{labelTipoFrete(tipoFrete)}</strong>.
              </p>
            )}
            {divergencia.pesoExcedeuMargem && (
              <p className="mt-1">
                Peso: {((divergencia.peso.pesoCotadoGramas ?? 0) / 1000).toFixed(2)} kg cotados contra{" "}
                {(divergencia.peso.pesoAtualGramas / 1000).toFixed(2)} kg no despacho —{" "}
                <strong>{((divergencia.percentualAcimaDoCotado ?? 0) * 100).toFixed(1)}% acima</strong> (a margem é 5%).
              </p>
            )}
            {divergencia.cepMudou && (
              <p className="mt-1">
                Destino: cotado para o CEP {formatarCep(divergencia.cepCotado)}, despacho para{" "}
                {formatarCep(divergencia.cepDespacho)}.
              </p>
            )}
            <p className="mt-2">
              {divergencia.bloqueia ? (
                <>
                  O frete da proposta ({formatCurrency(pedido.freteValor ?? 0)}) não paga este envio. Para destravar,{" "}
                  <strong>recote e aplique</strong> uma opção — o que depende de liberação de um administrador.
                </>
              ) : (
                <>
                  O valor na proposta continua <strong>{formatCurrency(pedido.freteValor ?? 0)}</strong> — despachar não
                  o altera.
                </>
              )}
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          {faltantes.length > 0 ? (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Falta informar {frasearFaltantes(faltantes)}
            </span>
          ) : divergencia.bloqueia ? (
            <span className="text-xs font-medium text-rose-700 dark:text-rose-400">
              Bloqueado: {frasearMotivos(divergencia.motivos)}
            </span>
          ) : null}
          <button type="button" onClick={() => void handleConfirmar()} disabled={salvando || faltantes.length > 0 || divergencia.bloqueia} className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-50">
            {salvando ? "Salvando..." : modoEdicao ? "Salvar dados" : tipoEntrega === "RETIRADA" ? "Confirmar: aguardando retirada" : "Confirmar despacho"}
          </button>
        </div>
      </div>
    </div>
  );
}
