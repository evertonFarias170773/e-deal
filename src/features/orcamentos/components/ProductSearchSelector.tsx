import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search, X, Package, Loader2 } from "lucide-react";
import type { Produto } from "@/features/produtos/types";
import type { PropostaItem } from "@/features/orcamentos/types";
import { formatCurrency } from "@/lib/formatters/currency";

type ProductSearchSelectorProps = {
  produtos: Produto[];
  loadingProdutos: boolean;
  onAddProduct: (productId: string) => void;
  itensAtuais: PropostaItem[];
};

const allowedCategories = [
  "Ingressos de segurança",
  "Pulseiras",
  "Cordão Credencial",
  "Cartão PVC",
  "Credencial"
];

const TAG_STYLES: Record<string, { active: string; inactive: string }> = {
  "Ingressos de segurança": {
    inactive: "border-indigo-100 bg-indigo-50/60 text-indigo-700 hover:bg-indigo-100/80 hover:border-indigo-200",
    active: "border-indigo-400 bg-indigo-100 text-indigo-900 shadow-sm ring-2 ring-indigo-200/50"
  },
  "Pulseiras": {
    inactive: "border-emerald-100 bg-emerald-50/60 text-emerald-700 hover:bg-emerald-100/80 hover:border-emerald-200",
    active: "border-emerald-400 bg-emerald-100 text-emerald-900 shadow-sm ring-2 ring-emerald-200/50"
  },
  "Cordão Credencial": {
    inactive: "border-amber-100 bg-amber-50/60 text-amber-700 hover:bg-amber-100/80 hover:border-amber-200",
    active: "border-amber-400 bg-amber-100 text-amber-900 shadow-sm ring-2 ring-amber-200/50"
  },
  "Cartão PVC": {
    inactive: "border-purple-100 bg-purple-50/60 text-purple-700 hover:bg-purple-100/80 hover:border-purple-200",
    active: "border-purple-400 bg-purple-100 text-purple-900 shadow-sm ring-2 ring-purple-200/50"
  },
  "Credencial": {
    inactive: "border-cyan-100 bg-cyan-50/60 text-cyan-700 hover:bg-cyan-100/80 hover:border-cyan-200",
    active: "border-cyan-400 bg-cyan-100 text-cyan-900 shadow-sm ring-2 ring-cyan-200/50"
  }
};

function getCorrectedCategoryNormalized(category?: string): string {
  if (!category) return "";
  const clean = (val: string) => val.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const cat = clean(category);
  if (cat === "vartao pvc" || cat === "cartao pvc") return "cartao pvc";
  if (cat === "ingressos de seguranca") return "ingressos de seguranca";
  if (cat === "pulseiras") return "pulseiras";
  if (cat === "cordao credencial") return "cordao credencial";
  if (cat === "credencial") return "credencial";
  return cat;
}

const inputClass =
  "w-full rounded-2xl border border-slate-200 bg-white pl-4 pr-10 py-3 text-sm text-slate-900 outline-none transition focus:border-[#0f9f9a] focus:ring-4 focus:ring-[#dff8f6]";

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function ProductSearchSelector({
  produtos,
  loadingProdutos,
  onAddProduct,
  itensAtuais
}: ProductSearchSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  // activePreset armazena o botão de filtro rápido selecionado, separado da busca textual.
  // "Credencial" usa regra exclusiva; demais presets operam via searchQuery normal.
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredProducts = useMemo(() => {
    // Preset exclusivo "Credencial":
    // filtra apenas produtos ativos cujo nomeReal começa com "credencial" (sem apelidos, sem categoria)
    if (activePreset === "Credencial" && !searchQuery) {
      return produtos.filter((p) => {
        if (!p.ativo) return false;
        return normalize(p.nomeReal).startsWith("credencial");
      });
    }

    // Busca textual ampla (digitada pelo usuário ou vinda de outro preset)
    const q = normalize(searchQuery).trim();
    if (!q) {
      return produtos.filter((p) => p.ativo);
    }

    return produtos.filter((p) => {
      if (!p.ativo) return false;
      const matchesName = normalize(p.nomeReal).includes(q);
      const matchesCode = p.id_produto.toString().includes(q);
      const matchesApelidos = (p.apelidos || []).some((a) => normalize(a).includes(q));
      const correctedCat = getCorrectedCategoryNormalized(p.categoria);
      const matchesCategory = correctedCat && (correctedCat.includes(q) || q.includes(correctedCat));
      return matchesName || matchesCode || matchesApelidos || matchesCategory;
    });
  }, [produtos, searchQuery, activePreset]);

  const handleSelectProduct = (product: Produto) => {
    // Produto repetido é permitido: quem decide entre atualizar a linha
    // existente ou criar outra é o formulário (modal de produto repetido).
    onAddProduct(product.id_produto.toString());
    setSearchQuery("");
    setActivePreset(null);
    setIsOpen(false);
  };

  const handleTagClick = (tagLabel: string) => {
    if (tagLabel === "Credencial") {
      // Preset com critério exclusivo: limpa o texto e ativa apenas o preset
      setSearchQuery("");
      setActivePreset("Credencial");
    } else {
      // Demais presets: comportamento original via busca textual
      setActivePreset(null);
      setSearchQuery(tagLabel);
    }
    setIsOpen(true);
  };

  const handleClearFilter = () => {
    setSearchQuery("");
    setActivePreset(null);
    setIsOpen(false);
  };

  const hasFilter = searchQuery !== "" || activePreset !== null;

  return (
    <div className="space-y-4" ref={containerRef}>
      {/* Category Tags */}
      <div className="flex flex-wrap gap-2">
        {allowedCategories.map((cat) => {
          let isTagActive = false;
          if (cat === "Credencial") {
            // Ativo apenas quando o preset exclusivo está selecionado
            isTagActive = activePreset === "Credencial";
          } else {
            const catNormalized = getCorrectedCategoryNormalized(cat);
            const queryNormalized = getCorrectedCategoryNormalized(searchQuery);
            isTagActive = queryNormalized === catNormalized && searchQuery !== "" && activePreset !== "Credencial";
          }

          const style = TAG_STYLES[cat] || {
            inactive: "border-[#d7e5e8] bg-white text-[#0b2f4a] hover:bg-[#f3f7f8] hover:border-slate-300",
            active: "border-teal-300 bg-teal-50 text-teal-800 shadow-sm ring-2 ring-teal-200/50"
          };

          return (
            <button
              key={cat}
              type="button"
              onClick={() => handleTagClick(cat)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-all duration-200 ${
                isTagActive ? style.active : style.inactive
              }`}
            >
              {cat}
            </button>
          );
        })}
        {hasFilter && (
          <button
            type="button"
            onClick={handleClearFilter}
            className="shrink-0 rounded-full border border-rose-200 bg-rose-50 text-rose-700 px-3.5 py-1.5 text-xs font-bold hover:bg-rose-100 transition"
          >
            Limpar Filtro
          </button>
        )}
      </div>

      {/* Search Input Box */}
      <div className="relative">
        <div className="relative flex items-center">
          <input
            type="text"
            placeholder={loadingProdutos ? "Carregando catálogo de produtos..." : "Pesquisar produto por nome, código ou apelido..."}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              // Digitar texto manualmente cancela qualquer preset ativo
              setActivePreset(null);
              setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            disabled={loadingProdutos}
            className={inputClass}
          />
          <div className="absolute right-4 flex items-center gap-1.5 text-slate-400">
            {loadingProdutos ? (
              <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
            ) : searchQuery ? (
              <button
                type="button"
                onClick={() => { setSearchQuery(""); setActivePreset(null); }}
                className="hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <Search className="h-4 w-4" />
            )}
          </div>
        </div>

        {/* Dropdown Menu */}
        {isOpen && !loadingProdutos && (
          <div className="absolute left-0 right-0 mt-2 z-50 max-h-80 overflow-y-auto rounded-2xl border border-slate-100 bg-white py-2 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            {filteredProducts.length > 0 ? (
              filteredProducts.map((p) => {
                const isSelected = itensAtuais.some((item) => item.id_produto === p.id_produto);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectProduct(p)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition flex justify-between items-center border-b border-slate-50 last:border-0 dark:border-slate-800"
                  >
                    <div className="pr-4 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-100 text-sm truncate">
                          {p.nomeReal}
                        </span>
                        {isSelected && (
                          <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                            Já adicionado
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 font-mono truncate mt-0.5">
                        Código: #{p.id_produto} {p.apelidos && p.apelidos.length > 0 ? `• Apelidos: ${p.apelidos.join(", ")}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs text-slate-400 block font-medium">Valor Unit.</span>
                      <strong className="text-sm text-[#0b2f4a] dark:text-teal-400 font-extrabold">
                        {formatCurrency(p.valorUnt)}
                      </strong>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-6 text-center text-slate-400 space-y-2">
                <Package className="h-8 w-8 mx-auto opacity-45" />
                <p className="text-sm">Nenhum produto correspondente encontrado.</p>
              </div>
            )}
          </div>
        )}

        {/* Empty Catalog Warning */}
        {isOpen && !loadingProdutos && produtos.length === 0 && (
          <div className="absolute left-0 right-0 mt-2 z-50 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-center text-rose-700">
            Nenhum produto cadastrado no catálogo do servidor.
          </div>
        )}
      </div>
    </div>
  );
}
