import { useEffect, useRef } from "react";

const SEQUENCE_TIMEOUT_MS = 800;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

/** Fires `onMatch` when the given lowercase key sequence (e.g. ["g", "l"])
 *  is typed within SEQUENCE_TIMEOUT_MS of each key, ignoring keystrokes made
 *  while an input/textarea/contenteditable has focus. */
export function useKeySequence(sequence: string[], onMatch: () => void, enabled = true) {
  const progressRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function reset() {
      progressRef.current = 0;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const expected = sequence[progressRef.current];
      if (event.key.toLowerCase() === expected) {
        progressRef.current += 1;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (progressRef.current === sequence.length) {
          reset();
          onMatch();
        } else {
          timeoutRef.current = setTimeout(reset, SEQUENCE_TIMEOUT_MS);
        }
      } else {
        reset();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence.join(","), onMatch, enabled]);
}
