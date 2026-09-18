/**
 * Esc Esc clears the editor (matches Claude Code).
 *
 * Behaviour:
 * - Esc Esc with text in the editor: clears the editor.
 * - Esc Esc with an empty editor: pi's native action, the rewind list
 *   (`doubleEscapeAction`: "tree" by default, "fork" also works).
 * - A single Esc: native behaviour. While streaming it aborts; while idle with
 *   text it does nothing; with autocomplete open it closes it.
 * - Esc in bash mode (`!...`): native behaviour, exits bash mode.
 * - Holding Esc: ignored, so it never clears or opens the rewind list.
 *
 * Pi has no setting for "Esc Esc clears the editor", so this replaces the input
 * editor. It lives in ~/.pi/agent/extensions/ and is auto-discovered.
 * Run /reload to apply without restarting pi.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  isKeyRepeat,
  isKittyProtocolActive,
  matchesKey,
  type EditorTheme,
  type KeybindingsManager,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  BURST_MS,
  createEscState,
  handleEscPress,
  markCleared,
  type EscState,
} from "../src/esc-logic.ts";

class DoubleEscClearsEditor extends CustomEditor {
  private readonly isBusy: () => boolean;
  private escState: EscState = createEscState();
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    isBusy: () => boolean,
  ) {
    super(tui, theme, keybindings, { embedWorkingStatus: true });
    this.isBusy = isBusy;
  }

  handleInput(data: string): void {
    if (!matchesKey(data, "escape")) {
      // Typing carries on from wherever the editor is, so an already-confirmed
      // clear must land before the key does. Anything less would either lose the
      // keystroke or append it to text the user asked to clear.
      if (this.clearTimer !== null) this.clearNow();
      this.escState = { ...this.escState, pendingPressAt: 0 };
      super.handleInput(data);
      return;
    }

    const canClear =
      this.getText().length > 0 &&
      !this.isBusy() &&
      !this.isShowingAutocomplete() &&
      !this.getText().trimStart().startsWith("!");

    const { state, action } = handleEscPress(this.escState, Date.now(), {
      canClear,
      isRepeat: isKeyRepeat(data),
      repeatAware: isKittyProtocolActive(),
    });
    this.escState = state;

    // Keep the timer in step with the state: when the logic cancels a scheduled
    // clear it zeroes `clearDeadline`, and the pending timer must go with it.
    if (state.clearDeadline === 0) this.cancelClear();

    switch (action) {
      case "swallow":
      case "hold":
        // Pi treats a single escape with text as a no-op, so dropping it is safe
        // and keeps a held key away from pi's own double-escape timer.
        return;

      case "clear":
        this.clearNow();
        return;

      case "deferClear":
        // Terminals that do not report key-repeat send a second escape for a
        // held key too. Wait briefly for a third before committing; a genuine
        // double tap never sends one.
        this.cancelClear();
        this.clearTimer = setTimeout(() => {
          this.clearTimer = null;
          this.clearNow();
        }, BURST_MS);
        return;

      case "forward":
        // Empty editor, streaming, autocomplete open, or bash mode: hand it to
        // pi so abort, dismissal and the native rewind list keep working.
        this.cancelClear();
        super.handleInput(data);
        return;
    }
  }

  private clearNow(): void {
    this.cancelClear();
    // setText fires onChange, so bash-mode tracking stays correct.
    this.setText("");
    this.escState = markCleared(Date.now());
    this.tui.requestRender();
  }

  private cancelClear(): void {
    if (this.clearTimer !== null) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new DoubleEscClearsEditor(tui, theme, keybindings, () => {
        try {
          return !ctx.isIdle();
        } catch {
          return false;
        }
      }),
    );
  });
}
