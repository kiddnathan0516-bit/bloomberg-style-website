// Shared data shapes for the whole app.

export type EmailStatus = "queued" | "processing" | "processed" | "needs_review" | "ignored" | "error";
export type DocStatus =
  | "waiting" // email not triaged yet
  | "to_classify"
  | "to_file"
  | "filed"
  | "review"
  | "rejected"
  | "skipped" // attachment of an ignored email
  | "error";

export const DOC_TYPES = [
  "Statement", "1099", "Rollover", "AcctApp", "RiskQ", "ID", "Insurance", "Beneficiary",
  "Financials", "Trust", "Pension", "Onboarding", "Other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export interface TraceStep {
  agent: string;
  kind: "thought" | "tool" | "result" | "error";
  text: string;
  at: string;
}

export interface IntakeResult {
  decision: "process" | "ignore" | "needs_review";
  category: string;
  household_id: string | null;
  sender_person_id: string | null;
  sender_relationship: string;
  confidence: number;
  reasoning: string;
}

export interface Classification {
  doc_type: DocType;
  source: string;
  date: string; // YYYY-MM
  names_on_document: string[];
  account_last4: string | null;
  statement_period: string | null;
  ending_balance: number | null;
  confidence: number;
  reasoning: string;
  used_ocr: boolean;
}

export interface Filing {
  household_id: string;
  person_id: string;
  folder: string; // HH-ID/P-ID/Folder Name
  filename: string;
  confidence: number;
  reasoning: string;
  filed_by: "agent" | "human";
}

export interface ReviewInfo {
  reason: string;
  suggested_household_id: string | null;
  suggested_person_id: string | null;
  suggested_filename: string | null;
  confidence: number;
}

export interface EmailRecord {
  id: string;
  messageId?: string;
  source: "demo" | "gmail";
  from: string;
  fromName: string;
  subject: string;
  body: string;
  receivedAt: string;
  attachments: { docId: string; filename: string }[];
  status: EmailStatus;
  ruleHits: string[];
  intake?: IntakeResult;
  trace: TraceStep[];
  attempts: number;
  claimedUntil?: string;
  claimedBy?: string;
  updatedAt: string;
}

export interface DocRecord {
  id: string;
  emailId: string;
  originalName: string;
  status: DocStatus;
  classification?: Classification;
  evidence?: string; // masked text the Classifier read from the PDF (used by the evidence check)
  filing?: Filing;
  review?: ReviewInfo;
  trace: TraceStep[];
  attempts: number;
  claimedUntil?: string;
  claimedBy?: string;
  updatedAt: string;
}

export interface LogEntry {
  at: string;
  actor: string; // "Automation", "Intake Agent", "Human", ...
  message: string;
}

export interface Digest {
  at: string;
  filed: number;
  needsReview: number;
  ignored: number;
  pending: number;
  emailsProcessed: number;
  summary: string;
}

export interface AppState {
  emails: Record<string, EmailRecord>;
  docs: Record<string, DocRecord>;
  folders: string[];
  log: LogEntry[];
  digests: Digest[];
}

export interface Account {
  custodian: string;
  type: string;
  last4: string;
}
export interface Person {
  id: string;
  first: string;
  last: string;
  email: string;
  role: string;
  accounts: Account[];
}
export interface Household {
  id: string;
  name: string;
  status: "new" | "existing";
  address: string;
  members: Person[];
}
