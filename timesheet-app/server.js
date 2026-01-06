import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// payload mare pt PDF base64
app.use(cors());
app.use(express.json({ limit: "25mb" }));

// health check
app.get("/api/ping", (req, res) => {
  res.json({ ok: true, msg: "pong" });
});

// email endpoint
app.post("/api/send-timesheet", async (req, res) => {
  try {
    const key = process.env.RESEND_API_KEY;
    if (!key) return res.status(500).json({ ok: false, error: "Missing RESEND_API_KEY" });

    const resend = new Resend(key);

    const {
      to,
      submittedBy,
      name,
      periodLabel,
      invoiceDate,
      ratePerHour,
      totalHours,
      totalExpenses,
      totalPay,
      pdfFileName,
      pdfBase64
    } = req.body || {};

    if (!to || !pdfBase64 || !pdfFileName) {
      return res.status(400).json({ ok: false, error: "Missing to/pdfBase64/pdfFileName" });
    }

    const pdfBuffer = Buffer.from(pdfBase64, "base64");

    const subject = `Timesheet ${periodLabel || ""} - ${name || submittedBy || ""}`.trim();

    const html = `
      <div style="font-family: Arial, sans-serif">
        <h2>Timesheet</h2>
        <p><b>Submitted by:</b> ${submittedBy || "-"}</p>
        <p><b>Name:</b> ${name || "-"}</p>
        <p><b>Period:</b> ${periodLabel || "-"}</p>
        <p><b>Invoice date:</b> ${invoiceDate || "-"}</p>
        <hr/>
        <p><b>Total hours:</b> ${totalHours ?? "-"}</p>
        <p><b>Rate:</b> ${ratePerHour ?? "-"} €/h</p>
        <p><b>Expenses:</b> ${totalExpenses ?? "-"} €</p>
        <p><b>Total pay:</b> ${totalPay ?? "-"} €</p>
      </div>
    `;

    const result = await resend.emails.send({
      from: "Timesheet <onboarding@resend.dev>", // după ce verifici domeniul, pui from-ul tău
      to,
      subject,
      html,
      attachments: [{ filename: pdfFileName, content: pdfBuffer }]
    });

    return res.json({ ok: true, result });
  } catch (err) {
    console.error("send-timesheet error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

// serve frontend build (dist)
app.use(express.static(path.join(__dirname, "dist")));

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
