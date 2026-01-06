import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Resend } from "resend";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { to, subject, html, pdfBase64, pdfFileName } = req.body;

    if (!to) {
      return res.status(400).json({ error: "Missing recipient email" });
    }

    const resend = new Resend(process.env.RESEND_API_KEY!);

    const attachments = pdfBase64
      ? [
          {
            filename: pdfFileName || "timesheet.pdf",
            content: pdfBase64,
          },
        ]
      : [];

    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject || "Timesheet",
      html || "<p>Timesheet attached</p>",
      attachments,
    });

    return res.status(200).json({ ok: true, id: result.data?.id });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({ error: "Email send failed" });
  }
}
