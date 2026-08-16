import "../../../db/price-check/server-boundary.ts";

import type { TransactionalEmail, TransactionalEmailProvider, TransactionalEmailResult } from "./provider.ts";

export class PostmarkTransactionalEmailProvider implements TransactionalEmailProvider {
  private readonly serverToken: string;
  private readonly timeoutMs: number;

  constructor(serverToken: string, timeoutMs = 8000) {
    if (!serverToken) throw new Error("Postmark server token is unavailable.");
    this.serverToken = serverToken;
    this.timeoutMs = timeoutMs;
  }

  async send(message: TransactionalEmail): Promise<TransactionalEmailResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": this.serverToken,
        },
        body: JSON.stringify({
          From: message.from,
          To: message.to,
          Subject: message.subject,
          TextBody: message.textBody,
          HtmlBody: message.htmlBody,
          Tag: message.tag,
          Metadata: message.metadata,
          MessageStream: "outbound",
          TrackOpens: false,
          TrackLinks: "None",
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as { ErrorCode?: number; MessageID?: string; SubmittedAt?: string } | null;
      if (!response.ok || payload?.ErrorCode !== 0 || !payload.MessageID) throw new Error(`POSTMARK_${response.status || "FAILED"}`);
      return { providerMessageId: payload.MessageID, submittedAt: payload.SubmittedAt ?? new Date().toISOString() };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("POSTMARK_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
