# Padrões UX/UI

## Direção visual

O ERP deve ter aparência administrativa moderna, limpa e produtiva, evitando visual genérico ou poluído.

Paleta tokenizada (CSS Custom Properties em `globals.css`):

| Token | Light | Dark | Uso |
|---|---|---|---|
| `--primary` | `#0a2540` | `#1a6fc4` | Azul escuro — headers, botão principal, badge |
| `--secondary` | `#0d9488` | `#0d9488` | Teal — sucesso, aprovado |
| `--accent` | `#e07b16` | `#e07b16` | Laranja — atenção, pendente |
| `--action-save` | `#0d9488` | `#0d9488` | Verde/teal — salvar, confirmar |
| `--action-edit` | `#1e7fc4` | `#2288d6` | Azul claro — editar |
| `--action-danger` | `#dc2626` | `#ef4444` | Vermelho — excluir, cancelar |
| `--background` | `#eef2f5` | `#0d1b2a` | Fundo da página |
| `--card` | `#ffffff` | `#132436` | Fundo de cards |
| `--sidebar-bg` | `#0a2540` | `#071829` | Fundo da sidebar (sempre escuro) |

Dark Mode: ativado via classe `.dark` no `<html>`. Alternado por `ThemeToggle` na Topbar. Persiste em `localStorage('erp-theme')`. Respeita `prefers-color-scheme` do sistema.

## Sidebar

Desktop:

- Sidebar clara por padrão.
- Estado expandido com logo/marca, ícone e nome do módulo.
- Estado recolhido com apenas ícones e tooltip no hover.
- Botão de recolher/expandir no desktop.
- Usuário no rodapé.
- Item ativo com fundo teal suave.

Mobile:

- Sidebar vira drawer.
- Não depende de hover.

## Topbar

A topbar contém:

- Botão de abrir menu no mobile.
- Busca global.
- Seletor de empresa.
- Menu de usuário no mobile.

## Busca global

A busca global fica preparada para pesquisar:

- cliente;
- proposta;
- pedido;
- OS;
- boleto;
- nota fiscal;
- documento CPF/CNPJ;
- código de rastreio.

Na versão atual, a busca usa resultados mockados de `src/lib/mocks/global-search.mock.ts`.

## Seletor de empresa

Opções atuais:

- Todas
- Ideal
- Biro
- E3

`Todas` é o padrão para visão gerencial/consolidada. O Dashboard já muda visualmente com base na empresa selecionada, usando mocks.

## Dashboard

O Dashboard usa:

- cards de resumo;
- gráficos mockados com Recharts;
- tabela/lista de atividades recentes;
- layout responsivo.

Gráficos atuais:

- vendas por mês;
- contas a receber por status;
- propostas por status;
- vendas por empresa.

## Listas

Padrão de listagem:

- `PageHeader` com título, subtítulo, contexto e ação principal.
- Cards de resumo quando útil.
- Filtros no topo.
- Tabela no desktop.
- Cards no mobile.
- Estado vazio.
- Loading skeleton quando necessário.
- Status como badge.
- Coluna final `Ações`.

## Menu de ações

O padrão é um único botão/menu `Ações` por linha.

Comportamento atual:

- abre por clique;
- não abre por hover;
- fecha ao clicar fora;
- fecha com `ESC`;
- fecha ao clicar em uma ação;
- fecha quando outro menu abre;
- calcula posição no viewport;
- abre para cima quando estiver perto do final da tela;
- no mobile abre como bottom sheet.

## Toast e notificações

O componente global é `AppToast`.

Padrões:

- aparece no topo;
- animação suave de entrada;
- tipos: sucesso, erro, alerta e informação;
- não bloqueia a tela;
- desaparece automaticamente;
- pode ser fechado manualmente.

Usado atualmente no fluxo de salvar Cadastros e em ações mockadas de endereço, contato e vínculo comercial.

## Modais e dialogs

Quando uma ação exigir foco, revisão de contexto e múltiplos campos, prefira modal centralizado em vez de painel lateral estreito.

Padrões:

- cabeçalho com título claro, subtítulo contextual e botão de fechar;
- largura confortável no desktop, evitando compressão de campos importantes;
- conteúdo com scroll interno quando necessário;
- rodapé fixo ou claramente visível com ação primária e secundária;
- no mobile, usar largura quase total, conteúdo empilhado e botões grandes;
- o modal deve manter hierarquia visual limpa com cards claros, bordas suaves e boa respiração.

## Responsividade

Desktop:

- sidebar fixa;
- tabelas completas;
- formulários em grid;
- ações em menus.

Mobile:

- drawer lateral;
- cards no lugar de tabelas;
- campos empilhados;
- botões grandes;
- ações em bottom sheet.

## Balão do Chat Global

O widget `GlobalChatBubble` é posicionado no canto inferior direito de todas as telas autenticadas:

- **Estética**:
  - Botão circular de diâmetro `h-14 w-14` flutuante no canto inferior direito (`fixed bottom-6 right-6 z-[60]`).
  - Utiliza cores tokenizadas: fundo `--primary` e ícone branco no modo padrão, ou glassmorphic com bordas sutis para dark mode.
  - Efeito hover com escala leve (`hover:scale-105`) e sombra projetada pronunciada para dar profundidade de camada.
- **Badge de Atividade**:
  - Exibe um pequeno ponto circular azul pulsante (`h-3 w-3` na posição `top-1.5 right-1.5`) em vez de um contador numérico invasivo.
  - A badge é contextual: ela aparece apenas quando o usuário está visualizando uma proposta com menções pendentes não lidas direcionadas a ele.
- **Painel Popover**:
  - Abre-se verticalmente logo acima do botão flutuante.
  - Largura fixa de `320px` e cantos arredondados (`rounded-2xl`).
  - Seções distintas:
    - **Contexto da Página**: Exibe atalho para o chat do item ativamente visualizado (ex: Orçamento em foco ou último orçamento do cliente).
    - **Conversas Recentes**: Lista as últimas 5 propostas com atividade recente de chat no sistema.
  - Altura e scroll adaptáveis para evitar transbordamento vertical ou colisão com elementos do layout principal.
