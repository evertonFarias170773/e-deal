import { PedidoMock, PedidoStatus, ArteStatus, ProducaoStatus, ProdutoMock, ModeloMock } from "../types";

const staticPedidosMock: PedidoMock[] = [
  {
    id_int: 16790,
    clienteNome: "Eventos Brasil S/A",
    idCliente: 120017,
    empresa: "Ideal Biro",
    vendedor: "Everton Farias",
    dataPedido: "2026-05-21",
    dataPrevistaEntrega: "2026-06-15",
    statusPedido: "ARTE_EM_ANDAMENTO",
    urgente: false,
    formaPagamento: "Pix a vista 3 dias",
    valorTotal: 4200.00,
    pesoTeorico: 3.45,
    obs: "Atenção redobrada na sangria das pulseiras vermelhas.",
    briefingOperacional: "Desenvolver pulseiras com cores vibrantes para o festival de música. Cuidado redobrado com a legibilidade da marca no modelo azul escuro.",
    observacoesGerais: "Entrega agendada no local do evento. Pedido faturado direto com o financeiro da produtora.",
    anexos: [
      { name: "logos_festival_vetor.ai", url: "#", type: "application/illustrator" },
      { name: "manual_marca_ideal.pdf", url: "#", type: "application/pdf" }
    ],
    dadosEvento: {
      nome: "Festival Brasil Music 2026",
      data: "2026-06-15",
      local: "Arena Multiuso, São Paulo - SP"
    },
    instrucoesDesign: "Manter logo centralizada a 15mm da borda esquerda. Fonte em negrito para os ingressos VIP.",
    instrucoesImpressao: "Utilizar tinta fosca de secagem UV. Testar a leitura de QR Code em aparelhos iOS e Android antes de rodar o lote total.",
    produtos: [
      {
        id: "prod_16790_1",
        nome: "Triband",
        quantidade: 3000,
        pesoEstimado: 3.45,
        modelos: [
          {
            id: "mod_16790_azul",
            nomeModelo: "Modelo Azul (Triband)",
            quantidade: 750,
            statusArte: "EM_REVISAO_INTERNA",
            statusProducao: "PENDENTE",
            designerResponsavel: "Felipe Neto",
            setor: "Pulseiras",
            numeracaoInicial: 1,
            numeracaoFinal: 750,
            verso: false,
            bloco: "Bloco A",
            corMaterial: "Azul Royal",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Impressão em serigrafia preta com QR Code de dados variáveis.",
            configImpressao: {
              tipoNumeracao: "SEQUENCIAL",
              posicaoX: 25,
              posicaoY: 120,
              tamanhoFonte: 14,
              inclinacao: 90,
              qtdDigitos: 4,
              cor: "Preto",
              qrCode: true,
              qrTemplate: "https://ideal.com/check/azul-{numero}"
            },
            arteAtual: {
              versao: 1,
              urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
              nomeArquivo: "triband_azul_v1.pdf",
              dataUpload: "2026-06-02T09:15:00Z"
            },
            historicoArtes: [
              {
                versao: 1,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: "triband_azul_v1.pdf",
                status: "EM_REVISAO_INTERNA",
                dataUpload: "2026-06-02T09:15:00Z"
              }
            ],
            tokenAprovacao: "token_azul_16790"
          },
          {
            id: "mod_16790_vermelho",
            nomeModelo: "Modelo Vermelho (Triband)",
            quantidade: 750,
            statusArte: "REPROVADA_CLIENTE",
            statusProducao: "PENDENTE",
            designerResponsavel: "Felipe Neto",
            setor: "Pulseiras",
            numeracaoInicial: 751,
            numeracaoFinal: 1500,
            verso: false,
            bloco: "Bloco B",
            corMaterial: "Vermelho Neon",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Aplicar tinta de segurança invisível reagente a UV.",
            comentarioCliente: "A logomarca está muito escura. Favor usar o pantone XYZ.",
            configImpressao: {
              tipoNumeracao: "SEQUENCIAL",
              posicaoX: 25,
              posicaoY: 120,
              tamanhoFonte: 14,
              inclinacao: 90,
              qtdDigitos: 4,
              cor: "Branco"
            },
            arteAtual: {
              versao: 1,
              urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
              nomeArquivo: "triband_vermelho_v1.pdf",
              comentarios: "Ajustar cor da logo",
              dataUpload: "2026-06-02T08:30:00Z"
            },
            historicoArtes: [
              {
                versao: 1,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: "triband_vermelho_v1.pdf",
                status: "REPROVADA_CLIENTE",
                comentarios: "A logo está muito escura. Favor usar pantone XYZ.",
                dataUpload: "2026-06-02T08:30:00Z"
              }
            ],
            tokenAprovacao: "token_vermelho_16790"
          },
          {
            id: "mod_16790_verde",
            nomeModelo: "Modelo Verde (Triband)",
            quantidade: 1000,
            statusArte: "LIBERADA",
            statusProducao: "PENDENTE",
            designerResponsavel: "Felipe Neto",
            setor: "Pulseiras",
            numeracaoInicial: 1501,
            numeracaoFinal: 2500,
            verso: false,
            bloco: "Bloco C",
            corMaterial: "Verde Neon",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Tinta preta padrão.",
            configImpressao: {
              tipoNumeracao: "SEQUENCIAL",
              posicaoX: 25,
              posicaoY: 120,
              tamanhoFonte: 14,
              inclinacao: 90,
              qtdDigitos: 4,
              cor: "Preto"
            },
            arteAtual: {
              versao: 2,
              urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
              nomeArquivo: "triband_verde_v2.pdf",
              dataUpload: "2026-06-02T09:45:00Z"
            },
            historicoArtes: [
              {
                versao: 1,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: "triband_verde_v1.pdf",
                status: "REPROVADA_CLIENTE",
                comentarios: "Texto incorreto no rodapé.",
                dataUpload: "2026-06-01T14:30:00Z"
              },
              {
                versao: 2,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: "triband_verde_v2.pdf",
                status: "LIBERADA",
                dataUpload: "2026-06-02T09:45:00Z"
              }
            ],
            tokenAprovacao: "token_verde_16790"
          },
          {
            id: "mod_16790_amarelo",
            nomeModelo: "Modelo Amarelo (Triband)",
            quantidade: 500,
            statusArte: "PENDENTE",
            statusProducao: "PENDENTE",
            designerResponsavel: "Felipe Neto",
            setor: "Pulseiras",
            numeracaoInicial: 2501,
            numeracaoFinal: 3000,
            verso: false,
            bloco: "Bloco D",
            corMaterial: "Amarelo Neon",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Aguardando briefing definitivo.",
            configImpressao: {
              tipoNumeracao: "SEQUENCIAL"
            },
            historicoArtes: [],
            tokenAprovacao: "token_amarelo_16790"
          }
        ]
      }
    ],
    modelos: [] // Inicializado abaixo no mapeamento
  },
  {
    id_int: 16804,
    clienteNome: "Fanta Promoções",
    idCliente: 922723,
    empresa: "Ideal Grafica",
    vendedor: "Caroline Silva",
    dataPedido: "2026-05-20",
    dataPrevistaEntrega: "2026-06-18",
    statusPedido: "AGUARDANDO_OS",
    urgente: true,
    formaPagamento: "Boleto 14 dias",
    valorTotal: 1500.00,
    pesoTeorico: 1.20,
    obs: "Modelo vip com cordão personalizado.",
    briefingOperacional: "Credenciais VIP para a ativação de Fanta no shopping. Cores devem seguir estritamente o guia de marca.",
    observacoesGerais: "Entrega urgente até meio-dia.",
    dadosEvento: {
      nome: "Promoção Fanta Laranja",
      data: "2026-06-18",
      local: "Shopping Center Norte, São Paulo - SP"
    },
    instrucoesDesign: "Aplicar textura de bolhas no fundo laranja.",
    instrucoesImpressao: "Revisar alinhamento frente/verso.",
    produtos: [
      {
        id: "prod_16804_1",
        nome: "Credencial VIP",
        quantidade: 500,
        pesoEstimado: 1.20,
        modelos: [
          {
            id: "mod_16804_vip",
            nomeModelo: "Credencial VIP Fanta",
            quantidade: 500,
            statusArte: "LIBERADA",
            statusProducao: "PENDENTE",
            designerResponsavel: "Emily Boeira",
            setor: "Crachás",
            numeracaoInicial: undefined,
            numeracaoFinal: undefined,
            verso: true,
            bloco: "Único",
            corMaterial: "Laranja Fanta",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Acabamento em laminação fosca com cordão personalizado.",
            configImpressao: {
              tipoNumeracao: "SEM_NUMERACAO"
            },
            arteAtual: {
              versao: 1,
              urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
              nomeArquivo: "credencial_vip_v1.pdf",
              dataUpload: "2026-06-01T11:00:00Z"
            },
            historicoArtes: [
              {
                versao: 1,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: "credencial_vip_v1.pdf",
                status: "LIBERADA",
                dataUpload: "2026-06-01T11:00:00Z"
              }
            ],
            tokenAprovacao: "token_vip_16804"
          }
        ]
      }
    ],
    modelos: []
  },
  {
    id_int: 16821,
    clienteNome: "Cervejaria Premium",
    idCliente: 770055,
    empresa: "E3 Brindes",
    vendedor: "Edison Jr",
    dataPedido: "2026-05-18",
    dataPrevistaEntrega: "2026-06-25",
    statusPedido: "EM_IMPRESSAO",
    urgente: false,
    formaPagamento: "Faturado 28 dias",
    valorTotal: 840.00,
    pesoTeorico: 2.10,
    volumes: 1,
    pesoAferido: 2.15,
    obs: "Entregar em horário comercial.",
    briefingOperacional: "Cartões fidelidade para os clientes VIP da cervejaria.",
    dadosEvento: {
      nome: "Lançamento Nova IPA",
      data: "2026-06-25",
      local: "Bar da Cervejaria, Joinville - SC"
    },
    instrucoesDesign: "Utilizar logo dourada metalizada.",
    instrucoesImpressao: "Aplicar verniz localizado na logo.",
    produtos: [
      {
        id: "prod_16821_1",
        nome: "Cartão Fidelidade",
        quantidade: 1200,
        pesoEstimado: 2.10,
        modelos: [
          {
            id: "mod_16821_cartao",
            nomeModelo: "Cartão Fidelidade Cervejaria",
            quantidade: 1200,
            statusArte: "LIBERADA",
            statusProducao: "EM_IMPRESSAO",
            designerResponsavel: "Edison Jr",
            setor: "Cartões",
            numeracaoInicial: 1001,
            numeracaoFinal: 2200,
            verso: true,
            bloco: "Lote 1",
            corMaterial: "PVC Preto",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Impressão em PVC 0.76mm com tarja magnética.",
            configImpressao: {
              tipoNumeracao: "SEQUENCIAL",
              posicaoX: 10,
              posicaoY: 45,
              tamanhoFonte: 10,
              cor: "Preto"
            },
            arteAtual: {
              versao: 1,
              urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
              nomeArquivo: "cartao_fidelidade_v1.pdf",
              dataUpload: "2026-05-25T14:00:00Z"
            },
            historicoArtes: [
              {
                versao: 1,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: "cartao_fidelidade_v1.pdf",
                status: "LIBERADA",
                dataUpload: "2026-05-25T14:00:00Z"
              }
            ],
            tokenAprovacao: "token_cartao_16821"
          }
        ]
      }
    ],
    modelos: []
  },
  {
    id_int: 17110,
    clienteNome: "Biro Nacional de Shows",
    idCliente: 120018,
    empresa: "Ideal Biro",
    vendedor: "Everton Farias",
    dataPedido: "2026-06-01",
    dataPrevistaEntrega: "2026-06-20",
    statusPedido: "NOVO",
    urgente: false,
    financialBlock: true,
    formaPagamento: "Boleto 7 dias",
    valorTotal: 5120.00,
    pesoTeorico: 4.80,
    obs: "⚠️ BLOQUEIO FINANCEIRO ATIVO. Liberação comercial pendente de aprovação de limite.",
    briefingOperacional: "Pulseiras para controle de acesso do show nacional de sertanejo.",
    dadosEvento: {
      nome: "Show Nacional Sertanejo",
      data: "2026-06-20",
      local: "Arena Show, Balneário Camboriú - SC"
    },
    instrucoesDesign: "Numeração preta legível com código de barras.",
    instrucoesImpressao: "Tinta reagente UV.",
    produtos: [
      {
        id: "prod_17110_1",
        nome: "Pulseira Tyvek",
        quantidade: 2000,
        pesoEstimado: 4.80,
        modelos: [
          {
            id: "mod_17110_tyvek",
            nomeModelo: "Pulseira Tyvek Promocional",
            quantidade: 2000,
            statusArte: "PENDENTE",
            statusProducao: "PENDENTE",
            designerResponsavel: "Felipe Neto",
            setor: "Pulseiras",
            numeracaoInicial: 5000,
            numeracaoFinal: 7000,
            verso: false,
            bloco: "Bloco T",
            corMaterial: "Tyvek Verde Neon",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Tinta invisível reagente a luz negra.",
            configImpressao: {
              tipoNumeracao: "SEQUENCIAL",
              cor: "Preto"
            },
            historicoArtes: [],
            tokenAprovacao: "token_tyvek_17110"
          }
        ]
      }
    ],
    modelos: []
  },
  {
    id_int: 17208,
    clienteNome: "Supermercados Estrela",
    idCliente: 770059,
    empresa: "Ideal Grafica",
    vendedor: "Caroline Silva",
    dataPedido: "2026-05-15",
    dataPrevistaEntrega: "2026-06-01",
    statusPedido: "EM_ACABAMENTO",
    urgente: true,
    formaPagamento: "Faturado 15 dias",
    valorTotal: 960.00,
    pesoTeorico: 1.80,
    obs: "Atrasado! Prazo vencido. Prioridade máxima no acabamento.",
    briefingOperacional: "Cartão de desconto fidelidade para a rede de mercados.",
    dadosEvento: {
      nome: "Aniversário Supermercados Estrela",
      data: "2026-06-01",
      local: "Todas as filiais"
    },
    instrucoesDesign: "Código de barras no verso com espaço para assinatura.",
    instrucoesImpressao: "Laminação brilhante.",
    produtos: [
      {
        id: "prod_17208_1",
        nome: "Cartão Desconto",
        quantidade: 1500,
        pesoEstimado: 1.80,
        modelos: [
          {
            id: "mod_17208_cartao",
            nomeModelo: "Cartão Desconto Estrela",
            quantidade: 1500,
            statusArte: "LIBERADA",
            statusProducao: "EM_ACABAMENTO",
            designerResponsavel: "Emily Boeira",
            setor: "Cartões",
            numeracaoInicial: undefined,
            numeracaoFinal: undefined,
            verso: true,
            bloco: "Lote Desconto",
            corMaterial: "PVC Branco",
            csvDadosVariaveisUrl: "https://ideal.com/csv/dados_estrela.csv",
            observacoesTecnicas: "Leitura de código de barras 139 testada.",
            configImpressao: {
              tipoNumeracao: "COD_BARRAS_139"
            },
            arteAtual: {
              versao: 1,
              urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
              nomeArquivo: "cartao_estrela_v1.pdf",
              dataUpload: "2026-05-22T10:00:00Z"
            },
            historicoArtes: [
              {
                versao: 1,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: "cartao_estrela_v1.pdf",
                status: "LIBERADA",
                dataUpload: "2026-05-22T10:00:00Z"
              }
            ],
            tokenAprovacao: "token_cartao_17208"
          }
        ]
      }
    ],
    modelos: []
  },
  {
    id_int: 17226,
    clienteNome: "Agência Click Brindes",
    idCliente: 922728,
    empresa: "E3 Brindes",
    vendedor: "Edison Jr",
    dataPedido: "2026-05-25",
    dataPrevistaEntrega: "2026-06-10",
    statusPedido: "EM_IMPRESSAO",
    urgente: false,
    blockReason: "Falta de insumo: Bobinas de poliéster prata holográfico",
    tempoParadoMinutos: 145,
    formaPagamento: "Pix a vista 3 dias",
    valorTotal: 7800.00,
    pesoTeorico: 5.60,
    obs: "Aguardando chegada do material do fornecedor.",
    briefingOperacional: "Pulseiras de alto padrão para evento corporativo de tecnologia.",
    dadosEvento: {
      nome: "Click Tech Summit 2026",
      data: "2026-06-10",
      local: "Centro de Convenções, Florianópolis - SC"
    },
    instrucoesDesign: "Logo Click gravada a laser ou serigrafia preta.",
    instrucoesImpressao: "Configurar temperatura da impressora para não danificar o material holográfico.",
    produtos: [
      {
        id: "prod_17226_1",
        nome: "Pulseira Holográfica",
        quantidade: 5000,
        pesoEstimado: 5.60,
        modelos: [
          {
            id: "mod_17226_holografica",
            nomeModelo: "Pulseira Holográfica Prata",
            quantidade: 5000,
            statusArte: "LIBERADA",
            statusProducao: "PENDENTE",
            designerResponsavel: "Edison Jr",
            setor: "Pulseiras",
            numeracaoInicial: 10001,
            numeracaoFinal: 15000,
            verso: false,
            bloco: "Holo-A",
            corMaterial: "Poliéster Prata Holográfico",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Pausa no material, aguardando bobinas holográficas do fornecedor.",
            configImpressao: {
              tipoNumeracao: "SEQUENCIAL",
              qrCode: true
            },
            arteAtual: {
              versao: 1,
              urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
              nomeArquivo: "pulseira_holo_v1.pdf",
              dataUpload: "2026-05-28T16:00:00Z"
            },
            historicoArtes: [
              {
                versao: 1,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: "pulseira_holo_v1.pdf",
                status: "LIBERADA",
                dataUpload: "2026-05-28T16:00:00Z"
              }
            ],
            tokenAprovacao: "token_holo_17226"
          }
        ]
      }
    ],
    modelos: []
  },
  {
    id_int: 17330,
    clienteNome: "Prefeitura de Joinville",
    idCliente: 120025,
    empresa: "Ideal Biro",
    vendedor: "Everton Farias",
    dataPedido: "2026-05-28",
    dataPrevistaEntrega: "2026-06-12",
    statusPedido: "EM_ACABAMENTO",
    urgente: false,
    formaPagamento: "Faturado empenho",
    valorTotal: 3800.00,
    pesoTeorico: 4.10,
    obs: "Produção Parcial: Modelo Verde Concluído, Lote Amarelo aguardando arte.",
    briefingOperacional: "Credenciais para o congresso educacional da prefeitura.",
    dadosEvento: {
      nome: "Congresso Municipal de Educação",
      data: "2026-06-12",
      local: "Teatro Juarez Machado, Joinville - SC"
    },
    instrucoesDesign: "Tarja de cor diferenciada por lote (verde = palestrante, amarelo = ouvinte).",
    instrucoesImpressao: "Corte reto com furo ovo centralizado.",
    produtos: [
      {
        id: "prod_17330_1",
        nome: "Credencial",
        quantidade: 3000,
        pesoEstimado: 4.10,
        modelos: [
          {
            id: "mod_17330_verde",
            nomeModelo: "Lote Verde (Credencial)",
            quantidade: 1500,
            statusArte: "LIBERADA",
            statusProducao: "CONCLUIDA",
            designerResponsavel: "Emily Boeira",
            setor: "Credenciais",
            numeracaoInicial: 1,
            numeracaoFinal: 1500,
            verso: true,
            bloco: "Verde-J",
            corMaterial: "Papel Couchê 300g",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Impressão concluída. Lote acabado.",
            configImpressao: {
              tipoNumeracao: "SEQUENCIAL"
            },
            arteAtual: {
              versao: 1,
              urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
              nomeArquivo: "credencial_verde_v1.pdf",
              dataUpload: "2026-05-29T10:00:00Z"
            },
            historicoArtes: [
              {
                versao: 1,
                urlArquivo: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf",
                nomeArquivo: "credencial_verde_v1.pdf",
                status: "LIBERADA",
                dataUpload: "2026-05-29T10:00:00Z"
              }
            ],
            tokenAprovacao: "token_verde_17330"
          },
          {
            id: "mod_17330_amarelo",
            nomeModelo: "Lote Amarelo (Credencial)",
            quantidade: 1500,
            statusArte: "PENDENTE",
            statusProducao: "PENDENTE",
            designerResponsavel: "Emily Boeira",
            setor: "Credenciais",
            numeracaoInicial: 1501,
            numeracaoFinal: 3000,
            verso: true,
            bloco: "Amarelo-J",
            corMaterial: "Papel Couchê 300g",
            csvDadosVariaveisUrl: undefined,
            observacoesTecnicas: "Aguardando definição da arte final pelo cliente.",
            configImpressao: {
              tipoNumeracao: "SEQUENCIAL"
            },
            historicoArtes: [],
            tokenAprovacao: "token_amarelo_17330"
          }
        ]
      }
    ],
    modelos: []
  }
];

const generate93MockPedidos = (): PedidoMock[] => {
  const list: PedidoMock[] = [];
  const clientes = [
    "Supermercados Paraná", "Clube Atlético Catarinense", "Agência Vanguarda", "Metalúrgica Joinville",
    "Boutique Perfumes", "Cantina Napolitana", "Smart Tech Solutions", "Restaurante Estrela do Mar",
    "Festa & Fantasia", "Colégio Dom Bosco", "Academia Corpus", "Mecânica Auto Express",
    "Farmácia Preço Popular", "Park Shopping", "Hotel Plaza", "Imóveis Exclusivos",
    "Moda Elegante", "Pet Shop Cão Feliz", "Clinica Odonto Riso", "Advogados Associados"
  ];
  const empresas = ["Ideal Grafica", "Ideal Biro", "E3 Brindes"];
  const vendedores = ["Everton Farias", "Caroline Silva", "Edison Jr", "Patrícia Costa", "Alexandre M."];
  const designers = ["Felipe Neto", "Emily Boeira", "Edison Jr", "Bruno Lopes", "Amanda Souza"];
  const formasPagamento = ["Pix a vista", "Boleto 14 dias", "Faturado 28 dias", "Cartão de Crédito"];
  const blockReasons = [
    "Falta de papel couchê 300g",
    "Falha mecânica guilhotina",
    "Ajuste de faca de corte",
    "Aguardando bobina holográfica",
    "Falta de fita crepe preta"
  ];

  for (let i = 0; i < 93; i++) {
    const id_int = 17331 + i;
    const clienteNome = clientes[i % clientes.length] + ` (#${id_int})`;
    const idCliente = 200000 + i;
    const empresa = empresas[i % empresas.length];
    const vendedor = vendedores[i % vendedores.length];
    const urgente = (i % 7 === 0);

    let statusPedido: PedidoStatus = "NOVO";
    if (i % 10 === 0) statusPedido = "NOVO";
    else if (i % 10 === 1) statusPedido = "ARTE_EM_ANDAMENTO";
    else if (i % 10 === 2) statusPedido = "AGUARDANDO_APROVACAO_CLIENTE";
    else if (i % 10 === 3) statusPedido = "AGUARDANDO_APROVACAO_ATENDENTE";
    else if (i % 10 === 4) statusPedido = "AGUARDANDO_OS";
    else if (i % 10 === 5) statusPedido = "EM_IMPRESSAO";
    else if (i % 10 === 6) statusPedido = "EM_ACABAMENTO";
    else if (i % 10 === 7) statusPedido = "REVISAO_FINAL";
    else if (i % 10 === 8) statusPedido = "PRONTO_EXPEDICAO";
    else statusPedido = "EXPEDIDO";

    const financialBlock = (i % 12 === 0 && statusPedido === "NOVO");
    const isMaterialBlocked = (i % 15 === 0 && statusPedido !== "EXPEDIDO" && !financialBlock);
    const blockReason = isMaterialBlocked ? blockReasons[i % blockReasons.length] : undefined;
    const tempoParadoMinutos = isMaterialBlocked ? (30 + (i * 12) % 450) : undefined;
    
    const orderDaysAgo = 1 + (i % 12);
    const orderDate = new Date("2026-06-02");
    orderDate.setDate(orderDate.getDate() - orderDaysAgo);
    const dataPedido = orderDate.toISOString().split("T")[0];
    
    const deliveryDate = new Date("2026-06-02");
    const isDelayed = (i % 8 === 0 && statusPedido !== "EXPEDIDO");
    const deliveryDaysFromNow = isDelayed ? -(1 + (i % 4)) : (2 + (i % 12));
    deliveryDate.setDate(deliveryDate.getDate() + deliveryDaysFromNow);
    const dataPrevistaEntrega = deliveryDate.toISOString().split("T")[0];

    const valorTotal = 300 + (i * 145) % 12000;
    const pesoTeorico = 0.4 + (i * 0.22) % 15;

    // Tipo de produto
    const productNames = ["Triband", "Credenciais Premium", "Cartões de Acesso PVC", "Pulseiras Tyvek"];
    const productName = productNames[i % productNames.length];
    const sector = productName.includes("Cartão") ? "Cartões" : productName.includes("Credencial") ? "Credenciais" : "Pulseiras";

    const numModels = 1 + (i % 3);
    const modelos: ModeloMock[] = [];
    
    for (let m = 0; m < numModels; m++) {
      const modelId = `mod_${id_int}_${m}`;
      const nomeModelo = `Modelo ${String.fromCharCode(65 + m)} (${productName})`;
      const quantidade = [500, 1000, 2000, 5000][(i + m) % 4];
      const designer = designers[(i + m) % designers.length];

      let statusArte: ArteStatus = "PENDENTE";
      let statusProducao: ProducaoStatus = "PENDENTE";

      if (statusPedido === "EXPEDIDO" || statusPedido === "PRONTO_EXPEDICAO") {
        statusArte = "LIBERADA";
        statusProducao = "CONCLUIDA";
      } else if (statusPedido === "REVISAO_FINAL" || statusPedido === "EM_ACABAMENTO") {
        statusArte = "LIBERADA";
        statusProducao = (m === 0 && numModels > 1) ? "CONCLUIDA" : "EM_ACABAMENTO";
      } else if (statusPedido === "EM_IMPRESSAO") {
        statusArte = "LIBERADA";
        statusProducao = (m === 0 && numModels > 1) ? "PENDENTE" : "EM_IMPRESSAO";
      } else {
        const artStatuses: ArteStatus[] = ["PENDENTE", "EM_CRIACAO", "EM_REVISAO_INTERNA", "AGUARDANDO_CLIENTE", "APROVADA_CLIENTE", "REPROVADA_CLIENTE"];
        statusArte = artStatuses[(i + m) % artStatuses.length];
      }

      const hasArteFile = statusArte !== "PENDENTE" && statusArte !== "EM_CRIACAO";
      const arteAtual = hasArteFile ? {
        versao: (statusArte === "REPROVADA_CLIENTE") ? 1 : 2,
        urlArquivo: "#",
        nomeArquivo: `art_os_${id_int}_lote_${m}.pdf`,
        dataUpload: dataPedido + "T14:30:00Z"
      } : undefined;

      const comment = (statusArte === "REPROVADA_CLIENTE") ? "A tipografia da numeração está errada." : undefined;

      modelos.push({
        id: modelId,
        nomeModelo,
        quantidade,
        statusArte,
        statusProducao,
        designerResponsavel: designer,
        comentarioCliente: comment,
        setor: sector,
        numeracaoInicial: sector === "Pulseiras" ? 1 : undefined,
        numeracaoFinal: sector === "Pulseiras" ? quantidade : undefined,
        verso: i % 2 === 0,
        bloco: `Lote ${String.fromCharCode(65 + m)}`,
        corMaterial: ["Azul", "Branco", "Amarelo", "Verde", "Vermelho"][(i + m) % 5],
        csvDadosVariaveisUrl: i % 6 === 0 ? `https://ideal.com/csv/dados_${id_int}.csv` : undefined,
        observacoesTecnicas: `Verificar conformidade com a paleta do cliente.`,
        configImpressao: {
          tipoNumeracao: (i % 3 === 0) ? "SEM_NUMERACAO" : "SEQUENCIAL",
          cor: (i % 2 === 0) ? "Preto" : "Colorido"
        },
        arteAtual,
        historicoArtes: hasArteFile ? [
          {
            versao: 1,
            urlArquivo: "#",
            nomeArquivo: `art_os_${id_int}_lote_${m}_v1.pdf`,
            status: statusArte,
            dataUpload: dataPedido + "T14:30:00Z"
          }
        ] : [],
        tokenAprovacao: `token_${id_int}_${m}`
      });
    }

    const totalQtd = modelos.reduce((acc, m) => acc + m.quantidade, 0);

    const produtos: ProdutoMock[] = [
      {
        id: `prod_${id_int}_1`,
        nome: productName,
        quantidade: totalQtd,
        pesoEstimado: pesoTeorico,
        modelos: modelos
      }
    ];

    list.push({
      id_int,
      clienteNome,
      idCliente,
      empresa,
      vendedor,
      dataPedido,
      dataPrevistaEntrega,
      statusPedido,
      urgente,
      financialBlock,
      blockReason,
      tempoParadoMinutos,
      formaPagamento: formasPagamento[i % formasPagamento.length],
      valorTotal,
      pesoTeorico,
      obs: urgente ? "🚨 Prioridade Máxima Chão de Fábrica" : undefined,
      briefingOperacional: `Briefing simulado para o produto ${productName}. Produzir lote de ${totalQtd} unidades em conformidade com as orientações do cliente.`,
      observacoesGerais: urgente ? "🚨 Pedido com entrega prioritária combinada direto com a diretoria." : "Entrega padrão em horário comercial.",
      anexos: [
        { name: `briefing_operacional_${id_int}.pdf`, url: "#", type: "application/pdf" }
      ],
      dadosEvento: {
        nome: `Evento de ${clienteNome.split(" (#")[0]}`,
        data: dataPrevistaEntrega,
        local: "Centro de Convenções Regional"
      },
      instrucoesDesign: "Diagramar o layout utilizando fontes de alta legibilidade. Deixar sangria técnica de 3mm.",
      instrucoesImpressao: "Conferir tonalidades de preto e calibragem de numeração variável.",
      produtos,
      modelos: [] // Inicializado abaixo no mapeamento
    });
  }

  return list;
};

// Mapeia modelos flat para manter retrocompatibilidade
const mapModelosFlat = (pedidos: PedidoMock[]): PedidoMock[] => {
  return pedidos.map(p => ({
    ...p,
    modelos: p.produtos.flatMap(prod => prod.modelos)
  }));
};

export const initialPedidosMock: PedidoMock[] = mapModelosFlat([
  ...staticPedidosMock,
  ...generate93MockPedidos()
]);
