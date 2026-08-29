"use client";

import { useCallback, useEffect, useState } from "react";
import { FilePlus2, Loader2, Search, X, AlertTriangle } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import {
  criarRascunhoNfeAvulsa,
  resolverEnderecoPrincipal
} from "@/features/nfe/services/nfe.service";
import {
  searchCadastrosParaVinculo,
  type SearchCadastroVinculoItem
} from "@/features/cadastros/services/cadastros.service";

/**
 * Nota fiscal AVULSA: a que não nasce de proposta.
 *
 * Casos reais que ela atende: venda não registrada no sistema, remessa, venda de
 * bem do ativo imobilizado, remessa para industrialização por encomenda e
 * devolução de compra ao fornecedor.
 *
 * O modal decide só DUAS coisas — destinatário e empresa emitente. É o mínimo
 * que `criarRascunhoNfeAvulsa` precisa, e é o que não dá para adivinhar depois.
 * Natureza, itens, tributação e transporte se resolvem na tela da nota, com as
 * mesmas regras de qualquer outra.
 */

type EmpresaEmitente = {
  id: number;
  nome: string;
  cnpj: string;
};

/** O que se mostra do destinatário antes de confirmar. */
type FichaDestinatario = {
  documento: string;
  inscricaoEstadual: string;
  cidadeUf: string;
  /** UF do endereço PRINCIPAL — a que decide a natureza e o CFOP. */
  ufPrincipal: string | null;
};

type NovaNotaAvulsaModalProps = {
  onFechar: () => void;
  /** Chamado com o id da nota recém-criada, para a página navegar até ela. */
  onCriada: (idNota: string, ref: string) => void;
};

const soDigitos = (valor: string) => String(valor ?? "").replace(/\D/g, "");

function formatarDocumento(documento: string): string {
  const d = soDigitos(documento);
  if (d.length === 14) {
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return documento || "—";
}

/**
 * MONTADO SÓ QUANDO ABERTO — a página o renderiza sob condição, e não passa um
 * `aberto`. Assim o estado nasce limpo a cada abertura por construção, sem um
 * efeito de reset: reabrir não traz o destinatário da vez anterior já
 * escolhido, e nota fiscal não é lugar para herdar seleção por descuido.
 */
export function NovaNotaAvulsaModal({ onFechar, onCriada }: NovaNotaAvulsaModalProps) {
  const [empresas, setEmpresas] = useState<EmpresaEmitente[]>([]);
  const [idEmpresa, setIdEmpresa] = useState<number | null>(null);

  const [termo, setTermo] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<SearchCadastroVinculoItem[]>([]);
  const [buscaFeita, setBuscaFeita] = useState(false);

  const [escolhido, setEscolhido] = useState<SearchCadastroVinculoItem | null>(null);
  const [ficha, setFicha] = useState<FichaDestinatario | null>(null);
  const [carregandoFicha, setCarregandoFicha] = useState(false);

  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      const client = getSupabaseClient();
      if (!client) return;
      const { data } = await client
        .from("empresas")
        .select("id,empresa,razao_social,cnpj")
        .order("id", { ascending: true });

      if (cancelado) return;
      const linhas = (data ?? []) as Array<{
        id: number;
        empresa: string | null;
        razao_social: string | null;
        cnpj: string | null;
      }>;
      const lista = linhas.map((linha) => ({
        id: Number(linha.id),
        nome: String(linha.empresa || linha.razao_social || `Empresa #${linha.id}`).trim(),
        cnpj: String(linha.cnpj ?? "")
      }));
      setEmpresas(lista);
      // Não escolhe sozinho: emitente errado numa nota fiscal é cancelamento na
      // SEFAZ, não um campo que se corrige depois.
      if (lista.length === 1) setIdEmpresa(lista[0].id);
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  const buscar = useCallback(async () => {
    const termoLimpo = termo.trim();
    if (!termoLimpo) return;
    setBuscando(true);
    setErro(null);
    try {
      const achados = await searchCadastrosParaVinculo(termoLimpo);
      setResultados(achados);
      setBuscaFeita(true);
    } finally {
      setBuscando(false);
    }
  }, [termo]);

  /** Carrega o que o operador precisa CONFERIR antes de confirmar. */
  const escolher = useCallback(async (item: SearchCadastroVinculoItem) => {
    setEscolhido(item);
    setFicha(null);
    setErro(null);
    setCarregandoFicha(true);
    try {
      const client = getSupabaseClient();
      if (!client) return;

      const [{ data: cadastro }, endereco] = await Promise.all([
        client
          .from("clientes")
          .select("documento,ins_estadual,inscricao_estadual,cidade_uf")
          .eq("id_cliente", item.idCliente)
          .maybeSingle(),
        // A UF do endereço PRINCIPAL é a que decide a natureza e o CFOP. Mostrar
        // aqui adianta o erro de "sem endereço principal" para antes do clique.
        resolverEnderecoPrincipal(item.idCliente)
      ]);

      const linha = cadastro as {
        documento?: string | null;
        ins_estadual?: string | null;
        inscricao_estadual?: string | null;
        cidade_uf?: string | null;
      } | null;

      setFicha({
        documento: String(linha?.documento ?? item.documento ?? ""),
        inscricaoEstadual: String(linha?.ins_estadual || linha?.inscricao_estadual || "ISENTO"),
        cidadeUf: String(linha?.cidade_uf ?? ""),
        ufPrincipal: endereco?.uf ?? null
      });
    } finally {
      setCarregandoFicha(false);
    }
  }, []);

  async function confirmar() {
    if (!escolhido || !idEmpresa) return;
    setCriando(true);
    setErro(null);
    try {
      const resultado = await criarRascunhoNfeAvulsa({
        idCliente: escolhido.idCliente,
        idEmpresa
      });

      if (!resultado.success) {
        // O serviço devolve erro como VALOR, com a mensagem que aponta onde se
        // corrige. Mostrar na íntegra: engolir aqui deixaria o operador sem
        // saber que falta endereço principal ou UF da empresa.
        setErro(resultado.error);
        return;
      }

      onCriada(resultado.id, resultado.ref);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Erro ao criar a nota avulsa.");
    } finally {
      setCriando(false);
    }
  }

  const podeConfirmar = Boolean(escolhido && idEmpresa) && !criando;

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-2xl w-full overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 pt-6 pb-4 flex items-start gap-3 border-b border-slate-100">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl shrink-0">
            <FilePlus2 className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-slate-900 leading-tight">Nova nota avulsa</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              NF-e que não nasce de pedido. Os itens são lançados depois, na própria nota.
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={criando}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6 overflow-y-auto">
          {/* 1. Empresa emitente */}
          <div className="space-y-1.5">
            <label
              htmlFor="avulsa-empresa"
              className="block text-xs font-semibold text-slate-500 uppercase tracking-wider"
            >
              Empresa emitente
            </label>
            <select
              id="avulsa-empresa"
              value={idEmpresa ?? ""}
              disabled={criando}
              onChange={(e) => setIdEmpresa(e.target.value ? Number(e.target.value) : null)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] disabled:bg-slate-50"
            >
              <option value="">Selecionar empresa...</option>
              {empresas.map((empresa) => (
                <option key={empresa.id} value={empresa.id}>
                  {empresa.nome}
                  {empresa.cnpj ? ` — ${formatarDocumento(empresa.cnpj)}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* 2. Destinatário */}
          <div className="space-y-1.5">
            <label
              htmlFor="avulsa-busca"
              className="block text-xs font-semibold text-slate-500 uppercase tracking-wider"
            >
              Destinatário
            </label>
            <div className="flex gap-2">
              <input
                id="avulsa-busca"
                type="text"
                value={termo}
                disabled={criando}
                placeholder="Código, nome, fantasia ou CNPJ..."
                onChange={(e) => setTermo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void buscar();
                  }
                }}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm bg-white outline-none focus:border-[#0b2f4a] disabled:bg-slate-50"
              />
              <button
                type="button"
                onClick={() => void buscar()}
                disabled={buscando || criando || !termo.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#0b2f4a] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0a2740] disabled:bg-slate-200 disabled:text-slate-400"
              >
                {buscando ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Buscar
              </button>
            </div>

            {buscaFeita && resultados.length === 0 && !buscando ? (
              <p className="text-xs text-slate-500 pt-1">
                Nenhum cadastro encontrado para{" "}
                <strong className="text-slate-700">{termo.trim()}</strong>.
              </p>
            ) : null}

            {resultados.length > 0 ? (
              <div className="mt-2 rounded-2xl border border-slate-200 divide-y divide-slate-100 max-h-60 overflow-y-auto">
                {resultados.map((item) => {
                  const selecionado = escolhido?.idCliente === item.idCliente;
                  return (
                    <button
                      key={item.idCliente}
                      type="button"
                      onClick={() => void escolher(item)}
                      disabled={criando}
                      className={`w-full text-left px-4 py-3 transition ${
                        selecionado ? "bg-blue-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-400 shrink-0">
                          #{item.idCliente}
                        </span>
                        <span className="text-sm font-semibold text-slate-800 leading-tight">
                          {item.nome || "(sem nome)"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {item.fantasia ? `${item.fantasia} • ` : ""}
                        {formatarDocumento(item.documento)}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {/* 3. Conferência do cadastro escolhido */}
          {escolhido ? (
            <div className="rounded-2xl border border-[#d7e5e8] bg-slate-50/60 p-5 space-y-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Dados fiscais do destinatário
              </h4>

              {carregandoFicha ? (
                <p className="text-xs text-slate-500 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando cadastro...
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                  <Campo rotulo="Nome / Razão social" valor={escolhido.nome} />
                  <Campo rotulo="Fantasia" valor={escolhido.fantasia} />
                  <Campo rotulo="CPF / CNPJ" valor={formatarDocumento(ficha?.documento ?? "")} mono />
                  <Campo rotulo="Inscrição estadual" valor={ficha?.inscricaoEstadual ?? ""} mono />
                  <Campo rotulo="Cidade / UF" valor={ficha?.cidadeUf ?? ""} />
                  <Campo
                    rotulo="UF do endereço principal"
                    valor={ficha?.ufPrincipal ?? ""}
                    mono
                    alerta={!ficha?.ufPrincipal}
                  />
                </div>
              )}

              {!carregandoFicha && !ficha?.ufPrincipal ? (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-relaxed">
                  Este cadastro não tem endereço principal com UF. É dele que saem a natureza da
                  operação e o CFOP — corrija o cadastro antes de criar a nota.
                </p>
              ) : null}
            </div>
          ) : null}

          {erro ? (
            <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
              <p className="text-sm text-red-800 leading-relaxed">{erro}</p>
            </div>
          ) : null}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            A nota nasce em rascunho, sem itens e sem cobrança.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onFechar}
              disabled={criando}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-white disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={!podeConfirmar}
              className="inline-flex items-center gap-2 rounded-xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#0a2740] disabled:bg-slate-200 disabled:text-slate-400"
            >
              {criando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
              {criando ? "Criando..." : "Criar rascunho"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Campo({
  rotulo,
  valor,
  mono,
  alerta
}: {
  rotulo: string;
  valor: string;
  mono?: boolean;
  alerta?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{rotulo}</p>
      <p
        className={`text-sm mt-0.5 ${mono ? "font-mono" : "font-medium"} ${
          alerta ? "text-amber-700 font-bold" : "text-slate-800"
        }`}
      >
        {valor?.trim() || "—"}
      </p>
    </div>
  );
}
