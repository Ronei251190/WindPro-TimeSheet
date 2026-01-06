import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

type Body = {
  to: string;
  submittedBy: string;
  name?: string;
  periodLabel: string;
  invoiceDate: string;
  ratePerHour?: number;
  totalHours?: number;
  totalExpenses?: number;
  totalPay?: number;
  pdfFileName: string;
  pdfBase64: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS (dacă apelezi din browser)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY in env" });
    }

    const body = req.body as Body;

    if (!body?.to || !body?.pdfBase64 || !body?.pdfFileName) {
      return res.status(400).json({ ok: false, error: "Missing required fields: to, pdfBase64, pdfFileName" });
    }

    const subject = `Timesheet ${body.periodLabel} - ${body.name ?? body.submittedBy}`;
    const html = `
      <div style="font-family:Arial,sans-serif">
        <h2>Timesheet</h2>
        <p><b>Submitted by:</b> ${body.submittedBy}</p>
        <p><b>Period:</b> ${body.periodLabel}</p>
        <p><b>Invoice date:</b> ${body.invoiceDate}</p>
        <p><b>Total hours:</b> ${body.totalHours ?? "-"}</p>
        <p><b>Rate:</b> ${body.ratePerHour ?? "-"} €/h</p>
        <p><b>Expenses:</b> ${body.totalExpenses ?? "-"} €</p>
        <p><b>Total pay:</b> ${body.totalPay ?? "-"} €</p>
      </div>
    `;

    const pdfBuffer = Buffer.from(body.pdfBase64, "base64");

    const result = await resend.emails.send({
      from: "Timesheet <onboarding@resend.dev>", // după ce verifici domeniul, pui mailul tău
      to: body.to,
      subject,
      html,
      attachments: [
        {
          filename: body.pdfFileName,
          content: pdfBuffer,
        },
      ],
    });

    return res.status(200).json({ ok: true, result });
  } catch (err: any) {
    console.error("Send email error:", err);
    return res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
}
