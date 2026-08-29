-- Catalogo de naturezas: tributacao por operacao, e as seis linhas novas
--
-- POR QUE
--   Hoje a tributacao do item nao esta em lugar nenhum do banco: CSOSN 102, PIS
--   99, COFINS 99 e origem 0 sao literais no codigo, em nfe.service.ts:997-1000
--   e NfeDetailPage.tsx:1215-1217. Todos os 66 itens gravados tem exatamente
--   esses valores.
--
--   CSOSN 102 e "tributada pelo Simples Nacional sem permissao de credito" --
--   uma VENDA tributada. Foi por isso que o select de natureza ficou restrito a
--   tipo_operacao = 'VENDA' (filtro provisorio em nfe.service.ts:1549): emitir
--   remessa ou devolucao mantendo 102 declararia como venda tributada algo que
--   nao e venda, e a SEFAZ nao valida CST contra CFOP nem contra natOp -- a nota
--   sai ACEITA e errada, com conserto por carta de correcao ou cancelamento.
--
--   A definicao fiscal chegou. Esta migration coloca a tributacao NA TABELA, ao
--   lado do CFOP que ela acompanha, para que a etapa seguinte possa apagar os
--   literais do codigo.
--
-- O QUE ESTA MIGRATION NAO FAZ
--   NAO altera o comportamento da tela. Nenhuma linha nova entra no select
--   enquanto o filtro provisorio de VENDA estiver de pe -- ver "POR QUE
--   tipo_operacao NOVO", abaixo, que e a razao de as linhas novas nao terem sido
--   marcadas como VENDA.
--
--   NAO faz backfill: as 25 notas e seus 66 itens nao sao tocados. NAO altera
--   cfop, descricao, tipo_operacao nem destino_operacao de nenhuma linha
--   existente. NAO desativa nada. NAO toca no catalogo de NFSE (9001 a 9008).
--   NAO mexe em RLS, policies nem permissoes. NAO altera codigo.
--
-- AS TRES COLUNAS
--   `icms_situacao_tributaria`, `pis_situacao_tributaria` e
--   `cofins_situacao_tributaria` -- os MESMOS nomes que `produtos` e
--   `notas_fiscais_itens` ja usam, `text` e anulaveis nas tres tabelas.
--
--   No Simples Nacional o campo de ICMS carrega CSOSN, nao CST, mas a coluna se
--   chama `icms_situacao_tributaria` nas outras duas tabelas ha muito tempo.
--   Inventar `csosn` aqui criaria um quarto nome para o mesmo dado e obrigaria a
--   uma traducao na copia catalogo -> item, que e justamente o que a etapa
--   seguinte vai fazer sem intermediario.
--
--   ANULAVEIS de proposito: 1202, 2202, 5202 e 6202 ficam sem valor, e isso e
--   informacao, nao lacuna. Ver abaixo.
--
-- O QUE CADA LINHA RECEBE
--   VENDA (5101, 6101, 5108, 6108) ......... CSOSN 102, PIS 99, COFINS 99
--   OUTRA_SAIDA (5949, 6949) ............... CSOSN 400, PIS 99, COFINS 99
--   ATIVO_IMOBILIZADO (5551, 6551) ......... CSOSN 400, PIS 99, COFINS 99
--   REMESSA (5901, 6901) ................... CSOSN 400, PIS 99, COFINS 99
--   DEVOLUCAO_SAIDA (5202, 6202) ........... NULO, NULO, NULO
--   DEVOLUCAO (1202, 2202) ................. permanecem SEM tributacao
--
--   Os NULOS de 5202/6202 sao deliberados: devolucao ESPELHA a nota de origem, e
--   o valor certo depende de qual nota esta sendo devolvida -- nao ha resposta
--   fixa para gravar aqui. Quem preenche e o usuario, na etapa seguinte. Nulo
--   nesta coluna quer dizer "o catalogo nao decide isto", e nao "ninguem
--   cadastrou ainda".
--
--   1202 e 2202 sao devolucao de ENTRADA (primeiro digito 1 e 2). Nao servem
--   para devolver compra ao fornecedor, que e SAIDA. Ficam intactas.
--
-- AS SEIS LINHAS NOVAS
--   5551 / 6551  Venda de bem do ativo imobilizado
--   5901 / 6901  Remessa para industrializacao por encomenda
--   5202 / 6202  Devolucao de compra para comercializacao
--
--   O texto de 5202/6202 e a descricao OFICIAL do CFOP. O pedido dizia
--   "devolucao de compra ao fornecedor", que e a mesma operacao dita em
--   linguagem de negocio; como esta coluna alimenta o campo natOp da NF-e, vale
--   a redacao da tabela de CFOP. Se a preferencia for a outra, e trocar o texto
--   em duas linhas -- mas trocar DEPOIS de aplicada exige cuidado, porque
--   `descricao` e o que casa a nota com o catalogo.
--
-- POR QUE tipo_operacao NOVO, E NAO 'VENDA' NO ATIVO IMOBILIZADO
--   5551 e venda no nome, mas nao e venda de mercadoria: e baixa de bem do
--   ativo, CSOSN 400 (nao tributada pelo Simples). Marca-la como VENDA juntaria
--   sob um mesmo rotulo duas tributacoes diferentes -- exatamente o que esta
--   rodada existe para separar.
--
--   E teria efeito imediato e indesejado: o select filtra por
--   tipo_operacao = 'VENDA', entao 5551 e 6551 APARECERIAM NA TELA assim que
--   esta migration fosse aplicada, enquanto o codigo ainda grava CSOSN 102 fixo.
--   O resultado seria uma nota de ativo imobilizado com tributacao de venda --
--   o defeito que estamos consertando, reintroduzido pela porta dos fundos.
--
--   Com tipo_operacao proprio, as seis linhas novas ficam invisiveis ate a etapa
--   seguinte remover o filtro. Aplicar esta migration sozinha nao muda nada na
--   tela.
--
--   `tipo_operacao` nao tem CHECK nem enum -- e text livre --, e o catalogo de
--   NFSE ja usa quatro valores proprios (OPERACAO_TRIBUTAVEL, IMUNIDADE,
--   EXPORTACAO_SERVICO, NAO_INCIDENCIA). Valores novos seguem o padrao da casa.
--
-- A CHAVE DE DERIVACAO CONTINUA UNICA
--   `cfopDaNatureza` acha o par interno/interestadual por
--   (tipo_operacao, tres ultimos digitos do CFOP, destino_operacao). Nas 14
--   linhas de NFE depois desta migration:
--
--     DEVOLUCAO         202  INTERNA / INTERESTADUAL   1202 / 2202
--     DEVOLUCAO_SAIDA   202  INTERNA / INTERESTADUAL   5202 / 6202
--     VENDA             101  INTERNA / INTERESTADUAL   5101 / 6101
--     VENDA             108  INTERNA / INTERESTADUAL   5108 / 6108
--     ATIVO_IMOBILIZADO 551  INTERNA / INTERESTADUAL   5551 / 6551
--     REMESSA           901  INTERNA / INTERESTADUAL   5901 / 6901
--     OUTRA_SAIDA       949  INTERNA / INTERESTADUAL   5949 / 6949
--
--   Sete pares, catorze combinacoes distintas. A verificacao 3 no rodape prova.
--
--   ERA AQUI O RISCO: 1202 e 5202 compartilham os tres ultimos digitos e ambos
--   teriam uma linha INTERNA. Se 5202 tivesse recebido tipo_operacao =
--   'DEVOLUCAO', a chave (DEVOLUCAO, 202, INTERNA) apontaria para DUAS linhas e
--   a derivacao passaria a devolver a errada -- devolucao de entrada no lugar da
--   de saida, num campo que vai para a SEFAZ. `DEVOLUCAO_SAIDA` existe por isso.
--
-- CONSTRAINTS: NENHUMA IMPEDE
--   UNIQUE (cfop, descricao) -- os seis CFOPs novos nao existem na tabela, nem
--   como NFE nem como NFSE (que usa 9001 a 9008). O CHECK em modelo_fiscal
--   aceita 'NFE'. Nao ha CHECK em tipo_operacao nem em destino_operacao.
--   `ativo` e NOT NULL com default true. `updated_at` e mantido pela trigger
--   trg_set_updated_at_nfe_naturezas_operacao, que nao e tocada.
--
-- RLS: LINHAS NOVAS JA VISIVEIS, SEM TOCAR EM POLICY
--   RLS esta ligada, com duas policies de SELECT para `authenticated`:
--   "Permitir leitura naturezas nfe autenticado" USING (ativo = true) e
--   "nfe_naturezas_operacao_select_authenticated" USING (true). Policies
--   permissivas se somam, entao `authenticated` le a tabela inteira. As linhas
--   novas nascem com ativo = true e ficam visiveis de imediato. `anon` nao tem
--   policy de leitura e continua sem ver nada. Esta migration nao emite CREATE
--   POLICY, GRANT nem REVOKE.
--
-- ROLLBACK: ver rodape.

begin;

-- ---------------------------------------------------------------------------
-- 1. As tres colunas de tributacao
-- ---------------------------------------------------------------------------
alter table public.nfe_naturezas_operacao
  add column if not exists icms_situacao_tributaria   text,
  add column if not exists pis_situacao_tributaria    text,
  add column if not exists cofins_situacao_tributaria text;

comment on column public.nfe_naturezas_operacao.icms_situacao_tributaria is
  'CSOSN da operacao (Simples Nacional). Mesmo nome e mesmo dominio da coluna homonima em produtos e notas_fiscais_itens. NULO quer dizer que o catalogo nao decide: a devolucao de saida espelha a nota de origem e quem preenche e o usuario.';

comment on column public.nfe_naturezas_operacao.pis_situacao_tributaria is
  'CST de PIS da operacao. NULO = o catalogo nao decide (ver icms_situacao_tributaria).';

comment on column public.nfe_naturezas_operacao.cofins_situacao_tributaria is
  'CST de COFINS da operacao. NULO = o catalogo nao decide (ver icms_situacao_tributaria).';

-- ---------------------------------------------------------------------------
-- 2. Tributacao das linhas que ja existem
--
--    So estas seis. 1202 e 2202 ficam de fora de proposito e seguem com as tres
--    colunas nulas. Nenhuma outra coluna e tocada.
-- ---------------------------------------------------------------------------
update public.nfe_naturezas_operacao
   set icms_situacao_tributaria   = '102',
       pis_situacao_tributaria    = '99',
       cofins_situacao_tributaria = '99'
 where modelo_fiscal = 'NFE'
   and tipo_operacao = 'VENDA'
   and cfop in ('5101', '6101', '5108', '6108');

update public.nfe_naturezas_operacao
   set icms_situacao_tributaria   = '400',
       pis_situacao_tributaria    = '99',
       cofins_situacao_tributaria = '99'
 where modelo_fiscal = 'NFE'
   and tipo_operacao = 'OUTRA_SAIDA'
   and cfop in ('5949', '6949');

-- ---------------------------------------------------------------------------
-- 3. As seis linhas novas
--
--    `on conflict do nothing` sobre UNIQUE (cfop, descricao) deixa a migration
--    reexecutavel sem erro. Nao atualiza linha existente: se um destes CFOPs ja
--    estiver la com esta mesma descricao, a linha de la vence e a verificacao 1
--    no rodape denuncia a divergencia.
-- ---------------------------------------------------------------------------
insert into public.nfe_naturezas_operacao (
  cfop, descricao, tipo_operacao, destino_operacao, modelo_fiscal, ativo,
  icms_situacao_tributaria, pis_situacao_tributaria, cofins_situacao_tributaria,
  observacao
) values
  ('5551', '5551 - Venda de bem do ativo imobilizado',
   'ATIVO_IMOBILIZADO', 'INTERNA',       'NFE', true, '400', '99', '99',
   'Baixa de bem do ativo, nao venda de mercadoria. CSOSN 400 - nao tributada pelo Simples Nacional.'),

  ('6551', '6551 - Venda de bem do ativo imobilizado',
   'ATIVO_IMOBILIZADO', 'INTERESTADUAL', 'NFE', true, '400', '99', '99',
   'Baixa de bem do ativo, nao venda de mercadoria. CSOSN 400 - nao tributada pelo Simples Nacional.'),

  ('5901', '5901 - Remessa para industrialização por encomenda',
   'REMESSA', 'INTERNA',       'NFE', true, '400', '99', '99',
   'Saida para industrializacao por terceiro, com retorno esperado. Nao ha venda: CSOSN 400.'),

  ('6901', '6901 - Remessa para industrialização por encomenda',
   'REMESSA', 'INTERESTADUAL', 'NFE', true, '400', '99', '99',
   'Saida para industrializacao por terceiro, com retorno esperado. Nao ha venda: CSOSN 400.'),

  ('5202', '5202 - Devolução de compra para comercialização',
   'DEVOLUCAO_SAIDA', 'INTERNA',       'NFE', true, null, null, null,
   'Devolucao ao fornecedor, portanto SAIDA - nao confundir com 1202/2202, que sao devolucao de entrada. Tributacao NULA de proposito: espelha a nota de origem e e preenchida pelo usuario.'),

  ('6202', '6202 - Devolução de compra para comercialização',
   'DEVOLUCAO_SAIDA', 'INTERESTADUAL', 'NFE', true, null, null, null,
   'Devolucao ao fornecedor, portanto SAIDA - nao confundir com 1202/2202, que sao devolucao de entrada. Tributacao NULA de proposito: espelha a nota de origem e e preenchida pelo usuario.')
on conflict (cfop, descricao) do nothing;

commit;

-- ============================================================================
-- VERIFICACOES (rodar depois de aplicar; nenhuma escreve)
--
--   -- 1. As 14 linhas de NFE, com a tributacao de cada uma
--   select cfop, tipo_operacao, destino_operacao,
--          coalesce(icms_situacao_tributaria,'(nulo)')   as csosn,
--          coalesce(pis_situacao_tributaria,'(nulo)')    as pis,
--          coalesce(cofins_situacao_tributaria,'(nulo)') as cofins,
--          ativo
--     from public.nfe_naturezas_operacao
--    where modelo_fiscal = 'NFE'
--    order by tipo_operacao, cfop;
--   -- esperado: 14 linhas, todas ativo = true; 1202, 2202, 5202 e 6202 com as
--   -- tres colunas em (nulo); as outras dez preenchidas.
--
--   -- 2. Contagem por faixa -- prova que nada ficou de fora nem sobrando
--   select count(*) filter (where modelo_fiscal = 'NFE')  as nfe,
--          count(*) filter (where modelo_fiscal = 'NFSE') as nfse,
--          count(*) filter (where modelo_fiscal = 'NFE'
--                             and icms_situacao_tributaria is null) as nfe_sem_csosn
--     from public.nfe_naturezas_operacao;
--   -- esperado: 14 | 8 | 4
--
--   -- 3. A CHAVE DE DERIVACAO CONTINUA UNICA -- a verificacao que importa
--   select tipo_operacao, right(cfop, 3) as sufixo, destino_operacao, count(*)
--     from public.nfe_naturezas_operacao
--    where modelo_fiscal = 'NFE' and ativo is true
--    group by 1, 2, 3
--   having count(*) > 1;
--   -- esperado: ZERO linhas. Qualquer linha aqui quebra cfopDaNatureza.
--
--   -- 4. Todo par tem os dois lados
--   select tipo_operacao, right(cfop, 3) as sufixo,
--          count(*) filter (where destino_operacao = 'INTERNA')       as internas,
--          count(*) filter (where destino_operacao = 'INTERESTADUAL') as inters
--     from public.nfe_naturezas_operacao
--    where modelo_fiscal = 'NFE' and ativo is true
--    group by 1, 2 order by 1, 2;
--   -- esperado: 7 grupos, cada um com 1 e 1.
--
--   -- 5. O select nao muda: continua com as MESMAS 4 opcoes de venda
--   select cfop from public.nfe_naturezas_operacao
--    where modelo_fiscal = 'NFE' and ativo is true and tipo_operacao = 'VENDA'
--    order by cfop;
--   -- esperado: 5101, 5108, 6101, 6108 -- e mais nada.
--
--   -- 6. As 8 linhas antigas nao mudaram de identidade
--   select cfop, descricao, tipo_operacao, destino_operacao, ativo
--     from public.nfe_naturezas_operacao
--    where cfop in ('1202','2202','5101','5108','5949','6101','6108','6949')
--    order by cfop;
--   -- esperado: descricao, tipo_operacao, destino_operacao e ativo identicos ao
--   -- de antes; so as tres colunas novas mudaram, e apenas em seis delas.
--
--   -- 7. Nota e item nao foram tocados
--   select (select count(*) from public.notas_fiscais)       as notas,
--          (select count(*) from public.notas_fiscais_itens) as itens;
--   -- esperado: 25 | 66
--
--   -- 8. RLS intacta
--   select policyname, cmd, roles::text, qual
--     from pg_policies
--    where schemaname = 'public' and tablename = 'nfe_naturezas_operacao';
--   -- esperado: as MESMAS duas policies de SELECT para authenticated.
-- ============================================================================

-- ============================================================================
-- ROLLBACK (executar em transacao)
--
-- Devolve a tabela ao estado de 29/08/2026: 8 linhas de NFE, sem colunas de
-- tributacao. So faca isto ANTES de a etapa seguinte passar a ler estas colunas
-- -- depois, derrubar as colunas derruba a tributacao do codigo junto.
--
-- begin;
--
-- delete from public.nfe_naturezas_operacao
--  where modelo_fiscal = 'NFE'
--    and cfop in ('5551','6551','5901','6901','5202','6202');
--
-- alter table public.nfe_naturezas_operacao
--   drop column if exists icms_situacao_tributaria,
--   drop column if exists pis_situacao_tributaria,
--   drop column if exists cofins_situacao_tributaria;
--
-- commit;
--
-- -- conferir: volta a 8 linhas de NFE e 8 de NFSE
-- -- select modelo_fiscal, count(*) from public.nfe_naturezas_operacao
-- --  group by 1 order by 1;
-- ============================================================================
