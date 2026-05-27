"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatDocument } from "@/lib/formatters/document";
import { mockCompanies } from "@/lib/mocks/empresas.mock";
import { atendentesMock } from "@/lib/mocks/cadastros.mock";
import {
  createCadastroEndereco,
  createCadastro,
  validateCadastroInitialStep,
  updateCadastroCamposOperacionaisReadOnly,
  type CadastroEnderecoInsertPayload,
  type CadastroInsertPayload,
  type CadastroOperacionalUpdatePayload
} from "@/features/cadastros/services/cadastros.service";
import { normalizeDocumentDigits, validateDocumentByTipo } from "@/features/cadastros/utils/documento";
import type {
  Cadastro,
  CadastroCategoria,
  CadastroContato,
  CadastroEndereco,
  CadastroFormState,
  CadastroVinculoComercial,
  TipoClienteDocumento
} from "@/features/cadastros/types";

type CadastroFormPageProps = {
  mode: "new" | "edit";
  cadastro?: Cadastro;
};

type FormMessage = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
};

type CadastroSavePreview = {
  payload: CadastroOperacionalUpdatePayload;
  changes: Array<{
    label: string;
    value: string;
    columns: string[];
  }>;
};

type ConsultaDocumentoApiPayload = {
  nome: string;
  fantasia: string;
  documento: string;
  tipoPessoa: "FISICA" | "JURIDICA";
  dataFundacao: string;
  emailContato: string;
  telefoneFixo: string;
  cidadeUf: string;
  insEstadual: string;
  tipoContribuinte: "CONTRIBUINTE" | "ISENTO" | "";
  enderecoPreparado: {
    id_cliente: number;
    cep: string;
    endereco: string;
    numero: string;
    complemento: string;
    bairro: string;
    cidade: string;
    uf: string;
    tipo_endereco: "PRINCIPAL";
    obs: string;
  } | null;
};

const CADASTRO_OPERACIONAL_UPDATE_FIELDS = [
  { key: "observacoes", label: "Observações", columns: ["obs"] },
  { key: "fantasia", label: "Nome fantasia / Apelido", columns: ["fantasia"] },
  { key: "telefoneFixo", label: "Telefone fixo comercial", columns: ["telefone_fixo"] },
  { key: "whatsapp", label: "WhatsApp 1", columns: ["whatsapp_1"] },
  { key: "whatsapp2", label: "WhatsApp 2", columns: ["whatsapp_2"] },
  { key: "email", label: "E-mail principal", columns: ["email_contato", "email"] },
  { key: "emailFinanceiro", label: "E-mail financeiro", columns: ["email_financeiro"] },
  { key: "site", label: "Site da empresa", columns: ["site"] }
] as const;

const CADASTRO_OPERACIONAL_BLOCKED_FIELDS: Array<{ key: keyof CadastroFormState; label: string }> = [
  { key: "idCliente", label: "ID do cliente" },
  { key: "categoria", label: "Tipo de cadastro" },
  { key: "tipoCliente", label: "Tipo de cliente" },
  { key: "documento", label: "CPF/CNPJ" },
  { key: "atendente", label: "Atendente" },
  { key: "ativo", label: "Situação / Ativo" },
  { key: "nome", label: "Razão social / Nome" },
  { key: "tipoContribuinte", label: "Tipo de contribuinte" },
  { key: "inscricaoEstadual", label: "Inscrição estadual" },
  { key: "isentoInscricaoEstadual", label: "Isento?" },
  { key: "inscricaoMunicipal", label: "Inscrição municipal" },
  { key: "empresaPadrao", label: "Empresa padrão de cobrança" },
  { key: "dataFundacao", label: "Data fundação" },
  { key: "limiteCredito", label: "Limite de crédito" },
  { key: "creditoDisponivel", label: "Crédito acumulado" },
  { key: "riscoCredito", label: "Risco financeiro" },
  { key: "padraoPagamento", label: "Formas de pagamento" },
  { key: "bonusAtivo", label: "Bônus" },
  { key: "percentualBonus", label: "Percentual bônus" },
  { key: "nota", label: "Nota" },
  { key: "restricao", label: "Restrição" },
  { key: "sendMail", label: "SendMail" },
  { key: "sendWhats", label: "SendWhats" },
  { key: "enderecos", label: "Endereços" },
  { key: "contatos", label: "Contatos" },
  { key: "vinculosComerciais", label: "Vínculos comerciais" }
];

const categoriaLabel: Record<CadastroCategoria, string> = {
  CLIENTE: "Cliente",
  FORNECEDOR: "Fornecedor",
  TRANSPORTADORA: "Transportadora",
  ORGAO_PUBLICO: "Orgao publico"
};

const categoriaOptions: CadastroCategoria[] = ["CLIENTE", "FORNECEDOR", "TRANSPORTADORA", "ORGAO_PUBLICO"];
const paymentOptions = ["Pix à vista 3 dias", "Boleto 14 dias", "Faturado 28 dias", "Cartão", "Empenho / faturado"];

export function CadastroFormPage({ mode, cadastro }: CadastroFormPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [isInitialValidated, setIsInitialValidated] = useState(mode === "edit");
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [form, setForm] = useState<CadastroFormState>(() => createInitialState(cadastro));
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialChecking, setIsInitialChecking] = useState(false);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pendingSavePreview, setPendingSavePreview] = useState<CadastroSavePreview | null>(null);
  const [preparedEnderecoInsertPayload, setPreparedEnderecoInsertPayload] = useState<CadastroEnderecoInsertPayload | null>(
    null
  );
  const originalSnapshot = useMemo(() => createInitialState(cadastro), [cadastro]);
  const originalSnapshotRef = useRef(originalSnapshot);
  const originalDocument = cadastro?.documento ?? "";

  const title = mode === "new" ? "Novo cadastro" : `Editar cadastro #${cadastro?.idCliente}`;
  const subtitle =
    mode === "new"
      ? "Preencha os dados principais e salve para criar o cadastro no Supabase."
      : "Atualize os dados carregados nesta tela em modo simulado, sem persistir em banco real.";

  const formattedDocument = useMemo(
    () => maskDocument(form.documento, form.tipoCliente),
    [form.documento, form.tipoCliente]
  );

  function updateField<K extends keyof CadastroFormState>(field: K, value: CadastroFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "idCliente" || field === "documento" || field === "tipoCliente") {
      setPreparedEnderecoInsertPayload(null);
    }
    setErrorFields((current) => current.filter((item) => item !== field));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }

      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function handleInitialValidation() {
    setMessage(null);
    setFieldErrors({});
    setErrorFields([]);
    setPreparedEnderecoInsertPayload(null);

    if (!form.idCliente) {
      setErrorFields(["idCliente"]);
      setFieldErrors({
        idCliente: "Informe o ID do cliente para continuar."
      });
      setMessage({
        tone: "danger",
        title: "Campos obrigatorios ausentes",
        description: "Informe o ID do cliente para continuar."
      });
      showToast({
        type: "error",
        title: "Campos obrigatorios ausentes",
        description: "Informe o ID do cliente para continuar."
      });
      return;
    }

    const idCliente = Number(form.idCliente);
    if (!Number.isInteger(idCliente) || idCliente <= 0) {
      setErrorFields(["idCliente"]);
      setFieldErrors({
        idCliente: "O ID do cliente precisa ser um numero inteiro valido."
      });
      setMessage({
        tone: "danger",
        title: "ID do cliente invalido",
        description: "Informe um numero inteiro valido para o ID do cliente."
      });
      showToast({
        type: "error",
        title: "ID do cliente invalido",
        description: "Use um numero inteiro para continuar."
      });
      return;
    }

    if (!form.documento) {
      setErrorFields(["documento"]);
      setFieldErrors({
        documento: "Informe um CPF ou CNPJ para continuar."
      });
      setMessage({
        tone: "danger",
        title: "Documento obrigatorio",
        description: "Informe um CPF ou CNPJ para continuar."
      });
      showToast({
        type: "error",
        title: "Documento obrigatorio",
        description: "Informe um CPF ou CNPJ para continuar."
      });
      return;
    }

    const documentoValidation = validateDocumentByTipo(form.documento, form.tipoCliente);
    if (!documentoValidation.isValid) {
      const documentoMessage = documentoValidation.message ?? "Documento invalido. Revise os digitos informados.";
      setErrorFields(["documento"]);
      setFieldErrors({
        documento: documentoMessage
      });
      setMessage({
        tone: "danger",
        title: "Documento invalido",
        description: documentoMessage
      });
      showToast({
        type: "error",
        title: "Documento invalido",
        description: documentoMessage
      });
      return;
    }

    if (!form.atendente) {
      setErrorFields(["atendente"]);
      setMessage({
        tone: "danger",
        title: "Atendente obrigatorio",
        description: "Selecione o atendente para continuar."
      });
      showToast({
        type: "error",
        title: "Atendente obrigatorio",
        description: "Selecione o atendente para continuar."
      });
      return;
    }

    setIsInitialChecking(true);

    let validationResult: Awaited<ReturnType<typeof validateCadastroInitialStep>>;
    try {
      validationResult = await validateCadastroInitialStep({
        idCliente,
        documentoDigits: documentoValidation.digits
      });
    } catch (error) {
      setIsInitialChecking(false);
      setMessage({
        tone: "danger",
        title: "Nao foi possivel validar duplicidades",
        description: error instanceof Error ? error.message : "Falha ao consultar o Supabase."
      });
      showToast({
        type: "error",
        title: "Falha na validacao",
        description: "Falha ao consultar o Supabase."
      });
      return;
    }

    setIsInitialChecking(false);

    if (validationResult.idConflict) {
      setErrorFields(["idCliente"]);
      setFieldErrors({
        idCliente: `Ja existe um cadastro com este ID: ${validationResult.idConflict.idCliente} - ${validationResult.idConflict.nome}.`
      });
      setMessage({
        tone: "warning",
        title: "ID ja cadastrado",
        description: `Já existe um cadastro com este ID: ${validationResult.idConflict.idCliente} - ${validationResult.idConflict.nome}.`,
        actionHref: `/cadastros/${validationResult.idConflict.idCliente}`,
        actionLabel: "Abrir cadastro existente"
      });
      showToast({
        type: "warning",
        title: "ID ja cadastrado",
        description: "Informe outro ID para continuar."
      });
      return;
    }

    if (validationResult.documentoConflict) {
      setErrorFields(["documento"]);
      setFieldErrors({
        documento: `Ja existe um cadastro com este documento: ID ${validationResult.documentoConflict.idCliente} - ${validationResult.documentoConflict.nome}.`
      });
      setMessage({
        tone: "warning",
        title: "Documento ja cadastrado",
        description: `Já existe um cadastro com este documento: ID ${validationResult.documentoConflict.idCliente} - ${validationResult.documentoConflict.nome}.`,
        actionHref: `/cadastros/${validationResult.documentoConflict.idCliente}`,
        actionLabel: "Abrir cadastro existente"
      });
      showToast({
        type: "warning",
        title: "Documento ja cadastrado",
        description: "Informe outro documento para continuar."
      });
      return;
    }

    if (!validationResult.success) {
      setMessage({
        tone: "danger",
        title: "Nao foi possivel validar duplicidades",
        description: validationResult.errorMessage || "Falha ao consultar o Supabase."
      });
      showToast({
        type: "error",
        title: "Falha na validacao",
        description: validationResult.errorMessage || "Falha ao consultar o Supabase."
      });
      return;
    }

    let consultaMessage = "Dados consultados e formulário liberado para revisão.";
    let consultaTone: FormMessage["tone"] = "info";

    try {
      const response = await fetch("/api/cadastros/consultar-documento", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          tipoPessoa: form.tipoCliente,
          documento: documentoValidation.digits,
          idCliente
        })
      });

      const data = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            payload?: ConsultaDocumentoApiPayload;
            message?: string;
          }
        | null;

      if (!response.ok || !data?.success || !data.payload) {
        consultaMessage =
          data?.message ||
          "Não foi possível consultar os dados externos. Continue com preenchimento manual.";
        consultaTone = "warning";
        showToast({
          type: "warning",
          title: "Consulta externa indisponível",
          description: "Continue o preenchimento manual e revise os dados antes de salvar."
        });
      } else {
        const payload = data.payload;
        const enderecoImportado = payload.enderecoPreparado
          ? mapPreparedEnderecoToForm(payload.enderecoPreparado)
          : null;

        setForm((current) => ({
          ...current,
          tipoCliente: payload.tipoPessoa === "FISICA" ? "CPF" : "CNPJ",
          documento: payload.documento || current.documento,
          nome: payload.nome || current.nome,
          fantasia: payload.fantasia || current.fantasia,
          dataFundacao: payload.dataFundacao || current.dataFundacao,
          email: payload.emailContato || current.email,
          telefoneFixo: payload.telefoneFixo || current.telefoneFixo,
          tipoContribuinte: payload.tipoContribuinte || current.tipoContribuinte,
          inscricaoEstadual: payload.insEstadual || current.inscricaoEstadual,
          isentoInscricaoEstadual: payload.tipoContribuinte === "ISENTO",
          enderecos: enderecoImportado ? [enderecoImportado] : current.enderecos
        }));

        setPreparedEnderecoInsertPayload(payload.enderecoPreparado);
        consultaMessage = payload.enderecoPreparado
          ? "Dados da API preenchidos. Revise cliente e endereço antes de salvar."
          : "Dados da API preenchidos. Revise o cadastro antes de salvar.";
        consultaTone = "info";
        showToast({
          type: "success",
          title: "Dados importados",
          description: "Os campos retornados pela consulta externa foram preenchidos."
        });
      }
    } catch {
      consultaMessage =
        "Não foi possível consultar os dados externos. Continue com preenchimento manual.";
      consultaTone = "warning";
      showToast({
        type: "warning",
        title: "Consulta externa indisponível",
        description: "Continue o preenchimento manual e revise os dados antes de salvar."
      });
    }

    setIsInitialValidated(true);
    setMessage({
      tone: consultaTone,
      title: "Dados iniciais validados",
      description: consultaMessage
    });
  }

  async function handleCreateCadastro() {
    setMessage(null);
    setErrorFields([]);

    const idCliente = Number(form.idCliente);
    const documentoDigits = normalizeDocumentDigits(form.documento);
    const inferredTipoPessoa = inferTipoPessoaFromDocumento(form.documento);
    const contactEmail = form.email.trim();
    const contactWhatsApp = form.whatsapp.trim();
    const contactName = form.contatos[0]?.nome?.trim() || form.nome.trim();

    const missingFields = [
      !form.idCliente ? "idCliente" : null,
      !Number.isInteger(idCliente) || idCliente <= 0 ? "idCliente" : null,
      !form.categoria ? "categoria" : null,
      !form.nome.trim() ? "nome" : null,
      !documentoDigits ? "documento" : null,
      !inferredTipoPessoa ? "documento" : null,
      !contactEmail && !contactWhatsApp ? "email" : null,
      !contactEmail && !contactWhatsApp ? "whatsapp" : null
    ].filter(Boolean) as string[];

    if (missingFields.length) {
      setErrorFields(Array.from(new Set(missingFields)));
      setMessage({
        tone: "danger",
        title: "Campos obrigatorios ausentes",
        description: "Preencha ID do cliente, nome, documento e pelo menos um contato."
      });
      showToast({
        type: "error",
        title: "Nao foi possivel salvar",
        description: "Revise os campos destacados antes de continuar."
      });
      return;
    }

    setIsSaving(true);

    const insertPayload: CadastroInsertPayload = {
      id_cliente: idCliente,
      categoria: form.categoria,
      nome: form.nome.trim(),
      fantasia: normalizeOptionalText(form.fantasia),
      apelido: null,
      contato: normalizeOptionalText(contactName),
      documento: documentoDigits,
      tipo_pessoa: inferredTipoPessoa ?? "JURIDICA",
      ins_estadual: normalizeOptionalText(form.inscricaoEstadual),
      ins_municipal: normalizeOptionalText(form.inscricaoMunicipal),
      tipo_contribuinte: normalizeOptionalText(form.tipoContribuinte),
      data_fundacao: normalizeOptionalText(form.dataFundacao),
      email_contato: normalizeOptionalText(contactEmail),
      email_financeiro: normalizeOptionalText(form.emailFinanceiro),
      email: normalizeOptionalText(contactEmail),
      telefone_fixo: normalizeOptionalText(form.telefoneFixo),
      whatsapp_1: normalizeOptionalText(contactWhatsApp),
      whatsapp_2: normalizeOptionalText(form.whatsapp2),
      site: normalizeOptionalText(form.site),
      ativo: form.ativo,
      restricao: form.restricao,
      obs: normalizeOptionalText(form.observacoes),
      recebe_email: form.sendMail,
      recebe_whatsapp: form.sendWhats,
      nome_vendedor: normalizeOptionalText(form.atendente),
      id_vendedor: null,
      padrao_pagamento: normalizeOptionalText(form.padraoPagamento) || "Pix à vista 3 dias",
      empresa_padrao: normalizeOptionalText(form.empresaPadrao),
      cidade_uf: normalizeOptionalText(
        form.enderecos[0]?.cidade && form.enderecos[0]?.uf
          ? `${form.enderecos[0].cidade} - ${form.enderecos[0].uf}`
          : ""
      ),
      nota: form.nota,
      verificado: form.verificado
    };

    let result: Awaited<ReturnType<typeof createCadastro>>;
    try {
      result = await createCadastro(insertPayload);
    } catch (error) {
      setIsSaving(false);
      setMessage({
        tone: "danger",
        title: "Nao foi possivel criar o cadastro.",
        description: error instanceof Error ? error.message : "Falha inesperada ao executar o insert."
      });
      showToast({
        type: "error",
        title: "Falha ao criar cadastro",
        description: "Falha inesperada ao executar o insert."
      });
      return;
    }

    if (!result.success) {
      setIsSaving(false);
      setErrorFields(
        result.conflict?.kind === "id_cliente"
          ? ["idCliente"]
          : result.conflict?.kind === "documento"
            ? ["documento"]
            : []
      );
      setMessage({
        tone: "danger",
        title: "Nao foi possivel criar o cadastro.",
        description: result.errorMessage,
        actionHref: result.conflict ? `/cadastros/${result.conflict.idCliente}` : undefined,
        actionLabel: result.conflict ? "Abrir cadastro existente" : undefined
      });
      showToast({
        type: "error",
        title: "Falha ao criar cadastro",
        description: result.errorMessage
      });
      return;
    }

    let enderecoWarning: string | null = null;
    if (form.tipoCliente === "CNPJ" && preparedEnderecoInsertPayload) {
      const enderecoPayload: CadastroEnderecoInsertPayload = {
        id_cliente: result.cadastro.idCliente,
        cep: normalizeOptionalText(form.enderecos[0]?.cep ?? preparedEnderecoInsertPayload.cep),
        endereco: normalizeOptionalText(form.enderecos[0]?.endereco ?? preparedEnderecoInsertPayload.endereco),
        numero: normalizeOptionalText(form.enderecos[0]?.numero ?? preparedEnderecoInsertPayload.numero),
        complemento: normalizeOptionalText(form.enderecos[0]?.complemento ?? preparedEnderecoInsertPayload.complemento),
        bairro: normalizeOptionalText(form.enderecos[0]?.bairro ?? preparedEnderecoInsertPayload.bairro),
        cidade: normalizeOptionalText(form.enderecos[0]?.cidade ?? preparedEnderecoInsertPayload.cidade),
        uf: normalizeOptionalText(form.enderecos[0]?.uf ?? preparedEnderecoInsertPayload.uf),
        tipo_endereco: "PRINCIPAL",
        obs: normalizeOptionalText(form.enderecos[0]?.obs ?? preparedEnderecoInsertPayload.obs)
      };

      const enderecoResult = await createCadastroEndereco(enderecoPayload);
      if (!enderecoResult.success) {
        enderecoWarning =
          "Cadastro criado, mas houve erro ao salvar o endereço. Adicione o endereço manualmente.";
      }
    }

    setMessage({
      tone: enderecoWarning ? "warning" : "success",
      title: enderecoWarning ? "Cadastro criado com ressalva." : "Cadastro criado com sucesso.",
      description: enderecoWarning || "Redirecionando para o detalhe do cadastro criado."
    });
    showToast({
      type: enderecoWarning ? "warning" : "success",
      title: enderecoWarning ? "Cadastro criado com ressalva" : "Cadastro criado com sucesso.",
      description: enderecoWarning || `Cadastro #${result.cadastro.idCliente} gravado no Supabase.`
    });

    setIsSaving(false);

    window.setTimeout(() => {
      router.push(`/cadastros/${result.cadastro.idCliente}`);
    }, 1000);
  }

  async function handleMockSave() {
    if (mode === "edit") {
      const original = originalSnapshotRef.current;
      const blockedChanges = getBlockedFieldChanges(form, original);

      if (blockedChanges.length > 0) {
        const blockedLabels = blockedChanges.map((item) => item.label);
        const blockedPreview = blockedLabels.slice(0, 4).join(", ");
        const remaining = blockedLabels.length - 4;

        setMessage({
          tone: "warning",
          title: "Campos bloqueados alterados",
          description: `Nesta fase, apenas campos operacionais simples serão gravados no Supabase. Campos bloqueados alterados: ${blockedPreview}${remaining > 0 ? ` e mais ${remaining}` : ""}.`
        });
        showToast({
          type: "warning",
          title: "Campos bloqueados alterados",
          description: "Revise o formulario e remova as alteracoes de campos ainda nao liberados."
        });
        return;
      }

      const preview = buildOperacionalUpdatePreview(form, original);

      if (!preview.changes.length) {
        setMessage({
          tone: "info",
          title: "Nenhum campo liberado alterado.",
          description: "Nesta fase, apenas campos operacionais simples serão gravados no Supabase."
        });
        showToast({
          type: "info",
          title: "Nada para gravar",
          description: "Altere um campo liberado para abrir a confirmação de gravação."
        });
        return;
      }

      setPendingSavePreview(preview);
      return;
    }
  }

  async function handleConfirmOperationalSave() {
    if (!pendingSavePreview) {
      return;
    }

    setIsSaving(true);

    const result = await updateCadastroCamposOperacionaisReadOnly(Number(form.idCliente), pendingSavePreview.payload);

    if (!result.success) {
      setIsSaving(false);
      setPendingSavePreview(null);
      setMessage({
        tone: "danger",
        title: "Nao foi possivel gravar os campos liberados no Supabase.",
        description: result.errorMessage
      });
      showToast({
        type: "error",
        title: "Falha ao gravar campos liberados",
        description: "O formulario foi mantido aberto para nova tentativa."
      });
      return;
    }

    const nextFormState = {
      ...form,
      observacoes: result.updatedValues.observacoes,
      fantasia: result.updatedValues.fantasia,
      telefoneFixo: result.updatedValues.telefoneFixo,
      whatsapp: result.updatedValues.whatsapp,
      whatsapp2: result.updatedValues.whatsapp2,
      email: result.updatedValues.email,
      emailFinanceiro: result.updatedValues.emailFinanceiro,
      site: result.updatedValues.site
    };

    setForm(nextFormState);
    originalSnapshotRef.current = nextFormState;
    setPendingSavePreview(null);
    setIsSaving(false);

    setMessage({
      tone: "success",
      title: "Campos liberados gravados no Supabase.",
      description: "A escrita real desta fase atualizou somente os campos operacionais simples."
    });
    showToast({
      type: "success",
      title: "Campos liberados gravados no Supabase",
      description: "Somente os campos permitidos foram persistidos."
    });

    window.setTimeout(() => {
      router.push(`/cadastros/${cadastro?.idCliente}`);
    }, 1200);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        context="Cadastros / Clientes"
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/cadastros"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Voltar para lista
            </Link>
            {mode === "new" && !isInitialValidated ? (
              <button
                type="button"
                onClick={handleInitialValidation}
                disabled={isInitialChecking}
                className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isInitialChecking ? "Validando..." : "Continuar"}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleMockSave}
                disabled={isSaving}
                className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60"
              >
                {isSaving
                  ? "Salvando..."
                  : mode === "edit"
                    ? "Salvar campos liberados no Supabase"
                    : "Salvar cadastro"}
              </button>
            )}
          </div>
        }
      />

      {message ? <FormAlert message={message} /> : null}

      {mode === "new" && !isInitialValidated ? (
        <InitialStep
          form={form}
          formattedDocument={formattedDocument}
          onUpdate={updateField}
          onContinue={handleInitialValidation}
          errorFields={errorFields}
          fieldErrors={fieldErrors}
          isChecking={isInitialChecking}
          mode={mode}
        />
      ) : (
        <CompleteForm
          form={form}
          formattedDocument={formattedDocument}
          onUpdate={updateField}
          onCancel={() => router.push("/cadastros")}
          onSave={mode === "new" ? handleCreateCadastro : handleMockSave}
          mode={mode}
          originalDocument={originalDocument}
          isSaving={isSaving}
          errorFields={errorFields}
          onToast={showToast}
        />
      )}

      {pendingSavePreview ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">Confirmar gravação</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">Campos operacionais simples serão gravados no Supabase</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Revise o que será enviado antes de confirmar o `PATCH` no cadastro #{form.idCliente}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingSavePreview(null)}
                className="rounded-2xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Resumo do envio</p>
                <ul className="mt-3 space-y-3">
                  {pendingSavePreview.changes.map((change) => (
                    <li key={change.columns.join("-")} className="rounded-2xl bg-white px-4 py-3">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{change.label}</p>
                          <p className="text-xs text-slate-500">Colunas: {change.columns.join(", ")}</p>
                        </div>
                        <p className="text-sm text-slate-700">
                          {change.value ? change.value : <span className="italic text-slate-400">campo vazio</span>}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                Apenas campos operacionais simples serão gravados. Campos bloqueados continuam sem escrita nesta fase.
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingSavePreview(null)}
                className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmOperationalSave}
                disabled={isSaving}
                className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isSaving ? "Salvando..." : "Confirmar gravação"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InitialStep({
  form,
  formattedDocument,
  onUpdate,
  onContinue,
  errorFields,
  fieldErrors,
  isChecking,
  mode
}: {
  form: CadastroFormState;
  formattedDocument: string;
  onUpdate: <K extends keyof CadastroFormState>(field: K, value: CadastroFormState[K]) => void;
  onContinue: () => Promise<void>;
  errorFields: string[];
  fieldErrors: Record<string, string>;
  isChecking: boolean;
  mode: "new" | "edit";
}) {
  return (
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-slate-950">Identificação inicial</h2>
        <p className="mt-1 text-sm text-slate-500">
          {mode === "new"
            ? "Comece com ID, tipo, documento e atendente para seguir ao formulário completo."
            : "Comece com as 5 informacoes principais. O restante sera liberado apos a validacao."}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Field label="ID do cliente">
          <input
            type="number"
            value={form.idCliente}
            onChange={(event) => onUpdate("idCliente", event.target.value)}
            className={getInputClass(errorFields.includes("idCliente"))}
            placeholder="120018"
          />
          {fieldErrors.idCliente ? <FieldError message={fieldErrors.idCliente} /> : null}
        </Field>
        <Field label="Tipo de cadastro">
          <select
            value={form.categoria}
            onChange={(event) => onUpdate("categoria", event.target.value as CadastroCategoria)}
            className={inputClass}
          >
            {categoriaOptions.map((categoria) => (
              <option key={categoria} value={categoria}>
                {categoriaLabel[categoria]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo de cliente">
          <select
            value={form.tipoCliente}
            onChange={(event) => onUpdate("tipoCliente", event.target.value as TipoClienteDocumento)}
            className={inputClass}
          >
            <option value="CPF">CPF</option>
            <option value="CNPJ">CNPJ</option>
          </select>
        </Field>
        <Field label="No do documento">
          <input
            value={formattedDocument}
            onChange={(event) => onUpdate("documento", normalizeDocumentDigits(event.target.value))}
            className={getInputClass(errorFields.includes("documento"))}
            placeholder={form.tipoCliente === "CPF" ? "000.000.000-00" : "00.000.000/0000-00"}
          />
          {fieldErrors.documento ? <FieldError message={fieldErrors.documento} /> : null}
        </Field>
        <Field label="Atendente">
          <select
            value={form.atendente}
            onChange={(event) => onUpdate("atendente", event.target.value)}
            className={getInputClass(errorFields.includes("atendente"))}
          >
            <option value="">Selecione</option>
            {atendentesMock.map((atendente) => (
              <option key={atendente} value={atendente}>
                {atendente}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Link
          href="/cadastros"
          className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-center text-sm font-semibold text-slate-700"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={onContinue}
          disabled={isChecking}
          className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isChecking ? "Validando..." : mode === "new" ? "Continuar" : "Verificar cadastro"}
        </button>
      </div>
    </section>
  );
}

function CompleteForm({
  form,
  formattedDocument,
  onUpdate,
  onCancel,
  onSave,
  mode,
  originalDocument,
  isSaving,
  errorFields,
  onToast
}: {
  form: CadastroFormState;
  formattedDocument: string;
  onUpdate: <K extends keyof CadastroFormState>(field: K, value: CadastroFormState[K]) => void;
  onCancel: () => void;
  onSave: () => void;
  mode: "new" | "edit";
  originalDocument: string;
  isSaving: boolean;
  errorFields: string[];
  onToast: (toast: { type: "success" | "error" | "warning" | "info"; title: string; description?: string }) => void;
}) {
  const companies = mockCompanies.filter((company) => !company.isConsolidated);
  const documentChanged =
    mode === "edit" &&
    normalizeDocumentDigits(form.documento) !== normalizeDocumentDigits(originalDocument);
  const isNewMode = mode === "new";

  function updateEndereco(index: number, field: keyof CadastroEndereco, value: string) {
    const enderecos = form.enderecos.map((endereco, currentIndex) =>
      currentIndex === index ? { ...endereco, [field]: value } : endereco
    );
    onUpdate("enderecos", enderecos);
  }

  function updateContato(index: number, field: keyof CadastroContato, value: string) {
    const contatos = form.contatos.map((contato, currentIndex) =>
      currentIndex === index ? { ...contato, [field]: value } : contato
    );
    onUpdate("contatos", contatos);
  }

  function updateVinculo(index: number, field: keyof CadastroVinculoComercial, value: string) {
    const vinculos = form.vinculosComerciais.map((vinculo, currentIndex) =>
      currentIndex === index
        ? {
            ...vinculo,
            [field]: field === "idClienteRelacionado" ? Number(value) : value
          }
        : vinculo
    );
    onUpdate("vinculosComerciais", vinculos);
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-4">
        <StatusCard title="ID operacional" value={`#${form.idCliente}`} />
        <StatusCard title="Tipo" value={categoriaLabel[form.categoria]} />
        <StatusCard title="Documento" value={formattedDocument || "Nao informado"} />
        <StatusCard title="Atendente" value={form.atendente || "Nao definido"} />
      </section>

      <FormSection title="Dados gerais" description="Dados principais da tabela futura clientes.">
        {documentChanged ? (
          <div className="mb-4 rounded-3xl border border-orange-200 bg-orange-50 p-4 text-orange-800">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Documento alterado</p>
                <p className="mt-1 text-sm">
                  Alterar CPF/CNPJ pode afetar fiscal, financeiro, propostas e notas. Nesta etapa a
                  alteracao e apenas visual/mockada.
                </p>
              </div>
            </div>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="ID do cliente">
            <input
              value={form.idCliente}
              readOnly
              className={
                errorFields.includes("idCliente")
                  ? `${inputClass} cursor-not-allowed border-red-300 bg-red-50 text-slate-600`
                  : `${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`
              }
            />
          </Field>
          <Field label="Tipo de cadastro">
            <select value={form.categoria} onChange={(event) => onUpdate("categoria", event.target.value as CadastroCategoria)} className={inputClass}>
              {categoriaOptions.map((categoria) => (
                <option key={categoria} value={categoria}>{categoriaLabel[categoria]}</option>
              ))}
            </select>
          </Field>
          <Field label="Situacao / Ativo">
            <select value={form.ativo ? "ATIVO" : "INATIVO"} onChange={(event) => onUpdate("ativo", event.target.value === "ATIVO")} className={inputClass}>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </select>
          </Field>
          <Field label="CPF/CNPJ">
            <input value={formattedDocument} onChange={(event) => onUpdate("documento", normalizeDocumentDigits(event.target.value))} className={getInputClass(errorFields.includes("documento"))} />
          </Field>
          <Field label="Razao social / Nome">
            <input value={form.nome} onChange={(event) => onUpdate("nome", event.target.value)} className={getInputClass(errorFields.includes("nome"))} />
          </Field>
          <Field label="Nome fantasia / Apelido">
            <input value={form.fantasia} onChange={(event) => onUpdate("fantasia", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Tipo de contribuinte">
            <input value={form.tipoContribuinte} onChange={(event) => onUpdate("tipoContribuinte", event.target.value)} className={inputClass} placeholder="Contribuinte / Isento" />
          </Field>
          <Field label="E-mail principal">
            <input value={form.email} onChange={(event) => onUpdate("email", event.target.value)} className={getInputClass(errorFields.includes("email"))} />
          </Field>
          <Field label="E-mail financeiro">
            <input value={form.emailFinanceiro} onChange={(event) => onUpdate("emailFinanceiro", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Inscricao estadual">
            <input value={form.inscricaoEstadual} onChange={(event) => onUpdate("inscricaoEstadual", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Isento?">
            <select value={form.isentoInscricaoEstadual ? "SIM" : "NAO"} onChange={(event) => onUpdate("isentoInscricaoEstadual", event.target.value === "SIM")} className={inputClass}>
              <option value="NAO">Nao</option>
              <option value="SIM">Sim</option>
            </select>
          </Field>
          <Field label="Inscricao municipal">
            <input value={form.inscricaoMunicipal} onChange={(event) => onUpdate("inscricaoMunicipal", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Telefone fixo comercial">
            <input value={form.telefoneFixo} onChange={(event) => onUpdate("telefoneFixo", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Site da empresa">
            <input value={form.site} onChange={(event) => onUpdate("site", event.target.value)} className={inputClass} />
          </Field>
          <Field label="WhatsApp 1">
            <input value={form.whatsapp} onChange={(event) => onUpdate("whatsapp", event.target.value)} className={getInputClass(errorFields.includes("whatsapp"))} />
          </Field>
          <Field label="WhatsApp 2">
            <input value={form.whatsapp2} onChange={(event) => onUpdate("whatsapp2", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Atendente do cliente">
            <select value={form.atendente} onChange={(event) => onUpdate("atendente", event.target.value)} className={getInputClass(errorFields.includes("atendente"))}>
              {atendentesMock.map((atendente) => (
                <option key={atendente} value={atendente}>{atendente}</option>
              ))}
            </select>
          </Field>
          <Field label="Empresa padrao de cobranca">
            <select value={form.empresaPadrao} onChange={(event) => onUpdate("empresaPadrao", event.target.value)} className={inputClass}>
              {companies.map((company) => (
                <option key={company.id} value={company.name}>{company.shortName}</option>
              ))}
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection
        title="Enderecos"
        description={
          isNewMode
            ? "Endereços serão adicionados após criar o cadastro."
            : "Enderecos vinculados ao id_cliente. Futuramente serao usados em propostas, frete e notas fiscais."
        }
        action={
          isNewMode ? (
            <span className="text-sm font-medium text-slate-500">Será liberado após salvar o cadastro.</span>
          ) : (
            <AddButton
              label="Adicionar endereco"
              onClick={() => {
                onUpdate("enderecos", [...form.enderecos, createBlankEndereco()]);
                onToast({ type: "info", title: "Endereco adicionado", description: "Endereco incluido no formulario." });
              }}
            />
          )
        }
      >
        <div className="space-y-4">
          {form.enderecos.map((endereco, index) => (
            <div key={endereco.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <StatusBadge status={endereco.tipo.toUpperCase()} tone="neutral" />
                <button type="button" onClick={() => {
                  onUpdate("enderecos", form.enderecos.filter((_, itemIndex) => itemIndex !== index));
                  onToast({ type: "warning", title: "Endereco removido", description: "Remocao aplicada apenas no formulario mockado." });
                }} className="rounded-xl p-2 text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Tipo"><select value={endereco.tipo} onChange={(event) => updateEndereco(index, "tipo", event.target.value)} className={inputClass}><option value="principal">Principal</option><option value="entrega">Entrega</option><option value="cobranca">Cobranca</option><option value="fiscal">Fiscal</option></select></Field>
                <Field label="CEP"><input value={endereco.cep} onChange={(event) => updateEndereco(index, "cep", event.target.value)} className={inputClass} /></Field>
                <Field label="Logradouro"><input value={endereco.endereco} onChange={(event) => updateEndereco(index, "endereco", event.target.value)} className={inputClass} /></Field>
                <Field label="Numero"><input value={endereco.numero} onChange={(event) => updateEndereco(index, "numero", event.target.value)} className={inputClass} /></Field>
                <Field label="Complemento"><input value={endereco.complemento ?? ""} onChange={(event) => updateEndereco(index, "complemento", event.target.value)} className={inputClass} /></Field>
                <Field label="Bairro"><input value={endereco.bairro} onChange={(event) => updateEndereco(index, "bairro", event.target.value)} className={inputClass} /></Field>
                <Field label="Cidade"><input value={endereco.cidade} onChange={(event) => updateEndereco(index, "cidade", event.target.value)} className={inputClass} /></Field>
                <Field label="UF"><input value={endereco.uf} onChange={(event) => updateEndereco(index, "uf", event.target.value.toUpperCase())} className={inputClass} maxLength={2} /></Field>
                <div className="md:col-span-2 xl:col-span-4"><Field label="Observacao"><input value={endereco.obs ?? ""} onChange={(event) => updateEndereco(index, "obs", event.target.value)} className={inputClass} /></Field></div>
              </div>
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection
        title="Contatos"
        description={isNewMode ? "Contatos serão adicionados após criar o cadastro." : "Pessoas fisicas vinculadas ao cadastro."}
        action={
          isNewMode ? (
            <span className="text-sm font-medium text-slate-500">Será liberado após salvar o cadastro.</span>
          ) : (
            <AddButton
              label="Adicionar contato"
              onClick={() => {
                onUpdate("contatos", [...form.contatos, createBlankContato()]);
                onToast({ type: "info", title: "Contato adicionado", description: "Contato incluido no formulario." });
              }}
            />
          )
        }
      >
        <div className="space-y-4">
          {form.contatos.map((contato, index) => (
            <div key={contato.id} className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <Field label="Nome"><input value={contato.nome} onChange={(event) => updateContato(index, "nome", event.target.value)} className={inputClass} /></Field>
              <Field label="Cargo"><input value={contato.cargo} onChange={(event) => updateContato(index, "cargo", event.target.value)} className={inputClass} /></Field>
              <Field label="WhatsApp"><input value={contato.whatsapp} onChange={(event) => updateContato(index, "whatsapp", event.target.value)} className={inputClass} /></Field>
              <Field label="E-mail"><input value={contato.email} onChange={(event) => updateContato(index, "email", event.target.value)} className={inputClass} /></Field>
              <button type="button" onClick={() => {
                onUpdate("contatos", form.contatos.filter((_, itemIndex) => itemIndex !== index));
                onToast({ type: "warning", title: "Contato removido", description: "Remocao aplicada apenas no formulario mockado." });
              }} className="self-end rounded-xl p-3 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection
        title="Vinculos comerciais"
        description={
          isNewMode
            ? "Vínculos comerciais serão adicionados após criar o cadastro."
            : "Cadastros autorizados ou relacionados comercialmente a este cliente."
        }
        action={
          isNewMode ? (
            <span className="text-sm font-medium text-slate-500">Será liberado após salvar o cadastro.</span>
          ) : (
            <AddButton
              label="Adicionar vinculo"
              onClick={() => {
                onUpdate("vinculosComerciais", [...form.vinculosComerciais, createBlankVinculo()]);
                onToast({ type: "info", title: "Vinculo comercial adicionado", description: "Vinculo incluido no formulario." });
              }}
            />
          )
        }
      >
        <div className="space-y-4">
          {form.vinculosComerciais.map((vinculo, index) => (
            <div key={vinculo.id} className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[160px_1fr_1fr_1fr_auto]">
              <Field label="ID relacionado"><input value={vinculo.idClienteRelacionado} onChange={(event) => updateVinculo(index, "idClienteRelacionado", event.target.value)} className={inputClass} /></Field>
              <Field label="Nome"><input value={vinculo.nome} onChange={(event) => updateVinculo(index, "nome", event.target.value)} className={inputClass} /></Field>
              <Field label="Documento"><input value={vinculo.documento} onChange={(event) => updateVinculo(index, "documento", event.target.value)} className={inputClass} /></Field>
              <Field label="Tipo de relacao"><input value={vinculo.tipoRelacao} onChange={(event) => updateVinculo(index, "tipoRelacao", event.target.value)} className={inputClass} /></Field>
              <ActionsMenu
                label="Acoes"
                items={[
                  { label: "Abrir cadastro relacionado", onClick: () => window.alert("Abertura mockada do cadastro relacionado.") },
                  { label: "Remover vinculo", destructive: true, onClick: () => {
                    onUpdate("vinculosComerciais", form.vinculosComerciais.filter((_, itemIndex) => itemIndex !== index));
                    onToast({ type: "warning", title: "Vinculo comercial removido", description: "Remocao aplicada apenas no formulario mockado." });
                  } }
                ]}
              />
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection title="Dados complementares" description="Informacoes financeiras, comerciais e flags operacionais.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Data fundacao"><input type="date" value={form.dataFundacao} onChange={(event) => onUpdate("dataFundacao", event.target.value)} className={inputClass} /></Field>
          <Field label="Limite de credito"><input value={form.limiteCredito} onChange={(event) => onUpdate("limiteCredito", event.target.value)} className={inputClass} /></Field>
          <Field label="Credito acumulado"><input value={form.creditoDisponivel} onChange={(event) => onUpdate("creditoDisponivel", event.target.value)} className={inputClass} /></Field>
          <Field label="Risco financeiro"><select value={form.riscoCredito} onChange={(event) => onUpdate("riscoCredito", event.target.value as "BAIXO" | "MEDIO" | "ALTO")} className={inputClass}><option value="BAIXO">Baixo</option><option value="MEDIO">Medio</option><option value="ALTO">Alto</option></select></Field>
          <Field label="Formas de pagamento"><select value={form.padraoPagamento} onChange={(event) => onUpdate("padraoPagamento", event.target.value)} className={inputClass}>{paymentOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>
          <Field label="Percentual bonus"><input value={form.percentualBonus} onChange={(event) => onUpdate("percentualBonus", event.target.value)} className={inputClass} /></Field>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Toggle label="Bonus" checked={form.bonusAtivo} onChange={(value) => onUpdate("bonusAtivo", value)} />
          <Toggle label="Nota" checked={form.nota} onChange={(value) => onUpdate("nota", value)} />
          <Toggle label="Restricao" checked={form.restricao} onChange={(value) => onUpdate("restricao", value)} />
          <Toggle label="Verificado" checked={form.verificado} onChange={(value) => onUpdate("verificado", value)} />
          <Toggle label="Receber e-mail" checked={form.sendMail} onChange={(value) => onUpdate("sendMail", value)} />
          <Toggle label="Receber WhatsApp" checked={form.sendWhats} onChange={(value) => onUpdate("sendWhats", value)} />
        </div>
      </FormSection>

      <FormSection title="Observacoes" description="Informacoes internas importantes do cadastro. Limite visual de 500 caracteres.">
        <textarea value={form.observacoes} maxLength={500} onChange={(event) => onUpdate("observacoes", event.target.value)} className={`${inputClass} min-h-36 resize-y`} />
        <p className="mt-2 text-right text-xs text-slate-500">{form.observacoes.length}/500</p>
      </FormSection>

      <div className="sticky bottom-4 z-20 rounded-3xl border border-[#d7e5e8] bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-slate-700">
            Cadastro #{form.idCliente || "novo"} | Atendente: {form.atendente || "nao definido"}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={onCancel} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Cancelar</button>
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Voltar ao topo</button>
            <button type="button" onClick={onSave} disabled={isSaving} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {isSaving
                ? "Salvando..."
                : mode === "edit"
                  ? "Salvar campos liberados no Supabase"
                  : "Salvar cadastro"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]";

function getInputClass(hasError: boolean) {
  return hasError
    ? `${inputClass} border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100`
    : inputClass;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function FieldError({ message }: { message: string }) {
  return <p className="text-xs font-medium text-red-600">{message}</p>;
}

function FormSection({ title, description, action, children }: { title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function FormAlert({ message }: { message: FormMessage }) {
  const styles = {
    success: "border-teal-200 bg-teal-50 text-teal-800",
    warning: "border-orange-200 bg-orange-50 text-orange-800",
    danger: "border-red-200 bg-red-50 text-red-800",
    info: "border-sky-200 bg-sky-50 text-sky-800"
  };
  const Icon = message.tone === "success" ? CheckCircle2 : AlertTriangle;

  return (
    <div className={`rounded-3xl border p-5 ${styles[message.tone]}`}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <h2 className="font-semibold">{message.title}</h2>
          <p className="mt-1 text-sm">{message.description}</p>
          {message.actionHref ? (
            <Link href={message.actionHref} className="mt-3 inline-flex rounded-2xl bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm">
              {message.actionLabel}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatusCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 truncate text-lg font-bold text-slate-950">{value}</p>
    </div>
  );
}

function AddButton({
  label,
  onClick,
  disabled
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-2.5 text-sm font-semibold text-[#0b2f4a] hover:bg-[#f3f7f8] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus className="h-4 w-4" />
      {label}
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${checked ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600"}`}>
      {label}: {checked ? "Sim" : "Nao"}
    </button>
  );
}

function createInitialState(cadastro?: Cadastro): CadastroFormState {
  return {
    idCliente: cadastro?.idCliente.toString() ?? "",
    categoria: cadastro?.categoria ?? "CLIENTE",
    tipoCliente: cadastro?.tipoPessoa === "FISICA" ? "CPF" : "CNPJ",
    documento: cadastro?.documento ?? "",
    atendente: cadastro?.vendedor ?? "",
    ativo: cadastro?.ativo ?? true,
    nome: cadastro?.nome ?? "",
    fantasia: cadastro?.fantasia ?? "",
    tipoContribuinte: cadastro?.tipoContribuinte ?? "",
    email: cadastro?.email ?? "",
    emailFinanceiro: cadastro?.emailFinanceiro ?? "",
    inscricaoEstadual: cadastro?.inscricaoEstadual ?? "",
    isentoInscricaoEstadual: cadastro?.isentoInscricaoEstadual ?? false,
    inscricaoMunicipal: cadastro?.inscricaoMunicipal ?? "",
    telefoneFixo: cadastro?.telefoneFixo ?? "",
    site: cadastro?.site ?? "",
    whatsapp: cadastro?.whatsapp ?? "",
    whatsapp2: cadastro?.whatsapp2 ?? "",
    empresaPadrao: cadastro?.empresaPadrao ?? "Ideal Grafica",
    dataFundacao: cadastro?.dataFundacao ?? "",
    limiteCredito: cadastro?.limiteCredito?.toString() ?? "0",
    creditoDisponivel: cadastro?.creditoDisponivel?.toString() ?? "0",
    riscoCredito: cadastro?.riscoCredito ?? "BAIXO",
    padraoPagamento: cadastro?.padraoPagamento ?? "Pix à vista 3 dias",
    bonusAtivo: cadastro?.bonusAtivo ?? false,
    percentualBonus: cadastro?.percentualBonus?.toString() ?? "0",
    nota: cadastro?.nota ?? false,
    verificado: cadastro?.verificado ?? false,
    restricao: cadastro?.restricao ?? false,
    sendMail: cadastro ? cadastro.sendMail ?? true : false,
    sendWhats: cadastro ? cadastro.sendWhats ?? true : false,
    observacoes: cadastro?.observacoes ?? "",
    enderecos: cadastro?.enderecos ?? [],
    contatos: cadastro?.contatos ?? [],
    vinculosComerciais: cadastro?.vinculosComerciais ?? []
  };
}

function valuesAreEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildOperacionalUpdatePreview(current: CadastroFormState, original: CadastroFormState): CadastroSavePreview {
  const payload: CadastroOperacionalUpdatePayload = {};
  const changes: CadastroSavePreview["changes"] = [];

  for (const field of CADASTRO_OPERACIONAL_UPDATE_FIELDS) {
    const currentValue = String(current[field.key] ?? "");
    const originalValue = String(original[field.key] ?? "");

    if (currentValue === originalValue) {
      continue;
    }

    changes.push({
      label: field.label,
      value: currentValue,
      columns: [...field.columns]
    });

    if (field.key === "observacoes") {
      payload.obs = currentValue;
    }

    if (field.key === "fantasia") {
      payload.fantasia = currentValue;
    }

    if (field.key === "telefoneFixo") {
      payload.telefone_fixo = currentValue;
    }

    if (field.key === "whatsapp") {
      payload.whatsapp_1 = currentValue;
    }

    if (field.key === "whatsapp2") {
      payload.whatsapp_2 = currentValue;
    }

    if (field.key === "email") {
      payload.email_contato = currentValue;
      payload.email = currentValue;
    }

    if (field.key === "emailFinanceiro") {
      payload.email_financeiro = currentValue;
    }

    if (field.key === "site") {
      payload.site = currentValue;
    }
  }

  return { payload, changes };
}

function getBlockedFieldChanges(current: CadastroFormState, original: CadastroFormState) {
  return CADASTRO_OPERACIONAL_BLOCKED_FIELDS.filter(({ key }) => !valuesAreEqual(current[key], original[key]));
}

function createBlankEndereco(): CadastroEndereco {
  return {
    id: `end_${Date.now()}`,
    tipo: "principal",
    cep: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    obs: ""
  };
}

function createBlankContato(): CadastroContato {
  return {
    id: `cont_${Date.now()}`,
    nome: "",
    cargo: "",
    whatsapp: "",
    email: ""
  };
}

function createBlankVinculo(): CadastroVinculoComercial {
  return {
    id: `vinc_${Date.now()}`,
    idClienteRelacionado: 0,
    nome: "",
    documento: "",
    tipoRelacao: "Autorizado a comprar"
  };
}

function mapPreparedEnderecoToForm(payload: {
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  obs: string;
}): CadastroEndereco {
  return {
    id: `end_import_${Date.now()}`,
    tipo: "principal",
    cep: payload.cep,
    endereco: payload.endereco,
    numero: payload.numero,
    complemento: payload.complemento,
    bairro: payload.bairro,
    cidade: payload.cidade,
    uf: payload.uf,
    obs: payload.obs
  };
}

function inferTipoPessoaFromDocumento(documento: string): "FISICA" | "JURIDICA" | null {
  const digits = normalizeDocumentDigits(documento);
  if (digits.length === 11) {
    return "FISICA";
  }

  if (digits.length === 14) {
    return "JURIDICA";
  }

  return null;
}

function normalizeOptionalText(value?: string | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function maskDocument(documento: string, tipo: TipoClienteDocumento) {
  const digits = normalizeDocumentDigits(documento).slice(0, tipo === "CPF" ? 11 : 14);
  return formatDocument(digits);
}
