-- ============================================================
--  Migração da PRESENÇA para o projeto do gom
--  Schema isolado "presenca" (não colide com o public do gom).
--  Rode no SQL Editor do projeto do gom.
--  Estrutura reconstruída a partir do uso no código.
-- ============================================================

-- 1) SCHEMA + PERMISSÕES ------------------------------------------------
create schema if not exists presenca;

grant usage on schema presenca to anon, authenticated, service_role;

-- Acesso amplo por enquanto (equivale ao estado atual, sem RLS).
-- Depois: aplicar as policies do SECURITY.md e restringir.
alter default privileges in schema presenca
  grant all on tables to anon, authenticated, service_role;


-- 2) TABELAS (sem foreign keys ainda — ver bloco 3) --------------------
create table presenca.palestras (
  id            text primary key,
  nome          text,
  carga_horaria text
);

create table presenca.participantes (
  token       text primary key,
  nome        text,
  email       text,
  cpf         text,
  palestra_id text,
  qr_url      text,
  qr_enviado  boolean not null default false
);

create table presenca.presencas (
  token         text primary key,        -- 1 presença por token (dedup via 409)
  palestra_id   text,
  data_hora     timestamptz,
  validado_por  text,
  email_enviado boolean not null default false
);

create table presenca.validadores (
  email  text primary key,
  nome   text,
  perfil text not null default 'fiscal'
);

create table presenca.email_config (
  id            integer primary key,      -- sempre 1 (linha única)
  nome_evento   text,
  cor_primaria  text default '#1976d2',
  saudacao      text,
  mensagem      text,
  rodape        text,
  atualizado_em timestamptz default now()
);

-- Garante grants nas tabelas recém-criadas
grant all on all tables in schema presenca to anon, authenticated, service_role;


-- 3) FOREIGN KEYS (rodar SÓ DEPOIS de importar os dados) ---------------
--    Importe os CSV nesta ordem: palestras -> participantes -> presencas
--    -> validadores -> email_config. Depois rode este bloco.
--
-- alter table presenca.participantes
--   add constraint participantes_palestra_fk
--   foreign key (palestra_id) references presenca.palestras(id);
--
-- alter table presenca.presencas
--   add constraint presencas_palestra_fk
--   foreign key (palestra_id) references presenca.palestras(id);
--
-- alter table presenca.presencas
--   add constraint presencas_token_fk
--   foreign key (token) references presenca.participantes(token);


-- 4) FUNÇÃO consultar_inscricao (opcional, p/ inscricao.html seguro) ----
create or replace function presenca.consultar_inscricao(p_email text, p_cpf text)
returns table (token text, nome text, email text, qr_url text, palestra_nome text)
language sql
security definer
set search_path = presenca
as $$
  select p.token, p.nome, p.email, p.qr_url, pl.nome
  from presenca.participantes p
  left join presenca.palestras pl on pl.id = p.palestra_id
  where lower(p.email) = lower(p_email)
    and regexp_replace(p.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
  limit 1;
$$;

grant execute on function presenca.consultar_inscricao(text, text) to anon, authenticated;


-- 5) VERIFICAÇÃO -------------------------------------------------------
-- select table_name from information_schema.tables where table_schema = 'presenca';


-- ============================================================
--  DEPOIS DO SQL:
--   a) Settings -> API -> Exposed schemas: adicionar "presenca".
--   b) Importar os dados (CSV export do projeto atual -> import no gom).
--   c) Rodar o bloco 3 (foreign keys).
--   d) Avisar para eu ajustar config.js + Apps Script (URL/chaves do gom
--      + cabeçalhos Accept-Profile/Content-Profile: presenca).
-- ============================================================
