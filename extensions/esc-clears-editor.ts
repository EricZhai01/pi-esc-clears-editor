/**
 * Esc clears the editor; double Esc opens the rewind (session tree) list.
 *
 * Behaviour (matches Claude Code):
 * - Esc with text in the editor: clears the editor.
 * - Esc twice within 500ms: runs pi's `doubleEscapeAction`
 *   (default "tree" = rewind list; "fork" works too).
 * - Esc while streaming or compacting: native behaviour (abort / restore queue).
 * - Esc while autocomplete is open, or in bash mode (`!...`): native behaviour.
 *
 * Pi has no setting for "escape clears the editor", so this replaces the input
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

class EscClearsEditor extends CustomEditor {
  private readonly isBusy: () => boolean;

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
    const shouldClear =
      this.getText().length > 0 &&
      matchesKey(data, "escape") &&
      !this.isBusy() &&
      !this.isShowingAutocomplete() &&
      !this.getText().trimStart().startsWith("!");

    if (shouldClear) {
      // setText fires onChange, so bash-mode tracking stays correct.
      this.setText("");
      this.tui.requestRender();
    }

    // Forward to the app. It owns the 500ms double-escape timer and only starts
    // that timer when the editor is empty, so clearing here is what lets the
    // next escape open the rewind list.
    super.handleInput(data);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;

    ctx.ui.setEditorComponent((tui, theme, keybindings) =>
      new EscClearsEditor(tui, theme, keybindings, () => {
        try {
          return !ctx.isIdle();
        } catch {
          return false;
        }
      }),
    );
  });
}
