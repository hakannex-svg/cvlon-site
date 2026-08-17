import "../../../db/price-check/server-boundary.ts";

export type TransactionalEmail = {
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  tag: string;
  metadata: Record<string, string>;
};

export type TransactionalEmailResult = { providerMessageId: string; submittedAt: string };

export interface TransactionalEmailProvider {
  send(message: TransactionalEmail): Promise<TransactionalEmailResult>;
}
