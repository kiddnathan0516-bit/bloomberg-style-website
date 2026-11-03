// AGENT 3: Filing Agent (whose is it, name it, file it)
// Task: given the email context and the classification, decide which client the document
// belongs to, build the standardized filename, create folders and file it - or send it to review.
// Steps it can choose: search clients, check accounts by last 4, open households, list and
// create folders, then file_document or send_to_review.
import { FIRM_POLICY, FOLDER_FOR_TYPE, CONFIDENCE_THRESHOLD } from "../policy.js";
import { runAgent, ToolError, type AgentTool } from "../llm.js";
import { findByAccountLast4, householdSummary, personById, searchClients, fullName, householdById } from "../directory.js";
import { FILENAME_RE, belowThreshold, clampConfidence, nameToken, documentMentions } from "../guardrails.js";
import type { AppState, Classification, EmailRecord, Filing, ReviewInfo } from "../types.js";

const SYSTEM = `${FIRM_POLICY}

## Your role: Filing Agent
You decide where ONE classified document goes. Work like a careful operations associate:
1. Identify the client the document is ABOUT. Use the names on the document (search_clients) and the
   account last 4 (find_accounts_by_last4). Use the email sender only as supporting evidence.
2. Confirm the person belongs to the household (get_household).
3. Build the filename with the naming convention and check the destination (list_folder) for duplicates.
   If the exact name exists, add _2 before .pdf.
4. create_folder if the destination does not exist yet, then file_document.
If the client is ambiguous, not in the directory, or your confidence is below ${CONFIDENCE_THRESHOLD},
call send_to_review instead, with your best suggestion and a clear reason.
You must end with exactly one successful call to file_document or send_to_review.`;

export function folderFor(householdId: string, personId: string, docType: string) {
  return `${householdId}/${personId}/${FOLDER_FOR_TYPE[docType] ?? "Other"}`;
}

export function expectedFilename(personId: string, c: Pick<Classification, "date" | "source" | "doc_type">) {
  const p = personById(personId);
  if (!p) return null;
  return `${c.date}_${nameToken(p.last)}-${nameToken(p.first)}_${c.source}_${c.doc_type}.pdf`;
}

export async function runFilingAgent(
  doc: { id: string; originalName: string },
  email: EmailRecord,
  classification: Classification,
  state: AppState,
  evidence = "",
) {
  const createdFolders = new Set<string>();
  const folderExists = (f: string) => state.folders.includes(f) || createdFolders.has(f);
  const filesIn = (folder: string) =>
    Object.values(state.docs)
      .filter((d) => d.status === "filed" && d.filing?.folder === folder && d.id !== doc.id)
      .map((d) => d.filing!.filename);

  const tools: AgentTool[] = [
    {
      name: "search_clients",
      description: "Fuzzy search the client directory by name (tolerates misspellings and initials).",
      input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
      run: ({ name }) => {
        const r = searchClients(name);
        return r.length ? r : `No clients resemble "${name}".`;
      },
    },
    {
      name: "find_accounts_by_last4",
      description: "Find which client(s) own an account ending in these 4 digits.",
      input_schema: { type: "object", properties: { last4: { type: "string" } }, required: ["last4"], additionalProperties: false },
      run: ({ last4 }) => findByAccountLast4(last4),
    },
    {
      name: "get_household",
      description: "Get a household's members, roles and accounts.",
      input_schema: { type: "object", properties: { household_id: { type: "string" } }, required: ["household_id"], additionalProperties: false },
      run: ({ household_id }) => householdSummary(household_id),
    },
    {
      name: "list_folder",
      description: "List files already in a folder, e.g. HH-SMITH/P-JSMITH/Statements.",
      input_schema: { type: "object", properties: { folder: { type: "string" } }, required: ["folder"], additionalProperties: false },
      run: ({ folder }) => (folderExists(folder) ? { exists: true, files: filesIn(folder) } : { exists: false, files: [] }),
    },
    {
      name: "create_folder",
      description: "Create a client folder: HouseholdID/PersonID/FolderName (folder name from the taxonomy).",
      input_schema: { type: "object", properties: { folder: { type: "string" } }, required: ["folder"], additionalProperties: false },
      run: ({ folder }) => {
        const [hh, pid, name, ...rest] = String(folder).split("/");
        const p = personById(pid);
        if (rest.length || !p || p.household_id !== hh || !Object.values(FOLDER_FOR_TYPE).includes(name))
          throw new ToolError(`Invalid folder "${folder}". Use HouseholdID/PersonID/<taxonomy folder>, with a person who is in that household.`);
        createdFolders.add(folder);
        return { created: folder };
      },
    },
    {
      name: "file_document",
      description: "File the document. Ends your task.",
      finishes: true,
      input_schema: {
        type: "object",
        properties: {
          household_id: { type: "string" },
          person_id: { type: "string" },
          filename: { type: "string" },
          confidence: { type: "number", description: "0-1 confidence that this is the right client and name" },
          reasoning: { type: "string", description: "1-3 sentences a human reviewer can read" },
        },
        required: ["household_id", "person_id", "filename", "confidence", "reasoning"],
        additionalProperties: false,
      },
      run: (input) => {
        const p = personById(input.person_id);
        if (!p || p.household_id !== input.household_id)
          throw new ToolError(`${input.person_id} is not a member of ${input.household_id}.`);
        // Guardrail: low confidence can never auto-file, whatever the agent says.
        const conf = Math.min(clampConfidence(input.confidence), classification.confidence);
        if (belowThreshold(conf))
          throw new ToolError(`Confidence ${conf.toFixed(2)} is below ${CONFIDENCE_THRESHOLD}. Use send_to_review instead.`);
        // Guardrail: the document itself must point to this person (checked in code).
        const check = documentMentions(evidence, p);
        if (!check.ok)
          throw new ToolError(`Evidence check failed: ${check.why}. It cannot be auto-filed; use send_to_review.`);
        if (!FILENAME_RE.test(input.filename))
          throw new ToolError(`Filename "${input.filename}" does not follow YYYY-MM_Last-First_Source_DocType.pdf`);
        const folder = folderFor(input.household_id, input.person_id, classification.doc_type);
        if (!folderExists(folder)) throw new ToolError(`Folder ${folder} does not exist yet. Call create_folder first.`);
        if (filesIn(folder).includes(input.filename))
          throw new ToolError(`${input.filename} already exists in ${folder}. Add _2 before .pdf.`);
        return { filed: `${folder}/${input.filename}` };
      },
    },
    {
      name: "send_to_review",
      description: "Send the document to the human Review Queue instead of filing it. Ends your task.",
      finishes: true,
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string" },
          suggested_household_id: { type: ["string", "null"] },
          suggested_person_id: { type: ["string", "null"] },
          suggested_filename: { type: ["string", "null"] },
          confidence: { type: "number" },
        },
        required: ["reason", "suggested_household_id", "suggested_person_id", "suggested_filename", "confidence"],
        additionalProperties: false,
      },
      run: () => ({ queued_for_review: true }),
    },
  ];

  const sender = email.intake?.sender_person_id ? personById(email.intake.sender_person_id) : undefined;
  const task = `File this document.

Document id: ${doc.id} (attachment "${doc.originalName}")
Classification from the Classifier Agent:
${JSON.stringify(classification, null, 2)}

Email context from the Intake Agent:
- From: ${email.fromName} <${email.from}>, subject "${email.subject}"
- Sender matched to: ${sender ? `${fullName(sender)} (${sender.id}) in ${householdById(sender.household_id)?.name} (${sender.household_id})` : "no client match"}
- Relationship: ${email.intake?.sender_relationship ?? "unknown"}; intake confidence ${email.intake?.confidence ?? "n/a"}
- Intake notes: ${email.intake?.reasoning ?? ""}
- Email body: "${email.body.slice(0, 600)}"`;

  const run = await runAgent({ agent: "Filing Agent", system: SYSTEM, task, tools, maxTurns: 10 });
  const i = run.finishInput;
  if (run.finishTool === "file_document") {
    const filing: Filing = {
      household_id: i.household_id,
      person_id: i.person_id,
      folder: folderFor(i.household_id, i.person_id, classification.doc_type),
      filename: i.filename,
      confidence: Math.min(clampConfidence(i.confidence), classification.confidence),
      reasoning: i.reasoning,
      filed_by: "agent",
    };
    return { outcome: "filed" as const, filing, trace: run.trace };
  }
  const review: ReviewInfo = { ...i, confidence: clampConfidence(i.confidence) };
  return { outcome: "review" as const, review, trace: run.trace };
}
