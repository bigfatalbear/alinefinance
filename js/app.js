/* =========================================================
   ALINEFINANCE — aplicação (PWA + Supabase)
   ========================================================= */
(() => {
  "use strict";

  /* ----------------------------- config ----------------------------- */
  const cfg = window.ALINE_CONFIG || {};
  const isConfigured =
    cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("SEU-PROJETO") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("SUA-ANON-KEY");

  let sb = null;
  let deferredPrompt = null;

  const state = {
    user: null,
    profile: null,
    transactions: [],
    budgets: [],
    goals: [],
    view: "dashboard",
    month: currentMonthKey(),
    txType: "all",
    txSearch: "",
    charts: []
  };

  /* ----------------------------- helpers ----------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

  function money(v) { return brl.format(Number(v) || 0); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function currentMonthKey() { return todayISO().slice(0, 7); }
  function monthLabel(key) {
    const [y, m] = key.split("-").map(Number);
    const txt = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  function shortMonth(key) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  }
  function dateBR(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }
  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function firstName() {
    const n = (state.profile && state.profile.full_name) || "";
    return n.trim().split(/\s+/)[0] || "você";
  }
  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  }
  function pct(part, total) {
    if (!total || total <= 0) return 0;
    return Math.max(0, Math.min(999, (part / total) * 100));
  }
  function clampPct(v) { return Math.max(0, Math.min(100, v)); }

  /* ----------------------------- categorias ----------------------------- */
  const EXPENSE_CATEGORIES = [
    { name: "Moradia", abbr: "MO", color: "#0f8f7e" },
    { name: "Alimentação", abbr: "AL", color: "#e8b64c" },
    { name: "Transporte", abbr: "TR", color: "#4a7bd8" },
    { name: "Saúde", abbr: "SA", color: "#e25c66" },
    { name: "Educação", abbr: "ED", color: "#8e6bd8" },
    { name: "Lazer", abbr: "LA", color: "#f08a92" },
    { name: "Compras", abbr: "CO", color: "#14b8a6" },
    { name: "Contas", abbr: "CT", color: "#d98b3a" },
    { name: "Outros", abbr: "OU", color: "#8a9e99" }
  ];
  const INCOME_CATEGORIES = [
    { name: "Salário", abbr: "SA", color: "#1fa971" },
    { name: "Freelance", abbr: "FR", color: "#14b8a6" },
    { name: "Investimentos", abbr: "IN", color: "#4a7bd8" },
    { name: "Vendas", abbr: "VE", color: "#e8b64c" },
    { name: "Outros", abbr: "OU", color: "#8a9e99" }
  ];
  const ALL_CATEGORIES = EXPENSE_CATEGORIES.concat(
    INCOME_CATEGORIES.filter((c) => !EXPENSE_CATEGORIES.some((e) => e.name === c.name))
  );

  function catInfo(name) {
    return ALL_CATEGORIES.find((c) => c.name === name) || { name: name || "Outros", abbr: "OU", color: "#8a9e99" };
  }
  function catOptions(type, selected) {
    const list = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    return list.map((c) =>
      `<option value="${escapeHtml(c.name)}"${c.name === selected ? " selected" : ""}>${escapeHtml(c.name)}</option>`
    ).join("");
  }

  const GOAL_LABELS = {
    economizar: "Economizar",
    sair_dividas: "Sair das dívidas",
    investir: "Investir",
    realizar_sonho: "Realizar um sonho"
  };
  const CHALLENGE_LABELS = {
    controlar_gastos: "Controlar os gastos",
    sair_dividas: "Sair das dívidas",
    economizar: "Começar a economizar",
    investir: "Investir mais",
    organizar: "Me organizar"
  };
  const RISK_LABELS = { conservador: "Conservador", moderado: "Moderado", arrojado: "Arrojado" };

  /* ----------------------------- screens ----------------------------- */
  function showScreen(name) {
    $$(".screen").forEach((s) => s.classList.remove("active"));
    const app = $("#main-app");
    app.classList.remove("active");
    app.classList.add("hidden");

    if (name === "app") {
      app.classList.remove("hidden");
      app.classList.add("active");
      return;
    }
    const map = { splash: "#splash-screen", auth: "#auth-screen", onboarding: "#onboarding-screen" };
    const el = $(map[name]);
    if (el) el.classList.add("active");
  }

  function toast(message, kind = "info") {
    const root = $("#toast-root");
    const node = document.createElement("div");
    node.className = `toast ${kind}`;
    node.textContent = message;
    root.appendChild(node);
    setTimeout(() => {
      node.classList.add("out");
      setTimeout(() => node.remove(), 260);
    }, 3400);
  }

  function showAuthMessage(text, kind = "info") {
    const box = $("#auth-message");
    box.textContent = text;
    box.className = `auth-message ${kind}`;
    box.classList.remove("hidden");
  }
  function hideAuthMessage() { $("#auth-message").classList.add("hidden"); }

  function setLoading(btn, loading, label) {
    if (!btn) return;
    if (loading) {
      btn.dataset.label = btn.textContent;
      btn.disabled = true;
      btn.textContent = label || "Aguarde...";
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || btn.textContent;
    }
  }

  /* ----------------------------- modal ----------------------------- */
  function openModal(opts) {
    const root = $("#modal-root");
    const danger = opts.danger ? "btn-danger" : "btn-primary";
    root.innerHTML = `
      <div class="modal-overlay">
        <div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(opts.title || "")}">
          <div class="modal-head">
            <h3>${escapeHtml(opts.title || "")}</h3>
            <button type="button" class="icon-btn" data-close aria-label="Fechar">✕</button>
          </div>
          <form class="modal-form" novalidate>
            ${opts.body || ""}
            <div class="modal-actions">
              <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
              <button type="submit" class="btn ${danger}">${escapeHtml(opts.submitLabel || "Salvar")}</button>
            </div>
          </form>
        </div>
      </div>`;

    const overlay = root.firstElementChild;
    const form = $("form", overlay);

    function close() {
      document.removeEventListener("keydown", onKey);
      root.innerHTML = "";
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape") close(); }

    $$("[data-close]", overlay).forEach((b) => b.addEventListener("click", close));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type="submit"]');
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = "Salvando...";
      try {
        await opts.onSubmit(new FormData(form), form);
        close();
      } catch (err) {
        toast(err && err.message ? err.message : "Não foi possível salvar.", "error");
        btn.disabled = false;
        btn.textContent = original;
      }
    });

    if (opts.onMount) opts.onMount(form, close);
    const firstInput = form.querySelector("input:not([type=hidden]), select");
    if (firstInput) setTimeout(() => firstInput.focus(), 60);
    return { form, close, overlay };
  }

  /* ----------------------------- supabase auth ----------------------------- */
  async function ensureProfile() {
    const uid = state.user.id;
    let { data, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
    if (error) throw error;
    if (!data) {
      const meta = state.user.user_metadata || {};
      const insert = {
        id: uid,
        full_name: meta.full_name || "",
        email: state.user.email || ""
      };
      const res = await sb.from("profiles").insert(insert).select().single();
      if (res.error) {
        const retry = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
        if (retry.error) throw retry.error;
        data = retry.data;
      } else {
        data = res.data;
      }
    }
    state.profile = data || {};
    if (!state.profile.email) state.profile.email = state.user.email || "";
  }

  async function handleSession(session) {
    if (!session) {
      state.user = null;
      state.profile = null;
      state.transactions = [];
      state.budgets = [];
      state.goals = [];
      hideAuthMessage();
      showScreen("auth");
      return;
    }
    state.user = session.user;
    try {
      await ensureProfile();
    } catch (err) {
      console.error(err);
      showScreen("auth");
      showAuthMessage(
        "Não foi possível carregar seu perfil. Verifique se o schema do Supabase foi aplicado. " +
        (err.message || ""), "error"
      );
      return;
    }
    if (!state.profile.onboarding_completed) {
      openOnboarding();
    } else {
      await enterApp();
    }
  }

  async function enterApp() {
    showScreen("app");
    updateAvatar();
    await loadAll();
    renderView();
    const params = new URLSearchParams(location.search);
    if (params.get("action") === "new-transaction") {
      history.replaceState(null, "", location.pathname);
      openTransactionModal();
    }
  }

  /* ----------------------------- data ----------------------------- */
  async function loadAll() {
    try {
      const [tx, budgets, goals] = await Promise.all([
        sb.from("transactions").select("*").order("date", { ascending: false }).order("created_at", { ascending: false }),
        sb.from("budgets").select("*"),
        sb.from("goals").select("*").order("created_at", { ascending: false })
      ]);
      if (tx.error) throw tx.error;
      if (budgets.error) throw budgets.error;
      if (goals.error) throw goals.error;
      state.transactions = tx.data || [];
      state.budgets = budgets.data || [];
      state.goals = goals.data || [];
    } catch (err) {
      console.error(err);
      toast("Erro ao carregar seus dados. " + (err.message || ""), "error");
    }
  }

  function txForMonth(monthKey) {
    return state.transactions.filter((t) => (t.date || "").slice(0, 7) === monthKey);
  }
  function totals(list) {
    let income = 0, expense = 0;
    list.forEach((t) => {
      if (t.type === "income") income += Number(t.amount) || 0;
      else expense += Number(t.amount) || 0;
    });
    return { income, expense, balance: income - expense };
  }
  function expensesByCategory(list) {
    const map = {};
    list.filter((t) => t.type === "expense").forEach((t) => {
      map[t.category] = (map[t.category] || 0) + (Number(t.amount) || 0);
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }
  function budgetsForMonth(monthKey) {
    return state.budgets.filter((b) => (b.month || "").slice(0, 7) === monthKey);
  }
  function goalProgress(g) {
    return pct(Number(g.saved_amount) || 0, Number(g.target_amount) || 0);
  }

  /* ----------------------------- onboarding ----------------------------- */
  function openOnboarding() {
    const nameInput = $('#onboarding-step-1 [name="full_name"]');
    const incomeInput = $('#onboarding-step-1 [name="monthly_income"]');
    const challenge = $('#onboarding-step-1 [name="challenge"]');
    if (state.profile.full_name) nameInput.value = state.profile.full_name;
    if (state.profile.monthly_income) incomeInput.value = state.profile.monthly_income;
    if (state.profile.challenge) challenge.value = state.profile.challenge;
    if (state.profile.main_goal) {
      const radio = $(`#onboarding-step-2 input[name="main_goal"][value="${state.profile.main_goal}"]`);
      if (radio) radio.checked = true;
    }
    if (state.profile.risk_profile) {
      const risk = $('#onboarding-step-2 [name="risk_profile"]');
      if (risk) risk.value = state.profile.risk_profile;
    }
    $("#onboarding-exit").classList.remove("hidden");
    goOnboardingStep(0);
    showScreen("onboarding");
  }

  function goOnboardingStep(step) {
    $$(".onboarding-step").forEach((s) => s.classList.toggle("active", Number(s.dataset.step) === step));
    $$(".onboarding-progress .dot").forEach((d, i) => {
      d.classList.toggle("active", i === step);
      d.classList.toggle("done", i < step);
    });
  }

  async function saveOnboarding(form1, form2) {
    const payload = {
      full_name: (form1.get("full_name") || "").trim(),
      monthly_income: Number(form1.get("monthly_income")) || 0,
      challenge: form1.get("challenge") || null,
      main_goal: form2.get("main_goal") || null,
      risk_profile: form2.get("risk_profile") || "moderado",
      onboarding_completed: true,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await sb.from("profiles").update(payload).eq("id", state.user.id).select().single();
    if (error) throw error;
    state.profile = data;
    await enterApp();
    toast("Perfil pronto! Bem-vinda ao ALINEFINANCE.", "success");
  }

  /* ----------------------------- render shell ----------------------------- */
  const VIEW_TITLES = {
    dashboard: ["Visão geral", "Seu panorama financeiro"],
    transactions: ["Transações", "Registre e acompanhe seus lançamentos"],
    budgets: ["Orçamento", "Defina limites por categoria"],
    goals: ["Metas", "Seus objetivos financeiros"],
    reports: ["Relatórios", "Entenda para onde vai seu dinheiro"],
    tips: ["Dicas", "Conteúdo para o seu momento"],
    profile: ["Perfil", "Seus dados e preferências"]
  };

  function setTitles() {
    const [title, subtitle] = VIEW_TITLES[state.view] || VIEW_TITLES.dashboard;
    $("#page-title").textContent = title;
    let sub = subtitle;
    if (state.view === "dashboard") {
      sub = `${greeting()}, ${firstName()} · ${monthLabel(state.month)}`;
    }
    $("#page-subtitle").textContent = sub;
    $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === state.view));
    $$(".bottom-item[data-view]").forEach((n) => n.classList.toggle("active", n.dataset.view === state.view));
  }

  function updateAvatar() {
    const letter = (firstName()[0] || "A").toUpperCase();
    $("#user-avatar").textContent = letter;
    $("#user-avatar").title = (state.profile.full_name || "Perfil") + " · " + (state.profile.email || "");
  }

  function destroyCharts() {
    state.charts.forEach((c) => { try { c.destroy(); } catch (e) { /* ignore */ } });
    state.charts = [];
  }

  function renderView() {
    if (!state.user) return;
    destroyCharts();
    setTitles();
    const root = $("#view-root");
    root.innerHTML = "";
    switch (state.view) {
      case "transactions": renderTransactions(root); break;
      case "budgets": renderBudgets(root); break;
      case "goals": renderGoals(root); break;
      case "reports": renderReports(root); break;
      case "tips": renderTips(root); break;
      case "profile": renderProfile(root); break;
      default: renderDashboard(root);
    }
    renderSidebarTip();
  }

  function setView(view) {
    state.view = view;
    renderView();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderSidebarTip() {
    const tip = buildTips()[0];
    const box = $("#sidebar-tip");
    if (!box || !tip) return;
    box.innerHTML = `<strong>${escapeHtml(tip.title)}</strong>${escapeHtml(tip.text)}`;
  }

  /* ----------------------------- dashboard ----------------------------- */
  function renderDashboard(root) {
    const month = state.month;
    const list = txForMonth(month);
    const { income, expense, balance } = totals(list);
    const savingsRate = income > 0 ? ((income - expense) / income) * 100 : 0;
    const budgets = budgetsForMonth(month);
    const budgetLimit = budgets.reduce((s, b) => s + (Number(b.amount_limit) || 0), 0);
    const spentByCat = Object.fromEntries(expensesByCategory(list));
    const budgetSpent = budgets.reduce((s, b) => s + (spentByCat[b.category] || 0), 0);
    const budgetUsed = budgetLimit > 0 ? (budgetSpent / budgetLimit) * 100 : 0;
    const activeGoals = state.goals.filter((g) => (Number(g.saved_amount) || 0) < (Number(g.target_amount) || 0));
    const recent = state.transactions.slice(0, 6);
    const alerts = budgets
      .map((b) => ({ b, spent: spentByCat[b.category] || 0 }))
      .filter((x) => x.spent > Number(x.b.amount_limit));

    root.innerHTML = `
      <section class="section">
        <div class="hero-balance">
          <div class="hb-top">
            <div>
              <div class="hb-label">Saldo de ${escapeHtml(monthLabel(month))}</div>
              <div class="hb-value">${money(balance)}</div>
              <div class="hb-sub">${balance >= 0 ? "Você está no positivo. Continue assim!" : "Atenção: as despesas passaram das receitas."}</div>
            </div>
            <div class="hb-spark" aria-hidden="true">${balance >= 0 ? "↗" : "↘"}</div>
          </div>
          <div class="hb-chips">
            <div class="hb-chip"><em>Receitas</em><strong>${money(income)}</strong></div>
            <div class="hb-chip"><em>Despesas</em><strong>${money(expense)}</strong></div>
            <div class="hb-chip"><em>Taxa de economia</em><strong>${savingsRate.toFixed(0)}%</strong></div>
          </div>
        </div>
      </section>

      ${alerts.length ? `
      <section class="section">
        <div class="card" style="border-color:#f3c9cd;background:#fffafa">
          <div class="card-head" style="margin-bottom:6px">
            <h3 style="color:#b02a36">Orçamento estourado</h3>
            <span class="badge red">${alerts.length} categoria(s)</span>
          </div>
          <p class="muted" style="font-size:.86rem">
            ${alerts.map((a) => `${escapeHtml(a.b.category)} (${money(a.spent)} de ${money(a.b.amount_limit)})`).join(" · ")}
          </p>
        </div>
      </section>` : ""}

      <section class="section">
        <div class="grid grid-4">
          ${statCard("Taxa de economia", `${savingsRate.toFixed(0)}%`, "do que entrou ficou com você", "gold", "%")}
          ${statCard("Orçamento usado", budgetLimit > 0 ? `${clampPct(budgetUsed).toFixed(0)}%` : "—", budgetLimit > 0 ? `${money(budgetSpent)} de ${money(budgetLimit)}` : "Nenhum limite definido", "blue", "◎")}
          ${statCard("Metas ativas", String(activeGoals.length), activeGoals.length ? "continue avançando" : "crie sua primeira meta", "green", "★")}
          ${statCard("Lançamentos", String(list.length), "no mês selecionado", "red", "⇄")}
        </div>
      </section>

      <section class="section">
        <div class="dash-cols">
          <div class="card">
            <div class="card-head">
              <h3>Transações recentes</h3>
              <button class="btn btn-ghost btn-sm" data-go="transactions">Ver todas</button>
            </div>
            ${recent.length ? `<div class="recent-list">${recent.map(txRow).join("")}</div>` : `
              <div class="empty">
                <span class="empty-ico">⇄</span>
                <strong>Nenhum lançamento ainda</strong>
                <p>Registre sua primeira receita ou despesa para ver o resumo do mês.</p>
                <button class="btn btn-primary btn-sm" data-add-tx>Adicionar transação</button>
              </div>`}
          </div>

          <div class="grid">
            <div class="card">
              <div class="card-head">
                <h3>Metas</h3>
                <button class="btn btn-ghost btn-sm" data-go="goals">Ver todas</button>
              </div>
              ${state.goals.length ? state.goals.slice(0, 3).map(goalMini).join("") : `
                <div class="empty" style="padding:22px 12px">
                  <span class="empty-ico">★</span>
                  <strong>Sem metas por aqui</strong>
                  <p>Defina um objetivo e acompanhe o progresso.</p>
                  <button class="btn btn-ghost btn-sm" data-go="goals">Criar meta</button>
                </div>`}
            </div>

            <div class="card">
              <div class="card-head"><h3>Atalhos</h3></div>
              <div class="quick-links">
                <button class="quick-link" data-go="budgets"><span>◎</span><strong>Orçamento</strong><small>Limites por categoria</small></button>
                <button class="quick-link" data-go="reports"><span>▤</span><strong>Relatórios</strong><small>Gráficos do mês</small></button>
                <button class="quick-link" data-go="tips"><span>✦</span><strong>Dicas</strong><small>Para o seu perfil</small></button>
                <button class="quick-link" data-go="profile"><span>☺</span><strong>Perfil</strong><small>Seus dados</small></button>
              </div>
            </div>
          </div>
        </div>
      </section>`;

    bindCommon(root);
  }

  function statCard(label, value, sub, tone, ico) {
    return `<div class="card stat-card">
      <div class="stat-ico ${tone}">${ico}</div>
      <div class="stat-meta"><em>${escapeHtml(label)}</em><strong>${escapeHtml(value)}</strong><small>${escapeHtml(sub)}</small></div>
    </div>`;
  }

  function txRow(t) {
    const c = catInfo(t.category);
    const isIncome = t.type === "income";
    return `<div class="tx-row">
      <div class="tx-ico ${isIncome ? "income" : "expense"}" style="color:${c.color}">${escapeHtml(c.abbr)}</div>
      <div class="tx-main">
        <strong>${escapeHtml(t.description || t.category)}</strong>
        <small>${escapeHtml(t.category)} · ${dateBR(t.date)}</small>
      </div>
      <div class="tx-amt ${isIncome ? "income" : "expense"}">${isIncome ? "+" : "−"} ${money(t.amount)}</div>
    </div>`;
  }

  function goalMini(g) {
    const p = goalProgress(g);
    return `<div class="goal-mini">
      <div class="gm-top"><strong>${escapeHtml(g.title)}</strong><span>${p.toFixed(0)}%</span></div>
      <div class="progress gold"><i style="width:${clampPct(p)}%"></i></div>
      <div class="gm-top"><span>${money(g.saved_amount)} de ${money(g.target_amount)}</span><span>${g.deadline ? dateBR(g.deadline) : ""}</span></div>
    </div>`;
  }

  /* ----------------------------- transactions ----------------------------- */
  function renderTransactions(root) {
    const list = txForMonth(state.month)
      .filter((t) => state.txType === "all" || t.type === state.txType)
      .filter((t) => {
        const q = state.txSearch.trim().toLowerCase();
        if (!q) return true;
        return (t.description || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q);
      });
    const { income, expense, balance } = totals(list);

    root.innerHTML = `
      <section class="section">
        <div class="tx-summary">
          <div class="totals">
            <div><em>Receitas</em><strong style="color:var(--success)">${money(income)}</strong></div>
            <div><em>Despesas</em><strong style="color:var(--danger)">${money(expense)}</strong></div>
            <div><em>Saldo</em><strong>${money(balance)}</strong></div>
          </div>
          <button class="btn btn-primary btn-sm" data-add-tx>+ Nova transação</button>
        </div>

        <div class="toolbar">
          <div class="grow">
            <input type="search" id="tx-search" placeholder="Buscar por descrição ou categoria..." value="${escapeHtml(state.txSearch)}" />
          </div>
          <input type="month" id="tx-month" value="${state.month}" />
          <div class="seg" id="tx-type">
            <button data-type="all" class="${state.txType === "all" ? "active" : ""}">Todas</button>
            <button data-type="income" class="${state.txType === "income" ? "active" : ""}">Receitas</button>
            <button data-type="expense" class="${state.txType === "expense" ? "active" : ""}">Despesas</button>
          </div>
        </div>

        <div id="tx-list"></div>
      </section>`;

    renderTxList($("#tx-list"), list);

    $("#tx-search").addEventListener("input", (e) => {
      state.txSearch = e.target.value;
      renderTxList($("#tx-list"), filterTx());
    });
    $("#tx-month").addEventListener("change", (e) => {
      if (!e.target.value) return;
      state.month = e.target.value;
      renderView();
    });
    $$("#tx-type button").forEach((b) => b.addEventListener("click", () => {
      state.txType = b.dataset.type;
      $$("#tx-type button").forEach((x) => x.classList.toggle("active", x === b));
      renderTxList($("#tx-list"), filterTx());
    }));
    bindCommon(root);
  }

  function filterTx() {
    return txForMonth(state.month)
      .filter((t) => state.txType === "all" || t.type === state.txType)
      .filter((t) => {
        const q = state.txSearch.trim().toLowerCase();
        if (!q) return true;
        return (t.description || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q);
      });
  }

  function renderTxList(container, list) {
    if (!container) return;
    if (!list.length) {
      container.innerHTML = `<div class="empty">
        <span class="empty-ico">⇄</span>
        <strong>Nada por aqui</strong>
        <p>Não encontramos lançamentos com esses filtros. Que tal adicionar um?</p>
        <button class="btn btn-primary btn-sm" data-add-tx>Adicionar transação</button>
      </div>`;
      bindCommon(container);
      return;
    }
    const groups = {};
    list.forEach((t) => { (groups[t.date] = groups[t.date] || []).push(t); });
    const dates = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));
    container.innerHTML = `<div class="tx-list">${dates.map((d) => `
      <div class="tx-day">
        <div class="tx-day-label">${dateBR(d)}</div>
        ${groups[d].map(txItem).join("")}
      </div>`).join("")}</div>`;
    bindCommon(container);
  }

  function txItem(t) {
    const c = catInfo(t.category);
    const isIncome = t.type === "income";
    return `<div class="tx-item">
      <div class="tx-ico ${isIncome ? "income" : "expense"}" style="color:${c.color}">${escapeHtml(c.abbr)}</div>
      <div class="tx-main">
        <strong>${escapeHtml(t.description || t.category)}</strong>
        <small>${escapeHtml(t.category)}${t.type === "income" ? " · receita" : ""}</small>
      </div>
      <div class="tx-amt ${isIncome ? "income" : "expense"}">${isIncome ? "+" : "−"} ${money(t.amount)}</div>
      <div class="tx-actions">
        <button class="icon-btn" data-edit-tx="${t.id}" title="Editar" aria-label="Editar">✎</button>
        <button class="icon-btn danger" data-del-tx="${t.id}" title="Excluir" aria-label="Excluir">✕</button>
      </div>
    </div>`;
  }

  function openTransactionModal(existing) {
    const t = existing || null;
    const type = t ? t.type : "expense";
    openModal({
      title: t ? "Editar transação" : "Nova transação",
      submitLabel: t ? "Salvar alterações" : "Adicionar",
      body: `
        <div class="type-toggle" data-type-toggle>
          <button type="button" data-type="expense" class="${type === "expense" ? "active" : ""}">Despesa</button>
          <button type="button" data-type="income" class="${type === "income" ? "active" : ""}">Receita</button>
        </div>
        <input type="hidden" name="type" value="${type}" />
        <label class="field"><span>Valor (R$)</span>
          <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" required value="${t ? Number(t.amount) : ""}" />
        </label>
        <label class="field"><span>Categoria</span>
          <select name="category" required>${catOptions(type, t ? t.category : "")}</select>
        </label>
        <label class="field"><span>Descrição</span>
          <input type="text" name="description" placeholder="Opcional" value="${t ? escapeHtml(t.description || "") : ""}" />
        </label>
        <label class="field"><span>Data</span>
          <input type="date" name="date" required value="${t ? t.date : todayISO()}" />
        </label>`,
      onMount: (form) => {
        $$("[data-type-toggle] button", form).forEach((b) => {
          b.addEventListener("click", () => {
            $$("[data-type-toggle] button", form).forEach((x) => x.classList.toggle("active", x === b));
            form.querySelector('[name="type"]').value = b.dataset.type;
            form.querySelector('[name="category"]').innerHTML = catOptions(b.dataset.type, "");
          });
        });
      },
      onSubmit: async (fd) => {
        const amount = Number(fd.get("amount"));
        if (!amount || amount <= 0) throw new Error("Informe um valor maior que zero.");
        const payload = {
          user_id: state.user.id,
          type: fd.get("type"),
          amount,
          category: fd.get("category"),
          description: (fd.get("description") || "").trim() || null,
          date: fd.get("date")
        };
        if (t) {
          const { error } = await sb.from("transactions").update(payload).eq("id", t.id);
          if (error) throw error;
        } else {
          const { error } = await sb.from("transactions").insert(payload);
          if (error) throw error;
        }
        await loadAll();
        renderView();
        toast(t ? "Transação atualizada." : "Transação adicionada.", "success");
      }
    });
  }

  async function deleteTransaction(id) {
    if (!window.confirm("Excluir esta transação? Essa ação não pode ser desfeita.")) return;
    const { error } = await sb.from("transactions").delete().eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    await loadAll();
    renderView();
    toast("Transação excluída.", "success");
  }

  /* ----------------------------- budgets ----------------------------- */
  function renderBudgets(root) {
    const month = state.month;
    const budgets = budgetsForMonth(month);
    const spent = Object.fromEntries(expensesByCategory(txForMonth(month)));
    const totalLimit = budgets.reduce((s, b) => s + (Number(b.amount_limit) || 0), 0);
    const totalSpent = budgets.reduce((s, b) => s + (spent[b.category] || 0), 0);

    root.innerHTML = `
      <section class="section">
        <div class="card">
          <div class="reports-top" style="margin-bottom:12px">
            <div>
              <h3 style="font-size:1rem">Orçamento de ${escapeHtml(monthLabel(month))}</h3>
              <p class="muted" style="font-size:.84rem">${budgets.length ? `${money(totalSpent)} gastos de ${money(totalLimit)} planejados` : "Defina limites mensais por categoria"}</p>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <input type="month" id="budget-month" value="${month}" style="border:1px solid var(--line-strong);border-radius:11px;padding:9px 11px;font-size:.85rem" />
              <button class="btn btn-primary btn-sm" data-add-budget>+ Limite</button>
            </div>
          </div>
          ${budgets.length ? `
            <div class="progress ${totalSpent > totalLimit ? "red" : ""}" style="height:12px"><i style="width:${clampPct(pct(totalSpent, totalLimit))}%"></i></div>
            <div class="budget-nums" style="margin-top:8px"><span>${pct(totalSpent, totalLimit).toFixed(0)}% usado</span><span>${money(Math.max(0, totalLimit - totalSpent))} disponível</span></div>
          ` : ""}
        </div>
      </section>

      <section class="section">
        ${budgets.length ? `<div class="budget-grid">${budgets.map((b) => budgetCard(b, spent[b.category] || 0)).join("")}</div>` : `
          <div class="empty">
            <span class="empty-ico">◎</span>
            <strong>Nenhum orçamento definido</strong>
            <p>Escolha um limite para cada categoria e receba alertas quando estiver perto de estourar.</p>
            <button class="btn btn-primary btn-sm" data-add-budget>Criar meu primeiro limite</button>
          </div>`}
      </section>`;

    $("#budget-month").addEventListener("change", (e) => {
      if (!e.target.value) return;
      state.month = e.target.value;
      renderView();
    });
    bindCommon(root);
  }

  function budgetCard(b, spent) {
    const limit = Number(b.amount_limit) || 0;
    const p = pct(spent, limit);
    const tone = p >= 100 ? "red" : p >= 80 ? "gold" : "";
    const badge = p >= 100
      ? '<span class="badge red">Excedido</span>'
      : p >= 80 ? '<span class="badge gold">Atenção</span>' : '<span class="badge green">No controle</span>';
    const c = catInfo(b.category);
    return `<div class="card budget-card">
      <div class="budget-top">
        <div style="display:flex;align-items:center;gap:9px">
          <span class="tx-ico" style="width:34px;height:34px;color:${c.color}">${escapeHtml(c.abbr)}</span>
          <strong>${escapeHtml(b.category)}</strong>
        </div>
        <span class="pct">${p.toFixed(0)}%</span>
      </div>
      <div class="progress ${tone}"><i style="width:${clampPct(p)}%"></i></div>
      <div class="budget-nums"><span>Gasto: <b>${money(spent)}</b></span><span>Limite: <b>${money(limit)}</b></span></div>
      <div class="budget-foot">
        ${badge}
        <div class="budget-actions">
          <button class="icon-btn" data-edit-budget="${b.id}" title="Editar">✎</button>
          <button class="icon-btn danger" data-del-budget="${b.id}" title="Excluir">✕</button>
        </div>
      </div>
    </div>`;
  }

  function openBudgetModal(existing) {
    const b = existing || null;
    const monthKey = b ? (b.month || "").slice(0, 7) : state.month;
    openModal({
      title: b ? "Editar limite" : "Novo limite de orçamento",
      submitLabel: b ? "Salvar" : "Criar limite",
      body: `
        <label class="field"><span>Categoria</span>
          <select name="category" required ${b ? "disabled" : ""}>${catOptions("expense", b ? b.category : "")}</select>
        </label>
        <label class="field"><span>Limite mensal (R$)</span>
          <input type="number" name="amount_limit" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" required value="${b ? Number(b.amount_limit) : ""}" />
        </label>
        <label class="field"><span>Mês</span>
          <input type="month" name="month" required value="${monthKey}" />
        </label>
        ${b ? '<input type="hidden" name="category_hidden" value="' + escapeHtml(b.category) + '" />' : ""}`,
      onSubmit: async (fd) => {
        const limit = Number(fd.get("amount_limit"));
        if (!limit || limit <= 0) throw new Error("Informe um limite maior que zero.");
        const category = b ? b.category : fd.get("category");
        const month = `${fd.get("month")}-01`;
        if (b) {
          const { error } = await sb.from("budgets").update({ amount_limit: limit, month }).eq("id", b.id);
          if (error) throw error;
        } else {
          const { error } = await sb.from("budgets").upsert(
            { user_id: state.user.id, category, amount_limit: limit, month },
            { onConflict: "user_id,category,month" }
          );
          if (error) throw error;
        }
        await loadAll();
        renderView();
        toast(b ? "Limite atualizado." : "Limite criado.", "success");
      }
    });
  }

  async function deleteBudget(id) {
    if (!window.confirm("Remover este limite de orçamento?")) return;
    const { error } = await sb.from("budgets").delete().eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    await loadAll();
    renderView();
    toast("Limite removido.", "success");
  }

  /* ----------------------------- goals ----------------------------- */
  function renderGoals(root) {
    root.innerHTML = `
      <section class="section">
        <div class="reports-top" style="margin-bottom:0">
          <p class="muted" style="font-size:.88rem">${state.goals.length ? `${state.goals.length} meta(s) cadastrada(s)` : "Crie objetivos e acompanhe cada passo"}</p>
          <button class="btn btn-primary btn-sm" data-add-goal>+ Nova meta</button>
        </div>
      </section>
      <section class="section">
        ${state.goals.length ? `<div class="goals-grid">${state.goals.map(goalCard).join("")}</div>` : `
          <div class="empty">
            <span class="empty-ico">★</span>
            <strong>Nenhuma meta ainda</strong>
            <p>Uma viagem, a reserva de emergência ou quitar uma dívida: escolha um objetivo e comece.</p>
            <button class="btn btn-primary btn-sm" data-add-goal>Criar meta</button>
          </div>`}
      </section>`;
    bindCommon(root);
  }

  function goalCard(g) {
    const p = goalProgress(g);
    const done = p >= 100;
    const c = done ? "green" : p >= 60 ? "gold" : "";
    return `<div class="card goal-card">
      <div class="goal-head">
        <div>
          <strong>${escapeHtml(g.title)}</strong>
          <small>${g.deadline ? `Prazo: ${dateBR(g.deadline)}` : "Sem prazo definido"}</small>
        </div>
        <span class="badge ${done ? "green" : ""}">${done ? "Concluída" : p.toFixed(0) + "%"}</span>
      </div>
      <div class="progress ${c}"><i style="width:${clampPct(p)}%"></i></div>
      <div class="goal-values"><span><b>${money(g.saved_amount)}</b> guardados</span><span>Meta: <b>${money(g.target_amount)}</b></span></div>
      <div class="goal-actions">
        <button class="btn btn-ghost btn-sm" data-add-goal-value="${g.id}">+ Guardar</button>
        <button class="icon-btn" data-edit-goal="${g.id}" title="Editar">✎</button>
        <button class="icon-btn danger" data-del-goal="${g.id}" title="Excluir">✕</button>
      </div>
    </div>`;
  }

  function openGoalModal(existing) {
    const g = existing || null;
    openModal({
      title: g ? "Editar meta" : "Nova meta",
      submitLabel: g ? "Salvar" : "Criar meta",
      body: `
        <label class="field"><span>Nome da meta</span>
          <input type="text" name="title" required placeholder="Ex.: Reserva de emergência" value="${g ? escapeHtml(g.title) : ""}" />
        </label>
        <div class="field-row">
          <label class="field"><span>Valor alvo (R$)</span>
            <input type="number" name="target_amount" min="0.01" step="0.01" inputmode="decimal" required value="${g ? Number(g.target_amount) : ""}" />
          </label>
          <label class="field"><span>Já guardado (R$)</span>
            <input type="number" name="saved_amount" min="0" step="0.01" inputmode="decimal" value="${g ? Number(g.saved_amount) : 0}" />
          </label>
        </div>
        <label class="field"><span>Prazo (opcional)</span>
          <input type="date" name="deadline" value="${g && g.deadline ? g.deadline : ""}" />
        </label>`,
      onSubmit: async (fd) => {
        const target = Number(fd.get("target_amount"));
        if (!target || target <= 0) throw new Error("Informe um valor alvo maior que zero.");
        const payload = {
          user_id: state.user.id,
          title: (fd.get("title") || "").trim(),
          target_amount: target,
          saved_amount: Number(fd.get("saved_amount")) || 0,
          deadline: fd.get("deadline") || null
        };
        if (!payload.title) throw new Error("Informe um nome para a meta.");
        if (g) {
          const { error } = await sb.from("goals").update(payload).eq("id", g.id);
          if (error) throw error;
        } else {
          const { error } = await sb.from("goals").insert(payload);
          if (error) throw error;
        }
        await loadAll();
        renderView();
        toast(g ? "Meta atualizada." : "Meta criada.", "success");
      }
    });
  }

  function openGoalValueModal(g) {
    openModal({
      title: `Guardar em “${g.title}”`,
      submitLabel: "Guardar",
      body: `
        <p class="muted" style="font-size:.86rem">Faltam ${money(Math.max(0, Number(g.target_amount) - Number(g.saved_amount)))} para concluir esta meta.</p>
        <label class="field"><span>Valor a guardar (R$)</span>
          <input type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" required />
        </label>`,
      onSubmit: async (fd) => {
        const add = Number(fd.get("amount"));
        if (!add || add <= 0) throw new Error("Informe um valor maior que zero.");
        const saved = (Number(g.saved_amount) || 0) + add;
        const { error } = await sb.from("goals").update({ saved_amount: saved }).eq("id", g.id);
        if (error) throw error;
        await loadAll();
        renderView();
        toast("Valor guardado. Continue assim!", "success");
      }
    });
  }

  async function deleteGoal(id) {
    if (!window.confirm("Excluir esta meta?")) return;
    const { error } = await sb.from("goals").delete().eq("id", id);
    if (error) { toast(error.message, "error"); return; }
    await loadAll();
    renderView();
    toast("Meta excluída.", "success");
  }

  /* ----------------------------- reports ----------------------------- */
  function renderReports(root) {
    const month = state.month;
    const list = txForMonth(month);
    const { income, expense, balance } = totals(list);
    const cats = expensesByCategory(list);
    const hasData = list.length > 0;

    root.innerHTML = `
      <section class="section">
        <div class="reports-top">
          <div class="seg">
            <span class="pill" style="border:0;background:transparent;padding:0 4px;font-size:.82rem">Período</span>
            <input type="month" id="report-month" value="${month}" style="border:0;background:transparent;font-weight:600;font-size:.85rem" />
          </div>
          <span class="badge blue">${list.length} lançamentos</span>
        </div>
        <div class="kpi-row">
          <div class="kpi"><em>Receitas</em><strong style="color:var(--success)">${money(income)}</strong></div>
          <div class="kpi"><em>Despesas</em><strong style="color:var(--danger)">${money(expense)}</strong></div>
          <div class="kpi"><em>Saldo</em><strong>${money(balance)}</strong></div>
        </div>
      </section>

      <section class="section">
        <div class="grid grid-2">
          <div class="card chart-card">
            <div class="card-head"><h3>Despesas por categoria</h3><span class="muted">${escapeHtml(monthLabel(month))}</span></div>
            ${cats.length ? `<div class="chart-wrap"><canvas id="chart-cats"></canvas></div>` : emptyChart("Sem despesas neste mês")}
          </div>
          <div class="card chart-card">
            <div class="card-head"><h3>Receitas x despesas</h3><span class="muted">Últimos 6 meses</span></div>
            <div class="chart-wrap"><canvas id="chart-months"></canvas></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="grid grid-2">
          <div class="card">
            <div class="card-head"><h3>Maiores gastos</h3><span class="muted">por categoria</span></div>
            ${cats.length ? `<div class="recent-list">${cats.slice(0, 6).map(([name, val]) => {
              const c = catInfo(name);
              const p = pct(val, expense);
              return `<div class="tx-row">
                <div class="tx-ico" style="color:${c.color}">${escapeHtml(c.abbr)}</div>
                <div class="tx-main"><strong>${escapeHtml(name)}</strong><div class="progress" style="margin-top:6px"><i style="width:${clampPct(p)}%;background:${c.color}"></i></div></div>
                <div class="tx-amt">${money(val)}<br /><small class="muted">${p.toFixed(0)}%</small></div>
              </div>`;
            }).join("")}</div>` : `<div class="empty" style="padding:22px 12px"><strong>Sem dados</strong><p>Adicione despesas para ver o ranking.</p></div>`}
          </div>
          <div class="card">
            <div class="card-head"><h3>Resumo do período</h3></div>
            ${hasData ? `<div class="recent-list">
              ${reportLine("Média por lançamento", money((income + expense) / Math.max(1, list.length)))}
              ${reportLine("Maior receita", money(Math.max(0, ...list.filter((t) => t.type === "income").map((t) => Number(t.amount) || 0))))}
              ${reportLine("Maior despesa", money(Math.max(0, ...list.filter((t) => t.type === "expense").map((t) => Number(t.amount) || 0))))}
              ${reportLine("Categoria que mais gasta", cats.length ? cats[0][0] : "—")}
              ${reportLine("Taxa de economia", income > 0 ? `${(((income - expense) / income) * 100).toFixed(0)}%` : "—")}
            </div>` : `<div class="empty" style="padding:22px 12px"><strong>Sem dados</strong><p>Registre lançamentos para gerar o resumo.</p></div>`}
          </div>
        </div>
      </section>`;

    $("#report-month").addEventListener("change", (e) => {
      if (!e.target.value) return;
      state.month = e.target.value;
      renderView();
    });

    if (cats.length) drawCategoryChart(cats, expense);
    drawMonthsChart(month);
  }

  function reportLine(label, value) {
    return `<div class="tx-row" style="padding:11px 4px"><div class="tx-main"><strong style="font-weight:600">${escapeHtml(label)}</strong></div><div class="tx-amt">${escapeHtml(value)}</div></div>`;
  }
  function emptyChart(msg) {
    return `<div class="empty" style="border:0;background:transparent"><span class="empty-ico">▤</span><strong>${escapeHtml(msg)}</strong><p>Adicione lançamentos para visualizar o gráfico.</p></div>`;
  }

  function chartReady() { return typeof window.Chart !== "undefined"; }

  function drawCategoryChart(cats, total) {
    if (!chartReady()) return;
    const ctx = $("#chart-cats");
    if (!ctx) return;
    const labels = cats.map(([n]) => n);
    const values = cats.map(([, v]) => v);
    const colors = cats.map(([n]) => catInfo(n).color);
    const chart = new window.Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: "#fff", hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded", font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${money(c.parsed)} (${pct(c.parsed, total).toFixed(0)}%)` } }
        }
      }
    });
    state.charts.push(chart);
  }

  function drawMonthsChart(monthKey) {
    if (!chartReady()) return;
    const ctx = $("#chart-months");
    if (!ctx) return;
    const [y, m] = monthKey.split("-").map(Number);
    const keys = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
    }
    const data = keys.map((k) => totals(txForMonth(k)));
    const chart = new window.Chart(ctx, {
      type: "bar",
      data: {
        labels: keys.map(shortMonth),
        datasets: [
          { label: "Receitas", data: data.map((d) => d.income), backgroundColor: "#1fa971", borderRadius: 6, maxBarThickness: 26 },
          { label: "Despesas", data: data.map((d) => d.expense), backgroundColor: "#e25c66", borderRadius: 6, maxBarThickness: 26 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded", font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y)}` } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { grid: { color: "#eef3f0" }, ticks: { font: { size: 11 }, callback: (v) => "R$ " + v } }
        }
      }
    });
    state.charts.push(chart);
  }

  /* ----------------------------- tips ----------------------------- */
  const STATIC_TIPS = [
    { icon: "50", tag: "Regra de ouro", title: "A regra 50/30/20", text: "Destine 50% da renda para necessidades, 30% para desejos e 20% para poupar ou investir. Ajuste conforme a sua realidade." },
    { icon: "R$", tag: "Reserva", title: "Monte sua reserva de emergência", text: "Guarde de 3 a 6 meses das suas despesas fixas em um lugar seguro e de fácil acesso, como a poupança ou um CDB com liquidez diária." },
    { icon: "!", tag: "Dívidas", title: "Priorize as dívidas mais caras", text: "Cartão de crédito e cheque especial costumam ter os juros mais altos. Quitá-los primeiro libera mais dinheiro no mês." },
    { icon: "↓", tag: "Gastos", title: "Revise assinaturas", text: "Streaming, apps e serviços recorrentes somam no fim do mês. Cancele o que você não usa de verdade." },
    { icon: "✓", tag: "Hábito", title: "Pague-se primeiro", text: "Assim que receber, separe a quantia que vai poupar antes de gastar. Trate a economia como uma conta fixa." },
    { icon: "%", tag: "Investimentos", title: "Invista com objetivos", text: "Curto prazo pede segurança e liquidez; longo prazo permite mais risco. Alinhe o investimento ao seu prazo." },
    { icon: "◷", tag: "Organização", title: "Anote todo gasto por 30 dias", text: "O simples ato de registrar revela padrões invisíveis. Use o ALINEFINANCE diariamente por um mês." },
    { icon: "◎", tag: "Metas", title: "Divida metas grandes", text: "Transforme um sonho grande em pequenas metas mensais. Fica mais fácil manter o foco e comemorar cada avanço." }
  ];

  function buildTips() {
    const month = currentMonthKey();
    const list = txForMonth(month);
    const { income, expense } = totals(list);
    const rate = income > 0 ? (income - expense) / income : 0;
    const budgets = budgetsForMonth(month);
    const spent = Object.fromEntries(expensesByCategory(list));
    const over = budgets.filter((b) => (spent[b.category] || 0) > Number(b.amount_limit));
    const tips = [];

    if (!list.length) {
      tips.push({ icon: "→", tag: "Para você", title: "Comece registrando o mês", text: "Adicione suas receitas e despesas para receber dicas personalizadas com base na sua realidade." });
    }
    if (income > 0 && expense > income) {
      tips.push({ icon: "!", tag: "Para você", title: "Você gastou mais do que recebeu", text: `Neste mês as despesas passaram das receitas em ${money(expense - income)}. Comece cortando os gastos variáveis, como lazer e compras.` });
    } else if (income > 0 && rate < 0.1) {
      tips.push({ icon: "↑", tag: "Para você", title: "Sua taxa de economia está baixa", text: `Você guardou cerca de ${(rate * 100).toFixed(0)}% da renda. Tente chegar a 10% neste mês, mesmo que em pequenos valores.` });
    } else if (income > 0 && rate >= 0.2) {
      tips.push({ icon: "✓", tag: "Para você", title: "Excelente taxa de economia!", text: `Você está guardando ${(rate * 100).toFixed(0)}% da renda. Considere investir parte desse valor para o longo prazo.` });
    }
    if (over.length) {
      tips.push({ icon: "◎", tag: "Para você", title: "Orçamento estourado", text: `A categoria ${over[0].category} passou do limite. Reveja os gastos dela antes do fim do mês.` });
    }
    if (state.profile.main_goal === "sair_dividas") {
      tips.push({ icon: "!", tag: "Seu objetivo", title: "Foco em sair das dívidas", text: "Liste todas as dívidas com juros e valores. Quite primeiro as mais caras e negocie prazos quando possível." });
    } else if (state.profile.main_goal === "investir") {
      tips.push({ icon: "%", tag: "Seu objetivo", title: "Primeiros passos para investir", text: `Seu perfil é ${RISK_LABELS[state.profile.risk_profile] || "moderado"}. Antes de investir, garanta reserva de emergência e dívidas controladas.` });
    } else if (state.profile.main_goal === "realizar_sonho") {
      tips.push({ icon: "★", tag: "Seu objetivo", title: "Planeje o seu sonho", text: "Crie uma meta no app com o valor total e o prazo. Dividir o valor pelos meses mostra quanto guardar por mês." });
    } else if (state.profile.main_goal === "economizar") {
      tips.push({ icon: "R$", tag: "Seu objetivo", title: "Construa o hábito de poupar", text: "Comece com um valor pequeno e automático. O importante é a constância, não o tamanho do primeiro passo." });
    }

    const picked = tips.concat(STATIC_TIPS.filter((t) => !tips.some((x) => x.title === t.title)));
    return picked;
  }

  function renderTips(root) {
    const tips = buildTips();
    const mainGoal = GOAL_LABELS[state.profile.main_goal] || "Seu momento";
    root.innerHTML = `
      <section class="section">
        <div class="tips-hero">
          <div class="bulb">✦</div>
          <div>
            <h3>Dicas para ${escapeHtml(firstName())}</h3>
            <p>Personalizadas com base no seu objetivo: <strong>${escapeHtml(mainGoal)}</strong>.</p>
          </div>
        </div>
      </section>
      <section class="section">
        <div class="tips-grid">
          ${tips.map((t) => `
            <article class="card tip-card">
              <div class="tip-ico">${escapeHtml(t.icon)}</div>
              <span class="tip-tag">${escapeHtml(t.tag)}</span>
              <h4>${escapeHtml(t.title)}</h4>
              <p>${escapeHtml(t.text)}</p>
            </article>`).join("")}
        </div>
      </section>`;
  }

  /* ----------------------------- profile ----------------------------- */
  function renderProfile(root) {
    const p = state.profile || {};
    root.innerHTML = `
      <section class="section">
        <div class="card">
          <div class="profile-head">
            <div class="profile-avatar">${escapeHtml((firstName()[0] || "A").toUpperCase())}</div>
            <div>
              <h3>${escapeHtml(p.full_name || "Seu nome")}</h3>
              <p>${escapeHtml(p.email || state.user.email || "")}</p>
              <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
                <span class="badge green">${escapeHtml(GOAL_LABELS[p.main_goal] || "Objetivo não definido")}</span>
                <span class="badge blue">${escapeHtml(RISK_LABELS[p.risk_profile] || "Perfil moderado")}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <div class="card-head"><h3>Seus dados</h3><span class="muted">usados para personalizar o app</span></div>
          <form class="profile-form" id="profile-form">
            <label class="field"><span>Nome</span>
              <input type="text" name="full_name" required value="${escapeHtml(p.full_name || "")}" />
            </label>
            <label class="field"><span>Renda mensal aproximada (R$)</span>
              <input type="number" name="monthly_income" min="0" step="0.01" inputmode="decimal" value="${p.monthly_income ? Number(p.monthly_income) : ""}" />
            </label>
            <div class="field-row">
              <label class="field"><span>Objetivo principal</span>
                <select name="main_goal">
                  ${Object.entries(GOAL_LABELS).map(([v, l]) => `<option value="${v}"${p.main_goal === v ? " selected" : ""}>${l}</option>`).join("")}
                </select>
              </label>
              <label class="field"><span>Perfil de risco</span>
                <select name="risk_profile">
                  ${Object.entries(RISK_LABELS).map(([v, l]) => `<option value="${v}"${p.risk_profile === v ? " selected" : ""}>${l}</option>`).join("")}
                </select>
              </label>
            </div>
            <label class="field"><span>Seu maior desafio</span>
              <select name="challenge">
                ${Object.entries(CHALLENGE_LABELS).map(([v, l]) => `<option value="${v}"${p.challenge === v ? " selected" : ""}>${l}</option>`).join("")}
              </select>
            </label>
            <button type="submit" class="btn btn-primary" style="justify-self:start">Salvar alterações</button>
          </form>
        </div>
      </section>

      <section class="section">
        <div class="card">
          <div class="card-head"><h3>Preferências</h3></div>
          <button class="btn btn-ghost" id="install-profile" hidden>Instalar aplicativo</button>
          <button class="btn btn-ghost" id="logout-btn" style="margin-left:8px">Sair da conta</button>
        </div>
      </section>

      <section class="section">
        <div class="card danger-zone">
          <h4>Encerrar sessão</h4>
          <p>Você pode sair a qualquer momento. Seus dados permanecem salvos com segurança.</p>
          <button class="btn btn-danger" id="logout-btn-2">Sair da conta</button>
        </div>
      </section>`;

    $("#profile-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('[type="submit"]');
      setLoading(btn, true, "Salvando...");
      const { data, error } = await sb.from("profiles").update({
        full_name: (fd.get("full_name") || "").trim(),
        monthly_income: Number(fd.get("monthly_income")) || 0,
        main_goal: fd.get("main_goal"),
        risk_profile: fd.get("risk_profile"),
        challenge: fd.get("challenge"),
        updated_at: new Date().toISOString()
      }).eq("id", state.user.id).select().single();
      setLoading(btn, false);
      if (error) { toast(error.message, "error"); return; }
      state.profile = data;
      updateAvatar();
      renderView();
      toast("Dados atualizados.", "success");
    });

    const installBtn = $("#install-profile");
    if (deferredPrompt) {
      installBtn.hidden = false;
      installBtn.addEventListener("click", promptInstall);
    }
    $("#logout-btn").addEventListener("click", signOut);
    $("#logout-btn-2").addEventListener("click", signOut);
  }

  async function signOut() {
    if (!window.confirm("Sair da conta?")) return;
    if (sb) await sb.auth.signOut();
    state.user = null;
    state.profile = null;
    state.transactions = [];
    state.budgets = [];
    state.goals = [];
    showScreen("auth");
    toast("Sessão encerrada.");
  }

  /* ----------------------------- common bindings ----------------------------- */
  function bindCommon(root) {
    $$("[data-add-tx]", root).forEach((b) => b.addEventListener("click", () => openTransactionModal()));
    $$("[data-edit-tx]", root).forEach((b) => b.addEventListener("click", () => {
      const t = state.transactions.find((x) => x.id === b.dataset.editTx);
      if (t) openTransactionModal(t);
    }));
    $$("[data-del-tx]", root).forEach((b) => b.addEventListener("click", () => deleteTransaction(b.dataset.delTx)));

    $$("[data-add-budget]", root).forEach((b) => b.addEventListener("click", () => openBudgetModal()));
    $$("[data-edit-budget]", root).forEach((b) => b.addEventListener("click", () => {
      const x = state.budgets.find((v) => v.id === b.dataset.editBudget);
      if (x) openBudgetModal(x);
    }));
    $$("[data-del-budget]", root).forEach((b) => b.addEventListener("click", () => deleteBudget(b.dataset.delBudget)));

    $$("[data-add-goal]", root).forEach((b) => b.addEventListener("click", () => openGoalModal()));
    $$("[data-edit-goal]", root).forEach((b) => b.addEventListener("click", () => {
      const x = state.goals.find((v) => v.id === b.dataset.editGoal);
      if (x) openGoalModal(x);
    }));
    $$("[data-del-goal]", root).forEach((b) => b.addEventListener("click", () => deleteGoal(b.dataset.delGoal)));
    $$("[data-add-goal-value]", root).forEach((b) => b.addEventListener("click", () => {
      const x = state.goals.find((v) => v.id === b.dataset.addGoalValue);
      if (x) openGoalValueModal(x);
    }));

    $$("[data-go]", root).forEach((b) => b.addEventListener("click", () => setView(b.dataset.go)));
  }

  function bindPasswordToggle(input, button, hiddenLabel, visibleLabel) {
    const setVisibility = (visible) => {
      input.type = visible ? "text" : "password";
      button.textContent = visible ? "Ocultar" : "Mostrar";
      button.setAttribute("aria-label", visible ? visibleLabel : hiddenLabel);
      button.setAttribute("aria-pressed", String(visible));
    };

    button.addEventListener("click", () => setVisibility(input.type === "password"));
    return () => setVisibility(false);
  }

  /* ----------------------------- static bindings ----------------------------- */
  function bindStaticEvents() {
    const loginPassword = $("#login-password");
    const loginPasswordToggle = $("#toggle-login-password");
    const hideLoginPassword = bindPasswordToggle(
      loginPassword,
      loginPasswordToggle,
      "Mostrar senha",
      "Ocultar senha"
    );

    const signupPassword = $("#signup-password");
    const signupPasswordConfirmation = $("#signup-password-confirmation");
    const signupPasswordToggles = [
      bindPasswordToggle(signupPassword, $("#toggle-signup-password"), "Mostrar senha", "Ocultar senha"),
      bindPasswordToggle(signupPasswordConfirmation, $("#toggle-signup-password-confirmation"), "Mostrar senha repetida", "Ocultar senha repetida")
    ];
    const hideSignupPasswords = () => signupPasswordToggles.forEach((hide) => hide());
    const validateSignupPasswordConfirmation = () => {
      const matches = signupPassword.value === signupPasswordConfirmation.value;
      signupPasswordConfirmation.setCustomValidity(matches ? "" : "As senhas não coincidem.");
      signupPasswordConfirmation.setAttribute("aria-invalid", String(!matches));
    };
    signupPassword.addEventListener("input", validateSignupPasswordConfirmation);
    signupPasswordConfirmation.addEventListener("input", validateSignupPasswordConfirmation);

    // auth tabs
    $$("[data-auth-tab]").forEach((tab) => tab.addEventListener("click", () => {
      const target = tab.dataset.authTab;
      if (target !== "login") hideLoginPassword();
      if (target !== "signup") hideSignupPasswords();
      $$("[data-auth-tab]").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", t === tab ? "true" : "false");
      });
      $("#login-form").classList.toggle("hidden", target !== "login");
      $("#signup-form").classList.toggle("hidden", target !== "signup");
      hideAuthMessage();
    }));

    // login
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!sb) { showAuthMessage("Supabase não configurado. Edite js/config.js.", "error"); return; }
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('[type="submit"]');
      setLoading(btn, true, "Entrando...");
      hideAuthMessage();
      const { data, error } = await sb.auth.signInWithPassword({
        email: (fd.get("email") || "").trim(),
        password: fd.get("password") || ""
      });
      setLoading(btn, false);
      if (error) {
        showAuthMessage(
          error.message === "Invalid login credentials"
            ? "E-mail ou senha incorretos."
            : error.message, "error");
        return;
      }
      await handleSession(data.session);
    });

    // signup
    $("#signup-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      validateSignupPasswordConfirmation();
      if (!signupPasswordConfirmation.validity.valid) {
        signupPasswordConfirmation.reportValidity();
        return;
      }
      if (!sb) { showAuthMessage("Supabase não configurado. Edite js/config.js.", "error"); return; }
      const fd = new FormData(e.target);
      const btn = e.target.querySelector('[type="submit"]');
      setLoading(btn, true, "Criando...");
      hideAuthMessage();
      const { data, error } = await sb.auth.signUp({
        email: (fd.get("email") || "").trim(),
        password: fd.get("password") || "",
        options: { data: { full_name: (fd.get("full_name") || "").trim() } }
      });
      setLoading(btn, false);
      if (error) { showAuthMessage(error.message, "error"); return; }
      if (data.session) {
        await handleSession(data.session);
      } else {
        showAuthMessage("Conta criada! Enviamos um link de confirmação para o seu e-mail. Confirme para entrar.", "success");
        e.target.reset();
      }
    });

    // forgot password
    $("#forgot-password").addEventListener("click", async () => {
      if (!sb) { showAuthMessage("Supabase não configurado.", "error"); return; }
      const email = ($('#login-form [name="email"]').value || "").trim();
      if (!email) { showAuthMessage("Digite seu e-mail para recuperar a senha.", "error"); return; }
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + location.pathname
      });
      if (error) showAuthMessage(error.message, "error");
      else showAuthMessage("Enviamos um link de recuperação para o seu e-mail.", "success");
    });

    // onboarding navigation
    $$("[data-next-step]").forEach((b) => b.addEventListener("click", () => goOnboardingStep(1)));
    $$("[data-prev-step]").forEach((b) => b.addEventListener("click", () => {
      const step = Number(b.closest(".onboarding-step").dataset.step);
      goOnboardingStep(Math.max(0, step - 1));
    }));

    $("#onboarding-step-1").addEventListener("submit", (e) => {
      e.preventDefault();
      const name = e.target.querySelector('[name="full_name"]').value.trim();
      if (!name) { toast("Informe seu nome.", "error"); return; }
      goOnboardingStep(2);
    });

    $("#onboarding-step-2").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type="submit"]');
      const form1 = new FormData($("#onboarding-step-1"));
      const form2 = new FormData(e.target);
      if (!form2.get("main_goal")) { toast("Escolha um objetivo principal.", "error"); return; }
      setLoading(btn, true, "Salvando...");
      try {
        await saveOnboarding(form1, form2);
      } catch (err) {
        toast(err.message || "Erro ao salvar.", "error");
      } finally {
        setLoading(btn, false);
      }
    });

    $("#onboarding-exit").addEventListener("click", signOut);

    // navigation
    $$(".nav-item, .bottom-item[data-view]").forEach((b) => {
      if (!b.dataset.view) return;
      b.addEventListener("click", () => setView(b.dataset.view));
    });

    // quick add
    $("#quick-add").addEventListener("click", () => openTransactionModal());
    $("#bottom-add").addEventListener("click", () => openTransactionModal());
    $("#user-avatar").addEventListener("click", () => setView("profile"));

    // install
    const installBtn = $("#install-btn");
    if (installBtn) installBtn.addEventListener("click", promptInstall);
  }

  function promptInstall() {
    if (!deferredPrompt) { toast("Instalação indisponível neste navegador."); return; }
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(() => {
      deferredPrompt = null;
      const b = $("#install-btn");
      if (b) b.hidden = true;
    });
  }

  /* ----------------------------- PWA ----------------------------- */
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("SW:", err));
    });
  }

  function setupInstallPrompt() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      const b = $("#install-btn");
      if (b) b.hidden = false;
      const pb = $("#install-profile");
      if (pb) pb.hidden = false;
    });
  }

  /* ----------------------------- init ----------------------------- */
  async function init() {
    registerSW();
    setupInstallPrompt();
    bindStaticEvents();

    if (!isConfigured) {
      $("#config-warning").classList.remove("hidden");
      showScreen("auth");
      return;
    }
    if (!window.supabase) {
      showAuthMessage("Não foi possível carregar a biblioteca do Supabase.", "error");
      showScreen("auth");
      return;
    }

    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    if (window.Chart) {
      window.Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';
      window.Chart.defaults.color = "#6a817b";
    }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        state.user = null;
        state.profile = null;
        showScreen("auth");
      }
    });

    try {
      const { data } = await sb.auth.getSession();
      if (data && data.session) {
        await handleSession(data.session);
      } else {
        showScreen("auth");
      }
    } catch (err) {
      console.error(err);
      showScreen("auth");
      showAuthMessage("Erro ao iniciar. Verifique sua conexão e a configuração do Supabase.", "error");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
