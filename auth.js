/**
 * auth.js — Autenticação via Supabase Auth (login com Google) + allowlist.
 *
 * Requer (nesta ordem, ANTES deste script):
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="config.js"></script>
 *
 * O acesso é liberado só para e-mails presentes na tabela `validadores`
 * (a allowlist). O perfil (fiscal/gerente) vem de lá, não mais do localStorage.
 * Ver docs/login-google.md e SECURITY.md.
 */
(function() {

  if (!window.supabase || !window.supabase.createClient) {
    console.error("supabase-js nao carregado. Inclua o CDN antes de auth.js.");
    return;
  }

  var KEY_EMAIL  = "fiscal_email";
  var KEY_PERFIL = "fiscal_perfil";
  var KEY_NOME   = "fiscal_nome";

  // Cliente único de auth (mantém a sessão no localStorage e processa o
  // retorno do OAuth automaticamente ao carregar a página).
  window.sb = window.supabase.createClient(SUPA_PROJECT_URL, SUPA_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  function limparCache() {
    localStorage.removeItem(KEY_EMAIL);
    localStorage.removeItem(KEY_PERFIL);
    localStorage.removeItem(KEY_NOME);
  }

  // Inicia o fluxo de login com Google. Volta para a própria página.
  window.loginGoogle = function() {
    return sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname }
    });
  };

  // Encerra a sessão (Supabase + cache local) e volta ao login.
  window.logoutAuth = function() {
    limparCache();
    return sb.auth.signOut().catch(function(){}).then(function() {
      window.location.href = "index.html";
    });
  };

  // Verifica a sessão atual e confere o e-mail na allowlist (validadores).
  // Resolve com:
  //   { email, perfil, nome }   -> autenticado e autorizado
  //   { naoAutorizado: true }   -> logou no Google mas não está na allowlist
  //   null                      -> sem sessão
  // Popula o localStorage (cache usado por menu.js e pelas páginas).
  window.verificarSessao = function() {
    return sb.auth.getSession().then(function(res) {
      var session = res && res.data ? res.data.session : null;
      if (!session || !session.user || !session.user.email) { return null; }

      var email = session.user.email.toLowerCase();
      // Usa o access_token do usuário (e não a anon) — pronto para RLS por auth.
      return fetch(
        SUPA_URL + "/validadores?email=eq." + encodeURIComponent(email) + "&select=email,nome,perfil&limit=1",
        { headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + session.access_token } }
      )
      .then(function(r){ return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data) || data.length === 0) {
          return sb.auth.signOut().catch(function(){}).then(function(){
            limparCache();
            return { naoAutorizado: true, email: email };
          });
        }
        var v = data[0];
        localStorage.setItem(KEY_EMAIL,  v.email);
        localStorage.setItem(KEY_PERFIL, v.perfil || "fiscal");
        localStorage.setItem(KEY_NOME,   v.nome   || "");
        return { email: v.email, perfil: v.perfil || "fiscal", nome: v.nome || "" };
      });
    });
  };

  // Guarda de página protegida. Redireciona ao login se não autenticado/autorizado.
  // perfilReq opcional: "gerente" para páginas exclusivas do gerente.
  // Resolve com o usuário autorizado, ou null (após redirecionar).
  window.protegerPagina = function(perfilReq) {
    return window.verificarSessao().then(function(user) {
      if (!user) { window.location.href = "index.html"; return null; }
      if (user.naoAutorizado) { window.location.href = "index.html?erro=nao_autorizado"; return null; }
      if (perfilReq && user.perfil !== perfilReq) { window.location.href = "index.html"; return null; }
      return user;
    });
  };

})();
