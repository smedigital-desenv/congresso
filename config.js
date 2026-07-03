/**
 * config.js — Configuração central (Supabase + Apps Script) e utilitários compartilhados.
 * IMPORTANTE: incluir com <script src="config.js"></script> ANTES de menu.js e dos
 * scripts de cada página, pois define as globais SUPA_URL / SUPA_KEY / APPS_URL.
 */

// A chave "anon" é pública por design. A segurança real depende das policies de RLS
// configuradas no Supabase — veja SECURITY.md.
// Projeto do gom; tabelas da presença no schema "presenca".
var SUPA_PROJECT_URL = "https://iqldovwttomkjkoakosc.supabase.co";
var SUPA_URL    = SUPA_PROJECT_URL + "/rest/v1";
var SUPA_SCHEMA = "presenca";
var SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxbGRvdnd0dG9ta2prb2Frb3NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MDU4NzksImV4cCI6MjA5NjA4MTg3OX0.4dYeK5iIEgSD7CEWyLoaqXEXvuITVNVpTlfdmCyJCI0";
var APPS_URL = "https://script.google.com/macros/s/AKfycbwgn-kasXrfTWULBUe_7chco-O9TUFjFLVtXqkfyBs8WuGHKDLX8hhiENd2r-bly6-E0A/exec";

/**
 * Escapa uma string para inserção segura em HTML (previne XSS armazenado).
 * Use sempre que dados vindos do banco forem para dentro de innerHTML.
 */
function escapeHtml(v) {
  if (v == null) return "";
  return String(v).replace(/[&<>"']/g, function(c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/**
 * Busca TODAS as linhas de um endpoint PostgREST, paginando de pageSize em pageSize.
 * Evita o teto padrão de linhas por requisição (que trunca contagens silenciosamente).
 * Retorna sempre um array.
 */
function fetchAll(url, headers, pageSize) {
  pageSize = pageSize || 1000;
  var acc = [];
  function grab(offset) {
    var sep = url.indexOf("?") === -1 ? "?" : "&";
    return fetch(url + sep + "limit=" + pageSize + "&offset=" + offset, { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) return acc;
        acc = acc.concat(data);
        return data.length < pageSize ? acc : grab(offset + pageSize);
      });
  }
  return grab(0);
}

// ─────────────────────────────────────────────────────────────
// ACESSO LIVRE (temporário) — dispensa o login enquanto a autenticação
// definitiva não é integrada (reaproveitando os projetos gom/mapa).
// Define uma identidade padrão de gerente para que todas as telas funcionem
// sem tela de login. Para reativar o login, remova este bloco.
// ─────────────────────────────────────────────────────────────
try {
  if (!localStorage.getItem("fiscal_email")) {
    localStorage.setItem("fiscal_email",  "acesso-livre");
    localStorage.setItem("fiscal_perfil", "gerente");
    localStorage.setItem("fiscal_nome",   "Acesso livre");
  }
} catch (e) {}
