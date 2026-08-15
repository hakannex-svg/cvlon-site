export type RfqValidationValues = {
  partNumber: string;
  email: string;
  callbackNumber: string;
  aircraftLocation: string;
};

export type RfqValidationErrors = Partial<Record<keyof RfqValidationValues, string>>;

export function validateRfq(values: RfqValidationValues, isAog: boolean): RfqValidationErrors {
  const errors: RfqValidationErrors = {};
  if (!values.partNumber.trim()) errors.partNumber = "Enter a part number.";
  if (!values.email.trim()) errors.email = "Enter a business email address.";
  if (isAog && !values.callbackNumber.trim()) errors.callbackNumber = "Enter a callback or WhatsApp number for this AOG request.";
  if (isAog && !values.aircraftLocation.trim()) errors.aircraftLocation = "Enter the aircraft location for this AOG request.";
  return errors;
}
