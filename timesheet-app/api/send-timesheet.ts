import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";

type Payload = {
  to: string;                 // email destinatar
  subject?: string;           // subiect (optional)
  text?: string;              // text (optional)
  html?: string;              // html (optional)
  pdfBase64?: string;         // PDF in base64 (optional) - fara "data:application/pdf;base64,"
  pdfFileName?: string;       // ex: "Timesheet_Bogdan_Week02.pdf"
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (daca ai nevoie – e safe)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    const EMAIL_FROM = process.env.EMAIL_FROM;

    if (!RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY in environment variables" });
    }
    if (!EMAIL_FROM) {
      return res.status(500).json({ ok: false, error: "Missing EMAIL_FROM in environment variables" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body as Payload);

    if (!body?.to) {
      return res.status(400).json({ ok: false, error: "Missing 'to' email" });
    }

    const resend = new Resend(RESEND_API_KEY);

    const subject = body.subject ?? "Timesheet";
    const text =
      body.text ??
      "Timesheet attached. (If you cannot see the attachment, please contact the sender.)";

    const html =
      body.html ??
      `<p>Timesheet attached.</p><p>If you cannot see the attachment, please contact the sender.</p>`;

    const attachments =
      body.pdfBase64
        ? [
            {
              filename: body.pdfFileName ?? "timesheet.pdf",
              content: body.pdfBase64, // base64 string only
            },
          ]
        : [];

    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to: body.to,
      subject,
      text,
      html,
      attachments,
    });

    return res.status(200).json({ ok: true, result });
  } catch (err: any) {
    console.error("send-timesheet error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Server error",
      details: err?.response?.data || null,
    });
  }
}
