# Arquitetura

## Stack

- Next.js App Router
- React
- TypeScript
- TailwindCSS
- lucide-react
- Recharts
- ESLint

## Estrutura de pastas

```text
src/
  app/
  components/
  features/
  lib/
public/
  logos/
docs/
modulos/
```

## `src/app`

Contém rotas, layouts e páginas do App Router.

Rotas principais atuais:

- `/login`
- `/dashboard`
- `/cadastros`
- `/cadastros/novo`
- `/cadastros/[id]`
- `/cadastros/[id]/editar`
- `/produtos`
- `/produtos/novo`
- `/produtos/[id]`
- `/produtos/[id]/editar`
- `/orcamentos`
- `/orcamentos/novo`
- `/orcamentos/[id]`
- `/orcamentos/[id]/editar`

## `src/components`

Contém componentes reutilizáveis globais.

Principais grupos:

- `app-shell`: layout autenticado, sidebar, topbar, busca global, seletor de empresa e menu de usuário.
- `common`: componentes genéricos como `PageHeader`, `SummaryCard`, `StatusBadge`, `ActionsMenu`, `ResponsiveList`, `AppToast`, estados vazios e skeletons.

## `src/features`

Contém módulos funcionais do ERP. Cada módulo deve concentrar telas, componentes e tipos próprios quando fizer sentido.

Módulos atuais:

- `auth`
- `companies`
- `dashboard`
- `cadastros`
- `produtos`
- `orcamentos`

## `src/lib`

Contém utilitários, formatadores, navegação, tipos globais e mocks.

Subpastas importantes:

- `src/lib/mocks`: dados mockados locais.
- `src/lib/formatters`: formatação de moeda, data, documento e status.

## Dados mockados

Os mocks ficam em `src/lib/mocks`.

Mocks atuais:

- `usuarios.mock.ts`
- `empresas.mock.ts`
- `dashboard.mock.ts`
- `global-search.mock.ts`
- `cadastros.mock.ts`
- `produtos.mock.ts`
- `variacoes.mock.ts`
- `propostas.mock.ts`

## Variações globais

O módulo Produtos usa variações globais reutilizáveis. Produtos não criam variações próprias: eles apenas vinculam variações existentes.

Responsabilidades conceituais:

- `variacoes`: grupo da variação.
- `tipos_variacoes`: opções/modelos da variação, com valor extra e peso.
- `produto_variacoes`: vínculo entre produto e variação existente.
- `produtos_proposta_variacao`: escolha feita no orçamento/proposta.

A manutenção futura de `variacoes` e `tipos_variacoes` deve ficar em Configurações.

## Services reais futuros

Quando Supabase for integrado, criar services por domínio, preferencialmente próximos dos módulos ou em uma camada dedicada, por exemplo:

```text
src/features/cadastros/services/
src/features/produtos/services/
src/features/orcamentos/services/
```

Os services reais devem substituir gradualmente os mocks, mantendo as telas e componentes com o menor acoplamento possível.
