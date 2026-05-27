# ERP Ideal Mockado

## Visão geral

O ERP Ideal é um sistema gráfico/comercial/fiscal voltado para operação real de vendas, cadastros, propostas, produção, financeiro e emissão fiscal.

Esta versão é a primeira base visual mockada do projeto. O objetivo atual é validar experiência de uso, layout administrativo, responsividade, navegação, componentes globais e padrões de operação antes de conectar dados reais.

## Estado atual

- Há conexão com Supabase somente para leitura no módulo de Cadastros.
- Não há migrations.
- Não há backend real.
- Não há chamadas de escrita reais.
- Os dados continuam com fallback mockado em `src/lib/mocks`.
- A arquitetura segue preparada para futura conexão com Supabase módulo por módulo.

## Módulos com tela inicial

- Login mockado.
- Layout autenticado com sidebar, topbar, busca global e seletor de empresa.
- Dashboard com cards e gráficos mockados.
- Cadastros com listagem e detalhe lidos do Supabase em modo read-only, além de novo cadastro e edição mockada/simulada.
- Produtos com listagem, detalhe, novo produto, edição, fotos e variações mockadas.
- Orçamentos/Propostas com lista, detalhe, nova proposta, edição, produtos, frete, resumo e envio informal mockados.

## Integração Supabase

O primeiro módulo conectado ao Supabase é `Cadastros`, em modo somente leitura.

Para o app funcionar corretamente, o ambiente local precisa ter:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

O MCP do Supabase ajuda o Cursor durante o desenvolvimento e diagnóstico, mas não substitui o `.env.local` do projeto Next.js.

## Como rodar

Instalar dependências:

```bash
npm install
```

Rodar em desenvolvimento:

```bash
npm run dev
```

Validar build:

```bash
npm run build
```

Validar lint:

```bash
npm run lint
```

## Regra de atualização da documentação

Sempre que uma etapa importante for implementada ou alterada, atualizar:

- `MODULOS-IMPLEMENTADOS.md`
- `CHANGELOG.md`
- `PROXIMOS-PASSOS.md`

Sempre que uma decisão técnica for tomada, atualizar:

- `DECISOES-TECNICAS.md`

Sempre que um padrão visual ou componente global for criado/alterado, atualizar:

- `PADROES-UX-UI.md`

## Nota de publicação

Commit documental para disparar novo deployment automático na Vercel quando necessário.
