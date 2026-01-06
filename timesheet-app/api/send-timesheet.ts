import { Resend } from "resend";

export const config = {
  runtime: "nodejs",
};

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

function json(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return json(res, 405, { ok: false, error: "Method not allowed" });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      return json(res, 500, { ok: false, error: "Missing RESEND_API_KEY env var" });
    }

    const body: Body = req.body;
    if (!body?.to || !body?.pdfBase64 || !body?.pdfFileName) {
      return json(res, 400, { ok: false, error: "Missing required fields" });
    }

    // decode PDF
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = Buffer.from(body.pdfBase64, "base64");
    } catch {
      return json(res, 400, { ok: false, error: "Invalid pdfBase64" });
    }

    // basic size guard (Vercel payload limit is real)
    const maxBytes = 4.5 * 1024 * 1024; // ~4.5MB safety
    if (pdfBuffer.length > maxBytes) {
      return json(res, 413, { ok: false, error: "PDF too large. Reduce content or compress." });
    }

    const resend = new Resend(apiKey);

    const subject = `WindPro Timesheet - ${body.periodLabel} - ${body.submittedBy}`;
    const textLines = [
      `Timesheet submitted`,
      `Submitted by: ${body.submittedBy}`,
      body.name ? `Name: ${body.name}` : "",
      `Period: ${body.periodLabel}`,
      `Invoice date: ${body.invoiceDate}`,
      "",
      `Total hours: ${body.totalHours ?? "-"}`,
      `Rate: € ${body.ratePerHour ?? "-"} / h`,
      `Total expenses: € ${body.totalExpenses ?? "-"}`,
      `Total pay: € ${body.totalPay ?? "-"}`,
    ].filter(Boolean);

    const resp = await resend.emails.send({
      from: "WindPro Timesheet <onboarding@resend.dev>", // OK pentru test
      to: [body.to],
      subject,
      text: textLines.join("\n"),
      attachments: [
        {
          filename: body.pdfFileName,
          content: pdfBuffer,
        },
      ],
    });

    return json(res, 200, { ok: true, id: resp.data?.id || null });
  } catch (err: any) {
    // IMPORTANT: return error text so you see it in client
    return json(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
