import type {
  ProdutoVariacaoDetalhada,
  ProdutoVariacaoVinculo,
  TipoVariacao,
  VariacaoGlobal
} from "@/features/produtos/types";

export const variacoesMock: VariacaoGlobal[] = [
  {
    id_variacao: 1,
    nome: "Fundo Triband",
    descricao: "Define a cor de fundo usada na pulseira Triband.",
    is_ativo: true
  },
  {
    id_variacao: 2,
    nome: "Chip RFID",
    descricao: "Modelos de chip RFID que adicionam controle eletrônico ao produto.",
    is_ativo: true
  },
  {
    id_variacao: 3,
    nome: "Acessórios",
    descricao: "Acessórios opcionais que podem acompanhar o produto.",
    is_ativo: true
  },
  {
    id_variacao: 4,
    nome: "Tamanho",
    descricao: "Tamanhos ou dimensões disponíveis para produção.",
    is_ativo: true
  },
  {
    id_variacao: 5,
    nome: "Acabamento",
    descricao: "Acabamentos físicos ou visuais aplicáveis ao produto.",
    is_ativo: true
  },
  {
    id_variacao: 6,
    nome: "Extras",
    descricao: "Itens adicionais que podem impactar preço, peso ou produção.",
    is_ativo: true
  }
];

export const tiposVariacoesMock: TipoVariacao[] = [
  { id: "tipo_1_azul", id_variacao: 1, variacao: "Azul médio", v_extra: 0, peso: 0, ref: "TRI-AZ-MED", is_ativo: true },
  { id: "tipo_1_celeste", id_variacao: 1, variacao: "Azul celeste", v_extra: 0, peso: 0, ref: "TRI-AZ-CEL", is_ativo: true },
  { id: "tipo_1_rosa", id_variacao: 1, variacao: "Rosa", v_extra: 0, peso: 0, ref: "TRI-ROSA", is_ativo: true },
  { id: "tipo_1_branca", id_variacao: 1, variacao: "Branca", v_extra: 0, peso: 0, ref: "TRI-BRANCA", is_ativo: true },
  { id: "tipo_1_laranja", id_variacao: 1, variacao: "Laranja fluor", v_extra: 0, peso: 0, ref: "TRI-LAR-FLUOR", is_ativo: true },
  { id: "tipo_1_verde", id_variacao: 1, variacao: "Verde fluor", v_extra: 0, peso: 0, ref: "TRI-VER-FLUOR", is_ativo: true },
  { id: "tipo_2_955", id_variacao: 2, variacao: "955mhz", v_extra: 1.7, peso: 2, ref: "RFID-955", is_ativo: true },
  { id: "tipo_2_1955", id_variacao: 2, variacao: "1955mhz", v_extra: 2.7, peso: 2, ref: "RFID-1955", is_ativo: true },
  { id: "tipo_3_chapinha", id_variacao: 3, variacao: "Chapinha Metálica", v_extra: 0.3, peso: 1.6, ref: "ACE-CHAPINHA", is_ativo: true },
  { id: "tipo_3_engate", id_variacao: 3, variacao: "Engate Rápido", v_extra: 0.79, peso: 7.6, ref: "ACE-ENGATE", is_ativo: true },
  { id: "tipo_3_argola", id_variacao: 3, variacao: "Argola", v_extra: 0.18, peso: 1.2, ref: "ACE-ARGOLA", is_ativo: true },
  { id: "tipo_3_mosquetao", id_variacao: 3, variacao: "Mosquetão", v_extra: 0.95, peso: 8.4, ref: "ACE-MOSQ", is_ativo: true },
  { id: "tipo_4_p", id_variacao: 4, variacao: "P", v_extra: 0, peso: 0, ref: "TAM-P", is_ativo: true },
  { id: "tipo_4_m", id_variacao: 4, variacao: "M", v_extra: 0, peso: 0, ref: "TAM-M", is_ativo: true },
  { id: "tipo_4_g", id_variacao: 4, variacao: "G", v_extra: 0, peso: 0, ref: "TAM-G", is_ativo: true },
  { id: "tipo_5_laminado", id_variacao: 5, variacao: "Laminação fosca", v_extra: 0.45, peso: 0.5, ref: "ACAB-FOSCO", is_ativo: true },
  { id: "tipo_5_brilho", id_variacao: 5, variacao: "Laminação brilho", v_extra: 0.4, peso: 0.5, ref: "ACAB-BRILHO", is_ativo: true },
  { id: "tipo_6_dados", id_variacao: 6, variacao: "Dados variáveis", v_extra: 0.12, peso: 0, ref: "EXT-DADOS", is_ativo: true },
  { id: "tipo_6_qrcode", id_variacao: 6, variacao: "QR Code", v_extra: 0.08, peso: 0, ref: "EXT-QR", is_ativo: true }
];

export const produtoVariacoesMock: ProdutoVariacaoVinculo[] = [
  { id: "pv_101_1", id_produto: 101, id_variacao: 1, is_obrigatorio: true, is_multiplo: false },
  { id: "pv_101_6", id_produto: 101, id_variacao: 6, is_obrigatorio: false, is_multiplo: true },
  { id: "pv_102_1", id_produto: 102, id_variacao: 1, is_obrigatorio: true, is_multiplo: false },
  { id: "pv_301_4", id_produto: 301, id_variacao: 4, is_obrigatorio: true, is_multiplo: false },
  { id: "pv_301_3", id_produto: 301, id_variacao: 3, is_obrigatorio: false, is_multiplo: true },
  { id: "pv_401_6", id_produto: 401, id_variacao: 6, is_obrigatorio: true, is_multiplo: true },
  { id: "pv_402_5", id_produto: 402, id_variacao: 5, is_obrigatorio: true, is_multiplo: false },
  { id: "pv_402_6", id_produto: 402, id_variacao: 6, is_obrigatorio: false, is_multiplo: true },
  { id: "pv_801_5", id_produto: 801, id_variacao: 5, is_obrigatorio: true, is_multiplo: false },
  { id: "pv_801_6", id_produto: 801, id_variacao: 6, is_obrigatorio: false, is_multiplo: true },
  { id: "pv_901_3", id_produto: 901, id_variacao: 3, is_obrigatorio: false, is_multiplo: true },
  { id: "pv_901_5", id_produto: 901, id_variacao: 5, is_obrigatorio: true, is_multiplo: false }
];

export function getTiposByVariacao(id_variacao: number) {
  return tiposVariacoesMock.filter((tipo) => tipo.id_variacao === id_variacao && tipo.is_ativo);
}

export function getVariacaoById(id_variacao: number) {
  return variacoesMock.find((variacao) => variacao.id_variacao === id_variacao) ?? null;
}

export function getProdutoVariacoesByProduto(id_produto: number): ProdutoVariacaoDetalhada[] {
  return produtoVariacoesMock
    .filter((vinculo) => vinculo.id_produto === id_produto)
    .map((vinculo) => {
      const variacao = getVariacaoById(vinculo.id_variacao);

      if (!variacao) {
        return null;
      }

      return {
        ...vinculo,
        variacao,
        tipos: getTiposByVariacao(vinculo.id_variacao)
      };
    })
    .filter(Boolean) as ProdutoVariacaoDetalhada[];
}
