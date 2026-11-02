// AGENT 2: Classifier Agent (what is this document?)
// Task: read one attachment and extract doc type, source, date and key fields.
// Steps it can choose: read the PDF text; if the PDF is a scan with no text, run OCR
// (Claude reads the page image); then record the classification.
import { FIRM_POLICY } from "../policy.js";
import { callClaude, runAgent, ToolError, type AgentTool } from "../llm.js";
import { last4Only, clampConfidence, maskNumbers } from "../guardrails.js";
import { pdfText, toBase64 } from "../pdf.js";
import { DOC_TYPES, type Classification, type EmailRecord } from "../types.js";

const SYSTEM = `${FIRM_POLICY}

## Your role: Classifier Agent
You classify ONE document. Start with read_document_text. If it reports no text layer (a scan or
photo), call ocr_document. Then call finish_classification exactly once with:
doc_type, source, date (YYYY-MM per the date rule), every person name printed on the document,
account last 4 digits (never more), statement period and ending balance when it is a statement.
Do not decide which client folder it goes in - the Filing Agent does that.`;

async function ocr(bytes: Uint8Array): Promise<string> {
  const res = await callClaude({
    max_tokens: 4000,
    output_config: { effort: "low" },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } },
          { type: "text", text: "Transcribe all text in this scanned document exactly as printed. Output only the transcription." },
        ],
      },
    ],
  });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
}

export async function runClassifierAgent(doc: { id: string; originalName: string }, email: EmailRecord, bytes: Uint8Array) {
  let usedOcr = false;
  const tools: AgentTool[] = [
    {
      name: "read_document_text",
      description: "Extract the embedded text layer of the PDF.",
      input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      run: async () => {
        const text = await pdfText(bytes);
        if (text.length < 40) return "NO_TEXT_LAYER: this PDF appears to be a scanned image. Use ocr_document to read it.";
        return maskNumbers(text.slice(0, 6000));
      },
    },
    {
      name: "ocr_document",
      description: "OCR fallback for scanned/photographed PDFs: reads the page images and returns the text.",
      input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
      run: async () => {
        usedOcr = true;
        const text = await ocr(bytes);
        return text ? maskNumbers(text.slice(0, 6000)) : "OCR found no readable text.";
      },
    },
    {
      name: "finish_classification",
      description: "Record the classification. Call exactly once, at the end.",
      finishes: true,
      input_schema: {
        type: "object",
        properties: {
          doc_type: { type: "string", enum: [...DOC_TYPES] },
          source: { type: "string", enum: ["Schwab", "Fidelity", "Vanguard", "Pershing", "NorthwindLife", "HarborPoint", "DMV", "Other"] },
          date: { type: "string", description: "YYYY-MM per the firm's date rule" },
          names_on_document: { type: "array", items: { type: "string" } },
          account_last4: { type: ["string", "null"], description: "Last 4 digits only, or null" },
          statement_period: { type: ["string", "null"] },
          ending_balance: { type: ["number", "null"] },
          confidence: { type: "number", description: "0-1 confidence in this classification" },
          reasoning: { type: "string", description: "1-3 sentences" },
        },
        required: ["doc_type", "source", "date", "names_on_document", "account_last4", "statement_period", "ending_balance", "confidence", "reasoning"],
        additionalProperties: false,
      },
      run: (input) => {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.date)) throw new ToolError(`date must be YYYY-MM, got "${input.date}"`);
        return { ok: true };
      },
    },
  ];

  const task = `Classify this attachment.
Attachment filename: ${doc.originalName}
It came in an email from ${email.fromName} <${email.from}> with subject "${email.subject}".
Email body (context only): "${email.body.slice(0, 600)}"`;

  const run = await runAgent({ agent: "Classifier Agent", system: SYSTEM, task, tools });
  const c = run.finishInput;
  const classification: Classification = {
    ...c,
    account_last4: last4Only(c.account_last4), // guardrail: never store more than 4 digits
    reasoning: maskNumbers(c.reasoning),
    confidence: clampConfidence(c.confidence),
    used_ocr: usedOcr,
  };
  return { classification, trace: run.trace };
}
