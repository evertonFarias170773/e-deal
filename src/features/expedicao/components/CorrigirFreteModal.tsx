"use client";

/**
 * Correção de frete pós-liberação — a tela (Etapa 5).
 *
 * O QUE ELA FAZ E O QUE NÃO FAZ
 *   Ela escolhe a modalidade e a transportadora, pergunta ao servidor quanto
 *   muda, e confirma. Não calcula o efeito: o total novo e a diferença exibidos
 *   são os que o modo `simular` devolveu, com a mesma função que a gravação usa.
 *   Enquanto ninguém confirmar, NADA é gravado — `simular` é `select` puro.
 *
 * AS BARREIRAS NÃO SÃO DAQUI
 *   O menu já esconde a ação pelo que o painel tem em memória (NF autorizada,
 *   despacho confirmado, entregue, faixa de status), mas quem barra é o
 *   servidor, a cada chamada. Quando ele recusa, o texto exibido é o dele,
 *   inteiro — inclusive a orientação de voltar um passo no caso do despacho já
 *   confirmado, que é acionável e a tela não teria como escrever melhor.
 *
 * A DIFERENÇA CREDORA
 *   Quando a correção deixa dinheiro a favor do cliente, o destino do crédito é
 *   decidido no `DiferencaFinanceiraModal` — o MESMO de Orçamentos, sem cópia.
 *   Aquele modal trabalha sobre uma pendência de Conta Corrente JÁ CRIADA (ele
 *   recusa confirmar sem `idPendencia`), então a sequência aqui é a mesma de
 *   Orçamentos: o operador autoriza a abertura do crédito, a correção é gravada
 *   e a pendência nasce, e só então o modal escolhe o destino. Por isso o passo
 *   de autorização existe e diz, com o valor à vista, o que vai acontecer.
 *
 *   Diferença devedora ou nenhuma grava direto: saldo devedor não entra na Conta
 *   Corrente — é da própria proposta, pela regra de 22/07.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Truck, X } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import { getTransportadoras } from "@/features/nfe/services/nfe.service";
import { faltaTransportadoraEmFob, nomeTransportadoraCadastro } from "@/features/orcamentos/lib/modalidade-frete";
import {
  categoriaDoServico,
  LABEL_CATEGORIA_FRETE,
  type CategoriaFrete
} from "@/features/orcamentos/lib/categoria-frete";
import {
  ACAO_ABRIR_PENDENCIA_CREDITO,
  confirmarCorrecaoFrete,
  simularCorrecaoFrete,
  type RespostaConfirmacao,
  type SimulacaoFrete
} from "../services/corrigir-frete.client";
import { LABEL_MODALIDADE, MODALIDADES_OFERECIDAS, type ModalidadeFrete, type PedidoExpedicao } from "../types";

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const labelClass = "block text-xs font-bold uppercase tracking-wide text-slate-500 mb-1";

type Transportadora = { id_cliente: number; nome: string | null; fantasia: string | null };

export function CorrigirFreteModal({
  pedido,
  onClose,
  onDone,
  onCreditoAberto
}: {
  pedido: PedidoExpedicao;
  onClose: () => void;
  /** Correção gravada sem crédito a decidir — o painel recarrega. */
  onDone: (mensagem: string) => void;
  /**
   * Correção gravada COM crédito ao cliente: a pendência já existe e o destino
   * dela é escolhido no `DiferencaFinanceiraModal`, montado pelo painel.
   */
  onCreditoAberto: (resultado: RespostaConfirmacao) => void;
}) {
  /**
   * SÓ A ESCOLHA DO USUÁRIO É ESTADO. Enquanto ele não mexer, os campos mostram
   * o que está GRAVADO — e isso é derivado, não copiado.
   *
   * Guardar a modalidade inicial em `useState` a congelava no valor que o objeto
   * do painel tinha na montagem. Se aquele objeto estivesse atrasado, o campo
   * ficava na modalidade velha enquanto o resto da tela já mostrava a nova.
   */
  const [escolha, setEscolha] = useState<{ modalidade: ModalidadeFrete; transportadoraId: number | null } | null>(
    null
  );
  const [transportadoras, setTransportadoras] = useState<Transportadora[]>([]);

  /**
   * O resultado carrega a ESCOLHA que o produziu. Sem isso, trocar a modalidade
   * deixaria na tela o número da escolha anterior enquanto a nova consulta corre
   * — e é esse número que decide se a gravação abre crédito.
   */
  const [resultado, setResultado] = useState<{
    chave: string;
    dados: SimulacaoFrete | null;
    avisos: string[];
    erro: string | null;
  } | null>(null);
  const [erroGravacao, setErroGravacao] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  /** Passo extra do caminho credor: o operador precisa autorizar antes. */
  const [autorizandoCredito, setAutorizandoCredito] = useState(false);
  /** RODOVIARIO ou AEREO, quando a derivacao nao resolve. Mesma pergunta do orcamento. */
  const [categoriaDeclarada, setCategoriaDeclarada] = useState<CategoriaFrete | null>(null);

  /**
   * O QUE ESTÁ GRAVADO vem da simulação, não do objeto da lista: ela relê
   * `propostas` a cada chamada e devolve `modalidadeAtual`/`transportadoraAtualId`
   * — o estado do banco AGORA. Zero leitura a mais, a resposta já vinha.
   *
   * Lê de `resultado`, e não da resposta correspondente à escolha corrente, de
   * propósito: durante uma nova consulta o último valor conhecido continua
   * valendo. Sem isso os campos oscilariam entre o valor do banco e o do painel
   * a cada troca, e a consulta se repetiria sem fim.
   */
  const modalidadePersistida = resultado?.dados
    ? resultado.dados.modalidadeAtual
    : pedido.modalidadeOrcamento;
  const transportadoraPersistida = resultado?.dados
    ? resultado.dados.transportadoraAtualId
    : pedido.idTransportadoraOrcamento;

  const modalidade: ModalidadeFrete = escolha?.modalidade ?? modalidadePersistida ?? "CIF";
  const transportadoraId = escolha ? escolha.transportadoraId : transportadoraPersistida;

  const chave = `${modalidade}|${transportadoraId ?? ""}`;

  useEffect(() => {
    let vivo = true;
    void getTransportadoras().then((lista) => {
      if (vivo) setTransportadoras((lista as Transportadora[]) ?? []);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const nomeExibicao = useCallback(
    (t: Transportadora) => t.fantasia || t.nome || `#${t.id_cliente}`,
    []
  );

  // A simulação acompanha a escolha. Cada troca refaz a pergunta ao servidor —
  // é leitura, e é o único jeito de o número exibido ser o número que vale.
  useEffect(() => {
    let vivo = true;
    void simularCorrecaoFrete({ idInt: pedido.idInt, modalidade, transportadoraId }).then((res) => {
      if (!vivo) return;
      setResultado({
        chave,
        dados: res.success ? (res.dados ?? null) : null,
        avisos: res.avisos ?? [],
        erro: res.success ? null : (res.errorMessage ?? "Não foi possível simular a correção.")
      });
    });
    return () => {
      vivo = false;
    };
  }, [pedido.idInt, modalidade, transportadoraId, chave]);

  const atual = resultado?.chave === chave ? resultado : null;
  const simulacao = atual?.dados ?? null;
  const avisos = atual?.avisos ?? [];
  const simulando = atual === null;
  const erro = erroGravacao ?? atual?.erro ?? null;


  /** Trocar a escolha derruba a autorização de crédito e o erro da gravação. */
  function escolher(proximaModalidade: ModalidadeFrete, proximaTransportadora: number | null) {
    setEscolha({ modalidade: proximaModalidade, transportadoraId: proximaTransportadora });
    setAutorizandoCredito(false);
    setErroGravacao(null);
    setCategoriaDeclarada(null);
  }

  const faltaTransportadora = faltaTransportadoraEmFob(modalidade, transportadoraId);

  /**
   * A categoria que o servidor vai derivar com esta escolha — MESMA funcao e
   * MESMAS entradas que `confirmarCorrecaoFrete` usa: em FOB o servico cotado
   * nao entra, porque o card que sobra ali e residuo.
   *
   * A tela nao decide categoria nenhuma; ela so descobre se o servidor tem como
   * decidir. Quando nao tem, pergunta — exatamente onde a modalidade e escolhida,
   * como no orcamento.
   */
  const categoriaDerivada = useMemo<CategoriaFrete | null>(() => {
    const servico = simulacao?.servicoCotado ?? "";
    if (modalidade === "FOB") {
      const nome =
        nomeTransportadoraCadastro(transportadoras.find((t) => t.id_cliente === transportadoraId)) ?? "";
      return categoriaDoServico(nome, null, modalidade);
    }
    return categoriaDoServico(servico, servico, modalidade);
  }, [modalidade, transportadoraId, transportadoras, simulacao?.servicoCotado]);

  const precisaDeclararCategoria = Boolean(simulacao) && categoriaDerivada === null && !faltaTransportadora;
  const ehCredora = Boolean(simulacao && simulacao.exigeAcaoFinanceira && simulacao.diferenca < 0);
  const semMudanca = modalidade === modalidadePersistida && transportadoraId === transportadoraPersistida;

  const deltaTotal = simulacao?.deltaTotal ?? 0;
  const rotuloDelta = useMemo(() => {
    if (!simulacao) return "";
    if (Math.abs(deltaTotal) < 0.01) return "O total não muda.";
    return deltaTotal > 0
      ? `O total sobe ${formatCurrency(deltaTotal)}.`
      : `O total cai ${formatCurrency(Math.abs(deltaTotal))}.`;
  }, [simulacao, deltaTotal]);

  async function gravar(comAcaoDeCredito: boolean) {
    if (salvando) return;
    setSalvando(true);
    setErroGravacao(null);
    const res = await confirmarCorrecaoFrete({
      idInt: pedido.idInt,
      modalidade,
      transportadoraId,
      acaoFinanceira: comAcaoDeCredito ? ACAO_ABRIR_PENDENCIA_CREDITO : null,
      categoriaFreteDeclarada: categoriaDeclarada
    });
    setSalvando(false);

    if (!res.success) {
      setErroGravacao(res.errorMessage ?? "Não foi possível gravar a correção.");
      return;
    }

    if (res.pendenciaAtiva) {
      onCreditoAberto(res);
      return;
    }

    onDone(
      `#${pedido.idInt} agora é ${LABEL_MODALIDADE[modalidade]}. ` +
        `Total: ${formatCurrency(res.valorTotalNovo ?? 0)}.`
    );
  }

  const podeConfirmar = Boolean(simulacao) && !simulando && !salvando && !faltaTransportadora && !semMudanca;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
              Corrigir frete #{pedido.idInt}
            </h2>
            <p className="text-xs text-slate-500">{pedido.clienteExibicao}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div>
            <label className={labelClass}>Modalidade do frete</label>
            <select
              value={modalidade}
              onChange={(e) => escolher(e.target.value as ModalidadeFrete, transportadoraId)}
              disabled={salvando}
              className={inputClass}
            >
              {MODALIDADES_OFERECIDAS.map((m) => (
                <option key={m} value={m}>
                  {LABEL_MODALIDADE[m]}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-500">
              Hoje: {modalidadePersistida ? LABEL_MODALIDADE[modalidadePersistida] : "não declarada"}.
            </p>
          </div>

          {modalidade !== "RETIRA" && (
            <div>
              <label className={labelClass}>
                Transportadora {modalidade === "FOB" ? "(obrigatória em FOB)" : "(opcional em CIF)"}
              </label>
              <select
                value={transportadoraId ?? ""}
                onChange={(e) => escolher(modalidade, e.target.value === "" ? null : Number(e.target.value))}
                disabled={salvando}
                className={inputClass}
              >
                <option value="">— não informada —</option>
                {transportadoras.map((t) => (
                  <option key={t.id_cliente} value={t.id_cliente}>
                    {nomeExibicao(t)}
                  </option>
                ))}
              </select>
              {faltaTransportadora && (
                <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                  Em FOB quem leva a mercadoria é a transportadora que o cliente contratou. Sem ela, a Expedição e a
                  OS ficariam sem saber por onde o pedido sai.
                </p>
              )}
            </div>
          )}

          {/* A MESMA pergunta do orcamento, no mesmo lugar: logo abaixo de quem
              leva, dentro do bloco da escolha. Aparece so quando a derivacao
              nao resolve, e nao trava a gravacao. */}
          {precisaDeclararCategoria && (
            <div>
              <label className={labelClass}>Como vai o transporte?</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                {(["RODOVIARIO", "AEREO"] as CategoriaFrete[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={categoriaDeclarada === c}
                    disabled={salvando}
                    onClick={() => setCategoriaDeclarada(categoriaDeclarada === c ? null : c)}
                    className={`flex-1 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                      categoriaDeclarada === c
                        ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
                        : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    }`}
                  >
                    {LABEL_CATEGORIA_FRETE[c]}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                Só para a Expedição saber em qual coluna o pedido entra. Correios, Motoboy, Veppo, Azul e São Miguel
                o sistema já reconhece sozinho — esta transportadora ele não tem como classificar.{" "}
                {categoriaDeclarada ? "Clique de novo para desmarcar." : "Deixar em branco também vale: entra em Extras."}
              </p>
            </div>
          )}

          {/* ── Efeito, direto do modo simular ─────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
            {simulando && <p className="text-sm text-slate-500">Consultando o efeito da correção...</p>}

            {!simulando && simulacao && (
              <>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">Total atual</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {formatCurrency(simulacao.valorTotalAtual)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">Total novo</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {formatCurrency(simulacao.totalProjetado)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">Frete</p>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {formatCurrency(simulacao.valorFreteAtual)} → {formatCurrency(simulacao.valorFreteProjetado)}
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">{rotuloDelta}</p>

                {simulacao.exigeAcaoFinanceira && (
                  <p
                    className={`mt-1 text-xs font-semibold ${
                      simulacao.diferenca < 0
                        ? "text-emerald-700 dark:text-emerald-400"
                        : "text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {simulacao.diferenca < 0
                      ? `Ficam ${formatCurrency(Math.abs(simulacao.diferenca))} a favor do cliente (pago ${formatCurrency(simulacao.valorPagoConfirmado)}).`
                      : `Ficam ${formatCurrency(simulacao.diferenca)} a receber do cliente (pago ${formatCurrency(simulacao.valorPagoConfirmado)}). Esse saldo continua sendo da proposta, cobrável na aba Pagamentos — não vai para a Conta Corrente.`}
                  </p>
                )}
              </>
            )}

            {!simulando && !simulacao && !erro && (
              <p className="text-sm text-slate-500">Escolha a modalidade para ver o efeito.</p>
            )}
          </div>

          {avisos.map((a) => (
            <p key={a} className="text-xs text-slate-500">
              {a}
            </p>
          ))}

          {/* Passo de autorização do crédito. Só aqui a gravação é liberada no
              caminho credor — e o texto diz o que vai acontecer, com o valor. */}
          {autorizandoCredito && simulacao && (
            <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-700/50 dark:bg-emerald-900/20 dark:text-emerald-200">
              <p className="flex items-center gap-2 font-semibold">
                <ArrowRight className="h-4 w-4" />
                {formatCurrency(Math.abs(simulacao.diferenca))} a favor do cliente
              </p>
              <p className="mt-1.5 text-xs leading-relaxed">
                Ao continuar, a correção é gravada e o crédito é aberto na Conta Corrente do cliente. Em seguida você
                escolhe o destino dele — manter para uso futuro, devolver ou abater um débito.
              </p>
            </div>
          )}

          {erro && (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-700/50 dark:bg-rose-900/20 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span className="leading-relaxed">{erro}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button
            type="button"
            onClick={onClose}
            disabled={salvando}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (ehCredora && !autorizandoCredito) {
                setAutorizandoCredito(true);
                return;
              }
              void gravar(ehCredora);
            }}
            disabled={!podeConfirmar}
            className="flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            <Truck className="h-4 w-4" />
            {salvando
              ? "Gravando..."
              : semMudanca
                ? "Nada a corrigir"
                : ehCredora && !autorizandoCredito
                  ? "Revisar o crédito"
                  : ehCredora
                    ? "Gravar e escolher o destino"
                    : "Confirmar correção"}
          </button>
        </div>
      </div>
    </div>
  );
}
