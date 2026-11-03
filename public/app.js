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
function currentView() { const v = location.hash.slice(1); return TITLES[v] ? v : "dashboard"; }
function show() {
  const v = currentView();
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("hidden", el.id !== `view-${v}`));
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === v));
  $("#viewTitle").textContent = TITLES[v];
  render();
  if (v === "accuracy") loadEval();
}
window.addEventListener("hashchange", show);

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
  if (v === "files") renderTree(filed);
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
function renderInbox(emails) {
  $("#inboxEmpty").classList.toggle("hidden", emails.length > 0);
  $("#inboxTable tbody").innerHTML = emails
    .map((e) => `<tr class="click" data-email="${esc(e.id)}">
      <td class="muted">${fmtTime(e.receivedAt)}</td>
      <td><b>${esc(e.fromName)}</b><br><span class="muted">${esc(e.from)}</span></td>
      <td>${esc(e.subject)}${e.intake ? `<br><span class="muted">${esc(e.intake.category.replace(/_/g, " "))}</span>` : ""}</td>
      <td>${e.attachments.length}</td>
      <td>${pill(EMAIL_PILL, e.status)}</td></tr>`)
    .join("");
}

function openEmail(id) {
  const e = state.emails[id];
  const docs = e.attachments.map((a) => state.docs[a.docId]).filter(Boolean);
  $("#drawerBody").innerHTML = `
    <h2>${esc(e.subject)}</h2>
    <div class="muted">From ${esc(e.fromName)} &lt;${esc(e.from)}&gt; · ${fmtTime(e.receivedAt)} · ${pill(EMAIL_PILL, e.status)}</div>
    <pre class="body">${esc(e.body)}</pre>
    <h2>Attachments</h2>
    ${docs.length ? docs.map((d) => `<div style="margin:6px 0">${esc(d.originalName)} ${pill(DOC_PILL, d.status)}
      ${d.filing ? `<div class="muted">→ ${esc(folderLabel(d.filing.folder))} / <b>${esc(d.filing.filename)}</b></div>` : ""}
      <a href="/api/pdf/${encodeURIComponent(d.id)}" target="_blank">open PDF</a></div>`).join("") : '<div class="muted">None</div>'}
    <h2 style="margin-top:16px">Step 1: keyword rules</h2>
    <div class="muted">${esc(e.ruleHits.join(", ") || "none")}</div>
    <h2 style="margin-top:16px">Intake Agent decision</h2>
    ${e.intake ? `<div class="fields">
      <div class="field"><div class="l">Decision</div><div class="v">${esc(e.intake.decision)}</div></div>
      <div class="field"><div class="l">Category</div><div class="v">${esc(e.intake.category)}</div></div>
      <div class="field"><div class="l">Sender</div><div class="v">${esc(personName(e.intake.sender_person_id))}</div></div>
      <div class="field"><div class="l">Confidence</div><div class="v">${pct(e.intake.confidence)}</div></div></div>
      <p>${esc(e.intake.reasoning)}</p>` : '<div class="muted">Not triaged yet.</div>'}
    <h2>Agent steps</h2>
    ${traceHtml([...e.trace, ...docs.flatMap((d) => d.trace)])}`;
  $("#drawer").classList.remove("hidden");
}

// ---------- files ----------
let selectedDoc = null;
function renderTree(filed) {
  if (!filed.length) {
    $("#tree").innerHTML = '<div class="muted">No documents filed yet.</div>';
    return;
  }
  const open = new Set([...document.querySelectorAll("#tree details[open]")].map((d) => d.dataset.key));
  const firstRender = !$("#tree details");
  const byHh = {};
  for (const d of filed) {
    const [hh, p, folder] = d.filing.folder.split("/");
    ((byHh[hh] ??= {})[p] ??= {})[folder] ??= [];
    byHh[hh][p][folder].push(d);
  }
  const isOpen = (k) => (firstRender || open.has(k) ? "open" : "");
  $("#tree").innerHTML = Object.keys(byHh).sort().map((hh) => `
    <details class="hh" data-key="${hh}" ${isOpen(hh)}><summary>🏠 ${esc(hhName(hh))}</summary>
      ${Object.keys(byHh[hh]).sort().map((p) => `
        <details class="person" data-key="${hh}/${p}" ${isOpen(`${hh}/${p}`)}><summary>👤 ${esc(personName(p))}</summary>
          ${Object.keys(byHh[hh][p]).sort().map((f) => `
            <div class="folder">📁 ${esc(f)}</div>
            ${byHh[hh][p][f].map((d) => `<div class="file ${selectedDoc === d.id ? "sel" : ""}" data-doc="${esc(d.id)}">📄 ${esc(d.filing.filename)}</div>`).join("")}
          `).join("")}
        </details>`).join("")}
    </details>`).join("");
}

function previewDoc(id) {
  selectedDoc = id;
  document.querySelectorAll(".tree .file").forEach((f) => f.classList.toggle("sel", f.dataset.doc === id));
  const d = state.docs[id];
  const c = d.classification || {};
  const e = state.emails[d.emailId];
  $("#preview").innerHTML = `
    <h2>${esc(d.filing.filename)}</h2>
    <div class="muted">${esc(folderLabel(d.filing.folder))} · originally "${esc(d.originalName)}" from ${esc(e?.fromName)}
      · filed by ${d.filing.filed_by === "human" ? "a human reviewer" : "the Filing Agent"}</div>
    <div class="fields">
      <div class="field"><div class="l">Doc type</div><div class="v">${esc(c.doc_type)}</div></div>
      <div class="field"><div class="l">Source</div><div class="v">${esc(c.source)}</div></div>
      <div class="field"><div class="l">Period / date</div><div class="v">${esc(c.statement_period || c.date)}</div></div>
      <div class="field"><div class="l">Account</div><div class="v">${c.account_last4 ? `••••${esc(c.account_last4)}` : "—"}</div></div>
      <div class="field"><div class="l">Ending balance</div><div class="v">${c.ending_balance != null ? `$${Number(c.ending_balance).toLocaleString()}` : "—"}</div></div>
      <div class="field"><div class="l">Confidence</div><div class="v">${pct(d.filing.confidence)}</div></div>
    </div>
    <p class="muted">${esc(d.filing.reasoning)}</p>
    <iframe src="/api/pdf/${encodeURIComponent(id)}" title="PDF preview"></iframe>
    <details style="margin-top:12px"><summary>Agent steps</summary>${traceHtml(d.trace)}</details>`;
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
        <label>Filename (leave blank to auto-generate)</label>
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
function renderActivity() {
  $("#activityLog").innerHTML = [...state.log].reverse().map((l) =>
    `<li><span class="when">${fmtTime(l.at)}</span><span class="who">${esc(l.actor)}</span>${esc(l.message)}</li>`).join("") || '<li class="muted">Nothing yet.</li>';
  $("#digestHistory").innerHTML = [...state.digests].reverse().map((d) =>
    `<div class="digest"><div class="muted">${fmtTime(d.at)}</div>${esc(d.summary)}</div>`).join("") || '<div class="muted">No digests yet.</div>';
}

// ---------- accuracy ----------
const VERDICT = {
  correct: ["green", "Auto-filed correctly"], correct_review: ["green", "Correctly sent to review"],
  safe_review: ["amber", "Sent to review (safe)"], misfiled: ["red", "MISFILED"], not_processed: ["gray", "Not processed"],
};
async function loadEval() {
  try {
    const ev = await api("eval");
    const s = ev.summary;
    $("#evalHeadline").textContent = s.not_processed === s.total_docs ? "Load the demo inbox and run the automation to see results." : ev.headline;
    $("#evalKpis").innerHTML = `
      <div class="kpi"><div class="kpi-label">Auto-filed correctly</div><div class="kpi-value good">${s.auto_filed_correctly}/${s.should_auto_file}</div></div>
      <div class="kpi"><div class="kpi-label">Sent to review</div><div class="kpi-value warn">${s.sent_to_review_safely + s.ambiguous_caught}</div></div>
      <div class="kpi"><div class="kpi-label">Misfiled</div><div class="kpi-value ${s.misfiled ? "bad" : "good"}">${s.misfiled}</div></div>
      <div class="kpi"><div class="kpi-label">Junk ignored</div><div class="kpi-value">${s.distractors_ignored}/${s.distractors_total}</div></div>`;
    $("#evalTable tbody").innerHTML = ev.docs.map((d) => `<tr>
      <td>${esc(d.doc_id)}</td><td>${pill(VERDICT, d.verdict)}${d.filename_match === false ? '<br><span class="muted">filename differs</span>' : ""}</td>
      <td>${esc(d.expected)}</td><td>${esc(d.actual)}</td><td class="muted">${esc(d.note)}</td></tr>`).join("");
  } catch (e) { toast(e.message, true); }
}

// ---------- automation buttons ----------
async function runNow(rethrow = false) {
  if (running) return;
  running = true;
  $("#runBtn").disabled = true;
  $("#progress").classList.remove("hidden");
  $("#liveLog").innerHTML = "";
  const start = state?.pending.total || 1;
  let steps = 0, idleWaits = 0, errorsInARow = 0;
  try {
    for (;;) {
      const r = await post("work");
      steps++;
      if (r.did === "idle") break;
      if (r.did.startsWith("waiting")) {
        if (++idleWaits > 20) break;
        await new Promise((res) => setTimeout(res, 3000));
      }
      $("#liveLog").insertAdjacentHTML("afterbegin", `<li>${esc(r.did)}</li>`);
      errorsInARow = r.did.includes("error") ? errorsInARow + 1 : 0;
      if (r.did.startsWith("error:") || errorsInARow >= 3) throw new Error(`Stopped: ${r.did}`);
      const done = Math.max(0, start - r.remaining);
      $("#barFill").style.width = `${Math.min(100, (done / Math.max(start, 1)) * 100)}%`;
      $("#progressText").textContent = `${steps} agent runs · ${r.remaining} items left`;
      if (rethrow) $("#liveStatus").textContent = `Sorting documents… ${r.remaining ? `${r.remaining} steps left` : "almost done"}`;
      if (steps % 3 === 0) refresh();
    }
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
  if (!confirm("Run the live demo? This clears the current data and emails 6 test documents to the demo Gmail.")) return;
  const status = $("#liveStatus");
  $("#demoPanel").classList.remove("hidden");
  $("#liveBtn").disabled = true;
  let step = 1;
  try {
    setStep(1);
    status.textContent = "Sending 6 client emails to the firm’s inbox…";
    await post("live-demo");
    await refresh();

    step = 2;
    setStep(2);
    const t0 = Date.now();
    let last = -1, lastChange = Date.now();
    for (;;) {
      await sleep(5000);
      await refresh();
      const n = Object.keys(state.emails).length;
      if (n !== last) { last = n; lastChange = Date.now(); }
      const secs = Math.round((Date.now() - t0) / 1000);
      status.textContent = `Waiting for the emails to arrive… ${n} of 6 received (${secs}s)`;
      if (n >= 6 || (n > 0 && Date.now() - lastChange > 30000)) break;
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
  const row = ev.target.closest("[data-email]");
  if (row) return openEmail(row.dataset.email);
  const file = ev.target.closest(".tree .file");
  if (file) return previewDoc(file.dataset.doc);
  const btn = ev.target.closest(".r-approve, .r-reject, .r-release");
  if (btn) return reviewClick(btn);
});

(async () => {
  updateLock();
  directory = await api("directory").catch(() => []);
  await refresh();
  show();
  setInterval(() => { if (!document.hidden && !running) refresh(); }, 10000);
})();
