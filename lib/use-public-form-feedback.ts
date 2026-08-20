"use client";

import { useEffect, useRef } from "react";

const feedbackGap = 16;

function stickyHeaderOffset() {
  const header = document.querySelector<HTMLElement>("body > header");
  if (!header) return feedbackGap;

  const position = window.getComputedStyle(header).position;
  return position === "fixed" || position === "sticky"
    ? header.getBoundingClientRect().height + feedbackGap
    : feedbackGap;
}

/** Focuses an announced form result and leaves it fully visible below site chrome. */
export function focusAndScrollToPublicFormFeedback(target: HTMLElement) {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.focus({ preventScroll: true });
  window.scrollTo({
    top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - stickyHeaderOffset()),
    behavior: reduceMotion ? "auto" : "smooth",
  });
}

/** Runs only after React has committed the newly rendered result or summary. */
export function usePublicFormFeedback<T extends HTMLElement>(signal: unknown) {
  const feedbackRef = useRef<T>(null);

  useEffect(() => {
    if (!signal) return;
    const frame = window.requestAnimationFrame(() => {
      if (feedbackRef.current) focusAndScrollToPublicFormFeedback(feedbackRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [signal]);

  return feedbackRef;
}
