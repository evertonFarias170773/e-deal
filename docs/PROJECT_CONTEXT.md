# PROJECT_CONTEXT.md

Versão: 2.0
Status: Oficial
Última atualização: 18/07/2026
Projeto: ERP Ideal

---

# Contexto do Projeto

O ERP Ideal é um sistema de gestão empresarial desenvolvido para atender a operação completa de uma gráfica, integrando processos comerciais, financeiros, produtivos, fiscais e administrativos em uma única plataforma.

O sistema representa a operação real da empresa. Sempre que existir diferença entre uma simplificação técnica e o processo operacional, prevalecem as regras de negócio.

Seu desenvolvimento é contínuo, priorizando estabilidade, rastreabilidade, segurança e evolução sem regressões.

---

# Objetivo do ERP

Centralizar toda a operação da empresa em um único sistema, garantindo que todas as áreas compartilhem informações consistentes e utilizem os mesmos fluxos oficiais.

Os principais módulos do ERP são:

- Comercial
- Clientes
- Propostas
- Produção
- Financeiro
- Fiscal
- Expedição
- Cadastros
- Chat Interno
- Maestro

Cada módulo possui responsabilidades específicas, porém todos fazem parte de um único fluxo operacional.

---

# Filosofia do Projeto

O ERP foi desenvolvido para preservar os processos da empresa e não para adaptá-los às limitações da tecnologia.

Por esse motivo:

- as regras de negócio possuem prioridade sobre decisões técnicas;
- cada responsabilidade possui um fluxo oficial;
- alterações devem preservar compatibilidade com os módulos existentes;
- a evolução do sistema deve ocorrer com o menor impacto possível.

---

# Fluxo Comercial

O fluxo comercial representa a operação principal do ERP.

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

Cada etapa possui regras próprias e responsabilidades distintas.

---

# Fluxo Financeiro

O fluxo financeiro é independente da produção.

Sua sequência é:

Proposta

↓

Cobrança

↓

Pagamento

↓

Conciliação

↓

Baixa

O encerramento financeiro não altera o histórico comercial nem produtivo.

---

# Relação entre os Módulos

Os módulos não funcionam de forma isolada.

Uma proposta liberada manualmente com `is_prd_aprovado = true` passa a integrar a fila de pedidos.

O pedido alimenta a Produção.

A cobrança pertence ao fluxo financeiro.

O pagamento encerra apenas o fluxo financeiro.

Cada módulo possui responsabilidades próprias e nunca substitui outro módulo.

---

# Identificadores Oficiais

O ERP utiliza identificadores padronizados para manter a integridade entre os módulos.

## id_int

É a principal chave operacional do sistema.

Sempre que possível deve ser utilizada para relacionar informações entre os módulos.

Nunca criar identificadores paralelos.

---

## id_cliente

É o identificador oficial dos clientes.

Sempre preservar sua utilização como referência principal.

---

# Fontes Oficiais de Dados

Clientes

public.clientes

---

Propostas

public.propostas

---

Boletos e Contas a Receber

```text
public.boletos
```

Representam títulos bancários, vencimentos, atrasos e liquidação.

---

Cobranças e Pagamentos

```text
public.pagamentos_v2
```

Representam cobranças, confirmações e recebimentos do fluxo financeiro.

Boletos e `pagamentos_v2` possuem responsabilidades diferentes e nunca devem ser tratados como equivalentes.

---

# Maestro

O Maestro é a camada de inteligência do ERP.

Sua função é interpretar solicitações dos usuários, consultar informações oficiais do sistema e auxiliar na execução das operações permitidas.

O Maestro nunca substitui as regras de negócio do ERP.

Toda resposta deve respeitar:

- permissões;
- segurança;
- documentação oficial;
- fluxos existentes.

---

# Arquitetura

O ERP utiliza arquitetura modular.

Cada responsabilidade possui um único fluxo oficial.

Sempre reutilize implementações existentes antes de criar novas soluções.

---

# Tecnologias

O projeto utiliza:

- Next.js
- React
- TypeScript
- TailwindCSS
- shadcn/ui
- Supabase
- Edge Functions
- n8n

---

# Escopo deste Documento

Este documento apresenta apenas o contexto geral do ERP.

Ele não define:

- arquitetura detalhada;
- regras completas de negócio;
- segurança;
- padrões de desenvolvimento.

Esses assuntos são tratados na documentação específica.

---

# Ordem de Leitura

Para compreender o projeto, utilize a seguinte sequência:

1. DOCUMENTATION_INDEX.md
2. PROJECT_CONTEXT.md
3. AI_AGENTS.md
4. SECURITY.md
5. architecture/ARQUITETURA.md
6. BUSINESS_RULES.md
7. DEVELOPMENT.md

Após isso, consulte apenas a documentação relacionada ao domínio da tarefa.

---

# Documentação por Domínio

Quando necessário, consulte apenas o domínio relacionado ao trabalho em execução.

Exemplos:

- Maestro
- Financeiro
- Produção
- Technical
- Architecture
- History

---

# Fonte da Verdade

Este documento apresenta a visão geral do ERP Ideal.

Quando houver dúvidas sobre regras específicas, consulte a documentação oficial do domínio correspondente antes de modificar qualquer comportamento do sistema.
