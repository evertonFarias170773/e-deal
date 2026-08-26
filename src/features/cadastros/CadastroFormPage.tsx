"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { PrecoFixoPanel } from "./components/PrecoFixoPanel";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatDocument } from "@/lib/formatters/document";
import {
  OPCOES_TIPO_CONTRIBUINTE,
  normalizarTipoContribuinte,
  type CodigoTipoContribuinte
} from "@/lib/fiscal/tipo-contribuinte";
import { mockCompanies } from "@/lib/mocks/empresas.mock";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import {
  createCadastroContatos,
  createCadastroEnderecos,
  createCadastroVinculosComerciais,
  createCadastro,
  listVendedores,
  searchCadastrosParaVinculo,
  updateCadastro,
  updateCadastroContato,
  updateCadastroEndereco,
  checkEnderecoReferenciadoEmProposta,
  deleteCadastroEndereco,
  updateCadastroVinculoComercial,
  validateCadastroInitialStep,
  aplicarReconsultaCnpj,
  type ReconsultaCamposCadastro,
  type ReconsultaEnderecoReceita,
  getModelosCobranca,
  type CadastroContatoInsertPayload,
  type CadastroUpdatePayload,
  type CadastroEnderecoInsertPayload,
  type CadastroInsertPayload,
  type CadastroVinculoComercialInsertPayload,
  type VendedorOption
} from "@/features/cadastros/services/cadastros.service";
import { ReconsultaCnpjModal } from "@/features/cadastros/components/ReconsultaCnpjModal";
import {
  aplicarReconsultaNoFormulario,
  montarPreviaReconsulta,
  type ConsultaDocumentoApiPayload,
  type ReconsultaPrevia
} from "@/features/cadastros/lib/reconsulta-cnpj";
import { normalizeDocumentDigits, validateDocumentByTipo, isValidCpf } from "@/features/cadastros/utils/documento";
import type {
  Cadastro,
  CadastroCategoria,
  CadastroContato,
  CadastroEndereco,
  CadastroFormState,
  TipoClienteDocumento
} from "@/features/cadastros/types";
import { VinculosNotaFiscalCard } from "./components/VinculosNotaFiscalCard";
import { ImportSistemaAntigoModal } from "./components/ImportSistemaAntigoModal";
import type { ExtractedData } from "./components/ImportSistemaAntigoModal";

type CadastroFormPageProps = {
  mode: "new" | "edit";
  cadastro?: Cadastro;
  categoriaInicial?: CadastroCategoria;
};

type FormMessage = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
};



const categoriaLabel: Record<CadastroCategoria, string> = {
  CLIENTE: "Cliente",
  FORNECEDOR: "Fornecedor",
  TRANSPORTADORA: "Transportadora",
  ORGAO_PUBLICO: "Orgao publico"
};

const categoriaOptions: CadastroCategoria[] = ["CLIENTE", "FORNECEDOR", "TRANSPORTADORA", "ORGAO_PUBLICO"];

function validateEnderecos(enderecos: CadastroEndereco[]): { isValid: boolean; message?: string } {
  const hasPrincipal = enderecos.some(e => e.tipo === "principal");
  if (!hasPrincipal) {
    return { isValid: false, message: "O cadastro deve conter pelo menos um endereço do tipo Principal." };
  }

  for (let i = 0; i < enderecos.length; i++) {
    const end = enderecos[i];
    const cleanCep = (end.cep || "").replace(/\D/g, "");
    if (cleanCep.length !== 8) {
      return { isValid: false, message: `O CEP do endereço ${i + 1} (${end.tipo}) deve conter exatamente 8 dígitos.` };
    }
    if (!(end.endereco || "").trim()) {
      return { isValid: false, message: `O logradouro do endereço ${i + 1} (${end.tipo}) é obrigatório.` };
    }
    if (!(end.numero || "").trim()) {
      return { isValid: false, message: `O número do endereço ${i + 1} (${end.tipo}) é obrigatório.` };
    }
    if (!(end.bairro || "").trim()) {
      return { isValid: false, message: `O bairro do endereço ${i + 1} (${end.tipo}) é obrigatório.` };
    }
    if (!(end.cidade || "").trim()) {
      return { isValid: false, message: `A cidade do endereço ${i + 1} (${end.tipo}) é obrigatória.` };
    }
    if (!(end.uf || "").trim() || end.uf.trim().length !== 2) {
      return { isValid: false, message: `A UF (2 letras) do endereço ${i + 1} (${end.tipo}) é obrigatória.` };
    }
  }

  return { isValid: true };
}

export function CadastroFormPage({ mode, cadastro, categoriaInicial }: CadastroFormPageProps) {
  const router = useRouter();
  const { user } = useAuth();

  // ── Fluxo "criar cadastro novo a partir do vínculo" ────────────────────────
  // Ida:   /cadastros/novo?documento=…&origemVinculo=<idCliente>&tipoRelacao=…
  // Volta: /cadastros/<origem>/editar?novoVinculo=<idCriado>&tipoRelacao=…
  const searchParams = useSearchParams();
  const documentoInicial = normalizeDocumentDigits(searchParams.get("documento") || "");
  const origemVinculo = searchParams.get("origemVinculo") || "";
  const tipoRelacaoParam = searchParams.get("tipoRelacao") || "";
  const novoVinculoParam = Number(searchParams.get("novoVinculo") || 0) || undefined;

  const canViewCredito = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cadastros.view_credito");
  const canEditCredito = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cadastros.edit_credito");
  const canCreate = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cadastros.create");
  const canEdit = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cadastros.edit");
  const canEditFiscal = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cadastros.edit_fiscal");

  const isEditAllowed = mode === "edit" ? canEdit : canCreate;

  const { showToast } = useAppToast();
  const [isInitialValidated, setIsInitialValidated] = useState(mode === "edit");
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [form, setForm] = useState<CadastroFormState>(() =>
    createInitialState(cadastro, mode === "new" ? documentoInicial : "", categoriaInicial)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isInitialChecking, setIsInitialChecking] = useState(false);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [vendedorOptions, setVendedorOptions] = useState<VendedorOption[]>([]);
  const [modelosCobranca, setModelosCobranca] = useState<{ id: string; resultado: string }[]>([]);
  const [isLoadingVendedores, setIsLoadingVendedores] = useState(mode === "new");
  const [validatedDocumentoDigits, setValidatedDocumentoDigits] = useState<string | null>(
    mode === "edit" ? normalizeDocumentDigits(cadastro?.documento ?? "") : null
  );
  const [hasImportedApiData, setHasImportedApiData] = useState(false);
  // Reconsulta do CNPJ em dois passos: `reconsulta` guarda a previa enquanto o
  // usuario decide. Null = modal fechado, nada pendente.
  const [reconsulta, setReconsulta] = useState<ReconsultaPrevia | null>(null);
  const [isReconsultando, setIsReconsultando] = useState(false);
  const [isAplicandoReconsulta, setIsAplicandoReconsulta] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const originalDocument = cadastro?.documento ?? "";

  const limparParamVinculo = useCallback(() => {
    if (!novoVinculoParam) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("novoVinculo");
    params.delete("tipoRelacao");
    const query = params.toString();
    router.replace(query ? `?${query}` : window.location.pathname, { scroll: false });
  }, [novoVinculoParam, searchParams, router]);

  const title = mode === "new" ? "Novo cliente" : `Editar cliente #${cadastro?.idCliente}`;
  const subtitle =
    mode === "new"
      ? "Preencha os dados principais e salve para criar o cliente."
      : "Atualize os dados deste cliente e salve para confirmar as alterações.";

  const formattedDocument = useMemo(
    () => maskDocument(form.documento, form.tipoCliente),
    [form.documento, form.tipoCliente]
  );
  const isDocumentoLocked = mode === "new" && Boolean(validatedDocumentoDigits);

  useEffect(() => {
    let isMounted = true;
    async function loadVendedores() {
      setIsLoadingVendedores(true);
      const [vendedores, modelos] = await Promise.all([
        listVendedores(),
        getModelosCobranca()
      ]);
      if (!isMounted) {
        return;
      }
      setVendedorOptions(vendedores);
      setModelosCobranca(modelos);
      setIsLoadingVendedores(false);
    }

    void loadVendedores();
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Cadastro NOVO aberto por um vendedor ja nasce com ele proprio no campo
   * Atendente (item 2, 20/08/2026).
   *
   * E preenchimento, nao trava: o campo continua editavel e o usuario pode
   * trocar de atendente normalmente. So age quando o campo esta VAZIO — nunca
   * sobrescreve escolha do usuario, nem o valor que veio da importacao do
   * sistema antigo (`handleApplyImport`), que roda depois e tem precedencia.
   *
   * Espera `vendedorOptions` carregar porque o valor gravado e o NOME da opcao:
   * escrever um nome fora da lista deixaria o select sem correspondencia e o
   * `id_vendedor` nulo no salvamento.
   */
  useEffect(() => {
    if (mode !== "new") return;
    if (isLoadingVendedores || vendedorOptions.length === 0) return;
    if (!user?.isSeller) return;
    if (form.atendente.trim() !== "") return;

    // Casar por UID e o caminho confiavel: `idVendedor` cai em `user_id` quando
    // `id_vendedor` e nulo. O nome e a rede de seguranca, porque o rotulo da
    // opcao pode vir de `meu_vendedor`, que nem sempre e igual a `nome_usuario`.
    const porUid = vendedorOptions.find(
      (opcao) => opcao.idVendedor != null && String(opcao.idVendedor) === String(user.id)
    );
    const nomeUsuario = (user.name || "").trim().toLowerCase();
    const porNome = nomeUsuario
      ? vendedorOptions.find((opcao) => opcao.nome.trim().toLowerCase() === nomeUsuario)
      : undefined;
    const escolhida = porUid ?? porNome;
    if (!escolhida) return;

    setForm((atual) =>
      atual.atendente.trim() === ""
        ? { ...atual, atendente: escolhida.nome, idVendedor: String(escolhida.idVendedor ?? "") }
        : atual
    );
  }, [mode, isLoadingVendedores, vendedorOptions, user, form.atendente]);

  function updateField<K extends keyof CadastroFormState>(field: K, value: CadastroFormState[K]) {
    if (isDocumentoLocked && (field === "documento" || field === "tipoCliente")) {
      return;
    }

    setForm((current) => ({ ...current, [field]: value }));
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

  function handleApplyImport(data: ExtractedData) {
    let matchedVendedorNome = "";
    let matchedVendedorId = "";
    if (data.cliente.nome_vendedor) {
      const query = data.cliente.nome_vendedor.trim().toLowerCase();
      const matched = vendedorOptions.find(
        (v) => v.nome.trim().toLowerCase().includes(query) || query.includes(v.nome.trim().toLowerCase())
      );
      if (matched) {
        matchedVendedorNome = matched.nome;
        matchedVendedorId = String(matched.idVendedor ?? "");
      }
    }

    const enderecos: CadastroEndereco[] = [];
    if (data.endereco.cep || data.endereco.endereco) {
      enderecos.push({
        id: `end_${Date.now()}`,
        tipo: "principal",
        cep: data.endereco.cep || "",
        endereco: data.endereco.endereco || "",
        numero: data.endereco.numero || "",
        complemento: data.endereco.complemento || "",
        bairro: data.endereco.bairro || "",
        cidade: data.endereco.cidade || "",
        uf: (data.endereco.uf || "").toUpperCase().slice(0, 2),
        obs: "",
        recebedor: "",
        cpfRecebedor: ""
      });
    }

    const contatos: CadastroContato[] = (data.contatos || []).map((c, index) => ({
      id: `cont_${Date.now()}_${index}`,
      nome: (c.nome_contato || "").trim(),
      cargo: c.cargo || "",
      whatsapp: c.whats || "",
      email: c.e_mail || ""
    }));

    const city = data.endereco.cidade ? data.endereco.cidade.trim() : "";
    const state = data.endereco.uf ? data.endereco.uf.trim().toUpperCase() : "";
    const cityStateStr = city && state ? `${city}/${state}` : (city || state || "");

    const dateStr = new Date().toLocaleDateString("pt-BR");
    let importObs = `Cadastro importado do sistema antigo via texto bruto em ${dateStr}.`;
    if (data.metadados?.data_cadastro_origem) {
      importObs += ` Data de cadastro original: ${data.metadados.data_cadastro_origem}.`;
    }
    if (data.metadados?.data_atualizacao_origem) {
      importObs += ` Última atualização original: ${data.metadados.data_atualizacao_origem}.`;
    }

    const cleanCurrentObs = (form.observacoes || "")
      .split("\n")
      .filter((line) => !line.includes("Cadastro importado do sistema antigo via texto bruto"))
      .join("\n")
      .trim();

    const finalObs = cleanCurrentObs 
      ? `${cleanCurrentObs}\n${importObs}`
      : importObs;

    setForm((current) => ({
      ...current,
      idCliente: data.cliente.id_cliente || "",
      tipoCliente: data.cliente.tipo_pessoa === "CPF" ? "CPF" : "CNPJ",
      documento: data.cliente.documento || "",
      nome: data.cliente.nome || "",
      fantasia: data.cliente.fantasia || "",
      apelido: data.cliente.apelido || "",
      contato: data.cliente.contato || "",
      inscricaoEstadual: data.cliente.ins_estadual || "",
      inscricaoMunicipal: data.cliente.ins_municipal || "",
      isentoInscricaoEstadual: data.cliente.ins_estadual?.toUpperCase() === "ISENTO",
      email: data.cliente.email || "",
      emailFinanceiro: data.cliente.email_contato || "",
      telefoneFixo: data.cliente.telefone_fixo || "",
      whatsapp: data.cliente.whatsapp_1 || "",
      whatsapp2: data.cliente.whatsapp_2 || "",
      site: data.cliente.site || "",
      cidadeUf: cityStateStr,
      atendente: matchedVendedorNome,
      idVendedor: matchedVendedorId,
      observacoes: finalObs,
      enderecos,
      contatos
    }));

    setValidatedDocumentoDigits(data.cliente.documento || null);
    setIsInitialValidated(true);
  }

  /**
   * PASSO 1 da reconsulta: consulta a Receita e MONTA A COMPARACAO. Nao grava.
   *
   * POR QUE EM DOIS PASSOS (26/08/2026)
   *   Antes o botao "Reconsultar" consultava e gravava no mesmo clique, sem
   *   mostrar nada. Como a gravacao SOBRESCREVE o endereco principal — a linha
   *   que a etiqueta dos Correios e o destinatario da NF-e leem — trocar um
   *   endereco por outro as cegas e caro demais. Agora abre o comparativo e o
   *   usuario confirma.
   *
   * SO PARA CNPJ. Cadastro com CPF nao tem consulta; o botao nem aparece.
   */
  async function handleReconsultarCnpj() {
    if (form.tipoCliente !== "CNPJ" || !form.documento || !form.idCliente) return;
    setIsReconsultando(true);
    try {
      const response = await fetch("/api/cadastros/consultar-documento", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipoPessoa: "JURIDICA",
          documento: form.documento,
          idCliente: Number(form.idCliente),
          // Sem isto a rota barra o cadastro por "ja existe" — o proprio cadastro
          // que estamos reconsultando. Era o 409 que travava este botao.
          modo: "reconsulta"
        })
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success || !data.payload) {
        showToast({
          type: "warning",
          title: "Consulta indisponível",
          description: data?.message || "Não foi possível consultar os dados da Receita."
        });
        return;
      }

      setReconsulta(montarPreviaReconsulta(form, data.payload));
    } catch (error) {
      console.error(error);
      showToast({
        type: "error",
        title: "Erro de consulta",
        description: "Falha de rede ou instabilidade na Receita Federal."
      });
    } finally {
      setIsReconsultando(false);
    }
  }

  /**
   * PASSO 2: o usuario confirmou. Grava.
   *
   * O estado do formulario e atualizado junto para a tela refletir o que foi
   * gravado sem recarregar — inclusive o endereco principal, que e somente
   * leitura no formulario e so muda por aqui.
   */
  async function handleConfirmarReconsulta() {
    if (!reconsulta) return;
    setIsAplicandoReconsulta(true);
    try {
      const resultado = await aplicarReconsultaCnpj({
        idCliente: Number(form.idCliente),
        campos: reconsulta.camposParaGravar,
        endereco: reconsulta.enderecoParaGravar,
        autor: [user?.name, user?.email].filter(Boolean).join(" — "),
        quandoIso: new Date().toISOString()
      });

      if (!resultado.success) {
        showToast({
          type: "error",
          title: "Erro ao aplicar",
          description: resultado.errorMessage || "Falha ao gravar os dados da Receita."
        });
        return;
      }

      setForm((atual) =>
        aplicarReconsultaNoFormulario(atual, reconsulta, resultado.enderecoId, resultado.enderecoObs)
      );
      setReconsulta(null);

      const sobreEndereco =
        resultado.enderecoAcao === "criado"
          ? " Endereço principal criado."
          : resultado.enderecoAcao === "atualizado"
            ? " Endereço principal sobrescrito."
            : "";
      showToast({
        type: "success",
        title: "Cadastro atualizado pela Receita",
        description: `Dados gravados.${sobreEndereco}`
      });
    } catch (error) {
      console.error(error);
      showToast({
        type: "error",
        title: "Erro ao aplicar",
        description: "Falha de rede ao gravar os dados da Receita."
      });
    } finally {
      setIsAplicandoReconsulta(false);
    }
  }
  function handleResetDocumentoValidation() {
    setIsInitialValidated(false);
    setValidatedDocumentoDigits(null);
    setHasImportedApiData(false);
    setMessage({
      tone: "info",
      title: "Identificação reiniciada",
      description: "Altere o documento e execute a validação inicial novamente."
    });
    setErrorFields([]);
    setFieldErrors({});
    setForm((current) => ({
      ...current,
      documento: "",
      nome: "",
      fantasia: "",
      dataFundacao: "",
      email: "",
      telefoneFixo: "",
      tipoContribuinte: "",
      inscricaoEstadual: "",
      isentoInscricaoEstadual: false,
      enderecos: [],
      contatos: [],
      vinculosComerciais: []
    }));
  }

  async function handleInitialValidation() {
    setMessage(null);
    setFieldErrors({});
    setErrorFields([]);
    setHasImportedApiData(false);
    setValidatedDocumentoDigits(null);

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
      console.error(error);
      setIsInitialChecking(false);
      setMessage({
        tone: "danger",
        title: "Nao foi possivel consultar CNPJ",
        description: "Falha de rede ou instabilidade na Receita Federal."
      });
      showToast({
        type: "error",
        title: "Erro de consulta",
        description: "Tente preencher os dados manualmente."
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
        description: validationResult.errorMessage || "Não foi possível validar o documento agora. Tente novamente."
      });
      showToast({
        type: "error",
        title: "Falha na validacao",
        description: validationResult.errorMessage || "Não foi possível validar o documento agora. Tente novamente."
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
        setForm((current) => {
          let enderecos = current.enderecos;
          if (enderecos.length === 0) {
            enderecos = [{
              id: `end_${Date.now()}`,
              tipo: "principal",
              cep: "",
              endereco: "",
              numero: "",
              complemento: "",
              bairro: "",
              cidade: "",
              uf: "",
              obs: "",
              recebedor: "",
              cpfRecebedor: ""
            }];
          }
          return { ...current, enderecos };
        });
      } else {
        const payload = data.payload;
        const enderecoImportado = payload.enderecoPreparado
          ? mapPreparedEnderecoToForm(payload.enderecoPreparado)
          : null;

        setForm((current) => {
          let enderecos = current.enderecos;
          if (enderecoImportado) {
            enderecos = [enderecoImportado];
          } else if (enderecos.length === 0) {
            enderecos = [{
              id: `end_${Date.now()}`,
              tipo: "principal",
              cep: "",
              endereco: "",
              numero: "",
              complemento: "",
              bairro: "",
              cidade: "",
              uf: "",
              obs: "",
              recebedor: "",
              cpfRecebedor: ""
            }];
          }
          return {
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
            // Isento de IE = tudo que nao e `1`. O `1` e o unico codigo que
            // afirma inscricao estadual ativa; `2` e `9` nao tem IE a declarar.
            isentoInscricaoEstadual: payload.tipoContribuinte !== "1",
            enderecos
          };
        });

        setHasImportedApiData(true);
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
      setForm((current) => {
        let enderecos = current.enderecos;
        if (enderecos.length === 0) {
          enderecos = [{
            id: `end_${Date.now()}`,
            tipo: "principal",
            cep: "",
            endereco: "",
            numero: "",
            complemento: "",
            bairro: "",
            cidade: "",
            uf: "",
            obs: "",
            recebedor: "",
            cpfRecebedor: ""
          }];
        }
        return { ...current, enderecos };
      });
    }

    setIsInitialValidated(true);
    setValidatedDocumentoDigits(documentoValidation.digits);
    setMessage({
      tone: consultaTone,
      title: "Dados iniciais validados",
      description: consultaMessage
    });
  }

  async function handleCreateCadastro() {
    if (!canCreate) {
      showToast({
        type: "error",
        title: "Acesso negado",
        description: "Você não tem permissão para criar cadastros."
      });
      return;
    }

    setMessage(null);
    setErrorFields([]);

    const idCliente = Number(form.idCliente);
    const documentoDigits = normalizeDocumentDigits(form.documento);
    const inferredTipoPessoa = inferTipoPessoaFromDocumento(form.documento);
    const selectedVendedor = vendedorOptions.find((item) => item.nome === form.atendente);
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
      !inferredTipoPessoa ? "documento" : null,
      !contactEmail && !contactWhatsApp ? "email" : null,
      !contactEmail && !contactWhatsApp ? "whatsapp" : null
    ].filter(Boolean) as string[];

    if (missingFields.length) {
      setErrorFields(Array.from(new Set(missingFields)));
      setMessage({
        tone: "danger",
        title: "Campos obrigatórios ausentes",
        description: "Preencha ID, nome, documento, contato e o atendente antes de continuar."
      });
      showToast({
        type: "error",
        title: "Não foi possível salvar",
        description: "Revise os campos destacados antes de continuar."
      });
      return;
    }

    const addrValidation = validateEnderecos(form.enderecos);
    if (!addrValidation.isValid) {
      setMessage({
        tone: "danger",
        title: "Endereço incompleto ou inválido",
        description: addrValidation.message || ""
      });
      showToast({
        type: "error",
        title: "Falha na validação",
        description: addrValidation.message || ""
      });
      return;
    }

    if (mode === "new" && validatedDocumentoDigits && validatedDocumentoDigits !== documentoDigits) {
      setErrorFields(["documento"]);
      setMessage({
        tone: "danger",
        title: "Documento diferente do validado",
        description: "Use a ação Alterar documento para reiniciar a identificação antes de salvar."
      });
      showToast({
        type: "error",
        title: "Documento diferente do validado",
        description: "Reinicie a identificação para validar novamente."
      });
      return;
    }

    const contatosPreenchidos = form.contatos.filter(
      (item) => item.nome.trim() || item.cargo.trim() || item.whatsapp.trim() || item.email.trim()
    );
    const contatoSemNome = contatosPreenchidos.some((item) => !item.nome.trim());
    if (contatoSemNome) {
      setMessage({
        tone: "danger",
        title: "Contato sem nome",
        description: "Preencha o nome para todos os contatos adicionados antes de salvar."
      });
      showToast({
        type: "error",
        title: "Contato sem nome",
        description: "Nome do contato é obrigatório."
      });
      return;
    }

    const vinculosPreenchidos = form.vinculosComerciais.filter(
      (item) => Number.isInteger(item.idClienteRelacionado) && item.idClienteRelacionado > 0
    );
    const vinculoProprio = vinculosPreenchidos.some((item) => item.idClienteRelacionado === idCliente);
    if (vinculoProprio) {
      setMessage({
        tone: "danger",
        title: "Vínculo inválido",
        description: "Não é permitido criar vínculo comercial com o próprio cadastro."
      });
      showToast({
        type: "error",
        title: "Vínculo inválido",
        description: "Remova o vínculo com o próprio ID."
      });
      return;
    }

    const uniqueVinculos = new Set<number>();
    for (const vinculo of vinculosPreenchidos) {
      if (uniqueVinculos.has(vinculo.idClienteRelacionado)) {
        setMessage({
          tone: "danger",
          title: "Vínculo duplicado",
          description: `O vínculo com ID ${vinculo.idClienteRelacionado} está repetido no formulário.`
        });
        showToast({
          type: "error",
          title: "Vínculo duplicado",
          description: "Mantenha apenas um vínculo por cadastro relacionado."
        });
        return;
      }
      uniqueVinculos.add(vinculo.idClienteRelacionado);
    }

    // CPF Recebedor validation
    for (let i = 0; i < form.enderecos.length; i++) {
      const end = form.enderecos[i];
      if (end.cpfRecebedor && end.cpfRecebedor.trim() !== "") {
        if (!isValidCpf(end.cpfRecebedor)) {
          showToast({
            type: "error",
            title: "CPF do recebedor inválido",
            description: `O CPF do recebedor preenchido no endereço ${i + 1} está incorreto.`
          });
          return;
        }
      }
    }

    setIsSaving(true);

    const insertPayload: CadastroInsertPayload = {
      id_cliente: idCliente,
      id_vendedor: selectedVendedor?.idVendedor ?? normalizeOptionalText(form.idVendedor),
      nome_vendedor: normalizeOptionalText(form.atendente),
      categoria: form.categoria,
      nome: form.nome.trim(),
      fantasia: normalizeOptionalText(form.fantasia),
      apelido: normalizeOptionalText(form.apelido),
      contato: normalizeOptionalText(form.contato || contactName),
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
      limite_credito: normalizeOptionalText(form.limiteCredito),
      // credito NÃO é enviado: saldo de crédito é gerido só pela Conta Corrente.
      risco_credito: normalizeOptionalText(form.riscoCredito),
      obs: normalizeOptionalText(form.observacoes),
      data_cadastro: normalizeOptionalText(form.dataCadastro),
      recebe_email: form.sendMail,
      recebe_whatsapp: form.sendWhats,
      padrao_pagamento: normalizeOptionalText(form.padraoPagamento) || "Pix à vista 3 dias",
      empresa_padrao: normalizeOptionalText(form.empresaPadrao),
      cidade_uf: normalizeOptionalText(form.cidadeUf),
      nota: form.nota,
      verificado: form.verificado,
      ultima_compra: normalizeOptionalText(form.ultimaCompra),
      total_compras: normalizeOptionalText(form.totalCompras),
      data_verificacao: normalizeOptionalText(form.dataVerificacao),
      motivo_erro: normalizeOptionalText(form.motivoErro),
      cpf_invalido: form.cpfInvalido,
      cpf_erro: normalizeOptionalText(form.cpfErro),
      is_bonus: form.bonusAtivo,
      usa_preco_fixo: form.usaPrecoFixo,
      percentual_bunus: normalizeOptionalText(form.percentualBonus),
      id_modelo_cobranca: form.modeloCobrancaId || null
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

    const relatedWarnings: string[] = [];

    const enderecosPayload: CadastroEnderecoInsertPayload[] = form.enderecos.map((item) => ({
      id_cliente: result.cadastro.idCliente,
      cep: normalizeOptionalText(item.cep),
      endereco: normalizeOptionalText(item.endereco),
      numero: normalizeOptionalText(item.numero),
      complemento: normalizeOptionalText(item.complemento),
      bairro: normalizeOptionalText(item.bairro),
      cidade: normalizeOptionalText(item.cidade),
      uf: normalizeOptionalText(item.uf),
      tipo_endereco: item.tipo.toUpperCase(),
      obs: normalizeOptionalText(item.obs),
      recebedor: normalizeOptionalText(item.recebedor),
      cpf_recebedor: normalizeOptionalText(item.cpfRecebedor)
    }));
    if (enderecosPayload.length > 0) {
      const enderecoResult = await createCadastroEnderecos(enderecosPayload);
      if (!enderecoResult.success) {
        relatedWarnings.push(
          "Cadastro criado, mas houve erro ao salvar endereços. Adicione os endereços manualmente."
        );
      } else if (enderecoResult.principalAcao === "sobrescrito") {
        // O usuario precisa SABER que aquele numero de cliente ja tinha endereco
        // principal — quase sempre orfao da importacao de 20/12/2025. Antes o
        // endereco antigo ficava e o do cadastro novo era o que sumia, em
        // silencio; agora e o contrario, e o silencio tambem acaba.
        relatedWarnings.push(
          `O ID ${result.cadastro.idCliente} já tinha um endereço principal de outro cadastro. Ele foi substituído pelo endereço deste cadastro — nada foi apagado.`
        );
      }
    }

    const contatosPayload: CadastroContatoInsertPayload[] = contatosPreenchidos.map((item) => ({
      id_cliente: result.cadastro.idCliente,
      nome_contato: item.nome.trim(),
      cargo: normalizeOptionalText(item.cargo),
      whats: normalizeOptionalText(item.whatsapp),
      e_mail: normalizeOptionalText(item.email)
    }));
    if (contatosPayload.length > 0) {
      const contatosResult = await createCadastroContatos(contatosPayload);
      if (!contatosResult.success) {
        relatedWarnings.push(
          "Cadastro criado, mas houve erro ao salvar contatos. Adicione os contatos manualmente."
        );
      }
    }

    const vinculosPayload: CadastroVinculoComercialInsertPayload[] = vinculosPreenchidos.map((item) => ({
      id_cliente_principal: result.cadastro.idCliente,
      id_cliente_socio: item.idClienteRelacionado,
      tipo_relacao: normalizeOptionalText(item.tipoRelacao) || "vinculo_comercial"
    }));
    if (vinculosPayload.length > 0) {
      const vinculosResult = await createCadastroVinculosComerciais(vinculosPayload);
      if (!vinculosResult.success) {
        relatedWarnings.push(
          "Cadastro criado, mas houve erro ao salvar vínculos comerciais. Adicione os vínculos manualmente."
        );
      }
    }

    setMessage({
      tone: relatedWarnings.length > 0 ? "warning" : "success",
      title: relatedWarnings.length > 0 ? "Cadastro criado com ressalvas." : "Cadastro criado com sucesso.",
      description:
        relatedWarnings.length > 0
          ? relatedWarnings.join(" ")
          : "Redirecionando para o detalhe do cadastro criado."
    });
    showToast({
      type: relatedWarnings.length > 0 ? "warning" : "success",
      title: relatedWarnings.length > 0 ? "Cadastro criado com ressalvas" : "Cadastro criado com sucesso.",
      description:
        relatedWarnings.length > 0
          ? "Cadastro principal salvo, mas houve falha em parte dos dados relacionados."
          : `Cliente #${result.cadastro.idCliente} salvo.`
    });

    setIsSaving(false);

    // Veio do card de vínculos de outro cliente: volta para lá com o cadastro
    // recém-criado já escolhido, em vez de cair no detalhe deste novo cadastro.
    const destino = origemVinculo
      ? `/cadastros/${origemVinculo}/editar?novoVinculo=${result.cadastro.idCliente}${
          tipoRelacaoParam ? `&tipoRelacao=${encodeURIComponent(tipoRelacaoParam)}` : ""
        }`
      : `/cadastros/${result.cadastro.idCliente}`;

    window.setTimeout(() => {
      router.push(destino);
    }, 1000);
  }

  async function handleUpdateCadastro() {
    if (mode !== "edit") {
      return;
    }

    if (!canEdit) {
      showToast({
        type: "error",
        title: "Acesso negado",
        description: "Você não tem permissão para editar cadastros."
      });
      return;
    }

    setMessage(null);
    setErrorFields([]);
    setIsSaving(true);

    const idCliente = Number(form.idCliente);
    const documentoDigits = normalizeDocumentDigits(form.documento);
    const inferredTipoPessoa = inferTipoPessoaFromDocumento(form.documento);
    const selectedVendedor = vendedorOptions.find((item) => item.nome === form.atendente);

    if (!Number.isInteger(idCliente) || idCliente <= 0 || !documentoDigits || !inferredTipoPessoa) {
      setIsSaving(false);
      setMessage({
        tone: "danger",
        title: "Dados principais inválidos",
        description: "Revise ID, documento e tipo de pessoa antes de salvar."
      });
      return;
    }

    const addrValidation = validateEnderecos(form.enderecos);
    if (!addrValidation.isValid) {
      setIsSaving(false);
      setMessage({
        tone: "danger",
        title: "Endereço incompleto ou inválido",
        description: addrValidation.message || ""
      });
      showToast({
        type: "error",
        title: "Falha na validação",
        description: addrValidation.message || ""
      });
      return;
    }

    const updatePayload: CadastroUpdatePayload = {
      id_vendedor: selectedVendedor?.idVendedor ?? normalizeOptionalText(form.idVendedor),
      nome_vendedor: normalizeOptionalText(form.atendente),
      categoria: form.categoria,
      nome: form.nome.trim(),
      fantasia: normalizeOptionalText(form.fantasia),
      apelido: normalizeOptionalText(form.apelido),
      contato: normalizeOptionalText(form.contato),
      documento: documentoDigits,
      tipo_pessoa: inferredTipoPessoa,
      ins_estadual: normalizeOptionalText(form.inscricaoEstadual),
      ins_municipal: normalizeOptionalText(form.inscricaoMunicipal),
      tipo_contribuinte: normalizeOptionalText(form.tipoContribuinte),
      data_fundacao: normalizeOptionalText(form.dataFundacao),
      email_contato: normalizeOptionalText(form.email),
      email_financeiro: normalizeOptionalText(form.emailFinanceiro),
      email: normalizeOptionalText(form.email),
      telefone_fixo: normalizeOptionalText(form.telefoneFixo),
      whatsapp_1: normalizeOptionalText(form.whatsapp),
      whatsapp_2: normalizeOptionalText(form.whatsapp2),
      site: normalizeOptionalText(form.site),
      ativo: form.ativo,
      restricao: form.restricao,
      limite_credito: normalizeOptionalText(form.limiteCredito),
      // credito NÃO é enviado: saldo de crédito é gerido só pela Conta Corrente.
      risco_credito: normalizeOptionalText(form.riscoCredito),
      obs: normalizeOptionalText(form.observacoes),
      data_cadastro: normalizeOptionalText(form.dataCadastro),
      recebe_email: form.sendMail,
      recebe_whatsapp: form.sendWhats,
      padrao_pagamento: normalizeOptionalText(form.padraoPagamento),
      empresa_padrao: normalizeOptionalText(form.empresaPadrao),
      cidade_uf: normalizeOptionalText(form.cidadeUf),
      nota: form.nota,
      verificado: form.verificado,
      ultima_compra: normalizeOptionalText(form.ultimaCompra),
      total_compras: normalizeOptionalText(form.totalCompras),
      data_verificacao: normalizeOptionalText(form.dataVerificacao),
      motivo_erro: normalizeOptionalText(form.motivoErro),
      cpf_invalido: form.cpfInvalido,
      cpf_erro: normalizeOptionalText(form.cpfErro),
      is_bonus: form.bonusAtivo,
      usa_preco_fixo: form.usaPrecoFixo,
      percentual_bunus: normalizeOptionalText(form.percentualBonus),
      id_modelo_cobranca: form.modeloCobrancaId || null
    };

    const result = await updateCadastro(idCliente, updatePayload);
    if (!result.success) {
      setIsSaving(false);
      setMessage({
        tone: "danger",
        title: "Não foi possível atualizar o cadastro",
        description: result.errorMessage
      });
      showToast({
        type: "error",
        title: "Falha ao atualizar cadastro",
        description: result.errorMessage
      });
      return;
    }

    const warnings: string[] = [];

    for (const endereco of form.enderecos) {
      const payload = {
        cep: normalizeOptionalText(endereco.cep),
        endereco: normalizeOptionalText(endereco.endereco),
        numero: normalizeOptionalText(endereco.numero),
        complemento: normalizeOptionalText(endereco.complemento),
        bairro: normalizeOptionalText(endereco.bairro),
        cidade: normalizeOptionalText(endereco.cidade),
        uf: normalizeOptionalText(endereco.uf),
        tipo_endereco: endereco.tipo.toUpperCase(),
        obs: normalizeOptionalText(endereco.obs),
        recebedor: normalizeOptionalText(endereco.recebedor),
        cpf_recebedor: normalizeOptionalText(endereco.cpfRecebedor)
      };

      const enderecoResult = isTemporaryId(endereco.id)
        ? await createCadastroEnderecos([{ id_cliente: idCliente, ...payload }])
        : await updateCadastroEndereco(endereco.id, payload);
      if (!enderecoResult.success) {
        warnings.push("Houve falha ao salvar parte dos endereços.");
        break;
      }
    }

    for (const contato of form.contatos) {
      if (!contato.nome.trim()) {
        continue;
      }
      const payload = {
        nome_contato: contato.nome.trim(),
        cargo: normalizeOptionalText(contato.cargo),
        whats: normalizeOptionalText(contato.whatsapp),
        e_mail: normalizeOptionalText(contato.email)
      };

      const contatoResult = isTemporaryId(contato.id)
        ? await createCadastroContatos([{ id_cliente: idCliente, ...payload }])
        : await updateCadastroContato(contato.id, payload);
      if (!contatoResult.success) {
        warnings.push("Houve falha ao salvar parte dos contatos.");
        break;
      }
    }

    for (const vinculo of form.vinculosComerciais) {
      if (!vinculo.idClienteRelacionado || vinculo.idClienteRelacionado === idCliente) {
        continue;
      }

      const payload = {
        tipo_relacao: normalizeOptionalText(vinculo.tipoRelacao) || "vinculo_comercial"
      };

      const vinculoResult = isTemporaryId(vinculo.id)
        ? await createCadastroVinculosComerciais([
            {
              id_cliente_principal: idCliente,
              id_cliente_socio: vinculo.idClienteRelacionado,
              tipo_relacao: payload.tipo_relacao
            }
          ])
        : await updateCadastroVinculoComercial(vinculo.id, payload);
      if (!vinculoResult.success) {
        warnings.push("Houve falha ao salvar parte dos vínculos comerciais.");
        break;
      }
    }

    setIsSaving(false);
    setMessage({
      tone: warnings.length ? "warning" : "success",
      title: warnings.length ? "Cadastro atualizado com ressalvas." : "Cadastro atualizado com sucesso.",
      description: warnings.length ? warnings.join(" ") : "Dados principais e relacionados foram salvos."
    });
    showToast({
      type: warnings.length ? "warning" : "success",
      title: warnings.length ? "Atualização parcial" : "Cadastro atualizado",
      description: warnings.length ? warnings.join(" ") : "Atualização concluída."
    });

    window.setTimeout(() => {
      router.push(`/cadastros/${idCliente}`);
    }, 1200);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        context="Clientes"
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/cadastros"
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Voltar para lista
            </Link>
            {mode === "new" && !isInitialValidated ? (
              <>
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(true)}
                  className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-800 transition hover:bg-teal-100"
                >
                  Importar do sistema antigo
                </button>
                <button
                  type="button"
                  onClick={handleInitialValidation}
                  disabled={isInitialChecking}
                  className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isInitialChecking ? "Validando..." : "Continuar"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={mode === "new" ? handleCreateCadastro : handleUpdateCadastro}
                disabled={isSaving || !isEditAllowed}
                className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSaving
                  ? "Salvando..."
                  : mode === "edit"
                    ? "Salvar campos liberados"
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
          vendedorOptions={vendedorOptions}
          isLoadingVendedores={isLoadingVendedores}
          mode={mode}
        />
      ) : (
        <CompleteForm
          form={form}
          formattedDocument={formattedDocument}
          onUpdate={updateField}
          onCancel={() => router.push("/cadastros")}
          onSave={mode === "new" ? handleCreateCadastro : handleUpdateCadastro}
          mode={mode}
          originalDocument={originalDocument}
          isSaving={isSaving}
          errorFields={errorFields}
          isDocumentoLocked={isDocumentoLocked}
          hasImportedApiData={hasImportedApiData}
          vendedorOptions={vendedorOptions}
          isLoadingVendedores={isLoadingVendedores}
          modelosCobranca={modelosCobranca}
          onResetDocumento={handleResetDocumentoValidation}
          onReconsultar={form.tipoCliente === "CNPJ" ? handleReconsultarCnpj : undefined}
          isReconsultando={isReconsultando}
          onToast={showToast}
          canViewCredito={canViewCredito}
          canEditCredito={canEditCredito}
          vinculoInicialId={mode === "edit" ? novoVinculoParam : undefined}
          tipoRelacaoInicial={tipoRelacaoParam || undefined}
          onConsumirVinculoInicial={limparParamVinculo}
        />
      )}

      <ImportSistemaAntigoModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onApply={handleApplyImport}
        vendedorOptions={vendedorOptions}
      />

      <ReconsultaCnpjModal
        isOpen={reconsulta !== null}
        idCliente={Number(form.idCliente) || 0}
        nomeCliente={form.nome}
        documentoFormatado={formattedDocument}
        campos={reconsulta?.campos ?? []}
        enderecoAtual={reconsulta?.enderecoAtualTexto ?? null}
        enderecoNovo={reconsulta?.enderecoNovoTexto ?? null}
        enderecoMudou={reconsulta?.enderecoMudou ?? false}
        criaEnderecoPrincipal={reconsulta?.criaEnderecoPrincipal ?? false}
        isAplicando={isAplicandoReconsulta}
        onClose={() => setReconsulta(null)}
        onConfirm={handleConfirmarReconsulta}
      />
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
  vendedorOptions,
  isLoadingVendedores,
  mode
}: {
  form: CadastroFormState;
  formattedDocument: string;
  onUpdate: <K extends keyof CadastroFormState>(field: K, value: CadastroFormState[K]) => void;
  onContinue: () => Promise<void>;
  errorFields: string[];
  fieldErrors: Record<string, string>;
  isChecking: boolean;
  vendedorOptions: VendedorOption[];
  isLoadingVendedores: boolean;
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
            disabled={isLoadingVendedores}
          >
            <option value="">
              {isLoadingVendedores ? "Carregando vendedores..." : "Selecione"}
            </option>
            {vendedorOptions.map((vendedor) => (
              <option key={`${vendedor.nome}-${String(vendedor.idVendedor ?? "")}`} value={vendedor.nome}>
                {vendedor.nome}
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
  isDocumentoLocked,
  hasImportedApiData,
  vendedorOptions,
  isLoadingVendedores,
  modelosCobranca,
  onResetDocumento,
  onReconsultar,
  isReconsultando,
  onToast,
  canViewCredito,
  canEditCredito,
  vinculoInicialId,
  tipoRelacaoInicial,
  onConsumirVinculoInicial
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
  isDocumentoLocked: boolean;
  hasImportedApiData: boolean;
  vendedorOptions: VendedorOption[];
  isLoadingVendedores: boolean;
  modelosCobranca: { id: string; resultado: string }[];
  onResetDocumento: () => void;
  onReconsultar?: () => void;
  isReconsultando?: boolean;
  onToast: (toast: { type: "success" | "error" | "warning" | "info"; title: string; description?: string }) => void;
  canViewCredito: boolean;
  canEditCredito: boolean;
  /** Cadastro recém-criado que volta pré-selecionado no card de vínculos. */
  vinculoInicialId?: number;
  tipoRelacaoInicial?: string;
  onConsumirVinculoInicial?: () => void;
}) {
  const { user } = useAuth();
  const canCreate = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cadastros.create");
  const canEdit = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cadastros.edit");
  const canEditFiscal = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cadastros.edit_fiscal");

  const isEditAllowed = mode === "edit" ? canEdit : canCreate;
  const isFiscalBlocked = form.tipoCliente === "CNPJ" && !canEditFiscal;

  const companies = mockCompanies.filter((company) => !company.isConsolidated);
  const documentChanged =
    mode === "edit" &&
    form.documento !== originalDocument &&
    form.documento !== "" &&
    originalDocument !== "";

  const inputClass = "w-full rounded-2xl border border-slate-300 bg-transparent px-4 py-3 text-sm outline-none transition-shadow focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]";
  const inputClassGeneral = !isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass;
  const inputClassFiscal = (!isEditAllowed || isFiscalBlocked) ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass;
  const inputClassCredito = !canEditCredito ? "w-full rounded-2xl border border-slate-300 bg-slate-100 text-slate-500 px-4 py-3 text-sm outline-none transition-shadow cursor-not-allowed" : inputClass;
  const [cepLoadingIndex, setCepLoadingIndex] = useState<number | null>(null);

  function updateEndereco(index: number, field: keyof CadastroEndereco, value: string) {
    const enderecos = form.enderecos.map((endereco, currentIndex) =>
      currentIndex === index ? { ...endereco, [field]: value } : endereco
    );
    onUpdate("enderecos", enderecos);
  }

  async function handleCepChange(index: number, rawCep: string) {
    updateEndereco(index, "cep", rawCep);
    const cleanCep = rawCep.replace(/\D/g, "");
    if (cleanCep.length === 8) {
      setCepLoadingIndex(index);
      try {
        const response = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        if (response.ok) {
          const data = await response.json();
          if (!data.erro) {
            const currentEnderecos = [...form.enderecos];
            const current = currentEnderecos[index];
            const updated = {
              ...current,
              cep: rawCep,
              endereco: data.logradouro || "",
              bairro: data.bairro || "",
              cidade: data.localidade || "",
              uf: (data.uf || "").toUpperCase().slice(0, 2)
            };
            
            currentEnderecos[index] = updated;
            onUpdate("enderecos", currentEnderecos);
            onToast({ type: "success", title: "Endereço preenchido", description: `Dados recuperados via CEP (${data.localidade}/${data.uf}).` });
          } else {
            onToast({ type: "warning", title: "CEP não encontrado", description: "O CEP informado não foi localizado no ViaCEP." });
          }
        }
      } catch (err) {
        console.error("ViaCEP erro", err);
        onToast({ type: "error", title: "Erro na consulta", description: "Falha ao consultar o CEP." });
      } finally {
        setCepLoadingIndex(null);
      }
    }
  }

  function updateContato(index: number, field: keyof CadastroContato, value: string) {
    const contatos = form.contatos.map((contato, currentIndex) =>
      currentIndex === index ? { ...contato, [field]: value } : contato
    );
    onUpdate("contatos", contatos);
  }


  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-4">
        <StatusCard title="ID operacional" value={`#${form.idCliente}`} />
        <StatusCard title="Tipo" value={categoriaLabel[form.categoria]} />
        <StatusCard title="Documento" value={formattedDocument || "Nao informado"} />
        <StatusCard title="Atendente" value={form.atendente || "Nao definido"} />
      </section>

      <FormSection title="Identificação e dados gerais" description="Dados principais do cliente.">
        {documentChanged ? (
          <div className="mb-4 rounded-3xl border border-orange-200 bg-orange-50 p-4 text-orange-800">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">Documento alterado</p>
                <p className="mt-1 text-sm">
                  Alterar CPF/CNPJ pode afetar fiscal, financeiro, propostas e notas.
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
            <select disabled={!isEditAllowed} value={form.categoria} onChange={(event) => onUpdate("categoria", event.target.value as CadastroCategoria)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass}>
              {categoriaOptions.map((categoria) => (
                <option key={categoria} value={categoria}>{categoriaLabel[categoria]}</option>
              ))}
            </select>
          </Field>
          <Field label="Situacao / Ativo">
            <select value={form.ativo ? "ATIVO" : "INATIVO"} disabled={!isEditAllowed} onChange={(event) => onUpdate("ativo", event.target.value === "ATIVO")} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass}>
              <option value="ATIVO">Ativo</option>
              <option value="INATIVO">Inativo</option>
            </select>
          </Field>
          <Field label="CPF/CNPJ">
            <div className="flex gap-2">
              <input
                value={formattedDocument}
                readOnly={isDocumentoLocked || isFiscalBlocked || !isEditAllowed}
                onChange={(event) => onUpdate("documento", normalizeDocumentDigits(event.target.value))}
                className={
                  (isDocumentoLocked || isFiscalBlocked || !isEditAllowed)
                    ? `${inputClass} cursor-not-allowed bg-slate-100 text-slate-500 w-full`
                    : `${getInputClass(errorFields.includes("documento"))} w-full`
                }
              />
              {/* So CNPJ chega aqui: a pagina passa `onReconsultar` apenas quando
                  o cadastro e pessoa juridica. O clique NAO grava — abre o
                  comparativo para o usuario confirmar. */}
              {mode === "edit" && onReconsultar && isEditAllowed && !isFiscalBlocked && (
                <button
                  type="button"
                  onClick={onReconsultar}
                  disabled={isReconsultando}
                  title="Consultar a Receita e comparar com o que esta gravado"
                  className="shrink-0 rounded-xl bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isReconsultando ? "Consultando..." : "Reconsultar"}
                </button>
              )}
            </div>
          </Field>
          <Field label="Razao social / Nome">
            <input value={form.nome} readOnly={!isEditAllowed} onChange={(event) => onUpdate("nome", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : getInputClass(errorFields.includes("nome"))} />
          </Field>
          <Field label="Nome fantasia / Apelido">
            <input value={form.fantasia} readOnly={!isEditAllowed} onChange={(event) => onUpdate("fantasia", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass} />
          </Field>
          {/* "Apelido" saiu da interface. O valor continua no estado (carregado do
              banco em createFormState) e é reenviado no payload — nada é apagado. */}
          <Field label="Contato">
            <input value={form.contato} readOnly={!isEditAllowed} onChange={(event) => onUpdate("contato", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass} />
          </Field>
          {/* Mesmo vocabulario da NF desde 25/08/2026: os codigos da SEFAZ, e so
              eles. O rotulo tambem estava errado — dizia "distribuinte". */}
          <Field label="Tipo de contribuinte">
            <select value={form.tipoContribuinte} disabled={isFiscalBlocked || !isEditAllowed} onChange={(event) => onUpdate("tipoContribuinte", event.target.value)} className={(isFiscalBlocked || !isEditAllowed) ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass}>
              <option value="">Selecione...</option>
              {OPCOES_TIPO_CONTRIBUINTE.map((opcao) => (
                <option key={opcao.valor} value={opcao.valor}>{opcao.rotulo}</option>
              ))}
            </select>
          </Field>
          <Field label="E-mail principal">
            <input value={form.email} readOnly={!isEditAllowed} onChange={(event) => onUpdate("email", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : getInputClass(errorFields.includes("email"))} />
          </Field>
          <Field label="E-mail financeiro">
            <input value={form.emailFinanceiro} readOnly={!isEditAllowed} onChange={(event) => onUpdate("emailFinanceiro", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass} />
          </Field>
          <Field label="Inscricao estadual">
            <input value={form.inscricaoEstadual} readOnly={isFiscalBlocked || !isEditAllowed} onChange={(event) => onUpdate("inscricaoEstadual", event.target.value)} className={(isFiscalBlocked || !isEditAllowed) ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass} />
          </Field>
          <Field label="Isento?">
            <select value={form.isentoInscricaoEstadual ? "SIM" : "NAO"} disabled={isFiscalBlocked || !isEditAllowed} onChange={(event) => onUpdate("isentoInscricaoEstadual", event.target.value === "SIM")} className={(isFiscalBlocked || !isEditAllowed) ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass}>
              <option value="NAO">Nao</option>
              <option value="SIM">Sim</option>
            </select>
          </Field>
          <Field label="Inscricao municipal">
            <input value={form.inscricaoMunicipal} readOnly={isFiscalBlocked || !isEditAllowed} onChange={(event) => onUpdate("inscricaoMunicipal", event.target.value)} className={(isFiscalBlocked || !isEditAllowed) ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass} />
          </Field>
          {/* "Cidade / UF" saiu da interface — o endereço é mantido no box próprio.
              O valor segue no estado e no payload, preservando o dado atual. */}
          <Field label="Telefone fixo comercial">
            <input value={form.telefoneFixo} readOnly={!isEditAllowed} onChange={(event) => onUpdate("telefoneFixo", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass} />
          </Field>
          <Field label="Site da empresa">
            <input value={form.site} readOnly={!isEditAllowed} onChange={(event) => onUpdate("site", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass} />
          </Field>
          <Field label="WhatsApp 1">
            <input value={form.whatsapp} readOnly={!isEditAllowed} onChange={(event) => onUpdate("whatsapp", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : getInputClass(errorFields.includes("whatsapp"))} />
          </Field>
          <Field label="WhatsApp 2">
            <input value={form.whatsapp2} readOnly={!isEditAllowed} onChange={(event) => onUpdate("whatsapp2", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass} />
          </Field>
          <Field label="Atendente do cliente">
            <select value={form.atendente} disabled={!isEditAllowed} onChange={(event) => onUpdate("atendente", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : getInputClass(errorFields.includes("atendente"))}>
              <option value="">Selecione</option>
              {vendedorOptions.map((vendedor) => (
                <option key={`${vendedor.nome}-${String(vendedor.idVendedor ?? "")}`} value={vendedor.nome}>{vendedor.nome}</option>
              ))}
            </select>
          </Field>
          <Field label="Empresa padrao de cobranca">
            <select value={form.empresaPadrao} disabled={!isEditAllowed} onChange={(event) => onUpdate("empresaPadrao", event.target.value)} className={!isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass}>
              {companies.map((company) => (
                <option key={company.id} value={company.name}>{company.shortName}</option>
              ))}
            </select>
          </Field>
        </div>
        {isDocumentoLocked ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Documento validado e bloqueado</p>
            <p className="mt-1">
              Para trocar CPF/CNPJ, reinicie a identificação. Isso limpa os dados importados e exige nova validação.
            </p>
            <button
              type="button"
              onClick={onResetDocumento}
              className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900"
            >
              Alterar documento
            </button>
          </div>
        ) : null}
        {hasImportedApiData ? (
          <p className="mt-3 text-xs font-medium text-slate-500">
            Dados importados da consulta externa podem ser revisados e editados antes de salvar.
          </p>
        ) : null}
        <p className="mt-2 text-xs font-medium text-amber-700">
          Campos sensíveis: documento, categoria, ativo/inativo, restrição, limite de crédito, crédito, risco e bônus.
        </p>
      </FormSection>

      <FormSection
        title="Enderecos"
        description="Enderecos vinculados ao id_cliente. Futuramente serao usados em propostas, frete e notas fiscais."
        action={isEditAllowed ? (
          <AddButton
            label="Adicionar endereco"
            onClick={() => {
              onUpdate("enderecos", [...form.enderecos, createBlankEndereco()]);
              onToast({ type: "info", title: "Endereco adicionado", description: "Endereco incluido no formulario." });
            }}
          />
        ) : null}
      >
        <div className="space-y-4">
          {form.enderecos.map((endereco, index) => {
            const isPrincipalCnpj = form.tipoCliente === "CNPJ" && endereco.tipo === "principal";
            const isAddressBlocked = !isEditAllowed || isPrincipalCnpj;
            const addrInputClass = isAddressBlocked ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass;

            return (
              <div key={endereco.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <StatusBadge status={endereco.tipo.toUpperCase()} tone="neutral" />
                  {endereco.tipo !== 'principal' && isEditAllowed && (
                    <button type="button" onClick={async () => {
                      if (isTemporaryId(endereco.id)) {
                        onUpdate("enderecos", form.enderecos.filter((_, itemIndex) => itemIndex !== index));
                        onToast({ type: "warning", title: "Endereco removido", description: "Remocao aplicada no formulário antes do salvamento." });
                        return;
                      }
                      const refCheck = await checkEnderecoReferenciadoEmProposta(endereco.id);
                      if (refCheck.referenciado) {
                        onToast({ type: "error", title: "Exclusão bloqueada", description: refCheck.errorMessage || "Este endereço está vinculado a uma proposta e não pode ser excluído." });
                        return;
                      }
                      const deleteResult = await deleteCadastroEndereco(endereco.id);
                      if (!deleteResult.success) {
                        onToast({ type: "error", title: "Erro ao excluir", description: deleteResult.errorMessage || "Não foi possível excluir o endereço." });
                        return;
                      }
                      onUpdate("enderecos", form.enderecos.filter((_, itemIndex) => itemIndex !== index));
                      onToast({ type: "success", title: "Endereço excluído", description: "Endereço removido." });
                    }} className="rounded-xl p-2 text-red-600 hover:bg-red-50">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {isPrincipalCnpj && (
                  <div className="mb-4 rounded-2xl border border-blue-200 bg-blue-50 p-3.5 text-xs text-blue-900 flex gap-2.5 items-start">
                    <span className="text-base leading-none">ℹ️</span>
                    <p className="leading-relaxed">
                      Este é o endereço oficial do CNPJ. Para alterá-lo, reconsulte os dados do CNPJ no topo da página ou adicione um endereço do tipo <strong>Entrega</strong> ou <strong>Cobrança</strong> abaixo.
                    </p>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Field label="Tipo">
                    <select value={endereco.tipo} disabled={isAddressBlocked} onChange={(event) => updateEndereco(index, "tipo", event.target.value as any)} className={addrInputClass}>
                      {endereco.tipo === "principal" && <option value="principal">Principal</option>}
                      <option value="entrega">Entrega</option>
                      <option value="cobranca">Cobrança</option>
                      <option value="fiscal">Fiscal</option>
                    </select>
                  </Field>
                  <Field label="CEP">
                    <div className="relative">
                      <input value={endereco.cep} readOnly={isAddressBlocked} onChange={(event) => handleCepChange(index, event.target.value)} className={addrInputClass} />
                      {cepLoadingIndex === index && (
                        <div className="absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
                      )}
                    </div>
                  </Field>
                  <Field label="Logradouro"><input value={endereco.endereco} readOnly={isAddressBlocked} onChange={(event) => updateEndereco(index, "endereco", event.target.value)} className={addrInputClass} /></Field>
                  <Field label="Número *"><input value={endereco.numero} readOnly={isAddressBlocked} onChange={(event) => updateEndereco(index, "numero", event.target.value)} className={isAddressBlocked ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : getInputClass(errorFields.includes("enderecos-numero") && !endereco.numero.trim())} /></Field>
                  <Field label="Complemento"><input value={endereco.complemento ?? ""} readOnly={isAddressBlocked} onChange={(event) => updateEndereco(index, "complemento", event.target.value)} className={addrInputClass} /></Field>
                  <Field label="Bairro"><input value={endereco.bairro} readOnly={isAddressBlocked} onChange={(event) => updateEndereco(index, "bairro", event.target.value)} className={addrInputClass} /></Field>
                  <Field label="Cidade"><input value={endereco.cidade} readOnly={isAddressBlocked} onChange={(event) => updateEndereco(index, "cidade", event.target.value)} className={addrInputClass} /></Field>
                  <Field label="UF"><input value={endereco.uf} readOnly={isAddressBlocked} onChange={(event) => updateEndereco(index, "uf", event.target.value.toUpperCase())} className={addrInputClass} maxLength={2} /></Field>
                  <Field label="Recebedor">
                    <input value={endereco.recebedor ?? ""} readOnly={isAddressBlocked} onChange={(event) => updateEndereco(index, "recebedor", event.target.value)} className={addrInputClass} placeholder="Nome do recebedor" />
                  </Field>
                  <Field label="CPF do Recebedor">
                    <input value={endereco.cpfRecebedor ?? ""} readOnly={isAddressBlocked} onChange={(event) => updateEndereco(index, "cpfRecebedor", event.target.value)} className={addrInputClass} placeholder="Apenas números ou formatado" maxLength={14} />
                  </Field>
                  <div className="md:col-span-2 xl:col-span-4"><Field label="Observacao"><input value={endereco.obs ?? ""} readOnly={isAddressBlocked} onChange={(event) => updateEndereco(index, "obs", event.target.value)} className={addrInputClass} /></Field></div>
                </div>
              </div>
            );
          })}
        </div>
      </FormSection>

      <FormSection
        title="Contatos"
        description="Pessoas fisicas vinculadas ao cadastro."
        action={isEditAllowed ? (
          <AddButton
            label="Adicionar contato"
            onClick={() => {
              onUpdate("contatos", [...form.contatos, createBlankContato()]);
              onToast({ type: "info", title: "Contato adicionado", description: "Contato incluido no formulario." });
            }}
          />
        ) : null}
      >
        <div className="space-y-4">
          {form.contatos.map((contato, index) => {
            const contactInputClass = !isEditAllowed ? `${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed` : inputClass;
            return (
              <div key={contato.id} className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                <Field label="Nome"><input value={contato.nome} readOnly={!isEditAllowed} onChange={(event) => onUpdate("contatos", form.contatos.map((c, idx) => idx === index ? { ...c, nome: event.target.value } : c))} className={contactInputClass} /></Field>
                <Field label="Cargo"><input value={contato.cargo} readOnly={!isEditAllowed} onChange={(event) => onUpdate("contatos", form.contatos.map((c, idx) => idx === index ? { ...c, cargo: event.target.value } : c))} className={contactInputClass} /></Field>
                <Field label="WhatsApp"><input value={contato.whatsapp} readOnly={!isEditAllowed} onChange={(event) => onUpdate("contatos", form.contatos.map((c, idx) => idx === index ? { ...c, whatsapp: event.target.value } : c))} className={contactInputClass} /></Field>
                <Field label="E-mail"><input value={contato.email} readOnly={!isEditAllowed} onChange={(event) => onUpdate("contatos", form.contatos.map((c, idx) => idx === index ? { ...c, email: event.target.value } : c))} className={contactInputClass} /></Field>
                {isEditAllowed && (
                  <button type="button" onClick={() => {
                    if (!isTemporaryId(contato.id)) {
                      onToast({ type: "warning", title: "Remoção bloqueada", description: "Contato já salvo não pode ser removido nesta fase." });
                      return;
                    }
                    onUpdate("contatos", form.contatos.filter((_, itemIndex) => itemIndex !== index));
                    onToast({ type: "warning", title: "Contato removido", description: "Remocao aplicada no formulário antes do salvamento." });
                  }} className="self-end rounded-xl p-3 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                )}
              </div>
            );
          })}
        </div>
      </FormSection>

      <VinculosNotaFiscalCard
        idClienteOrigem={form.idCliente}
        vinculos={form.vinculosComerciais}
        onChange={(lista) => onUpdate("vinculosComerciais", lista)}
        persistirImediato={mode === "edit"}
        isEditAllowed={isEditAllowed}
        onToast={onToast}
        inputClass={inputClass}
        vinculoInicialId={vinculoInicialId}
        tipoRelacaoInicial={tipoRelacaoInicial}
        onConsumirVinculoInicial={onConsumirVinculoInicial}
      />

      {canViewCredito && (
        <FormSection title="Crédito / Financeiro" description="Informacoes financeiras, comerciais e flags operacionais.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Data cadastro"><input type="date" value={form.dataCadastro} readOnly className={`${inputClass} bg-gray-100 text-gray-500 cursor-not-allowed`} /></Field>
            <Field label="Data fundacao"><input type="date" value={form.dataFundacao} onChange={(event) => canEditCredito && onUpdate("dataFundacao", event.target.value)} readOnly={!canEditCredito} className={inputClassCredito} /></Field>
            {/* "Data verificacao" saiu da interface — valor mantido no estado e no
                payload (data_verificacao), sem apagar o que já está gravado. */}
            <Field label="Limite de credito"><input value={form.limiteCredito} onChange={(event) => canEditCredito && onUpdate("limiteCredito", event.target.value)} readOnly={!canEditCredito} className={inputClassCredito} /></Field>
            {/* Campos "Credito" e "Credito acumulado" removidos (2026-07-22):
                saldo de crédito é gerido exclusivamente pelo módulo Conta
                Corrente (movimento_credito) — nunca por digitação no cadastro. */}
            <Field label="Risco financeiro"><select value={form.riscoCredito} disabled={!canEditCredito} onChange={(event) => canEditCredito && onUpdate("riscoCredito", event.target.value as "BAIXO" | "MEDIO" | "ALTO")} className={inputClassCredito}><option value="BAIXO">Baixo</option><option value="MEDIO">Medio</option><option value="ALTO">Alto</option></select></Field>
            <Field label="Ultima compra"><input type="date" value={form.ultimaCompra} readOnly className={`${inputClass} bg-gray-100 text-gray-500 cursor-not-allowed`} /></Field>
            <Field label="Total compras (qtd)"><input value={form.totalCompras} readOnly className={`${inputClass} bg-gray-100 text-gray-500 cursor-not-allowed`} /></Field>
            <Field label="Valor total comprado">
              <input value={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(form.valorTotalComprado || 0)} readOnly className={`${inputClass} bg-gray-100 text-gray-500 cursor-not-allowed`} />
            </Field>
            <Field label="Formas de pagamento">
              <select 
                value={form.padraoPagamento}
                disabled={!canEditCredito} 
                onChange={(event) => {
                  if (!canEditCredito) return;
                  const val = event.target.value;
                  onUpdate("padraoPagamento", val);
                  if (val !== "FATURADO") {
                    onUpdate("modeloCobrancaId", undefined);
                  }
                }} 
                className={inputClassCredito}
              >
                <option value="">Selecione...</option>
                <option value="PIX">PIX</option>
                <option value="BOLETO">BOLETO</option>
                <option value="CARTAO">CARTAO</option>
                <option value="FATURADO">FATURADO</option>
              </select>
            </Field>
            {form.padraoPagamento === "FATURADO" && (
              <Field label="Modelo de Cobrança">
                <select 
                  value={form.modeloCobrancaId || ""}
                  disabled={!canEditCredito} 
                  onChange={(event) => canEditCredito && onUpdate("modeloCobrancaId", event.target.value || undefined)} 
                  className={inputClassCredito}
                >
                  <option value="">Selecione o modelo...</option>
                  {modelosCobranca.map(m => (
                    <option key={m.id} value={m.id}>{m.resultado}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Percentual bonus"><input value={form.percentualBonus} onChange={(event) => canEditCredito && !form.usaPrecoFixo && onUpdate("percentualBonus", event.target.value)} readOnly={!canEditCredito || form.usaPrecoFixo} className={`${inputClassCredito} ${form.usaPrecoFixo ? "opacity-50" : ""}`} /></Field>
          </div>
          {/* "Nota" VOLTOU à interface em 25/08/2026 — agora ela decide se o
              pedido do cliente entra na Fila de Faturamento. Enquanto o booleano
              era invisível não havia por que mostrá-lo; agora tem.
              Fica sob `cadastros.edit_credito` como os vizinhos: só o Financeiro
              altera.
              Os toggles "Verificado", "CPF invalido", "Receber e-mail" e
              "Receber WhatsApp" continuam fora da interface. Os valores seguem no
              estado (carregados do banco) e no payload — nenhum é zerado ao salvar. */}
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Toggle label="Usa Preço Fixo" checked={form.usaPrecoFixo} disabled={!canEditCredito} onChange={(value) => canEditCredito && onUpdate("usaPrecoFixo", value)} />
            <Toggle label="Bonus" checked={form.bonusAtivo} disabled={!canEditCredito || form.usaPrecoFixo} onChange={(value) => canEditCredito && onUpdate("bonusAtivo", value)} />
            <Toggle label="Restricao" checked={form.restricao} disabled={!canEditCredito} onChange={(value) => canEditCredito && onUpdate("restricao", value)} />
            <Toggle label="Nota" checked={form.nota} disabled={!canEditCredito} onChange={(value) => canEditCredito && onUpdate("nota", value)} />
          </div>
        </FormSection>
      )}

      {/* PAINEL DE PREÇOS FIXOS */}
      {form.usaPrecoFixo && canEditCredito && (
        <PrecoFixoPanel idCliente={form.idCliente} usaPrecoFixo={form.usaPrecoFixo} />
      )}

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
             <button type="button" onClick={onSave} disabled={isSaving || !isEditAllowed} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60 disabled:cursor-not-allowed">
              {isSaving
                ? "Salvando..."
                : mode === "edit"
                  ? "Salvar campos liberados"
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

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${disabled ? "opacity-50 cursor-not-allowed" : ""} ${checked ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600"}`}>
      {label}: {checked ? "Sim" : "Nao"}
    </button>
  );
}

/**
 * `documentoInicial` só chega no cadastro novo aberto pelo card de vínculos
 * (`?documento=`), para o usuário não redigitar o CPF/CNPJ que acabou de buscar.
 */
function createInitialState(
  cadastro?: Cadastro,
  documentoInicial = "",
  categoriaInicial?: CadastroCategoria
): CadastroFormState {
  const documentoPrefixado =
    !cadastro && (documentoInicial.length === 11 || documentoInicial.length === 14) ? documentoInicial : "";
  return {
    idCliente: cadastro?.idCliente.toString() ?? "",
    idVendedor: cadastro?.idVendedor ? String(cadastro.idVendedor) : "",
    categoria: cadastro?.categoria ?? categoriaInicial ?? "CLIENTE",
    tipoCliente: cadastro?.tipoPessoa === "FISICA" ? "CPF" : documentoPrefixado.length === 11 ? "CPF" : "CNPJ",
    documento: cadastro?.documento ?? documentoPrefixado,
    atendente: cadastro?.vendedor ?? "",
    ativo: cadastro?.ativo ?? true,
    nome: cadastro?.nome ?? "",
    fantasia: cadastro?.fantasia ?? "",
    apelido: cadastro?.apelido ?? "",
    contato: cadastro?.contato ?? "",
    // Traduzido na leitura: um cadastro gravado como `ISENTO` ou
    // `2 = Contribuinte isento` abre no drop ja mostrando o codigo. Grafia nao
    // reconhecida sobrevive intacta em vez de virar vazio — nada e apagado por
    // nao ter sido entendido. Vazio continua vazio: quem converte os vazios em
    // `9` e o SQL de normalizacao, nao o formulario.
    tipoContribuinte:
      normalizarTipoContribuinte(cadastro?.tipoContribuinte) ?? cadastro?.tipoContribuinte ?? "",
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
    cidadeUf: cadastro?.cidadeUf ?? "",
    dataFundacao: cadastro?.dataFundacao ?? "",
    dataCadastro: cadastro?.dataCadastro || new Date().toISOString().split("T")[0],
    dataVerificacao: cadastro?.dataVerificacao ?? "",
    ultimaCompra: cadastro?.ultimaCompra ?? "",
    totalCompras: cadastro?.totalCompras?.toString() ?? "0",
    valorTotalComprado: cadastro?.valorTotalComprado ?? 0,
    credito: cadastro?.creditoDisponivel?.toString() ?? "0",
    limiteCredito: cadastro?.limiteCredito?.toString() ?? "0",
    creditoDisponivel: cadastro?.creditoDisponivel?.toString() ?? "0",
    riscoCredito: cadastro?.riscoCredito ?? "BAIXO",
    padraoPagamento: cadastro?.padraoPagamento ?? "PIX",
    modeloCobrancaId: cadastro?.modeloCobrancaId ?? undefined,
    usaPrecoFixo: cadastro?.usaPrecoFixo ?? false,
    bonusAtivo: cadastro?.bonusAtivo ?? false,
    percentualBonus: cadastro?.percentualBonus?.toString() ?? "0",
    // Cadastro NOVO nasce faturavel. O DEFAULT do banco virou `true`, mas o
    // formulario sempre manda a coluna no INSERT — se o padrao daqui ficasse
    // `false`, o DEFAULT nunca chegaria a valer e todo cliente novo nasceria
    // fora da Fila.
    nota: cadastro?.nota ?? true,
    verificado: cadastro?.verificado ?? false,
    restricao: cadastro?.restricao ?? false,
    cpfInvalido: cadastro?.cpfInvalido ?? false,
    cpfErro: cadastro?.cpfErro ?? "",
    motivoErro: cadastro?.motivoErro ?? "",
    sendMail: cadastro ? cadastro.sendMail ?? true : false,
    sendWhats: cadastro ? cadastro.sendWhats ?? true : false,
    observacoes: cadastro?.observacoes ?? "",
    enderecos: cadastro?.enderecos ?? [],
    contatos: cadastro?.contatos ?? [],
    vinculosComerciais: cadastro?.vinculosComerciais ?? []
  };
}

function createBlankEndereco(): CadastroEndereco {
  return {
    id: `end_${Date.now()}`,
    tipo: "entrega",
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

function isTemporaryId(value: string) {
  return value.startsWith("end_") || value.startsWith("cont_") || value.startsWith("vinc_");
}

function maskDocument(documento: string, tipo: TipoClienteDocumento) {
  const digits = normalizeDocumentDigits(documento).slice(0, tipo === "CPF" ? 11 : 14);
  return formatDocument(digits);
}
