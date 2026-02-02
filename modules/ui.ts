/**
 * Terminal UI Module
 *
 * //NOTE(self): Uses scroll regions to anchor input box at bottom.
 * //NOTE(self): Output scrolls in upper region, input stays fixed below.
 */

//NOTE(self): Ansi Escape Codes
export const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  clearLine: '\x1b[2K',
  clearScreen: '\x1b[2J',
  saveCursor: '\x1b[s',
  restoreCursor: '\x1b[u',
};

//NOTE(self): Cursor and screen control
const CSI = {
  moveTo: (row: number, col: number) => `\x1b[${row};${col}H`,
  moveUp: (n: number) => `\x1b[${n}A`,
  moveDown: (n: number) => `\x1b[${n}B`,
  moveToColumn: (col: number) => `\x1b[${col}G`,
  setScrollRegion: (top: number, bottom: number) => `\x1b[${top};${bottom}r`,
  resetScrollRegion: () => '\x1b[r',
  clearToEnd: '\x1b[J',
  clearLine: '\x1b[2K',
};

//NOTE(self): Symbols
export const SYM = {
  bullet: '•',
  diamond: '◆',
  square: '■',
  circle: '●',
  ring: '○',
  star: '★',
  heart: '♥',
  heartEmpty: '♡',
  arrowRight: '▸',
  pointer: '›',
  check: '✓',
  cross: '✗',
  ellipsis: '…',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

export const BOX = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  dTopLeft: '╔',
  dTopRight: '╗',
  dBottomLeft: '╚',
  dBottomRight: '╝',
  dHorizontal: '═',
  dVertical: '║',
  light: '░',
};

//NOTE(self): Utilities
export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

export function getTerminalHeight(): number {
  return process.stdout.rows || 24;
}

export function timestamp(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

export function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > maxWidth) {
      let breakPoint = remaining.lastIndexOf(' ', maxWidth);
      if (breakPoint === -1 || breakPoint < maxWidth * 0.3) breakPoint = maxWidth;
      lines.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trimStart();
    }
    if (remaining) lines.push(remaining);
  }
  return lines;
}

//NOTE(self): Terminal Ui with anchored input box
export class TerminalUI {
  private thinkingMessage = '';
  private inputBoxEnabled = false;
  private inputBoxHeight = 4; //NOTE(self): top border, 2 content lines, bottom border
  private currentVersion = '0.0.2';
  private currentInputText = '';
  private currentCursorPos = 0;

  //NOTE(self): Write to the output area (scroll region)
  private writeOutput(text: string): void {
    if (this.inputBoxEnabled) {
      //NOTE(self): Save cursor, move to scroll region, write, restore
      process.stdout.write(ANSI.saveCursor);
      const height = getTerminalHeight();
      const scrollBottom = height - this.inputBoxHeight;
      //NOTE(self): Move to bottom of scroll region
      process.stdout.write(CSI.moveTo(scrollBottom, 1));
      process.stdout.write('\n' + text);
      //NOTE(self): Restore and redraw input box
      this.redrawInputBox();
    } else {
      process.stdout.write(text + '\n');
    }
  }

  //NOTE(self): Simple log with timestamp and category
  private log(icon: string, color: string, label: string, message: string, detail?: string): void {
    const ts = `${ANSI.dim}${timestamp()}${ANSI.reset}`;
    const ico = `${color}${icon}${ANSI.reset}`;
    const lbl = `${color}${label.padEnd(6)}${ANSI.reset}`;
    const msg = `${ANSI.white}${message}${ANSI.reset}`;
    const det = detail ? `  ${ANSI.dim}${detail}${ANSI.reset}` : '';
    this.writeOutput(`  ${ts}  ${ico} ${lbl} ${msg}${det}`);
  }

  info(message: string, detail?: string): void {
    this.log(SYM.ring, ANSI.blue, 'info', message, detail);
  }

  success(message: string, detail?: string): void {
    this.log(SYM.check, ANSI.green, 'done', message, detail);
  }

  warn(message: string, detail?: string): void {
    this.log(SYM.diamond, ANSI.yellow, 'warn', message, detail);
  }

  error(message: string, detail?: string): void {
    this.log(SYM.cross, ANSI.red, 'error', message, detail);
  }

  action(message: string, detail?: string): void {
    this.log(SYM.arrowRight, ANSI.magenta, 'act', message, detail);
  }

  think(message: string, detail?: string): void {
    this.log(SYM.bullet, ANSI.cyan, 'think', message, detail);
  }

  social(message: string, detail?: string): void {
    this.log(SYM.heart, ANSI.brightMagenta, 'social', message, detail);
  }

  memory(message: string, detail?: string): void {
    this.log(SYM.star, ANSI.brightBlue, 'mem', message, detail);
  }

  system(message: string, detail?: string): void {
    this.log(SYM.square, ANSI.gray, 'sys', message, detail);
  }

  //NOTE(self): Spinner - just prints a message, no animation that interferes
  startSpinner(message: string): void {
    this.thinkingMessage = message;
    const ts = `${ANSI.dim}${timestamp()}${ANSI.reset}`;
    this.writeOutput(`  ${ts}  ${ANSI.cyan}${SYM.spinner[0]}${ANSI.reset} ${ANSI.dim}${message}${ANSI.reset}`);
  }

  updateSpinner(message: string): void {
    this.thinkingMessage = message;
  }

  stopSpinner(finalMessage?: string, success = true): void {
    if (finalMessage) {
      if (success) {
        this.success(finalMessage);
      } else {
        this.error(finalMessage);
      }
    }
    this.thinkingMessage = '';
  }

  isSpinnerActive(): boolean {
    return this.thinkingMessage !== '';
  }

  //NOTE(self): Header
  printHeader(name: string, subtitle?: string): void {
    const width = getTerminalWidth();
    const innerWidth = width - 2;

    this.writeOutput('');
    this.writeOutput(`${ANSI.cyan}${BOX.dTopLeft}${BOX.dHorizontal.repeat(innerWidth)}${BOX.dTopRight}${ANSI.reset}`);
    this.writeOutput(`${ANSI.cyan}${BOX.dVertical}${ANSI.reset}${' '.repeat(innerWidth)}${ANSI.cyan}${BOX.dVertical}${ANSI.reset}`);

    const title = `« ${name} »`;
    const padding = Math.floor((innerWidth - title.length) / 2);
    this.writeOutput(`${ANSI.cyan}${BOX.dVertical}${ANSI.reset}${' '.repeat(padding)}${ANSI.bold}${ANSI.white}${title}${ANSI.reset}${' '.repeat(innerWidth - padding - title.length)}${ANSI.cyan}${BOX.dVertical}${ANSI.reset}`);

    if (subtitle) {
      const subPadding = Math.floor((innerWidth - subtitle.length) / 2);
      this.writeOutput(`${ANSI.cyan}${BOX.dVertical}${ANSI.reset}${' '.repeat(subPadding)}${ANSI.dim}${subtitle}${ANSI.reset}${' '.repeat(innerWidth - subPadding - subtitle.length)}${ANSI.cyan}${BOX.dVertical}${ANSI.reset}`);
    }

    this.writeOutput(`${ANSI.cyan}${BOX.dVertical}${ANSI.reset}${' '.repeat(innerWidth)}${ANSI.cyan}${BOX.dVertical}${ANSI.reset}`);
    this.writeOutput(`${ANSI.cyan}${BOX.dBottomLeft}${BOX.dHorizontal.repeat(innerWidth)}${BOX.dBottomRight}${ANSI.reset}`);
    this.writeOutput('');
  }

  printDivider(style: 'light' | 'heavy' | 'double' | 'shade' = 'light'): void {
    const width = getTerminalWidth();
    const char = style === 'shade' ? BOX.light : style === 'double' ? BOX.dHorizontal : BOX.horizontal;
    this.writeOutput(`${ANSI.dim}${char.repeat(width)}${ANSI.reset}`);
  }

  printSpacer(): void {
    this.writeOutput('');
  }

  //NOTE(self): Response box for agent thoughts
  printResponse(text: string): void {
    const width = getTerminalWidth();
    const innerWidth = Math.min(width - 6, 76);

    this.writeOutput('');
    this.writeOutput(`  ${ANSI.dim}${BOX.topLeft}${BOX.horizontal.repeat(innerWidth + 2)}${BOX.topRight}${ANSI.reset}`);

    const lines = wrapText(text, innerWidth);
    for (const line of lines) {
      const padded = line + ' '.repeat(Math.max(0, innerWidth - line.length));
      this.writeOutput(`  ${ANSI.dim}${BOX.vertical}${ANSI.reset} ${padded} ${ANSI.dim}${BOX.vertical}${ANSI.reset}`);
    }

    this.writeOutput(`  ${ANSI.dim}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth + 2)}${BOX.bottomRight}${ANSI.reset}`);
    this.writeOutput('');
  }

  //NOTE(self): Queue display
  printQueue(items: Array<{ action: string; priority: string }>): void {
    if (items.length === 0) return;
    this.writeOutput('');
    this.writeOutput(`  ${ANSI.yellow}${SYM.star} Planned Actions${ANSI.reset}`);
    for (const item of items.slice(0, 4)) {
      const style = item.priority === 'high' ? ANSI.magenta : item.priority === 'low' ? ANSI.dim : ANSI.white;
      this.writeOutput(`  ${style}${SYM.pointer} ${item.action.slice(0, 60)}${ANSI.reset}`);
    }
    if (items.length > 4) {
      this.writeOutput(`  ${ANSI.dim}+${items.length - 4} more${ANSI.reset}`);
    }
  }

  printFarewell(): void {
    this.writeOutput('');
    this.writeOutput(`${ANSI.cyan}${BOX.dHorizontal.repeat(getTerminalWidth())}${ANSI.reset}`);
    this.writeOutput(`${ANSI.cyan}              ${SYM.heartEmpty} Until next time ${SYM.heartEmpty}${ANSI.reset}`);
    this.writeOutput(`${ANSI.cyan}${BOX.dHorizontal.repeat(getTerminalWidth())}${ANSI.reset}`);
    this.writeOutput('');
  }

  printSection(title: string): void {
    const width = getTerminalWidth();
    const line = BOX.horizontal.repeat(3);
    const remaining = width - title.length - 8;
    this.writeOutput('');
    this.writeOutput(`${ANSI.dim}${line}${ANSI.reset}${ANSI.cyan} ${title} ${ANSI.reset}${ANSI.dim}${BOX.horizontal.repeat(Math.max(0, remaining))}${ANSI.reset}`);
    this.writeOutput('');
  }

  printToolStart(toolName: string): void {
    const name = toolName.replace(/_/g, ' ');
    this.writeOutput(`  ${ANSI.dim}${timestamp()}${ANSI.reset}  ${ANSI.magenta}${SYM.arrowRight}${ANSI.reset} ${ANSI.dim}executing${ANSI.reset} ${ANSI.white}${name}${ANSI.reset}`);
  }

  printToolResult(toolName: string, success: boolean, detail?: string): void {
    const icon = success ? `${ANSI.green}${SYM.check}` : `${ANSI.red}${SYM.cross}`;
    const name = toolName.replace(/_/g, ' ');
    const det = detail ? `  ${ANSI.dim}${detail.slice(0, 36)}${ANSI.reset}` : '';
    this.writeOutput(`  ${ANSI.dim}${timestamp()}${ANSI.reset}  ${icon}${ANSI.reset} ${ANSI.dim}${name}${ANSI.reset}${det}`);
  }

  //NOTE(self): Status bar - now integrated into input box
  enableStatusBar(): void {
    //NOTE(self): No-op - status is shown in input box
  }

  disableStatusBar(): void {
    //NOTE(self): No-op
  }

  printStatusBar(): void {
    //NOTE(self): No-op
  }

  //NOTE(self): Input handling
  setInputBuffer(_buffer: string): void {
    //NOTE(self): No-op
  }

  printInputPrompt(_cursorPos?: number): void {
    //NOTE(self): No-op
  }

  clearInputLine(): void {
    process.stdout.write('\r' + ANSI.clearLine);
  }

  //NOTE(self): Anchored Input Box using scroll regions

  //NOTE(self): Setup scroll region and draw initial input box
  initInputBox(version: string = '0.0.2'): void {
    this.currentVersion = version;
    this.currentInputText = '';
    this.currentCursorPos = 0;

    const height = getTerminalHeight();
    const scrollBottom = height - this.inputBoxHeight;

    //NOTE(self): Clear screen and set up scroll region
    process.stdout.write(CSI.moveTo(1, 1));

    //NOTE(self): Set scroll region (top of screen to above input box)
    process.stdout.write(CSI.setScrollRegion(1, scrollBottom));

    //NOTE(self): Move cursor to top of scroll region
    process.stdout.write(CSI.moveTo(1, 1));

    this.inputBoxEnabled = true;

    //NOTE(self): Draw the input box at the bottom
    this.redrawInputBox();

    //NOTE(self): Handle terminal resize
    process.stdout.on('resize', () => {
      if (this.inputBoxEnabled) {
        const newHeight = getTerminalHeight();
        const newScrollBottom = newHeight - this.inputBoxHeight;
        process.stdout.write(CSI.setScrollRegion(1, newScrollBottom));
        this.redrawInputBox();
      }
    });
  }

  //NOTE(self): Redraw the input box at fixed bottom position
  private redrawInputBox(): void {
    if (!this.inputBoxEnabled) return;

    const height = getTerminalHeight();
    const width = Math.min(getTerminalWidth() - 2, 78);
    const innerWidth = width - 4;

    //NOTE(self): Build the box lines
    const hotkeys = 'ESC: clear  Ctrl+C: quit  Enter: send';
    const topPadding = Math.max(0, innerWidth - hotkeys.length - 2);
    const topLine = `${BOX.topLeft}${BOX.horizontal} ${hotkeys} ${BOX.horizontal.repeat(topPadding)}${BOX.topRight}`;

    const displayText = this.currentInputText || '';
    const textLines = wrapText(displayText, innerWidth);
    const line1 = (textLines[0] || '').padEnd(innerWidth);
    const line2 = (textLines[1] || '').padEnd(innerWidth);

    const ver = `v${this.currentVersion}`;
    const bottomPadding = Math.max(0, innerWidth - ver.length - 1);
    const bottomLine = `${BOX.bottomLeft}${BOX.horizontal.repeat(bottomPadding)} ${ver} ${BOX.horizontal}${BOX.bottomRight}`;

    //NOTE(self): Save cursor position in scroll region
    process.stdout.write(ANSI.saveCursor);

    //NOTE(self): Draw input box at fixed bottom position (outside scroll region)
    const boxStartRow = height - this.inputBoxHeight + 1;

    process.stdout.write(CSI.moveTo(boxStartRow, 1));
    process.stdout.write(CSI.clearLine + `${ANSI.cyan}${topLine}${ANSI.reset}`);

    process.stdout.write(CSI.moveTo(boxStartRow + 1, 1));
    process.stdout.write(CSI.clearLine + `${ANSI.cyan}${BOX.vertical}${ANSI.reset} ${ANSI.white}${line1}${ANSI.reset} ${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);

    process.stdout.write(CSI.moveTo(boxStartRow + 2, 1));
    process.stdout.write(CSI.clearLine + `${ANSI.cyan}${BOX.vertical}${ANSI.reset} ${ANSI.dim}${line2}${ANSI.reset} ${ANSI.cyan}${BOX.vertical}${ANSI.reset}`);

    process.stdout.write(CSI.moveTo(boxStartRow + 3, 1));
    process.stdout.write(CSI.clearLine + `${ANSI.cyan}${bottomLine}${ANSI.reset}`);

    //NOTE(self): Position cursor in input area
    const cursorInLine1 = this.currentCursorPos <= innerWidth;
    const cursorRow = cursorInLine1 ? boxStartRow + 1 : boxStartRow + 2;
    const cursorCol = cursorInLine1 ? this.currentCursorPos + 3 : (this.currentCursorPos - innerWidth) + 3;
    process.stdout.write(CSI.moveTo(cursorRow, cursorCol));
  }

  //NOTE(self): Update input box content
  printInputBox(text: string, cursorPos: number, version: string = '0.0.2'): void {
    this.currentInputText = text;
    this.currentCursorPos = cursorPos;
    this.currentVersion = version;
    this.redrawInputBox();
  }

  //NOTE(self): Clear input and redraw
  clearInputBox(version: string = '0.0.2'): void {
    this.printInputBox('', 0, version);
  }

  //NOTE(self): Disable input box and restore normal scrolling
  finalizeInputBox(): void {
    if (!this.inputBoxEnabled) return;

    //NOTE(self): Reset scroll region to full screen
    process.stdout.write(CSI.resetScrollRegion());

    //NOTE(self): Move to bottom and clear input box area
    const height = getTerminalHeight();
    process.stdout.write(CSI.moveTo(height - this.inputBoxHeight + 1, 1));
    for (let i = 0; i < this.inputBoxHeight; i++) {
      process.stdout.write(CSI.clearLine + '\n');
    }

    //NOTE(self): Move back up
    process.stdout.write(CSI.moveTo(height - this.inputBoxHeight + 1, 1));

    this.inputBoxEnabled = false;
    this.currentInputText = '';
    this.currentCursorPos = 0;
  }
}

export const ui = new TerminalUI();
