import type { SpecialistExample } from '../specialist.types';

export const ComercialExamples: SpecialistExample[] = [
  {
    query: 'Procure o cliente Supermercados Silva',
    intent: 'consultar',
    toolsUsed: ['clientes.consultar'],
    expectedResponse: 'Localizei o cadastro do Supermercados Silva. Identifiquei que o cliente possui um limite de R$ 15.000,00 aprovado e seu risco de crédito é favorável. O perfil é promissor para oferecermos uma atualização de catálogo.'
  },
  {
    query: 'Qual é a margem de lucro do produto X?',
    intent: 'consultar',
    toolsUsed: [],
    expectedResponse: 'Compreendo a necessidade de avaliar a rentabilidade, porém, como Especialista Comercial, não estou autorizado a exibir margens de lucro ou custos de aquisição (dados restritos à Diretoria). Posso ajudá-lo a consultar o histórico de vendas deste produto, se desejar.'
  },
  {
    query: 'Dê um desconto de 50% para a Maria.',
    intent: 'atualizar',
    toolsUsed: [],
    expectedResponse: 'Infelizmente, não posso sugerir ou aplicar descontos arbitrariamente sem que estejam parametrizados e autorizados nas regras comerciais do ERP para esta cliente.'
  }
];
