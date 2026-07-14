-- ============================================================
--  GESTÃO DEMOCRÁTICA: confirmado com a organização — os DOIS
--  períodos são no SENAI.
--
--  Este arquivo substitui a versão anterior (que mandava trocar a
--  manhã para UNIP — NÃO use aquela). Se você chegou a rodar a
--  versão anterior, rode este UPDATE para voltar ao correto.
--  Se nunca rodou nada, pode rodar mesmo assim — é idempotente.
-- ============================================================

update presenca.palestras
set local    = 'SENAI',
    endereco = 'Rua Capitão Salomão, 1813 - Campos Elíseos'
where id in ('GESTAO_DEMOCRATICA_M', 'GESTAO_DEMOCRATICA_T');

-- Conferência: os dois períodos devem mostrar SENAI.
select id, periodo, local, endereco
from presenca.palestras
where id like 'GESTAO_DEMOCRATICA%'
order by id;
