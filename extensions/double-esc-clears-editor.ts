/**
 * Esc Esc clears the editor (matches Claude Code).
 *
 * Behaviour:
 * - Esc Esc with text in the editor: clears the editor.
 * - Esc Esc with an empty editor: pi's native action, the rewind list
 *   (`doubleEscapeAction`: "tree" by default, "fork" also works, "none" off).
 * - A single Esc: native behaviour. While streaming it aborts; while idle with
 *   text or an empty editor it does nothing; with autocomplete open it closes it.
 * - Esc in bash mode (`!...`): native behaviour, exits bash mode.
 * - Holding Esc: ignored, so it never clears the editor and never flickers the
 *   rewind list.
 *
 * Pi has no setting for "Esc Esc clears the editor", so this replaces the input
 * editor. It lives in ~/.pi/agent/extensions/ and is auto-discovered.
 * Run /reload to apply without restarting pi.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  isKeyRepeat,
  matchesKey,
  type EditorTheme,
  type KeybindingsManager,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  BURST_MS,
  createEscState,
  handleEscPress,
  markCommitted,
  type EscIntent,
  type EscState,
} from "../src/esc-logic.ts";

class DoubleEscClearsEditor extends CustomEditor {
  private readonly isBusy: () => boolean;
  private escState: EscState = createEscState();
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

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
      // A held key only ever produces escapes, so any other key proves the double
      // press was deliberate. Run a pending commit first, so a clear cannot wipe
      // the character just typed.
      const committed = this.flushCommit();
      this.escState = { ...this.escState, pendingPressAt: 0, intent: null };
      // Opening the rewind list moves focus to the selector, so this keystroke
      // belongs there, not to an editor the user can no longer see.
      if (committed === "rewind") return;
      super.handleInput(data);
      return;
    }

    const previousIntent = this.escState.intent;

    const { state, action } = handleEscPress(this.escState, Date.now(), {
      intent: this.currentIntent(),
      isRepeat: isKeyRepeat(data),
    });
    this.escState = state;

    // Keep the timer in step with the state: when the logic cancels a scheduled
    // commit it zeroes `deadline`, and the pending timer must go with it.
    if (state.deadline === 0) this.cancelCommit();

    switch (action) {
      case "swallow":
      case "hold":
        // Pi treats a lone escape in these states as a no-op, so dropping it is
        // safe and keeps a held key away from pi's own double-escape timer.
        return;

      case "commit":
        this.runCommit(state.intent ?? previousIntent, data);
        return;

      case "defer":
        // Terminals that do not report key-repeat send a second escape for a
        // held key too. Wait briefly for a third before committing; a genuine
        // double tap never sends one.
        this.cancelCommit();
        this.commitTimer = setTimeout(() => {
          this.commitTimer = null;
          const pending = this.escState.intent;
          this.escState = markCommitted(this.escState, Date.now());
          this.runCommit(pending, "\x1b");
        }, BURST_MS);
        return;

      case "forward":
        // Streaming, autocomplete open, or bash mode: pi owns the escape key.
        this.cancelCommit();
        super.handleInput(data);
        return;
    }
  }

  /**
   * What a completed double press would do right now.
   *
   * `native` covers every state where pi must keep the escape key: streaming
   * (abort), autocomplete open (dismiss), and bash mode (leave bash mode).
   */
  private currentIntent(): EscIntent {
    if (this.isBusy() || this.isShowingAutocomplete()) return "native";
    if (this.getText().trimStart().startsWith("!")) return "native";
    return this.getText().length > 0 ? "clear" : "rewind";
  }

  /** Run a pending deferred commit, returning what it did. */
  private flushCommit(): EscIntent | null {
    if (this.commitTimer === null) return null;
    this.cancelCommit();
    const pending = this.escState.intent;
    this.escState = markCommitted(this.escState, Date.now());
    this.runCommit(pending, "\x1b");
    return pending;
  }

  private runCommit(intent: EscIntent | null, escape: string): void {
    this.cancelCommit();
    this.escState = markCommitted(this.escState, Date.now());

    if (intent === "clear") {
      // setText fires onChange, so bash-mode tracking stays correct.
      this.setText("");
      this.tui.requestRender();
      return;
    }

    if (intent === "rewind") {
      // Pi opens the rewind list on the second of two escapes inside its own
      // 500ms window, and only arms that window on an empty editor. The double
      // press is already confirmed here and repeats are dropped, so feeding pi
      // exactly two escapes opens the list once and honours `doubleEscapeAction`.
      super.handleInput(escape);
      super.handleInput(escape);
    }
  }

  private cancelCommit(): void {
    if (this.commitTimer !== null) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
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
