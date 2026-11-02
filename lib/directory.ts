// The firm's client directory (fake demo clients) plus lookup helpers the agents use as tools.
import householdsJson from "../seed/data/households.json" with { type: "json" };
import type { Household, Person } from "./types.js";

export const HOUSEHOLDS = householdsJson as Household[];

export interface PersonRef extends Person {
  household_id: string;
  household_name: string;
}

export const PEOPLE: PersonRef[] = HOUSEHOLDS.flatMap((h) =>
  h.members.map((m) => ({ ...m, household_id: h.id, household_name: h.name })),
);

export const personById = (id: string | null | undefined) => PEOPLE.find((p) => p.id === id);
export const householdById = (id: string | null | undefined) => HOUSEHOLDS.find((h) => h.id === id);
export const fullName = (p: Person) => `${p.first} ${p.last}`;

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}

function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function tokenScore(q: string, target: string) {
  if (!q || !target) return 0;
  if (q === target) return 1;
  if (target.startsWith(q) || q.startsWith(target)) return 0.8; // "R" vs "Raj", "Jon" vs "Jonathan"
  const d = editDistance(q, target);
  return Math.max(0, 1 - d / Math.max(q.length, target.length));
}

/** Fuzzy name search. Tolerates misspellings ("Jon Smyth") and initials ("R. Patel"). */
export function searchClients(query: string) {
  const qTokens = norm(query).split(" ").filter(Boolean);
  const scored = PEOPLE.map((p) => {
    const first = norm(p.first);
    const last = norm(p.last).replace(/ /g, "");
    const lastScore = Math.max(...qTokens.map((t) => tokenScore(t, last)));
    const firstScore = Math.max(...qTokens.map((t) => tokenScore(t, first)));
    const score = qTokens.length > 1 ? 0.6 * lastScore + 0.4 * firstScore : Math.max(lastScore, firstScore * 0.7);
    return { p, score };
  })
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return scored.map(({ p, score }) => ({
    person_id: p.id,
    name: fullName(p),
    household_id: p.household_id,
    household_name: p.household_name,
    email: p.email || "(none on file)",
    match_score: Math.round(score * 100) / 100,
  }));
}

export function lookupSender(email: string) {
  const e = email.trim().toLowerCase();
  const p = PEOPLE.find((x) => x.email && x.email.toLowerCase() === e);
  if (!p) return { match: false, note: `No client has ${email} on file.` };
  return { match: true, person_id: p.id, name: fullName(p), household_id: p.household_id, household_name: p.household_name, role: p.role };
}

export function householdSummary(id: string) {
  const h = householdById(id);
  if (!h) return { error: `No household with id ${id}` };
  return {
    household_id: h.id,
    name: h.name,
    client_status: h.status,
    members: h.members.map((m) => ({
      person_id: m.id,
      name: fullName(m),
      role: m.role,
      email: m.email || "(none)",
      accounts: m.accounts.map((a) => `${a.custodian} ${a.type} ending ${a.last4}`),
    })),
  };
}

export function findByAccountLast4(last4: string) {
  const digits = last4.replace(/\D/g, "").slice(-4);
  const hits = PEOPLE.flatMap((p) =>
    p.accounts
      .filter((a) => a.last4 === digits)
      .map((a) => ({ person_id: p.id, name: fullName(p), household_id: p.household_id, account: `${a.custodian} ${a.type} ending ${a.last4}` })),
  );
  return hits.length ? { matches: hits } : { matches: [], note: `No client account ends in ${digits}.` };
}
