"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, Printer, X } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDataCivil } from "@/lib/formatters/date";
import { tokenDaSessao } from "@/lib/supabase/bearer";
import { baixarBlob, imprimirPdf } from "../lib/arquivo";
import { ehBaseComissao, percentualDaComissao, ROTULO_BASE, valorDaComissao, type BaseComissao } from "../lib/comissao";
import { OPCOES_EMPRESA } from "../lib/opcoes";
import { SLUG_PAGAMENTO_COMISSAO } from "../definicoes/pagamento-comissao";
import type { AcoesDaLinhaProps } from "./index";

/**
 * Menu da linha do relatório "Pagamento de comissão": Imprimir recibo.
 *
 * O diálogo pergunta a empresa (razão social, CNPJ e logo do recibo), a base (vem do seletor do
 * topo, mas precisa ser confirmada) e, opcionais, forma e data do pagamento. O PDF é montado no
 * servidor, que refaz a conta com a mesma permissão da tela; nada é gravado.
 */

const estiloCampo = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  color: "var(--foreground)"
} as const;

const FORMAS_SUGERIDAS = ["PIX", "Transferência bancária", "Depósito", "Dinheiro", "Cheque"];

export function ReciboComissaoAcoes({ linha, consulta }: AcoesDaLinhaProps) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <ActionsMenu label="Ações" items={[{ label: "Imprimir recibo", onClick: () => setAberto(true) }]} />
      {aberto ? <DialogoRecibo linha={linha} consulta={consulta} onFechar={() => setAberto(false)} /> : null}
    </>
  );
}

function DialogoRecibo({ linha, consulta, onFechar }: AcoesDaLinhaProps & { onFechar: () => void }) {
  const vendedor = String(linha.vendedor ?? "");
  const baseDoTopo = ehBaseComissao(consulta.filtros.base) ? consulta.filtros.base : null;
  const [empresa, setEmpresa] = useState("");
  const [base, setBase] = useState<BaseComissao | null>(baseDoTopo);
  const [baseConfirmada, setBaseConfirmada] = useState(false);
  const [forma, setForma] = useState("");
  const [data, setData] = useState("");
  const [ocupado, setOcupado] = useState<"baixar" | "imprimir" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const fechar = (e: KeyboardEvent) => e.key === "Escape" && !ocupado && onFechar();
    window.addEventListener("keydown", fechar);
    return () => window.removeEventListener("keydown", fechar);
  }, [onFechar, ocupado]);

  const totalNaBase = base === "COM_FRETE" ? Number(linha.com_frete ?? 0) : base === "SEM_FRETE" ? Number(linha.sem_frete ?? 0) : null;
  const pronto = Boolean(empresa) && base !== null && baseConfirmada && !ocupado;

  const gerar = async (acao: "baixar" | "imprimir") => {
    if (!pronto || !base) return;
    setOcupado(acao);
    setErro(null);
    try {
      const token = await tokenDaSessao();
      const params = new URLSearchParams({
        ini: consulta.inicio,
        fim: consulta.fim,
        base,
        vendedor,
        empresa
      });
      if (forma.trim()) params.set("forma", forma.trim());
      if (data) params.set("data", data);
      const resposta = await fetch(`/api/relatorios/${SLUG_PAGAMENTO_COMISSAO}/recibo?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: "no-store"
      });
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => null)) as { error?: string } | null;
        setErro(corpo?.error ?? "Não foi possível gerar o recibo.");
        return;
      }
      const arquivo = await resposta.blob();
      if (acao === "imprimir") imprimirPdf(arquivo);
      else baixarBlob(nomeDoRecibo(vendedor, consulta.inicio, consulta.fim), arquivo);
    } catch {
      setErro("Não foi possível gerar o recibo.");
    } finally {
      setOcupado(null);
    }
  };

  const botao =
    "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/60 p-4 text-left"
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-recibo-comissao"
    >
      <div className="w-full max-w-lg space-y-4 rounded-3xl p-6 shadow-2xl" style={{ background: "var(--card)", color: "var(--foreground)" }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="titulo-recibo-comissao" className="text-lg font-semibold">
              Imprimir recibo
            </h3>
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              {vendedor} · {formatDataCivil(consulta.inicio)} a {formatDataCivil(consulta.fim)}
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" style={{ color: "var(--muted)" }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
          Empresa
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="rounded-xl px-3 py-2 text-sm font-normal" style={estiloCampo}>
            <option value="">Escolha a empresa</option>
            {OPCOES_EMPRESA.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.rotulo}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold" style={{ color: "var(--muted)" }}>
            Base da comissão
          </legend>
          <div className="flex flex-wrap gap-2">
            {(["COM_FRETE", "SEM_FRETE"] as const).map((b) => (
              <label key={b} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm" style={estiloCampo}>
                <input
                  type="radio"
                  name="base-recibo"
                  checked={base === b}
                  onChange={() => {
                    setBase(b);
                    setBaseConfirmada(false);
                  }}
                />
                {ROTULO_BASE[b]}
                <span style={{ color: "var(--muted)" }}>{formatCurrency(Number((b === "COM_FRETE" ? linha.com_frete : linha.sem_frete) ?? 0))}</span>
              </label>
            ))}
          </div>
          {totalNaBase !== null ? (
            <p className="text-sm">
              Faixa{" "}
              <strong>
                {percentualDaComissao(totalNaBase).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
              </strong>{" "}
              · comissão <strong>{formatCurrency(valorDaComissao(totalNaBase))}</strong>
            </p>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={baseConfirmada} disabled={base === null} onChange={(e) => setBaseConfirmada(e.target.checked)} />
            Confirmo a base {base ? <strong>{ROTULO_BASE[base].toLowerCase()}</strong> : "escolhida"} para este recibo
          </label>
        </fieldset>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
            Forma de pagamento (opcional)
            <input
              list="formas-recibo-comissao"
              value={forma}
              maxLength={60}
              onChange={(e) => setForma(e.target.value)}
              placeholder="Em branco: linha para preencher"
              className="rounded-xl px-3 py-2 text-sm font-normal"
              style={estiloCampo}
            />
            <datalist id="formas-recibo-comissao">
              {FORMAS_SUGERIDAS.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold" style={{ color: "var(--muted)" }}>
            Data do pagamento (opcional)
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className="rounded-xl px-3 py-2 text-sm font-normal" style={estiloCampo} />
          </label>
        </div>

        {erro ? (
          <p role="alert" className="text-sm font-semibold" style={{ color: "var(--danger, #b91c1c)" }}>
            {erro}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" onClick={onFechar} className={botao} style={estiloCampo}>
            Cancelar
          </button>
          <button type="button" onClick={() => gerar("baixar")} disabled={!pronto} className={botao} style={estiloCampo}>
            {ocupado === "baixar" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Baixar PDF
          </button>
          <button
            type="button"
            onClick={() => gerar("imprimir")}
            disabled={!pronto}
            className={botao}
            style={{ background: "var(--primary)", color: "var(--primary-foreground)", border: "1px solid var(--primary)" }}
          >
            {ocupado === "imprimir" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            Imprimir
          </button>
        </div>
      </div>
    </div>
  );
}

/** Nome do arquivo do recibo: vendedor sem acento e o período. */
export function nomeDoRecibo(vendedor: string, inicio: string, fim: string) {
  const nome = vendedor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `recibo-comissao_${nome || "vendedor"}_${inicio}_a_${fim}.pdf`;
}
