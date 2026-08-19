"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { getTransportadoras } from "@/features/nfe/services/nfe.service";
import { labelTipoFrete, modalidadeInicialDoDespacho } from "../lib/tipo-frete";
import { despachar, salvarDadosExpedicao } from "../services/expedicao-acoes.service";
import type { AtorExpedicao, DespachoInput } from "../services/expedicao-acoes.service";
import { listarEnderecosCliente } from "../services/enderecos.service";
import type { EnderecoCliente } from "../services/enderecos.service";
import { correiosStatus, gerarPrepostagem } from "../services/correios.client";
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
   * O service continua decidindo o status destino por `tipoEntrega`
   * (RETIRADA → "A RETIRAR", TRANSPORTE → "EM TRANSITO"). Ele agora é derivado
   * da modalidade, em vez de ser um toggle próprio.
   */
  const tipoEntrega: "TRANSPORTE" | "RETIRADA" = modalidade === "RETIRA" ? "RETIRADA" : "TRANSPORTE";

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
                <select value={idEnderecoEntrega ?? ""} onChange={(e) => setIdEnderecoEntrega(e.target.value === "" ? null : e.target.value)} className={inputClass}>
                  <option value="">— não informar —</option>
                  {enderecos.map((e) => (
                    <option key={e.id} value={e.id}>{e.rotulo}</option>
                  ))}
                </select>
              </div>
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

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          <button type="button" onClick={() => void handleConfirmar()} disabled={salvando} className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:opacity-50">
            {salvando ? "Salvando..." : modoEdicao ? "Salvar dados" : tipoEntrega === "RETIRADA" ? "Confirmar: aguardando retirada" : "Confirmar despacho"}
          </button>
        </div>
      </div>
    </div>
  );
}
