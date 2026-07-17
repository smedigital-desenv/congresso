-- ============================================================
--  RPC de consulta da inscrição por CÓDIGO FUNCIONAL, E-MAIL ou TOKEN.
--  SECURITY DEFINER: devolve só as linhas que batem, sem expor a
--  tabela participantes inteira ao papel anon. Usada pela inscricao.html.
--  Rode no SQL Editor do Supabase.
-- ============================================================

create or replace function presenca.consultar_inscricao_busca(p_busca text)
returns table (
  token         text,
  nome          text,
  email         text,
  palestra_id   text,
  palestra_nome text,
  local         text,
  endereco      text,
  periodo       text,
  hora          text
)
language sql
security definer
set search_path = presenca
as $$
  select p.token, p.nome, p.email, p.palestra_id,
         pl.nome, pl.local, pl.endereco, pl.periodo, pl.hora
  from presenca.participantes p
  left join presenca.palestras pl on pl.id = p.palestra_id
  where lower(trim(p.email)) = lower(trim(p_busca))
     or p.codigo_funcional   = trim(p_busca)
     or upper(p.token)       = upper(trim(p_busca))  -- token (ex.: SME123, 12345_M)
  order by p.palestra_id;
$$;

grant execute on function presenca.consultar_inscricao_busca(text) to anon, authenticated;
