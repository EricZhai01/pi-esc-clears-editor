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
 * - Holding Esc: treated as terminal key repeat, so it never clears or opens
 *   the rewind list.
 *
 * Pi has no setting for "Esc Esc clears the editor", so this replaces the input
 * editor. It lives in ~/.pi/agent/extensions/ and is auto-discovered.
 * Run /reload to apply without restarting pi.
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  type EditorTheme,
  type KeybindingsManager,
  type TUI,
} from "@earendil-works/pi-tui";
import { createEscState, handleEscPress, type EscState } from "../src/esc-logic.ts";

class DoubleEscClearsEditor extends CustomEditor {
  private readonly isBusy: () => boolean;
  private escState: EscState = createEscState();

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
      // Any real key ends a pending double press.
      this.escState = createEscState();
      super.handleInput(data);
      return;
    }

    const canClear =
      this.getText().length > 0 &&
      !this.isBusy() &&
      !this.isShowingAutocomplete() &&
      !this.getText().trimStart().startsWith("!");

    const { state, action } = handleEscPress(this.escState, Date.now(), canClear);
    this.escState = state;

    if (action === "swallow") {
      return;
    }

    if (action === "clear") {
      // setText fires onChange, so bash-mode tracking stays correct.
      this.setText("");
      this.tui.requestRender();
      // Swallow this press so pi's own double-escape timer never arms from it;
      // the next deliberate double press is what opens the rewind list.
      return;
    }

    // Forward to pi. With an empty editor this is what opens the rewind list on
    // the second press; while streaming it aborts; otherwise it is a no-op.
    super.handleInput(data);
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
