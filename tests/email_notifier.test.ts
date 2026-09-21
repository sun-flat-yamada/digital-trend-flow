/**
 * Unit tests for Email notification module (src/publishing/email_notifier.ts)
 */

import { notifyEmail, createEmailTransport } from "../src/publishing/email_notifier";
import { env } from "../src/core/config";
import type { Transporter } from "nodemailer";

describe("Email Notifier", () => {
  const originalEnv = { ...env };

  afterEach(() => {
    // Restore original env properties
    Object.assign(env, originalEnv);
    jest.restoreAllMocks();
  });

  describe("Skip conditions", () => {
    test("skips notification when MAIL_TO is not set", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      env.MAIL_TO = undefined;

      const mockSendMail = jest.fn();
      const mockTransport = { sendMail: mockSendMail } as unknown as Transporter;

      await notifyEmail("Test Summary", "## Content", 5, mockTransport);

      expect(mockSendMail).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("MAIL_TO not set")
      );
    });

    test("skips notification when SMTP credentials are not configured", async () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      env.MAIL_TO = "test@example.com";
      env.SMTP_HOST = undefined;
      env.SMTP_USER = undefined;
      env.SMTP_PASS = undefined;

      await notifyEmail("Test Summary", "## Content", 5);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("SMTP credentials not fully set")
      );
    });

    test("createEmailTransport returns null when SMTP credentials are missing", () => {
      env.SMTP_HOST = undefined;
      const transport = createEmailTransport();
      expect(transport).toBeNull();
    });
  });

  describe("Successful email sending", () => {
    test("sends email with correct subject, text, and html body", async () => {
      env.MAIL_TO = "subscriber@example.com";
      env.MAIL_FROM = "Digital Trend <news@example.com>";
      env.SMTP_HOST = "smtp.example.com";
      env.SMTP_USER = "news@example.com";
      env.SMTP_PASS = "secret";

      const mockSendMail = jest.fn().mockResolvedValue({ messageId: "msg-123" });
      const mockTransport = { sendMail: mockSendMail } as unknown as Transporter;

      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      const sampleMarkdown = "# Daily Tech\n\nSome important news.\n\n- [Link](https://example.com)";
      await notifyEmail("Daily Summary 2026-09-21", sampleMarkdown, 3, mockTransport);

      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const callArgs = mockSendMail.mock.calls[0]?.[0];
      expect(callArgs).toBeDefined();
      expect(callArgs.to).toBe("subscriber@example.com");
      expect(callArgs.from).toBe("Digital Trend <news@example.com>");
      expect(callArgs.subject).toBe("📊 Daily Summary 2026-09-21 (3 articles) | Digital Trend Flow");
      expect(callArgs.text).toBe(sampleMarkdown);
      expect(callArgs.html).toContain("<!DOCTYPE html>");
      expect(callArgs.html).toContain("Daily Summary 2026-09-21");
      expect(callArgs.html).toContain("Processed 3 articles");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Email notification sent successfully")
      );
    });

    test("falls back to default from address if MAIL_FROM is omitted", async () => {
      env.MAIL_TO = "subscriber@example.com";
      env.MAIL_FROM = undefined;
      env.SMTP_USER = "admin@example.com";

      const mockSendMail = jest.fn().mockResolvedValue({ messageId: "msg-456" });
      const mockTransport = { sendMail: mockSendMail } as unknown as Transporter;

      jest.spyOn(console, "log").mockImplementation();

      await notifyEmail("Title", "Body", 1, mockTransport);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "admin@example.com",
        })
      );
    });
  });

  describe("Error handling and fault tolerance", () => {
    test("handles sendMail failure without crashing", async () => {
      env.MAIL_TO = "subscriber@example.com";
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();

      const mockSendMail = jest.fn().mockRejectedValue(new Error("Connection timeout"));
      const mockTransport = { sendMail: mockSendMail } as unknown as Transporter;

      // Should not throw
      await expect(
        notifyEmail("Failed Email", "Content", 1, mockTransport)
      ).resolves.not.toThrow();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Email notification failed: Connection timeout")
      );
    });
  });
});
