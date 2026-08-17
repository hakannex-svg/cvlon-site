"use client";

import type { ReactNode } from "react";
import { AOG_PHONE_DISPLAY, AOG_TEL_URL, buildAogWhatsAppUrl, type AogMessageData } from "@/lib/aog";
import { trackCivilonEvent, type AnalyticsContext } from "@/lib/analytics";

type AogActionProps = AnalyticsContext & {
  className?: string;
  children?: ReactNode;
};

export function CallAogAction({ className, children = "Call AOG desk", ...context }: AogActionProps) {
  return (
    <a className={className} href={AOG_TEL_URL} onClick={() => trackCivilonEvent("aog_call_click", context)}>
      {children}
    </a>
  );
}

export function WhatsAppAogAction({ className, children = "WhatsApp AOG", messageData, ...context }: AogActionProps & { messageData?: AogMessageData }) {
  return (
    <a
      className={className}
      href={buildAogWhatsAppUrl(messageData)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Message the AOG desk on WhatsApp at ${AOG_PHONE_DISPLAY}`}
      onClick={() => trackCivilonEvent("whatsapp_click", context)}
    >
      {children}
    </a>
  );
}
