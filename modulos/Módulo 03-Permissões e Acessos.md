# Módulo 03 — Permissões e Acessos

## Objetivo

Controlar o que cada usuário pode ver, acessar e executar dentro do ERP.

Este módulo usa os dados carregados após o login e após a identificação do perfil interno do usuário na tabela `public.usuarios`.

A autenticação responde:

> Quem está logado?

O perfil interno responde:

> Quem é esse usuário dentro do ERP?

O módulo de permissões responde:

> O que esse usuário pode fazer?

---

## Dependências

Este módulo depende diretamente de:

- Módulo 01 — Autenticação / Login
- Módulo 02 — Usuários / Perfis Internos

A fonte principal de dados do usuário é:

`public.usuarios`

Campos usados para permissões:

- `user_id`
- `email`
- `nome_usuario`
- `is_admin`
- `is_super_adm`
- `is_vendedor`
- `id_empresa`
- `setor`
- `id_vendedor`
- `meu_vendedor`

---

## Regra principal

Nenhuma tela sensível deve ser liberada apenas porque o usuário está autenticado.

O usuário precisa:

1. Estar logado no Supabase Auth.
2. Ter registro em `public.usuarios`.
3. Ter permissão compatível com o módulo ou ação.

---

## Níveis principais de acesso

### Super administrador

Identificado por:

`is_super_adm = true`

Pode acessar áreas globais do sistema.

Uso esperado:

- ver todas as empresas;
- trocar contexto de empresa;
- acessar configurações avançadas;
- gerenciar usuários;
- acessar módulos fiscais, financeiros e administrativos;
- visualizar relatórios consolidados;
- executar ações críticas, se autorizado.

Este é o nível mais alto.

---

### Administrador

Identificado por:

`is_admin = true`

Pode acessar áreas administrativas, mas pode ser limitado por empresa ou setor.

Uso esperado:

- gerenciar dados operacionais;
- acessar relatórios;
- consultar financeiro;
- acompanhar fiscal;
- ajustar cadastros;
- aprovar ou revisar ações internas, conforme regra.

---

### Vendedor / Atendente

Identificado por:

`is_vendedor = true`

Pode operar áreas comerciais.

Uso esperado:

- acessar clientes;
- criar propostas;
- acompanhar seus pedidos;
- consultar pagamentos relacionados;
- ver histórico comercial;
- iniciar fluxos de orçamento.

Pode ser limitado por:

- `id_vendedor`
- `meu_vendedor`
- `id_empresa`

---

### Usuário por setor

Identificado por:

`setor`

O campo `setor` define a área operacional do usuário.

Setores sugeridos:

- COMERCIAL
- FINANCEIRO
- FISCAL
- PRODUCAO
- ADMIN
- SISTEMA

A lista final precisa ser confirmada.

---

## Contexto de empresa

A coluna:

`id_empresa`

define a empresa padrão do usuário.

Empresas conhecidas:

- `1` — Ideal Gráfica
- `2` — Ideal Birô
- `3` — E3 Brindes

Regras esperadas:

### Usuário comum

Normalmente acessa apenas dados da própria empresa.

### Admin

Pode acessar dados da própria empresa e, se permitido, outras empresas.

### Super admin

Pode acessar todas as empresas e trocar o contexto ativo.

---

## Controle de menu

O menu lateral e as rotas devem ser montados com base nas permissões do usuário.

Exemplo:

### Comercial

Pode ver:

- Clientes
- Propostas
- Pedidos
- Produtos
- Consulta de crédito, se permitido

### Financeiro

Pode ver:

- Contas a receber
- Pagamentos
- Boletos
- Lista a faturar
- Crédito
- Relatórios financeiros

### Fiscal

Pode ver:

- NF-e
- NFS-e
- Validações fiscais
- Documentos fiscais
- Configurações fiscais, se permitido

### Produção

Pode ver:

- OS
- Pedidos aprovados
- Etapas de produção
- Anexos
- Histórico de produção

### Admin / Super admin

Pode ver:

- Usuários
- Empresas
- Configurações
- Relatórios administrativos
- Fiscal
- Financeiro
- Auditoria, se existir

---

## Controle de ações

Além de controlar páginas, o sistema deve controlar ações.

Exemplos de ações sensíveis:

- Emitir NF-e
- Emitir NFS-e
- Cancelar NF-e
- Cancelar NFS-e
- Confirmar pagamento
- Cancelar cobrança
- Trocar empresa emitente
- Alterar status financeiro
- Aprovar faturamento
- Alterar limite de crédito
- Excluir ou inativar cliente
- Criar ou editar usuários
- Alterar permissões
- Acessar relatórios consolidados

Essas ações não devem aparecer ou devem ficar bloqueadas para usuários sem permissão.

---

## Padrão de bloqueio

Quando o usuário tentar acessar algo sem permissão:

Mensagem recomendada:

> Você não tem permissão para acessar esta área.

Para ação específica:

> Você não tem permissão para executar esta ação.

Nunca mostrar erro técnico como mensagem principal.

---

## Regras por módulo

### Clientes

Permissões possíveis:

- Ver clientes
- Criar cliente
- Editar cliente
- Inativar cliente
- Ver crédito do cliente
- Criar proposta para cliente

Acesso recomendado:

- Comercial
- Financeiro
- Admin
- Super admin

---

### Propostas / Orçamentos

Permissões possíveis:

- Ver propostas
- Criar proposta
- Editar proposta
- Alterar status
- Duplicar proposta
- Cancelar proposta
- Gerar OS
- Enviar para financeiro
- Emitir documentos fiscais a partir da proposta

Acesso recomendado:

- Comercial
- Admin
- Super admin

---

### Financeiro

Permissões possíveis:

- Ver pagamentos
- Criar cobrança
- Confirmar pagamento
- Cancelar pagamento
- Gerar boleto
- Enviar cobrança
- Alterar tipo de cobrança
- Ver resumo financeiro
- Aprovar faturado

Acesso recomendado:

- Financeiro
- Admin
- Super admin

Usuário comercial pode ter acesso limitado apenas aos pagamentos das suas propostas.

---

### Boletos

Permissões possíveis:

- Ver boletos
- Gerar boleto
- Baixar PDF
- Enviar WhatsApp
- Atualizar status
- Confirmar pagamento
- Cancelar boleto
- Prorrogar vencimento

Acesso recomendado:

- Financeiro
- Admin
- Super admin

---

### NF-e

Permissões possíveis:

- Ver NF-e
- Criar rascunho
- Editar rascunho
- Validar NF-e
- Preparar envio
- Emitir NF-e
- Atualizar status
- Baixar DANFE
- Baixar XML
- Clonar rascunho
- Trocar empresa emitente
- Cancelar NF-e

Acesso recomendado:

- Fiscal
- Admin
- Super admin

Ações críticas:

- Emitir NF-e
- Cancelar NF-e
- Trocar empresa emitente

Devem exigir confirmação.

---

### NFS-e

Permissões possíveis:

- Ver NFS-e
- Criar rascunho
- Editar rascunho
- Validar NFS-e
- Preparar envio
- Emitir NFS-e
- Atualizar status
- Baixar DANFSE
- Baixar XML
- Clonar rascunho
- Trocar empresa emitente
- Cancelar NFS-e

Acesso recomendado:

- Fiscal
- Admin
- Super admin

Ações críticas:

- Emitir NFS-e
- Cancelar NFS-e
- Trocar empresa emitente

Devem exigir confirmação.

---

### OS / Produção

Permissões possíveis:

- Ver OS
- Criar OS
- Alterar etapa
- Adicionar observação
- Anexar arquivo
- Finalizar etapa
- Finalizar OS
- Cancelar OS

Acesso recomendado:

- Produção
- Comercial, com acesso limitado
- Admin
- Super admin

---

### Produtos

Permissões possíveis:

- Ver produtos
- Criar produto
- Editar produto
- Ativar/inativar produto
- Editar variações
- Editar valores
- Editar dados fiscais do produto

Acesso recomendado:

- Admin
- Super admin
- Comercial com acesso limitado para consulta

---

### Relatórios

Permissões possíveis:

- Ver relatórios próprios
- Ver relatórios por empresa
- Ver relatórios consolidados
- Exportar relatório
- Gerar PDF
- Ver indicadores financeiros

Acesso recomendado:

- Admin
- Super admin
- Financeiro, conforme tipo de relatório
- Comercial, apenas relatórios próprios ou permitidos

---

### Configurações

Permissões possíveis:

- Gerenciar empresas
- Gerenciar usuários
- Gerenciar parâmetros fiscais
- Gerenciar formas de pagamento
- Gerenciar integrações
- Gerenciar permissões

Acesso recomendado:

- Super admin
- Admin, com limitação

---

## Permissões no front

O front deve usar componentes de proteção.

Componentes sugeridos:

- `PermissionGate`
- `RoleGuard`
- `ModuleGuard`
- `ActionGuard`
- `CompanyGuard`

Exemplo conceitual:

- Se usuário não pode ver financeiro, não mostrar menu Financeiro.
- Se usuário não pode emitir NF-e, não mostrar botão Emitir.
- Se usuário não pode cancelar pagamento, esconder ou bloquear ação Cancelar.

Mas esconder botão no front não é segurança suficiente.

A regra real precisa estar também no backend quando a ação for crítica.

---

## Permissões no backend

Ações críticas devem ser protegidas por:

- RPC segura;
- Edge Function;
- RLS;
- validações internas no banco.

O front nunca deve fazer update direto para ações sensíveis.

Exemplos:

Não fazer direto pelo front:

- alterar `status` de NF-e para AUTORIZADA;
- confirmar pagamento;
- cancelar cobrança;
- trocar empresa de nota fiscal;
- alterar status financeiro;
- mudar `is_admin` ou `is_super_adm`.

Preferir RPCs como:

- `fn_trocar_empresa_nfe`
- `fn_trocar_empresa_nfse`
- funções de confirmação financeira
- funções de atualização de status
- funções de emissão/preparação fiscal

---

## Modelo simples de permissões inicial

Como a tabela `usuarios` ainda não possui uma estrutura granular de permissões, o primeiro modelo pode usar:

- `is_super_adm`
- `is_admin`
- `is_vendedor`
- `setor`
- `id_empresa`

Exemplo inicial:

### `is_super_adm = true`

Acesso total.

### `is_admin = true`

Acesso administrativo, limitado conforme empresa e setor.

### `setor = FINANCEIRO`

Acesso financeiro.

### `setor = FISCAL`

Acesso fiscal.

### `setor = PRODUCAO`

Acesso OS/produção.

### `is_vendedor = true`

Acesso comercial.

---

## Possível evolução futura

Se o sistema precisar de permissões mais detalhadas, criar futuramente uma estrutura separada.

Sugestão:

### Tabela `permissoes`

Campos possíveis:

- `id`
- `codigo`
- `descricao`
- `modulo`
- `acao`

Exemplos de códigos:

- `clientes.ver`
- `clientes.editar`
- `propostas.criar`
- `financeiro.confirmar_pagamento`
- `nfe.emitir`
- `nfse.cancelar`
- `usuarios.editar_permissoes`

### Tabela `usuarios_permissoes`

Campos possíveis:

- `id`
- `user_id`
- `permissao`
- `permitido`

### Tabela `perfis_acesso`

Campos possíveis:

- `id`
- `nome`
- `descricao`

Mas isso é evolução futura.  
Não criar agora sem necessidade.

---

## Permissões e RLS

RLS deve proteger dados sensíveis no banco.

Regras possíveis:

- usuário comum vê apenas registros da sua empresa;
- vendedor vê apenas seus clientes/propostas;
- financeiro vê registros financeiros da empresa;
- super admin vê tudo.

Como o banco está em produção, qualquer alteração de RLS deve ser feita com diagnóstico e teste.

Não ativar políticas restritivas sem revisar impactos no FlutterFlow, n8n, Edge Functions e RPCs.

---

## Controle de empresa ativa

O sistema deve carregar uma empresa ativa no contexto.

Para usuário comum:

- empresa ativa = `usuarios.id_empresa`

Para super admin:

- pode selecionar empresa ativa;
- pode visualizar todas;
- pode trocar empresa no topo do sistema.

Esse contexto deve influenciar:

- filtros;
- dashboard;
- relatórios;
- criação de documentos;
- emissão fiscal;
- financeiro.

---

## Ações que devem exigir confirmação

Sempre confirmar antes de:

- emitir NF-e;
- emitir NFS-e;
- cancelar NF-e;
- cancelar NFS-e;
- cancelar proposta;
- cancelar pagamento;
- confirmar pagamento;
- trocar empresa emitente;
- excluir ou inativar cadastro;
- alterar permissão de usuário;
- tornar usuário admin ou super admin.

---

## Mensagens recomendadas

### Sem acesso ao módulo

> Você não tem permissão para acessar este módulo.

### Sem acesso à ação

> Você não tem permissão para executar esta ação.

### Ação crítica

> Esta ação pode afetar dados fiscais ou financeiros. Confirme para continuar.

### Troca de empresa

> A troca de empresa pode alterar o contexto fiscal, financeiro e operacional deste registro.

---

## O que este módulo faz

Este módulo define:

- quais menus aparecem;
- quais rotas podem ser acessadas;
- quais ações ficam disponíveis;
- quais empresas o usuário pode acessar;
- quais módulos o usuário pode operar;
- quais ações exigem confirmação;
- quais ações precisam ser protegidas no backend.

---

## O que este módulo não faz

Este módulo não faz login.

Não salva senha.

Não substitui a tabela `usuarios`.

Não deve criar permissões novas no banco sem revisão.

Não deve liberar ação crítica apenas pelo front.

Não deve usar `service_role` no navegador.

---

## Componentes necessários

- `PermissionProvider`
- `PermissionGate`
- `ModuleGuard`
- `ActionGuard`
- `CompanySwitcher`
- `CompanyContextProvider`
- `UnauthorizedPage`
- `ForbiddenActionDialog`
- `CriticalActionConfirmDialog`

---

## Telas necessárias

### Sem permissão

Página para bloqueio de módulo.

### Ação não permitida

Modal ou alerta para ação bloqueada.

### Gerenciamento de permissões

Tela futura, apenas para admin/super admin.

### Seleção de empresa

Para super admin ou usuários com acesso multiempresa.

---

## Regras para Cursor/Codex

Ao trabalhar com permissões:

- não assumir acesso total para usuário logado;
- não criar permissão nova sem mapear com o sistema;
- não expor dados de todas as empresas para usuário comum;
- não deixar ação crítica apenas com proteção visual;
- não colocar `service_role` no front;
- não alterar RLS sem diagnóstico;
- não alterar flags administrativas sem confirmação;
- não criar tabela de permissões agora sem autorização.

---

## Primeira implementação sugerida

Etapa 1:

- criar `PermissionProvider`;
- carregar usuário atual da tabela `usuarios`;
- criar helpers:
  - `isSuperAdmin`
  - `isAdmin`
  - `isVendedor`
  - `hasSetor`
  - `canAccessModule`
  - `canExecuteAction`

Etapa 2:

- proteger menus;
- proteger rotas;
- proteger botões de ações críticas.

Etapa 3:

- criar contexto de empresa ativa;
- permitir troca de empresa para super admin.

Etapa 4:

- mapear permissões por módulo;
- revisar com o Everton antes de codificar regras definitivas.

---

## Resultado esperado

Ao final deste módulo, o sistema deve:

- esconder módulos não permitidos;
- bloquear rotas sem permissão;
- bloquear ações críticas;
- respeitar empresa do usuário;
- liberar visão global para super admin;
- diferenciar admin, vendedor e setores;
- preparar base para permissões granulares no futuro.

---

## Pendências para revisão do Everton

1. Confirmar lista oficial de setores.
2. Confirmar se `is_super_adm` terá acesso total.
3. Confirmar diferença prática entre `is_admin` e `is_super_adm`.
4. Confirmar se vendedor vê apenas seus dados ou todos da empresa.
5. Confirmar se financeiro vê todas as empresas ou só sua empresa.
6. Confirmar quem pode emitir NF-e.
7. Confirmar quem pode emitir NFS-e.
8. Confirmar quem pode confirmar pagamento.
9. Confirmar quem pode cancelar pagamento.
10. Confirmar quem pode trocar empresa emitente.
11. Confirmar se será necessário criar permissões granulares no futuro.