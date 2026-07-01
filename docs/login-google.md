# Configuração do login com Google (Supabase Auth)

Passo a passo para habilitar o **login com conta Google + allowlist** no sistema de presença.
O controle de acesso é feito pela tabela **`validadores`** (allowlist) — não há restrição por
domínio. Ver contexto de segurança em [../SECURITY.md](../SECURITY.md).

> Depois de concluir os 3 blocos abaixo, avise para implementarmos o login no código.

---

## 1. Google Cloud Console
1. [console.cloud.google.com](https://console.cloud.google.com) → criar/selecionar um projeto.
2. **APIs e Serviços → Tela de consentimento OAuth**:
   - Tipo: **Externo**
   - Nome do app: ex. **Validação de Presença — SME**
   - E-mail de suporte e e-mail do desenvolvedor: institucional (ex. `desenv.sme@gmail.com`)
   - Em **Testes**, só e-mails cadastrados como testadores entram; em **Produção**, qualquer
     conta Google pode iniciar o fluxo (mas a allowlist barra quem não é fiscal/gerente).
3. **APIs e Serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo: **Aplicativo da Web**
   - **Origens JavaScript autorizadas:** `https://smedigital.com.br`
   - **URIs de redirecionamento autorizados:**
     ```
     https://kormvmwdkyssxhdkgthd.supabase.co/auth/v1/callback
     ```
     (é o Callback URL do Supabase, não o do site)
4. Copiar **Client ID** e **Client Secret**.

## 2. Supabase — Authentication
### Providers → Google
- **Enable Sign in with Google:** ligado
- **Client IDs:** (o Client ID do Google)
- **Client Secret (for OAuth):** (o Client Secret do Google) — fica só aqui, nunca no front
- **Skip nonce checks:** desligado
- **Allow users without an email:** **desligado** (precisamos do e-mail para a allowlist)
- **Save**

### URL Configuration
- **Site URL:** `https://smedigital.com.br/presenca/`
- **Redirect URLs:** `https://smedigital.com.br/presenca/**`
  - (para testes locais, adicionar também a URL local, ex. `http://localhost:5500/**`)

## 3. Allowlist (`validadores`)
Garantir que a tabela `validadores` contém os e-mails autorizados **em minúsculas**, exatamente
como no Google, com o `perfil` correto (`fiscal` ou `gerente`). Quem não estiver na tabela é
barrado após o login.

---

## Depois (implementação no código — a fazer)
- Adicionar `supabase-js` (CDN) + `auth.js` central: login Google, checagem na allowlist,
  guarda de sessão e logout.
- Reescrever o login do `index.html`; ajustar `menu.js` e o `window.onload` das páginas para
  usar a sessão real (em vez do `localStorage`).
- Aplicar **RLS** baseado em `auth.jwt() ->> 'email'` para fechar as escritas livres.
