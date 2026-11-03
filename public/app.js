// RIA Doc Inbox front end (plain JavaScript, no framework).
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const pct = (n) => (n == null ? "–" : `${Math.round(n * 100)}%`);

let state = null;
let directory = [];
let running = false;
let passcode = "";
try { passcode = localStorage.getItem("ria-passcode") || ""; } catch {}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { "content-type": "application/json", "x-passcode": passcode, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    askPasscode();
    throw new Error("Passcode required");
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
const post = (path, body = {}) => api(path, { method: "POST", body });

function askPasscode() {
  const p = prompt("Enter the demo passcode (set as DEMO_PASSCODE in Netlify):", passcode);
  if (p !== null) {
    passcode = p.trim();
    try { localStorage.setItem("ria-passcode", passcode); } catch {}
    updateLock();
  }
}
function updateLock() {
  $("#lockBtn").textContent = passcode ? "Passcode saved ✓ (change)" : "Enter passcode";
}

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast${isErr ? " err" : ""}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 4500);
}

// ---------- status helpers ----------
const EMAIL_PILL = {
  queued: ["gray", "Queued"], processing: ["blue", "Processing"], processed: ["green", "Processed"],
  needs_review: ["amber", "Needs review"], ignored: ["gray", "Ignored"], error: ["red", "Error"],
};
const DOC_PILL = {
  waiting: ["gray", "Waiting"], to_classify: ["blue", "Classifying"], to_file: ["blue", "Filing"], filed: ["green", "Filed"],
  review: ["amber", "Needs review"], rejected: ["gray", "Rejected"], skipped: ["gray", "Not filed (ignored email)"], error: ["red", "Error"],
};
const pill = (map, s) => { const [c, l] = map[s] || ["gray", s]; return `<span class="pill ${c}">${esc(l)}</span>`; };
const people = () => directory.flatMap((h) => h.members.map((m) => ({ ...m, household_id: h.id, household_name: h.name })));
const personName = (id) => { const p = people().find((x) => x.id === id); return p ? `${p.first} ${p.last}` : id || "—"; };
const hhName = (id) => directory.find((h) => h.id === id)?.name || id || "—";
const folderLabel = (f) => { const [hh, p, folder] = f.split("/"); return `${hhName(hh)} / ${personName(p)} / ${folder}`; };

function traceHtml(trace) {
  if (!trace?.length) return '<div class="muted">No agent steps yet.</div>';
  return `<ol class="trace">${trace.map((t) => `<li class="${t.kind}"><span class="ag">${esc(t.agent)} · ${t.kind}</span><br>${esc(t.text)}</li>`).join("")}</ol>`;
}

// ---------- routing ----------
const TITLES = { dashboard: "Dashboard", inbox: "Inbox", files: "Sorted Files", review: "Review Queue", activity: "Activity & Digest", accuracy: "Accuracy Test" };
function greeting() {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part} · ${new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}`;
}
const SUBTITLES = { dashboard: greeting };
function currentView() { const v = location.hash.slice(1); return TITLES[v] ? v : "dashboard"; }
function show() {
  const v = currentView();
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("hidden", el.id !== `view-${v}`));
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
  $("#viewTitle").textContent = TITLES[v];
  $("#viewSub").textContent = SUBTITLES[v] ? SUBTITLES[v]() : "";
  render();
  if (v === "accuracy") loadEval();
}
window.addEventListener("hashchange", () => { $("#drawer").classList.add("hidden"); show(); });

// ---------- data ----------
async function refresh() {
  try {
    state = await api("state");
    $("#lastSync").textContent = `Updated ${new Date().toLocaleTimeString()}`;
    render();
  } catch (e) {
    $("#lastSync").textContent = `Offline: ${e.message}`;
  }
}

function render() {
  if (!state) return;
  const emails = Object.values(state.emails).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  const docs = Object.values(state.docs);
  const filed = docs.filter((d) => d.status === "filed");
  const review = docs.filter((d) => d.status === "review" || d.status === "error");
  $("#c-inbox").textContent = emails.length || "";
  $("#c-files").textContent = filed.length || "";
  $("#c-review").textContent = review.length || "";
  $("#k-filed").textContent = filed.length;
  $("#k-review").textContent = review.length;
  $("#k-ignored").textContent = emails.filter((e) => e.status === "ignored").length;
  $("#queueInfo").textContent = state.pending.total ? `${state.pending.total} items waiting to be processed.` : "Nothing waiting to be processed.";

  renderAutoStatus();

  const d = state.digests[state.digests.length - 1];
  $("#digestBox").innerHTML = d
    ? `<div class="muted">${fmtTime(d.at)}</div><p style="font-size:16px;margin-bottom:0">${esc(d.summary)}</p>`
    : "Nothing processed yet.";

  const v = currentView();
  if (v === "inbox") renderInbox(emails);
  if (v === "files") renderFiles(filed);
  if (v === "review") renderReview(review);
  if (v === "activity") renderActivity();
}

// ---------- automatic scanning status ----------
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m === 1 ? "1 minute ago" : m < 60 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`;
}
function renderAutoStatus() {
  const box = $("#autoStatus");
  const at = state.lastAutomationAt;
  const lastEmail = Object.values(state.emails).filter((e) => e.source === "gmail").sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
  const mail = lastEmail ? ` Last email received ${ago(lastEmail.receivedAt)}: “${lastEmail.subject}” from ${lastEmail.fromName}.` : "";
  if (!at) {
    box.className = "auto-status";
    $("#autoText").textContent = "Automatic scanning: not connected";
    $("#autoDetail").textContent = "No check-in from n8n yet. Make sure the “Gmail to Netlify” workflow is Active.";
    return;
  }
  const minutes = (Date.now() - new Date(at).getTime()) / 60000;
  if (minutes <= 12) {
    box.className = "auto-status on";
    $("#autoText").textContent = "Automatic scanning: ON";
    $("#autoDetail").textContent = `Checks every 5 minutes. Last check ${ago(at)}.${mail}`;
  } else {
    box.className = "auto-status late";
    $("#autoText").textContent = "Automatic scanning: paused?";
    $("#autoDetail").textContent = `No check-in for ${ago(at).replace(" ago", "")}. Is the “Gmail to Netlify” workflow in n8n still Active?${mail}`;
  }
}

// ---------- inbox ----------
let inboxFilter = "all";
const WORKING = ["queued", "processing", "error"];
const matchesFilter = (e, f) => f === "all" || (f === "working" ? WORKING.includes(e.status) : e.status === f);
const initials = (name) => (name || "?").replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
const hue = (str) => [...String(str)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function shortTime(iso) {
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function docChip(d) {
  const [cls, label] =
    d.status === "filed" ? ["green", `Filed · ${personName(d.filing.person_id)}`]
    : d.status === "review" || d.status === "error" ? ["amber", "Needs review"]
    : d.status === "skipped" ? ["gray", "Not filed"]
    : d.status === "rejected" ? ["gray", "Rejected"]
    : ["blue", "Working…"];
  return `<span class="chip"><span class="pdf">PDF</span>${esc(d.originalName)}<span class="chip-status ${cls}">${esc(label)}</span></span>`;
}

function renderInbox(emails) {
  for (const f of ["all", "processed", "needs_review", "ignored", "working"])
    $(`#f-${f}`).textContent = emails.filter((e) => matchesFilter(e, f)).length || "";
  document.querySelectorAll("#inboxTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.filter === inboxFilter));
  const shown = emails.filter((e) => matchesFilter(e, inboxFilter));
  $("#inboxEmpty").classList.toggle("hidden", shown.length > 0);
  $("#mailList").innerHTML = shown
    .map((e) => {
      const docs = e.attachments.map((a) => state.docs[a.docId]).filter(Boolean);
      const snippet = e.body.replace(/\s+/g, " ").trim().slice(0, 140);
      const why = e.status === "ignored" && e.intake ? `<span class="why">Ignored: ${esc(e.intake.category.replace(/_/g, " "))}</span>` : "";
      return `<div class="mail-row ${e.status}" data-email="${esc(e.id)}">
        <div class="avatar" style="background:hsl(${hue(e.from)} 55% 92%);color:hsl(${hue(e.from)} 45% 32%)">${esc(initials(e.fromName))}</div>
        <div class="mail-main">
          <div class="mail-top"><span class="mail-from">${esc(e.fromName)}</span><span class="mail-addr">${esc(e.from)}</span><span class="mail-time">${shortTime(e.receivedAt)}</span></div>
          <div class="mail-subject">${esc(e.subject)}</div>
          <div class="mail-snippet">${esc(snippet)}</div>
          ${docs.length || why ? `<div class="mail-chips">${docs.map(docChip).join("")}${why}</div>` : ""}
        </div>
        <div class="mail-status">${pill(EMAIL_PILL, e.status)}</div>
      </div>`;
    })
    .join("");
}

function openEmail(id) {
  const e = state.emails[id];
  const docs = e.attachments.map((a) => state.docs[a.docId]).filter(Boolean);
  const i = e.intake;
  const verdict = !i
    ? "Not looked at yet. It will be processed on the next automatic check."
    : i.decision === "ignore"
      ? `Ignored as ${i.category.replace(/_/g, " ")}. Nothing was filed.`
      : i.decision === "needs_review"
        ? "Held for a person to check before anything is opened."
        : `Client documents${i.sender_person_id ? ` from ${personName(i.sender_person_id)}` : " from an unrecognized sender"}.`;
  $("#drawerBody").innerHTML = `
    <div class="d-head">
      <div class="avatar big" style="background:hsl(${hue(e.from)} 55% 92%);color:hsl(${hue(e.from)} 45% 32%)">${esc(initials(e.fromName))}</div>
      <div>
        <h2 style="margin:0">${esc(e.subject)}</h2>
        <div class="muted">${esc(e.fromName)} &lt;${esc(e.from)}&gt; · ${fmtTime(e.receivedAt)}</div>
      </div>
    </div>
    <pre class="body">${esc(e.body)}</pre>
    <h3 class="d-label">Attachments</h3>
    ${docs.length ? `<div class="d-docs">${docs.map((d) => `<div class="d-doc">${docChip(d)}
      ${d.filing ? `<div class="muted small">Saved as <b>${esc(d.filing.filename)}</b> in ${esc(folderLabel(d.filing.folder))}</div>` : ""}
      ${d.review ? `<div class="muted small">Why it needs review: ${esc(d.review.reason)}</div>` : ""}
      <a class="small" href="/api/pdf/${encodeURIComponent(d.id)}" target="_blank">Open PDF ↗</a></div>`).join("")}</div>` : '<div class="muted">No attachments</div>'}
    <h3 class="d-label">What the AI decided</h3>
    <div class="verdict">${pill(EMAIL_PILL, e.status)} <span>${esc(verdict)}</span>${i ? `<span class="muted small"> ${pct(i.confidence)} confident</span>` : ""}</div>
    ${i ? `<p class="muted">${esc(i.reasoning)}</p>` : ""}
    <details class="ai-details"><summary>Show AI details</summary>
      <div class="muted small" style="margin:8px 0">Keyword pre-check: ${esc(e.ruleHits.join(", ") || "none")}</div>
      ${traceHtml([...e.trace, ...docs.flatMap((d) => d.trace)])}
    </details>`;
  $("#drawer").classList.remove("wide");
  $("#drawer").classList.remove("hidden");
}

// ---------- files ----------
let selectedHH = null;
let fileQuery = "";
const FOLDER_ORDER = ["Statements", "Tax Documents", "Financial Statements", "Insurance", "Pension Statements", "Trust Documents",
  "Rollovers & Transfers", "Beneficiary Forms", "Account Applications", "Onboarding", "Risk Questionnaires", "Identification", "Other"];
const monthLabel = (ym) => { const [y, m] = (ym || "").split("-"); return y && m ? new Date(+y, +m - 1, 1).toLocaleDateString([], { month: "short", year: "numeric" }) : "—"; };
const shortHH = (name) => (name || "").replace(/ Household$/, "");

function fileRow(d, who = "", showTag = true) {
  const folder = d.filing.folder.split("/")[2];
  return `<div class="file-row" data-doc="${esc(d.id)}">
    <span class="pdf big">PDF</span>
    <div class="fr-name">${who ? `<div class="fr-who">${esc(who)}</div>` : ""}<div class="fr-file">${esc(d.filing.filename)}</div><div class="fr-orig">${esc(d.originalName)}</div></div>
    ${showTag ? `<span class="tag">${esc(folder)}</span>` : ""}
    <span class="fr-meta">${monthLabel(d.classification?.date)}</span>
    <span class="fr-by">${d.filing.filed_by === "human" ? "Person" : "Auto"}</span>
  </div>`;
}
const byFolder = (a, b) =>
  FOLDER_ORDER.indexOf(a.filing.folder.split("/")[2]) - FOLDER_ORDER.indexOf(b.filing.folder.split("/")[2]) ||
  (b.classification?.date || "").localeCompare(a.classification?.date || "");

// Group one person's documents into their sections (folders), in the firm's folder order.
function sections(docs) {
  const groups = new Map();
  for (const d of docs) {
    const f = d.filing.folder.split("/")[2];
    if (!groups.has(f)) groups.set(f, []);
    groups.get(f).push(d);
  }
  return [...groups.entries()];
}

function renderFiles(filed) {
  const count = (hh) => filed.filter((d) => d.filing.household_id === hh).length;
  const withDocs = directory.filter((h) => count(h.id));
  if (!selectedHH || !count(selectedHH)) selectedHH = withDocs[0]?.id ?? null;
  $("#hhList").innerHTML = directory.map((h) => `
    <button class="hh-item ${h.id === selectedHH && !fileQuery ? "active" : ""} ${count(h.id) ? "" : "empty"}" data-hh="${h.id}">
      <span class="avatar sm" style="background:hsl(${hue(h.id)} 55% 92%);color:hsl(${hue(h.id)} 45% 32%)">${esc(initials(shortHH(h.name)))}</span>
      <span class="hh-text"><b>${esc(shortHH(h.name))}</b><span>${h.members.length} ${h.members.length === 1 ? "person" : "people"}</span></span>
      <span class="hh-count">${count(h.id) || ""}</span>
    </button>`).join("");

  const body = $("#filesBody");
  if (!filed.length) { body.innerHTML = '<div class="card empty">No documents yet.</div>'; return; }
  const q = fileQuery.trim().toLowerCase();
  if (q) {
    const hits = filed.filter((d) => [d.filing.filename, d.originalName, personName(d.filing.person_id), hhName(d.filing.household_id), d.filing.folder.split("/")[2]]
      .some((t) => (t || "").toLowerCase().includes(q))).sort(byFolder);
    body.innerHTML = `<div class="card flush person-card"><div class="group-head"><b>${hits.length} result${hits.length === 1 ? "" : "s"}</b></div>${hits.map((d) => fileRow(d, personName(d.filing.person_id))).join("") || '<div class="empty">No matches.</div>'}</div>`;
    return;
  }
  const h = directory.find((x) => x.id === selectedHH);
  if (!h) { body.innerHTML = ""; return; }
  const members = h.members.map((m) => ({ m, docs: filed.filter((d) => d.filing.person_id === m.id).sort(byFolder) })).filter((x) => x.docs.length);
  body.innerHTML = `
    <div class="hh-head">
      <div><h2>${esc(h.name)}</h2><div class="muted">${esc(h.address)}</div></div>
      <span class="pill ${h.status === "new" ? "blue" : "gray"}">${h.status === "new" ? "New client" : "Existing client"}</span>
    </div>
    ${members.map(({ m, docs }) => `
      <div class="card flush person-card">
        <div class="group-head">
          <span class="avatar sm" style="background:hsl(${hue(m.id)} 55% 92%);color:hsl(${hue(m.id)} 45% 32%)">${esc(initials(`${m.first} ${m.last}`))}</span>
          <b>${esc(m.first)} ${esc(m.last)}</b><span class="muted">${esc(m.role)}</span>
          <span class="muted push">${docs.length} document${docs.length === 1 ? "" : "s"}</span>
        </div>
        ${sections(docs).map(([folder, list]) => `
          <div class="section-head"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><b>${esc(folder)}</b><span>${list.length}</span></div>
          ${list.map((d) => fileRow(d, "", false)).join("")}`).join("")}
      </div>`).join("")}`;
}

function openDoc(id) {
  const d = state.docs[id];
  const c = d.classification || {};
  const e = state.emails[d.emailId];
  const field = (l, v) => `<div class="field"><div class="l">${l}</div><div class="v">${v}</div></div>`;
  $("#drawerBody").innerHTML = `
    <div class="d-head"><span class="pdf big">PDF</span><div>
      <h2 style="margin:0">${esc(d.filing.filename)}</h2>
      <div class="muted">${esc(folderLabel(d.filing.folder))}</div></div></div>
    <div class="fields">
      ${field("Type", esc(d.filing.folder.split("/")[2]))}
      ${field("Source", esc(c.source || "—"))}
      ${field("Date", esc(c.statement_period || monthLabel(c.date)))}
      ${field("Account", c.account_last4 ? `••••${esc(c.account_last4)}` : "—")}
      ${c.ending_balance != null ? field("Ending balance", `$${Number(c.ending_balance).toLocaleString()}`) : ""}
      ${field("Received from", esc(e?.fromName || "—"))}
    </div>
    <iframe class="doc-frame" src="/api/pdf/${encodeURIComponent(id)}" title="PDF preview"></iframe>
    <details class="ai-details"><summary>Show AI details</summary>
      <p class="muted small">${esc(d.filing.reasoning)} · ${pct(d.filing.confidence)} confident · ${d.filing.filed_by === "human" ? "filed by a person" : "filed automatically"}</p>
      ${traceHtml(d.trace)}
    </details>`;
  $("#drawer").classList.add("wide");
  $("#drawer").classList.remove("hidden");
}

// ---------- review ----------
function renderReview(items) {
  const focused = document.activeElement?.closest?.(".review-card");
  if (focused) return; // don't wipe what the reviewer is typing
  if (!items.length) {
    $("#reviewList").innerHTML = '<div class="card empty">Nothing waiting for review. 🎉</div>';
    return;
  }
  const opts = (sel) => directory.map((h) => `<optgroup label="${esc(h.name)}">${h.members.map((m) =>
    `<option value="${m.id}" ${m.id === sel ? "selected" : ""}>${esc(m.first)} ${esc(m.last)}</option>`).join("")}</optgroup>`).join("");
  $("#reviewList").innerHTML = items.map((d) => {
    const e = state.emails[d.emailId];
    const c = d.classification;
    const r = d.review || { reason: d.trace.filter((t) => t.kind === "error").pop()?.text || "Processing error" };
    return `<div class="card review-card" data-doc="${esc(d.id)}">
      <div>
        <h2>${esc(d.originalName)} ${pill(DOC_PILL, d.status)}</h2>
        <div class="muted">From ${esc(e?.fromName)} &lt;${esc(e?.from)}&gt; · "${esc(e?.subject)}"</div>
        <div class="reason"><b>Why it's here:</b> ${esc(r.reason)}</div>
        ${c ? `<div class="fields">
          <div class="field"><div class="l">Doc type</div><div class="v">${esc(c.doc_type)}</div></div>
          <div class="field"><div class="l">Source</div><div class="v">${esc(c.source)}</div></div>
          <div class="field"><div class="l">Date</div><div class="v">${esc(c.date)}</div></div>
          <div class="field"><div class="l">Names on doc</div><div class="v">${esc((c.names_on_document || []).join(", ") || "none")}</div></div>
          <div class="field"><div class="l">Account</div><div class="v">${c.account_last4 ? `••••${esc(c.account_last4)}` : "—"}</div></div>
          <div class="field"><div class="l">Agent confidence</div><div class="v">${pct(r.confidence ?? c.confidence)}</div></div>
        </div>` : ""}
        <a href="/api/pdf/${encodeURIComponent(d.id)}" target="_blank">Open PDF</a>
        <details style="margin-top:8px"><summary>Agent steps</summary>${traceHtml(d.trace)}</details>
      </div>
      <div class="review-actions">
        <label>File under client</label>
        <select class="r-person"><option value="">— choose client —</option>${opts(r.suggested_person_id)}</select>
        <label>Filename (optional)</label>
        <input class="r-filename" value="${esc(r.suggested_filename || "")}" placeholder="YYYY-MM_Last-First_Source_DocType.pdf" />
        ${c ? `<div class="btns">
          <button class="good r-approve">Approve &amp; file</button>
          <button class="danger r-reject">Reject</button>
        </div>` : `<div class="muted">The Intake Agent stopped before reading this document. If you trust the sender, let the agents continue. They will still ask you if they are unsure who it belongs to.</div>
        <div class="btns">
          <button class="good r-release">Sender is OK → let the agents continue</button>
          <button class="danger r-reject">Reject</button>
        </div>`}
      </div>
    </div>`;
  }).join("");
}

async function reviewClick(btn) {
  const card = btn.closest(".review-card");
  const id = card.dataset.doc;
  try {
    if (btn.classList.contains("r-reject")) {
      await post(`review/${encodeURIComponent(id)}`, { action: "reject" });
      toast(`Rejected ${id}`);
    } else if (btn.classList.contains("r-release")) {
      await post(`review/${encodeURIComponent(id)}`, { action: "release" });
      toast("Sent back to the agents. Running them now; see the Dashboard.");
      btn.blur();
      location.hash = "#dashboard";
      await refresh();
      return runNow();
    } else {
      const person_id = card.querySelector(".r-person").value;
      const filename = card.querySelector(".r-filename").value.trim();
      if (!person_id) return toast("Choose a client first.", true);
      const r = await post(`review/${encodeURIComponent(id)}`, { action: "edit", edit: { person_id, filename: filename || undefined } });
      toast(r.message);
    }
    btn.blur();
    await refresh();
  } catch (e) { toast(e.message, true); }
}

// ---------- activity ----------
// Turn internal ids in log messages into names people recognize.
function prettyLog(msg) {
  return msg
    .replace(/(HH-[A-Z-]+)\/(P-[A-Z]+)\/([^/]+)\//g, (_, hh, p, f) => `${hhName(hh)} / ${personName(p)} / ${f} / `)
    .replace(/\(conf (\d\.\d+)\)/g, (_, c) => `· ${Math.round(+c * 100)}% confident`)
    .replace(/, conf (\d\.\d+)/g, (_, c) => `, ${Math.round(+c * 100)}% confident`)
    .replace(/^Ops digest: /, "");
}
const ACTOR_CLASS = { "Intake Agent": "a1", "Classifier Agent": "a2", "Filing Agent": "a3", Human: "hu", Automation: "au" };
function renderActivity() {
  $("#activityLog").innerHTML = [...state.log].reverse().map((l) =>
    `<li class="${ACTOR_CLASS[l.actor] || "au"}"><span class="dot"></span><div><div class="tl-top"><b>${esc(l.actor)}</b><span>${fmtTime(l.at)}</span></div><div class="tl-msg">${esc(prettyLog(l.message))}</div></div></li>`).join("") || '<li class="empty">Nothing yet.</li>';
  $("#digestHistory").innerHTML = [...state.digests].reverse().map((d) =>
    `<div class="digest"><div class="muted small">${fmtTime(d.at)}</div><div class="dg-nums"><span><b>${d.filed}</b> filed</span><span><b>${d.needsReview}</b> review</span><span><b>${d.ignored}</b> ignored</span></div></div>`).join("") || '<div class="muted">None yet.</div>';
}

// ---------- accuracy ----------
const VERDICT = {
  correct: ["green", "Auto-filed correctly"], correct_review: ["green", "Correctly sent to review"],
  safe_review: ["amber", "Sent to review (safe)"], misfiled: ["red", "MISFILED"], not_processed: ["gray", "Not processed"],
};
const namesIn = (t) => String(t).replace(/P-[A-Z]+/g, (id) => personName(id));
async function loadEval() {
  try {
    const ev = await api("eval");
    const s = ev.summary;
    $("#evalHeadline").textContent = s.not_processed === s.total_docs ? "No sample inbox results yet." : ev.headline;
    $("#evalKpis").innerHTML = `
      <div class="kpi"><div class="kpi-label">Auto-filed correctly</div><div class="kpi-value good">${s.auto_filed_correctly}/${s.should_auto_file}</div></div>
      <div class="kpi"><div class="kpi-label">Sent to review</div><div class="kpi-value warn">${s.sent_to_review_safely + s.ambiguous_caught}</div></div>
      <div class="kpi"><div class="kpi-label">Misfiled</div><div class="kpi-value ${s.misfiled ? "bad" : "good"}">${s.misfiled}</div></div>
      <div class="kpi"><div class="kpi-label">Junk ignored</div><div class="kpi-value">${s.distractors_ignored}/${s.distractors_total}</div></div>`;
    $("#evalTable tbody").innerHTML = ev.docs.map((d) => `<tr>
      <td>${esc(d.doc_id)}</td><td>${pill(VERDICT, d.verdict)}${d.filename_match === false ? '<br><span class="muted">filename differs</span>' : ""}</td>
      <td>${esc(namesIn(d.expected))}</td><td>${esc(namesIn(d.actual))}</td><td class="muted">${esc(d.note)}</td></tr>`).join("");
  } catch (e) { toast(e.message, true); }
}

// ---------- automation buttons ----------
const WORKERS = 5; // agents running at the same time
async function runNow(rethrow = false) {
  if (running) return;
  running = true;
  $("#runBtn").disabled = true;
  $("#progress").classList.remove("hidden");
  $("#liveLog").innerHTML = "";
  await refresh();
  let start = Math.max(state?.pending.total || 1, 1);
  let steps = 0, errorsInARow = 0, stop = null;
  const show = (r) => {
    start = Math.max(start, r.remaining);
    $("#liveLog").insertAdjacentHTML("afterbegin", `<li>${esc(r.did)}</li>`);
    $("#barFill").style.width = `${Math.min(100, ((start - r.remaining) / start) * 100)}%`;
    $("#progressText").textContent = `${steps} agent runs · ${r.remaining} steps left`;
    if (rethrow) $("#liveStatus").textContent = `Sorting documents… ${r.remaining ? `${r.remaining} steps left` : "almost done"}`;
  };
  // Each worker keeps asking the server for the next item until nothing is left.
  // The server hands every item to only one worker, so they never double up.
  const worker = async (k) => {
    let waits = 0;
    while (!stop) {
      const r = await post(`work?w=${k}&of=${WORKERS}`);
      if (r.did === "idle") return;
      if (r.did.startsWith("waiting")) {
        if (++waits > 60) return;
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }
      waits = 0;
      steps++;
      show(r);
      errorsInARow = r.did.includes("error") ? errorsInARow + 1 : 0;
      if (r.did.startsWith("error:") || errorsInARow >= 4) stop = new Error(`Stopped: ${r.did}`);
      if (steps % 4 === 0) refresh();
    }
  };
  try {
    const results = await Promise.allSettled(Array.from({ length: WORKERS }, (_, k) => worker(k)));
    const failed = results.find((r) => r.status === "rejected");
    if (stop) throw stop;
    if (failed) throw failed.reason;
    $("#barFill").style.width = "100%";
    const d = await post("digest");
    $("#progressText").textContent = `Done. ${d.summary}`;
    toast("All done. Summary saved.");
  } catch (e) {
    if (rethrow) throw e;
    toast(e.message, true);
  } finally {
    running = false;
    $("#runBtn").disabled = false;
    refresh();
  }
}

// ---------- one-click live demo ----------
function setStep(n, cls) {
  document.querySelectorAll("#stepper li").forEach((li) => {
    const k = Number(li.dataset.step);
    li.className = k < n ? "done" : k === n ? cls || "active" : "";
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function liveDemo() {
  if (running) return;
  if (!confirm("Run the live demo? This clears the current data and emails the demo documents to the firm’s inbox.")) return;
  const status = $("#liveStatus");
  $("#demoPanel").classList.remove("hidden");
  $("#liveBtn").disabled = true;
  let step = 1;
  try {
    setStep(1);
    status.textContent = "Sending client emails to the firm’s inbox…";
    const { expected = 1 } = await post("live-demo");
    await refresh();

    step = 2;
    setStep(2);
    const t0 = Date.now();
    let last = -1, lastChange = Date.now();
    for (;;) {
      await sleep(3000);
      await refresh();
      const n = Object.keys(state.emails).length;
      if (n !== last) { last = n; lastChange = Date.now(); }
      const secs = Math.round((Date.now() - t0) / 1000);
      status.textContent = `Waiting for the emails to arrive… ${n} of ${expected} received (${secs}s)`;
      if (n >= expected || (n > 0 && Date.now() - lastChange > 25000)) break;
      if (Date.now() - t0 > 240000) throw new Error("No emails arrived after 4 minutes. Check the Live demo workflow in n8n (Executions).");
    }

    step = 3;
    setStep(3);
    status.textContent = "Sorting documents…";
    await runNow(true);

    setStep(5);
    status.textContent = "Done. See Sorted Files for what was filed and the Review Queue for what needs you.";
  } catch (e) {
    setStep(step, "failed");
    status.textContent = e.message;
    toast(e.message, true);
  } finally {
    $("#liveBtn").disabled = false;
  }
}

$("#liveBtn").onclick = liveDemo;
$("#runBtn").onclick = () => runNow();
$("#seedBtn").onclick = async () => {
  if (!confirm("Load the 25 demo emails? This clears current data.")) return;
  try { const r = await post("seed"); toast(`Loaded ${r.emails} demo emails. Click Run now.`); refresh(); } catch (e) { toast(e.message, true); }
};
$("#digestBtn").onclick = async () => { try { const d = await post("digest"); toast(d.summary); refresh(); } catch (e) { toast(e.message, true); } };
$("#resetBtn").onclick = async () => {
  if (!confirm("Delete all emails, files and logs?")) return;
  try { await post("reset"); toast("Reset done."); refresh(); } catch (e) { toast(e.message, true); }
};
$("#lockBtn").onclick = askPasscode;
$("#drawerClose").onclick = () => $("#drawer").classList.add("hidden");
$("#drawer").onclick = (ev) => { if (ev.target.id === "drawer") $("#drawer").classList.add("hidden"); };

document.addEventListener("click", (ev) => {
  const tab = ev.target.closest("#inboxTabs .tab");
  if (tab) { inboxFilter = tab.dataset.filter; return render(); }
  const row = ev.target.closest("[data-email]");
  if (row) return openEmail(row.dataset.email);
  const file = ev.target.closest(".file-row");
  if (file) return openDoc(file.dataset.doc);
  const hh = ev.target.closest(".hh-item");
  if (hh) { selectedHH = hh.dataset.hh; fileQuery = ""; $("#fileSearch").value = ""; return render(); }
  const btn = ev.target.closest(".r-approve, .r-reject, .r-release");
  if (btn) return reviewClick(btn);
});

$("#fileSearch").addEventListener("input", (ev) => { fileQuery = ev.target.value; render(); });

(async () => {
  updateLock();
  directory = await api("directory").catch(() => []);
  await refresh();
  show();
  setInterval(() => { if (!document.hidden && !running) refresh(); }, 10000);
})();
