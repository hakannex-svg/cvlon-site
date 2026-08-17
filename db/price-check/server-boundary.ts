if (typeof window !== "undefined") {
  throw new Error("Price Check database modules are server-only.");
}

export const priceCheckServerOnly = true as const;
