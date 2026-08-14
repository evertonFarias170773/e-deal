# PERFIS-PERMISSOES.md

Versão: 3.0  
Status: Oficial  
Última atualização: 18/07/2026  
Projeto: Vibe

---

# Perfis e Permissões

Este documento define o estado funcional e os limites atuais do módulo de Perfis e Permissões.

A autorização de escrita é definida pela Matriz de Segurança. A existência de uma tela, botão, modal ou service não significa que a persistência esteja liberada.

---

# 1. Fontes Principais

Catálogo de perfis:

```text
public.perfis
```

Usuários e vínculo de perfil:

```text
public.usuarios
public.usuarios.id_perfil
```

A autenticação permanece no Supabase Auth.

O enriquecimento do usuário utiliza os dados de `public.usuarios` e `public.perfis` após a sessão ser estabelecida.

---

# 2. Estrutura do Perfil

Campos conhecidos de `public.perfis`:

```text
id
slug
nome
descricao
permissoes
ativo
created_at
updated_at
```

A coluna `permissoes` armazena um array JSONB de chaves.

Exemplo:

```json
[
  "propostas.view",
  "propostas.edit",
  "cobrancas.view"
]
```

O perfil `super_admin` pode utilizar o wildcard:

```text
*
```

Nenhum outro perfil deve receber esse wildcard.

---

# 3. Estado Atual de Leitura e Escrita

## `public.perfis`

| Operação | Estado |
|---|---|
| `READ` | Liberado |
| `INSERT` | Bloqueado |
| `UPDATE` | Bloqueado |
| `DELETE` | Bloqueado |

A interface pode exibir o catálogo e preparar uma edição, mas não deve afirmar sucesso de persistência enquanto a Matriz mantiver a escrita bloqueada.

## `public.usuarios.id_perfil`

| Operação | Estado |
|---|---|
| `READ` | Liberado |
| `INSERT` | Bloqueado |
| `UPDATE` | Bloqueado |

A tela de gestão de usuários não autoriza mudança real do perfil nesta fase.

Qualquer modal existente deve permanecer desabilitado, diagnóstico ou claramente identificado como não persistente até a Matriz ser atualizada.

---

# 4. Fallback Legado

Quando `id_perfil` estiver vazio, o sistema pode usar temporariamente:

```text
is_super_adm
is_admin
is_vendedor
setor
```

Esse fallback existe para preservar a operação durante a transição.

Ele não deve:

- elevar privilégio por ausência de cadastro;
- transformar usuário desconhecido em administrador;
- permanecer em cache após logout;
- substituir a migração gradual para permissões granulares.

---

# 5. Resolução de Permissões

Helpers conhecidos:

```text
hasPermissao()
hasAnyPermissao()
hasAllPermissoes()
```

A resolução deve considerar:

1. sessão autenticada;
2. usuário correspondente;
3. perfil ativo;
4. permissões do perfil;
5. wildcard apenas para `super_admin`;
6. escopo de dados;
7. empresa;
8. setor;
9. fallback legado, quando necessário.

Permissão visual não substitui validação no backend ou RLS.

---

# 6. Escopo de Dados

Níveis padronizados:

```text
own
team
company
all
```

O escopo deve ser resolvido pelo helper oficial, como `getDataScope`, quando disponível.

Regras:

- `own`: registros do próprio usuário;
- `team`: registros do setor ou equipe;
- `company`: registros da empresa;
- `all`: acesso global autorizado.

Não criar helpers paralelos por módulo sem necessidade.

---

# 7. Proteções Obrigatórias

## Super Admin

- wildcard fixado em `*`;
- nenhuma UI pode remover o wildcard;
- nenhum outro perfil pode recebê-lo;
- alterações sensíveis continuam auditáveis.

## Autoelevação

Um usuário não pode:

- atribuir a si próprio um perfil mais alto;
- conceder wildcard;
- modificar permissões críticas sem fluxo autorizado;
- contornar RLS por chamada direta.

## Auto-privação

Uma futura edição real deve impedir que o último administrador autorizado remova sua própria capacidade de gestão sem um fluxo de recuperação.

## Logout

Todo estado enriquecido deve ser limpo no `signOut`.

Um usuário novo ou não reconhecido deve receber estado neutro e restrito.

---

# 8. Interface Administrativa

Rotas conhecidas:

```text
/configuracoes/usuarios
/configuracoes/perfis
/minha-conta
```

A disponibilidade atual precisa ser confirmada no código.

A interface deve:

- ocultar ações sem permissão;
- bloquear acesso direto;
- explicar ausência de acesso;
- não exibir sucesso sem confirmação do banco;
- diferenciar leitura de edição;
- preservar desktop e mobile.

A rota protegida no frontend não substitui RLS.

---

# 9. RPC de Permissões

Registros históricos mencionam uma RPC segura para edição de permissões.

A existência, assinatura, RLS e autorização atual dessa RPC precisam ser confirmadas antes de qualquer uso.

Enquanto a Matriz mantiver `public.perfis` e `public.usuarios.id_perfil` bloqueados para escrita:

- não criar nova RPC;
- não reativar RPC antiga;
- não executar `UPDATE` direto;
- não liberar o painel para persistência.

Qualquer mudança exige diagnóstico e autorização explícita.

---

# 10. Novos Usuários

O desenho de perfil `pendente_aprovacao` e trigger em `auth.users` permanece condicionado à confirmação do banco.

O arquivo de migration existente é uma proposta e não comprova aplicação.

Antes de alterar Auth:

- confirmar trigger atual;
- confirmar perfil;
- confirmar vínculo em `public.usuarios`;
- confirmar rollback;
- revisar RLS;
- obter autorização explícita.

---

# 11. Catálogo de Permissões

As chaves devem seguir o padrão:

```text
modulo.acao
```

Exemplos:

```text
propostas.view
propostas.edit
propostas.cancelar
cobrancas.view
cobrancas.confirmar
admin.usuarios.view
admin.usuarios.edit
```

Uma chave nova deve:

- existir no catálogo central;
- possuir descrição;
- definir o módulo;
- definir a ação protegida;
- ser aplicada no frontend e backend;
- possuir teste.

Não usar apenas `isAdmin` quando já existir permissão granular homologada.

## Cancelamento de cobrança — duas permissões, escopos diferentes

| Chave | Alcance |
|---|---|
| `cobrancas.cancel` | Poder financeiro pleno: cancela/estorna qualquer cobrança, de qualquer proposta, inclusive as vinculadas à Conta Corrente. |
| `propostas.cancelar_cobranca_nao_paga` | Modo restrito, para o comercial destravar a própria proposta: só cobrança `A_RECEBER`, sem `paid_at`, sem `data_confirmacao`, `confirmado = false`, sem boleto pago vinculado, sem reserva de Conta Corrente, e **apenas** em proposta dentro do escopo do usuário (`verificarEscopoPropostaServerSide`). |

Ambas passam pela mesma rota oficial `POST /api/cobrancas/cancelar-externo`, que revalida
permissão, escopo e estado financeiro no servidor — o payload do cliente nunca é fonte da verdade.
O cancelamento é sempre **lógico** (`status = 'CANCELADO'` + `motivo_cancela`), nunca DELETE físico,
e o autor é registrado em `propostas_chat` pelo servidor.

## Edição de proposta com cobrança — duas permissões, escopos diferentes

| Chave | Alcance |
|---|---|
| `propostas.editar_paga` | Edita proposta com pagamento confirmado de qualquer tipo. Diferença vai para a Conta Corrente do cliente. Perfis: Super Administrador e Vendedor. |
| `propostas.editar_faturado` | Só a proposta cuja cobrança é `E-FATURADO` em `A_VENCER` e não liquidada — dinheiro ainda não recebido. Ajusta o `valor` da cobrança em vez de abrir pendência de Conta Corrente. Perfil: Financeiro (desde 13/08/2026). |

Quem tem `propostas.editar_paga` cobre também o caso do faturado, que é mais brando.
O contrário não vale: `propostas.editar_faturado` não abre proposta paga de verdade.

As duas passam por `POST /api/orcamentos/editar-paga`, que relê cobranças e títulos e
decide o caminho no servidor. As regras de elegibilidade estão em
`src/features/orcamentos/services/faturado-editavel.ts`, com testes em
`scripts/testes/faturado-editavel.test.mts`. Detalhamento do fluxo em
`docs/business/CHECKOUT-PAGAMENTOS.md`, seção Faturado.

---

# 12. Validação

Antes de concluir uma alteração neste módulo, testar:

- login com perfil;
- login sem perfil;
- fallback legado;
- wildcard;
- usuário não cadastrado;
- logout e troca de usuário;
- acesso direto por URL;
- menu desktop;
- menu mobile;
- escopo `own`;
- escopo `team`;
- escopo `company`;
- escopo `all`;
- ausência de sucesso falso;
- bloqueio de escrita;
- comportamento em falha de rede;
- RLS.

---

# 13. Documentação Relacionada

- `../SECURITY.md`
- `../BUSINESS_RULES.md`
- `./MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `./PADROES-UX-UI.md`
- `../history/DECISOES-TECNICAS.md`
- `../history/CHANGELOG.md`

---

# Fonte da Verdade

`public.perfis` é o catálogo de perfis.

`public.usuarios.id_perfil` vincula o usuário ao perfil.

A Matriz de Segurança define se uma escrita está autorizada.

No estado atual, a leitura está liberada e as escritas em perfis e vínculo de perfil permanecem bloqueadas.

Nenhuma interface, fallback ou registro histórico amplia essa autorização.
