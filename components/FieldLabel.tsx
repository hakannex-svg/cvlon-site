import type { ReactNode } from "react";

export function FieldLabel({ htmlFor, children, required = false }: { htmlFor: string; children: ReactNode; required?: boolean }) {
  return (
    <span className="field-label" id={`${htmlFor}-label`}>
      <span>{children}</span>
      {required && <span className="required-mark" aria-hidden="true">*</span>}
    </span>
  );
}
