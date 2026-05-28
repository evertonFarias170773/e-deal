"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Copy, Plus, Search, Trash2, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useAuth } from "@/features/auth/AuthProvider";
import type { Cadastro, CadastroContato, CadastroEndereco } from "@/features/cadastros/types";
import type {
  Proposta,
  PropostaFormState,
  PropostaItem,
  PropostaVariacaoEscolhida,
  TipoDescontoProposta
} from "@/features/orcamentos/types";
import { buildPropostaInformalText } from "@/features/orcamentos/orcamento-utils";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatWeightFromGrams } from "@/lib/formatters/weight";
import { cadastrosMock } from "@/lib/mocks/cadastros.mock";
import { mockCompanies } from "@/lib/mocks/empresas.mock";
import { produtosMock } from "@/lib/mocks/produtos.mock";
import {
  calculateDiscountValue,
  calculateItemSubtotal,
  calculateItemWeight,
  calculateResumo,
  createFretesMock,
  createItemFromProduto,
  getClienteBonusPercent,
  getClienteVendedorPadrao,
  vendedoresPropostaMock
} from "@/lib/mocks/propostas.mock";

type OrcamentoFormPageProps = {
  mode: "new" | "edit";
  proposta?: Proposta;
};

type ContactDraft = Pick<CadastroContato, "nome" | "cargo" | "whatsapp" | "email">;
type AddressDraft = Omit<CadastroEndereco, "id">;

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]";

const productTags = [
  { label: "TRIBAND", productId: 101 },
  { label: "BRACELETE", productId: 102 },
  { label: "TEX BAND", productId: 301 },
  { label: "VANGOGH", productId: 901 },
  { label: "UP", productId: 402 },
  { label: "MOBI", productId: 401 },
  { label: "CORDÃO", productId: 901 },
  { label: "PVC", productId: 801 }
];

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function OrcamentoFormPage({ mode, proposta }: OrcamentoFormPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const canManageCommercialRules = Boolean(user?.isAdmin || user?.isGerente || user?.isSuperAdmin);
  const [form, setForm] = useState<PropostaFormState>(() => createInitialState(proposta));
  const initialCliente = cadastrosMock.find((cadastro) => cadastro.idCliente.toString() === form.clienteId);
  const [proposalContacts, setProposalContacts] = useState<CadastroContato[]>(() => proposta?.cliente.contatos ?? initialCliente?.contatos ?? []);
  const [proposalAddresses, setProposalAddresses] = useState<CadastroEndereco[]>(() => proposta?.cliente.enderecos ?? initialCliente?.enderecos ?? []);
  const [selectedProductId, setSelectedProductId] = useState(produtosMock[0]?.id_produto.toString() ?? "");
  const [clientSearch, setClientSearch] = useState("");
  const [showClientResults, setShowClientResults] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [contactDraft, setContactDraft] = useState<ContactDraft>({ nome: "", cargo: "", whatsapp: "", email: "" });
  const [addressDraft, setAddressDraft] = useState<AddressDraft>({
    tipo: "entrega",
    cep: "",
    endereco: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: ""
  });

  const cliente = useMemo(() => cadastrosMock.find((cadastro) => cadastro.idCliente.toString() === form.clienteId), [form.clienteId]);
  const vendedorExibido = canManageCommercialRules
    ? form.vendedor
    : cliente
      ? getClienteVendedorPadrao(cliente)
      : form.vendedor;
  const contato = useMemo(() => proposalContacts.find((item) => item.id === form.contatoId) ?? proposalContacts[0], [proposalContacts, form.contatoId]);
  const endereco = useMemo(() => proposalAddresses.find((item) => item.id === form.enderecoId) ?? proposalAddresses[0], [proposalAddresses, form.enderecoId]);
  const freteEscolhido = form.fretes.find((frete) => frete.id === form.freteEscolhidoId);
  const bonusPercent = getClienteBonusPercent(cliente);
  const resumo = calculateResumo(form.itens, form.fretes, Number(form.descontoGeralValor) || 0, form.descontoGeralTipo);
  const hasStaleFreightWeight = form.fretes.some((frete) => Math.abs(frete.pesoUsado - resumo.pesoTotal) > 0.01);
  const clientResults = useMemo(() => {
    const search = normalize(clientSearch.trim());

    if (!search) {
      return [];
    }

    return cadastrosMock
      .filter((cadastro) => cadastro.categoria === "CLIENTE" || cadastro.categoria === "ORGAO_PUBLICO")
      .filter((cadastro) => normalize(`${cadastro.idCliente} ${cadastro.nome} ${cadastro.fantasia ?? ""} ${cadastro.documento}`).includes(search))
      .slice(0, 8);
  }, [clientSearch]);
  const informalText = buildPropostaInformalText({
    id_int: form.id_int || "novo",
    clienteNome: cliente?.nome ?? "Cliente nao definido",
    itens: form.itens,
    frete: freteEscolhido,
    resumo,
    formaPagamento: form.formaPagamento
  });

  function updateField<K extends keyof PropostaFormState>(field: K, value: PropostaFormState[K]) {
    if (field === "vendedor" && !canManageCommercialRules) {
      return;
    }

    setForm((current) => ({ ...current, [field]: value }));
    setErrorFields((current) => current.filter((item) => item !== field));
  }

  function recalculateItem(item: PropostaItem, nextBonusPercent = bonusPercent) {
    const totals = calculateItemSubtotal(item, nextBonusPercent);

    return {
      ...item,
      ...totals,
      pesoTotal: calculateItemWeight(item)
    };
  }

  function selectCliente(nextCliente: Cadastro) {
    const nextEndereco = nextCliente.enderecos[0];
    const nextContacts = nextCliente.contatos;
    const nextBonus = getClienteBonusPercent(nextCliente);
    const recalculatedItems = form.itens.map((item) => recalculateItem(item, nextBonus));

    setProposalContacts(nextContacts);
    setProposalAddresses(nextCliente.enderecos);
    setClientSearch(`${nextCliente.idCliente} - ${nextCliente.nome}`);
    setShowClientResults(false);
    setForm((current) => ({
      ...current,
      clienteId: nextCliente.idCliente.toString(),
      contatoId: nextContacts[0]?.id ?? "",
      enderecoId: nextEndereco?.id ?? "",
      compradorId: nextCliente.vinculosComerciais[0]?.id ?? "",
      vendedor: getClienteVendedorPadrao(nextCliente),
      itens: recalculatedItems,
      fretes: createFretesMock(nextEndereco, Number(current.id_int) || 0, recalculatedItems.reduce((total, item) => total + item.pesoTotal, 0)),
      freteEscolhidoId: "frete_sedex"
    }));
  }

  function addContact() {
    if (!contactDraft.nome || !contactDraft.whatsapp) {
      showToast({ type: "warning", title: "Contato incompleto", description: "Informe nome e WhatsApp para adicionar o contato." });
      return;
    }

    const contact: CadastroContato = { id: `cont_prop_${Date.now()}`, ...contactDraft };
    setProposalContacts((current) => [...current, contact]);
    updateField("contatoId", contact.id);
    setContactDraft({ nome: "", cargo: "", whatsapp: "", email: "" });
    setIsContactModalOpen(false);
    showToast({ type: "success", title: "Contato adicionado à proposta." });
  }

  function addAddress() {
    if (!addressDraft.cep || !addressDraft.endereco || !addressDraft.numero || !addressDraft.cidade || !addressDraft.uf) {
      showToast({ type: "warning", title: "Endereco incompleto", description: "Preencha CEP, logradouro, numero, cidade e UF." });
      return;
    }

    const address: CadastroEndereco = { id: `end_prop_${Date.now()}`, ...addressDraft };
    setProposalAddresses((current) => [...current, address]);
    updateField("enderecoId", address.id);
    updateField("fretes", createFretesMock(address, Number(form.id_int) || 0, resumo.pesoTotal));
    updateField("freteEscolhidoId", "frete_sedex");
    setAddressDraft({ tipo: "entrega", cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "" });
    setIsAddressModalOpen(false);
    showToast({ type: "success", title: "Endereço adicionado à proposta." });
  }

  function addProduct(productId = selectedProductId) {
    const produto = produtosMock.find((item) => item.id_produto.toString() === productId.toString());

    if (!produto) {
      return;
    }

    const item = createItemFromProduto(produto, 1000, bonusPercent, false);
    updateField("itens", [...form.itens, item]);
    showToast({ type: "info", title: "Produto adicionado", description: "Item incluido apenas na proposta mockada." });
  }

  function updateItem(itemId: string, updater: (item: PropostaItem) => PropostaItem) {
    updateField(
      "itens",
      form.itens.map((item) => (item.id === itemId ? recalculateItem(updater(item)) : item))
    );
  }

  function updateItemVariation(itemId: string, id_variacao: number, tipoId: string) {
    updateItem(itemId, (item) => {
      const vinculo = item.produto.variacoes.find((variacao) => variacao.id_variacao === id_variacao);
      const tipo = vinculo?.tipos.find((tipoVariacao) => tipoVariacao.id === tipoId);

      if (!vinculo || !tipo) {
        return {
          ...item,
          variacoesEscolhidas: item.variacoesEscolhidas.filter((choice) => choice.id_variacao !== id_variacao)
        };
      }

      const nextChoice: PropostaVariacaoEscolhida = {
        id: `choice_${item.id}_${id_variacao}`,
        id_variacao,
        variacao: vinculo.variacao,
        tipo
      };
      const variacoesEscolhidas = [
        ...item.variacoesEscolhidas.filter((choice) => choice.id_variacao !== id_variacao),
        nextChoice
      ];

      return { ...item, variacoesEscolhidas };
    });
  }

  function selectFrete(freteId: string) {
    updateField("fretes", form.fretes.map((frete) => ({ ...frete, escolhido: frete.id === freteId })));
    updateField("freteEscolhidoId", freteId);
  }

  async function copyInformal() {
    await navigator.clipboard?.writeText(informalText);
    showToast({ type: "success", title: "Resumo copiado", description: "Proposta informal copiada para WhatsApp." });
  }

  function validateBeforeSave(vendedorAtual = form.vendedor) {
    const missingRequiredVariation = form.itens.some((item) =>
      item.produto.variacoes.some(
        (variacao) => variacao.is_obrigatorio && !item.variacoesEscolhidas.some((choice) => choice.id_variacao === variacao.id_variacao)
      )
    );
    const hasInvalidQuantity = form.itens.some((item) => item.quantidade <= 0);
    const hasUnauthorizedGeneralDiscount = !canManageCommercialRules && Number(form.descontoGeralValor) > 0;
    const sellerChangedWithoutPermission = Boolean(cliente && vendedorAtual !== getClienteVendedorPadrao(cliente) && !canManageCommercialRules);

    const fields = [
      !form.clienteId ? "clienteId" : null,
      !form.enderecoId ? "enderecoId" : null,
      form.itens.length === 0 ? "itens" : null,
      hasInvalidQuantity ? "quantidade" : null,
      missingRequiredVariation ? "variacoes" : null
    ].filter(Boolean) as string[];

    if (fields.length) {
      setErrorFields(fields);
      showToast({
        type: "error",
        title: missingRequiredVariation ? "Selecione as variações obrigatórias antes de salvar a proposta." : "Não foi possível salvar",
        description: "Revise cliente, endereço, produtos, quantidades e variações obrigatórias."
      });
      return false;
    }

    if (hasUnauthorizedGeneralDiscount) {
      showToast({ type: "error", title: "Desconto geral não autorizado", description: "Apenas admin ou gerente pode aplicar desconto geral." });
      return false;
    }

    if (sellerChangedWithoutPermission) {
      showToast({ type: "error", title: "Vendedor não autorizado", description: "Usuário comum não pode alterar o vendedor herdado do cliente." });
      return false;
    }

    return true;
  }

  async function handleMockSave() {
    const vendedorParaSalvar = cliente && !canManageCommercialRules ? getClienteVendedorPadrao(cliente) : form.vendedor;

    if (!validateBeforeSave(vendedorParaSalvar)) {
      return;
    }

    if (vendedorParaSalvar !== form.vendedor) {
      setForm((current) => ({ ...current, vendedor: vendedorParaSalvar }));
    }

    setIsSaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 850));
    showToast({
      type: "success",
      title: mode === "edit" ? "Proposta atualizada com sucesso." : "Proposta criada com sucesso.",
      description: mode === "edit" ? "Redirecionando para o detalhe da proposta..." : "Redirecionando para a lista de propostas..."
    });

    window.setTimeout(() => {
      router.push(mode === "edit" && proposta ? `/orcamentos/${proposta.id_int}` : "/orcamentos");
    }, 1200);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={mode === "new" ? "Nova proposta" : `Editar proposta #${proposta?.id_int}`}
        subtitle="Fluxo mockado com cliente, produtos, variações, frete, resumo, informal e cobrança futura."
        context="Orçamentos / Propostas"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={mode === "edit" && proposta ? `/orcamentos/${proposta.id_int}` : "/orcamentos"} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              {mode === "edit" ? "Voltar ao detalhe" : "Voltar para lista"}
            </Link>
            <button type="button" onClick={handleMockSave} disabled={isSaving} className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60">
              {isSaving ? "Salvando..." : mode === "edit" ? "Salvar alterações" : "Salvar proposta"}
            </button>
          </div>
        }
      />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <FormSection title="1. Dados da proposta" description="Empresa continua selecionável; vendedor vem do cliente e status é definido pelo sistema.">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="id_int">
                <input value={form.id_int} readOnly={mode === "edit"} onChange={(event) => updateField("id_int", event.target.value)} className={`${inputClass} ${mode === "edit" ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`} />
              </Field>
              <Field label="Empresa">
                <select value={form.empresa} onChange={(event) => updateField("empresa", event.target.value)} className={inputClass}>
                  {mockCompanies.filter((company) => !company.isConsolidated).map((company) => <option key={company.id} value={company.name}>{company.shortName}</option>)}
                </select>
              </Field>
              <Field label="Vendedor">
                {canManageCommercialRules ? (
                  <select value={form.vendedor} onChange={(event) => updateField("vendedor", event.target.value)} className={inputClass}>
                    {vendedoresPropostaMock.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input value={vendedorExibido} readOnly className={`${inputClass} cursor-not-allowed bg-slate-100 text-slate-500`} />
                )}
                <p className={`text-xs ${canManageCommercialRules ? "text-amber-700" : "text-slate-500"}`}>
                  {canManageCommercialRules
                    ? "Alteração permitida apenas para gerente/admin."
                    : "Vendedor definido pelo cadastro do cliente."}
                </p>
              </Field>
              <Field label="Status">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <StatusBadge status={form.status} tone={form.status === "NOVO" ? "info" : form.status === "APROVADO" ? "success" : form.status === "AGUARDANDO" ? "warning" : "neutral"} />
                </div>
              </Field>
            </div>
          </FormSection>

          <FormSection title="2. Cliente" description="Busque por ID, nome ou documento. O padrão operacional aceita busca rápida por id_cliente.">
            <div className="relative">
              <label className={`flex items-center gap-3 rounded-2xl border bg-slate-50 px-4 py-3 ${errorFields.includes("clienteId") ? "border-red-300" : "border-slate-200"}`}>
                <Search className="h-4 w-4 text-[#0f9f9a]" />
                <input
                  value={clientSearch}
                  onChange={(event) => { setClientSearch(event.target.value); setShowClientResults(true); }}
                  onFocus={() => setShowClientResults(true)}
                  className="w-full bg-transparent text-sm text-slate-900 outline-none"
                  placeholder="Buscar por ID, nome ou documento do cliente"
                />
              </label>
              {showClientResults && clientResults.length ? (
                <div className="absolute left-0 right-0 top-full z-40 mt-2 rounded-3xl border border-[#d7e5e8] bg-white p-2 shadow-xl">
                  {clientResults.map((result) => (
                    <button key={result.id} type="button" onClick={() => selectCliente(result)} className="w-full rounded-2xl px-3 py-3 text-left hover:bg-slate-50">
                      <p className="font-semibold text-slate-950">#{result.idCliente} - {result.nome}</p>
                      <p className="text-sm text-slate-500">{result.documento} | {result.cidadeUf} | Vendedor {getClienteVendedorPadrao(result)}</p>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {cliente ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <InfoBox label="Cliente" value={`${cliente.nome} (#${cliente.idCliente})`} />
                <InfoBox label="Crédito / risco" value={`${formatCurrency(cliente.creditoDisponivel)} - risco ${cliente.riscoCredito}`} />
                <InfoBox label="Tabela especial" value={bonusPercent > 0 ? `+${bonusPercent}% aplicado nos produtos` : "Sem acréscimo especial"} />
              </div>
            ) : null}
          </FormSection>

          <FormSection title="3. Contato responsável" description="Contato usado para envio da proposta informal e retorno comercial.">
            <SelectorGrid items={proposalContacts} selectedId={form.contatoId} onSelect={(id) => updateField("contatoId", id)} render={(contato) => ({ title: contato.nome, subtitle: `${contato.cargo} - ${contato.whatsapp}`, detail: contato.email })} />
            <button type="button" onClick={() => setIsContactModalOpen(true)} className="mt-4 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a]">+ Adicionar novo contato</button>
          </FormSection>

          <FormSection title="4. Endereço de entrega" description={proposalAddresses.length > 1 ? "Cliente possui mais de um endereço. Escolha obrigatória para a proposta." : "Endereço usado para frete, PDF e expedição futura."}>
            <SelectorGrid items={proposalAddresses} selectedId={form.enderecoId} onSelect={(id) => updateField("enderecoId", id)} render={(endereco) => ({ title: `${endereco.endereco}, ${endereco.numero}`, subtitle: `${endereco.cidade}/${endereco.uf} - CEP ${endereco.cep}`, detail: endereco.tipo })} />
            <button type="button" onClick={() => setIsAddressModalOpen(true)} className="mt-4 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a]">+ Adicionar novo endereço</button>
          </FormSection>

          {cliente?.vinculosComerciais.length ? (
            <FormSection title="Comprador / autorizado" description="Cadastro relacionado comercialmente ao cliente principal.">
              <SelectorGrid items={cliente.vinculosComerciais} selectedId={form.compradorId} onSelect={(id) => updateField("compradorId", id)} render={(vinculo) => ({ title: vinculo.nome, subtitle: vinculo.tipoRelacao, detail: vinculo.documento })} />
            </FormSection>
          ) : null}

          <FormSection title="5. Produtos" description="Adicione itens por tags rápidas ou pelo catálogo mockado.">
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {productTags.map((tag) => (
                <button key={tag.label} type="button" onClick={() => { setSelectedProductId(tag.productId.toString()); addProduct(tag.productId.toString()); }} className="shrink-0 rounded-full border border-[#d7e5e8] bg-white px-3 py-1.5 text-xs font-semibold text-[#0b2f4a] hover:bg-[#f3f7f8]">
                  {tag.label}
                </button>
              ))}
            </div>
            <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} className={inputClass}>
                {produtosMock.map((produto) => <option key={produto.id} value={produto.id_produto}>#{produto.id_produto} - {produto.nomeReal}</option>)}
              </select>
              <button type="button" onClick={() => addProduct()} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a]">
                <Plus className="h-4 w-4" />
                Adicionar produto
              </button>
            </div>
            <div className="space-y-4">
              {form.itens.map((item) => (
                <ProductItemEditor key={item.id} item={item} bonusPercent={bonusPercent} hasVariationError={errorFields.includes("variacoes")} onUpdate={(updater) => updateItem(item.id, updater)} onVariationChange={(idVariacao, tipoId) => updateItemVariation(item.id, idVariacao, tipoId)} onRemove={() => updateField("itens", form.itens.filter((current) => current.id !== item.id))} />
              ))}
              {!form.itens.length ? <div className={`rounded-3xl border border-dashed p-5 text-sm ${errorFields.includes("itens") ? "border-red-300 bg-red-50 text-red-700" : "border-slate-300 bg-slate-50 text-slate-500"}`}>Nenhum produto adicionado.</div> : null}
            </div>
          </FormSection>

          <FormSection title="7. Fretes disponíveis" description="Cotações mockadas relacionadas à proposta, simulando cotacao_frete.">
            {hasStaleFreightWeight ? <p className="mb-3 rounded-2xl bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">Peso alterado. Em produção, as cotações de frete deverão ser atualizadas.</p> : null}
            <div className="grid gap-3 md:grid-cols-2">
              {form.fretes.map((frete) => (
                <button key={frete.id} type="button" onClick={() => selectFrete(frete.id)} className={`rounded-3xl border p-4 text-left transition ${frete.id === form.freteEscolhidoId ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50 hover:bg-white"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{frete.transportadora}</p>
                      <p className="text-sm text-slate-500">{frete.servico} - {frete.prazo}</p>
                    </div>
                    {frete.id === form.freteEscolhidoId ? <StatusBadge status="ESCOLHIDO" tone="success" /> : null}
                  </div>
                  <p className="mt-3 text-lg font-bold text-slate-950">{formatCurrency(frete.valor)}</p>
                  <p className="mt-1 text-sm text-slate-500">{frete.observacao}</p>
                  <p className="mt-2 text-xs text-slate-500">Peso usado na cotação: {formatWeightFromGrams(frete.pesoUsado)}</p>
                </button>
              ))}
            </div>
          </FormSection>
        </div>

        <div className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <FormSection title="8. Resumo da proposta" description="Resumo com descontos, tabela especial, frete e peso total.">
            <ResumoValores resumo={resumo} bonusPercent={bonusPercent} />
            {canManageCommercialRules ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-[130px_1fr]">
                <Field label="Tipo desconto geral">
                  <select value={form.descontoGeralTipo} onChange={(event) => updateField("descontoGeralTipo", event.target.value as TipoDescontoProposta)} className={inputClass}>
                    <option value="PERCENTUAL">%</option>
                    <option value="VALOR">R$</option>
                  </select>
                </Field>
                <Field label="Desconto geral">
                  <input value={form.descontoGeralValor} onChange={(event) => updateField("descontoGeralValor", event.target.value)} className={inputClass} />
                </Field>
              </div>
            ) : (
              <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">Desconto geral disponível apenas para admin/gerente.</p>
            )}
          </FormSection>

          <FormSection title="9. Envio da proposta" description="Texto informal pronto para copiar.">
            <textarea readOnly value={informalText} className="min-h-72 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 outline-none" />
            <button type="button" onClick={copyInformal} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0b2f4a] px-4 py-3 text-sm font-semibold text-white">
              <Copy className="h-4 w-4" />
              Copiar resumo para WhatsApp
            </button>
            <button type="button" onClick={() => showToast({ type: "success", title: "PDF mockado gerado com sucesso." })} className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Gerar PDF</button>
          </FormSection>

          <FormSection title="10. Criar e ver cobranças" description="A criação principal da cobrança acontece no detalhe da proposta, usando a empresa já definida no orçamento.">
            <p className="text-sm leading-6 text-slate-600">
              Depois de salvar ou voltar ao detalhe, use a área financeira da proposta para informar OS Ideal, valor, forma de pagamento, observações e gerar a cobrança mockada em `pagamentos_v2`.
            </p>
            <button
              type="button"
              onClick={() => router.push(mode === "edit" && proposta ? `/orcamentos/${proposta.id_int}` : "/orcamentos")}
              className="mt-3 w-full rounded-2xl border border-[#d7e5e8] bg-white px-4 py-3 text-sm font-semibold text-[#0b2f4a]"
            >
              {mode === "edit" && proposta ? "Voltar ao detalhe da proposta" : "Salvar para criar cobrança depois"}
            </button>
          </FormSection>
        </div>
      </section>

      <div className="sticky bottom-4 z-20 rounded-3xl border border-[#d7e5e8] bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-slate-700">Proposta #{form.id_int || "nova"} | Total {formatCurrency(resumo.valorTotal)}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => router.push(mode === "edit" && proposta ? `/orcamentos/${proposta.id_int}` : "/orcamentos")} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Cancelar</button>
            <button type="button" onClick={handleMockSave} disabled={isSaving} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">{isSaving ? "Salvando..." : mode === "edit" ? "Salvar alterações" : "Salvar proposta"}</button>
          </div>
        </div>
      </div>

      {isContactModalOpen ? <ContactModal draft={contactDraft} onChange={setContactDraft} onClose={() => setIsContactModalOpen(false)} onSave={addContact} /> : null}
      {isAddressModalOpen ? <AddressModal draft={addressDraft} onChange={setAddressDraft} onClose={() => setIsAddressModalOpen(false)} onSave={addAddress} /> : null}
    </div>
  );
}

function ProductItemEditor({ item, bonusPercent, hasVariationError, onUpdate, onVariationChange, onRemove }: { item: PropostaItem; bonusPercent: number; hasVariationError: boolean; onUpdate: (updater: (item: PropostaItem) => PropostaItem) => void; onVariationChange: (idVariacao: number, tipoId: string) => void; onRemove: () => void }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_120px_150px_auto]">
        <Field label="Descrição/modelo do item">
          <textarea value={item.descricaoModelo} onChange={(event) => onUpdate((current) => ({ ...current, descricaoModelo: event.target.value }))} className={`${inputClass} min-h-24 resize-y`} />
        </Field>
        <Field label="Quantidade">
          <input type="number" value={item.quantidade} onChange={(event) => onUpdate((current) => ({ ...current, quantidade: Math.max(0, Number(event.target.value)) }))} className={inputClass} />
        </Field>
        <InfoBox label="Subtotal final" value={formatCurrency(item.subtotal)} />
        <button type="button" onClick={onRemove} className="self-end rounded-xl p-3 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <InfoBox label="Antes desconto" value={formatCurrency(item.subtotalBruto)} />
        <Field label="Tipo desconto">
          <select value={item.descontoTipo} onChange={(event) => onUpdate((current) => ({ ...current, descontoTipo: event.target.value as TipoDescontoProposta }))} className={inputClass}>
            <option value="PERCENTUAL">%</option>
            <option value="VALOR">R$</option>
          </select>
        </Field>
        <Field label="Desconto item">
          <input value={item.descontoValor} onChange={(event) => onUpdate((current) => ({ ...current, descontoValor: Number(event.target.value) || 0 }))} className={inputClass} />
        </Field>
        <InfoBox label="Desconto aplicado" value={`-${formatCurrency(item.descontoValorCalculado)}`} />
      </div>
      {bonusPercent > 0 ? <p className="mt-3 rounded-2xl bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700">Tabela especial do cliente aplicada: +{bonusPercent}%</p> : null}
      {item.produto.variacoes.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {item.produto.variacoes.map((variacao) => {
            const selected = item.variacoesEscolhidas.find((choice) => choice.id_variacao === variacao.id_variacao);
            const isMissing = hasVariationError && variacao.is_obrigatorio && !selected;
            return (
              <Field key={variacao.id} label={`${variacao.variacao.nome}${variacao.is_obrigatorio ? " *" : ""}`}>
                <select value={selected?.tipo.id ?? ""} onChange={(event) => onVariationChange(variacao.id_variacao, event.target.value)} className={`${inputClass} ${isMissing ? "border-red-300 bg-red-50" : ""}`}>
                  <option value="">Selecione</option>
                  {variacao.tipos.map((tipo) => <option key={tipo.id} value={tipo.id}>{tipo.variacao} (+{formatCurrency(tipo.v_extra)} / {formatWeightFromGrams(tipo.peso, { mode: "g" })})</option>)}
                </select>
              </Field>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SelectorGrid<T extends { id: string }>({ items, selectedId, onSelect, render }: { items: T[]; selectedId: string; onSelect: (id: string) => void; render: (item: T) => { title: string; subtitle: string; detail: string } }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((item) => {
        const content = render(item);
        const isSelected = selectedId === item.id;
        return (
          <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={`rounded-3xl border p-4 text-left transition ${isSelected ? "border-teal-200 bg-teal-50 text-teal-800" : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"}`}>
            <p className="font-semibold">{content.title}</p>
            <p className="mt-1 text-sm opacity-80">{content.subtitle}</p>
            <p className="mt-1 text-xs opacity-70">{content.detail}</p>
          </button>
        );
      })}
    </div>
  );
}

function ResumoValores({ resumo, bonusPercent }: { resumo: ReturnType<typeof calculateResumo>; bonusPercent: number }) {
  const rows = [
    ["Subtotal bruto", formatCurrency(resumo.subtotalBrutoProdutos)],
    ["Descontos individuais", `-${formatCurrency(resumo.descontosIndividuais)}`],
    [`Acréscimo tabela especial${bonusPercent > 0 ? ` (+${bonusPercent}%)` : ""}`, `+${formatCurrency(resumo.acrescimoBonus)}`],
    ["Subtotal produtos", formatCurrency(resumo.subtotalProdutos)],
    ["Desconto geral", `-${formatCurrency(resumo.descontoGeral)}`],
    ["Frete escolhido", formatCurrency(resumo.frete)],
    ["Peso total", formatWeightFromGrams(resumo.pesoTotal)]
  ];
  return (
    <div className="space-y-3">
      {rows.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 text-sm"><span className="text-slate-500">{label}</span><strong className="text-right text-slate-900">{value}</strong></div>)}
      <div className="border-t border-slate-200 pt-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-slate-600">Total final</span><strong className="text-xl text-slate-950">{formatCurrency(resumo.valorTotal)}</strong></div></div>
    </div>
  );
}

function FormSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm"><div className="mb-5"><h2 className="text-lg font-semibold text-slate-950">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>{children}</section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-2"><span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>{children}</label>;
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>;
}

function ContactModal({ draft, onChange, onClose, onSave }: { draft: ContactDraft; onChange: (draft: ContactDraft) => void; onClose: () => void; onSave: () => void }) {
  return (
    <Modal title="Adicionar novo contato" onClose={onClose} onSave={onSave}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nome"><input value={draft.nome} onChange={(event) => onChange({ ...draft, nome: event.target.value })} className={inputClass} /></Field>
        <Field label="Cargo"><input value={draft.cargo} onChange={(event) => onChange({ ...draft, cargo: event.target.value })} className={inputClass} /></Field>
        <Field label="WhatsApp"><input value={draft.whatsapp} onChange={(event) => onChange({ ...draft, whatsapp: event.target.value })} className={inputClass} /></Field>
        <Field label="E-mail"><input value={draft.email} onChange={(event) => onChange({ ...draft, email: event.target.value })} className={inputClass} /></Field>
      </div>
    </Modal>
  );
}

function AddressModal({ draft, onChange, onClose, onSave }: { draft: AddressDraft; onChange: (draft: AddressDraft) => void; onClose: () => void; onSave: () => void }) {
  return (
    <Modal title="Adicionar novo endereço" onClose={onClose} onSave={onSave}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="CEP"><input value={draft.cep} onChange={(event) => onChange({ ...draft, cep: event.target.value })} className={inputClass} /></Field>
        <Field label="Logradouro"><input value={draft.endereco} onChange={(event) => onChange({ ...draft, endereco: event.target.value })} className={inputClass} /></Field>
        <Field label="Número"><input value={draft.numero} onChange={(event) => onChange({ ...draft, numero: event.target.value })} className={inputClass} /></Field>
        <Field label="Complemento"><input value={draft.complemento ?? ""} onChange={(event) => onChange({ ...draft, complemento: event.target.value })} className={inputClass} /></Field>
        <Field label="Bairro"><input value={draft.bairro} onChange={(event) => onChange({ ...draft, bairro: event.target.value })} className={inputClass} /></Field>
        <Field label="Cidade"><input value={draft.cidade} onChange={(event) => onChange({ ...draft, cidade: event.target.value })} className={inputClass} /></Field>
        <Field label="UF"><input value={draft.uf} onChange={(event) => onChange({ ...draft, uf: event.target.value.toUpperCase() })} className={inputClass} maxLength={2} /></Field>
        <Field label="Tipo"><select value={draft.tipo} onChange={(event) => onChange({ ...draft, tipo: event.target.value as CadastroEndereco["tipo"] })} className={inputClass}><option value="principal">Principal</option><option value="entrega">Entrega</option><option value="cobranca">Cobrança</option><option value="fiscal">Fiscal</option></select></Field>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose, onSave }: { title: string; children: ReactNode; onClose: () => void; onSave: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="mx-auto mt-8 max-w-3xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5"><h2 className="text-lg font-semibold text-slate-950">{title}</h2><button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700"><X className="h-5 w-5" /></button></div>
        <div className="p-5">{children}</div>
        <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Cancelar</button><button type="button" onClick={onSave} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white">Salvar mockado</button></div>
      </div>
    </div>
  );
}

function createInitialState(proposta?: Proposta): PropostaFormState {
  const cliente = proposta?.cliente ?? cadastrosMock.find((cadastro) => cadastro.categoria === "CLIENTE") ?? cadastrosMock[0];
  const endereco = proposta?.enderecoEntrega ?? cliente.enderecos[0];
  const fretes = proposta?.fretes ?? createFretesMock(endereco, proposta?.id_int ?? 16850, proposta?.resumo.pesoTotal ?? 0);
  return {
    id_int: proposta?.id_int.toString() ?? "16850",
    empresa: proposta?.empresa ?? "Ideal Grafica",
    vendedor: proposta?.vendedor ?? getClienteVendedorPadrao(cliente),
    status: proposta?.status ?? "NOVO",
    clienteId: cliente.idCliente.toString(),
    contatoId: proposta?.contato.id ?? cliente.contatos[0]?.id ?? "",
    enderecoId: endereco?.id ?? "",
    compradorId: proposta?.compradorAutorizado?.id ?? cliente.vinculosComerciais[0]?.id ?? "",
    itens: proposta?.itens ?? [],
    fretes,
    freteEscolhidoId: proposta?.freteEscolhidoId ?? fretes.find((frete) => frete.escolhido)?.id ?? fretes[0]?.id ?? "",
    descontoGeralTipo: proposta?.descontoGeralTipo ?? "VALOR",
    descontoGeralValor: proposta?.descontoGeralValor.toString() ?? "0",
    formaPagamento: proposta?.formaPagamento ?? "Pix a vista 3 dias",
    observacoes: proposta?.observacoes ?? ""
  };
}
