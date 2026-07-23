# PADROES-UX-UI.md

Versão: 2.1  
Status: Oficial  
Última atualização: 23/07/2026  
Projeto: ERP Ideal

---

# Padrões Oficiais de UX/UI

Este documento define os padrões visuais, comportamentais, responsivos e de acessibilidade do ERP Ideal.

Seu objetivo é garantir consistência entre módulos sem obrigar todos os fluxos a usar os mesmos componentes indiscriminadamente.

Toda alteração de interface deve investigar os componentes já existentes e reutilizar o padrão oficial antes de criar uma solução nova.

---

# 1. Princípios de Interface

O ERP deve transmitir uma aparência:

- administrativa;
- moderna;
- limpa;
- produtiva;
- confiável;
- responsiva;
- coerente entre módulos.

A interface deve priorizar:

- clareza da informação;
- rapidez operacional;
- hierarquia visual;
- prevenção de erros;
- feedback imediato;
- acessibilidade;
- consistência entre desktop e mobile.

Evitar:

- excesso de cores;
- animações decorativas;
- telas visualmente carregadas;
- componentes paralelos para a mesma função;
- ações importantes escondidas;
- mensagens técnicas expostas ao usuário;
- comportamento dependente apenas de hover.

---

# 2. Tokens Visuais

A paleta oficial é definida por CSS Custom Properties em `globals.css`.

| Token | Light | Dark | Uso principal |
|---|---|---|---|
| `--primary` | `#0a2540` | `#1a6fc4` | Ação principal, títulos e destaques |
| `--secondary` | `#0d9488` | `#0d9488` | Sucesso, aprovado e confirmação |
| `--accent` | `#e07b16` | `#e07b16` | Atenção e pendência |
| `--action-save` | `#0d9488` | `#0d9488` | Salvar e confirmar |
| `--action-edit` | `#1e7fc4` | `#2288d6` | Editar |
| `--action-danger` | `#dc2626` | `#ef4444` | Excluir, cancelar e ações destrutivas |
| `--background` | `#eef2f5` | `#0d1b2a` | Fundo principal |
| `--card` | `#ffffff` | `#132436` | Cards, painéis e superfícies |
| `--sidebar-bg` | `#0a2540` | `#071829` | Fundo da sidebar |

Regras:

- priorizar tokens em vez de cores fixas;
- manter contraste suficiente;
- usar vermelho apenas para risco, erro ou ação destrutiva;
- usar âmbar para atenção e prazo;
- usar teal para sucesso ou confirmação;
- não criar nova paleta por módulo sem decisão visual explícita.

---

# 3. Dark Mode

O tema escuro é ativado pela classe:

```text
.dark
```

aplicada ao elemento `<html>`.

O controle é realizado pelo `ThemeToggle` da Topbar.

Persistência:

```text
localStorage('erp-theme')
```

O tema deve respeitar `prefers-color-scheme` quando não houver escolha persistida.

Todo componente novo deve ser validado nos dois temas.

Evitar:

- fundos brancos fixos;
- textos com baixo contraste;
- flashes claros ao abrir drawers ou modais;
- bordas excessivamente brilhantes;
- sombras pesadas incompatíveis com o tema escuro.

---

# 4. Estrutura Geral

A estrutura autenticada do ERP é composta por:

```text
Sidebar
Topbar
Área principal
Elementos globais de feedback
```

Elementos globais incluem, quando aplicável:

- toast;
- notificações;
- chat flutuante;
- modais;
- drawers;
- menus;
- indicadores de carregamento.

Não montar múltiplas instâncias globais do mesmo provider ou listener sem necessidade.

---

# 5. Sidebar

A sidebar é a navegação principal do ERP. As cores usam exclusivamente os tokens `--sidebar-*`
definidos em `globals.css` (validados nos temas claro e escuro) e a tipografia herda a fonte
oficial do projeto (Inter). O item ativo usa contraste claro com destaque teal discreto
(`--sidebar-active-bg` / `--sidebar-active-text` + barra `--sidebar-active-border`).

## Modelo de navegação — Acordeão por seção

Os itens são agrupados em quatro seções colapsáveis, com apenas uma seção aberta por vez:

- **Operação:** Dashboard, Orçamentos, Pedidos (subitens), Conferência, Expedição, Maestro;
- **Cadastros:** Cadastros, Produtos, Verificação CPF/CNPJ;
- **Financeiro:** Contas a receber (subitens), Conta Corrente, Pendências, Notas fiscais, Relatórios;
- **Configurações:** Usuários e Perfis, Perfis e Permissões, Empresas, Integrações, Faturamento e Cobranças, Parâmetros Fiscais.

Regras:

- clicar no cabeçalho de uma seção abre essa seção e fecha a anterior;
- a seção correspondente à rota atual abre automaticamente;
- itens com subitens expandem e recolhem sem navegar;
- itens "em breve" ficam desabilitados, porém visíveis, com badge;
- um bloco fixo de **acesso rápido** (Orçamentos, Conferência) fica no topo;
- a seção **Configurações** só aparece para usuários com permissão administrativa.

A fonte de dados é `navigationSections` (com `quickAccessItems`) em `src/constants/navigation.ts`.

## Desktop

Deve possuir:

- logo ou marca;
- nome do painel;
- item ativo claramente identificado;
- estado expandido e estado recolhido (rail de ícones, ~76px);
- tooltip/flyout quando recolhida, com fallback por clique (não depender só de hover);
- botão de expandir ou recolher;
- identificação do usuário no rodapé.

No modo recolhido, cada seção vira um ícone; ao passar o mouse abre um flyout com os itens da
seção, e clicar no ícone expande a sidebar já com a seção aberta.

## Mobile

A sidebar funciona como drawer, reutilizando a mesma fonte de navegação (`navigationSections`).

Regras:

- não depender de hover;
- fechar com `ESC`, clique fora e após navegação;
- oferecer área de toque adequada;
- impedir rolagem indevida do conteúdo atrás;
- preservar a mesma estrutura de navegação do desktop.

A fonte oficial dos itens de navegação deve ser reutilizada. Não manter menus paralelos por tela.

## Reversão

O menu ativo é selecionado pela feature flag `USE_NEW_SIDEBAR` em `src/constants/featureFlags.ts`.
Com `false`, o `AppLayout` volta ao menu anterior em lista plana (`Sidebar` / `MobileSidebar`),
mantidos intactos como fallback.

---

# 6. Topbar

A Topbar pode conter:

- botão do menu mobile;
- busca global;
- seletor de empresa;
- acesso às pendências;
- notificações;
- seletor de tema;
- menu do usuário.

Regras:

- ações baseadas apenas em ícone precisam de `aria-label`;
- badges devem indicar informação útil, não decoração;
- popovers devem fechar ao clicar fora e com `ESC`;
- o layout deve permanecer utilizável em larguras reduzidas;
- itens secundários podem ser agrupados no mobile.

---

# 7. Busca Global

A busca global foi preparada para localizar:

- clientes;
- propostas;
- pedidos;
- OS;
- boletos;
- notas fiscais;
- CPF ou CNPJ;
- códigos operacionais;
- rastreios.

A fonte atual de dados deve ser confirmada no código antes de qualquer alteração.

Quando uma entidade ainda estiver mockada ou não conectada:

- não apresentar o resultado como dado real;
- manter indicação clara de indisponibilidade;
- não criar consulta direta paralela no componente;
- utilizar o serviço oficial do domínio quando disponível.

---

# 8. Seletor de Empresa

Opções conhecidas:

- Todas;
- Ideal;
- Birô;
- E3.

`Todas` representa uma visão consolidada e deve depender da permissão do usuário.

Regras:

- a empresa ativa deve ficar visualmente clara;
- o seletor não deve alterar silenciosamente dados persistidos;
- filtros devem respeitar o contexto oficial;
- telas sem suporte à visão consolidada devem informar a limitação;
- qualquer troca com impacto de escrita exige validação específica.

---

# 9. Dashboard

O Dashboard pode utilizar:

- cards de resumo;
- gráficos;
- atividades recentes;
- alertas;
- atalhos;
- indicadores por empresa.

Os dados podem ser mockados ou reais conforme o estado atual de cada módulo.

Antes de alterar:

- confirmar a fonte;
- confirmar o período;
- confirmar a empresa;
- confirmar permissões;
- preservar a responsividade;
- manter skeleton ou estado vazio adequado.

Gráficos não devem ser usados quando uma tabela ou indicador simples comunicar melhor a informação.

---

# 10. Cabeçalho de Página

Páginas de módulo devem reutilizar o padrão `PageHeader` quando aplicável.

Pode conter:

- título;
- subtítulo;
- contexto;
- breadcrumb;
- status;
- ação principal.

Regras:

- uma ação principal por contexto;
- evitar vários botões concorrendo visualmente;
- não repetir o mesmo título em cards abaixo;
- ações destrutivas não devem ocupar o destaque principal.

---

# 11. Listagens

Padrão recomendado:

- cabeçalho;
- resumo quando relevante;
- filtros;
- busca;
- tabela no desktop;
- cards no mobile;
- paginação ou carregamento incremental;
- skeleton;
- estado vazio;
- tratamento de erro;
- coluna ou menu de ações.

Cards de resumo devem ser usados somente quando ajudarem a decisão operacional.

Não adicionar cards apenas para preencher espaço.

---

# 12. Tabelas

Tabelas devem:

- manter cabeçalhos claros;
- evitar excesso de colunas;
- alinhar valores monetários e números;
- usar badges para estados;
- manter ações na última coluna;
- oferecer feedback de carregamento;
- preservar leitura em dark mode;
- evitar rolagem horizontal no mobile quando cards forem mais adequados.

No desktop, linhas clicáveis precisam indicar visualmente que são interativas.

Não usar clique na linha quando houver risco de conflito com seleção, checkbox ou ações internas.

---

# 13. Cards Mobile

Quando uma tabela não for adequada no mobile, utilizar cards.

Cada card deve priorizar:

1. identificação;
2. status;
3. dado principal;
4. contexto secundário;
5. ações.

Regras:

- evitar texto excessivo;
- manter botões com área de toque adequada;
- não reproduzir todas as colunas da tabela;
- organizar informações em blocos;
- preservar a mesma regra de permissão do desktop.

---

# 14. Filtros

Filtros devem ser:

- claros;
- previsíveis;
- reversíveis;
- persistentes somente quando houver necessidade;
- compatíveis com teclado;
- responsivos.

Filtros avançados podem ficar em accordion ou painel recolhível.

A interface deve oferecer:

- estado aplicado;
- ação de limpar;
- feedback de carregamento;
- contagem quando útil.

Busca em tempo real deve utilizar debounce quando puder gerar consultas frequentes.

---

# 15. Menu de Ações

O padrão é um único botão ou menu `Ações` por registro.

Comportamento esperado:

- abre por clique;
- não depende de hover;
- fecha ao clicar fora;
- fecha com `ESC`;
- fecha após escolher uma ação;
- fecha quando outro menu é aberto;
- calcula posição no viewport;
- abre para cima quando necessário;
- no mobile pode usar bottom sheet.

Ações devem respeitar permissões.

Não renderizar ação proibida apenas para bloqueá-la depois, salvo quando a UX exigir explicar o motivo.

Ações destrutivas precisam de confirmação quando houver risco real.

---

# 16. Botões

Hierarquia:

- primário: ação principal;
- secundário: alternativa segura;
- ghost: ação de baixo peso;
- destrutivo: exclusão ou cancelamento;
- ícone: ação compacta com `aria-label`.

Regras:

- texto deve indicar a ação;
- evitar rótulos genéricos como “OK”;
- estado carregando deve impedir duplo clique;
- botão desabilitado deve comunicar o motivo quando necessário;
- não usar cor como único indicador de estado.

---

# 17. Toasts e Notificações

O componente global é `AppToast`.

Tipos:

- sucesso;
- erro;
- alerta;
- informação.

Padrões:

- aparecer no topo;
- entrada suave;
- não bloquear a tela;
- fechamento automático;
- fechamento manual;
- mensagem curta e objetiva.

Toasts não substituem:

- confirmação;
- mensagem persistente;
- detalhe de erro;
- estado vazio;
- bloqueio de segurança.

Ações manuais não podem exibir sucesso quando a persistência falhar.

Erros técnicos devem ser traduzidos para linguagem funcional.

---

# 18. Modais

Use modal centralizado quando a ação exigir:

- foco;
- revisão de contexto;
- múltiplos campos;
- confirmação estruturada;
- comparação antes e depois.

Padrões:

- título claro;
- subtítulo contextual;
- botão de fechar;
- largura adequada;
- scroll interno;
- rodapé visível;
- ação principal e secundária;
- foco inicial controlado;
- fechamento com `ESC` quando seguro;
- retorno do foco ao elemento de origem.

No mobile:

- largura quase total;
- campos empilhados;
- botões grandes;
- conteúdo sem compressão.

Não usar modal para informação simples que poderia ser apresentada na página.

---

# 19. Drawers

Drawers são adequados para:

- chat;
- detalhe rápido;
- filtros;
- ações contextuais;
- navegação mobile.

Regras:

- não usar drawer estreito para formulários extensos;
- preservar contexto da tela;
- fechar com `ESC`;
- bloquear rolagem de fundo quando necessário;
- manter cabeçalho e ação de fechar;
- evitar múltiplos drawers empilhados;
- manter foco acessível.

---

# 20. Popovers

Popovers servem para:

- notificações;
- seletores;
- menus contextuais;
- atalhos rápidos.

Devem:

- abrir próximos ao acionador;
- permanecer dentro do viewport;
- fechar com clique externo;
- fechar com `ESC`;
- possuir navegação por teclado;
- não esconder ações críticas.

---

# 21. Bottom Sheets

No mobile, bottom sheets podem substituir menus de ação e seletores compactos.

Regras:

- altura adaptável;
- gesto ou botão claro de fechamento;
- ações com área de toque;
- conteúdo sem rolagem horizontal;
- título contextual;
- foco preservado.

---

# 22. Formulários

Formulários devem:

- agrupar campos relacionados;
- indicar obrigatoriedade;
- validar no momento adequado;
- preservar valores após erro;
- mostrar mensagens próximas ao campo;
- evitar layouts excessivamente densos;
- usar grid no desktop e pilha no mobile.

Não enviar dados automaticamente sem ação clara do usuário.

Alterações sensíveis devem apresentar confirmação.

---

# 23. Estados de Interface

Todo fluxo deve prever:

## Carregamento

Usar skeleton quando a estrutura for conhecida.

Spinner isolado é adequado apenas para ações curtas ou elementos pequenos.

## Estado vazio

Deve explicar:

- o que está vazio;
- por que pode estar vazio;
- qual ação útil está disponível.

## Erro

Deve informar:

- o que não foi possível fazer;
- se houve alteração ou não;
- como tentar novamente.

## Sem permissão

Deve diferenciar ausência de dado de falta de acesso.

## Desabilitado

Deve informar o motivo quando o usuário puder razoavelmente esperar a ação.

---

# 24. Responsividade

## Desktop

- sidebar fixa;
- tabelas completas;
- formulários em grid;
- ações em menus;
- densidade administrativa moderada.

## Tablet

- reduzir colunas;
- reorganizar filtros;
- preservar ações principais;
- evitar sobreposição da sidebar.

## Mobile

- drawer de navegação;
- cards no lugar de tabelas;
- campos empilhados;
- botões maiores;
- ações em bottom sheet;
- nenhuma dependência de hover;
- nenhuma rolagem horizontal desnecessária.

A responsividade deve ser validada no fluxo real, não apenas em uma tela vazia.

---

# 25. Acessibilidade

Regras mínimas:

- `aria-label` em botões apenas com ícone;
- labels associados aos inputs;
- ordem de tabulação previsível;
- foco visível;
- fechamento por `ESC`;
- contraste adequado;
- texto alternativo em imagens relevantes;
- não usar cor como único indicador;
- mensagens de erro identificáveis;
- áreas de toque adequadas;
- suporte a teclado em menus, popovers e dialogs.

Não remover outline de foco sem oferecer substituto visível.

---

# 26. Balão do Chat Global

O `GlobalChatBubble` oferece acesso rápido ao Chat Interno em telas autenticadas.

## Botão

Padrão documentado:

```text
h-14 w-14
fixed bottom-6 right-6
z-[60]
```

Características:

- formato circular;
- fundo baseado em `--primary`;
- ícone de alto contraste;
- hover discreto;
- sombra suficiente para separar do conteúdo;
- posição que não obstrua ações importantes.

## Badge

Pode exibir um ponto de atividade contextual:

```text
h-3 w-3
top-1.5 right-1.5
```

O indicador aparece apenas quando houver atividade relevante para o usuário.

Não usar animação pulsante contínua sem necessidade.

## Popover

Padrão:

```text
largura aproximada: 320px
rounded-2xl
```

Seções:

- contexto da página;
- conversas recentes.

Regras:

- adaptar altura ao viewport;
- permitir scroll interno;
- fechar com `ESC`;
- evitar colisão com elementos fixos;
- preservar permissões e RLS;
- reutilizar uma única instância do drawer global.

---

# 27. Central de Pendências

A rota `/pendencias` utiliza uma interface administrativa focada em operação.

## Cards de resumo

Podem representar:

- minhas pendências;
- pendências do setor;
- sem responsável;
- urgentes;
- atrasadas;
- concluídas hoje.

Os cards podem atuar como filtros rápidos quando isso estiver claramente indicado.

## Filtros

Podem incluir:

- pesquisa;
- empresa;
- setor;
- categoria;
- status;
- prioridade.

Filtros avançados podem ficar recolhidos para reduzir saturação.

## Desktop

Utilizar tabela com:

- contraste moderado;
- linhas interativas;
- acesso à proposta;
- acesso ao chat;
- status;
- prioridade;
- prazo;
- responsável.

## Mobile

Utilizar cards com:

- prioridade visual;
- prazo;
- responsável;
- ações acessíveis;
- ausência de rolagem lateral.

## Destaques

Urgente:

```text
border-l-red-500
bg-red-500/5
```

Atrasada:

```text
border-l-amber-500
bg-amber-500/5
```

A mesma semântica deve ser usada na Central e no Drawer do Chat.

---

# 28. Desempenho e Fluidez

## Carregamento sob demanda

Dados auxiliares pesados não devem ser carregados no mount sem necessidade.

Exemplos:

- lista completa de usuários;
- opções extensas de autocomplete;
- anexos pesados;
- detalhes secundários.

Preferir carregamento no foco, abertura ou interação real.

## Consultas

Separar:

- dados estáticos;
- dados dinâmicos;
- eventos realtime.

Atualizações realtime não devem recarregar tabelas estáticas sem necessidade.

## Debounce

Aplicar em:

- pesquisa textual;
- autocomplete;
- filtros que consultam servidor.

## Cache

Cache deve possuir:

- escopo claro;
- tempo de vida;
- invalidação;
- proteção contra dados de outro contexto.

Nunca reutilizar cache de uma empresa, cliente ou proposta em outro contexto.

---

# 29. Realtime

Listeners devem ser:

- únicos quando possível;
- desmontados corretamente;
- filtrados pelo contexto;
- protegidos contra duplicidade;
- atualizados sem recarregar toda a página.

Não criar uma nova subscrição por card ou linha quando um canal central puder atender ao módulo.

---

# 30. Menções

Menções `@` devem:

- usar autocomplete quando disponível;
- diferenciar texto digitado de usuário realmente selecionado;
- evitar notificações para menções não estruturadas;
- preservar acessibilidade;
- carregar usuários sob demanda;
- não bloquear o envio da mensagem quando a gravação auxiliar da menção falhar.

A falha da menção pode ser não bloqueante.

A falha da mensagem principal deve ser informada ao usuário.

---

# 31. Tradução de Erros

Erros técnicos devem ser convertidos em mensagens funcionais.

Não exibir diretamente:

- RLS;
- constraint;
- foreign key;
- nome de policy;
- nome de tabela;
- stack trace;
- payload;
- token.

Exemplo:

```text
Você não possui permissão para alterar esta pendência.
```

em vez de uma mensagem técnica do banco.

Os detalhes podem ser registrados em log seguro para diagnóstico.

---

# 32. Componentes Oficiais

Antes de criar um componente novo, investigar se já existe:

- PageHeader;
- AppToast;
- Badge;
- Dialog;
- Drawer;
- Skeleton;
- Menu de ações;
- Empty State;
- SummaryCard;
- Bottom Sheet;
- Table;
- Card mobile.

Não duplicar componentes com pequenas variações visuais.

Quando um padrão precisar evoluir, alterar o componente oficial sem quebrar os módulos existentes.

---

# 33. Regras de Implementação

Toda alteração de UX/UI deve:

- preservar a arquitetura modular;
- respeitar componentes existentes;
- não criar solução paralela;
- manter dark mode;
- validar mobile;
- respeitar permissões;
- manter feedback de erro;
- evitar refatoração fora do escopo;
- não conectar banco apenas para ajustar interface;
- não alterar regra de negócio por conveniência visual.

A interface não é fonte de autorização.

Botão oculto ou desabilitado não substitui validação no backend ou RLS.

---

# 34. Checklist de Validação

Antes de concluir uma alteração visual, validar:

- tema claro;
- tema escuro;
- desktop;
- tablet;
- mobile;
- navegação por teclado;
- foco visível;
- `ESC`;
- clique fora;
- loading;
- estado vazio;
- erro;
- sem permissão;
- texto longo;
- dados nulos;
- menu próximo ao fim do viewport;
- modal com conteúdo extenso;
- ausência de rolagem horizontal;
- contraste;
- `aria-label`;
- duplo clique;
- regressão nos componentes reutilizados.

---

# 35. Documentação Relacionada

- `../PROJECT_CONTEXT.md`
- `../DEVELOPMENT.md`
- `../SECURITY.md`
- `../architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md`
- `./PERFIS-PERMISSOES.md`
- `../business/CHAT-INTERNO.md`

---

# Fonte da Verdade

Este documento define os padrões oficiais de experiência e interface do ERP Ideal.

A implementação atual dos componentes deve ser confirmada no código antes de qualquer alteração.

Nenhum padrão visual autoriza mudança de regra de negócio, permissão ou escrita no banco.

Quando houver componente oficial para uma função, ele deve ser reutilizado ou evoluído em vez de duplicado.
