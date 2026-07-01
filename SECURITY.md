# Segurança — pendências fora do front-end

As correções de código (XSS, upsert, paginação, limpeza) já foram aplicadas.
Restam **três itens que só podem ser resolvidos no Supabase e no Google Apps Script** —
sem eles, a chave `anon` embutida no site permite que qualquer visitante leia e altere dados.

> ⚠️ Hoje a única barreira é a URL ser "secreta". A chave `anon` é pública por design;
> quem abrir o DevTools consegue chamar a API REST diretamente.

---

## 1. RLS (Row Level Security) — o mais crítico

Verifique no painel Supabase (**Authentication → Policies**) se cada tabela tem RLS
**habilitado** e com policies restritas. Se qualquer uma estiver com policy `USING (true)`
para o papel `anon`, está exposta.

Riscos atuais prováveis:

| Tabela | Se `anon` puder... | Impacto |
|---|---|---|
| `participantes` | `SELECT` livre | Vazamento de **nome, e-mail e CPF** de todos (LGPD) |
| `presencas` | `INSERT`/`DELETE` livre | Qualquer um marca/apaga presença |
| `validadores` | `INSERT`/`UPDATE`/`DELETE` livre | Qualquer um se cadastra como **gerente** |
| `email_config` | `UPDATE` livre | Adulteração do template de e-mail |

### Solução recomendada (correta): Supabase Auth
Migrar o login do fiscal (hoje só "e-mail existe na tabela", **sem senha**) para
**Supabase Auth com magic link**. Com isso as policies podem usar `auth.jwt()`/`auth.uid()`
e o papel `anon` fica sem acesso a nada sensível.

### Solução mínima (se mantiver só a chave `anon` por enquanto)
1. **Tirar TODAS as escritas do navegador.** `presencas` (insert/delete),
   `validadores` (CRUD) e `email_config` (update) devem ser feitas pelo **Apps Script**
   (que guarda a `service_role` key no lado servidor) — nunca pelo `anon`.
2. **Não expor a tabela `participantes` inteira ao `anon`.** Troque a consulta de
   `inscricao.html` por uma função `SECURITY DEFINER` que só devolve a linha quando
   e-mail **e** CPF batem:

```sql
-- Bloqueia leitura direta
alter table participantes enable row level security;
-- (não crie policy de SELECT para anon)

-- Função que devolve só a inscrição correspondente
create or replace function public.consultar_inscricao(p_email text, p_cpf text)
returns table (token text, nome text, email text, qr_url text, palestra_nome text)
language sql security definer set search_path = public as $$
  select p.token, p.nome, p.email, p.qr_url, pl.nome
  from participantes p
  left join palestras pl on pl.id = p.palestra_id
  where lower(p.email) = lower(p_email)
    and regexp_replace(p.cpf, '\D', '', 'g') = regexp_replace(p_cpf, '\D', '', 'g')
  limit 1;
$$;

grant execute on function public.consultar_inscricao(text, text) to anon;
```

   ✅ O `inscricao.html` **já foi ajustado** para chamar
   `POST /rest/v1/rpc/consultar_inscricao` com `{ p_email, p_cpf }` — basta criar a
   função acima no Supabase e revogar o `SELECT` de `anon` em `participantes`.

   > ⚠️ **Atenção:** `dashboard.html` e o cache de `index.html` **ainda leem
   > `participantes` diretamente** (precisam da lista inteira). Se você revogar o
   > `SELECT` de `anon` em `participantes` **sem** antes migrar essas leituras para
   > Supabase Auth (papel fiscal) ou uma RPC equivalente, o painel do fiscal para de
   > carregar. Ordem segura: primeiro Supabase Auth → depois revogar o `anon`.

3. `palestras` pode continuar com `SELECT` público (não é dado sensível).

4. Garanta **constraint `UNIQUE (token)` em `presencas`** — o front trata `409` como
   "já registrado", o que só funciona com a constraint no banco.

```sql
alter table presencas add constraint presencas_token_unique unique (token);
```

---

## 2. Apps Script — autenticação e chave (✅ implementado em `apps-script/Code.gs`)

Antes, a URL `.../exec?action=enviarEmails` era pública: qualquer um disparava
**envio de e-mails em massa** ou o sync. O `apps-script/Code.gs` deste repo já corrige:

- **Chave `service_role` via Script Properties.** `Code.gs` usa a service_role (guardada
  em Script Properties, chave `SUPABASE_SERVICE_KEY`), não a `anon`. Isso é **obrigatório**:
  quando o RLS for fechado para `anon`, o `anon` perde o `PATCH` em `presencas`
  (`email_enviado=true`) e o envio de e-mails quebraria se o Apps Script usasse a `anon`.
- **Validação de identidade do gerente.** As ações `syncInscritos`/`enviarEmails` só rodam
  se o parâmetro `email` corresponder a um gerente em `validadores` (função
  `gerenteAutorizado`). O front (`dashboard.html`) já envia `&email=<gerente logado>`.

### O que você precisa fazer no Google/Supabase
1. **Supabase → Settings → API** → copiar a chave **`service_role`**.
2. **Apps Script → Project Settings → Script Properties** → criar
   `SUPABASE_SERVICE_KEY` = (a service_role). **Nunca** cole essa chave no front/repo.
3. Colar o conteúdo de `apps-script/Code.gs` no editor do Apps Script e **republicar**
   a implantação (Deploy → Manage deployments → nova versão).

> Limitação honesta: o e-mail do gerente sai do `localStorage` do navegador, então um
> atacante que **já conheça um e-mail de gerente** poderia forjá-lo. Depois que o RLS
> fechar a leitura de `validadores` para `anon` (item 1), esses e-mails deixam de ser
> enumeráveis, o que torna o ataque bem mais difícil. A proteção definitiva é o
> Supabase Auth (item 3).

---

## 3. Login com identidade (✅ implementado — login com Google)

Antes, `index.html` autenticava só verificando se o e-mail existia em `validadores` —
sem senha, sem prova de posse, e o perfil vinha do `localStorage` (forjável).

Agora o login usa **Supabase Auth com Google** (`auth.js`): o Google prova a posse do
e-mail, e o acesso só é liberado se esse e-mail estiver em `validadores` (allowlist). O
perfil (fiscal/gerente) vem de `validadores` a cada carregamento, validado por `protegerPagina()`.
Setup em [docs/login-google.md](docs/login-google.md).

> Ainda falta o item 1 (RLS): a sessão já é real, mas as tabelas continuam abertas ao
> `anon` até você aplicar as policies abaixo. Com o login pronto, dá para amarrar o RLS à
> identidade (`auth.jwt() ->> 'email'`).

### Policies de RLS recomendadas (agora que há sessão real)
```sql
-- Helper: e-mail do usuario autenticado
-- (auth.jwt() ->> 'email')

-- validadores: cada usuario autenticado le a lista (para checar allowlist/perfil).
alter table validadores enable row level security;
create policy validadores_sel on validadores for select to authenticated using (true);
-- Escrita (gerenciar fiscais) apenas para gerentes:
create policy validadores_ins on validadores for insert to authenticated
  with check (exists (select 1 from validadores v where v.email = auth.jwt()->>'email' and v.perfil = 'gerente'));
create policy validadores_upd on validadores for update to authenticated
  using (exists (select 1 from validadores v where v.email = auth.jwt()->>'email' and v.perfil = 'gerente'));
create policy validadores_del on validadores for delete to authenticated
  using (exists (select 1 from validadores v where v.email = auth.jwt()->>'email' and v.perfil = 'gerente'));

-- participantes: leitura só para fiscais/gerentes autenticados (dashboard/cache).
alter table participantes enable row level security;
create policy participantes_sel on participantes for select to authenticated
  using (exists (select 1 from validadores v where v.email = auth.jwt()->>'email'));
-- (a consulta publica de inscricao continua pela funcao consultar_inscricao — item 1)

-- presencas: fiscais/gerentes autenticados podem ler e inserir; excluir só gerente.
alter table presencas enable row level security;
create policy presencas_sel on presencas for select to authenticated
  using (exists (select 1 from validadores v where v.email = auth.jwt()->>'email'));
create policy presencas_ins on presencas for insert to authenticated
  with check (exists (select 1 from validadores v where v.email = auth.jwt()->>'email'));
create policy presencas_del on presencas for delete to authenticated
  using (exists (select 1 from validadores v where v.email = auth.jwt()->>'email' and v.perfil = 'gerente'));

-- email_config: leitura autenticada; escrita só gerente.
alter table email_config enable row level security;
create policy email_config_sel on email_config for select to authenticated using (true);
create policy email_config_wr on email_config for all to authenticated
  using (exists (select 1 from validadores v where v.email = auth.jwt()->>'email' and v.perfil = 'gerente'))
  with check (exists (select 1 from validadores v where v.email = auth.jwt()->>'email' and v.perfil = 'gerente'));
```
> O Apps Script usa a `service_role`, que **ignora o RLS** — o envio de e-mails e o sync
> continuam funcionando normalmente após aplicar essas policies.

---

## Prioridade sugerida
1. ✅ Login com Google (item 3).
2. Aplicar as **policies de RLS** acima (item 1/3) — **agora**, para fechar o acesso `anon`.
3. Constraint `UNIQUE` em `presencas` + função `consultar_inscricao` (item 1).
4. `service_role` + validação de gerente no Apps Script (item 2).
