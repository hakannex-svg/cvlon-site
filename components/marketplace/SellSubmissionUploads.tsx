"use client";

import { useRef, useState } from "react";
import { trackCivilonEvent } from "@/lib/analytics";
import {
  MARKETPLACE_UPLOAD_AUTHORIZE_PATH,
  SELL_SUBMISSION_SOURCE_PAGE,
  type MarketplaceUploadAuthorizeResponse,
} from "@/lib/marketplace/sell-contract";
import {
  SELL_UPLOAD_MAX_FILES,
  SELL_UPLOAD_MAX_TOTAL_BYTES,
  formatSellUploadSize,
  resolveSellUploadMime,
  sellUploadCeiling,
  sellUploadOptions,
  type SellUploadOption,
} from "@/lib/marketplace/sell-upload-options";
import type { MarketplaceUploadPurpose } from "@/lib/marketplace/uploads/constants";

/**
 * Optional evidence uploads for a Sell Submission.
 *
 * Two rules shape everything here:
 *
 *  1. Uploads never block a submission. Every failure path ends with the seller
 *     able to press "Send submission" anyway, and the parent form is told only
 *     about handles that actually completed.
 *  2. Nothing about a file reaches analytics. The four events this component
 *     emits carry `source_page` and `cta_location` and nothing else — no
 *     filename, no size, no purpose, no handle, no content.
 *
 * The browser holds no storage credential. It asks the server to authorize one
 * file, receives a presigned form bound to a key the server chose, and posts the
 * bytes straight to storage. The session that owns the handle is a host-only
 * HttpOnly cookie this code cannot read.
 */
export type SellUploadPurpose = MarketplaceUploadPurpose;

type UploadStatus = "authorizing" | "uploading" | "ready" | "failed";

type UploadItem = {
  /** Local list key. Never sent anywhere. */
  localId: string;
  filename: string;
  size: number;
  purpose: SellUploadPurpose;
  status: UploadStatus;
  /** Opaque server-minted handle. The only value the submission carries. */
  handle: string;
  error: string;
  file: File | null;
};

const MAX_FILES = SELL_UPLOAD_MAX_FILES;
const MAX_TOTAL_BYTES = SELL_UPLOAD_MAX_TOTAL_BYTES;

export function SellSubmissionUploads({
  items,
  onChange,
  options = sellUploadOptions,
  sourcePage = SELL_SUBMISSION_SOURCE_PAGE,
  required = false,
}: {
  items: UploadItem[];
  onChange: (update: (current: UploadItem[]) => UploadItem[]) => void;
  /**
   * Which purposes may be chosen. Defaults to the whole seller-facing policy,
   * which is what the initial intake offers. A follow-up evidence request
   * narrows it to exactly what staff asked for, so the seller cannot file a
   * file under a category nobody requested and the server would refuse anyway.
   */
  options?: readonly SellUploadOption[];
  /** Analytics page label. Never carries a file, purpose, size or handle. */
  sourcePage?: string;
  /**
   * True where at least one finished file is the point of the surface. Changes
   * the copy only: this component never blocks anything, and the server is the
   * one that decides whether a submission is acceptable.
   */
  required?: boolean;
}) {
  const [purpose, setPurpose] = useState<SellUploadPurpose>(options[0]!.value);
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const startedTracking = useRef(false);

  const selected = options.find((option) => option.value === purpose) ?? options[0]!;
  const totalBytes = items.reduce((sum, item) => sum + item.size, 0);

  function patch(localId: string, changes: Partial<UploadItem>) {
    onChange((current) => current.map((item) => (
      item.localId === localId ? { ...item, ...changes } : item
    )));
  }

  /**
   * Authorizes one file, then posts it straight to storage.
   *
   * The presigned form's fields are sent back exactly as the server issued
   * them: the key, the content type and the handle are all server-chosen policy
   * conditions, so appending the file last is the only freedom this code has.
   */
  async function upload(item: UploadItem, file: File) {
    const mime = resolveSellUploadMime(file.name);
    try {
      const authorizeResponse = await fetch(MARKETPLACE_UPLOAD_AUTHORIZE_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The session cookie is host-only and HttpOnly; it rides along here and
        // is never read, stored or forwarded by this component.
        credentials: "same-origin",
        body: JSON.stringify({
          filename: file.name,
          mime,
          size: file.size,
          purpose: item.purpose,
        }),
      });
      const authorized = await authorizeResponse.json() as MarketplaceUploadAuthorizeResponse;
      if (!authorized.ok) {
        patch(item.localId, { status: "failed", error: authorized.error });
        return;
      }

      patch(item.localId, { status: "uploading", handle: authorized.handle });

      const form = new FormData();
      for (const [name, value] of Object.entries(authorized.upload.fields)) {
        form.append(name, value);
      }
      form.append("file", file);
      const stored = await fetch(authorized.upload.url, { method: "POST", body: form });
      if (!stored.ok) {
        patch(item.localId, {
          status: "failed",
          error: "The file could not be uploaded. Try again, or continue without it.",
        });
        return;
      }

      // The file object is dropped once stored: keeping it alive would pin the
      // whole file in memory for the rest of the session for no purpose.
      patch(item.localId, { status: "ready", error: "", file: null });
      trackCivilonEvent("sell_submission_upload_completed", {
        source_page: sourcePage,
      });
    } catch {
      patch(item.localId, {
        status: "failed",
        error: "The upload did not finish. Check your connection and retry, or continue without it.",
      });
    }
  }

  function accept(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setNotice("");
    const incoming = [...fileList];
    const additions: UploadItem[] = [];
    let running = totalBytes;
    const problems: string[] = [];

    for (const file of incoming) {
      if (items.length + additions.length >= MAX_FILES) {
        problems.push(`You can attach up to ${MAX_FILES} files.`);
        break;
      }
      const mime = resolveSellUploadMime(file.name);
      if (!mime || !selected.mimes.includes(mime)) {
        problems.push(`${file.name} is not an accepted format for “${selected.label}”.`);
        continue;
      }
      const ceiling = sellUploadCeiling(mime);
      if (file.size < 1 || file.size > ceiling) {
        problems.push(
          `${file.name} is larger than ${mime.startsWith("image/") ? "25 MB" : "50 MB"}.`,
        );
        continue;
      }
      if (running + file.size > MAX_TOTAL_BYTES) {
        problems.push("Your files come to more than 200 MB in total.");
        break;
      }
      running += file.size;
      additions.push({
        localId: window.crypto.randomUUID(),
        filename: file.name,
        size: file.size,
        purpose,
        status: "authorizing",
        handle: "",
        error: "",
        file,
      });
    }

    if (problems.length > 0) setNotice(problems.join(" "));
    if (additions.length === 0) return;

    if (!startedTracking.current) {
      startedTracking.current = true;
      trackCivilonEvent("sell_submission_upload_started", {
        source_page: sourcePage,
      });
    }

    onChange((current) => [...current, ...additions]);
    for (const item of additions) void upload(item, item.file!);
    if (inputRef.current) inputRef.current.value = "";
  }

  function remove(localId: string) {
    onChange((current) => current.filter((item) => item.localId !== localId));
    setNotice("");
  }

  function retry(localId: string) {
    const item = items.find((entry) => entry.localId === localId);
    if (!item?.file) {
      setNotice("Add the file again to retry it.");
      return;
    }
    patch(localId, { status: "authorizing", error: "", handle: "" });
    void upload(item, item.file);
  }

  const pending = items.some((item) => item.status === "authorizing" || item.status === "uploading");

  return (
    <div className="marketplace-upload-panel">
      <div className="marketplace-upload-intro">
        <p>
          {required
            ? "Civilon already has your submission—this only adds what was asked for. Use files you already have; photos you took earlier are fine, and no camera, location or live capture is required or requested."
            : "Files are optional. They help Civilon review an offer faster, and you can send the submission without any. Use files you already have—no camera, location or live capture is required or requested."}
        </p>
        <p className="field-help">
          Accepted: JPG, PNG, WebP, PDF, CSV and macro-free XLSX. Up to{" "}
          {MAX_FILES} files, 50 MB each (25 MB per photo), 200 MB in total.
          Every file is scanned before Civilon staff can open it.
        </p>
      </div>

      <div className="pc-field-grid">
        <label htmlFor="sell-upload-purpose">
          <span className="field-label">What does this file show?</span>
          <select
            id="sell-upload-purpose"
            value={purpose}
            onChange={(event) => {
              setPurpose(event.target.value as SellUploadPurpose);
              setNotice("");
            }}
          >
            {options.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
          <small className="field-help">{selected.hint}</small>
        </label>

        <label htmlFor="sell-upload-input">
          <span className="field-label">Choose files</span>
          <input
            id="sell-upload-input"
            ref={inputRef}
            type="file"
            multiple
            accept={selected.accept}
            onChange={(event) => accept(event.target.files)}
            disabled={items.length >= MAX_FILES}
          />
          <small className="field-help">
            {items.length}/{MAX_FILES} attached · {formatSellUploadSize(totalBytes)} of 200 MB
          </small>
        </label>
      </div>

      {notice && <p className="field-error" role="alert">{notice}</p>}

      {items.length > 0 && (
        <ul className="marketplace-upload-list" aria-label="Attached files">
          {items.map((item) => (
            <li key={item.localId} className={`marketplace-upload-item is-${item.status}`}>
              <div className="marketplace-upload-item-head">
                <strong>{item.filename}</strong>
                <span>{formatSellUploadSize(item.size)}</span>
              </div>
              <p className="marketplace-upload-item-status" role="status">
                {item.status === "authorizing" && "Preparing…"}
                {item.status === "uploading" && "Uploading…"}
                {item.status === "ready" && "Attached — will be scanned before review"}
                {item.status === "failed" && item.error}
              </p>
              <div className="marketplace-upload-item-actions">
                {item.status === "failed" && (
                  <button type="button" className="marketplace-link-button" onClick={() => retry(item.localId)}>
                    Retry
                  </button>
                )}
                <button type="button" className="marketplace-link-button" onClick={() => remove(item.localId)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="field-help">
        {pending
          ? required
            ? "Only files that finish uploading are attached—sending before then leaves them out."
            : "You can keep filling in the form while files upload. Only files that finish are attached—sending before then submits without them."
          : required
            ? "Send at least one file that has finished uploading."
            : "You can send your submission with or without files."}{" "}
        Uploading evidence is not certification, regulatory approval, airworthiness
        approval, or a guarantee of authenticity or fitness.
      </p>
    </div>
  );
}

export type { UploadItem };
