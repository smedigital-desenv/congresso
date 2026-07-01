# Sistema de Presença — Eventos

Front-end estático (HTML/JS puro) para **validação de presença em palestras**, publicado
via GitHub Pages em `smedigital.com.br/presenca`. O back-end é o **Supabase** (REST),
acessado direto do navegador, e um **Google Apps Script** cuida de sync com a planilha,
geração de QR Codes e envio de e-mails.

## Estrutura

```
├── index.html          Login do fiscal + leitor de QR Code
├── validar.html        Registro de presença de um token
├── dashboard.html      Painel: estatísticas, gestão de presenças e e-mails
├── inscricao.html      Participante consulta sua inscrição/QR (e-mail + CPF)
├── fiscais.html        Gerente gerencia fiscais (CRUD) — só perfil "gerente"
├── email-config.html   Editor do template de e-mail de confirmação
├── config.js           Config central (Supabase/Apps Script) + utilitários
├── menu.js             Menu de navegação global + verificação de perfil
├── apps-script/
│   └── Code.gs         Web App + migração + sync + envio de e-mails
├── SECURITY.md         Pendências de segurança (RLS, Apps Script, login)
└── README.md
```

> `apps-script/Code.gs` é uma **cópia versionada** do script que roda no Google Apps
> Script — edite aqui e cole no editor do Apps Script (Deploy → nova versão).
> `GerarQR.gs` (geração/sync incremental de QR) vive só no Apps Script.

## Papéis
- **fiscal** — valida presenças (index → validar).
- **gerente** — tudo do fiscal + dashboard de gestão, fiscais e config de e-mail.

Perfil e sessão ficam em `localStorage` (`fiscal_email`, `fiscal_perfil`, `fiscal_nome`).

## Configuração
`SUPA_URL` / `SUPA_KEY` (chave **anon**, pública) e `APPS_URL` ficam em
[config.js](config.js). A **service_role** do Supabase fica **só** no Apps Script
(Script Properties → `SUPABASE_SERVICE_KEY`) — nunca no front.

## Modelo de dados (Supabase)
- `palestras` (id, nome, carga_horaria)
- `participantes` (token, nome, email, cpf, palestra_id, qr_url)
- `presencas` (token, palestra_id, data_hora, validado_por, email_enviado)
- `validadores` (email, nome, perfil)
- `email_config` (id=1, nome_evento, cor_primaria, saudacao, mensagem, rodape)

## ⚠️ Segurança
A segurança depende das *policies* de **RLS** no Supabase. Há pendências importantes
(exposição de CPF, escrita livre, login sem senha) descritas em **[SECURITY.md](SECURITY.md)** —
leia antes de colocar em produção com dados reais.

## Deploy
Publicação automática via **GitHub Pages** a partir da branch `main`.
Não há build: ao mesclar na `main`, o Pages reconstrói `smedigital.com.br/presenca`.
