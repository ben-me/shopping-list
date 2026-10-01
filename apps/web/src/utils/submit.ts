import type { Ref } from "vue";

/**
 * The message a form shows when a request fails: the thrown Error's own wording
 * — the server's, usually — or the caller's own fallback when what came out is
 * not an Error at all.
 */
function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** The state one form submission owns. */
interface SubmitState {
  /** The form's error line: cleared when a submit starts, set when it fails. */
  error: Ref<string | null>;
  /** Optional busy flag: up while the submit runs, down again whatever happens. */
  busy?: Ref<boolean>;
}

/**
 * Run one form submission: clear the error, raise the busy flag, run the
 * caller's request, and lower the flag again whatever the outcome. A rejection
 * becomes the error message — the Error's own wording, or `fallback` — and
 * resolves false, so the caller runs its success work (clearing fields,
 * reloading) only when this returns true.
 */
export async function submit(
  state: SubmitState,
  fallback: string,
  request: () => Promise<unknown>,
): Promise<boolean> {
  const { busy } = state;
  state.error.value = null;
  if (busy) {
    busy.value = true;
  }
  try {
    await request();
    return true;
  } catch (err) {
    state.error.value = errorMessage(err, fallback);
    return false;
  } finally {
    if (busy) {
      busy.value = false;
    }
  }
}
