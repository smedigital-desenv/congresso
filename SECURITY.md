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

## 2. Apps Script sem autenticação

A URL `.../exec?action=enviarEmails` é pública e chamada em `no-cors`.
Qualquer um com a URL pode disparar **envio de e-mails em massa** ou o sync repetidamente.

Adicione um **segredo compartilhado** na chamada e valide no Apps Script:

```js
// No Apps Script (doGet)
function doGet(e) {
  var SEGREDO = PropertiesService.getScriptProperties().getProperty('APP_SECRET');
  if (e.parameter.k !== SEGREDO) {
    return ContentService.createTextOutput('unauthorized');
  }
  // ... roteia e.parameter.action
}
```

E no front (`config.js` → `APPS_URL`), inclua `&k=SEGREDO` na chamada de `chamarAppsScript`.

> Observação: como o segredo ficaria no JS do navegador, ele não é secreto de verdade.
> O ideal é que **as ações do Apps Script exijam login do gerente** (ex.: passar o e-mail
> autenticado e o Apps Script conferir contra a tabela `validadores`). O `k` acima serve
> apenas para cortar abuso automatizado casual.

---

## 3. Login sem verificação de identidade

`index.html` autentica só verificando se o e-mail existe em `validadores` — não há senha
nem confirmação de posse do e-mail, e o perfil de gerente é lido de `localStorage`
(`fiscal_perfil`), trivialmente forjável no DevTools.

Resolvido junto com o item 1 ao adotar **Supabase Auth (magic link)**: o perfil passa a vir
do JWT/servidor, não do `localStorage`.

---

## Prioridade sugerida
1. RLS em `participantes`/`presencas`/`validadores`/`email_config` (item 1) — **agora**.
2. Constraint `UNIQUE` em `presencas`.
3. Segredo no Apps Script (item 2).
4. Migração para Supabase Auth (itens 1 e 3) — quando possível.
