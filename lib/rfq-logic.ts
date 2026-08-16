export type RfqValidationValues = {
  partNumber: string;
  email: string;
  callbackNumber: string;
  aircraftLocation: string;
};

export type RfqValidationErrors = Partial<Record<keyof RfqValidationValues, string>>;

export type NeededByMode = "asap" | "specific";
export type TimePeriod = "" | "AM" | "PM";
export const FIVE_MINUTE_OPTIONS = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

export function to24HourTime(hour: string, minute: string, period: TimePeriod): string {
  if (!hour || !minute || !period) return "";
  const hour24 = (Number(hour) % 12) + (period === "PM" ? 12 : 0);
  return `${String(hour24).padStart(2, "0")}:${minute}`;
}

export function composeRequiredBy(mode: NeededByMode, date: string, hour: string, minute: string, period: TimePeriod): string {
  if (mode === "asap") return "ASAP";
  const time = to24HourTime(hour, minute, period);
  return date && time ? `${date}T${time}` : "";
}

export function validateNeededBy(mode: NeededByMode, date: string, hour: string, minute: string, period: TimePeriod): string | undefined {
  if (mode === "specific" && (!date || !hour || !minute || !period)) return "Select a date, hour, minute, and AM or PM.";
}

export function validateRfq(values: RfqValidationValues, isAog: boolean): RfqValidationErrors {
  const errors: RfqValidationErrors = {};
  if (!values.partNumber.trim()) errors.partNumber = "Enter a part number.";
  if (!values.email.trim()) errors.email = "Enter a business email address.";
  if (isAog && !values.callbackNumber.trim()) errors.callbackNumber = "Enter a callback or WhatsApp number for this AOG request.";
  if (isAog && !values.aircraftLocation.trim()) errors.aircraftLocation = "Enter the aircraft location for this AOG request.";
  return errors;
}
