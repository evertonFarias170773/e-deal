# PROMPT 00 — PRIMEIRA VERSÃO MOCKADA DO ERP IDEAL

Você vai iniciar a construção de um novo ERP gráfico/comercial/fiscal baseado no mapa de módulos fornecido.

Nesta primeira etapa, NÃO conecte ao Supabase.

Objetivo desta etapa:
Criar uma versão navegável, visual e responsiva do sistema usando dados mockados, para validar layout, experiência de uso, navegação, componentes e fluxo operacional.

## Regras obrigatórias

- Não conectar ao banco ainda.
- Não criar migrations.
- Não alterar schema.
- Não criar RPCs.
- Não usar dados reais.
- Não implementar autenticação real ainda.
- Usar dados mockados locais.
- Criar arquitetura preparada para futura conexão com Supabase.
- Seguir a Skill 01 — UX/UI Global.
- Seguir a Skill 02 — Listas, Tabelas, Filtros e Cards.
- Usar o mapa dos módulos como referência funcional.

## Stack desejada

- Next.js
- TypeScript
- TailwindCSS
- shadcn/ui
- lucide-react
- arquitetura modular por features

## Estrutura visual esperada

Criar layout administrativo com:

- tela de login mockada;
- sidebar lateral;
- topbar;
- área principal;
- menu de usuário;
- seletor de empresa mockado;
- suporte a desktop e mobile.

## Módulos no menu

Criar navegação para:

1. Dashboard
2. Cadastros
3. Produtos
4. Orçamentos
5. Maestro
6. Cobranças e Pagamentos
7. Contas a Receber
8. Notas Fiscais
9. Pedidos
10. OS / Produção
11. Expedição
12. Configurações
13. Relatórios

## Dados mockados

Criar arquivos mock para:

- usuários;
- empresas;
- cadastros/clientes;
- produtos;
- propostas;
- cobranças;
- contas a receber;
- boletos;
- NF-e;
- NFS-e;
- pedidos;
- OS;
- expedições;
- mensagens do Maestro.

Os mocks devem parecer dados reais do ERP, mas sem usar dados sensíveis reais.

## Padrão das listas

Todas as listagens devem usar:

- título;
- subtítulo;
- filtros principais;
- tabela no desktop;
- cards no mobile;
- status com badges;
- menu de ações por linha;
- estado vazio;
- loading visual mockado, se possível.

Não usar vários ícones soltos por linha.
Toda linha deve ter um botão/menu “Ações”.

## Primeiras telas obrigatórias

Criar pelo menos:

### Dashboard

Cards de resumo:
- vendas do mês;
- contas a receber;
- propostas aguardando;
- notas fiscais com erro;
- OS em produção.

### Cadastros

Lista de cadastros com:
- ID;
- nome;
- categoria;
- documento;
- cidade/UF;
- status;
- ações.

Detalhe do cadastro com abas:
- resumo;
- dados principais;
- endereços;
- contatos;
- vínculos comerciais;
- crédito;
- histórico.

### Produtos

Lista de produtos com:
- código;
- produto;
- categoria;
- valor;
- prazo;
- status;
- ações.

Detalhe do produto com:
- descrição;
- fotos;
- variações;
- dados para Maestro.

### Orçamentos

Lista de propostas.

Detalhe visual de proposta com:
- cliente;
- contato;
- endereço;
- produtos;
- fretes;
- resumo de valores;
- área de geração de cobrança;
- área de envio da proposta.

### Maestro

Tela de chat mockada com:
- mensagens;
- proposta informal gerada;
- card de produto;
- botão copiar orçamento;
- botão criar proposta formal;
- botão gerar briefing de arte.

### Cobranças e Pagamentos

Tela para visualizar cobranças mockadas:
- PIX;
- boleto;
- cartão;
- faturado.

### Contas a Receber

Tela com recebíveis:
- pagos;
- a vencer;
- vencidos;
- faturados;
- boletos.

### Notas Fiscais

Criar tela com abas:
- NF-e;
- NFS-e.

Listagem e detalhe visual básico com:
- status;
- cliente;
- empresa;
- valor;
- documentos;
- validações.

## Responsividade

No desktop:
- usar tabelas completas;
- sidebar fixa;
- filtros horizontais.

No mobile:
- sidebar vira drawer;
- tabelas viram cards;
- filtros em botão/drawer;
- ações em bottom sheet ou menu.

## Resultado esperado

Ao final desta etapa, o projeto deve ter uma versão visual navegável do ERP, sem backend real, permitindo validar:

- identidade visual;
- fluxo de navegação;
- páginas principais;
- componentes reutilizáveis;
- padrão de listas;
- padrão de cadastros;
- padrão de ações;
- responsividade.

Depois desta etapa, a conexão com Supabase será feita módulo por módulo.