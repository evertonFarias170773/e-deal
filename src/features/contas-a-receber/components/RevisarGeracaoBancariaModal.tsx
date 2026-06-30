"use client";

import { useState, useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { FileText, X, Loader2, Info, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import { useAppToast } from "@/components/common/AppToast";
import { updateBoletoInDb, registerBoletoViaN8n, deleteBoletoFromBankViaN8n } from "@/features/nfe/services/nfe.service";
import type { SupabaseBoletoRow } from "@/features/contas-a-receber/types.supabase";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";

function Alert({ children }: { children: React.ReactNode; variant?: string }) {
  return (
    <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs flex items-start gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-red-500" />
      <span className="font-medium">{children}</span>
    </div>
  );
}

function getResolvedPdfUrl(urlOrPath?: string): string {
  if (!urlOrPath) return "";
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    return urlOrPath;
  }
  const parts = urlOrPath.split("/");
  if (parts.length > 1) {
    const bucket = parts[0];
    const path = parts.slice(1).join("/");
    const client = getSupabaseClient();
    if (client) {
      const { data } = client.storage.from(bucket).getPublicUrl(path);
      if (data?.publicUrl) {
        return data.publicUrl;
      }
    }
  }
  return urlOrPath;
}

interface RevisarGeracaoBancariaModalProps {
  isOpen: boolean;
  onClose: () => void;
  extReference: string;
  nomeCliente?: string;
  valorTotalNf?: number;
  idInt?: number;
  onSaveSuccess?: () => void;
}

export function RevisarGeracaoBancariaModal({
  isOpen,
  onClose,
  extReference,
  nomeCliente,
  valorTotalNf,
  idInt,
  onSaveSuccess
}: RevisarGeracaoBancariaModalProps) {
  const { showToast } = useAppToast();
  const { recalcularBoletoIdIntsLocal } = useCobrancas();
  const [boletosForReview, setBoletosForReview] = useState<SupabaseBoletoRow[]>([]);
  const [isLoadingReviewBoletos, setIsLoadingReviewBoletos] = useState(false);
  const [isSavingReview, setIsSavingReview] = useState(false);

  const [registeringBoletoId, setRegisteringBoletoId] = useState<string | null>(null);
  const [confirmRegisterBoleto, setConfirmRegisterBoleto] = useState<SupabaseBoletoRow | null>(null);
  const [deletingBoletoId, setDeletingBoletoId] = useState<string | null>(null);
  const [confirmDeleteBoleto, setConfirmDeleteBoleto] = useState<SupabaseBoletoRow | null>(null);
  const [boletoErrors, setBoletoErrors] = useState<Record<string, string>>({});

  const [isRegisteringAll, setIsRegisteringAll] = useState(false);
  const [currentRegisterIndex, setCurrentRegisterIndex] = useState(0);
  const [totalToRegister, setTotalToRegister] = useState(0);
  const [confirmRegisterAll, setConfirmRegisterAll] = useState(false);

  const [cadastralErrors, setCadastralErrors] = useState<string[]>([]);
  const [idCliente, setIdCliente] = useState<number | null>(null);
  const [refreshValidationTrigger, setRefreshValidationTrigger] = useState(0);

  const [isUsingFallbackEmail, setIsUsingFallbackEmail] = useState(false);
  const [fallbackEmailOverride, setFallbackEmailOverride] = useState("");
  const [fallbackEmailConfirmed, setFallbackEmailConfirmed] = useState(false);

  const revalidateCadastro = () => {
    setRefreshValidationTrigger(prev => prev + 1);
  };

  useEffect(() => {
    if (!isOpen || !extReference) return;

    async function fetchBoletosAndValidate() {
      setIsLoadingReviewBoletos(true);
      setBoletosForReview([]);
      setCadastralErrors([]);
      setBoletoErrors({});
      setIdCliente(null);
      try {
        const client = getSupabaseClient();
        if (client) {
          const { data, error } = await client
            .from("boletos")
            .select("*")
            .eq("ext_reference", extReference)
            .order("parcela", { ascending: true });
          if (error) throw error;
          setBoletosForReview(data || []);

          if (data && data.length > 0) {
            const firstBoleto = data[0];
            const idCli = firstBoleto.id_cliente;
            const idEmp = firstBoleto.id_empresa;
            if (idCli) {
              setIdCliente(idCli);

              // 1. Buscar e-mail do cliente
              const { data: cliData } = await client
                .from("clientes")
                .select("email, email_financeiro, email_contato, documento")
                .eq("id_cliente", idCli)
                .maybeSingle();

              let email = "";
              let documentRaw = firstBoleto.documento || "";
              if (cliData) {
                email = (String(cliData.email_financeiro || cliData.email || cliData.email_contato || "")).trim();
                if (cliData.documento && !documentRaw) {
                  documentRaw = cliData.documento;
                }
              }

              // Fallback de E-mail do ERP
              const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
              let finalEmail = email;
              let neededFallback = false;
              if (!email || !EMAIL_REGEX.test(email)) {
                neededFallback = true;
                if (idEmp === 1) {
                  finalEmail = "financeiro@ingressoideal.com.br";
                } else if (idEmp === 3) {
                  finalEmail = "financeiro@e3brindes.com.br";
                } else {
                  finalEmail = "financeiro@pay-ideal.com.br";
                }
                if (!isUsingFallbackEmail) {
                  setFallbackEmailOverride(finalEmail);
                }
              }

              setIsUsingFallbackEmail(neededFallback);
              if (neededFallback) {
                finalEmail = fallbackEmailOverride || finalEmail;
              }

              // 2. Buscar endereço principal ou fallback
              let { data: addrData } = await client
                .from("enderecos")
                .select("endereco, numero, complemento, bairro, cidade, uf, cep")
                .eq("id_cliente", idCli)
                .eq("tipo_endereco", "Principal")
                .maybeSingle();

              if (!addrData) {
                const { data: fallbackAddr } = await client
                  .from("enderecos")
                  .select("endereco, numero, complemento, bairro, cidade, uf, cep")
                  .eq("id_cliente", idCli)
                  .limit(1);

                if (fallbackAddr && fallbackAddr.length > 0) {
                  addrData = fallbackAddr[0];
                }
              }

              const errors: string[] = [];

              // Validar Documento
              const docDigits = String(documentRaw).replace(/\D/g, "");
              if (!documentRaw) {
                errors.push("Documento do cliente (CPF/CNPJ) está pendente.");
              } else if (!docDigits) {
                errors.push("Documento do cliente é inválido (deve conter apenas dígitos).");
              } else if (docDigits.length !== 11 && docDigits.length !== 14) {
                errors.push(`Documento é inválido (esperado 11 dígitos para CPF ou 14 dígitos para CNPJ, mas possui ${docDigits.length}).`);
              }

              // Validar E-mail
              if (!finalEmail || !EMAIL_REGEX.test(finalEmail)) {
                errors.push("E-mail do cliente é inválido ou está pendente.");
              }

              // Validar Endereço
              if (!addrData) {
                errors.push("Nenhum endereço cadastrado para o cliente.");
              } else {
                if (!addrData.endereco) errors.push("Logradouro do endereço está pendente.");
                if (!addrData.numero) errors.push("Número do endereço está pendente.");
                if (!addrData.cidade) errors.push("Cidade do endereço está pendente.");
                if (!addrData.uf) errors.push("UF do endereço está pendente.");
                if (!addrData.cep) {
                  errors.push("CEP do endereço está pendente.");
                } else {
                  const cepDigits = String(addrData.cep).replace(/\D/g, "");
                  if (cepDigits.length !== 8) {
                    errors.push(`CEP do endereço é inválido (esperado 8 dígitos, mas possui ${cepDigits.length}).`);
                  }
                }
              }

              setCadastralErrors(errors);
            }
          }
        }
      } catch (err) {
        console.error("[RevisarGeracaoBancariaModal] failed to fetch boletos/validate:", err);
        showToast({ type: "error", title: "Erro ao carregar boletos ou validar cadastro." });
      } finally {
        setIsLoadingReviewBoletos(false);
      }
    }

    void fetchBoletosAndValidate();
  }, [isOpen, extReference, showToast, refreshValidationTrigger]);

  const handleBoletoChange = (index: number, field: keyof SupabaseBoletoRow, value: SupabaseBoletoRow[keyof SupabaseBoletoRow]) => {
    setBoletosForReview(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleRegisterBoleto = async (boleto: SupabaseBoletoRow) => {
    if (boleto.deposito_conta) {
      showToast({
        type: "warning",
        title: "Aviso",
        description: "Depósito em conta não é elegível para registro bancário."
      });
      return;
    }

    setRegisteringBoletoId(boleto.id);
    setBoletoErrors(prev => {
      const next = { ...prev };
      delete next[boleto.id];
      return next;
    });

    const client = getSupabaseClient();
    if (!client) {
      showToast({
        type: "error",
        title: "Erro",
        description: "Cliente Supabase não inicializado."
      });
      setRegisteringBoletoId(null);
      return;
    }

    try {
      // 1. Salvar alterações locais do boleto no banco de dados antes de registrar
      const { error: preSaveError } = await client
        .from("boletos")
        .update({
          vencimento: boleto.vencimento ? new Date(String(boleto.vencimento)).toISOString().split('T')[0] : null,
          valor: boleto.valor !== null && boleto.valor !== undefined ? Number(boleto.valor) : null,
          descricao: boleto.descricao ? String(boleto.descricao) : null,
          deposito_conta: !!boleto.deposito_conta,
          multa: boleto.multa !== null && boleto.multa !== undefined ? Number(boleto.multa) : null,
          juros_dia: boleto.juros_dia !== null && boleto.juros_dia !== undefined ? Number(boleto.juros_dia) : null,
        })
        .eq("id", boleto.id);

      if (preSaveError) {
        throw new Error(`Erro ao atualizar dados do boleto antes do registro: ${preSaveError.message}`);
      }

      // 2. Chamar o webhook
      const result = await registerBoletoViaN8n(boleto, isUsingFallbackEmail ? fallbackEmailOverride : undefined);
      console.log("[RevisarGeracaoBancariaModal] Retorno do webhook n8n para boleto individual:", JSON.stringify(result, null, 2));

      // 3. Atualizar dados retornados
      if (result && result.data) {
        const c6Data = result.data;

        // Validar status retornado (limitar aos status financeiros padronizados do ERP)
        let validatedStatus = "A_VENCER";
        if (c6Data.status && ["A_RECEBER", "A_VENCER", "PAID", "CANCELADO"].includes(String(c6Data.status))) {
          validatedStatus = String(c6Data.status);
        }

        const dbUpdates: Record<string, string | null> = {
          status: validatedStatus
        };
        const idBoleto = c6Data.id_boleto_c6 || c6Data.id;
        const nossoNumero = c6Data.nosso_numero || c6Data.our_number;
        const linhaDigitavel = c6Data.linha_digitavel || c6Data.digitable_line;
        const codigoBarras = c6Data.codigo_barras || c6Data.bar_code;
        const urlPdf = c6Data.url_pdf || c6Data.pdf_url || c6Data.pdfUrl || c6Data.urlPdf || c6Data.pdf_storage || c6Data.url || c6Data.pdf || c6Data.caminho_pdf || c6Data.boleto_pdf || null;
        const pdfStorage = c6Data.pdf_storage || c6Data.pdfStorage || c6Data.storage_path || null;

        if (idBoleto) dbUpdates.id_boleto_c6 = idBoleto;
        if (nossoNumero) dbUpdates.nosso_numero = nossoNumero;
        if (linhaDigitavel) dbUpdates.linha_digitavel = linhaDigitavel;
        if (codigoBarras) dbUpdates.codigo_barras = codigoBarras;
        if (urlPdf) dbUpdates.url_pdf = urlPdf;
        if (pdfStorage) dbUpdates.pdf_storage = pdfStorage;

        if (Object.keys(dbUpdates).length > 0) {
          const { error: updateError } = await client
            .from("boletos")
            .update(dbUpdates)
            .eq("id", boleto.id);

          if (updateError) {
            console.error("[RevisarGeracaoBancariaModal] falha ao atualizar boletos com retorno C6:", updateError);
            throw new Error(`Boleto registrado, mas erro ao salvar dados no banco: ${updateError.message}`);
          }
        }
      }

      showToast({
        type: "success",
        title: "Sucesso!",
        description: "Boleto registrado com sucesso no banco."
      });

      // 4. Reler do Supabase para atualizar a listagem local
      const { data: updatedBoleto, error: fetchError } = await client
        .from("boletos")
        .select("*")
        .eq("id", boleto.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (updatedBoleto) {
        setBoletosForReview(prev =>
          prev.map(b => b.id === boleto.id ? updatedBoleto : b)
        );
        if (updatedBoleto.id_int) {
          await recalcularBoletoIdIntsLocal(Number(updatedBoleto.id_int));
        }
      }

      if (onSaveSuccess) {
        onSaveSuccess();
      }
    } catch (err) {
      console.error("[RevisarGeracaoBancariaModal] failed to register boleto:", err);
      const errMsg = err instanceof Error ? err.message : "Erro ao registrar boleto no banco.";
      setBoletoErrors(prev => ({ ...prev, [boleto.id]: errMsg }));
      showToast({
        type: "error",
        title: "Erro ao registrar boleto",
        description: errMsg
      });
    } finally {
      setRegisteringBoletoId(null);
    }
  };

  const handleDeleteBoleto = async (boleto: SupabaseBoletoRow) => {
    if (!boleto.id_boleto_c6) return;
    setDeletingBoletoId(boleto.id);
    setBoletoErrors(prev => {
      const next = { ...prev };
      delete next[boleto.id];
      return next;
    });
    try {
      await deleteBoletoFromBankViaN8n(boleto.id, String(boleto.id_boleto_c6), Number(boleto.id_empresa || 1));
      const client = getSupabaseClient();

      if (client) {
        // Fallback local no Supabase por segurança: marcar como CANCELADO mas manter histórico do C6
        const { error: updateError } = await client
          .from("boletos")
          .update({
            status: "CANCELADO"
          })
          .eq("id", boleto.id);

        if (updateError) {
          console.error("[RevisarGeracaoBancariaModal] failed fallback update for delete:", updateError);
        }

        // Reler do Supabase para refletir o estado correto e final
        const { data: updatedBoleto, error } = await client
          .from("boletos")
          .select("*")
          .eq("id", boleto.id)
          .maybeSingle();

        if (error) throw error;

        if (updatedBoleto) {
          setBoletosForReview(prev =>
            prev.map(b => b.id === boleto.id ? updatedBoleto : b)
          );
        }
      }

      showToast({
        type: "success",
        title: "Boleto removido do banco. O contas a receber foi mantido."
      });

      if (boleto.id_int) {
        await recalcularBoletoIdIntsLocal(Number(boleto.id_int));
      }

      if (onSaveSuccess) {
        onSaveSuccess();
      }
    } catch (err) {
      console.error("[RevisarGeracaoBancariaModal] failed to delete boleto:", err);
      showToast({
        type: "error",
        title: "Erro ao excluir boleto",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setDeletingBoletoId(null);
    }
  };

  const handleRegisterAllBoletos = async () => {
    const idIntDoModal = idInt;
    if (!idIntDoModal) {
      showToast({
        type: "error",
        title: "Erro de Associação",
        description: "Não foi possível determinar o id_int da proposta atual do modal para registrar os boletos em lote."
      });
      return;
    }

    // Filtrar boletos elegíveis da listagem atual
    const eligible = boletosForReview.filter(b => {
      const statusStr = String(b.status || "").trim().toUpperCase();
      if (statusStr === "CANCELADO") return false;
      if (b.deposito_conta) return false;
      if (b.id_boleto_c6 || b.linha_digitavel || b.codigo_barras) return false;
      if (b.valor === null || b.valor === undefined || Number(b.valor) <= 0) return false;
      if (!b.vencimento) return false;
      return true;
    });

    if (eligible.length === 0) {
      showToast({
        type: "info",
        title: "Nenhum boleto elegível",
        description: "Todos os boletos já estão registrados ou não são elegíveis."
      });
      return;
    }

    // Trava de segurança: COUNT(DISTINCT id_int) = 1
    const distinctIdInts = new Set(eligible.map(b => Number(b.id_int)).filter(Boolean));
    if (distinctIdInts.size > 1) {
      showToast({
        type: "error",
        title: "Trava de Segurança de Lote",
        description: "Não é permitido registrar em lote boletos de propostas diferentes (Múltiplos id_int detectados)."
      });
      return;
    }

    // Garantir explicitamente que todos os boletos processados possuem boleto.id_int === idInt do modal/proposta atual
    const hasDifferentIdInt = eligible.some(b => Number(b.id_int) !== Number(idIntDoModal));
    if (hasDifferentIdInt) {
      showToast({
        type: "error",
        title: "Trava de Segurança de Lote",
        description: `Todos os boletos elegíveis devem pertencer ao id_int ${idIntDoModal} da proposta atual.`
      });
      return;
    }

    setIsRegisteringAll(true);
    setCurrentRegisterIndex(0);
    setTotalToRegister(eligible.length);

    try {
      const client = getSupabaseClient();
      if (!client) throw new Error("Cliente Supabase não inicializado.");

      for (let i = 0; i < eligible.length; i++) {
        setCurrentRegisterIndex(i);
        const boleto = eligible[i];

        if (Number(boleto.id_int) !== Number(idIntDoModal)) {
          throw new Error(`[Boleto Parcela ${boleto.parcela}] Erro: id_int do boleto (${boleto.id_int}) é divergente do id_int do modal atual (${idIntDoModal}).`);
        }

        try {
          setBoletoErrors(prev => {
            const next = { ...prev };
            delete next[boleto.id];
            return next;
          });

          const { error: preSaveError } = await client
            .from("boletos")
            .update({
              vencimento: boleto.vencimento ? new Date(String(boleto.vencimento)).toISOString().split('T')[0] : null,
              valor: boleto.valor !== null && boleto.valor !== undefined ? Number(boleto.valor) : null,
              descricao: boleto.descricao ? String(boleto.descricao) : null,
              deposito_conta: !!boleto.deposito_conta,
              multa: boleto.multa !== null && boleto.multa !== undefined ? Number(boleto.multa) : null,
              juros_dia: boleto.juros_dia !== null && boleto.juros_dia !== undefined ? Number(boleto.juros_dia) : null,
            })
            .eq("id", boleto.id);

          if (preSaveError) {
            throw new Error(`Erro ao atualizar dados antes do registro: ${preSaveError.message}`);
          }

          const result = await registerBoletoViaN8n(boleto, isUsingFallbackEmail ? fallbackEmailOverride : undefined);
          console.log("[RevisarGeracaoBancariaModal] Retorno do webhook n8n para boleto em lote:", JSON.stringify(result, null, 2));

          if (result && result.data) {
            const c6Data = result.data;
            let validatedStatus = "A_VENCER";
            if (c6Data.status && ["A_RECEBER", "A_VENCER", "PAID", "CANCELADO"].includes(String(c6Data.status))) {
              validatedStatus = String(c6Data.status);
            }

            const dbUpdates: Record<string, string | null> = {
              status: validatedStatus
            };
            const idBoleto = c6Data.id_boleto_c6 || c6Data.id;
            const nossoNumero = c6Data.nosso_numero || c6Data.our_number;
            const linhaDigitavel = c6Data.linha_digitavel || c6Data.digitable_line;
            const codigoBarras = c6Data.codigo_barras || c6Data.bar_code;
            const urlPdf = c6Data.url_pdf || c6Data.pdf_url || c6Data.pdfUrl || c6Data.urlPdf || c6Data.pdf_storage || c6Data.url || c6Data.pdf || c6Data.caminho_pdf || c6Data.boleto_pdf || null;
            const pdfStorage = c6Data.pdf_storage || c6Data.pdfStorage || c6Data.storage_path || null;

            if (idBoleto) dbUpdates.id_boleto_c6 = idBoleto;
            if (nossoNumero) dbUpdates.nosso_numero = nossoNumero;
            if (linhaDigitavel) dbUpdates.linha_digitavel = linhaDigitavel;
            if (codigoBarras) dbUpdates.codigo_barras = codigoBarras;
            if (urlPdf) dbUpdates.url_pdf = urlPdf;
            if (pdfStorage) dbUpdates.pdf_storage = pdfStorage;

            if (Object.keys(dbUpdates).length > 0) {
              const { error: updateError } = await client
                .from("boletos")
                .update(dbUpdates)
                .eq("id", boleto.id);

              if (updateError) {
                throw new Error(`Boleto registrado, mas erro ao salvar dados no banco: ${updateError.message}`);
              }
            }
          }

          const { data: updatedBoleto, error: fetchError } = await client
            .from("boletos")
            .select("*")
            .eq("id", boleto.id)
            .maybeSingle();

          if (fetchError) throw fetchError;

          if (updatedBoleto) {
            setBoletosForReview(prev =>
              prev.map(b => b.id === boleto.id ? updatedBoleto : b)
            );

            if (updatedBoleto.id_int) {
              await recalcularBoletoIdIntsLocal(Number(updatedBoleto.id_int));
            }
          }

        } catch (innerErr) {
          const innerMsg = innerErr instanceof Error ? innerErr.message : "Erro desconhecido.";
          setBoletoErrors(prev => ({ ...prev, [boleto.id]: innerMsg }));
          throw new Error(`[Boleto Parcela ${boleto.parcela}] ${innerMsg}`);
        }
      }

      showToast({
        type: "success",
        title: "Sucesso!",
        description: `Todos os ${eligible.length} boletos foram registrados com sucesso.`
      });

      if (onSaveSuccess) {
        onSaveSuccess();
      }

    } catch (err) {
      console.error("[RevisarGeracaoBancariaModal] Erro ao registrar boletos em lote:", err);
      showToast({
        type: "error",
        title: "Registro em Lote Interrompido",
        description: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsRegisteringAll(false);
    }
  };

  const handleSaveReview = async () => {
    setIsSavingReview(true);
    try {
      for (const b of boletosForReview) {
        await updateBoletoInDb(b.id, {
          vencimento: b.vencimento ? new Date(String(b.vencimento)).toISOString().split('T')[0] : undefined,
          valor: b.valor !== null && b.valor !== undefined ? Number(b.valor) : undefined,
          descricao: b.descricao ? String(b.descricao) : undefined,
          deposito_conta: !!b.deposito_conta,
          multa: b.multa !== null && b.multa !== undefined ? Number(b.multa) : null,
          juros_dia: b.juros_dia !== null && b.juros_dia !== undefined ? Number(b.juros_dia) : null,
        });
      }
      showToast({
        type: "success",
        title: "Sucesso!",
        description: "Os boletos foram atualizados com sucesso."
      });
      if (onSaveSuccess) {
        onSaveSuccess();
      }
      onClose();
    } catch (err) {
      console.error("[RevisarGeracaoBancariaModal] error saving boletos:", err);
      showToast({
        type: "error",
        title: "Erro ao salvar",
        description: "Ocorreu um erro ao atualizar os boletos no banco."
      });
    } finally {
      setIsSavingReview(false);
    }
  };

  if (!isOpen) return null;

  const displayCliente = nomeCliente || boletosForReview[0]?.nome_cliente || "Sem nome";
  const displayDoc = boletosForReview[0]?.documento || "Não informado";
  const displayTotalNf = valorTotalNf !== undefined
    ? valorTotalNf
    : boletosForReview.reduce((acc, b) => acc + Number(b.valor || 0), 0);

  return (
    <>
      <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-3xl w-full overflow-hidden flex flex-col transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="px-6 py-5 flex items-center justify-between border-b border-slate-100">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl shrink-0">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 leading-tight">
                  Revisar para Geração Bancária
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">Ref: {extReference}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 hover:bg-slate-100 rounded-xl transition text-slate-400 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content Area */}
          <div className="px-6 py-6 overflow-y-auto max-h-[70vh] space-y-6">
            {isLoadingReviewBoletos ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-500">
                <Loader2 className="h-8 w-8 animate-spin text-[#0b2f4a]" />
                <span className="text-sm font-medium">Carregando boletos...</span>
              </div>
            ) : boletosForReview.length === 0 ? (
              <div className="text-center py-12 text-slate-500 font-medium">
                Nenhum boleto encontrado para esta nota fiscal.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Info da Nota */}
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-wrap gap-x-8 gap-y-3 text-xs text-slate-600">
                  <div>
                    <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Cliente</span>
                    <strong className="text-slate-800 text-sm font-medium">
                      {displayCliente}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Documento</span>
                    <strong className="text-slate-800 text-sm font-mono font-medium">
                      {displayDoc}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase tracking-wider text-[9px] font-bold">Valor Total NF</span>
                    <strong className="text-slate-800 text-sm font-medium">
                      {formatCurrency(displayTotalNf)}
                    </strong>
                  </div>
                </div>

                {/* Avisos Cadastrais */}
                {cadastralErrors.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-3xl p-4 space-y-3 font-sans">
                    <div className="flex items-start gap-3 text-amber-800">
                      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5 text-amber-600" />
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-950">
                          Dados Cadastrais Incompletos / Inválidos
                        </h4>
                        <p className="text-xs mt-1 text-amber-700 leading-normal">
                          O registro bancário está bloqueado devido às seguintes pendências no cadastro do cliente:
                        </p>
                        <ul className="list-disc list-inside text-xs mt-2 space-y-1 font-medium text-amber-950">
                          {cadastralErrors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    
                    {idCliente && (
                      <div className="pt-1 flex items-center gap-3">
                        <a
                          href={`/cadastros/${idCliente}/editar`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition"
                        >
                          Editar Cadastro do Cliente
                        </a>
                        <button
                          type="button"
                          onClick={revalidateCadastro}
                          className="px-3 py-1.5 bg-white border border-amber-300 hover:bg-amber-100/50 text-amber-800 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition"
                        >
                          Re-validar Cadastro
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Bloco Fallback de E-mail */}
                {isUsingFallbackEmail && cadastralErrors.length === 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-3xl p-4 space-y-3 font-sans">
                    <div className="flex items-start gap-3 text-blue-800">
                      <Info className="h-5 w-5 shrink-0 mt-0.5 text-blue-600" />
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-blue-950">
                          E-mail de Cliente Ausente
                        </h4>
                        <p className="text-xs mt-1 text-blue-700 leading-normal">
                          O cliente não possui e-mail cadastrado ou é inválido. Um e-mail interno será utilizado para receber o boleto pelo banco.
                        </p>
                        
                        <div className="mt-3 flex flex-col gap-2">
                          <label className="text-xs font-semibold text-blue-900">E-mail para envio:</label>
                          <input
                            type="email"
                            value={fallbackEmailOverride}
                            onChange={(e) => {
                              setFallbackEmailOverride(e.target.value);
                              setFallbackEmailConfirmed(false);
                            }}
                            className="w-full sm:w-64 px-3 py-2 text-sm border border-blue-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            placeholder="E-mail de recebimento"
                          />
                        </div>

                        <label className="mt-3 flex items-center gap-2 text-xs font-medium text-blue-900 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={fallbackEmailConfirmed}
                            onChange={(e) => setFallbackEmailConfirmed(e.target.checked)}
                            className="w-4 h-4 text-blue-600 rounded border-blue-300 focus:ring-blue-500"
                          />
                          Confirmo o uso deste e-mail para o registro bancário.
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* Lista de Boletos (Cards) */}
                <div className="space-y-4">
                  {boletosForReview.map((boleto, idx) => {
                    const isRegistered = !!(boleto.id_boleto_c6 || boleto.nosso_numero || boleto.linha_digitavel);
                    const isValDisabled = isRegistered || !!boleto.deposito_conta || boleto.status === "CANCELADO";
                    const isGeneralDisabled = isRegistered || boleto.status === "CANCELADO" || isRegisteringAll || registeringBoletoId === boleto.id;
                    const isFieldValDisabled = isValDisabled || isRegisteringAll || registeringBoletoId === boleto.id;
                    
                    return (
                      <div
                        key={boleto.id}
                        className="p-5 border border-slate-100 rounded-3xl bg-white shadow-sm space-y-4 hover:border-slate-200 transition"
                      >
                        <div className="flex items-center justify-between border-b border-slate-50 pb-3">
                          <span className="font-bold text-slate-800 text-sm">
                            Parcela {boleto.parcela}/{boleto.total_parcelas}
                          </span>
                          <div className="flex items-center gap-2">
                            {boleto.status === "CANCELADO" ? (
                              <span className="px-2 py-0.5 bg-rose-50 text-rose-700 font-bold border border-rose-200 rounded-lg text-[10px]">
                                Boleto Cancelado
                              </span>
                            ) : boleto.deposito_conta ? (
                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 rounded-lg text-[10px]">
                                Depósito em Conta
                              </span>
                            ) : isRegistered ? (
                              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 rounded-lg text-[10px]">
                                Boleto Registrado
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-slate-50 text-slate-500 font-bold border border-slate-200 rounded-lg text-[10px]">
                                Pendente de Registro
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Inputs Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {/* Valor */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Valor
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-2.5 text-xs text-slate-400 font-medium">R$</span>
                              <input
                                type="number"
                                step="0.01"
                                disabled={isFieldValDisabled}
                                value={boleto.valor !== null && boleto.valor !== undefined ? Number(boleto.valor) : ""}
                                onChange={(e) => handleBoletoChange(idx, "valor", e.target.value === "" ? null : Number(e.target.value))}
                                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white disabled:bg-slate-50 disabled:text-slate-500 focus:border-[#0b2f4a] outline-none font-mono"
                              />
                            </div>
                            {isValDisabled && (
                              <span className="text-[9px] text-slate-400 block italic leading-normal">
                                {isRegistered
                                  ? "Valor bloqueado: Boleto já registrado no banco."
                                  : "Valor bloqueado: Marcado como depósito em conta."}
                              </span>
                            )}
                          </div>

                          {/* Vencimento */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Vencimento
                            </label>
                            <input
                              type="date"
                              disabled={isGeneralDisabled}
                              value={boleto.vencimento ? String(boleto.vencimento).substring(0, 10) : ""}
                              onChange={(e) => handleBoletoChange(idx, "vencimento", e.target.value)}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none font-mono"
                            />
                          </div>

                          {/* Descrição */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Descrição
                            </label>
                            <input
                              type="text"
                              disabled={isGeneralDisabled}
                              value={boleto.descricao ? String(boleto.descricao) : ""}
                              onChange={(e) => handleBoletoChange(idx, "descricao", e.target.value)}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none"
                            />
                          </div>

                          {/* Multa */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Multa (%)
                            </label>
                            <input
                              type="number"
                              step="0.01"
                              disabled={isFieldValDisabled}
                              value={boleto.multa !== null && boleto.multa !== undefined ? Number(boleto.multa) : ""}
                              onChange={(e) => handleBoletoChange(idx, "multa", e.target.value === "" ? null : Number(e.target.value))}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none font-mono"
                            />
                          </div>

                          {/* Juros */}
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              Juros/Dia (%)
                            </label>
                            <input
                              type="number"
                              step="0.0001"
                              disabled={isFieldValDisabled}
                              value={boleto.juros_dia !== null && boleto.juros_dia !== undefined ? Number(boleto.juros_dia) : ""}
                              onChange={(e) => handleBoletoChange(idx, "juros_dia", e.target.value === "" ? null : Number(e.target.value))}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:border-[#0b2f4a] outline-none font-mono"
                            />
                          </div>

                          {/* Depósito em conta */}
                          <div className="flex items-center gap-2 pt-5 font-sans">
                            <input
                              type="checkbox"
                              id={`deposito-conta-${boleto.id}`}
                              disabled={isRegistered || boleto.status === "CANCELADO" || isRegisteringAll || registeringBoletoId === boleto.id}
                              checked={!!boleto.deposito_conta}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                handleBoletoChange(idx, "deposito_conta", checked);
                              }}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <label
                              htmlFor={`deposito-conta-${boleto.id}`}
                              className="text-xs font-semibold text-slate-700 cursor-pointer select-none"
                            >
                              Depósito em conta
                            </label>
                          </div>
                        </div>

                        {/* Bank details if registered */}
                        {isRegistered && (
                          <div className="mt-3 bg-slate-50 border border-slate-100 rounded-2xl p-3 text-[11px] text-slate-500 space-y-1 font-mono">
                            <p className="flex justify-between">
                              <span>Nosso Número:</span>
                              <strong className="text-slate-800">{boleto.nosso_numero || "N/A"}</strong>
                            </p>
                            <p className="flex justify-between">
                              <span>Linha Digitável:</span>
                              <strong className="text-slate-800">{boleto.linha_digitavel || "N/A"}</strong>
                            </p>
                            <p className="flex justify-between">
                              <span>ID C6:</span>
                              <strong className="text-slate-800">{boleto.id_boleto_c6 || "N/A"}</strong>
                            </p>
                          </div>
                        )}

                        {/* Error display */}
                        {boletoErrors[boleto.id] && (
                          <Alert variant="destructive">
                            {boletoErrors[boleto.id]}
                          </Alert>
                        )}

                        {/* Card Footer Actions */}
                        {boleto.status === "CANCELADO" ? (
                          <div className="border-t border-slate-100 pt-3 flex items-center gap-2 text-red-600 bg-red-50/50 p-2.5 rounded-xl border border-red-200/50 animate-in fade-in duration-200">
                            <Info className="h-4 w-4 shrink-0 text-red-500" />
                            <span className="text-xs font-medium">Boleto CANCELADO. Nenhuma ação disponível.</span>
                          </div>
                        ) : boleto.deposito_conta ? (
                          <div className="border-t border-slate-100 pt-3 flex items-center gap-2 text-amber-600 bg-amber-50/50 p-2.5 rounded-xl border border-amber-200/50">
                            <Info className="h-4 w-4 shrink-0 text-amber-500" />
                            <span className="text-xs font-medium">Depósito em conta não é elegível para registro bancário.</span>
                          </div>
                        ) : (
                          <div className="border-t border-slate-100 pt-3 flex flex-wrap gap-2 items-center justify-end">
                            {isRegistered ? (
                              <div className="flex flex-wrap gap-2 w-full justify-end">
                                {/* Abrir PDF */}
                                {boleto.url_pdf || boleto.pdf_storage ? (
                                  <button
                                    type="button"
                                    onClick={() => window.open(getResolvedPdfUrl(String(boleto.url_pdf || boleto.pdf_storage)), "_blank")}
                                    className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 transition rounded-xl text-xs font-semibold"
                                  >
                                    Visualizar PDF
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    className="px-3 py-1.5 bg-slate-50 text-slate-400 border border-slate-100 cursor-not-allowed rounded-xl text-xs font-semibold"
                                    title="O PDF deste boleto ainda não foi retornado pelo banco."
                                  >
                                    PDF ainda não disponível
                                  </button>
                                )}

                                {/* Copiar Linha Digitável */}
                                <button
                                  type="button"
                                  disabled={!boleto.linha_digitavel}
                                  onClick={() => {
                                    if (boleto.linha_digitavel) {
                                      void navigator.clipboard.writeText(String(boleto.linha_digitavel));
                                      showToast({ type: "success", title: "Linha digitável copiada!" });
                                    }
                                  }}
                                  className="px-3 py-1.5 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition rounded-xl text-xs font-semibold"
                                >
                                  Copiar Linha Digitável
                                </button>

                                {/* Copiar Link */}
                                <button
                                  type="button"
                                  disabled={!(boleto.url_pdf || boleto.pdf_storage)}
                                  onClick={() => {
                                    const link = getResolvedPdfUrl(String(boleto.url_pdf || boleto.pdf_storage));
                                    if (link) {
                                      void navigator.clipboard.writeText(String(link));
                                      showToast({ type: "success", title: "Link do PDF copiado!" });
                                    }
                                  }}
                                  className="px-3 py-1.5 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition rounded-xl text-xs font-semibold"
                                >
                                  Copiar Link
                                </button>

                                {/* Excluir boleto do banco */}
                                {boleto.id_boleto_c6 && boleto.status !== "PAID" && (
                                  <button
                                    type="button"
                                    disabled={deletingBoletoId === boleto.id || isRegisteringAll || isSavingReview || registeringBoletoId !== null}
                                    onClick={() => setConfirmDeleteBoleto(boleto)}
                                    className="px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 transition rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5"
                                  >
                                    {deletingBoletoId === boleto.id ? (
                                      <>
                                        <Loader2 className="h-3 w-3 animate-spin text-red-700" />
                                        Excluindo...
                                      </>
                                    ) : (
                                      "Excluir boleto do banco"
                                    )}
                                  </button>
                                )}
                              </div>
                            ) : (
                              boleto.status !== "PAID" && (
                                <button
                                  type="button"
                                  disabled={registeringBoletoId !== null || isRegisteringAll || isSavingReview || isLoadingReviewBoletos || cadastralErrors.length > 0 || (isUsingFallbackEmail && !fallbackEmailConfirmed)}
                                  title={cadastralErrors.length > 0 ? "Corrija as pendências de cadastro descritas no topo antes de registrar" : (isUsingFallbackEmail && !fallbackEmailConfirmed ? "Confirme o e-mail de recebimento no topo para registrar" : undefined)}
                                  onClick={() => setConfirmRegisterBoleto(boleto)}
                                  className="px-4 py-2 bg-[#0b2f4a] hover:bg-[#061d2e] disabled:opacity-50 text-white transition rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 min-w-[150px]"
                                >
                                  {registeringBoletoId === boleto.id ? (
                                    <>
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      Registrando...
                                    </>
                                  ) : (
                                    "Registrar boleto"
                                  )}
                                </button>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Registro Bancário Section */}
                {(() => {
                  const idIntDoModal = idInt;
                  if (!idIntDoModal) return null;
                  
                  const eligibleBoletos = boletosForReview.filter(b => {
                    const statusStr = String(b.status || "").trim().toUpperCase();
                    if (statusStr === "CANCELADO") return false;
                    if (b.deposito_conta) return false;
                    if (b.id_boleto_c6 || b.linha_digitavel || b.codigo_barras) return false;
                    if (b.valor === null || b.valor === undefined || Number(b.valor) <= 0) return false;
                    if (!b.vencimento) return false;
                    return true;
                  });

                  // Trava de lote: só renderizar se COUNT(DISTINCT id_int) = 1 e for correspondente ao modal atual
                  const distinctIdInts = new Set(eligibleBoletos.map(b => Number(b.id_int)).filter(Boolean));
                  const isLoteValido = distinctIdInts.size === 1 && Number(Array.from(distinctIdInts)[0]) === Number(idIntDoModal);

                  if (eligibleBoletos.length > 1 && isLoteValido) {
                    const hasErrors = cadastralErrors.length > 0;
                    const isLoading = isRegisteringAll;
                    // Bloqueia se houver erro ou se precisar de fallback de e-mail sem confirmação
                    const isBlocked = hasErrors || (isUsingFallbackEmail && !fallbackEmailConfirmed);
                    
                    return (
                      <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl space-y-3 font-sans">
                        <div className="flex items-center gap-2">
                          <Info className="h-4.5 w-4.5 text-blue-600" />
                          <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">Registro Bancário em Lote</span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Existem {eligibleBoletos.length} boletos elegíveis para registro no banco. Você pode registrá-los em lote abaixo ou individualmente nos cards acima.
                        </p>
                        <button
                          type="button"
                          disabled={isLoading || isBlocked || registeringBoletoId !== null || isSavingReview || isLoadingReviewBoletos}
                          title={hasErrors ? "Corrija as pendências de cadastro descritas no topo antes de registrar" : (isUsingFallbackEmail && !fallbackEmailConfirmed ? "Confirme o e-mail de recebimento para registrar" : undefined)}
                          onClick={() => setConfirmRegisterAll(true)}
                          className="w-full px-4 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          {isRegisteringAll ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              Registrando {currentRegisterIndex + 1} de {totalToRegister} boletos...
                            </>
                          ) : (
                            "Registrar todos os boletos desta proposta"
                          )}
                        </button>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSavingReview || isRegisteringAll || registeringBoletoId !== null}
              className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 disabled:opacity-50 transition rounded-xl"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveReview}
              disabled={isSavingReview || isRegisteringAll || registeringBoletoId !== null || isLoadingReviewBoletos || boletosForReview.length === 0}
              className="px-5 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] disabled:opacity-50 rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 min-w-[140px]"
            >
              {isSavingReview ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar Alterações"
              )}
            </button>
        </div>
      </div>
    </div>

      {/* Confirmation Dialog for Batch Bank Registration */}
      {confirmRegisterAll && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 bg-amber-50 text-amber-500 rounded-2xl">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">
                  Confirmar Registro em Lote
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed text-left">
                  Todos os boletos elegíveis para esta proposta serão registrados sequencialmente no banco. Deseja prosseguir?
                </p>
              </div>
            </div>
            
            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                onClick={() => setConfirmRegisterAll(false)}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmRegisterAll(false);
                  void handleRegisterAllBoletos();
                }}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition"
              >
                Registrar todos os boletos desta proposta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Bank Registration */}
      {confirmRegisterBoleto && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 bg-amber-50 text-amber-500 rounded-2xl">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">
                  Confirmar Registro Bancário
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Este boleto será registrado no banco. Após o registro, valor e vencimento não devem ser alterados livremente.
                </p>
              </div>
            </div>
            
            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                onClick={() => setConfirmRegisterBoleto(null)}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const boleto = confirmRegisterBoleto;
                  setConfirmRegisterBoleto(null);
                  void handleRegisterBoleto(boleto);
                }}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-[#0b2f4a] hover:bg-[#061d2e] rounded-xl transition"
              >
                Registrar boleto
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Bank Deletion */}
      {confirmDeleteBoleto && (
        <div className="fixed inset-0 z-[10000] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans">
          <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden p-6 transform transition-all scale-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center text-center gap-4">
              <div className="p-3 bg-red-50 text-red-500 rounded-2xl">
                <AlertTriangle className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h4 className="text-base font-bold text-slate-900">
                  Excluir boleto do banco?
                </h4>
                <p className="text-xs text-slate-500 leading-relaxed text-left">
                  Esta ação cancela/remove apenas o registro bancário do boleto no C6. O contas a receber continuará existindo no ERP e poderá ser revisado ou registrado novamente.
                </p>
              </div>
            </div>
            
            <div className="mt-6 flex items-center gap-3 justify-stretch">
              <button
                type="button"
                onClick={() => setConfirmDeleteBoleto(null)}
                className="flex-1 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-50 border border-slate-200 rounded-xl transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const boleto = confirmDeleteBoleto;
                  setConfirmDeleteBoleto(null);
                  void handleDeleteBoleto(boleto);
                }}
                className="flex-1 py-2.5 text-xs font-bold text-white bg-red-650 hover:bg-red-700 rounded-xl transition"
              >
                Excluir boleto do banco
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

