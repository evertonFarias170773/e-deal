export type ProdutoCategoria = "Pulseiras" | "Ingressos" | "Cartoes" | "Credenciais";

export type ProdutoNivelSeguranca = "baixo" | "medio" | "alto" | "antifraude" | "controle visual";

export type ProdutoFoto = {
  id: string;
  idProduto: number;
  nomeProduto: string;
  imagensURL: string;
  principal?: boolean;
};

export type VariacaoGlobal = {
  id_variacao: number;
  nome: string;
  descricao: string;
  is_ativo: boolean;
};

export type TipoVariacao = {
  id: string;
  id_variacao: number;
  variacao: string;
  v_extra: number;
  peso: number;
  ref: string;
  is_ativo: boolean;
};

export type ProdutoVariacaoVinculo = {
  id: string;
  id_produto: number;
  id_variacao: number;
  is_obrigatorio: boolean;
  is_multiplo: boolean;
};

export type ProdutoVariacaoDetalhada = ProdutoVariacaoVinculo & {
  variacao: VariacaoGlobal;
  tipos: TipoVariacao[];
};

export type Produto = {
  id: string;
  id_produto: number;
  nomeReal: string;
  categoria: ProdutoCategoria;
  formato: string;
  valorUnt: number;
  valorFixo: number;
  valor_custo: number;
  peso: number;
  prazo: string;
  nivelSeg: ProdutoNivelSeguranca;
  fraseCons: string;
  descricao: string;
  personalizacao: string;
  apelidos: string[];
  ativo: boolean;
  is_estoque: boolean;
  is_variacao: boolean;
  fotos: ProdutoFoto[];
  variacoes: ProdutoVariacaoDetalhada[];
};

export type ProdutoFormState = {
  id_produto: string;
  nomeReal: string;
  categoria: ProdutoCategoria;
  formato: string;
  valorUnt: string;
  valorFixo: string;
  valor_custo: string;
  peso: string;
  prazo: string;
  nivelSeg: ProdutoNivelSeguranca;
  fraseCons: string;
  descricao: string;
  personalizacao: string;
  apelidos: string;
  ativo: boolean;
  is_estoque: boolean;
  is_variacao: boolean;
  fotos: ProdutoFoto[];
  variacoes: ProdutoVariacaoDetalhada[];
};
