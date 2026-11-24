"use strict";
const byId = (id) => document.getElementById(id);
const roles = { colaborador: "Colaborador", supervisor: "Supervisão", manager: "Manager", admin: "Admin" };
const identitySuffix = "@access.talent-compass.invalid";
const db = window.supabase?.createClient("https://nvlnulndlnxctcshyrnp.supabase.co", "sb_publishable_7rR80gMcy9at06Jx1gcIzA_XTks6H7S", { auth: { persistSession: false, detectSessionInUrl: false } });
const setupParameter = new URLSearchParams(window.location.hash.slice(1)).get("ativar");
let setupToken = /^[0-9a-f]{64}$/.test(setupParameter ?? "") ? setupParameter : null;
if (setupToken) window.history.replaceState(null, "", window.location.pathname + window.location.search);

let reports = [];
let activeUser = null;

function status(message = "") {
  byId("status").textContent = message;
  byId("status").hidden = !message;
}

function clearDashboard() {
  reports = [];
  activeUser = null;
  for (const id of ["metrics", "priorities", "accounts", "scope", "scope-list", "pulse-charts", "general-charts"]) byId(id).replaceChildren();
  byId("permission-form").reset();
  byId("target").readOnly = false;
  byId("report-note").textContent = "";
  byId("dashboard").hidden = true;
  byId("logout").hidden = true;
  byId("auth").hidden = false;
}

async function loadDashboard() {
  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) return;
  const code = user.email?.endsWith(identitySuffix) ? user.email.slice(0, -identitySuffix.length) : "";
  const { data: profile, error } = await db.from("compass_tiers").select("role,active").eq("code", code).maybeSingle();
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
  const charts = scope === "executivo" ? snapshot?.charts ?? [] : [];
  byId("executive-charts").hidden = !charts.length;
  byId("pulse-charts").replaceChildren(...charts.slice(0, 2).map(renderChart));
  byId("general-charts").replaceChildren(...charts.slice(2).map(renderChart));
  if (!snapshot) return;
  for (const survey of snapshot.inqueritos) {
    const item = node("article", null, "panel metric");
    const rate = survey.universo ? new Intl.NumberFormat("pt-PT", { style: "percent", maximumFractionDigits: 1 }).format(survey.respondidas / survey.universo) : "—";
    item.append(node("h2", survey.nome), node("strong", rate), node("p", survey.universo ? survey.respondidas + " / " + survey.universo + " elegíveis" : "Amostra insuficiente"));
    byId("metrics").append(item);
  }
  renderBars(snapshot.prioridades ?? [], byId("priorities"));
}

function renderChart(chart) {
  const card = node("article", null, "panel report-chart");
  card.append(node("h3", chart.title), node("p", chart.note, "sub"));
  const chartRows = node("div");
  renderBars(chart.rows, chartRows);
  card.append(chartRows);
  return card;
}

function renderBars(items, container) {
  const max = Math.max(1, ...items.map(([, count]) => count));
  for (const [label, count] of items) {
    const row = node("div", null, "priority-row");
    const bar = node("progress");
    bar.max = max;
    bar.value = count;
    bar.setAttribute("aria-label", label);
    row.append(node("span", label), bar, node("strong", count));
    container.append(row);
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
  byId("scope-field").hidden = byId("target-role").value === "colaborador";
}

function editPermission(profile) {
  byId("target").value = profile.code;
  byId("target").readOnly = true;
  updatePasswordField(true);
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
  const { data, error } = await db.from("compass_tiers").select("code,role,scopes,active").order("code");
  if (error) return status("Não foi possível carregar as permissões.");
  byId("accounts").replaceChildren();
  for (const profile of data) {
    const row = node("div", null, "account-row");
    const identity = node("div", "Código " + profile.code);
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

function updatePasswordField(editing) {
  byId("target-reset").hidden = !editing;
  byId("target-secret").required = !editing;
  byId("target-secret").value = "";
  byId("target-secret-caption").textContent = editing ? "Nova palavra-passe (opcional)" : "Palavra-passe inicial";
}

function validPassword() {
  const field = byId("target-secret");
  const valid = field.value.length >= 12 && new TextEncoder().encode(field.value).length <= 72;
  if (!valid) status("A palavra-passe deve ter pelo menos 12 caracteres e até 72 bytes.");
  return valid;
}

byId("permission-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const target = byId("target");
  const code = target.value.trim();
  const password = byId("target-secret").value;
  if (target.readOnly && password) return status("Para trocar a palavra-passe, usa Redefinir palavra-passe.");
  if (!target.readOnly && !validPassword()) return;
  const role = byId("target-role").value;
  const scopes = role === "colaborador" ? [] : Array.from(byId("scope-list").querySelectorAll("input:checked"), box => box.value);
  const active = byId("target-active").checked;
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = target.readOnly
      ? await db.from("compass_tiers").update({ role, scopes, active }).eq("code", code).select("code").single()
      : await db.functions.invoke("compass-account", { body: { action: "create", code, role, scopes, active, password } });
    if (result.error) return status("Não foi possível guardar. Confirma o código e as permissões escolhidas.");
    byId("permission-form").reset();
    await loadPermissions();
    status("Acesso guardado.");
  } catch {
    status("Não foi possível guardar o acesso.");
  } finally { button.disabled = false; }
});

byId("target-reset").onclick = async () => {
  if (!validPassword()) return;
  const button = byId("target-reset");
  button.disabled = true;
  try {
    const result = await db.functions.invoke("compass-account", { body: {
      action: "reset", code: byId("target").value, password: byId("target-secret").value,
    } });
    if (result.error) return status("Não foi possível redefinir a palavra-passe.");
    byId("target-secret").value = "";
    status("Palavra-passe redefinida.");
  } catch {
    status("Não foi possível redefinir a palavra-passe.");
  } finally { button.disabled = false; }
};

byId("permission-form").addEventListener("reset", () => {
  byId("target").readOnly = false;
  updatePasswordField(false);
  queueMicrotask(updateScopeFields);
});
byId("target-role").addEventListener("change", updateScopeFields);

function showAccessForm() {
  const settingUp = Boolean(setupToken);
  byId("auth-title").textContent = settingUp ? "Ativar Admin 41" : "Entrar";
  byId("auth-submit").textContent = settingUp ? "Ativar acesso" : "Entrar";
  byId("access-help").textContent = settingUp ? "Define a tua palavra-passe com pelo menos 16 caracteres." : "Para obter acesso, contacta o administrador do Talent Compass.";
  byId("code").readOnly = settingUp;
  if (settingUp) byId("code").value = "41";
  byId("password").minLength = settingUp ? 16 : 1;
  byId("password").autocomplete = settingUp ? "new-password" : "current-password";
}
showAccessForm();

byId("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return status("Não foi possível ligar ao serviço de autenticação.");
  const code = byId("code").value.trim();
  const password = byId("password").value;
  const button = event.submitter;
  button.disabled = true;
  try {
    if (setupToken) {
      if (new TextEncoder().encode(password).length > 72) return status("Escolhe uma palavra-passe de até 72 bytes.");
      const result = await db.functions.invoke("compass-setup", { body: { token: setupToken, password } });
      if (result.error) return status("Não foi possível ativar o código 41. Confirma que o link ainda está válido.");
      setupToken = null;
      showAccessForm();
    }
    const { error } = await db.auth.signInWithPassword({ email: code + identitySuffix, password });
    if (error) return status(error.status === 429 ? "Demasiadas tentativas. Volta a tentar dentro de instantes." : "Confirma o código e a palavra-passe com o administrador.");
    byId("password").value = "";
    await loadDashboard();
  } catch {
    status("Não foi possível ligar ao serviço de autenticação.");
  } finally { button.disabled = false; }
});
byId("nav-exec").onclick = () => openSection("exec");
byId("nav-locations").onclick = () => openSection("locations");
byId("nav-admin").onclick = () => openSection("admin");
byId("scope").onchange = () => renderReport(byId("scope").value);
byId("logout").onclick = async () => {
  await db.auth.signOut();
  clearDashboard();
  status();
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
    if (event === "SIGNED_OUT") clearDashboard();
    if (event === "INITIAL_SESSION") setTimeout(loadDashboard, 0);
  });
}
