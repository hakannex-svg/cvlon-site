const requester = {
  firstName: "Avery",
  lastName: "Morgan",
  companyName: "Synthetic Aviation Test Co",
  businessEmail: "avery.morgan@example.com",
  phone: "+1 202 555 0198",
  role: "Purchasing",
  country: "US",
  serviceProcessingAcknowledgedAt: new Date("2026-08-15T12:00:00.000Z"),
  marketingConsentAt: null,
};

const attribution = {
  sourcePage: "/price-check-test",
  landingPage: "https://cvlon.com/price-check-test?ignored=true",
  referrer: "https://example.com/search?q=private",
  utmSource: "synthetic-test",
};

export const priceCheckFixtures = {
  normalOutright: {
    requester,
    transaction: {
      originalPartNumber: "TEST-OUTRIGHT-001",
      quantity: "1.000",
      quoteOrPurchased: "quote",
      transactionType: "outright",
      conditionCode: "SV",
      unitPrice: "1250.00",
      currencyCode: "USD",
      aog: false,
    },
    documentation: [{ code: "FAA_8130_3" }],
    attribution,
    idempotencyHash: "synthetic-idempotency-outright",
    correlationId: "synthetic-correlation-outright",
  },
  exchangeRefundableCore: {
    requester: { ...requester, businessEmail: "exchange@example.com" },
    transaction: {
      originalPartNumber: "TEST-EXCHANGE-002",
      quantity: "1.000",
      quoteOrPurchased: "purchased",
      transactionType: "exchange",
      conditionCode: "OH",
      unitPrice: "4500.00",
      currencyCode: "USD",
      coreCharge: "2500.00",
      coreDisposition: "REFUNDABLE",
      exchangeFee: "400.00",
      aog: false,
    },
    attribution,
    idempotencyHash: "synthetic-idempotency-exchange",
    correlationId: "synthetic-correlation-exchange",
  },
  repair: {
    requester: { ...requester, businessEmail: "repair@example.com" },
    transaction: {
      originalPartNumber: "TEST-REPAIR-003",
      quantity: "1.000",
      quoteOrPurchased: "quote",
      transactionType: "repair",
      conditionCode: "AR",
      unitPrice: "825.00",
      currencyCode: "USD",
      aog: false,
    },
    attribution,
    idempotencyHash: "synthetic-idempotency-repair",
    correlationId: "synthetic-correlation-repair",
  },
  aog: {
    requester: { ...requester, businessEmail: "aog@example.com" },
    transaction: {
      originalPartNumber: "TEST-AOG-004",
      quantity: "1.000",
      quoteOrPurchased: "quote",
      transactionType: "outright",
      conditionCode: "NE",
      unitPrice: "9900.00",
      currencyCode: "USD",
      aircraftModel: "Synthetic Challenger Test Article",
      aog: true,
    },
    attribution,
    idempotencyHash: "synthetic-idempotency-aog",
    correlationId: "synthetic-correlation-aog",
  },
};

export const evidenceFixtures = {
  sparse: [{ conditionCode: "SV", unitPrice: "1200.00" }],
  mixedCondition: [
    { conditionCode: "NE", unitPrice: "3000.00" },
    { conditionCode: "SV", unitPrice: "1200.00" },
    { conditionCode: "AR", unitPrice: "500.00" },
  ],
};
