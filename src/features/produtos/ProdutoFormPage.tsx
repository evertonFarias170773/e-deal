"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eye, ImagePlus, Plus, Search, X } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  PRODUCT_IMAGES_BUCKET,
  createProdutoReal,
  listCategoriasProdutos,
  listProdutos,
  updateProdutoReal,
  uploadProdutoFotoReal,
  listarFormatosProducao,
  listarCoresProducao,
  listarGabaritos,
  type ProdutoWriteInput,
  type FormatoProducao,
  type CorProducao,
  type GabaritoProducao
} from "@/features/produtos/services/produtos.service";
import {
  listVariacoesGlobais,
  listTiposVariacoes,
  listProdutoVariacaoVinculos,
  saveProdutoVariacoes,
  type VariacaoGlobalJoin
} from "@/features/produtos/services/produto-variacoes.service";
import type {
  Produto,
  ProdutoCategoria,
  ProdutoFormState,
  ProdutoNivelSeguranca,
  ProdutoVariacaoDetalhada
} from "@/features/produtos/types";
import { parseDecimalInput } from "@/features/produtos/mappers";

type ProdutoFormPageProps = {
  mode: "new" | "edit";
  produto?: Produto;
};

type FormMessage = {
  tone: "success" | "warning" | "danger" | "info";
  title: string;
  description: string;
};

const niveisSeguranca: ProdutoNivelSeguranca[] = ["baixo", "medio", "alto", "antifraude", "controle visual"];
const fiscalFields = [
  "cod_beneficio",
  "ncm",
  "descri_ncm",
  "cest",
  "origem",
  "cod_origem",
  "cod_bar",
  "und_medida",
  "is_multiplo",
  "cfop_interno",
  "cfop_interestadual",
  "unidade_comercial",
  "unidade_tributavel",
  "icms_origem",
  "icms_situacao_tributaria",
  "pis_situacao_tributaria",
  "cofins_situacao_tributaria",
  "informacoes_fiscais"
] as const satisfies readonly (keyof ProdutoFormState)[];

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseNumericInput(value: string) {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function ProdutoFormPage({ mode, produto }: ProdutoFormPageProps) {
  const router = useRouter();
  const { showToast } = useAppToast();
  const [form, setForm] = useState<ProdutoFormState>(() => createInitialState(produto));
  const [message, setMessage] = useState<FormMessage | null>(null);
  const [errorFields, setErrorFields] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFotoFile, setSelectedFotoFile] = useState<File | null>(null);
  const [isUploadingFoto, setIsUploadingFoto] = useState(false);
  const [isVariationModalOpen, setIsVariationModalOpen] = useState(false);
  const [variationSearch, setVariationSearch] = useState("");
  const [selectedVariationId, setSelectedVariationId] = useState<number | null>(null);
  const [newVariationObrigatoria, setNewVariationObrigatoria] = useState(false);
  const [newVariationMultipla, setNewVariationMultipla] = useState(false);
  const [openOptionsVariationId, setOpenOptionsVariationId] = useState<number | null>(null);
  const [fiscalSourceProdutos, setFiscalSourceProdutos] = useState<Produto[]>([]);
  const [fiscalSourceSearch, setFiscalSourceSearch] = useState("");
  const [selectedFiscalSourceId, setSelectedFiscalSourceId] = useState("");
  const [isLoadingFiscalSource, setIsLoadingFiscalSource] = useState(false);
  const [variacoesGlobais, setVariacoesGlobais] = useState<VariacaoGlobalJoin[]>([]);
  const [categoriasReais, setCategoriasReais] = useState<string[]>([]);
  const [formatos, setFormatos] = useState<FormatoProducao[]>([]);
  const [cores, setCores] = useState<CorProducao[]>([]);
  const [gabaritos, setGabaritos] = useState<GabaritoProducao[]>([]);
  const [isLoadingCatalogos, setIsLoadingCatalogos] = useState(false);

  const title = mode === "new" ? "Novo produto" : `Editar produto #${produto?.id_produto}`;
  const subtitle =
    mode === "new"
      ? "Crie produtos reais em public.produtos com valores, dados fiscais e foto via Storage."
      : "Edite produto real em public.produtos. Código operacional e exclusões seguem bloqueados.";
  const criticalChanged = Boolean(
    produto &&
      ((parseDecimalInput(form.valorUnt) ?? 0) !== produto.valorUnt ||
        (parseDecimalInput(form.valorFixo) ?? 0) !== produto.valorFixo ||
        (parseDecimalInput(form.valor_custo) ?? 0) !== produto.valor_custo ||
        (parseDecimalInput(form.peso) ?? 0) !== produto.peso ||
        form.prazo !== produto.prazo)
  );
  const filteredVariationBank = useMemo(() => {
    const search = normalize(variationSearch);
    const linkedIds = new Set(form.variacoes.map((vinculo) => vinculo.id_variacao));

    return variacoesGlobais.filter((variacao) => {
      const matchesSearch = normalize(`${variacao.nome} ${variacao.descricao}`).includes(search);
      return variacao.is_ativo && !linkedIds.has(variacao.id_variacao) && matchesSearch;
    });
  }, [form.variacoes, variacoesGlobais, variationSearch]);
  /**
   * A categoria ATUAL do produto continua na frente da lista mesmo que nao
   * conste em `public.categorias`: sem isso, abrir "Editar" num produto de
   * categoria orfa trocaria silenciosamente o valor gravado pelo primeiro item
   * do select. Hoje isso vale para o 9001 "TesteBand" ("Pulseiras").
   */
  const categoriaOptions = useMemo(
    () => Array.from(new Set([produto?.categoria, ...categoriasReais].filter(Boolean))) as ProdutoCategoria[],
    [produto?.categoria, categoriasReais]
  );
  const filteredFiscalSourceProdutos = useMemo(() => {
    const search = normalize(fiscalSourceSearch);
    return fiscalSourceProdutos.filter((sourceProduto) => {
      if (produto && sourceProduto.id_produto === produto.id_produto) {
        return false;
      }

      const searchable = `${sourceProduto.id_produto} ${sourceProduto.nomeReal} ${sourceProduto.ncm}`;
      return normalize(searchable).includes(search);
    });
  }, [fiscalSourceProdutos, fiscalSourceSearch, produto]);

  useEffect(() => {
    if (window.location.hash) {
      const target = document.querySelector(window.location.hash);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoadingFiscalSource(true);
      const produtos = await listProdutos({ pageSize: 100 });
      if (!active) {
        return;
      }

      setFiscalSourceProdutos(produtos);
      setIsLoadingFiscalSource(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      const globais = await listVariacoesGlobais();
      if (!active) return;
      setVariacoesGlobais(globais);
    })();

    return () => {
      active = false;
    };
  }, []);

  /**
   * Categorias reais de `public.categorias` (21/08/2026).
   *
   * Ate aqui este select oferecia quatro valores fixos de
   * `@/lib/mocks/produtos.mock` — "Pulseiras", "Ingressos", "Cartoes",
   * "Credenciais" — que nao existem em nenhuma das 14 categorias cadastradas.
   * O mock nao avisava nada na tela, e ja produziu pelo menos um registro real:
   * o produto 9001 "TesteBand", com categoria "Pulseiras".
   *
   * `listCategoriasProdutos()` ja existia no service e ja era usada pela
   * listagem — faltava aqui. Ela apara espacos e quebras de linha e deduplica,
   * o que importa porque "Cordao Credencial" esta gravada com 
 no fim.
   */
  useEffect(() => {
    let active = true;

    void (async () => {
      const reais = await listCategoriasProdutos();
      if (!active) return;
      setCategoriasReais(reais);
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (mode === "edit" && produto?.id_produto) {
      let active = true;

      void (async () => {
        const vinculos = await listProdutoVariacaoVinculos(produto.id_produto);
        if (!active) return;
        updateField("variacoes", vinculos);
      })();

      return () => {
        active = false;
      };
    }
  }, [mode, produto?.id_produto]);

  useEffect(() => {
    let active = true;

    void (async () => {
      setIsLoadingCatalogos(true);
      try {
        const [formatosData, coresData, gabaritosData] = await Promise.all([
          listarFormatosProducao(),
          listarCoresProducao(),
          listarGabaritos()
        ]);
        if (!active) return;
        setFormatos(formatosData);
        setCores(coresData);
        setGabaritos(gabaritosData);
      } catch (err) {
        console.error("Erro ao carregar catálogos de produção:", err);
      } finally {
        if (active) setIsLoadingCatalogos(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const filteredCores = useMemo(() => {
    if (!form.id_formato) {
      return cores;
    }
    const selectedFormatObj = formatos.find((f) => f.id_formato_num.toString() === form.id_formato);
    if (!selectedFormatObj) {
      return cores;
    }
    return cores.filter(
      (c) =>
        !c.formato_id ||
        c.formato_id === selectedFormatObj.id
    );
  }, [cores, formatos, form.id_formato]);

  function updateField<K extends keyof ProdutoFormState>(field: K, value: ProdutoFormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrorFields((current) => current.filter((item) => item !== field));
  }

  function copyFiscalDataFromProduto() {
    const sourceProduto = fiscalSourceProdutos.find((item) => item.id_produto.toString() === selectedFiscalSourceId);
    if (!sourceProduto) {
      showToast({ type: "warning", title: "Selecione um produto", description: "Escolha o produto base para copiar os dados fiscais." });
      return;
    }

    if (produto && sourceProduto.id_produto === produto.id_produto) {
      showToast({ type: "warning", title: "Produto atual bloqueado", description: "Selecione outro produto para copiar os dados fiscais." });
      return;
    }

    const confirmed = window.confirm("Copiar os dados fiscais deste produto para o formulário atual?");
    if (!confirmed) {
      return;
    }

    setForm((current) => ({
      ...current,
      cod_beneficio: sourceProduto.cod_beneficio,
      ncm: sourceProduto.ncm,
      descri_ncm: sourceProduto.descri_ncm,
      cest: sourceProduto.cest,
      origem: sourceProduto.origem,
      cod_origem: sourceProduto.cod_origem?.toString() ?? "",
      cod_bar: sourceProduto.cod_bar,
      und_medida: sourceProduto.und_medida,
      is_multiplo: sourceProduto.is_multiplo,
      cfop_interno: sourceProduto.cfop_interno,
      cfop_interestadual: sourceProduto.cfop_interestadual,
      unidade_comercial: sourceProduto.unidade_comercial,
      unidade_tributavel: sourceProduto.unidade_tributavel,
      icms_origem: sourceProduto.icms_origem,
      icms_situacao_tributaria: sourceProduto.icms_situacao_tributaria,
      pis_situacao_tributaria: sourceProduto.pis_situacao_tributaria,
      cofins_situacao_tributaria: sourceProduto.cofins_situacao_tributaria,
      informacoes_fiscais: sourceProduto.informacoes_fiscais
    }));
    setErrorFields((current) => current.filter((field) => !(fiscalFields as readonly string[]).includes(field)));
    showToast({
      type: "success",
      title: "Dados fiscais copiados",
      description: "Dados fiscais copiados para o formulário. Salve para gravar."
    });
  }

  async function uploadSelectedFoto(targetIdProduto: number, targetNomeProduto: string) {
    if (!selectedFotoFile) {
      return null;
    }

    setIsUploadingFoto(true);
    const result = await uploadProdutoFotoReal({
      idProduto: targetIdProduto,
      nomeProduto: targetNomeProduto,
      file: selectedFotoFile
    });
    setIsUploadingFoto(false);

    if (!result.success || !result.foto) {
      showToast({ type: "error", title: "Não foi possível enviar a foto", description: result.message });
      setMessage({
        tone: "warning",
        title: "Produto salvo, mas a foto não foi enviada",
        description: result.message
      });
      return null;
    }

    updateField("fotos", [...form.fotos, { ...result.foto, principal: form.fotos.length === 0 }]);
    setSelectedFotoFile(null);
    showToast({ type: "success", title: "Foto enviada", description: `Imagem salva no bucket ${PRODUCT_IMAGES_BUCKET} e registrada em public.fotosProdutos.` });
    return result.foto;
  }

  async function addFoto() {
    if (!selectedFotoFile) {
      showToast({ type: "warning", title: "Selecione uma imagem", description: "Escolha um arquivo do computador antes de adicionar a foto." });
      return;
    }

    const targetIdProduto = Number(form.id_produto);
    if (mode === "new" && !produto) {
      showToast({ type: "info", title: "Foto preparada", description: "A imagem será enviada após salvar o novo produto." });
      return;
    }

    await uploadSelectedFoto(targetIdProduto, form.nomeReal || `Produto ${targetIdProduto}`);
  }

  function setFotoPrincipal(id: string) {
    updateField(
      "fotos",
      form.fotos.map((foto) => ({ ...foto, principal: foto.id === id }))
    );
    showToast({ type: "info", title: "Foto principal marcada", description: "Alteração visual aplicada apenas na tela." });
  }

  function openVariationModal() {
    setSelectedVariationId(null);
    setNewVariationObrigatoria(false);
    setNewVariationMultipla(false);
    setVariationSearch("");
    setIsVariationModalOpen(true);
  }

  async function linkVariationToProduct() {
    const variacao = variacoesGlobais.find((item) => item.id_variacao === selectedVariationId);

    if (!variacao) {
      showToast({ type: "warning", title: "Selecione uma variação", description: "Escolha uma variação global existente." });
      return;
    }

    const tipos = await listTiposVariacoes(variacao.id_variacao);

    const vinculo: ProdutoVariacaoDetalhada = {
      id: `pv_temp_${Date.now()}`,
      id_produto: Number(form.id_produto) || 0,
      id_variacao: variacao.id_variacao,
      is_obrigatorio: newVariationObrigatoria,
      is_multiplo: newVariationMultipla,
      variacao: {
        id_variacao: variacao.id_variacao,
        nome: variacao.nome,
        descricao: variacao.descricao,
        is_ativo: variacao.is_ativo
      },
      tipos: tipos.filter((t) => t.is_ativo !== false)
    };

    updateField("variacoes", [...form.variacoes, vinculo]);
    updateField("is_variacao", true);
    setIsVariationModalOpen(false);
    showToast({
      type: "success",
      title: "Variação vinculada ao produto",
      description: "A variação foi vinculada localmente. Salve o produto para persistir."
    });
  }

  function updateVariacao(index: number, field: "is_obrigatorio" | "is_multiplo", value: boolean) {
    const variacoes = form.variacoes.map((variacao, currentIndex) =>
      currentIndex === index ? { ...variacao, [field]: value } : variacao
    );
    updateField("variacoes", variacoes);
  }

  function removeVariacao(index: number) {
    const shouldRemove = window.confirm(
      "Esta ação remove a variação apenas deste produto. A variação continuará disponível no banco de variações."
    );

    if (!shouldRemove) {
      return;
    }

    updateField("variacoes", form.variacoes.filter((_, currentIndex) => currentIndex !== index));
    showToast({
      type: "warning",
      title: "Variação removida deste produto.",
      description: "A variação global não foi apagada."
    });
  }

  function buildProdutoWriteInput(): ProdutoWriteInput {
    return {
      id_produto: Number(form.id_produto),
      nomeReal: form.nomeReal,
      categoria: form.categoria,
      formato: form.formato,
      descricao: form.descricao,
      personalizacao: form.personalizacao,
      apelidos: form.apelidos,
      ativo: form.ativo,
      is_estoque: form.is_estoque,
      is_variacao: form.is_variacao,
      nivelSeg: form.nivelSeg,
      fraseCons: form.fraseCons,
      prazo: form.prazo,
      peso: parseDecimalInput(form.peso),
      valorUnt: parseDecimalInput(form.valorUnt),
      valorFixo: parseDecimalInput(form.valorFixo),
      valor_custo: parseDecimalInput(form.valor_custo),
      cod_beneficio: form.cod_beneficio,
      ncm: form.ncm,
      descri_ncm: form.descri_ncm,
      cest: form.cest,
      origem: form.origem,
      cod_origem: parseNumericInput(form.cod_origem),
      cod_bar: form.cod_bar,
      und_medida: form.und_medida,
      is_multiplo: form.is_multiplo,
      cfop_interno: form.cfop_interno,
      cfop_interestadual: form.cfop_interestadual,
      unidade_comercial: form.unidade_comercial,
      unidade_tributavel: form.unidade_tributavel,
      icms_origem: form.icms_origem,
      icms_situacao_tributaria: form.icms_situacao_tributaria,
      pis_situacao_tributaria: form.pis_situacao_tributaria,
      cofins_situacao_tributaria: form.cofins_situacao_tributaria,
      informacoes_fiscais: form.informacoes_fiscais,
      id_formato: form.id_formato ? Number(form.id_formato) : null,
      id_modelo_cor: form.id_modelo_cor ? Number(form.id_modelo_cor) : null,
      quantidade_minima_venda: form.quantidade_minima_venda ? Number(form.quantidade_minima_venda) : null,
      tipo_blocagem: form.tipo_blocagem ? form.tipo_blocagem.trim() : null,
      id_gabarito: form.id_gabarito ? Number(form.id_gabarito) : null,
      setor_pcp: form.setor_pcp ? form.setor_pcp.trim() : null
    };
  }

  async function handleSave() {
    const parsedIdProduto = Number(form.id_produto);
    const parsedCodOrigem = parseNumericInput(form.cod_origem);
    const parsedQtdMin = form.quantidade_minima_venda.trim() ? Number(form.quantidade_minima_venda) : null;

    const validateDecimal = (val: string) => {
      const trimmed = val.trim();
      if (!trimmed) {
        return { isValid: true, value: null };
      }
      const parsed = parseDecimalInput(val);
      return { isValid: parsed !== null, value: parsed };
    };

    const pesoVal = validateDecimal(form.peso);
    const valorUntVal = validateDecimal(form.valorUnt);
    const valorFixoVal = validateDecimal(form.valorFixo);
    const valorCustoVal = validateDecimal(form.valor_custo);
    
    const missingFields = [
      !form.id_produto ? "id_produto" : null,
      !form.nomeReal.trim() ? "nomeReal" : null
    ].filter(Boolean) as string[];
    
    const hasInvalidCodOrigem =
      typeof parsedCodOrigem === "number" &&
      (!Number.isInteger(parsedCodOrigem) || parsedCodOrigem < -32768 || parsedCodOrigem > 32767);
      
    const hasInvalidQtdMin =
      parsedQtdMin !== null &&
      (!Number.isInteger(parsedQtdMin) || parsedQtdMin < 1);

    if (
      missingFields.length ||
      !Number.isInteger(parsedIdProduto) ||
      parsedIdProduto <= 0 ||
      !pesoVal.isValid ||
      !valorUntVal.isValid ||
      !valorFixoVal.isValid ||
      !valorCustoVal.isValid ||
      Number.isNaN(parsedCodOrigem) ||
      hasInvalidCodOrigem ||
      hasInvalidQtdMin
    ) {
      const invalidFields = [
        ...missingFields,
        !Number.isInteger(parsedIdProduto) || parsedIdProduto <= 0 ? "id_produto" : null,
        !pesoVal.isValid ? "peso" : null,
        !valorUntVal.isValid ? "valorUnt" : null,
        !valorFixoVal.isValid ? "valorFixo" : null,
        !valorCustoVal.isValid ? "valor_custo" : null,
        Number.isNaN(parsedCodOrigem) || hasInvalidCodOrigem ? "cod_origem" : null,
        hasInvalidQtdMin ? "quantidade_minima_venda" : null
      ].filter(Boolean) as string[];
      
      setErrorFields(Array.from(new Set(invalidFields)));
      setMessage({
        tone: "danger",
        title: "Não foi possível salvar",
        description: hasInvalidQtdMin
          ? "Quantidade mínima deve ser um número inteiro maior ou igual a 1."
          : "Revise ID, nome e campos numéricos antes de salvar."
      });
      showToast({ 
        type: "error", 
        title: "Não foi possível salvar", 
        description: hasInvalidQtdMin
          ? "Quantidade mínima deve ser um número inteiro maior ou igual a 1."
          : "Revise os campos destacados antes de continuar." 
      });
      return;
    }

    setIsSaving(true);
    try {
      const result =
        mode === "edit" && produto
          ? await updateProdutoReal(produto.id_produto, buildProdutoWriteInput())
          : await createProdutoReal(buildProdutoWriteInput());

      if (!result.success) {
        const duplicateId = result.message === "Este ID de produto já está sendo usado. Informe outro ID.";
        setErrorFields(duplicateId ? ["id_produto"] : []);
        setMessage({
          tone: "danger",
          title: "Não foi possível salvar",
          description: result.message
        });
        showToast({ type: "error", title: "Não foi possível salvar", description: result.message });
        return;
      }

      const successTitle = mode === "edit" ? "Produto atualizado com sucesso." : "Produto criado com sucesso.";
      const redirectTarget = `/produtos/${result.produto?.id_produto ?? produto?.id_produto ?? parsedIdProduto}`;
      setMessage({
        tone: "success",
        title: successTitle,
        description: "Alteração confirmada no Supabase com whitelist de campos operacionais."
      });
      showToast({
        type: "success",
        title: successTitle,
        description: "Redirecionando para o detalhe do produto..."
      });

      // Sincroniza vínculos de variação com o banco
      const targetIdProduto = result.produto?.id_produto ?? produto?.id_produto ?? parsedIdProduto;
      const vinculosPayload = form.variacoes.map((v) => ({
        id_variacao: v.id_variacao,
        is_obrigatorio: v.is_obrigatorio,
        is_multiplo: v.is_multiplo
      }));

      const vinculosResult = await saveProdutoVariacoes(targetIdProduto, vinculosPayload);
      if (!vinculosResult.success) {
        showToast({
          type: "warning",
          title: "Variações não sincronizadas",
          description: vinculosResult.message
        });
      }

      if (selectedFotoFile) {
        await uploadSelectedFoto(result.produto?.id_produto ?? produto?.id_produto ?? parsedIdProduto, result.produto?.nomeReal ?? form.nomeReal);
      }

      window.setTimeout(() => {
        router.push(redirectTarget);
      }, 900);
    } catch (error) {
      console.log("[Produtos][Form] erro inesperado ao salvar produto.", { error });
      setMessage({
        tone: "danger",
        title: "Não foi possível salvar",
        description: "Ocorreu uma falha inesperada ao comunicar com o Supabase. Tente novamente em alguns segundos."
      });
      showToast({
        type: "error",
        title: "Não foi possível salvar",
        description: "Falha inesperada ao comunicar com o Supabase."
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        subtitle={subtitle}
        context="Produtos / Catalogo"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href={mode === "edit" && produto ? `/produtos/${produto.id_produto}` : "/produtos"} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              {mode === "edit" ? "Voltar ao detalhe" : "Voltar para lista"}
            </Link>
            <button type="button" onClick={handleSave} disabled={isSaving} className="rounded-2xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#123f61] disabled:opacity-60">
              {isSaving ? "Salvando..." : mode === "edit" ? "Salvar alteracoes" : "Salvar produto"}
            </button>
          </div>
        }
      />

      {message ? <FormAlert message={message} /> : null}
      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
        <h2 className="font-semibold">Escrita real controlada</h2>
        <p className="mt-1 text-sm">
          Esta tela salva produtos, valores comerciais, dados fiscais e novas fotos. DELETE físico,
          exclusão de imagem e alterações de variações continuam bloqueados.
        </p>
      </div>
      {mode === "edit" ? (
        <div className="rounded-3xl border border-sky-200 bg-sky-50 p-5 text-sky-800">
          <h2 className="font-semibold">Codigo operacional protegido</h2>
          <p className="mt-1 text-sm">
            O campo id_produto e a chave operacional do catalogo. Nesta tela ele fica somente leitura para evitar impacto em propostas, fotos, variacoes e Maestro.
          </p>
        </div>
      ) : null}
      {criticalChanged ? (
        <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5 text-orange-800">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h2 className="font-semibold">Alteracao critica de produto</h2>
              <p className="mt-1 text-sm">
                Preço, custo, peso, prazo e fiscal impactam operação. Nesta fase eles são salvos por whitelist e com conversão segura.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard title="Codigo" value={`#${form.id_produto || "novo"}`} />
        <StatusCard title="Valor unitario" value={formatCurrency(Number(form.valorUnt) || 0)} />
        <StatusCard title="Prazo" value={form.prazo || "Nao definido"} />
        <StatusCard title="Fotos / variacoes" value={`${form.fotos.length} / ${form.variacoes.length}`} />
      </section>

      <FormSection title="Dados principais" description="Identificação do produto em public.produtos.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="id_produto">
            <input value={form.id_produto} readOnly={mode === "edit"} onChange={(event) => updateField("id_produto", event.target.value)} className={`${getInputClass(errorFields.includes("id_produto"))} ${mode === "edit" ? "cursor-not-allowed bg-slate-100 text-slate-500" : ""}`} />
          </Field>
          <Field label="Nome real">
            <input value={form.nomeReal} onChange={(event) => updateField("nomeReal", event.target.value)} className={getInputClass(errorFields.includes("nomeReal"))} />
          </Field>
          <Field label="Categoria">
            <select value={form.categoria} onChange={(event) => updateField("categoria", event.target.value as ProdutoCategoria)} className={getInputClass(errorFields.includes("categoria"))}>
              {categoriaOptions.map((categoria) => (
                <option key={categoria} value={categoria}>{categoria}</option>
              ))}
            </select>
          </Field>
          <Field label="Formato">
            <input value={form.formato} onChange={(event) => updateField("formato", event.target.value)} className={getInputClass(errorFields.includes("formato"))} placeholder="25x2cm, A6, PVC 0,76mm" />
          </Field>
          <Field label="Formato (Produção)">
            <select
              value={form.id_formato}
              onChange={(event) => {
                const newFormato = event.target.value;
                const newFormatObj = formatos.find((f) => f.id_formato_num.toString() === newFormato);
                
                setForm((prev) => {
                  const nextForm = { ...prev, id_formato: newFormato };
                  if (prev.id_modelo_cor) {
                    const isStillValid = cores.some(
                      (c) =>
                        c.id_modelo_cor_num.toString() === prev.id_modelo_cor &&
                        (!c.formato_id || (newFormatObj && c.formato_id === newFormatObj.id))
                    );
                    if (!isStillValid) {
                      nextForm.id_modelo_cor = "";
                    }
                  }
                  return nextForm;
                });
                setErrorFields((curr) => curr.filter((item) => item !== "id_formato"));
              }}
              className={getInputClass(errorFields.includes("id_formato"))}
              disabled={isLoadingCatalogos}
            >
              <option value="">Selecione um formato operacional</option>
              {formatos.map((fmt) => (
                <option key={fmt.id_formato_num} value={fmt.id_formato_num.toString()}>
                  {fmt.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Modelo / Cor (Produção)">
            <select
              value={form.id_modelo_cor}
              onChange={(event) => updateField("id_modelo_cor", event.target.value)}
              className={getInputClass(errorFields.includes("id_modelo_cor"))}
              disabled={isLoadingCatalogos}
            >
              <option value="">Selecione um modelo/cor</option>
              {filteredCores.map((c) => (
                <option key={c.id_modelo_cor_num} value={c.id_modelo_cor_num.toString()}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantidade mínima vendida">
            <input
              type="number"
              min="1"
              step="1"
              value={form.quantidade_minima_venda}
              onChange={(event) => updateField("quantidade_minima_venda", event.target.value)}
              className={getInputClass(errorFields.includes("quantidade_minima_venda"))}
              placeholder="Ex: 1000"
            />
          </Field>
          <Field label="Tipo de blocagem">
            <input
              value={form.tipo_blocagem}
              onChange={(event) => updateField("tipo_blocagem", event.target.value)}
              className={getInputClass(errorFields.includes("tipo_blocagem"))}
              placeholder="Ex: Blc de 25, Individual, Cartela"
            />
          </Field>
          <Field label="Setor PCP (Produção)">
            <select
              value={form.setor_pcp}
              onChange={(event) => updateField("setor_pcp", event.target.value)}
              className={getInputClass(errorFields.includes("setor_pcp"))}
            >
              <option value="">Selecione o setor PCP padrão</option>
              <option value="LASER">LASER</option>
              <option value="TEXTIL">TEXTIL</option>
              <option value="PVC">PVC</option>
              <option value="FLEXO">FLEXO</option>
            </select>
          </Field>
          <Field label="Gabarito padrão (Produção)">
            <select
              value={form.id_gabarito}
              onChange={(event) => updateField("id_gabarito", event.target.value)}
              className={getInputClass(errorFields.includes("id_gabarito"))}
              disabled={isLoadingCatalogos}
            >
              <option value="">Selecione o gabarito padrão</option>
              {gabaritos.map((g) => (
                <option key={g.id} value={g.id_gabarito !== null ? g.id_gabarito.toString() : ""}>
                  {g.name} {g.id_gabarito !== null ? `(Código: ${g.id_gabarito})` : ""}
                </option>
              ))}
            </select>
          </Field>
          <div className="md:col-span-2 xl:col-span-4">
            <Field label="Descricao">
              <textarea value={form.descricao} onChange={(event) => updateField("descricao", event.target.value)} className={`${inputClass} min-h-28 resize-y`} />
            </Field>
          </div>
        </div>
      </FormSection>

      <FormSection title="Valores" description="Preços e custo interno liberados nesta fase com conversão numérica segura. Campo vazio vira null.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Valor unitario">
            <input type="text" inputMode="decimal" value={form.valorUnt} onChange={(event) => updateField("valorUnt", event.target.value)} className={getInputClass(errorFields.includes("valorUnt"))} />
          </Field>
          <Field label="Valor fixo">
            <input type="text" inputMode="decimal" value={form.valorFixo} onChange={(event) => updateField("valorFixo", event.target.value)} className={getInputClass(errorFields.includes("valorFixo"))} />
          </Field>
          <Field label="Valor custo">
            <input type="text" inputMode="decimal" value={form.valor_custo} onChange={(event) => updateField("valor_custo", event.target.value)} className={getInputClass(errorFields.includes("valor_custo"))} />
          </Field>
          <Field label="Produto ativo">
            <select value={form.ativo ? "SIM" : "NAO"} onChange={(event) => updateField("ativo", event.target.value === "SIM")} className={inputClass}>
              <option value="SIM">Ativo</option>
              <option value="NAO">Inativo</option>
            </select>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Producao" description="Peso é salvo em gramas. A conversão para kg acontece apenas na exibição.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Peso (g)">
            <input type="text" inputMode="decimal" value={form.peso} onChange={(event) => updateField("peso", event.target.value)} className={getInputClass(errorFields.includes("peso"))} placeholder="177" />
          </Field>
          <Field label="Prazo">
            <input value={form.prazo} onChange={(event) => updateField("prazo", event.target.value)} className={getInputClass(errorFields.includes("prazo"))} placeholder="3 dias uteis" />
          </Field>
          <Toggle label="Produto de prateleira" checked={form.is_estoque} onChange={(value) => updateField("is_estoque", value)} />
          <Toggle label="Possui variacoes" checked={form.is_variacao} onChange={(value) => updateField("is_variacao", value)} />
        </div>
      </FormSection>

      <FormSection title="Seguranca e personalizacao" description="Informacoes consultivas e tecnicas para venda e producao.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nivel de seguranca">
            <select value={form.nivelSeg} onChange={(event) => updateField("nivelSeg", event.target.value as ProdutoNivelSeguranca)} className={inputClass}>
              {niveisSeguranca.map((nivel) => (
                <option key={nivel} value={nivel}>{nivel}</option>
              ))}
            </select>
          </Field>
          <Field label="Frase consultiva">
            <input value={form.fraseCons} onChange={(event) => updateField("fraseCons", event.target.value)} className={inputClass} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Personalizacao">
              <textarea value={form.personalizacao} onChange={(event) => updateField("personalizacao", event.target.value)} className={`${inputClass} min-h-28 resize-y`} />
            </Field>
          </div>
        </div>
      </FormSection>

      <FormSection title="Dados fiscais" description="Campos fiscais do produto. Não há validação SEFAZ nesta etapa.">
        <div className="mb-5 rounded-3xl border border-sky-200 bg-sky-50 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sky-950">Copiar dados fiscais de outro produto</p>
              <p className="mt-1 text-sm text-sky-700">
                A cópia preenche apenas campos fiscais neste formulário. Salve para gravar no Supabase.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1.4fr]">
                <label className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-white px-4 py-3">
                  <Search className="h-4 w-4 text-[#0f9f9a]" />
                  <input
                    value={fiscalSourceSearch}
                    onChange={(event) => setFiscalSourceSearch(event.target.value)}
                    className="w-full bg-transparent text-sm text-slate-900 outline-none"
                    placeholder="Buscar por código, produto ou NCM"
                  />
                </label>
                <select
                  value={selectedFiscalSourceId}
                  onChange={(event) => setSelectedFiscalSourceId(event.target.value)}
                  className={inputClass}
                  disabled={isLoadingFiscalSource}
                >
                  <option value="">{isLoadingFiscalSource ? "Carregando produtos..." : "Selecione um produto base"}</option>
                  {filteredFiscalSourceProdutos.map((sourceProduto) => (
                    <option key={sourceProduto.id_produto} value={sourceProduto.id_produto}>
                      #{sourceProduto.id_produto} - {sourceProduto.nomeReal}{sourceProduto.ncm ? ` - NCM ${sourceProduto.ncm}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              onClick={copyFiscalDataFromProduto}
              disabled={!selectedFiscalSourceId}
              className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Copiar dados fiscais
            </button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label="NCM">
            <input value={form.ncm} onChange={(event) => updateField("ncm", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Descrição NCM">
            <input value={form.descri_ncm} onChange={(event) => updateField("descri_ncm", event.target.value)} className={inputClass} />
          </Field>
          <Field label="CEST">
            <input value={form.cest} onChange={(event) => updateField("cest", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Origem">
            <input value={form.origem} onChange={(event) => updateField("origem", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Código origem">
            <input value={form.cod_origem} onChange={(event) => updateField("cod_origem", event.target.value)} className={getInputClass(errorFields.includes("cod_origem"))} />
          </Field>
          <Field label="Código de barras">
            <input value={form.cod_bar} onChange={(event) => updateField("cod_bar", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Unidade medida">
            <input value={form.und_medida} onChange={(event) => updateField("und_medida", event.target.value)} className={inputClass} />
          </Field>
          <Toggle label="Produto múltiplo" checked={form.is_multiplo} onChange={(value) => updateField("is_multiplo", value)} />
          <Field label="CFOP interno">
            <input value={form.cfop_interno} onChange={(event) => updateField("cfop_interno", event.target.value)} className={inputClass} />
          </Field>
          <Field label="CFOP interestadual">
            <input value={form.cfop_interestadual} onChange={(event) => updateField("cfop_interestadual", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Unidade comercial">
            <input value={form.unidade_comercial} onChange={(event) => updateField("unidade_comercial", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Unidade tributável">
            <input value={form.unidade_tributavel} onChange={(event) => updateField("unidade_tributavel", event.target.value)} className={inputClass} />
          </Field>
          <Field label="ICMS origem">
            <input value={form.icms_origem} onChange={(event) => updateField("icms_origem", event.target.value)} className={inputClass} />
          </Field>
          <Field label="ICMS CST">
            <input value={form.icms_situacao_tributaria} onChange={(event) => updateField("icms_situacao_tributaria", event.target.value)} className={inputClass} />
          </Field>
          <Field label="PIS CST">
            <input value={form.pis_situacao_tributaria} onChange={(event) => updateField("pis_situacao_tributaria", event.target.value)} className={inputClass} />
          </Field>
          <Field label="COFINS CST">
            <input value={form.cofins_situacao_tributaria} onChange={(event) => updateField("cofins_situacao_tributaria", event.target.value)} className={inputClass} />
          </Field>
          <Field label="Benefício fiscal">
            <input value={form.cod_beneficio} onChange={(event) => updateField("cod_beneficio", event.target.value)} className={inputClass} />
          </Field>
          <div className="md:col-span-2 xl:col-span-4">
            <Field label="Informações fiscais">
              <textarea value={form.informacoes_fiscais} onChange={(event) => updateField("informacoes_fiscais", event.target.value)} className={`${inputClass} min-h-28 resize-y`} />
            </Field>
          </div>
        </div>
      </FormSection>

      <FormSection title="Apelidos para IA/Maestro" description="Termos informais usados para reconhecer o produto em buscas e no Maestro.">
        <Field label="Apelidos separados por virgula">
          <textarea value={form.apelidos} onChange={(event) => updateField("apelidos", event.target.value)} className={`${inputClass} min-h-28 resize-y`} placeholder="triband, pulseira tri band, pulseirinha" />
        </Field>
      </FormSection>

      <FormSection
        id="fotos"
        title="Fotos"
        description={`Envie novas imagens para o bucket ${PRODUCT_IMAGES_BUCKET}, pasta produtos. Exclusão de imagem não está liberada nesta etapa.`}
        action={<AddFotoInput file={selectedFotoFile} onChange={setSelectedFotoFile} onAdd={addFoto} isUploading={isUploadingFoto} />}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {form.fotos.map((foto) => (
            <div key={foto.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <img src={foto.imagensURL} alt={foto.nomeProduto} className="h-40 w-full object-cover" />
              <div className="space-y-3 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-slate-900">{foto.nomeProduto}</p>
                  {foto.principal ? <StatusBadge status="PRINCIPAL" tone="success" /> : null}
                </div>
                <ActionsMenu
                  label="Acoes"
                  items={[
                    { label: "Marcar principal", onClick: () => setFotoPrincipal(foto.id), disabled: foto.principal }
                  ]}
                />
              </div>
            </div>
          ))}
          {!form.fotos.length ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
              Nenhuma foto cadastrada. Selecione uma imagem do computador para enviar ao Storage.
            </div>
          ) : null}
        </div>
      </FormSection>

      <FormSection
        id="variacoes"
        title="Variações do produto"
        description="Vínculos com variações globais reutilizáveis. As opções vêm de tipos_variacoes."
        action={<AddButton label="Adicionar variação" onClick={openVariationModal} />}
      >
        <div className="space-y-4">
          {form.variacoes.map((variacao, index) => (
            <div key={variacao.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-4 lg:grid-cols-[1fr_170px_170px_120px_auto] lg:items-start">
                <div>
                  <p className="font-semibold text-slate-950">{variacao.variacao.nome}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-500">{variacao.variacao.descricao}</p>
                </div>
                <Toggle label="Obrigatória" checked={variacao.is_obrigatorio} onChange={(value) => updateVariacao(index, "is_obrigatorio", value)} />
                <Toggle label="Múltipla escolha" checked={variacao.is_multiplo} onChange={(value) => updateVariacao(index, "is_multiplo", value)} />
                <div className="rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                  {variacao.tipos.length} opções
                </div>
                <ActionsMenu
                  label="Ações"
                  items={[
                    {
                      label: openOptionsVariationId === variacao.id_variacao ? "Ocultar opções" : "Ver opções",
                      onClick: () =>
                        setOpenOptionsVariationId((current) =>
                          current === variacao.id_variacao ? null : variacao.id_variacao
                        )
                    },
                    { label: "Remover vínculo", destructive: true, onClick: () => removeVariacao(index) }
                  ]}
                />
              </div>
              {openOptionsVariationId === variacao.id_variacao ? (
                <VariationOptionsList variacao={variacao} />
              ) : null}
            </div>
          ))}
          {!form.variacoes.length ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
              Nenhuma variação vinculada a este produto. Use &quot;Adicionar variação&quot; para escolher uma variação global existente.
            </div>
          ) : null}
        </div>
      </FormSection>

      {isVariationModalOpen ? (
        <VariationLinkModal
          search={variationSearch}
          onSearch={setVariationSearch}
          variations={filteredVariationBank}
          selectedVariationId={selectedVariationId}
          onSelect={setSelectedVariationId}
          obrigatoria={newVariationObrigatoria}
          onObrigatoria={setNewVariationObrigatoria}
          multipla={newVariationMultipla}
          onMultipla={setNewVariationMultipla}
          onClose={() => setIsVariationModalOpen(false)}
          onSave={linkVariationToProduct}
        />
      ) : null}

      <div className="sticky bottom-4 z-20 rounded-3xl border border-[#d7e5e8] bg-white/95 p-4 shadow-xl shadow-slate-900/10 backdrop-blur">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-semibold text-slate-700">
            Produto #{form.id_produto || "novo"} | {form.nomeReal || "nome nao definido"}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={() => router.push(mode === "edit" && produto ? `/produtos/${produto.id_produto}` : "/produtos")} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Cancelar</button>
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">Voltar ao topo</button>
            <button type="button" onClick={handleSave} disabled={isSaving} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {isSaving ? "Salvando..." : mode === "edit" ? "Salvar alteracoes" : "Salvar produto"}
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
  return hasError ? `${inputClass} border-red-300 bg-red-50 focus:border-red-400 focus:ring-red-100` : inputClass;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function FormSection({ id, title, description, action, children }: { id?: string; title: string; description: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
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

  return (
    <div className={`rounded-3xl border p-5 ${styles[message.tone]}`}>
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <h2 className="font-semibold">{message.title}</h2>
          <p className="mt-1 text-sm">{message.description}</p>
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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${checked ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600"}`}>
      {label}: {checked ? "Sim" : "Nao"}
    </button>
  );
}

function VariationOptionsList({ variacao }: { variacao: ProdutoVariacaoDetalhada }) {
  const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

  return (
    <div className="mt-4 rounded-3xl border border-[#d7e5e8] bg-white p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Eye className="h-4 w-4 text-[#0f9f9a]" />
        Opções de {variacao.variacao.nome}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {variacao.tipos.map((tipo) => {
          const isHex = hexRegex.test(tipo.ref);
          return (
            <div key={tipo.id} className="flex items-center justify-between rounded-2xl bg-slate-50 p-3 text-sm text-slate-700">
              <div>
                <p className="font-semibold text-slate-950">{tipo.variacao}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {tipo.v_extra > 0 ? `+${formatCurrency(tipo.v_extra)}` : formatCurrency(0)}
                  {" | "}
                  {tipo.peso > 0 ? `+${tipo.peso}g` : "0g"}
                  {tipo.ref ? ` | Ref: ${tipo.ref}` : ""}
                </p>
              </div>
              {isHex ? (
                <div
                  className="h-6 w-6 shrink-0 rounded-full border border-slate-300 shadow-sm"
                  style={{ backgroundColor: tipo.ref }}
                  title={`Preview da cor: ${tipo.ref}`}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VariationLinkModal({
  search,
  onSearch,
  variations,
  selectedVariationId,
  onSelect,
  obrigatoria,
  onObrigatoria,
  multipla,
  onMultipla,
  onClose,
  onSave
}: {
  search: string;
  onSearch: (value: string) => void;
  variations: VariacaoGlobalJoin[];
  selectedVariationId: number | null;
  onSelect: (value: number) => void;
  obrigatoria: boolean;
  onObrigatoria: (value: boolean) => void;
  multipla: boolean;
  onMultipla: (value: boolean) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="mx-auto flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">Banco de variações</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Adicionar variação existente</h2>
            <p className="mt-1 text-sm text-slate-500">
              Esta ação vincula o produto à variação global selecionada. Salve o produto para persistir.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-2xl bg-slate-100 p-2 text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por nome ou descrição da variação"
            />
          </label>

          <div className="grid gap-3">
            {variations.map((variacao) => {
              const isSelected = selectedVariationId === variacao.id_variacao;
              const optionsCount = variacao.opcoesCount;

              return (
                <button
                  key={variacao.id_variacao}
                  type="button"
                  onClick={() => onSelect(variacao.id_variacao)}
                  className={`rounded-3xl border p-4 text-left transition ${
                    isSelected
                      ? "border-[#0f9f9a] bg-[#dff8f6] text-[#0b7774]"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold">{variacao.nome}</p>
                      <p className="mt-1 text-sm opacity-80">{variacao.descricao}</p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
                      {optionsCount} opções
                    </span>
                  </div>
                </button>
              );
            })}
            {!variations.length ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                Nenhuma variação disponível com a busca atual ou todas já estão vinculadas ao produto.
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Toggle label="Obrigatória neste produto" checked={obrigatoria} onChange={onObrigatoria} />
            <Toggle label="Permite múltipla escolha" checked={multipla} onChange={onMultipla} />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 p-5 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700">
            Cancelar
          </button>
          <button type="button" onClick={onSave} className="rounded-2xl bg-[#0b2f4a] px-5 py-3 text-sm font-semibold text-white">
            Confirmar vínculo
          </button>
        </div>
      </div>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-2.5 text-sm font-semibold text-[#0b2f4a] hover:bg-[#f3f7f8]">
      <Plus className="h-4 w-4" />
      {label}
    </button>
  );
}

function AddFotoInput({
  file,
  onChange,
  onAdd,
  isUploading
}: {
  file: File | null;
  onChange: (value: File | null) => void;
  onAdd: () => void;
  isUploading: boolean;
}) {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-96 sm:flex-row">
      <label className="flex min-h-11 flex-1 items-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          className="w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
        />
      </label>
      <button type="button" onClick={onAdd} disabled={!file || isUploading} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-4 py-2.5 text-sm font-semibold text-[#0b2f4a] hover:bg-[#f3f7f8] disabled:cursor-not-allowed disabled:opacity-60">
        <ImagePlus className="h-4 w-4" />
        {isUploading ? "Enviando..." : "Adicionar"}
      </button>
    </div>
  );
}

function createInitialState(produto?: Produto): ProdutoFormState {
  return {
    id_produto: produto?.id_produto.toString() ?? "",
    nomeReal: produto?.nomeReal ?? "",
    categoria: produto?.categoria ?? "Pulseiras",
    formato: produto?.formato ?? "",
    valorUnt: produto?.valorUnt.toString() ?? "0",
    valorFixo: produto?.valorFixo.toString() ?? "0",
    valor_custo: produto?.valor_custo.toString() ?? "0",
    cod_beneficio: produto?.cod_beneficio ?? "",
    ncm: produto?.ncm ?? "",
    descri_ncm: produto?.descri_ncm ?? "",
    cest: produto?.cest ?? "",
    origem: produto?.origem ?? "",
    cod_origem: produto?.cod_origem?.toString() ?? "",
    cod_bar: produto?.cod_bar ?? "",
    und_medida: produto?.und_medida ?? "",
    is_multiplo: produto?.is_multiplo ?? false,
    cfop_interno: produto?.cfop_interno ?? "",
    cfop_interestadual: produto?.cfop_interestadual ?? "",
    unidade_comercial: produto?.unidade_comercial ?? "",
    unidade_tributavel: produto?.unidade_tributavel ?? "",
    icms_origem: produto?.icms_origem ?? "",
    icms_situacao_tributaria: produto?.icms_situacao_tributaria ?? "",
    pis_situacao_tributaria: produto?.pis_situacao_tributaria ?? "",
    cofins_situacao_tributaria: produto?.cofins_situacao_tributaria ?? "",
    informacoes_fiscais: produto?.informacoes_fiscais ?? "",
    peso: produto?.peso.toString() ?? "0",
    prazo: produto?.prazo ?? "",
    nivelSeg: produto?.nivelSeg ?? "medio",
    fraseCons: produto?.fraseCons ?? "",
    descricao: produto?.descricao ?? "",
    personalizacao: produto?.personalizacao ?? "",
    apelidos: produto?.apelidos.join(", ") ?? "",
    ativo: produto?.ativo ?? true,
    is_estoque: produto?.is_estoque ?? false,
    is_variacao: produto?.is_variacao ?? false,
    id_formato: produto?.id_formato?.toString() ?? "",
    id_modelo_cor: produto?.id_modelo_cor?.toString() ?? "",
    quantidade_minima_venda: produto?.quantidade_minima_venda?.toString() ?? "",
    tipo_blocagem: produto?.tipo_blocagem ?? "",
    id_gabarito: produto?.id_gabarito?.toString() ?? "",
    setor_pcp: produto?.setor_pcp ?? "",
    fotos: produto?.fotos ?? [],
    variacoes: produto?.variacoes ?? []
  };
}
