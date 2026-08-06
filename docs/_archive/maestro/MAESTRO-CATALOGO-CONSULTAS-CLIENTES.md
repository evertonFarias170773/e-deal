# MAESTRO-CATALOGO-CONSULTAS-CLIENTES.md

Versão: 2.0  
Status: Oficial  
Última atualização: 18/07/2026  
Projeto: Vibe

---

# Catálogo de Consultas de Clientes do Maestro

Este documento define as capacidades de consulta do Maestro para os domínios de Clientes, Comercial e Financeiro.

Seu objetivo é impedir respostas ambíguas, preservar a separação entre cadastro, venda, cobrança, boleto e recebimento e indicar a fonte oficial de cada resposta.

Este catálogo trata apenas de consultas. Ele não autoriza escrita no Supabase.

---

# Princípios Gerais

O Maestro deve:

- resolver o cliente ativo antes de consultar dados;
- usar `id_cliente` como chave cadastral;
- informar quando houver mais de um cliente compatível;
- consultar somente fontes conectadas e autorizadas;
- respeitar RLS, sessão, perfil e escopo;
- citar a fonte utilizada;
- diferenciar dado cadastral de comportamento histórico;
- informar quando não encontrou dados;
- nunca completar lacunas com suposições.

---

# Separação Conceitual Obrigatória

## Padrão de pagamento cadastrado

Representa a condição registrada no cadastro do cliente.

Fonte:

```text
public.clientes.padrao_pagamento
```

Responde perguntas como:

- “Qual é o padrão de pagamento dele?”
- “Como esse cliente está cadastrado para pagar?”
- “Ele é faturado?”

Esse campo não comprova que o cliente paga em dia.

---

## Comportamento real de pagamento

Representa o histórico observado nas operações financeiras.

Fontes:

```text
public.pagamentos_v2
public.boletos
```

Uso:

- `public.pagamentos_v2`: cobranças, recebimentos, confirmação financeira e histórico geral;
- `public.boletos`: títulos bancários, vencimentos, atrasos, multa e juros.

Responde perguntas como:

- “Ele costuma pagar em dia?”
- “Tem boleto atrasado?”
- “Qual foi o último pagamento?”
- “Quanto ele já pagou?”

Nunca usar apenas o padrão cadastrado para responder sobre comportamento real.

---

## Faturamento recebido

A fonte principal é:

```text
public.pagamentos_v2
```

Um recebimento é considerado aprovado quando:

```text
status = PAID
```

ou, para recebimento futuro autorizado:

```text
status = A_VENCER
AND confirmado = true
```

Para perguntas sobre valor efetivamente recebido, priorizar registros `PAID` e valores liquidados.

`A_VENCER` confirmado representa compromisso futuro aprovado, não dinheiro já recebido.

---

## Boletos em aberto ou atraso

A fonte oficial é:

```text
public.boletos
```

Usar essa fonte para:

- vencimento;
- dias de atraso;
- multa;
- juros;
- linha de cobrança bancária;
- carteira de Contas a Receber.

Não responder inadimplência de boleto apenas com `public.pagamentos_v2` quando os campos específicos estiverem em `public.boletos`.

---

## Vendas comerciais

A fonte oficial é:

```text
public.propostas
```

Usar para:

- quantidade de propostas;
- valores comerciais;
- propostas abertas;
- maior proposta;
- histórico comercial;
- vendedor;
- empresa;
- status comercial.

Proposta não é pagamento.

Proposta não é boleto.

---

## Pedidos e entrada na Produção

A entrada oficial na fila de Produção depende de:

```text
public.propostas.is_prd_aprovado = true
```

Essa flag deve ser usada para diferenciar uma proposta comercial de um pedido liberado para Produção.

`status_interno = APROVADO` sozinho não comprova entrada na fila produtiva.

---

# Resolução do Cliente

Antes de responder qualquer pergunta, o Maestro deve identificar o cliente correto.

Fontes possíveis:

```text
public.clientes
vw_cadastros_clientes_lista
```

Chave operacional:

```text
id_cliente
```

## Regras

- usar o cliente ativo no contexto quando existir;
- confirmar quando houver nomes semelhantes;
- não usar apenas o nome como chave definitiva;
- não misturar dados de clientes diferentes;
- não assumir que código exibido e identificador interno são equivalentes sem confirmação do adapter;
- interromper a consulta quando o cliente não puder ser resolvido com segurança.

---

# Catálogo de Consultas Cadastrais

## Identificação do cliente

Perguntas:

- “Quem é esse cliente?”
- “Qual é o CNPJ dele?”
- “Qual é o código do cliente?”
- “Qual é a empresa ou razão social?”

Fonte principal:

```text
public.clientes
```

Campos dependem do adapter oficial e da whitelist autorizada.

A resposta deve mascarar documentos quando a política de segurança exigir.

---

## Padrão de pagamento

Perguntas:

- “Qual é o padrão de pagamento dele?”
- “Como esse cliente paga?”
- “Ele é faturado?”
- “Qual é a forma de pagamento padrão?”

Fonte:

```text
public.clientes.padrao_pagamento
```

Resposta esperada:

- informar o valor cadastrado;
- deixar claro que se trata de uma condição cadastral;
- informar ausência quando estiver nulo ou vazio.

Exemplo:

> O padrão de pagamento cadastrado para este cliente é FATURADO.

Não concluir que o cliente paga em dia apenas por esse campo.

---

## Limite de crédito

Perguntas:

- “Qual é o limite de crédito?”
- “Ele possui crédito?”
- “Quanto ainda tem disponível?”

Fontes:

```text
public.clientes.limite_credito
public.clientes.credito
```

Regras:

- apresentar limite total e crédito disponível separadamente;
- usar formatação monetária;
- informar quando um dos campos não estiver disponível;
- não tratar crédito disponível como pagamento recebido;
- exigir cliente ativo corretamente resolvido.

---

## Restrição cadastral

Perguntas:

- “Ele tem alguma restrição?”
- “O cadastro está bloqueado?”
- “Existe observação de restrição?”

Fonte:

```text
public.clientes.restricao
```

Regras:

- informar apenas o conteúdo permitido;
- não interpretar automaticamente texto livre como decisão financeira;
- não confundir restrição cadastral com atraso de boleto;
- não transformar ausência de texto em aprovação de crédito.

---

## Risco de crédito

Perguntas:

- “Qual é o risco de crédito?”
- “Qual é a classificação de risco?”
- “Esse cliente é de alto risco?”

Fonte:

```text
public.clientes.risco_credito
```

Regras:

- retornar a classificação cadastrada;
- identificar que é um dado cadastral;
- não recalcular risco por conta própria;
- não substituir análise financeira oficial.

---

## Status do cadastro

Perguntas:

- “O cliente está ativo?”
- “Qual é o status do cadastro?”
- “Esse cadastro está inativo?”

Fonte:

```text
public.clientes.ativo
```

Regras:

- informar ativo ou inativo;
- não confundir cadastro ativo com crédito aprovado;
- não confundir cadastro ativo com ausência de restrições.

---

## Endereços

Perguntas:

- “Qual é o endereço dele?”
- “Qual endereço deve ser usado no frete?”
- “Ele tem mais de um endereço?”

Fonte:

```text
public.enderecos
```

Regras:

- filtrar sempre por `id_cliente`;
- apresentar tipo do endereço quando disponível;
- pedir confirmação quando houver múltiplos endereços relevantes;
- não escolher endereço de entrega por suposição;
- não alterar endereço neste catálogo.

---

## Contatos

Perguntas:

- “Quem é o contato?”
- “Qual é o telefone?”
- “Tem WhatsApp?”
- “Qual é o e-mail?”

Fonte:

```text
public.contatos
```

Regras:

- filtrar por `id_cliente`;
- apresentar apenas campos permitidos;
- diferenciar contato principal de outros contatos quando essa informação existir;
- não expor dados de outro cliente.

---

## Vínculos comerciais

Perguntas:

- “Esse cliente possui empresas vinculadas?”
- “Quem são os autorizados?”
- “Existe cliente relacionado?”

Fonte:

```text
public.clientes_socios
```

Regras:

- tratar a tabela como vínculo comercial;
- não assumir que todo vínculo representa sócio fiscal;
- diferenciar vínculos internos de dados obtidos por API de CNPJ.

---

# Catálogo de Consultas Comerciais

## Propostas abertas

Perguntas:

- “Quais propostas abertas esse cliente possui?”
- “Tem orçamento em andamento?”
- “Qual foi a última proposta?”

Fonte:

```text
public.propostas
```

Filtros mínimos:

```text
id_cliente = cliente ativo
```

A classificação de “aberta” deve seguir o fluxo oficial de status e excluir estados finais conforme a regra vigente.

Não inventar uma lista fixa de status sem consultar a implementação oficial.

---

## Histórico comercial

Perguntas:

- “Quantas propostas ele já teve?”
- “Qual foi a maior venda?”
- “Quanto ele comprou?”
- “Qual vendedor atende esse cliente?”

Fonte:

```text
public.propostas
```

Regras:

- diferenciar proposta criada de pedido liberado;
- diferenciar valor comercial de valor recebido;
- informar o período analisado;
- evitar somar propostas canceladas ou reprovadas quando a pergunta for sobre vendas válidas;
- declarar o critério aplicado.

---

## Pedidos liberados para Produção

Perguntas:

- “Quais pedidos esse cliente possui?”
- “Qual foi o último pedido?”
- “Esse orçamento já virou pedido?”

Fonte:

```text
public.propostas
```

Regra operacional:

```text
is_prd_aprovado = true
```

Quando aplicável, considerar também flags de reprovação ou cancelamento previstas no fluxo atual.

Não tratar toda proposta aprovada comercialmente como pedido produtivo.

---

# Catálogo de Consultas Financeiras

## Recebimentos

Perguntas:

- “Quanto esse cliente já pagou?”
- “Qual foi o último pagamento?”
- “Ele possui cobrança pendente?”
- “Qual é o histórico de recebimentos?”

Fonte:

```text
public.pagamentos_v2
```

Regras:

- filtrar por `id_cliente`;
- usar `PAID` para valores recebidos;
- usar `A_VENCER` com `confirmado = true` apenas como recebimento futuro aprovado;
- excluir registros cancelados, estornados ou recusados conforme o fluxo oficial;
- informar o período analisado;
- não exibir campos sensíveis.

---

## Boletos

Perguntas:

- “Ele possui boletos?”
- “Tem boleto vencido?”
- “Quantos dias de atraso?”
- “Qual é o valor em aberto?”

Fonte:

```text
public.boletos
```

Regras:

- filtrar por `id_cliente`;
- usar vencimento e dias de atraso da fonte oficial;
- distinguir boleto em aberto de pagamento recebido;
- não apresentar linha digitável, código de barras ou URL de cobrança fora do fluxo autorizado;
- não cancelar ou alterar títulos por este catálogo.

---

## Comportamento de pagamento

Perguntas:

- “Ele paga em dia?”
- “Costuma atrasar?”
- “Qual é o comportamento financeiro?”

Fontes:

```text
public.boletos
public.pagamentos_v2
```

A resposta deve ser descritiva e baseada em dados suficientes.

Regras:

- informar o período analisado;
- separar quantidade paga, vencida e pendente;
- não criar score próprio;
- não afirmar comportamento recorrente com uma única ocorrência;
- não confundir faturado aprovado com pagamento recebido;
- informar quando não houver histórico suficiente.

---

# Regras de Resposta

Toda resposta baseada em dados reais deve conter, de forma simples:

- cliente consultado;
- resultado;
- período quando relevante;
- critério aplicado;
- fonte utilizada;
- limitação encontrada.

Exemplo de estrutura:

> O cliente possui 2 boletos vencidos, totalizando R$ X, no período consultado.  
> Fonte: `public.boletos`.

O Maestro não precisa expor SQL, payloads ou detalhes internos para o usuário final.

---

# Dados Sensíveis

O Maestro nunca deve exibir diretamente:

```text
token_publico
public_token
pix_copia_cola
linha_digitavel
codigo_barras
url_cobranca
id_fatura
payload_envio
payload_retorno
chave_nfe
caminho_xml
caminho_danfe
```

Documentos pessoais devem seguir o mascaramento definido nas regras de segurança.

---

# Permissões

Consultas cadastrais, comerciais e financeiras devem respeitar:

- sessão autenticada;
- perfil do usuário;
- permissões granulares;
- escopo de vendedor, empresa ou setor;
- RLS;
- campos permitidos pelo adapter.

O fato de uma tool existir não significa que todo usuário possa acessar todos os seus dados.

---

# Falhas e Ausência de Dados

Quando não encontrar dados, o Maestro deve dizer claramente:

> Não encontrei essa informação para o cliente selecionado.

Quando a tool não estiver conectada:

> Essa consulta ainda não está disponível no Maestro.

Quando houver ambiguidade:

> Encontrei mais de um cliente compatível. Confirme qual deseja consultar.

Nunca substituir ausência por exemplo fictício.

---

# Escrita Bloqueada Neste Catálogo

Este catálogo autoriza somente leitura.

Ele não autoriza:

- alterar cliente;
- alterar limite de crédito;
- criar proposta;
- cancelar cobrança;
- confirmar pagamento;
- mudar status;
- liberar pedido para Produção;
- modificar boleto;
- criar migration, trigger, RPC, view ou policy.

Qualquer futura escrita deve possuir tool específica, permissão, confirmação, auditoria e autorização na Matriz de Segurança.

---

# Validação Obrigatória

Antes de homologar uma consulta, validar:

- cliente correto;
- filtro por `id_cliente`;
- isolamento entre clientes;
- fonte correta para cada pergunta;
- diferença entre cadastro e histórico;
- diferença entre proposta e pedido;
- diferença entre boleto e pagamento;
- tratamento de valores nulos;
- período consultado;
- mascaramento de dados;
- permissões e RLS;
- ausência de campos sensíveis;
- resposta sem dados inventados;
- fonte apresentada corretamente.

---

# Documentação Relacionada

- `./MAESTRO-KNOWLEDGE-BASE.md`
- `./MAESTRO-VISAO-PRODUTO.md`
- `./STATUS-MAESTRO-V2.md`
- `../BUSINESS_RULES.md`
- `../SECURITY.md`
- `../technical/PERFIS-PERMISSOES.md`
- `../business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md`
- `../business/CHECKOUT-PAGAMENTOS.md`

---

# Fonte da Verdade

Este documento define como o Maestro deve interpretar e responder consultas de Clientes, Comercial e Financeiro.

As tabelas oficiais definem os dados.

A base de conhecimento define as relações entre entidades.

Os documentos de segurança e permissões definem os limites de acesso.

Nenhuma pergunta em linguagem natural autoriza o Maestro a misturar fontes, inventar regras ou executar escrita.
