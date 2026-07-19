# BUSINESS_RULES.md

Versão: 3.0
Status: Oficial
Última atualização: 18/07/2026
Projeto: ERP Ideal

---

# Regras Oficiais de Negócio

Este documento define as regras permanentes do ERP Ideal.

As implementações podem evoluir.

As regras de negócio permanecem.

Sempre que existir conflito entre implementação e regra operacional, prevalece a regra de negócio oficialmente definida.

---

# Princípio Fundamental

Nunca deduza regras de negócio.

Quando houver dúvida:

- consulte a documentação oficial;
- preserve o comportamento existente;
- investigue antes de alterar.

---

# Conceitos Fundamentais

Cada módulo possui responsabilidades próprias.

Nenhum módulo substitui outro.

Nunca confunda:

- Comercial;
- Financeiro;
- Produção;
- Fiscal;
- Cadastros.

Eles compartilham informações, mas executam funções diferentes.

---

# Fontes Oficiais

## Clientes

Fonte oficial:

public.clientes

Identificador principal:

id_cliente

---

## Propostas

Fonte oficial:

public.propostas

Identificador principal:

id_int

Toda operação comercial nasce de uma proposta.

---

## Produtos da Proposta

Representam exatamente o que foi negociado com o cliente.

Nunca substituir essas informações pelos dados do pedido.

---

## Pedidos

O pedido produtivo é uma proposta liberada manualmente para Produção.

Critério operacional:

```text
public.propostas.is_prd_aprovado = true
```

Aprovação comercial ou `status_interno` isolado não substitui essa regra.

Ele representa o início oficial da execução operacional.

Pedido nunca substitui:

- proposta;
- cobrança;
- pagamento.

---

## Produção

A Produção executa a proposta liberada como pedido.

O trabalho preliminar de arte pode começar antes da confirmação financeira, mas a entrada oficial na fila produtiva depende de `is_prd_aprovado = true`.

A Produção nunca altera silenciosamente o histórico comercial ou financeiro da proposta.

---

## Cobranças e Pagamentos

Fonte operacional:

```text
public.pagamentos_v2
```

Representa cobranças, confirmações e recebimentos do fluxo financeiro.

## Boletos e Contas a Receber

Fonte oficial:

```text
public.boletos
```

Representa títulos bancários, vencimentos, atrasos e liquidação.

Não confundir `public.boletos` com `public.pagamentos_v2`.

Cada tabela possui responsabilidade específica.

---

# Identificadores Oficiais

## id_int

É a principal chave operacional do ERP.

Sempre preservar.

Nunca criar identificadores paralelos.

---

## id_cliente

É o identificador oficial dos clientes.

Sempre utilizar como referência principal.

---

# Fluxo Comercial

Cliente

↓

Proposta

↓

Aprovação

↓

Pedido

↓

Produção

↓

Expedição

↓

Faturamento

Cada etapa possui responsabilidades próprias.

---

# Fluxo Financeiro

Proposta

↓

Cobrança

↓

Pagamento

↓

Conciliação

↓

Baixa

O fluxo financeiro é independente da produção.

Uma alteração financeira não modifica o histórico operacional.

---

# Status

Utilize apenas os status oficiais do ERP.

Nunca:

- criar status paralelos;
- alterar significado de status existentes;
- utilizar status para representar regras diferentes.

---

# Cancelamentos

Sempre respeitar a regra oficial do módulo.

Quando existir cancelamento lógico, ele deve ter prioridade sobre exclusões físicas.

---

# Permissões

Toda operação deve respeitar:

- autenticação;
- empresa ativa;
- perfil do usuário;
- permissões administrativas;
- regras específicas do módulo.

---

# Maestro

O Maestro atua como camada de inteligência do ERP.

Ele deve sempre:

- consultar informações oficiais;
- respeitar permissões;
- preservar regras de negócio.

Nunca deve:

- inventar informações;
- assumir comportamentos;
- responder sem evidências.

---

# Integrações

Toda integração deve preservar:

- identificadores;
- rastreabilidade;
- contratos existentes;
- compatibilidade entre módulos.

---

# Escopo

Este documento define apenas as regras permanentes de negócio.

Não define:

- arquitetura;
- segurança;
- desenvolvimento;
- implementação técnica.

Esses assuntos possuem documentação própria.

---

# Princípios Inegociáveis

Nunca confundir:

- proposta com pedido;
- proposta com cobrança;
- boleto com pagamento;
- comercial com financeiro;
- financeiro com produção.

Nunca alterar regras de negócio por conveniência técnica.

---

# Checklist

Antes de concluir qualquer alteração confirme:

- regras preservadas;
- fluxos preservados;
- identificadores preservados;
- permissões respeitadas;
- nenhuma regra oficial modificada.

---

# Documentação Relacionada

- PROJECT_CONTEXT.md
- AI_AGENTS.md
- SECURITY.md
- architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md
- DEVELOPMENT.md

---

# Fonte da Verdade

Quando houver dúvida sobre o funcionamento do ERP, considere sempre esta documentação como referência para as regras permanentes de negócio.

Implementações podem mudar.

As regras de negócio permanecem.
