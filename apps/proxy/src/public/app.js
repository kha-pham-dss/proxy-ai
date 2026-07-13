async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

function el(id) {
  return document.getElementById(id);
}

function renderOverview(data) {
  el("overview").innerHTML = [
    ["Facts", data.facts],
    ["Projects", data.projects],
    ["Stacks", data.stacks],
    ["Habits on", data.habitsEnabled],
    ["Sessions", data.activeSessions],
  ]
    .map(
      ([label, value]) =>
        `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`,
    )
    .join("");

  const last = data.lastDistillAt
    ? `Last distill: ${data.lastDistillAt}${data.lastDistillSource ? ` (${data.lastDistillSource})` : ""}`
    : "No distill yet";
  el("status").textContent = data.lastError ? `${last} · warn: ${data.lastError}` : last;
}

function renderHabits(profile) {
  el("habits").innerHTML = profile.habits
    .map(
      (h) => `
      <div class="habit">
        <input type="checkbox" data-habit="${h.id}" ${h.enabled ? "checked" : ""} />
        <div>
          <label>${h.label}</label>
          <small>${h.inject_text}</small>
        </div>
      </div>`,
    )
    .join("");

  for (const input of el("habits").querySelectorAll("input[data-habit]")) {
    input.addEventListener("change", async (e) => {
      const id = e.target.getAttribute("data-habit");
      await api(`/api/habits/${id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ enabled: e.target.checked }),
      });
      await refresh();
    });
  }
}

function renderProfile(profile) {
  el("stacks").value = profile.stacks.join(", ");
  el("style").value = profile.style.join("\n");
  el("facts").innerHTML = profile.facts
    .map((f) => `<li><code>${f.topic}</code> ${f.text}</li>`)
    .join("") || "<li class='hint'>No facts yet</li>";
  el("projects").innerHTML = profile.projects
    .map(
      (p) =>
        `<li><strong>${p.name}</strong>${p.stack?.length ? ` — ${p.stack.join(", ")}` : ""}${p.notes ? `: ${p.notes}` : ""}</li>`,
    )
    .join("") || "<li class='hint'>No projects yet</li>";
}

async function refresh() {
  const [overview, profile, settings] = await Promise.all([
    api("/api/overview"),
    api("/api/profile"),
    api("/api/settings"),
  ]);
  renderOverview(overview);
  renderHabits(profile);
  renderProfile(profile);

  el("model").innerHTML = settings.allowedModels
    .map(
      (m) =>
        `<option value="${m}" ${m === settings.model ? "selected" : ""}>${m}</option>`,
    )
    .join("");
  el("idle").value = String(settings.idleMinutes);
}

el("save-profile").addEventListener("click", async () => {
  const stacks = el("stacks").value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const style = el("style").value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  await api("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ stacks, style }),
  });
  await refresh();
});

el("save-settings").addEventListener("click", async () => {
  await api("/api/settings", {
    method: "PATCH",
    body: JSON.stringify({
      model: el("model").value,
      idleMinutes: Number(el("idle").value),
    }),
  });
  await refresh();
});

el("distill-now").addEventListener("click", async () => {
  el("status").textContent = "Distilling…";
  const result = await api("/api/distill-now", { method: "POST", body: "{}" });
  el("status").textContent = result.ok
    ? `Distilled: ${result.distilled.join(", ") || "(nothing dirty)"}`
    : `Distill error: ${result.error}`;
  await refresh();
});

el("reset").addEventListener("click", async () => {
  if (!confirm("Reset LTM? Seed habits will be kept (disabled).")) return;
  await api("/api/reset", { method: "POST", body: "{}" });
  await refresh();
});

refresh().catch((err) => {
  el("status").textContent = `Failed to load: ${err.message}`;
});
