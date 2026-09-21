/**
 * [Role] Email notification via SMTP using nodemailer.
 * [Mechanism] Sends a summary digest to configured email recipients via SMTP.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../core/config";
import { markdownToHtml } from "./pages_generator";

/**
 * Helper to build responsive, clean HTML email body.
 */
function buildHtmlEmail(title: string, summaryMarkdown: string, articleCount: number): string {
  const contentHtml = markdownToHtml(summaryMarkdown);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333333;
      background-color: #f9f9f9;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 680px;
      margin: 0 auto;
      background: #ffffff;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      border-bottom: 2px solid #eaeaea;
      padding-bottom: 15px;
      margin-bottom: 20px;
    }
    .header h1 {
      margin: 0 0 10px 0;
      color: #1a1a1a;
      font-size: 22px;
    }
    .badge {
      display: inline-block;
      background: #eef2ff;
      color: #4f46e5;
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .content {
      font-size: 15px;
    }
    .content h1, .content h2, .content h3 {
      color: #111827;
      margin-top: 24px;
      margin-bottom: 12px;
    }
    .content a {
      color: #2563eb;
      text-decoration: underline;
    }
    .content blockquote {
      border-left: 4px solid #d1d5db;
      padding-left: 16px;
      margin: 16px 0;
      color: #4b5563;
      background: #f3f4f6;
      padding: 8px 16px;
      border-radius: 0 4px 4px 0;
    }
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #eaeaea;
      font-size: 12px;
      color: #6b7280;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📊 ${title}</h1>
      <span class="badge">Processed ${articleCount} articles</span>
    </div>
    <div class="content">
      ${contentHtml}
    </div>
    <div class="footer">
      <p>Digital Trend Flow — Automated Trend Harvesting &amp; Summarization</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Creates nodemailer transport from environment variables.
 */
export function createEmailTransport(): Transporter | null {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS } = env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

/**
 * Sends a summary digest to configured email recipients via SMTP.
 *
 * @param title Title of the summary (e.g., "Daily Summary 2026-03-14")
 * @param summaryMarkdown The full Markdown summary
 * @param articleCount Number of articles processed
 * @param transportOverride Optional nodemailer Transporter for mocking/testing
 */
export async function notifyEmail(
  title: string,
  summaryMarkdown: string,
  articleCount: number,
  transportOverride?: Transporter
): Promise<void> {
  const mailTo = env.MAIL_TO;

  if (!mailTo) {
    console.log("ℹ️ Email notification skipped (MAIL_TO not set).");
    return;
  }

  const transporter = transportOverride ?? createEmailTransport();

  if (!transporter) {
    console.log("ℹ️ Email notification skipped (SMTP credentials not fully set).");
    return;
  }

  const mailFrom = env.MAIL_FROM || env.SMTP_USER || "noreply@digitaltrendflow.internal";
  const subject = `📊 ${title} (${articleCount} articles) | Digital Trend Flow`;

  try {
    const htmlBody = buildHtmlEmail(title, summaryMarkdown, articleCount);

    await transporter.sendMail({
      from: mailFrom,
      to: mailTo,
      subject,
      text: summaryMarkdown,
      html: htmlBody,
    });

    console.log(`✅ Email notification sent successfully to ${mailTo}.`);
  } catch (error: any) {
    // Don't crash the pipeline for a notification failure
    console.error(`⚠️ Email notification failed: ${error.message}`);
  }
}
