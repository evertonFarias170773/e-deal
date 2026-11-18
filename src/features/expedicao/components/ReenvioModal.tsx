"use client";

/**
 * REENVIO DE PEDIDO DEVOLVIDO (fase 1, 22/10/2026; fase 2B, 18/11/2026).
 *
 * Pedido EM TRANSITO devolvido pela transportadora volta para a Expedicao com
 * endereco e/ou tipo de envio novos. O endereco e ESCOLHA EXPLICITA: depois do
 * despacho vale o gravado em `expedicoes`, e mudar na proposta nao surte efeito.
 * Quem decide e o banco (`exp_reenviar_pedido`): permissao, frete e quem paga.
 *
 * FASE 2B: em CIF, com endereco ou tipo de envio novos, o frete e cotado aqui
 * (a mesma rota da recotacao, que registra a consulta) e o expedidor escolhe a
 * opcao do tipo de envio. Sem opcao automatica para o tipo, so um ADM
 * (expedicao.admin) digita o valor. O banco confere a opcao (consulta mais
 * recente do CEP, tipo certo) e calcula a diferenca: positiva fica no ciclo e
 * vira PIX na aba Pagamentos ou abono do ADM; negativa e recusada. Trocar o
 * tipo de envio exige nota nova antes do redespacho.
 *
 * MODO DE COBRANCA (18/11/2026): em CIF escolhe-se como cobrar o frete do
 * reenvio: DIFERENCA (novo - anterior; menor recusado), CHEIO (o frete novo
 * inteiro) ou SEM_COBRANCA (so administrador, com motivo). O valor a cobrar
 * sai do modo; e ele que trava o despacho e vira o PIX.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  avisosDoReenvio,
  freteDoEnvioAnterior,
  MODOS_COBRANCA_REENVIO,
  opcoesDoTipo,
  ROTULO_MODO_COBRANCA,
  tituloDoFreteDoReenvio,
  valorACobrarDoReenvio,
  type ModoCobrancaReenvio,
  type OpcaoCotadaReenvio
} from "../lib/reenvio";
import { listarEnderecosParaReenvio, reenviarPedido, type EnderecoParaReenvio, type FreteDoReenvio } from "../services/reenvio.client";
import { avaliarSaldoDoDespacho, recotarFrete } from "../services/recotacao.client";
import { mensagemDoSaldo, type SaldoDoDespacho } from "../lib/saldo-despacho";
import { TRANSPORTES_POR_MODALIDADE, type PedidoExpedicao, type TipoFreteNormalizado } from "../types";

const ROTULO_TIPO: Record<string, string> = {
  CORREIOS: "Correios",
  TRANSPORTADORA: "Transportadora",
  MOTOBOY: "Motoboy"
};

const soDigitos = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");

const EXPLICA_MODO: Record<ModoCobrancaReenvio, string> = {
  DIFERENCA: "frete novo menos o do envio anterior",
  CHEIO: "o frete novo inteiro, sem desconto do anterior",
  SEM_COBRANCA: "só administrador, com motivo"
};

type CotacaoDoReenvio = { idEndereco: string; idConsulta: number; opcoes: OpcaoCotadaReenvio[]; avisos: string[] };

export function ReenvioModal({
  pedido,
  onClose,
  onDone
}: {
  pedido: PedidoExpedicao;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const ehAdmExpedicao = Boolean(user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "expedicao.admin"));
  /** Sem cobranca: so administrador (is_admin/is_super_adm), como o Abonar. */
  const ehAdministrador = Boolean(user?.isSuperAdmin || user?.isAdmin);
  const exp = pedido.expedicao;
  const modalidade = exp?.modalidadeFrete ?? pedido.modalidadeOrcamento ?? null;
  const tipos: TipoFreteNormalizado[] = modalidade === "CIF" || modalidade === "FOB" ? TRANSPORTES_POR_MODALIDADE[modalidade] : [];
  const tipoAtual = (exp?.tipoFrete ?? pedido.tipoFrete) as TipoFreteNormalizado;
  const ciclo = (pedido.reenvio?.ciclos ?? 0) + 1;
  const freteAnterior = freteDoEnvioAnterior(pedido.reenvio, pedido.freteCobrado);

  const [enderecos, setEnderecos] = useState<EnderecoParaReenvio[] | null>(null);
  const [idEndereco, setIdEndereco] = useState<string>(exp?.idEnderecoEntrega ?? pedido.enderecoEntrega?.id ?? "");
  const [tipoFrete, setTipoFrete] = useState<TipoFreteNormalizado>(tipos.includes(tipoAtual) ? tipoAtual : (tipos[0] ?? tipoAtual));
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  /**
   * SALDO A DEFINIR (22/10/2026): o mesmo veredito da trava de saldo do despacho
   * (`exp_saldo_despacho`), que a RPC do reenvio tambem consulta antes de gravar.
   * Desde a 2B inclui a diferenca de frete pendente de reenvios anteriores.
   * Leitura que falha nao trava: a RPC segue recusando.
   */
  const [saldo, setSaldo] = useState<SaldoDoDespacho | null>(null);
  /** Recusa da RPC, mostrada dentro da janela (alem do aviso). */
  const [erroRpc, setErroRpc] = useState<string | null>(null);

  // FASE 2B: cotacao do frete do reenvio.
  const [cotacao, setCotacao] = useState<CotacaoDoReenvio | null>(null);
  const [cotando, setCotando] = useState(false);
  const [erroCotacao, setErroCotacao] = useState<string | null>(null);
  const [idOpcao, setIdOpcao] = useState<string>("");
  const [freteDigitado, setFreteDigitado] = useState("");
  const [modoCobranca, setModoCobranca] = useState<ModoCobrancaReenvio>("DIFERENCA");
  const [motivoCobranca, setMotivoCobranca] = useState("");

  useEffect(() => {
    let vivo = true;
    void avaliarSaldoDoDespacho(pedido.idInt).then((s) => {
      if (vivo) setSaldo(s);
    });
    return () => {
      vivo = false;
    };
  }, [pedido.idInt]);

  useEffect(() => {
    let vivo = true;
    void listarEnderecosParaReenvio([Number(pedido.idCliente), Number(pedido.idFaturado)]).then((lista) => {
      if (vivo) setEnderecos(lista);
    });
    return () => {
      vivo = false;
    };
  }, [pedido.idCliente, pedido.idFaturado]);

  const avisos = useMemo(
    () =>
      avisosDoReenvio({
        tipoFreteAtual: exp?.tipoFrete,
        correiosCodigoObjeto: exp?.correiosCodigoObjeto,
        prepostagemCanceladaEm: exp?.prepostagemCanceladaEm,
        azulAwb: exp?.azulAwb
      }),
    [exp?.tipoFrete, exp?.correiosCodigoObjeto, exp?.prepostagemCanceladaEm, exp?.azulAwb]
  );

  const cepAtual = soDigitos(enderecos?.find((e) => e.id === exp?.idEnderecoEntrega)?.cep);
  const cepEscolhido = soDigitos(enderecos?.find((e) => e.id === idEndereco)?.cep);
  const tipoMudou = tipoFrete !== tipoAtual;
  /** Em CIF, endereco ou tipo novos pedem o frete cotado (a RPC confere). */
  const precisaFrete = modalidade === "CIF" && enderecos !== null && (tipoMudou || (cepEscolhido !== "" && cepEscolhido !== cepAtual));

  // A cotacao vale para o endereco cotado; trocar endereco ou tipo pede escolha nova.
  const cotacaoVigente = cotacao && cotacao.idEndereco === idEndereco ? cotacao : null;
  const opcoesTipo = useMemo(() => (cotacaoVigente ? opcoesDoTipo(cotacaoVigente.opcoes, tipoFrete) : []), [cotacaoVigente, tipoFrete]);
  const opcaoEscolhida = opcoesTipo.find((o) => o.id === idOpcao) ?? null;
  const valorDigitado = Number(freteDigitado.replace(/\./g, "").replace(",", "."));
  const digitadoValido = Number.isFinite(valorDigitado) && valorDigitado > 0;
  const semOpcaoAutomatica = Boolean(cotacaoVigente) && opcoesTipo.length === 0;

  const freteNovo: number | null = !precisaFrete
    ? null
    : opcaoEscolhida
      ? opcaoEscolhida.valor
      : semOpcaoAutomatica && ehAdmExpedicao && digitadoValido
        ? Math.round(valorDigitado * 100) / 100
        : null;
  /**
   * Base do valor a cobrar: o frete cotado/digitado; sem frete novo em CIF, o
   * mesmo frete do envio anterior (como o banco grava). FOB nao cobra.
   */
  const freteDoReenvio: number | null = modalidade !== "CIF" ? null : precisaFrete ? freteNovo : freteAnterior;
  const cobrancaPorModo =
    freteDoReenvio !== null
      ? (Object.fromEntries(
          MODOS_COBRANCA_REENVIO.map((m) => [m, valorACobrarDoReenvio(m, freteAnterior, freteDoReenvio)])
        ) as Record<ModoCobrancaReenvio, ReturnType<typeof valorACobrarDoReenvio>>)
      : null;
  const cobranca = cobrancaPorModo ? cobrancaPorModo[modoCobranca] : null;

  const freteParaRpc: FreteDoReenvio = !precisaFrete
    ? null
    : opcaoEscolhida && cotacaoVigente
      ? { origem: "COTACAO", idConsulta: cotacaoVigente.idConsulta, idOpcao: opcaoEscolhida.id }
      : freteNovo !== null
        ? { origem: "DIGITADO_ADM", valor: freteNovo }
        : null;

  async function handleCotar() {
    if (!idEndereco) return;
    setErroCotacao(null);
    setCotando(true);
    const res = await recotarFrete(pedido.idInt, idEndereco, { reenvio: true });
    setCotando(false);
    if (!res.success || !res.idConsulta) {
      setCotacao(null);
      setErroCotacao(res.errorMessage || "A cotação não pôde ser registrada. Tente de novo.");
      return;
    }
    setCotacao({ idEndereco, idConsulta: res.idConsulta, opcoes: res.opcoes ?? [], avisos: res.avisos ?? [] });
    const primeira = opcoesDoTipo(res.opcoes ?? [], tipoFrete)[0];
    setIdOpcao(primeira?.id ?? "");
  }

  const semQuemPaga = tipos.length === 0;
  const temSaldo = saldo?.bloqueia === true;
  const freteResolvido = !precisaFrete || (freteParaRpc !== null && freteNovo !== null);
  const cobrancaResolvida =
    modalidade !== "CIF" ||
    (cobranca !== null &&
      !cobranca.recusado &&
      (modoCobranca !== "SEM_COBRANCA" || (ehAdministrador && motivoCobranca.trim().length >= 5)));
  const pronto =
    !salvando &&
    !semQuemPaga &&
    !temSaldo &&
    Boolean(idEndereco) &&
    motivo.trim().length >= 3 &&
    freteResolvido &&
    cobrancaResolvida;

  async function handleConfirmar() {
    if (!pronto) return;
    setErroRpc(null);
    setSalvando(true);
    const res = await reenviarPedido({
      idInt: pedido.idInt,
      ciclo,
      idEnderecoEntrega: idEndereco,
      tipoFrete,
      motivo: motivo.trim(),
      modalidade,
      frete: freteParaRpc,
      cobranca:
        modalidade === "CIF"
          ? { modo: modoCobranca, motivo: modoCobranca === "SEM_COBRANCA" ? motivoCobranca : null }
          : undefined
    });
    setSalvando(false);
    if (res.success) {
      const partes = [`#${pedido.idInt} voltou para a Expedição.`];
      if (res.valorCobrar > 0) {
        partes.push(
          `${tituloDoFreteDoReenvio(res.modoCobranca)}: ${formatCurrency(res.valorCobrar)}. Gere o PIX na aba Pagamentos ou peça o abono a um administrador.`
        );
      } else if (res.modoCobranca === "SEM_COBRANCA") {
        partes.push("Reenvio sem cobrança de frete.");
      }
      if (res.exigeNota) partes.push("O tipo de envio mudou: emita a nota nova antes de despachar.");
      partes.push("Despache de novo pelo botão Despachar.");
      showToast({
        type: "success",
        title: res.idempotente ? "Reenvio já registrado" : `Reenvio ${res.ciclo} registrado`,
        description: partes.join(" ")
      });
      onDone();
    } else {
      setErroRpc(res.error);
      showToast({ type: "error", title: "Reenvio não registrado", description: res.error });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
            Reenviar #{pedido.idInt} {ciclo > 1 ? <span className="text-sm font-medium text-slate-500">(reenvio {ciclo})</span> : null}
          </h2>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto p-6">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            O pedido volta de EM TRANSITO para a Expedição, sem passar por Arte nem Produção, e sai de novo pelo Despachar.
            O primeiro envio fica guardado no registro do reenvio.
          </p>

          {temSaldo ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              <p className="font-semibold">
                Saldo a receber neste pedido{saldo?.saldo !== undefined ? `: ${formatCurrency(saldo.saldo)}` : ""}
              </p>
              <p className="mt-1">{mensagemDoSaldo(saldo)}</p>
              <p className="mt-1 font-semibold">O saldo precisa ser resolvido (cobrança paga ou abono) antes do reenvio.</p>
            </div>
          ) : null}

          {semQuemPaga ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              Este pedido está sem quem paga o frete (CIF ou FOB). O reenvio só vale em CIF ou FOB.
            </p>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Endereço de entrega do reenvio</label>
            {enderecos === null ? (
              <p className="text-sm text-slate-500">Carregando endereços...</p>
            ) : enderecos.length === 0 ? (
              <p className="text-sm text-rose-700 dark:text-rose-300">Nenhum endereço do cliente ou do pagador. Cadastre o endereço no cliente e abra de novo.</p>
            ) : (
              <select
                value={idEndereco}
                onChange={(e) => {
                  setIdEndereco(e.target.value);
                  setIdOpcao("");
                }}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {!enderecos.some((e) => e.id === idEndereco) ? <option value="">Escolha o endereço</option> : null}
                {enderecos.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.id === exp?.idEnderecoEntrega ? "(atual) " : ""}
                    {e.idCliente === pedido.idFaturado && pedido.idFaturado !== pedido.idCliente ? "[pagador] " : ""}
                    {e.rotulo}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Tipo de envio</label>
            <select
              value={tipoFrete}
              onChange={(e) => {
                const novo = e.target.value as TipoFreteNormalizado;
                setTipoFrete(novo);
                setIdOpcao(cotacaoVigente ? (opcoesDoTipo(cotacaoVigente.opcoes, novo)[0]?.id ?? "") : "");
              }}
              disabled={semQuemPaga}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO[t] ?? t}
                  {t === tipoAtual ? " (atual)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Quem paga não muda ({modalidade ?? "sem quem paga"}).
              {modalidade === "CIF"
                ? " Com endereço ou tipo de envio novos, cote o frete abaixo. Depois escolha como cobrar o frete do reenvio: diferença, frete cheio ou sem cobrança (administrador)."
                : ""}
            </p>
          </div>

          {precisaFrete ? (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold text-slate-800 dark:text-slate-100">Frete do reenvio</p>
                <button
                  type="button"
                  onClick={() => void handleCotar()}
                  disabled={cotando || !idEndereco}
                  className="rounded-xl bg-[#0b2f4a] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0d3a5c] disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-500"
                >
                  {cotando ? "Cotando..." : cotacaoVigente ? "Cotar de novo" : "Cotar frete"}
                </button>
              </div>
              <p className="text-slate-600 dark:text-slate-300">Frete do envio anterior: {formatCurrency(freteAnterior)}</p>

              {erroCotacao ? <p className="text-rose-700 dark:text-rose-300">{erroCotacao}</p> : null}

              {cotacaoVigente && opcoesTipo.length > 0 ? (
                <div className="space-y-1.5">
                  {opcoesTipo.map((o) => (
                    <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-xl bg-white px-3 py-2 dark:bg-slate-900">
                      <input type="radio" name="opcao-reenvio" checked={idOpcao === o.id} onChange={() => setIdOpcao(o.id)} />
                      <span className="flex-1">
                        {o.transportadora}
                        {o.servico && o.servico !== o.transportadora ? ` · ${o.servico}` : ""}
                        {o.prazo ? <span className="text-slate-500"> · {o.prazo}</span> : null}
                      </span>
                      <span className="font-semibold">{formatCurrency(o.valor)}</span>
                    </label>
                  ))}
                </div>
              ) : null}

              {semOpcaoAutomatica ? (
                ehAdmExpedicao ? (
                  <div>
                    <p className="text-amber-800 dark:text-amber-200">
                      A cotação automática não trouxe {ROTULO_TIPO[tipoFrete] ?? tipoFrete}. Como administrador, digite o frete combinado (fica gravado em seu nome).
                    </p>
                    <input
                      value={freteDigitado}
                      onChange={(e) => setFreteDigitado(e.target.value)}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="mt-1 w-40 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </div>
                ) : (
                  <p className="text-amber-800 dark:text-amber-200">
                    A cotação automática não trouxe {ROTULO_TIPO[tipoFrete] ?? tipoFrete}. Peça a um administrador da Expedição para registrar o reenvio com o frete combinado.
                  </p>
                )
              ) : null}

              {cotacaoVigente?.avisos.map((a) => (
                <p key={a} className="text-xs text-slate-500">{a}</p>
              ))}

            </div>
          ) : null}

          {modalidade === "CIF" ? (
            <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-800/60">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Cobrança do frete do reenvio</p>
              <p className="text-xs text-slate-500">
                Frete do envio anterior {formatCurrency(freteAnterior)}
                {freteDoReenvio !== null ? ` · frete do reenvio ${formatCurrency(freteDoReenvio)}` : " · cote o frete para ver os valores"}
              </p>
              <div className="space-y-1.5">
                {MODOS_COBRANCA_REENVIO.map((m) => {
                  const contaDoModo = cobrancaPorModo?.[m] ?? null;
                  const soAdm = m === "SEM_COBRANCA" && !ehAdministrador;
                  return (
                    <label
                      key={m}
                      className={`flex items-center gap-2 rounded-xl bg-white px-3 py-2 dark:bg-slate-900 ${soAdm ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                    >
                      <input
                        type="radio"
                        name="modo-cobranca-reenvio"
                        checked={modoCobranca === m}
                        disabled={soAdm}
                        onChange={() => setModoCobranca(m)}
                      />
                      <span className="flex-1">
                        <span className="font-medium first-letter:uppercase">{ROTULO_MODO_COBRANCA[m]}</span>
                        <span className="text-slate-500"> · {EXPLICA_MODO[m]}</span>
                      </span>
                      <span className={contaDoModo?.recusado ? "text-xs text-rose-700 dark:text-rose-300" : "font-semibold"}>
                        {contaDoModo === null ? "—" : contaDoModo.recusado ? "frete menor: não vale" : formatCurrency(contaDoModo.valor)}
                      </span>
                    </label>
                  );
                })}
              </div>
              {modoCobranca === "SEM_COBRANCA" ? (
                <textarea
                  value={motivoCobranca}
                  onChange={(e) => setMotivoCobranca(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Motivo de não cobrar o frete do reenvio (mínimo 5 caracteres; fica no ciclo)"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              ) : null}
              {cobranca ? (
                cobranca.recusado ? (
                  <p className="font-semibold text-rose-700 dark:text-rose-300">
                    Frete do reenvio {formatCurrency(freteDoReenvio ?? 0)} é menor que o do envio anterior: no modo diferença não há devolução.
                    Escolha frete cheio ou sem cobrança.
                  </p>
                ) : (
                  <p className="font-semibold text-amber-800 dark:text-amber-200">
                    {modoCobranca === "SEM_COBRANCA"
                      ? "Cobrança: sem cobrança de frete neste reenvio (decisão de administrador, com motivo)."
                      : cobranca.valor > 0
                        ? `Cobrança: ${ROTULO_MODO_COBRANCA[modoCobranca]} de ${formatCurrency(cobranca.valor)} — PIX na aba Pagamentos (ou abono de administrador). O pedido só é despachado depois do pagamento.`
                        : `Cobrança: ${ROTULO_MODO_COBRANCA[modoCobranca]} de ${formatCurrency(0)}, nada a cobrar.`}
                  </p>
                )
              ) : null}
            </div>
          ) : null}

          {tipoMudou ? (
            <p className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Trocar o tipo de envio exige nota nova: o Despachar só libera depois de uma nota de produção emitida após este reenvio.</span>
            </p>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Motivo (obrigatório — fica na trilha)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Ex.: devolvido pelos Correios, destinatário ausente; endereço incompleto..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {erroRpc ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              <span className="font-semibold">Reenvio não registrado: </span>
              {erroRpc}
            </p>
          ) : null}

          {avisos.map((a) => (
            <p key={a} className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{a}</span>
            </p>
          ))}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          <button type="button" onClick={() => void handleConfirmar()} disabled={!pronto} className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0d3a5c] disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-500">
            {salvando ? "Registrando..." : "Voltar para a Expedição"}
          </button>
        </div>
      </div>
    </div>
  );
}
