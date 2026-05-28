import type { Produto, ProdutoCategoria, ProdutoFoto } from "@/features/produtos/types";
import { getProdutoVariacoesByProduto } from "@/lib/mocks/variacoes.mock";

export const produtoCategoriasMock: ProdutoCategoria[] = ["Pulseiras", "Ingressos", "Cartoes", "Credenciais"];

export const fotosProdutosMock: ProdutoFoto[] = [
  {
    id: "foto_101_1",
    idProduto: 101,
    nomeProduto: "Pulseira Triband",
    imagensURL: "https://placehold.co/900x600/dff8f6/0b7774?text=Pulseira+Triband",
    principal: true
  },
  {
    id: "foto_101_2",
    idProduto: 101,
    nomeProduto: "Pulseira Triband",
    imagensURL: "https://placehold.co/900x600/f7fbfb/0b2f4a?text=Triband+Personalizada"
  },
  {
    id: "foto_102_1",
    idProduto: 102,
    nomeProduto: "Pulseira ColorBand",
    imagensURL: "https://placehold.co/900x600/e0f2fe/0369a1?text=Pulseira+ColorBand",
    principal: true
  },
  {
    id: "foto_301_1",
    idProduto: 301,
    nomeProduto: "Pulseira TexBand",
    imagensURL: "https://placehold.co/900x600/fef3c7/92400e?text=Pulseira+TexBand",
    principal: true
  },
  {
    id: "foto_401_1",
    idProduto: 401,
    nomeProduto: "Ingresso MOBI",
    imagensURL: "https://placehold.co/900x600/fce7f3/be185d?text=Ingresso+MOBI",
    principal: true
  },
  {
    id: "foto_402_1",
    idProduto: 402,
    nomeProduto: "Ingresso UP BOX",
    imagensURL: "https://placehold.co/900x600/ede9fe/6d28d9?text=Ingresso+UP+BOX",
    principal: true
  },
  {
    id: "foto_801_1",
    idProduto: 801,
    nomeProduto: "Cartao PVC 0,76mm",
    imagensURL: "https://placehold.co/900x600/ecfeff/0e7490?text=Cartao+PVC+0,76mm",
    principal: true
  },
  {
    id: "foto_901_1",
    idProduto: 901,
    nomeProduto: "Credencial PVC",
    imagensURL: "https://placehold.co/900x600/f1f5f9/334155?text=Credencial+PVC",
    principal: true
  }
];

type ProdutoMockBase = Omit<
  Produto,
  | "created_at"
  | "is_multiplo"
  | "cod_beneficio"
  | "ncm"
  | "descri_ncm"
  | "cest"
  | "origem"
  | "cod_origem"
  | "cod_bar"
  | "und_medida"
  | "cfop_interno"
  | "cfop_interestadual"
  | "unidade_comercial"
  | "unidade_tributavel"
  | "icms_origem"
  | "icms_situacao_tributaria"
  | "pis_situacao_tributaria"
  | "cofins_situacao_tributaria"
  | "informacoes_fiscais"
  | "fotos"
  | "variacoes"
>;

const baseProdutos: ProdutoMockBase[] = [
  {
    id: "prod_101",
    id_produto: 101,
    nomeReal: "Pulseira Triband",
    categoria: "Pulseiras",
    formato: "25x2cm",
    valorUnt: 0.42,
    valorFixo: 80,
    valor_custo: 0.19,
    peso: 4,
    prazo: "3 dias uteis",
    nivelSeg: "medio",
    fraseCons: "Indicada para eventos com controle visual e boa durabilidade.",
    descricao: "Pulseira personalizada para eventos, com impressao colorida e fechamento seguro.",
    personalizacao: "Arte colorida, numeracao, QR Code e dados variaveis.",
    apelidos: ["triband", "pulseira tri band", "pulseirinha", "pulseira evento"],
    ativo: true,
    is_estoque: false,
    is_variacao: true
  },
  {
    id: "prod_102",
    id_produto: 102,
    nomeReal: "Pulseira ColorBand",
    categoria: "Pulseiras",
    formato: "24x1,5cm",
    valorUnt: 0.36,
    valorFixo: 70,
    valor_custo: 0.16,
    peso: 3,
    prazo: "2 dias uteis",
    nivelSeg: "controle visual",
    fraseCons: "Boa escolha para eventos rapidos com separacao por cores.",
    descricao: "Pulseira colorida de controle para identificacao simples de publico.",
    personalizacao: "Cores por lote, logotipo e texto curto.",
    apelidos: ["colorband", "pulseira colorida", "pulseira color"],
    ativo: true,
    is_estoque: true,
    is_variacao: true
  },
  {
    id: "prod_301",
    id_produto: 301,
    nomeReal: "Pulseira TexBand",
    categoria: "Pulseiras",
    formato: "Tecido 35x1,5cm",
    valorUnt: 1.65,
    valorFixo: 140,
    valor_custo: 0.84,
    peso: 7,
    prazo: "5 dias uteis",
    nivelSeg: "alto",
    fraseCons: "Melhor opcao para eventos premium ou uso prolongado.",
    descricao: "Pulseira de tecido personalizada com acabamento confortavel e alta resistencia.",
    personalizacao: "Sublimacao, etiqueta, fechamento plastico ou metalico.",
    apelidos: ["texband", "pulseira tecido", "pulseira premium", "pulseira show"],
    ativo: true,
    is_estoque: false,
    is_variacao: true
  },
  {
    id: "prod_401",
    id_produto: 401,
    nomeReal: "Ingresso MOBI",
    categoria: "Ingressos",
    formato: "10x15cm",
    valorUnt: 0.28,
    valorFixo: 60,
    valor_custo: 0.11,
    peso: 6,
    prazo: "1 dia util",
    nivelSeg: "medio",
    fraseCons: "Serve para ingressos simples com numeracao e controle basico.",
    descricao: "Ingresso impresso para eventos, com numeracao e possibilidade de QR Code.",
    personalizacao: "Arte frente, numeracao, lote e QR Code.",
    apelidos: ["mobi", "ingresso mobi", "ticket mobi", "ingresso"],
    ativo: true,
    is_estoque: false,
    is_variacao: true
  },
  {
    id: "prod_402",
    id_produto: 402,
    nomeReal: "Ingresso UP BOX",
    categoria: "Ingressos",
    formato: "7x20cm",
    valorUnt: 0.48,
    valorFixo: 95,
    valor_custo: 0.2,
    peso: 8,
    prazo: "2 dias uteis",
    nivelSeg: "antifraude",
    fraseCons: "Indicado para eventos que precisam de acabamento e controle superior.",
    descricao: "Ingresso com formato alongado, areas destacaveis e recursos visuais de seguranca.",
    personalizacao: "Picote, numeracao, QR Code, lote e acabamento especial.",
    apelidos: ["up box", "ingresso upbox", "ticket premium", "ingresso antifraude"],
    ativo: true,
    is_estoque: false,
    is_variacao: true
  },
  {
    id: "prod_801",
    id_produto: 801,
    nomeReal: "Cartao PVC 0,76mm",
    categoria: "Cartoes",
    formato: "PVC 0,76mm",
    valorUnt: 3.9,
    valorFixo: 120,
    valor_custo: 1.75,
    peso: 6,
    prazo: "4 dias uteis",
    nivelSeg: "alto",
    fraseCons: "Ideal para identificacao duravel, carteirinhas e cartoes de acesso.",
    descricao: "Cartao PVC rigido com impressao colorida e acabamento profissional.",
    personalizacao: "Frente e verso, dados variaveis, foto, QR Code e codigo de barras.",
    apelidos: ["cartao pvc", "pvc 076", "carteirinha pvc", "cracha pvc"],
    ativo: true,
    is_estoque: true,
    is_variacao: true
  },
  {
    id: "prod_901",
    id_produto: 901,
    nomeReal: "Credencial PVC",
    categoria: "Credenciais",
    formato: "A6 PVC",
    valorUnt: 4.8,
    valorFixo: 150,
    valor_custo: 2.1,
    peso: 18,
    prazo: "5 dias uteis",
    nivelSeg: "alto",
    fraseCons: "Boa para equipes, backstage, feiras e controle visual de acesso.",
    descricao: "Credencial em PVC para identificacao profissional com alta durabilidade.",
    personalizacao: "Dados variaveis, foto, QR Code, laminacao, cordao e furacao.",
    apelidos: ["credencial pvc", "credencial", "cracha evento", "badge pvc"],
    ativo: true,
    is_estoque: false,
    is_variacao: true
  }
];

export const produtosMock: Produto[] = baseProdutos.map((produto) => ({
  ...produto,
  created_at: null,
  is_multiplo: false,
  cod_beneficio: "",
  ncm: "",
  descri_ncm: "",
  cest: "",
  origem: "",
  cod_origem: null,
  cod_bar: "",
  und_medida: "",
  cfop_interno: "",
  cfop_interestadual: "",
  unidade_comercial: "",
  unidade_tributavel: "",
  icms_origem: "",
  icms_situacao_tributaria: "",
  pis_situacao_tributaria: "",
  cofins_situacao_tributaria: "",
  informacoes_fiscais: "",
  fotos: fotosProdutosMock.filter((foto) => foto.idProduto === produto.id_produto),
  variacoes: getProdutoVariacoesByProduto(produto.id_produto)
}));

export function getProdutoById(id_produto: number) {
  return produtosMock.find((produto) => produto.id_produto === id_produto);
}
