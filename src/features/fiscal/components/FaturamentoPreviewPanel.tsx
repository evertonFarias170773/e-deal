"use client";

import { useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { X, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Play, Loader2 } from "lucide-react";
import type { FaturavelOrigem, FaturavelItem } from "../types";
import { formatCurrency } from "@/lib/formatters/currency";
import type { NfeReadModel } from "@/features/nfe/types";
import type { NfseReadModel } from "@/features/nfse/types";

interface FaturamentoPreviewPanelProps {
  item: FaturavelOrigem;
  onClose: () => void;
  onEmitSuccess: (origemId: string, itemType: FaturavelOrigem["tipo"], simulatedNota: NfeReadModel | NfseReadModel) => void;
}

// Função auxiliar definida no escopo do módulo para contornar restrições de pureza do linter
function generateSimulatedNota(item: FaturavelOrigem, totalValue: number): NfeReadModel | NfseReadModel {
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return {
    id: `nota-simulada-${Date.now()}`,
    id_int: randomNum,
    ref: item.ref_origem,
    id_cliente: item.id_cliente,
    nome: item.cliente_nome,
    fantasia: item.cliente_fantasia,
    id_empresa: item.id_empresa,
    status: "AUTORIZADA",
    valor_total_nf: totalValue,
    valor_servicos: totalValue,
    numero_nf: item.tipo !== "OS" ? randomNum : null,
    numero_nfse: item.tipo === "OS" ? randomNum : null,
    created_at: new Date().toISOString(),
    url_danfe: item.tipo !== "OS" ? "https://example.com/danfe.pdf" : null,
    url_pdf: item.tipo === "OS" ? "https://example.com/nfse.pdf" : null,
    url_xml: "https://example.com/nota.xml",
    isMock: true
  } as unknown as NfeReadModel | NfseReadModel;
}

export function FaturamentoPreviewPanel({ item, onClose, onEmitSuccess }: FaturamentoPreviewPanelProps) {
  const { user } = useAuth();
  const isPermitidoOperarFiscal = user?.isSuperAdmin || user?.isAdmin || user?.isGerente;

  const [editedItens, setEditedItens] = useState<FaturavelItem[]>(() =>
    JSON.parse(JSON.stringify(item.itens))
  );
  const [isJsonOpen, setIsJsonOpen] = useState(false);
  const [isEmitting, setIsEmitting] = useState(false);

  function handleItemChange(itemId: string, field: "ncm" | "cfop", value: string) {
    // Sanitizar entrada (apenas números para NCM e CFOP)
    const cleanValue = value.replace(/\D/g, "");
    setEditedItens((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, [field]: cleanValue } : i))
    );
  }

  // Obter total recalculado (caso quantidades mudem futuramente, mas hoje é fixo)
  const totalValue = editedItens.reduce((acc, curr) => acc + curr.valor_total, 0);

  // Mapeador de nomes amigáveis de empresa
  function getEmpresaName(id: number) {
    if (id === 1) return "INGRESSO IDEAL";
    if (id === 2) return "BIRÔ IDEAL";
    if (id === 3) return "E3 BRINDES";
    return `EMPRESA #${id}`;
  }

  // Validações estáticas locais calculadas sob demanda no render
  const isNcmValid = editedItens.every((i) => i.ncm.length === 8 || item.tipo === "OS");
  const isCfopValid = editedItens.every((i) => {
    if (item.tipo === "OS") return true; // Serviços não usam CFOP padrão da mesma forma
    return ["5", "6", "7"].includes(i.cfop.charAt(0)) && i.cfop.length === 4;
  });
  const isValueValid = totalValue > 0;
  const isClientValid = item.id_cliente > 0 && item.cliente_nome.trim().length > 0;

  const validationErrors: string[] = [];
  if (!isClientValid) validationErrors.push("Dados cadastrais do cliente incompletos.");
  if (!isNcmValid) validationErrors.push("Código NCM incorreto. O NCM deve conter exatamente 8 dígitos numéricos.");
  if (!isCfopValid) validationErrors.push("CFOP inválido. O CFOP de venda deve conter 4 dígitos numéricos e iniciar com 5 (estadual) ou 6 (interestadual).");
  if (!isValueValid) validationErrors.push("O valor total do faturamento deve ser maior que R$ 0,00.");

  const hasErrors = validationErrors.length > 0;

  // Payload JSON gerado dinamicamente para o Focus
  const focusPayload = {
    tipo_documento: item.tipo,
    ref_origem: item.ref_origem,
    id_empresa: item.id_empresa,
    empresa_emitente: getEmpresaName(item.id_empresa),
    cliente: {
      id_cliente: item.id_cliente,
      razao_social: item.cliente_nome,
      nome_fantasia: item.cliente_fantasia,
      documento_simulado: item.id_cliente === 11311 ? "12.345.678/0001-99" : "98.765.432/0001-11"
    },
    itens: editedItens.map((i, index) => ({
      numero_item: index + 1,
      descricao: i.descricao,
      quantidade: i.quantidade,
      valor_unitario: i.valor_unitario,
      valor_total: i.valor_total,
      ...(item.tipo !== "OS" ? { ncm: i.ncm, cfop: i.cfop } : { codigo_servico: "13.05.01" })
    })),
    valor_total: totalValue,
    ambiente: "homologacao",
    emissao_tipo: "simulada_draft"
  };

  async function handleSimularEmissao(tipoFiscal: "NF-e" | "NFS-e") {
    if (hasErrors) return;
    setIsEmitting(true);

    // Update item type for the simulated generation based on user choice
    // Note: TipoOrigem can be PEDIDO (NFe) or OS (NFSe)
    const mockTipo = tipoFiscal === "NF-e" ? "PEDIDO" : "OS";
    const itemAtualizado = { ...item, tipo: mockTipo as any };

    // Simular atraso de comunicação Focus/SEFAZ (2 segundos)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Gerar nota fiscal simulada no histórico via helper externo
    const simulatedNota = generateSimulatedNota(itemAtualizado, totalValue);

    setIsEmitting(false);
    onEmitSuccess(item.id, mockTipo, simulatedNota);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/60 backdrop-blur-sm transition-opacity">
      <section className="flex h-full w-full flex-col bg-white shadow-2xl transition-transform sm:max-w-xl md:max-w-2xl">
        {/* Cabeçalho do Painel */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Faturamento Fiscal • {item.tipo}
            </span>
            <h2 className="text-xl font-bold text-slate-900 mt-0.5">
              Revisar e Preparar Nota
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isEmitting}
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            aria-label="Fechar painel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Informações Gerais de Origem */}
          <div className="rounded-3xl border border-slate-100 bg-slate-50/50 p-5 space-y-3">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Documento Origem:</span>
              <strong className="text-slate-900">{item.ref_origem}</strong>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Empresa Emitente:</span>
              <span className="font-semibold text-slate-900">{getEmpresaName(item.id_empresa)}</span>
            </div>
            <div className="flex justify-between items-start text-sm pt-2 border-t border-slate-100">
              <span className="text-slate-500 mt-0.5">Destinatário:</span>
              <div className="text-right">
                <p className="font-semibold text-slate-950">{item.cliente_nome}</p>
                <p className="text-xs text-slate-500">Cliente ID: {item.id_cliente}</p>
              </div>
            </div>
          </div>

          {/* Revisão de Itens e Tributação */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              Itens da Nota e Parâmetros
            </h3>
            <div className="space-y-3">
              {editedItens.map((item) => (
                <div
                  key={item.id}
                  className="rounded-3xl border border-slate-200 p-4 bg-white space-y-4 shadow-sm"
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-sm font-semibold text-slate-950">{item.descricao}</span>
                    <span className="text-sm font-bold text-slate-900 shrink-0">
                      {formatCurrency(item.valor_total)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Qtd: <strong>{item.quantidade}</strong></span>
                    <span>V. Unitário: <strong>{formatCurrency(item.valor_unitario)}</strong></span>
                  </div>

                  {focusPayload.tipo_documento !== "OS" ? (
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-50">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                          NCM (8 dígitos)
                        </label>
                        <input
                          type="text"
                          maxLength={8}
                          value={item.ncm}
                          onChange={(e) => handleItemChange(item.id, "ncm", e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono outline-none focus:border-[#0b2f4a]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                          CFOP (4 dígitos)
                        </label>
                        <input
                          type="text"
                          maxLength={4}
                          value={item.cfop}
                          onChange={(e) => handleItemChange(item.id, "cfop", e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono outline-none focus:border-[#0b2f4a]"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs bg-slate-50 p-2.5 rounded-2xl text-slate-600">
                      Código Serviço Prefeitura: <strong>13.05.01</strong>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Checklist de Validação Estática */}
          <div className="rounded-3xl border border-slate-200 p-5 bg-white space-y-4">
            <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide">
              Checklist de Consistência Fiscal
            </h3>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                <span className="text-slate-700">CNPJ / Cadastro Destinatário presente</span>
              </li>
              <li className="flex items-center gap-3 text-sm">
                {isNcmValid ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                )}
                <span className={isNcmValid ? "text-slate-700" : "text-amber-800 font-medium"}>
                  NCM preenchido com 8 dígitos
                </span>
              </li>
              <li className="flex items-center gap-3 text-sm">
                {isCfopValid ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                )}
                <span className={isCfopValid ? "text-slate-700" : "text-amber-800 font-medium"}>
                  CFOP iniciando com 5 (interno), 6 (externo) ou 7 (exportação)
                </span>
              </li>
              <li className="flex items-center gap-3 text-sm">
                {isValueValid ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
                )}
                <span className={isValueValid ? "text-slate-700" : "text-amber-800 font-medium"}>
                  Valor do faturamento maior que R$ 0,00
                </span>
              </li>
            </ul>

            {validationErrors.length > 0 ? (
              <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 space-y-1.5 text-xs text-amber-900">
                <strong className="block font-semibold">Correções pendentes:</strong>
                {validationErrors.map((err, idx) => (
                  <p key={idx}>• {err}</p>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 font-medium">
                Pronto para faturamento! Payload fiscal validado com sucesso.
              </div>
            )}
          </div>

          {/* JSON Payload Preview (Focus NFe API) */}
          <div className="rounded-3xl border border-slate-200 overflow-hidden bg-slate-900 text-slate-300">
            <button
              type="button"
              onClick={() => setIsJsonOpen(!isJsonOpen)}
              className="flex w-full items-center justify-between px-5 py-4 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:bg-slate-800 transition outline-none"
            >
              <span>Visualizar Payload Focus JSON</span>
              {isJsonOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {isJsonOpen ? (
              <pre className="overflow-x-auto border-t border-slate-800 p-5 text-xs font-mono leading-relaxed text-emerald-400 bg-slate-950 max-h-72">
                {JSON.stringify(focusPayload, null, 2)}
              </pre>
            ) : null}
          </div>
        </div>

        {/* Footer do Painel com Ações */}
        <div className="border-t border-slate-100 bg-slate-50 px-6 py-5 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-medium">Total Calculado</span>
            <strong className="text-lg font-bold text-slate-900">{formatCurrency(totalValue)}</strong>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isEmitting}
              className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 transition"
            >
              Cancelar
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleSimularEmissao("NF-e")}
                disabled={hasErrors || isEmitting}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#0b2f4a] px-6 py-3 text-sm font-semibold text-white hover:bg-[#061d2e] disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isEmitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Emitindo...</>
                ) : (
                  "Faturar NF-e (Produto)"
                )}
              </button>
              <button
                type="button"
                onClick={() => handleSimularEmissao("NFS-e")}
                disabled={hasErrors || isEmitting}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {isEmitting ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Emitindo...</>
                ) : (
                  "Faturar NFS-e (Serviço)"
                )}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
