"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Link as LinkIcon, RefreshCw, Truck } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  aplicarFreteComplementar,
  type AplicacaoFreteComplementar,
  buscarFreteComplementarVigente,
  cotarFreteComplementar,
  type CotacaoComplementarResult,
  type LinhaFreteComplementar,
  type OpcaoFreteComplementar
} from "@/features/orcamentos/services/complementar.client";

interface FreteComplementarCardProps {
  /** `id_int` do COMPLEMENTO — a proposta aberta na tela. */
  idIntComplemento: number;
  /** `id_int` do pedido principal, de onde vem o peso já cobrado. */
  idIntPrincipal: number;
  /** Modalidade herdada do principal. Fora de CIF não há frete a cobrar. */
  modalidadeFrete: string | null;
  /** Há item JÁ SALVO no banco? Sem isso não há peso para cotar. */
  temItensSalvos: boolean;
  /**
   * A tela tem alteração não salva? A cotação usa o peso GRAVADO, e aplicar
   * recarrega o formulário — com edição pendente, os dois dariam errado.
   */
  alteracoesNaoSalvas?: boolean;
  /**
   * Chamado depois de aplicar. O formulário RECARREGA a proposta inteira aqui:
   * o `valor_frete`, a cotação e o total mudaram no banco, e o estado da tela
   * ficaria com o frete antigo — salvar nesse estado regravaria o total sem o
   * frete complementar. Sem o callback, o card só atualiza a si mesmo.
   */
  onAplicado?: (resultado: AplicacaoFreteComplementar) => void;
}

/** Rótulo humano da origem do peso do principal (lib/peso.ts). */
const ROTULO_ORIGEM: Record<string, string> = {
  aferido: "pesado na bancada",
  bruto: "bruto da Revisão",
  cotado: "peso da cotação",
  teorico: "teórico dos itens"
};

function gramas(valor: number | null | undefined) {
  if (valor === null || valor === undefined) return "—";
  return `${new Intl.NumberFormat("pt-BR").format(Math.round(valor))} g`;
}

/**
 * FRETE COMPLEMENTAR — aba Fretes do pedido complementar.
 *
 * Regra: docs/business/PEDIDO-COMPLEMENTAR.md.
 *
 * O complemento não cota frete como uma proposta comum: o frete dele é a
 * DIFERENÇA entre a cotação do peso somado (principal + este pedido) e o que o
 * principal já cobra. Somado mais barato que o já cobrado cobra zero, e nada é
 * creditado.
 *
 * A cotação é do servidor e não grava nada; aplicar chama a rota que grava o
 * ledger, a cotação DESTE pedido e o `valor_frete` DESTE pedido, numa
 * transação. O pedido principal nunca é tocado.
 */
export function FreteComplementarCard({
  idIntComplemento,
  idIntPrincipal,
  modalidadeFrete,
  temItensSalvos,
  alteracoesNaoSalvas = false,
  onAplicado
}: FreteComplementarCardProps) {
  const { showToast } = useAppToast();
  const router = useRouter();

  const [vigente, setVigente] = useState<LinhaFreteComplementar | null>(null);
  const [carregandoVigente, setCarregandoVigente] = useState(true);
  const [cotacao, setCotacao] = useState<CotacaoComplementarResult | null>(null);
  const [cotando, setCotando] = useState(false);
  const [aplicandoId, setAplicandoId] = useState<string | null>(null);
  const [recusa, setRecusa] = useState<string | null>(null);

  const ehCif = String(modalidadeFrete ?? "").trim().toUpperCase() === "CIF";

  const recarregarVigente = useCallback(async () => {
    setCarregandoVigente(true);
    const linha = await buscarFreteComplementarVigente(idIntComplemento);
    setVigente(linha);
    setCarregandoVigente(false);
  }, [idIntComplemento]);

  /* eslint-disable react-hooks/set-state-in-effect */
  // Carga da linha vigente do ledger: o estado só existe no banco, e a tela
  // precisa dele para saber se já há frete complementar aplicado.
  useEffect(() => {
    void recarregarVigente();
  }, [recarregarVigente]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function handleCotar() {
    setCotando(true);
    setRecusa(null);
    try {
      const resultado = await cotarFreteComplementar(idIntComplemento);
      if (!resultado.success) {
        setCotacao(null);
        setRecusa(resultado.errorMessage ?? "Não foi possível cotar o frete complementar.");
        return;
      }
      setCotacao(resultado);
      if ((resultado.opcoes ?? []).length === 0) {
        setRecusa("Nenhuma transportadora devolveu cotação agora — tente de novo em instantes.");
      }
    } finally {
      setCotando(false);
    }
  }

  async function handleAplicar(opcao: OpcaoFreteComplementar) {
    setAplicandoId(opcao.id);
    setRecusa(null);
    try {
      const resultado = await aplicarFreteComplementar({
        idIntComplemento,
        chave: opcao.chaveIdempotencia,
        opcaoId: opcao.id,
        valorVisto: opcao.valorTotalCotado
      });
      if (!resultado.success) {
        setRecusa(resultado.errorMessage ?? "Não foi possível aplicar o frete complementar.");
        return;
      }
      if (onAplicado) {
        onAplicado(resultado);
        return;
      }
      showToast({
        type: "success",
        title: resultado.idempotente ? "Frete complementar já estava aplicado" : "Frete complementar aplicado",
        description: `A cobrar neste pedido: ${formatCurrency(resultado.valorACobrar ?? 0)}.`
      });
      setCotacao(null);
      await recarregarVigente();
      router.refresh();
    } finally {
      setAplicandoId(null);
    }
  }

  // Fora de CIF não há frete a cobrar: RETIRA e FOB são herdados do principal.
  if (!ehCif) {
    return (
      <div className="mb-6 rounded-3xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex items-start gap-3">
          <Truck className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
          <div className="text-sm">
            <p className="font-semibold text-slate-900">Frete complementar</p>
            <p className="mt-1 text-slate-600">
              {modalidadeFrete ?? "Modalidade não declarada"} herdado do pedido #{idIntPrincipal} — sem frete a cobrar
              neste pedido.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const invalidado = Boolean(vigente?.desvinculadoEm);

  return (
    <div className="mb-6 rounded-3xl border border-sky-200 bg-sky-50/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <LinkIcon className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
          <div className="text-sm">
            <p className="font-semibold text-sky-900">Frete complementar do pedido #{idIntPrincipal}</p>
            <p className="mt-1 text-xs leading-relaxed text-sky-900/80">
              Este pedido cobra só a <strong>diferença</strong> entre a cotação do peso somado dos dois e o frete que o
              #{idIntPrincipal} já cobra. Se o somado sair mais barato, aqui fica R$ 0,00 e nada é creditado.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void handleCotar()}
          disabled={cotando || !temItensSalvos || alteracoesNaoSalvas}
          title={
            !temItensSalvos
              ? "Salve os itens antes de cotar"
              : alteracoesNaoSalvas
                ? "Salve as alterações antes de cotar"
                : undefined
          }
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${cotando ? "animate-spin" : ""}`} />
          {cotando
            ? "Cotando..."
            : !temItensSalvos
              ? "Salve os itens antes de cotar"
              : alteracoesNaoSalvas
                ? "Salve as alterações antes de cotar"
                : "Cotar frete complementar"}
        </button>
      </div>

      {invalidado ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          <p className="font-semibold">Frete complementar invalidado</p>
          <p className="mt-1 leading-relaxed">
            Este pedido foi desvinculado do #{vigente?.idIntPrincipal} e passou a precisar de frete próprio.
            {vigente?.desvinculadoMotivo ? ` Motivo: ${vigente.desvinculadoMotivo}` : ""}
          </p>
        </div>
      ) : null}

      {/* Estado aplicado: a linha vigente do livro-razão. */}
      {!carregandoVigente && vigente && !cotacao ? (
        <div className="mt-4 grid grid-cols-2 gap-3 @md:grid-cols-3">
          <Numero rotulo={`Peso do #${vigente.idIntPrincipal}`} valor={gramas(vigente.pesoOriginalGramas)} nota={ROTULO_ORIGEM[vigente.pesoOrigemOriginal] ?? vigente.pesoOrigemOriginal} />
          <Numero rotulo="Peso deste pedido" valor={gramas(vigente.pesoComplementoGramas)} />
          <Numero rotulo="Peso somado" valor={gramas(vigente.pesoSomadoGramas)} />
          <Numero rotulo="Frete cotado (somado)" valor={formatCurrency(vigente.freteTotalCotado)} nota={`${vigente.transportadora}${vigente.servico ? ` · ${vigente.servico}` : ""}`} />
          <Numero rotulo={`Já cobrado no #${vigente.idIntPrincipal}`} valor={formatCurrency(vigente.freteCobradoOriginal)} />
          <Numero
            rotulo="A cobrar aqui"
            valor={formatCurrency(vigente.freteCobradoComplemento)}
            destaque
            nota={vigente.diferenca < 0 ? `Somado ficou ${formatCurrency(Math.abs(vigente.diferenca))} mais barato` : undefined}
          />
        </div>
      ) : null}

      {/* Cotação na tela: os mesmos seis números, com as opções para escolher. */}
      {cotacao?.success ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 @md:grid-cols-3">
            <Numero
              rotulo={`Peso do #${idIntPrincipal}`}
              valor={gramas(cotacao.pesoOriginalGramas)}
              nota={cotacao.pesoOrigemOriginal ? ROTULO_ORIGEM[cotacao.pesoOrigemOriginal] ?? cotacao.pesoOrigemOriginal : undefined}
            />
            <Numero rotulo="Peso deste pedido" valor={gramas(cotacao.pesoComplementoGramas)} />
            <Numero rotulo="Peso somado" valor={gramas(cotacao.pesoSomadoGramas)} />
            <Numero rotulo={`Já cobrado no #${idIntPrincipal}`} valor={formatCurrency(cotacao.freteCobradoOriginal ?? 0)} nota={cotacao.servicoOriginal ?? undefined} />
            <Numero rotulo="Entrega em" valor={cotacao.endereco?.cidade ? `${cotacao.endereco.cidade}/${cotacao.endereco.uf}` : "—"} nota={cotacao.endereco?.cep} />
            <Numero rotulo="Opções cotadas" valor={String((cotacao.opcoes ?? []).length)} />
          </div>

          <div className="mt-4 space-y-2">
            {(cotacao.opcoes ?? []).map((opcao) => (
              <div
                key={opcao.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {opcao.transportadora}
                    {opcao.servico ? ` · ${opcao.servico}` : ""}
                    {opcao.mesmoServicoDoOriginal ? (
                      <span className="ml-2 inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-800">
                        Mesmo serviço do #{idIntPrincipal}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Prazo: {opcao.prazo} · Cotado (somado): {formatCurrency(opcao.valorTotalCotado)} · Já cobrado:{" "}
                    {formatCurrency(opcao.freteCobradoOriginal)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">A cobrar aqui</p>
                    <p className="text-base font-bold tabular-nums text-slate-900">{formatCurrency(opcao.valorACobrar)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleAplicar(opcao)}
                    disabled={aplicandoId !== null || alteracoesNaoSalvas}
                    className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {aplicandoId === opcao.id ? "Aplicando..." : "Aplicar"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {(cotacao.avisos ?? []).length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-amber-800">
              {(cotacao.avisos ?? []).map((aviso) => (
                <li key={aviso}>• {aviso}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {!carregandoVigente && !vigente && !cotacao ? (
        <p className="mt-4 text-xs text-slate-600">
          Nenhum frete complementar aplicado ainda neste pedido.
        </p>
      ) : null}

      {recusa ? (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="leading-relaxed">{recusa}</p>
        </div>
      ) : null}
    </div>
  );
}

function Numero({
  rotulo,
  valor,
  nota,
  destaque
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  destaque?: boolean;
}) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${destaque ? "bg-[#0b2f4a] text-white" : "bg-white"}`}>
      <p className={`text-[10px] font-bold uppercase tracking-wide ${destaque ? "text-white/70" : "text-slate-500"}`}>
        {rotulo}
      </p>
      <p className={`mt-1 text-sm font-bold tabular-nums ${destaque ? "text-white" : "text-slate-900"}`}>{valor}</p>
      {nota ? (
        <p className={`mt-0.5 text-[11px] ${destaque ? "text-white/70" : "text-slate-500"}`}>{nota}</p>
      ) : null}
    </div>
  );
}
