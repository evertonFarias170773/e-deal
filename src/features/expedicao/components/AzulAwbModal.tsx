"use client";

/**
 * Emitir AWB da Azul Logistica — o modal.
 *
 * O QUE O OPERADOR INFORMA (nada tem valor padrao fixo)
 *   - servico e tipo de entrega;
 *   - natureza do produto (pre-preenchida com AZUL_PRODUTO_NATUREZA, editavel;
 *     "peças", "amostras" e "brindes" a Azul recusa — a tela barra antes);
 *   - um volume por linha: altura, largura, comprimento (cm) e peso (kg). O peso
 *     abre com peso_kg / qtd_volumes, visivel e editavel; as dimensoes abrem
 *     VAZIAS. Medidas iguais podem agrupar pela Quantidade;
 *   - IE do destinatario quando o cadastro nao tem (ou "Isento").
 *
 * O servidor refaz TODAS as conferencias. As dimensoes digitadas aqui vao para
 * a Azul e para mais lugar nenhum: nao sao gravadas no banco.
 *
 * A emissao cria contrato e cobranca reais na Azul e nao tem desfazer por aqui.
 */

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, Trash2, X } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  SERVICOS_AZUL,
  SOMA_MINIMA_DIMENSOES_CM,
  TIPOS_ENTREGA_AZUL,
  validarNaturezaProduto,
  validarVolumes,
  type ServicoAzul,
  type TipoEntregaAzul,
  type VolumeAzul
} from "../lib/azul-awb";
import { emitirAwbAzul, prepararAwbAzul, type PreparoAzul } from "../services/azul.client";

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
const labelClass = "mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500";

type LinhaVolume = { altura: string; largura: string; comprimento: string; peso: string; quantidade: string };

const numero = (texto: string): number => Number(String(texto).trim().replace(",", "."));

function linhasIniciais(preparo: PreparoAzul): LinhaVolume[] {
  const peso = preparo.pesoPorVolumeKg !== null ? String(preparo.pesoPorVolumeKg).replace(".", ",") : "";
  const agrupar = preparo.qtdVolumes > 10;
  const quantidadeLinhas = agrupar ? 1 : preparo.qtdVolumes;
  return Array.from({ length: quantidadeLinhas }, () => ({
    altura: "",
    largura: "",
    comprimento: "",
    peso,
    quantidade: agrupar ? String(preparo.qtdVolumes) : "1"
  }));
}

export function AzulAwbModal({
  idInt,
  clienteExibicao,
  onClose,
  onDone
}: {
  idInt: number;
  clienteExibicao: string;
  onClose: () => void;
  onDone: (awb: string, ambiente: "sandbox" | "producao") => void;
}) {
  const [preparo, setPreparo] = useState<PreparoAzul | null>(null);
  const [erroPreparo, setErroPreparo] = useState<string | null>(null);
  const [servico, setServico] = useState<ServicoAzul | "">("");
  const [tipoEntrega, setTipoEntrega] = useState<TipoEntregaAzul | "">("");
  const [natureza, setNatureza] = useState("");
  const [unidadeDestino, setUnidadeDestino] = useState("");
  const [linhas, setLinhas] = useState<LinhaVolume[]>([]);
  const [ie, setIe] = useState("");
  const [isento, setIsento] = useState(false);
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [emitindo, setEmitindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void prepararAwbAzul(idInt).then((r) => {
      if (!vivo) return;
      if (!r.success) {
        setErroPreparo(r.errorMessage);
        return;
      }
      setPreparo(r);
      setNatureza(r.naturezaPadrao);
      setUnidadeDestino(r.baseDestino ?? "");
      setLinhas(linhasIniciais(r));
      setIe(r.destinatario.ie);
      setEmail(r.destinatario.email);
      setTelefone(r.destinatario.telefone);
    });
    return () => {
      vivo = false;
    };
  }, [idInt]);

  const volumes: VolumeAzul[] = useMemo(
    () =>
      linhas.map((l) => ({
        altura: numero(l.altura),
        largura: numero(l.largura),
        comprimento: numero(l.comprimento),
        pesoKg: numero(l.peso),
        quantidade: numero(l.quantidade)
      })),
    [linhas]
  );

  const motivoBloqueio =
    (!servico && "Escolha o serviço.") ||
    (!tipoEntrega && "Escolha o tipo de entrega.") ||
    validarNaturezaProduto(natureza) ||
    validarVolumes(volumes) ||
    (!unidadeDestino.trim() && "Informe a sigla da base de destino da Azul.") ||
    (!isento && !ie.trim() && "Informe a inscrição estadual do destinatário ou marque Isento.") ||
    (!email.trim() && "Informe o e-mail do destinatário.") ||
    (!telefone.trim() && "Informe o telefone do destinatário.") ||
    null;

  function atualizar(i: number, campo: keyof LinhaVolume, valor: string) {
    setLinhas((atual) => atual.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
    setErro(null);
  }

  async function emitir() {
    if (motivoBloqueio || !servico || !tipoEntrega || emitindo) return;
    setEmitindo(true);
    setErro(null);
    const r = await emitirAwbAzul({
      idInt,
      servico,
      tipoEntrega,
      natureza: natureza.trim(),
      unidadeDestino: unidadeDestino.trim(),
      volumes,
      destinatario: { ie: ie.trim(), isento, email: email.trim(), telefone: telefone.trim() }
    });
    setEmitindo(false);
    if (r.success) onDone(r.awb, r.ambiente);
    else setErro(r.errorMessage);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Emitir AWB Azul #{idInt}</h2>
            <p className="text-xs text-slate-500">{clienteExibicao}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={emitindo}
            aria-label="Fechar"
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {!preparo && !erroPreparo && (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Conferindo o pedido...
            </p>
          )}
          {erroPreparo && (
            <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{erroPreparo}</p>
          )}

          {preparo && (
            <>
              {preparo.ambiente === "sandbox" ? (
                <p className="rounded-2xl bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                  Ambiente de TESTE da Azul (sandbox). A AWB emitida aqui não é uma remessa real.
                </p>
              ) : (
                <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  PRODUÇÃO: a emissão cria contrato e cobrança reais na Azul. É uma AWB por pedido.
                </p>
              )}

              <div className="rounded-2xl border border-slate-200 p-3 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
                <p>
                  <strong>NF-e</strong> {formatCurrency(preparo.nfe.valorTotal)} · emitida em{" "}
                  {new Date(preparo.nfe.dataEmissao).toLocaleDateString("pt-BR")}
                  {preparo.nfe.origemData === "autorizacao" ? " (data da autorização)" : ""}
                </p>
                <p className="mt-1 break-all">Chave {preparo.nfe.chave}</p>
                <p className="mt-1">
                  <strong>Destino</strong> {preparo.destinatario.nome} · {preparo.destinatario.cidade}/{preparo.destinatario.uf} · CEP{" "}
                  {preparo.destinatario.cep}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Serviço</label>
                  <select className={inputClass} value={servico} onChange={(e) => setServico(e.target.value as ServicoAzul | "")}>
                    <option value="">Escolha...</option>
                    {SERVICOS_AZUL.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Tipo de entrega</label>
                  <select
                    className={inputClass}
                    value={tipoEntrega}
                    onChange={(e) => setTipoEntrega(e.target.value as TipoEntregaAzul | "")}
                  >
                    <option value="">Escolha...</option>
                    {TIPOS_ENTREGA_AZUL.map((t) => (
                      <option key={t} value={t}>
                        {t === "Domicilio" ? "Domicílio" : "Aeroporto"}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className={labelClass}>Natureza do produto</label>
                  <input className={inputClass} value={natureza} onChange={(e) => setNatureza(e.target.value)} maxLength={100} />
                </div>
                <div>
                  <label className={labelClass}>Base de destino</label>
                  <input
                    className={inputClass}
                    value={unidadeDestino}
                    onChange={(e) => setUnidadeDestino(e.target.value.toUpperCase())}
                    placeholder={preparo.baseDestino ? undefined : "Sigla"}
                  />
                </div>
              </div>
              {!preparo.baseDestino && (
                <p className="-mt-2 text-xs text-amber-700 dark:text-amber-300">
                  A Azul não localizou a base de destino para este CEP. Informe a sigla da base.
                </p>
              )}

              <div>
                <p className={labelClass}>Volumes (cm e kg)</p>
                <div className="space-y-2">
                  {linhas.map((l, i) => {
                    const soma = volumes[i].altura + volumes[i].largura + volumes[i].comprimento;
                    const curta = Number.isFinite(soma) && soma > 0 && soma < SOMA_MINIMA_DIMENSOES_CM;
                    return (
                      <div key={i} className="grid grid-cols-[repeat(5,minmax(0,1fr))_auto] items-end gap-2">
                        {(
                          [
                            ["altura", "Altura"],
                            ["largura", "Largura"],
                            ["comprimento", "Compr."],
                            ["peso", "Peso kg"],
                            ["quantidade", "Qtd"]
                          ] as const
                        ).map(([campo, rotulo]) => (
                          <div key={campo}>
                            {i === 0 && <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">{rotulo}</span>}
                            <input
                              className={`${inputClass} ${curta && campo !== "peso" && campo !== "quantidade" ? "border-amber-400" : ""}`}
                              inputMode="decimal"
                              value={l[campo]}
                              onChange={(e) => atualizar(i, campo, e.target.value)}
                              aria-label={`${rotulo} do volume ${i + 1}`}
                            />
                          </div>
                        ))}
                        <button
                          type="button"
                          disabled={linhas.length === 1}
                          onClick={() => setLinhas((atual) => atual.filter((_, j) => j !== i))}
                          aria-label={`Remover volume ${i + 1}`}
                          className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        {curta && (
                          <p className="col-span-6 -mt-1 text-xs text-amber-700 dark:text-amber-300">
                            Soma {soma.toLocaleString("pt-BR")} cm — a Azul exige no mínimo {SOMA_MINIMA_DIMENSOES_CM} cm.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setLinhas((atual) => [...atual, { altura: "", largura: "", comprimento: "", peso: atual[0]?.peso ?? "", quantidade: "1" }])}
                  className="mt-2 inline-flex items-center gap-1 rounded-xl px-2 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40"
                >
                  <Plus className="h-3.5 w-3.5" /> Adicionar volume
                </button>
                <p className="mt-1 text-xs text-slate-500">
                  Pedido com {preparo.qtdVolumes} volume(s). O peso abre com o peso da expedição dividido pelos volumes; confira e ajuste.
                  Medidas iguais podem ser agrupadas na coluna Qtd.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Inscrição estadual do destinatário</label>
                  <input className={inputClass} value={isento ? "ISENTO" : ie} disabled={isento} onChange={(e) => setIe(e.target.value)} />
                  <label className="mt-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <input type="checkbox" checked={isento} onChange={(e) => setIsento(e.target.checked)} /> Isento
                  </label>
                  {!preparo.destinatario.ie && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">O cadastro do cliente não tem inscrição estadual.</p>
                  )}
                </div>
                {(!preparo.destinatario.email || !preparo.destinatario.telefone) && (
                  <div className="space-y-2">
                    {!preparo.destinatario.email && (
                      <div>
                        <label className={labelClass}>E-mail do destinatário</label>
                        <input className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
                      </div>
                    )}
                    {!preparo.destinatario.telefone && (
                      <div>
                        <label className={labelClass}>Telefone do destinatário</label>
                        <input className={inputClass} value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {erro && <p className="rounded-2xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">{erro}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-5 dark:border-slate-800">
          <p className="text-xs text-slate-500">{preparo && motivoBloqueio ? motivoBloqueio : ""}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={emitindo}
              className="rounded-2xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void emitir()}
              disabled={!preparo || Boolean(motivoBloqueio) || emitindo}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0a2740] disabled:opacity-40"
            >
              {emitindo && <Loader2 className="h-4 w-4 animate-spin" />}
              {emitindo ? "Emitindo..." : "Emitir AWB"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
