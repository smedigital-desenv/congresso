/**
 * auth.js — Login via Supabase Auth (Google) reaproveitando o projeto do GOM.
 *
 * Requer (nesta ordem, ANTES deste script):
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="config.js"></script>
 *
 * Como a presença está no MESMO projeto Supabase do GOM (mesma origem), a sessão
 * é COMPARTILHADA — é um SSO. A allowlist da presença é a tabela
 * `presenca.validadores`; o perfil (fiscal/gerente) vem de lá.
 *
 * Importante: quando o e-mail logado NÃO está em validadores, apenas negamos o
 * acesso — NÃO chamamos signOut, para não derrubar a sessão do GOM.
 */
(function() {

  if (!window.supabase || !window.supabase.createClient) {
    console.error("supabase-js nao carregado. Inclua o CDN antes de auth.js.");
    return;
  }

  var KEY_EMAIL  = "fiscal_email";
  var KEY_PERFIL = "fiscal_perfil";
  var KEY_NOME   = "fiscal_nome";
  var KEY_LOGOUT = "presenca_deslogado";  // logout só da presença (não mexe no GOM)

  // Cliente único (mesma config/projeto do GOM → sessão compartilhada).
  window.sb = window.supabase.createClient(SUPA_PROJECT_URL, SUPA_KEY, {
    auth: {
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
      flowType:           "pkce",
      storage:            window.localStorage
    }
  });

  function limparCache() {
    localStorage.removeItem(KEY_EMAIL);
    localStorage.removeItem(KEY_PERFIL);
    localStorage.removeItem(KEY_NOME);
  }

  // Inicia o login. Se já houver sessão (ex.: logado no GOM), reaproveita na hora
  // (SSO). Senão, dispara o OAuth do Google. Sempre limpa o "deslogado da presença".
  window.loginGoogle = function() {
    localStorage.removeItem(KEY_LOGOUT);
    return sb.auth.getSession().then(function(res) {
      var s = res && res.data ? res.data.session : null;
      if (s) { window.location.reload(); return; }  // usa a sessão existente
      return sb.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + window.location.pathname }
      });
    });
  };

  // Logout SÓ da presença: marca localmente e volta ao login, SEM signOut —
  // a sessão do Supabase (e do GOM) permanece intacta.
  window.logoutAuth = function() {
    limparCache();
    localStorage.setItem(KEY_LOGOUT, "1");
    window.location.href = "index.html";
    return Promise.resolve();
  };

  // Verifica a sessão e confere o e-mail na allowlist (presenca.validadores).
  // Resolve com:
  //   { email, perfil, nome }  -> autenticado e autorizado
  //   { naoAutorizado: true }  -> logado no Google mas fora da allowlist (NÃO desloga)
  //   null                     -> sem sessão
  function carregarSessao() {
    // Se o usuário deslogou da presença, ignora a sessão compartilhada até novo login.
    if (localStorage.getItem(KEY_LOGOUT)) { return Promise.resolve(null); }
    return sb.auth.getSession().then(function(res) {
      var session = res && res.data ? res.data.session : null;
      if (!session || !session.user || !session.user.email) { return null; }

      var email = session.user.email.toLowerCase();
      return fetch(
        SUPA_URL + "/validadores?email=eq." + encodeURIComponent(email) + "&select=email,nome,perfil&limit=1",
        { headers: {
            "apikey": SUPA_KEY,
            "Authorization": "Bearer " + session.access_token,
            "Accept-Profile": SUPA_SCHEMA
          } }
      )
      .then(function(r){ if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) throw new Error("resposta inesperada");
        if (data.length === 0) {
          // Fora da allowlist: nega SEM signOut (preserva a sessão do GOM).
          limparCache();
          return { naoAutorizado: true, email: email };
        }
        var v = data[0];
        var perfil = (v.perfil || "fiscal").toString().trim().toLowerCase();
        localStorage.setItem(KEY_EMAIL,  v.email);
        localStorage.setItem(KEY_PERFIL, perfil);
        localStorage.setItem(KEY_NOME,   v.nome || "");
        return { email: v.email, perfil: perfil, nome: v.nome || "" };
      })
      .catch(function() {
        // Erro transitório na checagem: usa o cache se houver, não desloga.
        var cachedEmail = localStorage.getItem(KEY_EMAIL);
        if (cachedEmail) {
          return { email: cachedEmail,
                   perfil: (localStorage.getItem(KEY_PERFIL) || "fiscal"),
                   nome: localStorage.getItem(KEY_NOME) || "" };
        }
        return { naoAutorizado: true, email: email };
      });
    });
  }

  // Verificação memoizada — páginas e menu compartilham o mesmo resultado.
  window.sessaoPronta = carregarSessao();
  window.verificarSessao = function() { return window.sessaoPronta; };

  // Guarda de página protegida. perfilReq opcional: "gerente".
  window.protegerPagina = function(perfilReq) {
    return window.verificarSessao().then(function(user) {
      if (!user) { window.location.href = "index.html"; return null; }
      if (user.naoAutorizado) { window.location.href = "index.html?erro=nao_autorizado"; return null; }
      if (perfilReq && user.perfil !== perfilReq) { window.location.href = "index.html"; return null; }
      return user;
    });
  };

})();
