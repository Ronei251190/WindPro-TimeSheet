import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const apiKey = process.env.RESEND_API_KEY;
    const toDefault = process.env.TIMESHEET_TO_EMAIL;
    const fromEmail = process.env.EMAIL_FROM || "WindPro Timesheet <onboarding@resend.dev>";

    if (!apiKey) return res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY" });
    if (!toDefault) return res.status(500).json({ ok: false, error: "Missing TIMESHEET_TO_EMAIL" });

    const {
      submittedByEmail,
      submittedByName,
      periodLabel,
      invoiceDateISO,
      totals,
      pdfBase64,
      filename,
      toEmail,
    } = req.body || {};

    if (!submittedByEmail || !periodLabel || !pdfBase64) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const resend = new Resend(apiKey);
    const safeTo = typeof toEmail === "string" && toEmail.includes("@") ? toEmail : toDefault;

    const subject = `Timesheet ${periodLabel} — ${submittedByName || submittedByEmail}`;

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif;">
        <h2>Timesheet submitted</h2>
        <p><b>Submitted by:</b> ${submittedByName || "-"} (${submittedByEmail})</p>
        <p><b>Period:</b> ${periodLabel}</p>
        <p><b>Invoice date:</b> ${invoiceDateISO || "-"}</p>
        <p><b>Total hours:</b> ${Number(totals?.hours || 0).toFixed(2)}</p>
        <p><b>Total expenses:</b> € ${Number(totals?.expenses || 0).toFixed(2)}</p>
        <p><b>Total pay:</b> € ${Number(totals?.pay || 0).toFixed(2)}</p>
        <hr />
        <p>PDF attached.</p>
      </div>
    `;

    const base64 = String(pdfBase64).replace(/^data:application\/pdf;base64,/, "");

    await resend.emails.send({
      from: fromEmail,
      to: safeTo,
      subject,
      html,
      attachments: [
        {
          filename: filename || `Timesheet_${periodLabel}.pdf`,
          content: base64,
          contentType: "application/pdf",
        },
      ],
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
}
