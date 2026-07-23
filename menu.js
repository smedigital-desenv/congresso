/**
 * menu.js — Menu de navegação global
 * Incluir com <script src="menu.js"></script> em todas as páginas
 * após o conteúdo do body.
 */
(function() {

  // SUPA_URL e SUPA_KEY vêm de config.js (carregado antes deste script).
  var KEY_EMAIL  = "fiscal_email";
  var KEY_PERFIL = "fiscal_perfil";
  var KEY_NOME   = "fiscal_nome";

  var emailFiscal = localStorage.getItem(KEY_EMAIL)  || "";
  var perfil      = localStorage.getItem(KEY_PERFIL) || "";
  var nomeFiscal  = localStorage.getItem(KEY_NOME)   || emailFiscal;

  // Página atual para destacar item ativo
  var paginaAtual = window.location.pathname.split("/").pop() || "index.html";

  // Itens visíveis para todos os perfis logados
  var itensBase = [
    { href: "fiscal.html",    icon: "M23 3a10.9 10.9 0 01-3.14 1.53 4.48 4.48 0 00-7.86 3v1A10.66 10.66 0 013 4s-4 9 5 13a11.64 11.64 0 01-7 2c9 5 20 0 20-11.5a4.5 4.5 0 00-.08-.83A7.72 7.72 0 0023 3z", label: "Validar" },
    { href: "congresso.html", icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",                                                                                                   label: "Inscrição" },
    { href: "dashboard.html", icon: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",                                                                                                                      label: "Dashboard" },
  ];

  // Itens exclusivos do gerente
  var itensGerente = [
    { href: "fiscais.html",      icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75", label: "Fiscais" },
    { href: "email-config.html", icon: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6",                           label: "E-mail" },
  ];

  function renderMenu() {

    // Não exibe menu se não estiver logado (exceto na página de login)
    if (!emailFiscal && paginaAtual !== "fiscal.html") return;
    if (!emailFiscal) return;

    var itens = itensBase.concat(perfil === "gerente" ? itensGerente : []);

    var css = [
      "<style>",
      ":root{--menu-h:62px;}",
      "body{padding-bottom:var(--menu-h)!important;}",
      ".menu-global{position:fixed;bottom:0;left:0;right:0;z-index:100;",
        "background:rgba(15,17,23,.97);",
        "backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);",
        "border-top:1px solid #2a2d3a;",
        "height:var(--menu-h);",
        "display:flex;align-items:stretch;",
        "padding-bottom:env(safe-area-inset-bottom,0);",
      "}",
      ".menu-item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;",
        "gap:3px;text-decoration:none;color:#6b7280;font-size:10px;font-weight:600;",
        "font-family:'DM Sans',sans-serif;letter-spacing:.5px;text-transform:uppercase;",
        "transition:color .2s;padding:8px 4px;border:none;background:none;cursor:pointer;",
        "position:relative;",
      "}",
      ".menu-item:hover{color:#e8eaf0;}",
      ".menu-item.ativo{color:#4f8ef7;}",
      ".menu-item.ativo::before{content:'';position:absolute;top:0;left:25%;right:25%;",
        "height:2px;background:linear-gradient(90deg,#4f8ef7,#7c3aed);border-radius:0 0 3px 3px;",
      "}",
      ".menu-item svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;",
        "stroke-linecap:round;stroke-linejoin:round;",
      "}",
      ".menu-avatar{width:20px;height:20px;border-radius:50%;",
        "background:linear-gradient(135deg,#4f8ef7,#7c3aed);",
        "display:flex;align-items:center;justify-content:center;",
        "font-size:9px;font-weight:700;color:#fff;",
      "}",
      ".menu-sair{flex:0 0 56px;}",
      "</style>"
    ].join("");

    var htmlItens = itens.map(function(item) {
      var ativo = paginaAtual === item.href ? " ativo" : "";
      return [
        '<a href="' + item.href + '" class="menu-item' + ativo + '">',
          '<svg viewBox="0 0 24 24"><path d="' + item.icon + '"/></svg>',
          item.label,
        '</a>'
      ].join("");
    }).join("");

    // Inicial do nome para o avatar
    var inicial = (nomeFiscal || emailFiscal || "?")[0].toUpperCase();

    var htmlSair = [
      '<button class="menu-item menu-sair" onclick="menuLogout()" title="Sair">',
        '<div class="menu-avatar">' + inicial + '</div>',
        'Sair',
      '</button>'
    ].join("");

    var html = '<nav class="menu-global">' + htmlItens + htmlSair + '</nav>';

    document.head.insertAdjacentHTML("beforeend", css);
    document.body.insertAdjacentHTML("beforeend", html);

  }

  // Logout global — usa a sessão (auth.js) quando disponível
  window.menuLogout = function() {
    if (typeof window.logoutAuth === "function") { window.logoutAuth(); return; }
    localStorage.removeItem(KEY_EMAIL);
    localStorage.removeItem(KEY_PERFIL);
    localStorage.removeItem(KEY_NOME);
    window.location.href = "fiscal.html";
  };

  // Renderiza assim que o body estiver disponível
  function tentarRenderMenu() {
    if (document.body) {
      renderMenu();
    } else {
      document.addEventListener("DOMContentLoaded", renderMenu);
    }
  }

  // Aguarda a sessão (auth.js) para ter e-mail/perfil corretos antes de montar
  // o menu — senão os itens de gerente não apareceriam (o perfil chega async).
  if (window.sessaoPronta && typeof window.sessaoPronta.then === "function") {
    window.sessaoPronta.then(function(user) {
      if (user && user.email && !user.naoAutorizado) {
        emailFiscal = user.email;
        perfil      = user.perfil || "";
        nomeFiscal  = user.nome || user.email;
      } else {
        emailFiscal = "";  // sem sessão válida/autorizada → não renderiza menu
      }
      tentarRenderMenu();
    });
  } else {
    tentarRenderMenu();
  }

})();
