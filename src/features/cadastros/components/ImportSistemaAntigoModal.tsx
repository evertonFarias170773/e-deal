"use client";

import { useEffect, useState } from "react";
import { X, Sparkles, Loader2, AlertTriangle, CheckCircle } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { validateCadastroInitialStep } from "@/features/cadastros/services/cadastros.service";
import type { VendedorOption } from "@/features/cadastros/services/cadastros.service";

interface ImportSistemaAntigoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (data: ExtractedData) => void;
  vendedorOptions: VendedorOption[];
}

export interface ExtractedData {
  cliente: {
    id_cliente: string;
    tipo_pessoa: string;
    documento: string;
    nome: string;
    fantasia: string;
    apelido: string;
    contato: string;
    ins_estadual: string;
    ins_municipal?: string;
    email: string;
    email_contato: string;
    telefone_fixo: string;
    whatsapp_1: string;
    whatsapp_2: string;
    senha_importada: string;
    nome_vendedor: string;
    site?: string;
    obs: string;
  };
  endereco: {
    cep: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    tipo_endereco: string;
  };
  contatos: Array<{
    nome_contato: string;
    cargo: string;
    whats: string;
    e_mail: string;
  }>;
  metadados: {
    origem: string;
    data_cadastro_origem?: string;
    data_atualizacao_origem?: string;
  };
  avisos: string[];
}

export function ImportSistemaAntigoModal({
  isOpen,
  onClose,
  onApply,
  vendedorOptions
}: ImportSistemaAntigoModalProps) {
  const { showToast } = useAppToast();
  const [rawText, setRawText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  
  // Estados de Validação de Duplicidades
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationSuccess, setValidationSuccess] = useState<boolean>(false);
  const [conflictLink, setConflictLink] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRawText("");
      setExtracted(null);
      setValidationError(null);
      setValidationSuccess(false);
      setConflictLink(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleExtract() {
    if (!rawText.trim() || rawText.trim().length < 50) {
      showToast({
        type: "error",
        title: "Texto muito curto",
        description: "Cole o texto completo do cadastro do cliente (mínimo 50 caracteres)."
      });
      return;
    }

    setIsProcessing(true);
    setExtracted(null);
    setValidationError(null);
    setValidationSuccess(false);
    setConflictLink(null);

    try {
      const response = await fetch("/api/cadastros/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: rawText.trim() })
      });

      const data = await response.json();

      if (!response.ok) {
        showToast({
          type: "error",
          title: "Erro de extração",
          description: data.error || "Ocorreu uma falha ao contatar a IA."
        });
        setIsProcessing(false);
        return;
      }

      setExtracted(data);
      showToast({
        type: "success",
        title: "Dados extraídos com sucesso",
        description: "Revise as informações antes de aplicar ao formulário."
      });

      // Rodar validação de duplicidade automaticamente
      const idCliente = Number(data.cliente?.id_cliente);
      const docDigits = (data.cliente?.documento || "").replace(/\D/g, "");

      if (idCliente || docDigits) {
        setIsValidating(true);
        const valRes = await validateCadastroInitialStep({
          idCliente: idCliente || 999999, // fallback se não vier ID
          documentoDigits: docDigits
        });
        setIsValidating(false);

        if (valRes.idConflict) {
          setValidationError(`Já existe um cliente cadastrado com o ID ${valRes.idConflict.idCliente} (${valRes.idConflict.nome}).`);
          setConflictLink(`/cadastros/${valRes.idConflict.idCliente}`);
        } else if (valRes.documentoConflict) {
          setValidationError(`Já existe um cliente cadastrado com este documento (CNPJ/CPF) no ID ${valRes.documentoConflict.idCliente} (${valRes.documentoConflict.nome}).`);
          setConflictLink(`/cadastros/${valRes.documentoConflict.idCliente}`);
        } else {
          setValidationSuccess(true);
        }
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro de processamento",
        description: err instanceof Error ? err.message : "Erro desconhecido ao tentar processar."
      });
    } finally {
      setIsProcessing(false);
    }
  }

  function handleConfirmApply() {
    if (!extracted) return;

    if (validationError) {
      showToast({
        type: "error",
        title: "Importação bloqueada",
        description: "Não é possível aplicar os dados pois existem conflitos de duplicidade."
      });
      return;
    }

    onApply(extracted);
    showToast({
      type: "success",
      title: "Dados aplicados",
      description: "O formulário foi preenchido. Revise os campos e clique em Salvar."
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
      <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-3xl bg-white shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 p-5 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-teal-600 animate-pulse" />
              <h2 className="text-xl font-bold text-slate-900">Importar do Sistema Antigo</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Cole o texto bruto copiado da tela do cliente do sistema antigo para preencher o formulário de cadastro de forma assistida.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Input Area */}
          <div className="space-y-2">
            <label htmlFor="raw_text_import" className="text-xs font-semibold text-slate-700">
              Texto bruto copiado do sistema antigo <span className="text-red-500">*</span>
            </label>
            <textarea
              id="raw_text_import"
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              disabled={isProcessing}
              placeholder="Cole aqui o texto contendo os dados pessoais, endereço e contatos do cliente..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100 disabled:opacity-50 font-mono text-xs"
            />
            <div className="flex justify-between items-center pt-1">
              <span className="text-[10px] text-slate-400">
                {rawText.length} / 10000 caracteres
              </span>
              <button
                type="button"
                onClick={handleExtract}
                disabled={isProcessing || rawText.trim().length < 50}
                className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processando com IA...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Extrair dados com IA
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Validation Alert */}
          {validationError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 flex gap-3 items-start animate-fade-in">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-red-600" />
              <div className="text-xs">
                <p className="font-semibold">Erro de Duplicidade Encontrado</p>
                <p className="mt-1 leading-relaxed">{validationError}</p>
                {conflictLink && (
                  <a
                    href={conflictLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block font-bold text-red-950 underline hover:text-red-900"
                  >
                    Clique aqui para abrir o cadastro existente
                  </a>
                )}
              </div>
            </div>
          )}

          {validationSuccess && (
            <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4 text-teal-800 flex gap-3 items-start animate-fade-in">
              <CheckCircle className="h-5 w-5 mt-0.5 shrink-0 text-teal-600" />
              <div className="text-xs">
                <p className="font-semibold">Cadastro validado para importação</p>
                <p className="mt-1 leading-relaxed">Nenhum conflito de ID ou documento encontrado.</p>
              </div>
            </div>
          )}

          {/* Preview Area */}
          {extracted && (
            <div className="space-y-4 border-t border-slate-100 pt-6 animate-fade-in">
              <h3 className="text-sm font-bold text-slate-800">Prévia dos dados detectados para revisão</h3>
              
              <div className="grid gap-4 md:grid-cols-3">
                {/* Cliente */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                  <h4 className="text-xs font-bold text-[#0b2f4a] border-b border-slate-200 pb-1.5">Dados Principais</h4>
                  <ul className="text-xs space-y-1.5 text-slate-700">
                    <li><strong>ID do Cliente:</strong> {extracted.cliente.id_cliente || "-"}</li>
                    <li><strong>Razão Social:</strong> {extracted.cliente.nome || "-"}</li>
                    <li><strong>Nome Fantasia:</strong> {extracted.cliente.fantasia || "-"}</li>
                    <li><strong>Apelido:</strong> {extracted.cliente.apelido || "-"}</li>
                    <li><strong>Tipo Pessoa:</strong> {extracted.cliente.tipo_pessoa || "-"}</li>
                    <li><strong>Documento:</strong> {extracted.cliente.documento || "-"}</li>
                    <li><strong>IE:</strong> {extracted.cliente.ins_estadual || "-"}</li>
                    {extracted.cliente.ins_municipal && <li><strong>IM:</strong> {extracted.cliente.ins_municipal}</li>}
                    {extracted.cliente.site && <li><strong>Site:</strong> {extracted.cliente.site}</li>}
                    <li><strong>E-mail:</strong> {extracted.cliente.email || "-"}</li>
                    <li><strong>Telefone:</strong> {extracted.cliente.telefone_fixo || "-"}</li>
                    <li><strong>WhatsApp:</strong> {extracted.cliente.whatsapp_1 || "-"}</li>
                    {extracted.cliente.senha_importada && (
                      <li className="rounded bg-yellow-50 p-1 border border-yellow-100 text-yellow-800 text-[10px]">
                        <strong>Senha Detectada:</strong> {extracted.cliente.senha_importada}
                        <br />
                        <span className="text-yellow-600 font-medium">⚠️ A senha não será salva por segurança.</span>
                      </li>
                    )}
                    <li><strong>Atendente/Vendedor:</strong> {extracted.cliente.nome_vendedor || "-"}</li>
                  </ul>
                </div>

                {/* Endereço */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                  <h4 className="text-xs font-bold text-[#0b2f4a] border-b border-slate-200 pb-1.5">Endereço Principal</h4>
                  <ul className="text-xs space-y-1.5 text-slate-700">
                    <li><strong>CEP:</strong> {extracted.endereco.cep || "-"}</li>
                    <li><strong>Logradouro:</strong> {extracted.endereco.endereco || "-"}</li>
                    <li><strong>Número:</strong> {extracted.endereco.numero || "-"}</li>
                    <li><strong>Complemento:</strong> {extracted.endereco.complemento || "-"}</li>
                    <li><strong>Bairro:</strong> {extracted.endereco.bairro || "-"}</li>
                    <li><strong>Cidade:</strong> {extracted.endereco.cidade || "-"}</li>
                    <li><strong>UF:</strong> {extracted.endereco.uf || "-"}</li>
                  </ul>
                </div>

                {/* Contatos */}
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 space-y-3">
                  <h4 className="text-xs font-bold text-[#0b2f4a] border-b border-slate-200 pb-1.5">Contatos Adicionais ({extracted.contatos?.length || 0})</h4>
                  {extracted.contatos && extracted.contatos.length > 0 ? (
                    <div className="space-y-3">
                      {extracted.contatos.map((c, idx) => (
                        <div key={idx} className="border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                          <p className="text-xs font-bold text-slate-800">{c.nome_contato || "Contato sem nome"}</p>
                          <ul className="text-[11px] text-slate-600 space-y-0.5">
                            {c.cargo && <li><strong>Cargo:</strong> {c.cargo}</li>}
                            {c.whats && <li><strong>Whats:</strong> {c.whats}</li>}
                            {c.e_mail && <li><strong>E-mail:</strong> {c.e_mail}</li>}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 italic">Nenhum contato secundário extraído.</p>
                  )}
                </div>
              </div>

              {/* Avisos */}
              {extracted.avisos && extracted.avisos.length > 0 && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-800 text-xs">
                  <p className="font-semibold mb-1">Notas e Avisos da IA:</p>
                  <ul className="list-disc pl-4 space-y-1">
                    {extracted.avisos.map((aviso, idx) => (
                      <li key={idx}>{aviso}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-slate-100 p-5 shrink-0 bg-slate-50">
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirmApply}
            disabled={!extracted || isProcessing || isValidating || !!validationError}
            className="rounded-2xl bg-teal-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Aplicar ao Formulário
          </button>
        </div>
      </div>
    </div>
  );
}
