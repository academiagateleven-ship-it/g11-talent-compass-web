"use strict";
const byId = (id) => document.getElementById(id);
const roles = { consulta: "Consulta", supervisor: "Supervisão", manager: "Manager", admin: "Admin" };
const appUrl = new URL("./", window.location.href).href;
const db = window.supabase?.createClient("https://nvlnulndlnxctcshyrnp.supabase.co", "sb_publishable_7rR80gMcy9at06Jx1gcIzA_XTks6H7S", { auth: { persistSession: false } });
let mode = "login";
let reports = [];
let activeUser = null;

function status(message = "") {
  byId("status").textContent = message;
  byId("status").hidden = !message;
}

function setMode(next) {
  mode = next;
  const names = { login: "Entrar", activate: "Ativar conta", recover: "Recuperar palavra-passe", password: "Definir palavra-passe" };
  byId("auth-title").textContent = names[next];
  byId("auth-submit").textContent = names[next];
  byId("auth-actions").hidden = next !== "login";
  byId("auth-back").hidden = next === "login" || next === "password";
  byId("email-label").hidden = next === "password";
  byId("email").required = next !== "password";
  byId("password-label").hidden = next === "recover";
  byId("password").required = next !== "recover";
  byId("password").value = "";
  byId("password").minLength = next === "login" ? 1 : 12;
  byId("password").autocomplete = next === "login" ? "current-password" : "new-password";
  status(next === "activate" ? "Usa o e-mail autorizado pelo administrador e uma palavra-passe com pelo menos 12 caracteres." : "");
}

function clearDashboard() {
  reports = [];
  activeUser = null;
  for (const id of ["metrics", "priorities", "accounts", "scope", "scope-list"]) byId(id).replaceChildren();
  byId("permission-form").reset();
  byId("target").readOnly = false;
  byId("report-note").textContent = "";
  byId("dashboard").hidden = true;
  byId("logout").hidden = true;
  byId("auth").hidden = false;
}

async function loadDashboard() {
  if (mode === "password") return;
  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) return;
  const { data: profile, error } = await db.from("compass_access").select("role,active").eq("email", user.email.toLowerCase()).maybeSingle();
  if (error || !profile?.active) {
    await db.auth.signOut();
    clearDashboard();
    status("Esta conta ainda precisa de autorização do administrador do Talent Compass.");
    return;
  }
  const { data, error: reportError } = await db.from("compass_reports").select("scope,snapshot").order("scope");
  if (reportError) {
    await db.auth.signOut();
    clearDashboard();
    status("Não foi possível carregar o relatório. Tenta novamente.");
    return;
  }
  reports = data;
  activeUser = profile;
  const locations = reports.filter(row => row.scope !== "executivo");
  byId("scope").replaceChildren(...locations.map(row => new Option(row.scope, row.scope)));
  byId("nav-locations").hidden = !locations.length;
  byId("nav-admin").hidden = profile.role !== "admin";
  byId("role").textContent = roles[profile.role];
  byId("auth").hidden = true;
  byId("dashboard").hidden = false;
  byId("logout").hidden = false;
  status();
  openSection("exec");
}

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value != null) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function renderReport(scope) {
  const snapshot = reports.find(row => row.scope === scope)?.snapshot;
  byId("report-title").textContent = scope === "executivo" ? "Visão executiva" : scope;
  byId("metrics").replaceChildren();
  byId("priorities").replaceChildren();
  byId("priority-panel").hidden = !snapshot?.prioridades?.length;
  byId("report-note").textContent = snapshot?.notas || "";
  byId("cutoff").textContent = snapshot ? "Dados de " + new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone: "UTC" }).format(new Date(snapshot.data)) : "Sem dados disponíveis.";
  if (!snapshot) return;
  for (const survey of snapshot.inqueritos) {
    const item = node("article", null, "panel metric");
    const rate = survey.universo ? new Intl.NumberFormat("pt-PT", { style: "percent", maximumFractionDigits: 1 }).format(survey.respondidas / survey.universo) : "—";
    item.append(node("h2", survey.nome), node("strong", rate), node("p", survey.universo ? survey.respondidas + " / " + survey.universo + " elegíveis" : "Amostra insuficiente"));
    byId("metrics").append(item);
  }
  const priorities = snapshot.prioridades ?? [];
  const max = Math.max(1, ...priorities.map(([, count]) => count));
  for (const [label, count] of priorities) {
    const row = node("div", null, "priority-row");
    const bar = node("progress");
    bar.max = max;
    bar.value = count;
    bar.setAttribute("aria-label", label);
    row.append(node("span", label), bar, node("strong", count));
    byId("priorities").append(row);
  }
}

function openSection(section) {
  if (section === "admin" && activeUser?.role !== "admin") return;
  for (const area of ["exec", "locations", "admin"]) {
    if (section === area) byId("nav-" + area).setAttribute("aria-current", "page");
    else byId("nav-" + area).removeAttribute("aria-current");
  }
  byId("report").hidden = section === "admin";
  byId("admin").hidden = section !== "admin";
  byId("scope-label").hidden = section !== "locations";
  if (section === "admin") return loadPermissions();
  renderReport(section === "exec" ? "executivo" : byId("scope").value);
}

function updateScopeFields() {
  byId("scope-field").hidden = byId("target-role").value === "consulta";
}

function editPermission(profile) {
  byId("target").value = profile.email;
  byId("target").readOnly = true;
  byId("target-role").value = profile.role;
  byId("target-active").checked = profile.active;
  for (const checkbox of byId("scope-list").querySelectorAll("input")) checkbox.checked = profile.scopes.includes(checkbox.value);
  updateScopeFields();
  byId("target-role").focus();
}

async function loadPermissions() {
  const scopeFields = byId("scope-list");
  if (!scopeFields.children.length) for (const { scope } of reports.filter(row => row.scope !== "executivo")) {
    const label = node("label", null, "check");
    const checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.value = scope;
    label.append(checkbox, node("span", scope));
    scopeFields.append(label);
  }
  const { data, error } = await db.from("compass_access").select("email,role,scopes,active").order("email");
  if (error) return status("Não foi possível carregar as permissões.");
  byId("accounts").replaceChildren();
  for (const profile of data) {
    const row = node("div", null, "account-row");
    const identity = node("div", profile.email);
    identity.append(node("small", roles[profile.role] + " · " + (profile.active ? "Ativo" : "Suspenso")));
    row.append(identity);
    if (profile.role !== "admin") {
      const edit = node("button", "Editar", "quiet");
      edit.type = "button";
      edit.addEventListener("click", () => editPermission(profile));
      row.append(edit);
    }
    byId("accounts").append(row);
  }
}

byId("permission-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const role = byId("target-role").value;
  const scopes = role === "consulta" ? [] : Array.from(byId("scope-list").querySelectorAll("input:checked"), box => box.value);
  const button = event.submitter;
  button.disabled = true;
  try {
    const { error } = await db.from("compass_access").upsert({
      email: byId("target").value.trim().toLowerCase(),
      role,
      scopes,
      active: byId("target-active").checked,
    });
    if (error) return status("Não foi possível guardar a permissão. Confirma o perfil e tenta de novo.");
    byId("permission-form").reset();
    await loadPermissions();
    status("Permissão guardada. A pessoa pode ativar a conta com o e-mail autorizado.");
  } finally { button.disabled = false; }
});
byId("permission-form").addEventListener("reset", () => {
  byId("target").readOnly = false;
  queueMicrotask(updateScopeFields);
});
byId("target-role").addEventListener("change", updateScopeFields);

byId("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return status("Não foi possível ligar ao serviço de autenticação.");
  const email = byId("email").value.trim().toLowerCase();
  const password = byId("password").value;
  const button = event.submitter;
  button.disabled = true;
  try {
    if (mode === "login") {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) return status("Confirma o e-mail e a palavra-passe. Se for o primeiro acesso, ativa a conta.");
      await loadDashboard();
    } else if (mode === "activate") {
      const { error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: appUrl } });
      if (error) return status("Não foi possível ativar a conta. Confirma o e-mail com o administrador.");
      setMode("login");
      status("Se a ativação for aceite, receberás uma mensagem para confirmar o e-mail.");
    } else if (mode === "recover") {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: appUrl });
      setMode("login");
      status(error ? "Não foi possível iniciar a recuperação. Tenta mais tarde." : "Se a conta existir, receberás uma mensagem de recuperação.");
    } else {
      const { error } = await db.auth.updateUser({ password });
      if (error) return status("Não foi possível guardar a palavra-passe. Pede um novo link.");
      setMode("login");
      await loadDashboard();
    }
  } finally { button.disabled = false; }
});
byId("activate").onclick = () => setMode("activate");
byId("recover").onclick = () => setMode("recover");
byId("auth-back").onclick = () => setMode("login");
byId("nav-exec").onclick = () => openSection("exec");
byId("nav-locations").onclick = () => openSection("locations");
byId("nav-admin").onclick = () => openSection("admin");
byId("scope").onchange = () => renderReport(byId("scope").value);
byId("logout").onclick = async () => {
  await db.auth.signOut();
  clearDashboard();
  setMode("login");
};
function theme(selected) {
  document.documentElement.dataset.theme = selected;
  byId("theme").textContent = selected === "light" ? "Tema escuro" : "Tema claro";
}
theme(localStorage.getItem("g11-compass-theme") === "light" ? "light" : "dark");
byId("theme").onclick = () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem("g11-compass-theme", next);
  theme(next);
};
if (!db) status("Serviço de autenticação indisponível.");
else {
  db.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") setMode("password");
    if (event === "SIGNED_OUT") clearDashboard();
    if (event === "INITIAL_SESSION") setTimeout(loadDashboard, 0);
  });
}
