//NOTE(self): Terminal UI Module
//NOTE(self): Uses scroll regions to anchor input box at bottom.
//NOTE(self): Output scrolls in upper region, input stays fixed below.

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

//NOTE(self): Timer information for display
export interface ScheduledTimers {
  awareness: { nextAt: Date; interval: number };
  expression: { nextAt: Date | null; description: string };
  reflection: { nextAt: Date; interval: number };
  improvement: { nextAt: Date | null; description: string };
}

//NOTE(self): Rate limit budget information for display
export interface RateLimitBudget {
  github: { remaining: number; limit: number; resetAt: Date };
  bluesky: { remaining: number; limit: number; resetAt: Date };
}

//NOTE(self): Terminal Ui with anchored input box
export class TerminalUI {
  private thinkingMessage = '';
  private inputBoxEnabled = false;
  private inputBoxHeight = 11; //NOTE(self): 4 timer lines + 1 budget line + separator + top border + 3 input lines + bottom border
  private currentVersion = '0.0.0'; //NOTE(self): Fallback, actual version passed from loop.ts
  private currentInputText = '';
  private currentCursorPos = 0;
  private availableForMessage = true; //NOTE(self): Track if agent can be interrupted
  private timers: ScheduledTimers | null = null;
  private budgets: RateLimitBudget | null = null;
  private lastHeartbeat: Date = new Date();
  private resizeHandler: (() => void) | null = null;

  //NOTE(self): Strip ANSI escape codes to get visible character count
  private visibleLength(str: string): number {
    return str.replace(/\x1b\[[0-9;]*m/g, '').length;
  }

  //NOTE(self): Wrap text in double-line vertical borders (║ content ║)
  //NOTE(self): Long lines will overflow past the right border — that's acceptable
  private addBorder(text: string): string {
    const width = getTerminalWidth();
    const innerWidth = width - 2; //NOTE(self): ║ + content(width-2) + ║
    const visLen = this.visibleLength(text);
    if (visLen > innerWidth) {
      return `${ANSI.white}${BOX.dVertical}${ANSI.reset}${text}`;
    }
    const padding = innerWidth - visLen;
    return `${ANSI.white}${BOX.dVertical}${ANSI.reset}${text}${' '.repeat(padding)}${ANSI.white}${BOX.dVertical}${ANSI.reset}`;
  }

  //NOTE(self): Write to the output area (scroll region)
  private writeOutput(text: string): void {
    if (this.inputBoxEnabled) {
      //NOTE(self): Save cursor, move to scroll region, write, restore
      process.stdout.write(ANSI.saveCursor);
      const height = getTerminalHeight();
      const scrollBottom = height - this.inputBoxHeight;
      //NOTE(self): Move to bottom of scroll region
      process.stdout.write(CSI.moveTo(scrollBottom, 1));
      process.stdout.write('\n' + this.addBorder(text));
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
    this.log(SYM.ring, ANSI.white, 'info', message, detail);
  }

  success(message: string, detail?: string): void {
    this.log(SYM.check, ANSI.white, 'done', message, detail);
  }

  warn(message: string, detail?: string): void {
    this.log(SYM.diamond, ANSI.white, 'warn', message, detail);
  }

  error(message: string, detail?: string): void {
    this.log(SYM.cross, ANSI.red, 'error', message, detail);
  }

  action(message: string, detail?: string): void {
    this.log(SYM.arrowRight, ANSI.white, 'act', message, detail);
  }

  think(message: string, detail?: string): void {
    this.log(SYM.bullet, ANSI.white, 'think', message, detail);
  }

  social(message: string, detail?: string): void {
    this.log(SYM.heart, ANSI.white, 'social', message, detail);
  }

  memory(message: string, detail?: string): void {
    this.log(SYM.star, ANSI.white, 'mem', message, detail);
  }

  system(message: string, detail?: string): void {
    this.log(SYM.square, ANSI.gray, 'sys', message, detail);
  }

  reflect(message: string, detail?: string): void {
    this.log(SYM.diamond, ANSI.white, 'refl', message, detail);
  }

  contemplate(message: string, detail?: string): void {
    this.log(SYM.ring, ANSI.white, 'mind', message, detail);
  }

  queue(message: string, detail?: string): void {
    this.log(SYM.pointer, ANSI.white, 'queue', message, detail);
  }

  //NOTE(self): Spinner - just prints a message, no animation that interferes
  startSpinner(message: string): void {
    this.thinkingMessage = message;
    const ts = `${ANSI.dim}${timestamp()}${ANSI.reset}`;
    this.writeOutput(`  ${ts}  ${ANSI.white}${SYM.spinner[0]}${ANSI.reset} ${ANSI.dim}${message}${ANSI.reset}`);
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

  //NOTE(self): Set availability status for message interruption
  setAvailable(available: boolean): void {
    this.availableForMessage = available;
    if (this.inputBoxEnabled) {
      this.redrawInputBox();
    }
  }

  isAvailable(): boolean {
    return this.availableForMessage;
  }

  //NOTE(self): Update scheduled timers display
  updateTimers(timers: ScheduledTimers): void {
    this.timers = timers;
    if (this.inputBoxEnabled) {
      this.redrawInputBox();
    }
  }

  //NOTE(self): Update rate limit budgets display
  updateBudgets(budgets: RateLimitBudget): void {
    this.budgets = budgets;
    if (this.inputBoxEnabled) {
      this.redrawInputBox();
    }
  }

  //NOTE(self): Format budget line for display
  private formatBudgetLine(): string {
    if (!this.budgets) {
      return `  ${ANSI.dim}${SYM.ring} API Budget${ANSI.reset}     ${ANSI.gray}--${ANSI.reset}`;
    }

    const gh = this.budgets.github;
    const bs = this.budgets.bluesky;

    const ghPct = gh.limit > 0 ? gh.remaining / gh.limit : 1;
    const bsPct = bs.limit > 0 ? bs.remaining / bs.limit : 1;

    const ghColor = ghPct > 0.5 ? ANSI.green : ghPct > 0.1 ? ANSI.yellow : ANSI.red;
    const bsColor = bsPct > 0.5 ? ANSI.green : bsPct > 0.1 ? ANSI.yellow : ANSI.red;

    const ghReset = this.formatTimeRemaining(gh.resetAt);
    const bsReset = this.formatTimeRemaining(bs.resetAt);

    return `  ${ANSI.dim}${SYM.ring}${ANSI.reset} ${ANSI.white}${'API Budget'.padEnd(14)}${ANSI.reset}${ghColor}GH: ${gh.remaining}/${gh.limit}${ANSI.reset} ${ANSI.dim}(${ghReset})${ANSI.reset}    ${bsColor}BS: ${bs.remaining}/${bs.limit}${ANSI.reset} ${ANSI.dim}(${bsReset})${ANSI.reset}`;
  }

  //NOTE(self): Format time remaining in human-readable form
  private formatTimeRemaining(target: Date): string {
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();

    if (diffMs <= 0) return 'now';

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMins = minutes % 60;
      const remainingSecs = seconds % 60;
      return `${hours}h ${remainingMins}m ${remainingSecs}s`;
    } else if (minutes > 0) {
      const remainingSecs = seconds % 60;
      return `${minutes}m ${remainingSecs}s`;
    } else {
      return `${seconds}s`;
    }
  }

  //NOTE(self): Heartbeat - shows signs of life
  heartbeat(): void {
    this.lastHeartbeat = new Date();
    const ts = `${ANSI.dim}${timestamp()}${ANSI.reset}`;
    this.writeOutput(`  ${ts}  ${ANSI.white}${SYM.heart}${ANSI.reset} ${ANSI.white}ready${ANSI.reset} ${ANSI.dim}listening for notifications${ANSI.reset}`);
  }

  //NOTE(self): Format a single timer line for display
  private formatTimerLine(label: string, nextAt: Date | null, description: string): string {
    const labelPadded = label.padEnd(14);
    const timePadded = 16; //NOTE(self): Width for "in Xh XXm XXs" column

    if (!nextAt) {
      const timeStr = '--'.padEnd(timePadded);
      return `  ${ANSI.dim}${SYM.ring}${ANSI.reset} ${ANSI.white}${labelPadded}${ANSI.reset}${ANSI.gray}${timeStr}${ANSI.reset}${ANSI.dim}(${description})${ANSI.reset}`;
    }

    const timeRemaining = this.formatTimeRemaining(nextAt);
    const isImminent = nextAt.getTime() - Date.now() < 60000; //NOTE(self): Less than 1 minute
    const isPast = nextAt.getTime() <= Date.now();

    const icon = isPast ? SYM.arrowRight : SYM.ring;
    const iconColor = isPast ? ANSI.green : (isImminent ? ANSI.yellow : ANSI.cyan);
    const timeColor = isPast ? ANSI.green : (isImminent ? ANSI.yellow : ANSI.white);
    const timeStr = `in ${timeRemaining}`.padEnd(timePadded);

    return `  ${iconColor}${icon}${ANSI.reset} ${ANSI.white}${labelPadded}${ANSI.reset}${timeColor}${timeStr}${ANSI.reset}${ANSI.dim}(${description})${ANSI.reset}`;
  }

  //NOTE(self): Header
  printHeader(name: string, subtitle?: string): void {
    const width = getTerminalWidth();
    const innerWidth = width - 2;

    this.writeOutput('');
    this.writeOutput(`${ANSI.white}${BOX.dTopLeft}${BOX.dHorizontal.repeat(innerWidth)}${BOX.dTopRight}${ANSI.reset}`);
    this.writeOutput(`${ANSI.white}${BOX.dVertical}${ANSI.reset}${' '.repeat(innerWidth)}${ANSI.white}${BOX.dVertical}${ANSI.reset}`);

    const title = `« ${name} »`;
    const padding = Math.floor((innerWidth - title.length) / 2);
    this.writeOutput(`${ANSI.white}${BOX.dVertical}${ANSI.reset}${' '.repeat(padding)}${ANSI.bold}${ANSI.white}${title}${ANSI.reset}${' '.repeat(innerWidth - padding - title.length)}${ANSI.white}${BOX.dVertical}${ANSI.reset}`);

    if (subtitle) {
      const subPadding = Math.floor((innerWidth - subtitle.length) / 2);
      this.writeOutput(`${ANSI.white}${BOX.dVertical}${ANSI.reset}${' '.repeat(subPadding)}${ANSI.dim}${subtitle}${ANSI.reset}${' '.repeat(innerWidth - subPadding - subtitle.length)}${ANSI.white}${BOX.dVertical}${ANSI.reset}`);
    }

    this.writeOutput(`${ANSI.white}${BOX.dVertical}${ANSI.reset}${' '.repeat(innerWidth)}${ANSI.white}${BOX.dVertical}${ANSI.reset}`);
    this.writeOutput(`${ANSI.white}${BOX.dBottomLeft}${BOX.dHorizontal.repeat(innerWidth)}${BOX.dBottomRight}${ANSI.reset}`);
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

  //NOTE(self): Queue display - show more actions with fuller descriptions
  printQueue(items: Array<{ action: string; priority: string }>): void {
    if (items.length === 0) return;
    this.writeOutput('');
    this.writeOutput(`  ${ANSI.white}${SYM.star} Planned Actions${ANSI.reset}`);
    for (const item of items.slice(0, 8)) {
      const style = item.priority === 'high' ? ANSI.red : item.priority === 'low' ? ANSI.dim : ANSI.white;
      this.writeOutput(`  ${style}${SYM.pointer} ${item.action}${ANSI.reset}`);
    }
    if (items.length > 8) {
      this.writeOutput(`  ${ANSI.dim}+${items.length - 8} more${ANSI.reset}`);
    }
  }

  printFarewell(): void {
    this.writeOutput('');
    this.writeOutput(`${ANSI.white}${BOX.dHorizontal.repeat(getTerminalWidth())}${ANSI.reset}`);
    this.writeOutput(`${ANSI.white} The obstacle becomes the way ${ANSI.reset}`);
    this.writeOutput(`${ANSI.white}${BOX.dHorizontal.repeat(getTerminalWidth())}${ANSI.reset}`);
    this.writeOutput('');
  }

  printSection(title: string): void {
    const width = getTerminalWidth();
    const line = BOX.horizontal.repeat(3);
    const remaining = width - title.length - 8;
    this.writeOutput('');
    this.writeOutput(`${ANSI.dim}${line}${ANSI.reset}${ANSI.white} ${title} ${ANSI.reset}${ANSI.dim}${BOX.horizontal.repeat(Math.max(0, remaining))}${ANSI.reset}`);
    this.writeOutput('');
  }

  printToolStart(toolName: string): void {
    const name = toolName.replace(/_/g, ' ');
    this.writeOutput(`  ${ANSI.dim}${timestamp()}${ANSI.reset}  ${ANSI.white}${SYM.arrowRight}${ANSI.reset} ${ANSI.dim}executing${ANSI.reset} ${ANSI.white}${name}${ANSI.reset}`);
  }

  printToolResult(toolName: string, success: boolean, detail?: string): void {
    const icon = success ? `${ANSI.white}${SYM.check}` : `${ANSI.red}${SYM.cross}`;
    const name = toolName.replace(/_/g, ' ');
    const det = detail ? `  ${ANSI.dim}${detail}${ANSI.reset}` : '';
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
  initInputBox(version: string = '0.0.0'): void {
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

    //NOTE(self): Draw top border of output frame (╔═══╗) into scroll region
    const width = getTerminalWidth();
    process.stdout.write(ANSI.saveCursor);
    process.stdout.write(CSI.moveTo(scrollBottom, 1));
    process.stdout.write('\n' + `${ANSI.white}${BOX.dTopLeft}${BOX.dHorizontal.repeat(width - 2)}${BOX.dTopRight}${ANSI.reset}`);
    this.redrawInputBox();

    //NOTE(self): Handle terminal resize — remove old handler to prevent listener leak
    if (this.resizeHandler) {
      process.stdout.removeListener('resize', this.resizeHandler);
    }
    this.resizeHandler = () => {
      if (this.inputBoxEnabled) {
        const newHeight = getTerminalHeight();
        const newScrollBottom = newHeight - this.inputBoxHeight;
        process.stdout.write(CSI.setScrollRegion(1, newScrollBottom));
        this.redrawInputBox();
      }
    };
    process.stdout.on('resize', this.resizeHandler);
  }

  //NOTE(self): Redraw the input box at fixed bottom position (full width)
  private redrawInputBox(): void {
    if (!this.inputBoxEnabled) return;

    const height = getTerminalHeight();
    const width = getTerminalWidth();
    const innerWidth = width - 4; //NOTE(self): Account for borders and padding (│ + space + space + │)

    //NOTE(self): Save cursor position in scroll region
    process.stdout.write(ANSI.saveCursor);

    //NOTE(self): Draw at fixed bottom position (outside scroll region)
    const boxStartRow = height - this.inputBoxHeight + 1;
    let currentRow = boxStartRow;

    //NOTE(self): Draw timer lines (4 lines showing scheduled actions)
    if (this.timers) {
      const timerLines = [
        this.formatTimerLine('Awareness', this.timers.awareness.nextAt, 'checking notifications'),
        this.formatTimerLine('Expression', this.timers.expression.nextAt, this.timers.expression.description || 'next post'),
        this.formatTimerLine('Reflection', this.timers.reflection.nextAt, 'updating SELF.md'),
        this.formatTimerLine('Improvement', this.timers.improvement.nextAt, this.timers.improvement.description || 'code changes'),
      ];

      for (const timerLine of timerLines) {
        process.stdout.write(CSI.moveTo(currentRow, 1));
        process.stdout.write(CSI.clearLine + this.addBorder(timerLine));
        currentRow++;
      }
    } else {
      //NOTE(self): No timers yet, show placeholder lines
      for (let i = 0; i < 4; i++) {
        process.stdout.write(CSI.moveTo(currentRow, 1));
        process.stdout.write(CSI.clearLine + this.addBorder(`  ${ANSI.dim}${SYM.ring} Loading schedule...${ANSI.reset}`));
        currentRow++;
      }
    }

    //NOTE(self): Budget line (API rate limits)
    process.stdout.write(CSI.moveTo(currentRow, 1));
    process.stdout.write(CSI.clearLine + this.addBorder(this.formatBudgetLine()));
    currentRow++;

    //NOTE(self): Separator line — matches header's double-border style
    process.stdout.write(CSI.moveTo(currentRow, 1));
    process.stdout.write(CSI.clearLine + `${ANSI.white}${BOX.dBottomLeft}${BOX.dHorizontal.repeat(width - 2)}${BOX.dBottomRight}${ANSI.reset}`);
    currentRow++;

    //NOTE(self): Build the input box lines
    const statusTag = this.availableForMessage ? '[Available]' : '[Thinking...]';
    const statusColor = this.availableForMessage ? ANSI.green : ANSI.yellow;
    const hotkeys = `ESC: clear  Ctrl+C: quit  Enter: send`;
    //NOTE(self): Calculate padding: width - ┌─ (2) - space (1) - statusTag - spaces (2) - hotkeys - space (1) - ─┐ (2)
    const topPadding = Math.max(0, width - statusTag.length - hotkeys.length - 8);
    //NOTE(self): Structure: red(┌─) + space + coloredStatus + reset + spaces + hotkeys + space + red(─...─┐)
    const topLine = `${ANSI.white}${BOX.topLeft}${BOX.horizontal}${ANSI.reset} ${statusColor}${statusTag}${ANSI.reset}  ${hotkeys} ${ANSI.white}${BOX.horizontal.repeat(topPadding + 1)}${BOX.topRight}${ANSI.reset}`;

    const displayText = this.currentInputText || '';

    //NOTE(self): Hard-wrap text for predictable cursor positioning
    const textLines: string[] = [];
    if (displayText.length === 0) {
      textLines.push('');
    } else {
      for (let i = 0; i < displayText.length; i += innerWidth) {
        textLines.push(displayText.slice(i, i + innerWidth));
      }
    }

    //NOTE(self): Calculate cursor position (trivial with hard-wrap)
    const cursorLineIndex = innerWidth > 0 ? Math.floor(this.currentCursorPos / innerWidth) : 0;
    const cursorColIndex = innerWidth > 0 ? this.currentCursorPos % innerWidth : 0;

    //NOTE(self): Determine scroll window (keep cursor visible within 3 lines)
    const VISIBLE_LINES = 3;
    let displayStartLine = 0;
    if (cursorLineIndex >= VISIBLE_LINES) {
      displayStartLine = cursorLineIndex - (VISIBLE_LINES - 1);
    }

    const ver = `v${this.currentVersion}`;
    const hasOverflow = textLines.length > displayStartLine + VISIBLE_LINES;
    const scrollIndicator = hasOverflow ? ' ...' : '';
    const bottomPadding = Math.max(0, width - ver.length - scrollIndicator.length - 5);
    const bottomLine = `${BOX.bottomLeft}${BOX.horizontal.repeat(bottomPadding)}${scrollIndicator} ${ver} ${BOX.horizontal}${BOX.bottomRight}`;

    //NOTE(self): Draw input box — top border
    process.stdout.write(CSI.moveTo(currentRow, 1));
    process.stdout.write(CSI.clearLine + topLine);
    currentRow++;

    //NOTE(self): Render 3 input lines
    for (let i = 0; i < VISIBLE_LINES; i++) {
      const lineIdx = displayStartLine + i;
      const lineContent = (textLines[lineIdx] || '').padEnd(innerWidth);
      process.stdout.write(CSI.moveTo(currentRow, 1));
      process.stdout.write(CSI.clearLine + `${ANSI.white}${BOX.vertical}${ANSI.reset} ${ANSI.white}${lineContent}${ANSI.reset} ${ANSI.white}${BOX.vertical}${ANSI.reset}`);
      currentRow++;
    }

    //NOTE(self): Bottom border
    process.stdout.write(CSI.moveTo(currentRow, 1));
    process.stdout.write(CSI.clearLine + `${ANSI.white}${bottomLine}${ANSI.reset}`);

    //NOTE(self): Position cursor on the correct visible row
    const cursorVisibleRow = cursorLineIndex - displayStartLine;
    const inputLineRow = (currentRow - VISIBLE_LINES) + cursorVisibleRow;
    const cursorCol = Math.min(cursorColIndex, innerWidth) + 3; //NOTE(self): +3 for "│ " prefix
    process.stdout.write(CSI.moveTo(inputLineRow, Math.max(3, cursorCol)));
  }

  //NOTE(self): Update input box content
  printInputBox(text: string, cursorPos: number, version: string = '0.0.0'): void {
    this.currentInputText = text;
    this.currentCursorPos = cursorPos;
    this.currentVersion = version;
    this.redrawInputBox();
  }

  //NOTE(self): Clear input and redraw
  clearInputBox(version: string = '0.0.0'): void {
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
