# Maestro — Roadmap Operacional Simples

> **Filosofia:** Antes de expandir arquitetura, fazer o básico funcionar muito bem.
> Uma pergunta real do usuário justifica cada nova feature. Nada de camadas sem uso real.

---

## Status das Fases

| Fase | Descrição | Status |
|------|-----------|--------|
| **1** | Cliente 100% | 🟡 Em progresso |
| **2** | Propostas/orçamentos por cliente | ✅ Concluída |
| **3** | Detalhe de proposta por `id_int` | ✅ Concluída |
| **4** | Produtos e itens do orçamento | ⬜ Próximo |
| **5** | Frete do orçamento | ⬜ Planejado |
| **6** | Montagem assistida de orçamento | ⬜ Planejado |
| **7** | Salvamento controlado de rascunho | ⬜ Planejado |
| **8** | Pagamentos/cobranças | ⬜ Planejado |
| **9** | Produção/OS | ⬜ Planejado |

---

## Fase 1 — Cliente 100%

### Perguntas que DEVEM funcionar

| Pergunta | Tool | Status |
|----------|------|--------|
| `cliente 8469` | `clientes.consultar` | ✅ Funciona |
| `qual o telefone dele?` | contexto ativo | 🟡 Melhorar resposta direta |
| `qual o CNPJ dele?` | contexto ativo | 🟡 Melhorar resposta direta |
| `qual o e-mail dele?` | contexto ativo | 🟡 Melhorar resposta direta |
| `qual cidade ele fica?` | contexto ativo | 🟡 Melhorar resposta direta |
| `quem é o vendedor desse cliente?` | contexto ativo | 🟡 Melhorar resposta direta |
| `esse cliente tem crédito?` | contexto ativo | 🟡 Melhorar resposta direta |
| `qual foi o último pedido/orçamento dele?` | `propostas.consultar_por_cliente` | ✅ Funciona |

### O que já funciona
- ✅ Consulta de cliente por código numérico (`cliente 8469`, `#8469`)
- ✅ Card com razão social, CNPJ, telefone, email, cidade, vendedor, crédito
- ✅ Contexto do cliente preservado entre mensagens
- ✅ Perguntas com "ele", "dele", "desse cliente" usam o cliente ativo

### O que ainda precisa melhorar
- 🟡 Respostas diretas e curtas para campos específicos (telefone, CNPJ, cidade)
- 🟡 Fallback mais informativo quando o campo não está conectado
- 🟡 Reconhecimento de "vendedor", "crédito", "limite" como perguntas de perfil

---

## Fase 2 — Propostas/Orçamentos por Cliente ✅ Concluída

- ✅ `qual o último orçamento feito para o cliente 8469?`
- ✅ Lista propostas por `id_cliente`
- ✅ Ordena por `created_at DESC`
- ✅ Cita fonte: `public.propostas`

---

## Fase 3 — Detalhe de Proposta por `id_int` ✅ Concluída

- ✅ `e qual valor da proposta 18555?`
- ✅ Consulta `public.propostas WHERE id_int = 18555`
- ✅ Exibe: id_int, status, valor (valor_total ?? valor), data, empresa, vendedor
- ✅ Cita fonte: `public.propostas · filtro: id_int = N`
- ✅ Entidade explícita vence contexto anterior de cliente

---

## Fase 4 — Produtos e Itens do Orçamento ⬜

**Perguntas alvo:**
- `quais são os produtos da proposta 18555?`
- `qual a quantidade do item X nessa proposta?`
- `qual o preço unitário de cada item?`

**Tabelas:** `propostas_itens` ou similar — verificar estrutura antes de implementar.

**Pré-requisito:** Fase 3 100% homologada.

---

## Fase 5 — Frete do Orçamento ⬜

**Perguntas alvo:**
- `qual o frete da proposta 18555?`
- `qual o valor de frete para SP?`

**Nota:** Nunca alterar lógica de peso_total ou vw_proposta_completa sem autorização explícita.

**Pré-requisito:** Fase 4 concluída.

---

## Fase 6 — Montagem Assistida de Orçamento ⬜

**Perguntas alvo:**
- `quero criar um orçamento para o cliente 8469`
- `adicionar produto X, quantidade 100`

**Nota:** Apenas assistência — nenhuma escrita antes da leitura estar homologada.

---

## Fase 7 — Salvamento Controlado de Rascunho ⬜

**Regra obrigatória:**
- Confirmação explícita do usuário antes de qualquer escrita
- Log de todas as operações
- Rollback possível
- Nunca INSERT/UPDATE direto — apenas via RPC controlada

---

## Fase 8 — Pagamentos/Cobranças ⬜

**Nota:** Nunca alterar `pagamentos_v2` ou `creditos` sem confirmação explícita.

---

## Fase 9 — Produção/OS ⬜

**Perguntas alvo:**
- `qual o status de produção do pedido 18555?`
- `em qual etapa está a OS X?`

---

## Regra de Simplicidade

> Estas regras governam a evolução do Maestro. Violá-las gera débito técnico.

1. **Nenhuma nova camada sem uma pergunta real do usuário para justificar.**
   - Antes de criar uma nova tool, arquitectura ou specialist, um usuário real precisa ter feito a pergunta.

2. **Nenhuma tool nova sem teste manual definido.**
   - Toda nova tool precisa de um script de validação: "pergunta → resposta esperada".

3. **Nenhuma escrita antes da leitura estar homologada.**
   - A leitura de um domínio precisa funcionar 100% antes de implementar escrita.

4. **Nenhuma resposta genérica quando houver contexto ativo.**
   - Se o cliente X está no contexto, qualquer fallback deve mencionar o cliente X pelo nome.
   - Nunca responder "não entendi o que você quis dizer" quando há contexto suficiente.

5. **Citar sempre a fonte quando o dado for real.**
   - "Fonte: public.propostas · filtro: id_int = N"
   - "Fonte: vw_cadastros_clientes_lista · id_cliente = 8469"

6. **Nunca inventar dados.**
   - Se o campo vier nulo, dizer claramente. Nunca inferir ou completar.

---

## Princípio de Resposta

```
❌ Ruim:  "Não consegui entender sua pergunta."
✅ Bom:   "Entendi que você está falando do cliente EMPRESA X (8469),
           mas o campo 'limite de crédito' ainda não está conectado
           ao Maestro nesta versão."

❌ Ruim:  "Valor: —" (sem explicação)
✅ Bom:   "O valor da proposta #18555 não está disponível no registro
           consultado (valor_total e valor estão nulos)."
```

---

## Histórico de Implementação

| Data | Entrega |
|------|---------|
| 2026-07-03 | Knowledge Base Canônica do ERP implantada |
| 2026-07-03 | LLM real (OpenAI) ativado server-side |
| 2026-07-03 | Tool `clientes.consultar` conectada (read-only) |
| 2026-07-03 | Tool `propostas.consultar_por_cliente` conectada (read-only) |
| 2026-07-04 | Tool `propostas.consultar_por_id_int` conectada (read-only) |
| 2026-07-04 | Regra: entidade explícita vence contexto anterior |
| 2026-07-04 | Campo `valor` adicionado como fallback de `valor_total` |
