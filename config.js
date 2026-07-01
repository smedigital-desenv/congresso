/**
 * config.js — Configuração central (Supabase + Apps Script) e utilitários compartilhados.
 * IMPORTANTE: incluir com <script src="config.js"></script> ANTES de menu.js e dos
 * scripts de cada página, pois define as globais SUPA_URL / SUPA_KEY / APPS_URL.
 */

// A chave "anon" é pública por design. A segurança real depende das policies de RLS
// configuradas no Supabase — veja SECURITY.md.
var SUPA_URL = "https://kormvmwdkyssxhdkgthd.supabase.co/rest/v1";
var SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtvcm12bXdka3lzc3hoZGtndGhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNDU3MDAsImV4cCI6MjA5NTcyMTcwMH0._x3hrly1GYE4CNj8xZllQHoFqbgt5Bwrj2T9clMx0ls";
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
