-- ============================================================
--  Capacidade oficial de cada sessão (doc LOCAIS E PALESTRANTES)
--  Usada pela tela vagas.html (acompanhamento de lotação).
--  Rode no SQL Editor do Supabase.
-- ============================================================

alter table presenca.palestras add column if not exists capacidade integer;

update presenca.palestras set capacidade = 200 where id in ('ALEM_TELAS_M','ALEM_TELAS_T');            -- UNAERP Teatro Bassano Vaccarini
update presenca.palestras set capacidade = 450 where id in ('ALFABETIZACAO_M','ALFABETIZACAO_T');      -- Estácio Teatro
update presenca.palestras set capacidade = 450 where id in ('CRIANDO_PONTES_M','CRIANDO_PONTES_T');    -- UNIP
update presenca.palestras set capacidade = 135 where id in ('DA_MEMORIA_M','DA_MEMORIA_T');            -- Auditório Meira Junior
update presenca.palestras set capacidade = 800 where id in ('EDUCAR_CONVIVER_M','EDUCAR_CONVIVER_T');  -- USP (Faculdade de Direito)
update presenca.palestras set capacidade = 400 where id in ('EDUC_ALIMENTAR_M','EDUC_ALIMENTAR_T');    -- Estácio Anfiteatro
update presenca.palestras set capacidade =  80 where id = 'EJA_N';                                     -- UNAERP Sala 06H
update presenca.palestras set capacidade = 180 where id in ('GESTAO_DEMOCRATICA_M','GESTAO_DEMOCRATICA_T'); -- SENAI
update presenca.palestras set capacidade = 140 where id in ('INFANCIA_ATIVIDADE_M','INFANCIA_ATIVIDADE_T'); -- Moura Lacerda
update presenca.palestras set capacidade = 450 where id in ('MOCHILA_M','MOCHILA_T');                  -- Teatro Municipal
update presenca.palestras set capacidade = 200 where id in ('PRETO_CAFE_M','PRETO_CAFE_T');            -- Barão de Mauá
update presenca.palestras set capacidade = 300 where id in ('QUEM_BRINCA_M','QUEM_BRINCA_T');          -- SESI

-- Conferência
select id, local, periodo, capacidade from presenca.palestras order by nome, periodo;
