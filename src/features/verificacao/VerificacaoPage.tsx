"use client";

import { useState } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { useAppToast } from "@/components/common/AppToast";
import { Search, FileText, CheckCircle, HelpCircle, ShieldAlert, ShieldCheck } from "lucide-react";

type DocType = "CPF" | "CNPJ";

type VerificationData = {
  documento: string;
  tipo: DocType;
  nome?: string;
  razaoSocial?: string;
  nomeFantasia?: string;
  dataNascimento?: string;
  dataAbertura?: string;
  situacaoCadastral: string;
  protocolo?: string;
  consultaData: string;
  codigoControle?: string;
  observacoes?: string;
  naturezaJuridica?: string;
  atividadePrincipal?: string;
  endereco?: string;
  cep?: string;
  inscricaoEstadual?: string;
  capitalSocial?: number;
  regimeTributario?: string;
};

export function VerificacaoPage() {
  const { showToast } = useAppToast();
  const [tipo, setTipo] = useState<DocType>("CNPJ");
  const [documento, setDocumento] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<VerificationData | null>(null);

  const formatCurrency = (val?: number) => {
    if (val === undefined) return "—";
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);
  };

  const formatDocMask = (val: string, type: DocType) => {
    const digits = val.replace(/\D/g, "");
    if (type === "CPF") {
      return digits
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
        .substring(0, 14);
    } else {
      return digits
        .replace(/(\d{2})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1/$2")
        .replace(/(\d{4})(\d{1,2})$/, "$1-$2")
        .substring(0, 18);
    }
  };

  const handleDocumentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    setDocumento(formatDocMask(rawVal, tipo));
  };

  const handleTipoChange = (newTipo: DocType) => {
    setTipo(newTipo);
    setDocumento("");
    setResult(null);
  };

  const handleConsultar = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDoc = documento.replace(/\D/g, "");
    const expectedLength = tipo === "CPF" ? 11 : 14;

    if (!cleanDoc || cleanDoc.length !== expectedLength) {
      showToast({
        type: "warning",
        title: "Documento inválido",
        description: `O ${tipo} deve conter ${expectedLength} dígitos.`
      });
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/verificacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, documento })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setResult(data.data);
        showToast({
          type: "success",
          title: "Consulta realizada",
          description: "Dados do documento carregados com sucesso."
        });
      } else {
        showToast({
          type: "error",
          title: "Erro na consulta",
          description: data.errorMessage || "Não foi possível realizar a consulta."
        });
      }
    } catch (err) {
      console.error("Erro ao consultar documento:", err);
      showToast({
        type: "error",
        title: "Erro de conexão",
        description: "Falha ao se conectar com a API de verificação."
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Verificação CPF/CNPJ"
        subtitle="Consulta cadastral de CPF e CNPJ para validação de novos clientes ou restrições."
        context="Cadastros / Verificação de Documento"
      />

      <div className="grid gap-6 lg:grid-cols-[360px_1fr] items-start">
        {/* Form Column */}
        <div className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm space-y-6">
          <div>
            <h3 className="text-base font-bold text-slate-900">Nova Consulta</h3>
            <p className="text-xs text-slate-500 mt-1">
              Selecione o tipo de documento e digite os dígitos para consultar o status na Receita Federal.
            </p>
          </div>

          <form onSubmit={handleConsultar} className="space-y-4">
            <div className="flex rounded-2xl bg-slate-100 p-1 border border-slate-200">
              <button
                type="button"
                onClick={() => handleTipoChange("CNPJ")}
                className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${
                  tipo === "CNPJ" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                CNPJ (Jurídica)
              </button>
              <button
                type="button"
                onClick={() => handleTipoChange("CPF")}
                className={`flex-1 rounded-xl py-2 text-xs font-bold transition-all ${
                  tipo === "CPF" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                CPF (Física)
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">Número do documento</label>
              <div className="relative">
                <input
                  type="text"
                  value={documento}
                  onChange={handleDocumentChange}
                  placeholder={tipo === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white transition"
                  disabled={isLoading}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-12 inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-5 text-sm font-semibold text-white shadow-md hover:bg-[#123f61] transition disabled:opacity-60"
            >
              {isLoading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Consultando...
                </>
              ) : (
                <>
                  <Search className="h-4 w-4" />
                  Consultar Documento
                </>
              )}
            </button>
          </form>

          <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 space-y-2 text-amber-800">
            <div className="flex gap-2 items-start">
              <HelpCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <div>
                <h4 className="text-xs font-bold">Ambiente de Diagnóstico</h4>
                <p className="text-[11px] leading-relaxed mt-0.5">
                  Esta consulta está configurada como proxy backend preparando a futura integração com Edge Functions / n8n.
                  Nenhum custo real ou cota de API está ativo nesta etapa visual.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Results Column */}
        <div className="space-y-6">
          {!result && !isLoading && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center flex flex-col items-center justify-center gap-4">
              <FileText className="h-10 w-10 text-slate-400" />
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-700">Aguardando consulta</h3>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Insira o documento do cliente no painel esquerdo para verificar a situação cadastral na base oficial.
                </p>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="rounded-3xl border border-slate-200 bg-white p-12 text-center flex flex-col items-center justify-center gap-4 shadow-sm">
              <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#0b2f4a] border-t-transparent" />
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-700">Verificando dados...</h3>
                <p className="text-xs text-slate-500">
                  Conectando ao proxy seguro e executando regras de validação.
                </p>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-3xl border border-[#d7e5e8] bg-white p-6 shadow-sm space-y-6 animate-fade-in">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{result.tipo} Verificado</span>
                  <h3 className="text-lg font-extrabold text-slate-900 mt-1">
                    {result.tipo === "CNPJ" ? result.razaoSocial : result.nome}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Documento: <span className="font-semibold text-slate-700">{result.documento}</span>
                  </p>
                </div>

                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                  result.situacaoCadastral === "ATIVA" || result.situacaoCadastral === "REGULAR"
                    ? "border-teal-200 bg-teal-50 text-teal-700"
                    : "border-red-200 bg-red-50 text-red-700"
                }`}>
                  {result.situacaoCadastral === "ATIVA" || result.situacaoCadastral === "REGULAR" ? (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  )}
                  {result.situacaoCadastral}
                </span>
              </div>

              {result.tipo === "CNPJ" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <ResultItem label="Nome Fantasia" value={result.nomeFantasia || "—"} />
                  <ResultItem label="Data de Abertura" value={result.dataAbertura} />
                  <ResultItem label="Inscrição Estadual" value={result.inscricaoEstadual || "—"} />
                  <ResultItem label="Regime Tributário" value={result.regimeTributario} />
                  <div className="md:col-span-2">
                    <ResultItem label="Natureza Jurídica" value={result.naturezaJuridica} />
                  </div>
                  <div className="md:col-span-2">
                    <ResultItem label="Atividade Principal" value={result.atividadePrincipal} />
                  </div>
                  <div className="md:col-span-2">
                    <ResultItem label="Endereço Fiscal" value={result.endereco} />
                  </div>
                  <ResultItem label="CEP" value={result.cep} />
                  <ResultItem label="Capital Social" value={formatCurrency(result.capitalSocial)} />
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <ResultItem label="Nome Completo" value={result.nome} />
                  <ResultItem label="Data de Nascimento" value={result.dataNascimento} />
                  <ResultItem label="Código de Controle RF" value={result.codigoControle} />
                  <ResultItem label="Protocolo Consulta" value={result.protocolo} />
                  <div className="md:col-span-2">
                    <ResultItem label="Mensagem RF" value={result.observacoes} />
                  </div>
                </div>
              )}

              <div className="border-t border-slate-100 pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[11px] text-slate-500">
                <p>Data da consulta: {new Date(result.consultaData).toLocaleString("pt-BR")}</p>
                <div className="flex items-center gap-1 text-teal-600 font-semibold">
                  <CheckCircle className="h-3 w-3" />
                  Consulta assinada digitalmente
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ResultItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100/50">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-slate-900 leading-relaxed">{value || "—"}</p>
    </div>
  );
}
