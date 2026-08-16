-- Peso bruto da remessa: total e por volume
--
-- POR QUE
--   `expedicoes.peso_kg` guarda o peso AFERIDO da remessa e ja e usado pela
--   etiqueta 10x15 e pela pre-postagem dos Correios. A revisao do boletim
--   precisa de duas coisas que nao cabem nele:
--     * peso BRUTO total, que e o numero que vai para a NF-e (com embalagem),
--       e nem sempre coincide com o aferido;
--     * peso bruto POR VOLUME, quando a remessa vai em mais de um volume — a NF
--       de multiplos volumes pede o peso individual de cada um.
--
--   Somar os pesos reais dos setores (propostas_os_setores.peso_real_kg) da o
--   liquido do que foi produzido, nao o bruto embalado. Sao grandezas
--   diferentes e as duas precisam existir.
--
-- FORMATO DE pesos_volumes
--   Array JSON de numeros, na ordem dos volumes: [4.2, 3.85]. Tamanho esperado
--   igual a qtd_volumes; a aplicacao e quem mantem essa coerencia, sem trigger,
--   porque volume pode ser recontado depois da pesagem e uma trava aqui so
--   atrapalharia a bancada.
--
-- Aditivo: colunas nulaveis, sem default e sem trigger. Nenhuma linha existente
-- muda e nenhuma consulta atual enxerga diferenca.
--
-- ROLLBACK
--   alter table public.expedicoes drop column if exists pesos_volumes;
--   alter table public.expedicoes drop column if exists peso_bruto_kg;

alter table public.expedicoes
  add column if not exists peso_bruto_kg numeric,
  add column if not exists pesos_volumes jsonb;

comment on column public.expedicoes.peso_bruto_kg is
  'Peso bruto total da remessa em KG (com embalagem), digitado na revisao do boletim. E o peso que vai para a NF-e. Diferente de peso_kg, que e o aferido usado na etiqueta e na pre-postagem.';

comment on column public.expedicoes.pesos_volumes is
  'Peso bruto de cada volume, em KG, como array JSON na ordem dos volumes: [4.2, 3.85]. Preenchido quando qtd_volumes > 1. Coerencia com qtd_volumes e responsabilidade da aplicacao.';
