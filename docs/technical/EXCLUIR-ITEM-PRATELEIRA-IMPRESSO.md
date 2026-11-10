# Excluir item de prateleira com modelo impresso

> **Data:** 10/11/2026
> **Situação:** migração pronta, **não aplicada**. Espera o OK do Edison, porque o gatilho alterado é do lado Imposition.
> **Arquivos:**
> - Migração: [EXCLUIR-ITEM-PRATELEIRA-IMPRESSO-MIGRACAO.sql](EXCLUIR-ITEM-PRATELEIRA-IMPRESSO-MIGRACAO.sql)
> - Teste com ROLLBACK: [EXCLUIR-ITEM-PRATELEIRA-IMPRESSO-TESTE.sql](EXCLUIR-ITEM-PRATELEIRA-IMPRESSO-TESTE.sql)

## Decisão

Decisão do Everton, de 10/11. O vendedor pode excluir um item de prateleira da proposta, mesmo com o modelo marcado como impresso, quando as três condições valem:

1. O item é de prateleira: `produtos_proposta.is_estoque = true`.
2. A proposta está em NOVO ou AGUARDANDO: `propostas.status_interno`.
3. Não há cobrança paga: nenhuma linha de `pagamentos_v2` com `status = 'PAID'` no mesmo `id_int`.

Fora desse caso, a trava continua como está. A exclusão fica registrada no Histórico da proposta, com quem excluiu e quais modelos foram apagados.

**Caso de origem:** proposta 24985, item 5420 (produto #2003, "Cordão Preto liso de 9mm com Mosquete Plástico"), modelo 1007015. O vendedor tentou excluir o item e o banco recusou com o erro 23514.

## De onde vem o gatilho

Função `public.carimba_status_impressao_em()`, ligada ao gatilho `trg_carimba_status_impressao_em`. Ele dispara em `pedidos_modelos`, antes de cada INSERT, UPDATE ou DELETE, uma vez por linha.

A função não está no repositório do Vibe nem no histórico de migrations (`supabase_migrations`). Ela foi criada direto no banco. Três sinais apontam para o lado Imposition:

- **Variável de sessão:** a função lê a variável `imposition.retorno_manual_modelo`.
- **Ação manual:** essa variável é ligada pela função `retornar_impressao_aguardando(modelo, pedido, registrado_em)`, a ação manual do operador para voltar um modelo de Impresso para Aguardando.
- **Comentário da função:** "Protege hora original e impede regressao automatica. Retorno manual via RPC preserva a impressao anterior. SECURITY INVOKER."

**O ramo de DELETE é recente.** Os levantamentos de 07 e 08/09 (`scratch/imposition-adendo-2.md`, `-3.md` e `imposition-triggers-e-esquema.md`) mostram o gatilho só em INSERT e UPDATE. A recusa no DELETE entrou depois, também por fora do repositório.

Quem marca o modelo de prateleira como IMPRESSO também não é o Vibe. Nenhuma tela, função do banco ou rotina agendada do Vibe grava esse valor. O modelo 1007015 foi criado em 09/11 às 16h52 e já estava IMPRESSO às 16h55.

## O que o gatilho protege

| # | Proteção | Muda com a migração? |
|---|---|---|
| 1 | DELETE de modelo impresso (`status_impressao = IMPRESSO` ou `status_impressao_em` preenchido), por qualquer caminho: direto, pela cascata do item ou pela cascata da proposta | Só ganha a exceção da cascata do item de prateleira liberado |
| 2 | Volta de IMPRESSO para outro status: só para Aguardando, e só pela `retornar_impressao_aguardando` | Não |
| 3 | `status_impressao_em` carimbado pelo banco no INSERT. O cliente não escolhe a hora | Não |
| 4 | Repetir IMPRESSO, ou mudar só caixa e espaços, não renova os carimbos de hora | Não |
| 5 | Evidência antiga (`status_impressao_em` sem IMPRESSO) é preservada | Não |

Outras travas do mesmo tema, que a migração não toca:

- `bloquear_status_arte_impresso`, depois de cada UPDATE: modelo impresso não muda o status da arte.
- `carimba_status_dos_paineis`.

## Como a exceção fica fechada

**1. Gatilho novo em `produtos_proposta`**
- **Nome e momento:** `trg_vibe_liberar_exclusao_item_prateleira`, antes de cada DELETE, uma vez por linha, na função `vibe_liberar_exclusao_item_prateleira()`.
- **Por que no item:** só ele vê o item ainda inteiro. Na cascata, o item já saiu da tabela.
- **O que faz:** confere as três condições e se o item tem modelo impresso. Se tudo valer, grava o Histórico e põe o id do item na marca `vibe.exclusao_item_prateleira`, que vale só dentro da transação.
- **Como roda:** com permissão do dono do banco. A execução direta é revogada para `PUBLIC`, `anon` e `authenticated`.

**2. Ramo de DELETE do gatilho do Imposition**
- Deixa passar o modelo impresso só quando as duas coisas valem:
  - o `id_produto_proposta_origem` do modelo está na marca;
  - o item já não existe em `produtos_proposta`.
- O resto da função fica idêntico ao texto de hoje.

**O que continua barrado:**

| Situação | Por que continua barrado |
|---|---|
| Apagar o modelo impresso direto, na aba Pedido, sem excluir o item | O item ainda existe |
| Item que não é de prateleira | O gatilho novo não marca o item |
| Proposta fora de NOVO ou AGUARDANDO | O gatilho novo não marca o item |
| Proposta com pagamento PAID | O gatilho novo não marca o item |
| Excluir a proposta inteira | A proposta some antes e o status não é achado |
| Marca forjada por SQL | O item ainda existe. Além disso, a API não expõe `set_config` |
| Perfil Consulta | A regra de acesso `consulta_nao_apaga` barra antes. O gatilho de linha só dispara para linha que passou por essa regra |

**Histórico:** uma linha em `propostas_chat`, com tipo SISTEMA. Essa tabela alimenta a Timeline da aba Histórico.
- **Quem fez:** o usuário logado (`auth.uid()`), com nome e e-mail vindos de `usuarios`.
- **Mensagem:** `Produto de prateleira #2003 Cordão Preto liso de 9mm com Mosquete Plástico excluído da proposta por <nome> (<e-mail>). Modelo impresso apagado junto: #1007015 <nome do modelo> (qtd 50, impresso em 09/11/2026 16:55).`
- **Sem usuário logado:** a mensagem diz "acesso sem usuário (<papel>)".
- **Item sem modelo impresso:** segue o caminho de sempre, sem linha nova.

**Efeitos que o ROLLBACK não desfaz:** nenhum dos gatilhos da cadeia chama algo fora do banco (pg_net, http, notify ou dblink). Só os contadores de id avançam.

## Texto do gatilho

### Antes (no banco hoje)

```sql
CREATE OR REPLACE FUNCTION public.carimba_status_impressao_em()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    antes_impresso boolean;
    agora_impresso boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        antes_impresso := upper(btrim(coalesce(OLD.status_impressao, ''))) = 'IMPRESSO';
        IF TG_OP = 'DELETE' THEN
            IF antes_impresso OR OLD.status_impressao_em IS NOT NULL THEN
                RAISE EXCEPTION USING ERRCODE = '23514',
                    MESSAGE = 'Modelo impresso: o registro de impressao e permanente e nao pode ser excluido.';
            END IF;
            RETURN OLD;
        END IF;
    END IF;

    agora_impresso := upper(btrim(coalesce(NEW.status_impressao, ''))) = 'IMPRESSO';
    IF TG_OP = 'INSERT' THEN
        -- O cliente nao escolhe nem antecipa a hora da confirmacao.
        NEW.status_impressao_em := CASE WHEN agora_impresso THEN statement_timestamp() ELSE NULL END;
        RETURN NEW;
    END IF;

    IF antes_impresso THEN
        IF NOT agora_impresso THEN
            IF upper(btrim(coalesce(NEW.status_impressao, ''))) <> 'AGUARDANDO'
               OR current_setting('imposition.retorno_manual_modelo', true) IS DISTINCT FROM OLD.id::text THEN
                RAISE EXCEPTION USING ERRCODE = '23514',
                    MESSAGE = 'Modelo impresso: retornar a Aguardando exige a acao manual do operador.';
            END IF;
            NEW.status_impressao_em := OLD.status_impressao_em;
            RETURN NEW;
        END IF;
        -- Repeticao, caixa/espacos e payloads antigos nao renovam os carimbos.
        NEW.status_impressao := OLD.status_impressao;
        NEW.status_impressao_em := OLD.status_impressao_em;
        NEW.status_impressao_registrado_em := OLD.status_impressao_registrado_em;
        IF NEW.acabamento_status IS NOT DISTINCT FROM OLD.acabamento_status THEN
            NEW.acabamento_status_registrado_em := OLD.acabamento_status_registrado_em;
        END IF;
    ELSIF OLD.status_impressao_em IS NOT NULL THEN
        -- Preservar tambem evidencias legadas; nao inventar uma nova hora.
        NEW.status_impressao_em := OLD.status_impressao_em;
    ELSE
        NEW.status_impressao_em := CASE WHEN agora_impresso THEN statement_timestamp() ELSE NULL END;
    END IF;
    RETURN NEW;
END;
$function$
```

### Depois (só o ramo DELETE muda)

```diff
         IF TG_OP = 'DELETE' THEN
             IF antes_impresso OR OLD.status_impressao_em IS NOT NULL THEN
+                -- Exceção (10/11/2026): item de prateleira excluído da proposta
+                -- em NOVO/AGUARDANDO sem pagamento. Quem confere é o gatilho
+                -- trg_vibe_liberar_exclusao_item_prateleira, que marca o item.
+                -- E so na cascata: o item marcado ja saiu. DELETE direto do
+                -- modelo (item ainda presente) continua barrado.
+                IF OLD.id_produto_proposta_origem IS NOT NULL
+                   AND OLD.id_produto_proposta_origem::text = ANY (
+                       string_to_array(coalesce(current_setting('vibe.exclusao_item_prateleira', true), ''), ',')
+                   )
+                   AND NOT EXISTS (SELECT 1 FROM public.produtos_proposta pp
+                                    WHERE pp.id = OLD.id_produto_proposta_origem) THEN
+                    RETURN OLD;
+                END IF;
                 RAISE EXCEPTION USING ERRCODE = '23514',
                     MESSAGE = 'Modelo impresso: o registro de impressao e permanente e nao pode ser excluido.';
             END IF;
             RETURN OLD;
         END IF;
```

O texto completo do "depois", com o gatilho novo, está na migração.

## Teste com ROLLBACK

Arquivo: [EXCLUIR-ITEM-PRATELEIRA-IMPRESSO-TESTE.sql](EXCLUIR-ITEM-PRATELEIRA-IMPRESSO-TESTE.sql). Rodar no SQL Editor (papel postgres).

1. **O que o arquivo faz:** aplica a migração e roda os casos dentro de uma transação só.
2. **Como garante que nada fica gravado:** o bloco termina sempre em erro proposital, `ZZ999 TESTE_ROLLBACK {...}`, com o resultado em JSON na mensagem. Se esse erro falhar, ainda há um `SELECT 1/0` de reserva.
3. **Como cada caso roda:**
   - como o vendedor Alexandre Almeida, com papel `authenticated` e o `sub` do JWT dele;
   - num subbloco próprio, que é desfeito ao final;
   - no 24985, para que só uma condição mude por vez.
4. **Retrato de hoje:** rode só o bloco `DO` (de `DO $teste$` até o fim), sem a migração. Os casos A a E devem sair todos BARRADO, com 23514.

| Caso | Montagem dentro do teste | Esperado com a migração |
|---|---|---|
| A. #2003 do 24985 | Nenhuma: item 5420 de prateleira, NOVO, sem pagamento | APAGOU. O modelo 1007015 some e o Histórico ganha a linha com o nome do Alexandre |
| B. Item fora da prateleira | O modelo 1007016 do item 5419 (Crachá, mesma proposta) é marcado IMPRESSO | BARRADO, 23514 |
| C. Prateleira com cobrança paga | Pagamento PAID de R$ 1 inserido sem gatilhos, para o status seguir NOVO; depois o 5420 | BARRADO, 23514, com status NOVO |
| D. Modelo impresso apagado direto | DELETE do 1007015 sem excluir o item | BARRADO, 23514 |
| E. Marca forjada | `vibe.exclusao_item_prateleira = 5420` ligada à mão e DELETE direto do 1007015 | BARRADO, 23514 |

**Resultado:** pendente. O teste não rodou pela sessão do agente, porque a execução no banco de produção foi recusada pela permissão. O dono vai rodar no SQL Editor.

## Depois de aplicada

- **Tela:** nada muda. A lixeira já mostra o motivo real quando a exclusão é recusada (commit ef00e6da). Com a exceção, a exclusão simplesmente passa.
- **Pedido 24985:** quem exclui o #2003 é o vendedor, pela tela. A migração não apaga item nenhum.

## Reversão

```sql
DROP TRIGGER IF EXISTS trg_vibe_liberar_exclusao_item_prateleira ON public.produtos_proposta;
DROP FUNCTION IF EXISTS public.vibe_liberar_exclusao_item_prateleira();
-- e recriar carimba_status_impressao_em() com o texto "Antes" acima e o COMMENT original:
-- 'Protege hora original e impede regressao automatica. Retorno manual via RPC preserva a impressao anterior. SECURITY INVOKER.'
```
