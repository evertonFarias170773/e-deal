import type { Cadastro, CadastroEndereco } from "@/features/cadastros/types";
import type { Produto } from "@/features/produtos/types";
import type {
  Proposta,
  PropostaFrete,
  PropostaItem,
  PropostaResumo,
  TipoDescontoProposta,
  PropostaVariacaoEscolhida
} from "@/features/orcamentos/types";

export function getCobrancaLabel(status: Proposta["cobrancaStatus"]) {
  const labels = {
    NAO_GERADA: "Nao gerada",
    PENDENTE: "Pendente",
    GERADA: "Gerada",
    PAGA: "Paga",
    CANCELADA: "Cancelada"
  };

  return labels[status];
}

export function sortEnderecosPorPrioridade(enderecos: CadastroEndereco[]): CadastroEndereco[] {
  return [...enderecos].sort((a, b) => {
    const getPriority = (addr: CadastroEndereco) => {
      const t = ((addr as any).tipo_endereco ?? addr.tipo ?? "").trim().toLowerCase();
      if (t === "principal") return 1;
      if (t === "entrega") return 2;
      return 3;
    };
    const pA = getPriority(a);
    const pB = getPriority(b);
    if (pA !== pB) return pA - pB;
    const dateA = new Date((a as any).data_criacao || 0).getTime();
    const dateB = new Date((b as any).data_criacao || 0).getTime();
    return dateB - dateA;
  });
}

/**
 * Rótulo legível do tipo do endereço — "Principal", "Entrega", "Cobrança"...
 *
 * A leitura é tolerante de propósito. O tipo chega em duas chaves e em três
 * grafias: o banco guarda `tipo_endereco` em caixa alta (`PRINCIPAL`, vindo da
 * importação da Receita Federal) ou capitalizado (`Principal`, base antiga), e
 * o mapeamento para `CadastroEndereco` expõe `tipo` em minúscula. Comparar sem
 * normalizar erra em duas das três. É a mesma normalização que
 * `sortEnderecosPorPrioridade` faz logo acima; deixei as duas separadas porque
 * unificá-las mexeria na ordenação, que não é assunto desta mudança.
 *
 * Devolve null quando o tipo vem vazio, e aí a tela não mostra rótulo nenhum —
 * melhor calar do que inventar "Principal" para um endereço que talvez não
 * seja. Na prática isso quase não acontece: os dois mapeamentos que alimentam a
 * tela (`mapSupabaseEnderecoRowToCadastroEndereco` e a resolução do endereço da
 * proposta em orcamentos.service) já preenchem `tipo` com um padrão quando a
 * coluna está em branco. O caso vazio fica coberto para as leituras que chegam
 * com a linha crua do banco.
 */
export function rotuloTipoEndereco(endereco: CadastroEndereco): string | null {
  const tipo = ((endereco as { tipo_endereco?: string }).tipo_endereco ?? endereco.tipo ?? "")
    .trim()
    .toLowerCase();
  if (!tipo) return null;
  if (tipo === "principal") return "Principal";
  if (tipo === "entrega") return "Entrega";
  if (tipo === "cobranca" || tipo === "cobrança") return "Cobrança";
  if (tipo === "fiscal") return "Fiscal";
  return tipo.charAt(0).toUpperCase() + tipo.slice(1);
}

export type DestinoDoResumo = {
  /** "Porto Alegre/RS". Pode vir vazio se o cadastro não tiver cidade nem UF. */
  cidadeUf: string;
  /** "90620-130". Vazio quando o endereço não tem CEP. */
  cep: string;
  /** "Principal", "Entrega"... Null em orçamento rápido, onde não há cadastro. */
  rotulo: string | null;
};

/**
 * O destino que o resumo do orçamento mostra, em forma compacta.
 *
 * Cidade, UF e CEP bastam para o usuário reconhecer por onde o frete está sendo
 * cotado sem voltar à aba Geral; o logradouro completo continua lá.
 *
 * Devolve NULL para "ainda não há endereço" — e só para isso. Um endereço
 * escolhido com cadastro incompleto devolve objeto com campos vazios, porque
 * "escolhi um endereço capenga" e "não escolhi endereço" são problemas
 * diferentes e pedem avisos diferentes.
 *
 * Em orçamento rápido não existe cadastro: o destino sai dos campos livres e
 * vem sem rótulo, já que não há tipo de endereço para nomear.
 */
export function resumirEnderecoDoOrcamento(params: {
  clienteNaoCadastrado?: boolean;
  endereco?: CadastroEndereco;
  cepLivre?: string;
  cidadeLivre?: string;
  ufLivre?: string;
}): DestinoDoResumo | null {
  const montarCidadeUf = (cidade?: string, uf?: string) => {
    const c = (cidade ?? "").trim();
    const u = (uf ?? "").trim().toUpperCase();
    if (c && u) return `${c}/${u}`;
    return c || u;
  };

  // "90620130" -> "90620-130". O que não tem 8 dígitos sai como veio: cadastro
  // antigo às vezes já guarda com traço, e mascarar por cima duplicaria.
  const formatarCep = (bruto?: string) => {
    const cep = (bruto ?? "").trim();
    const digitos = cep.replace(/\D/g, "");
    return digitos.length === 8 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : cep;
  };

  if (params.clienteNaoCadastrado) {
    const cidadeUf = montarCidadeUf(params.cidadeLivre, params.ufLivre);
    const cep = formatarCep(params.cepLivre);
    if (!cidadeUf && !cep) return null;
    return { cidadeUf, cep, rotulo: null };
  }

  if (!params.endereco) return null;

  return {
    cidadeUf: montarCidadeUf(params.endereco.cidade, params.endereco.uf),
    cep: formatarCep(params.endereco.cep),
    rotulo: rotuloTipoEndereco(params.endereco)
  };
}

export function buildPropostaInformalText({
  id_int,
  clienteNome,
  itens,
  frete,
  resumo,
  formaPagamento,
  isAvulso = false,
  contatoNome,
  cidade,
  uf,
  bonusPercent = 0
}: {
  id_int: number | string;
  clienteNome: string;
  itens: PropostaItem[];
  frete?: PropostaFrete;
  resumo: PropostaResumo;
  formaPagamento: string;
  isAvulso?: boolean;
  contatoNome?: string;
  cidade?: string;
  uf?: string;
  bonusPercent?: number;
}) {
  const contactName = contatoNome || clienteNome || "cliente";

  let itemsText = "";
  if (isAvulso) {
    itemsText = `✅ *Orçamento Avulso*: *${formatPlainCurrency(resumo.subtotalProdutos)}*`;
  } else {
    itemsText = itens
      .filter((item) => item.statusItem !== "CANCELADO")
      .map((item) => {
        return `✅ *${item.quantidade.toLocaleString("pt-BR")}* ${item.nome}: *${formatPlainCurrency(item.subtotal)}* (${item.prazo})`;
      })
      .join("\n");
  }

  let freteMsg = "";
  const isRetirada = frete && (frete.transportadora === "Retirada Local" || frete.id === "frete_retira_balcao");
  const freteEscolhido = frete && frete.transportadora && frete.transportadora !== "Frete nao definido" && !isRetirada;
  if (freteEscolhido) {
    const transportadoraLower = frete.transportadora.toLowerCase();
    const servicoLower = frete.servico?.toLowerCase() ?? "";
    const isDuplicate = servicoLower && (transportadoraLower.includes(servicoLower) || servicoLower.includes(transportadoraLower));
    const servicoText = (frete.servico && !isDuplicate) ? ` (${frete.servico})` : "";
    
    freteMsg = `Frete via *${frete.transportadora}${servicoText}: ${formatPlainCurrency(frete.valor)}*`;
  } else if (isRetirada) {
    freteMsg = `Frete via *Retirada Local: Grátis*`;
  } else {
    freteMsg = "Como ainda não definimos o frete, me avisa se precisa que eu verifique o valor para o seu endereço?";
  }

  const lines = [
    `Olá, 😀`,
    ``,
    `Orçamento para:`,
    `*${contactName}*`,
    ``,
    `📄 Proposta *${id_int}*`,
    ``,
    `*Segue orçamento para os itens solicitados.*`,
    (bonusPercent > 0) ? `Consegui aplicar uma condição especial para você!` : null,
    ``,
    `*Produtos Orçados:*`,
    ``,
    itemsText || "✅ Nenhum produto adicionado",
    ``,
    (bonusPercent > 0) ? `Subtotal bruto ${formatPlainCurrency(resumo.subtotalBrutoProdutos)}` : null,
    (bonusPercent > 0) ? `` : null,
    (bonusPercent > 0) ? `Tabela especial do cliente aplicada (-${bonusPercent}%)  -${formatPlainCurrency(resumo.acrescimoBonus)}` : null,
    (bonusPercent > 0) ? `` : null,
    freteMsg,
    (cidade && uf && freteEscolhido) ? `Cidade: *${cidade} - ${uf}*` : null,
    ``,
    `O valor total do pedido ficou em *${formatPlainCurrency(resumo.valorTotal)}*`,
    ``,
    `Se estiver tudo certo, me confirma por aqui que já dou andamento ao processo!`
  ];

  return lines.filter(line => line !== null && line !== undefined).join("\n");
}

function formatPlainCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function firstVariationChoices(produto: Produto): PropostaVariacaoEscolhida[] {
  return produto.variacoes
    .filter((variacao) => variacao.tipos.length > 0)
    .slice(0, 2)
    .map((variacao) => ({
      id: `escolha_${produto.id_produto}_${variacao.id_variacao}`,
      id_variacao: variacao.id_variacao,
      variacao: variacao.variacao,
      tipo: variacao.tipos[0]
    }));
}

export function getClienteVendedorPadrao(cliente: Cadastro) {
  return cliente.vendedor_padrao ?? cliente.vendedor;
}

export function getClienteBonusPercent(cliente: Cadastro | null | undefined): number {
  if (!cliente) {
    return 0;
  }
  
  if (cliente.usaPrecoFixo) {
    return 0; // Bônus é ignorado se usaPrecoFixo for true
  }

  return cliente.is_bonus || cliente.bonusAtivo ? cliente.percentualBonus ?? 0 : 0;
}

export function calculateDiscountValue(base: number, tipo: TipoDescontoProposta, valor: number) {
  if (tipo === "PERCENTUAL") {
    return Math.max(0, base * (valor / 100));
  }

  return Math.max(0, valor);
}

export function calculateItemSubtotal(
  item: Pick<PropostaItem, "quantidade" | "valorUnitario" | "valorFixo" | "variacoesEscolhidas">,
  bonusPercent = 0
) {
  const variationExtra = (item.variacoesEscolhidas || []).reduce((total, escolha) => total + (escolha.tipo?.v_extra || 0), 0);
  const valorUnitarioTotal = item.valorUnitario + variationExtra;

  const subtotalBruto = item.quantidade * valorUnitarioTotal + item.valorFixo;
  const acrescimoBonus = subtotalBruto * (bonusPercent / 100);

  return {
    subtotalBruto,
    acrescimoBonus,
    subtotal: Math.max(0, subtotalBruto - acrescimoBonus)
  };
}

export function calculateItemWeight(item: Pick<PropostaItem, "quantidade" | "pesoUnitario" | "variacoesEscolhidas">) {
  const variationWeight = item.variacoesEscolhidas.reduce((total, escolha) => total + escolha.tipo.peso * item.quantidade, 0);
  return item.quantidade * item.pesoUnitario + variationWeight;
}

/**
 * Remove o prefixo numérico de ordenação gravado no nome da variação
 * ("1 TAMANHO" → "TAMANHO"). É código interno, sem utilidade na tela.
 *
 * Exige um separador depois do número justamente para não mutilar nomes que
 * começam com dígito de forma legítima ("3D TEXTURIZADO" continua inteiro).
 * O backfill em supabase/migrations/20260809_pedidos_modelos_variacoes_texto.sql
 * usa o equivalente POSIX desta regex — mudar aqui exige mudar lá.
 */
export function limparNomeVariacao(nome: string): string {
  return nome.replace(/^\s*\d+[\s.\-)]+/, "").trim();
}

/**
 * Texto consolidado das variações de UM item da proposta, na ordem salva.
 * Ex.: "TAMANHO: 120 cm • ACABAMENTO: Mosquete Metal Ponta Dupla".
 *
 * Fonte única do formato: alimenta tanto o card da aba Pedidos quanto o valor
 * persistido em pedidos_modelos.variacoes_texto. Item sem variação → "".
 */
export function formatVariacoesItem(
  item: Pick<PropostaItem, "variacoesEscolhidas">
): string {
  return (item.variacoesEscolhidas || [])
    .map((escolha) => {
      const nomeBruto = escolha.variacao?.nome?.trim() || "";
      const nome = limparNomeVariacao(nomeBruto) || nomeBruto || "Variação";
      const valor = escolha.tipo?.variacao?.trim() || "-";
      return `${nome}: ${valor}`;
    })
    .join(" • ");
}

/**
 * ID temporário único de item da proposta.
 *
 * A proposta aceita o mesmo id_produto em mais de uma linha (variações/
 * configurações diferentes), e o id é usado como chave de render e como
 * vínculo com os modelos do pedido (item_temp_id). Só o timestamp colidiria
 * ao duplicar itens no mesmo milissegundo — daí o sufixo aleatório.
 */
export function novoItemId(idProduto: number): string {
  const sufixo = Math.random().toString(36).slice(2, 8);
  return `item_${idProduto}_${Date.now()}_${sufixo}`;
}

/**
 * ID temporário único de modelo do pedido (pedidos_modelos ainda não gravado).
 *
 * Mesma razão do novoItemId: é a chave que identifica o modelo no estado do
 * formulário enquanto ele não tem id do banco, e duplicar um modelo várias
 * vezes seguidas colidiria se dependesse só do timestamp — duas linhas com o
 * mesmo tempId passam a ser editadas juntas. O prefixo "new_" é preservado
 * por compatibilidade com os registros em memória do fluxo antigo.
 */
export function novoModeloTempId(): string {
  const sufixo = Math.random().toString(36).slice(2, 8);
  return `new_${Date.now()}_${sufixo}`;
}

/**
 * Status inicial de arte/produção de um modelo recém-criado.
 *
 * É o default da própria coluna em public.pedidos_modelos ('PENDENTE'::text),
 * e é o valor que o restante do sistema usa ao criar modelos
 * (pedidos-detalhe.service, boletim-propostas.service). Existe aqui para que
 * os dois caminhos de criação — criarModelo() e saveProposta() — não produzam
 * estados iniciais divergentes.
 */
export const STATUS_INICIAL_MODELO = "PENDENTE";

// ─── Produto de prateleira ───────────────────────────────────────────────────

/**
 * Produto de prateleira: vendido pronto, dispensa o fluxo de arte.
 *
 * A flag mora em `produtos.is_estoque` — coluna que já existia e estava
 * dormente, reaproveitada em 10/08/2026 em vez de criar um segundo campo com
 * significado parecido. Este helper é o ÚNICO ponto do frontend que sabe disso;
 * o resto do código pergunta "é de prateleira?", não "is_estoque".
 */
export function isProdutoPrateleira(produto?: Pick<Produto, "is_estoque"> | null): boolean {
  return produto?.is_estoque === true;
}

/** Prateleira do item: o snapshot da proposta manda; sem ele, o cadastro atual. */
export function isItemPrateleira(item: Pick<PropostaItem, "isEstoque" | "produto">): boolean {
  if (typeof item.isEstoque === "boolean") return item.isEstoque;
  return isProdutoPrateleira(item.produto);
}

/**
 * Arte dispensada: a proposta tem pelo menos um item ativo e TODOS são de
 * prateleira. Proposta sem itens, ou com um único item normal, nunca dispensa —
 * o padrão seguro é exigir arte.
 *
 * Mesma definição usada na engine de status e em check_and_promote_proposta
 * (banco). Itens cancelados não entram na conta.
 */
export function propostaDispensaArte(
  itens: Pick<PropostaItem, "isEstoque" | "produto" | "statusItem">[]
): boolean {
  const ativos = itens.filter((i) => (i.statusItem || "PENDENTE").toUpperCase() !== "CANCELADO");
  return ativos.length > 0 && ativos.every(isItemPrateleira);
}

export function createItemFromProduto(
  produto: Produto, 
  quantidade = 1000, 
  bonusPercent = 0, 
  autoSelectVariations = true,
  precoFixoBase?: number
): PropostaItem {
  const variacoesEscolhidas = autoSelectVariations ? firstVariationChoices(produto) : [];
  
  const precoBaseReal = precoFixoBase !== undefined ? precoFixoBase : produto.valorUnt;

  const baseItem = {
    id: novoItemId(produto.id_produto),
    id_produto: produto.id_produto,
    produto,
    nome: produto.nomeReal,
    formato: produto.formato,
    descricaoModelo: produto.descricao,
    quantidade,
    valorUnitario: precoBaseReal,
    valorFixo: precoFixoBase !== undefined ? 0 : produto.valorFixo,
    prazo: produto.prazo,
    pesoUnitario: produto.peso,
    variacoesEscolhidas,
    // Snapshot da decisão de prateleira no momento em que o item entra na
    // proposta — o save leva este valor para produtos_proposta.is_estoque.
    isEstoque: isProdutoPrateleira(produto)
  };
  const totals = calculateItemSubtotal(baseItem, bonusPercent);

  return {
    ...baseItem,
    ...totals,
    pesoTotal: calculateItemWeight(baseItem)
  };
}

// Simulação temporária visual para cotação de fretes caso as transportadoras não estejam disponíveis
export function createFretesMock(endereco?: CadastroEndereco, id_int = 0, pesoUsado = 0): PropostaFrete[] {
  const destino = endereco ? `${endereco.cidade}/${endereco.uf}` : "destino nao definido";

  const mocks: PropostaFrete[] = [
    {
      id: "frete_sedex",
      id_int,
      transportadora: "Correios",
      servico: "Sedex",
      valor: 68.9,
      prazo: "2 dias uteis",
      observacao: `Entrega expressa para ${destino}.`,
      escolhido: true,
      pesoUsado
    },
    {
      id: "frete_azul",
      id_int,
      transportadora: "Azul Cargo",
      servico: "Aereo economico",
      valor: 94.5,
      prazo: "1 a 2 dias uteis",
      observacao: "Boa opcao para materiais urgentes.",
      escolhido: false,
      pesoUsado
    },
    {
      id: "frete_sao_miguel",
      id_int,
      transportadora: "Expresso Sao Miguel",
      servico: "Rodoviario",
      valor: 52.7,
      prazo: "3 dias uteis",
      observacao: "Custo competitivo para regiao Sul.",
      escolhido: false,
      pesoUsado
    },
    {
      id: "frete_unesul",
      id_int,
      transportadora: "Unesul",
      servico: "Encomenda",
      valor: 47.2,
      prazo: "4 dias uteis",
      observacao: "Opcao economica.",
      escolhido: false,
      pesoUsado
    }
  ];

  if (endereco?.uf?.toUpperCase() === "RS") {
    mocks.push({
      id: "frete_retira_balcao",
      id_int,
      transportadora: "Retirada Local",
      servico: "Sem custo",
      valor: 0.00,
      prazo: "Imediato",
      observacao: "Retirar pessoalmente no balcão da empresa",
      escolhido: false,
      pesoUsado
    });
  }

  return mocks;
}

export function calculateResumo(
  itens: PropostaItem[],
  fretes: PropostaFrete[],
  descontoGeralValor = 0,
  descontoGeralTipo: TipoDescontoProposta = "VALOR"
): PropostaResumo {
  const activeItens = itens.filter(item => item.statusItem !== "CANCELADO");

  const subtotalBrutoProdutos = activeItens.reduce((total, item) => total + item.subtotalBruto, 0);
  const acrescimoBonus = activeItens.reduce((total, item) => total + item.acrescimoBonus, 0);
  const subtotalProdutos = activeItens.reduce((total, item) => total + item.subtotal, 0);
  const descontoGeral = Math.min(subtotalProdutos, calculateDiscountValue(subtotalProdutos, descontoGeralTipo, descontoGeralValor));
  const freteEscolhido = fretes.find((frete) => frete.escolhido);
  const frete = freteEscolhido?.valor ?? 0;
  const pesoTotal = activeItens.reduce((total, item) => total + item.pesoTotal, 0);
  const prazoProducao = activeItens[0]?.prazo ?? "Nao definido";
  const prazoEntrega = freteEscolhido?.prazo ?? "Nao definido";

  return {
    subtotalProdutos,
    subtotalBrutoProdutos,
    acrescimoBonus,
    descontoGeralTipo,
    descontoGeralValor,
    descontoGeral,
    frete,
    valorTotal: Math.max(0, subtotalProdutos - descontoGeral + frete),
    pesoTotal,
    prazoProducao,
    prazoEntrega
  };
}
