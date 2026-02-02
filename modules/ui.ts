/**
 * Terminal UI Module
 *
 * // NOTE(self): Clean, minimal terminal output - no overlapping, no fighting.
 * // NOTE(self): Output scrolls naturally. Input is just typing. Like Claude Code.
 */

// ════════════════════════════════════════════════════════════════════════════
// ANSI ESCAPE CODES
// ════════════════════════════════════════════════════════════════════════════

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
};

// ════════════════════════════════════════════════════════════════════════════
// SYMBOLS
// ════════════════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════════════

export function getTerminalWidth(): number {
  return process.stdout.columns || 80;
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

// ════════════════════════════════════════════════════════════════════════════
// TERMINAL UI
// ════════════════════════════════════════════════════════════════════════════

export class TerminalUI {
  private thinkingMessage = '';

  // NOTE(self): Simple log with timestamp and category
  private log(icon: string, color: string, label: string, message: string, detail?: string): void {
    const ts = `${ANSI.dim}${timestamp()}${ANSI.reset}`;
    const ico = `${color}${icon}${ANSI.reset}`;
    const lbl = `${color}${label.padEnd(6)}${ANSI.reset}`;
    const msg = `${ANSI.white}${message}${ANSI.reset}`;
    const det = detail ? `  ${ANSI.dim}${detail}${ANSI.reset}` : '';
    console.log(`  ${ts}  ${ico} ${lbl} ${msg}${det}`);
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

  // NOTE(self): Spinner - just prints a message, no animation that interferes
  startSpinner(message: string): void {
    this.thinkingMessage = message;
    const ts = `${ANSI.dim}${timestamp()}${ANSI.reset}`;
    console.log(`  ${ts}  ${ANSI.cyan}${SYM.spinner[0]}${ANSI.reset} ${ANSI.dim}${message}${ANSI.reset}`);
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

  // NOTE(self): Header
  printHeader(name: string, subtitle?: string): void {
    const width = getTerminalWidth();
    const innerWidth = width - 2;

    console.log();
    console.log(`${ANSI.cyan}${BOX.dTopLeft}${BOX.dHorizontal.repeat(innerWidth)}${BOX.dTopRight}${ANSI.reset}`);
    console.log(`${ANSI.cyan}${BOX.dVertical}${ANSI.reset}${' '.repeat(innerWidth)}${ANSI.cyan}${BOX.dVertical}${ANSI.reset}`);

    const title = `« ${name} »`;
    const padding = Math.floor((innerWidth - title.length) / 2);
    console.log(`${ANSI.cyan}${BOX.dVertical}${ANSI.reset}${' '.repeat(padding)}${ANSI.bold}${ANSI.white}${title}${ANSI.reset}${' '.repeat(innerWidth - padding - title.length)}${ANSI.cyan}${BOX.dVertical}${ANSI.reset}`);

    if (subtitle) {
      const subPadding = Math.floor((innerWidth - subtitle.length) / 2);
      console.log(`${ANSI.cyan}${BOX.dVertical}${ANSI.reset}${' '.repeat(subPadding)}${ANSI.dim}${subtitle}${ANSI.reset}${' '.repeat(innerWidth - subPadding - subtitle.length)}${ANSI.cyan}${BOX.dVertical}${ANSI.reset}`);
    }

    console.log(`${ANSI.cyan}${BOX.dVertical}${ANSI.reset}${' '.repeat(innerWidth)}${ANSI.cyan}${BOX.dVertical}${ANSI.reset}`);
    console.log(`${ANSI.cyan}${BOX.dBottomLeft}${BOX.dHorizontal.repeat(innerWidth)}${BOX.dBottomRight}${ANSI.reset}`);
    console.log();
  }

  printDivider(style: 'light' | 'heavy' | 'double' | 'shade' = 'light'): void {
    const width = getTerminalWidth();
    const char = style === 'shade' ? BOX.light : style === 'double' ? BOX.dHorizontal : BOX.horizontal;
    console.log(`${ANSI.dim}${char.repeat(width)}${ANSI.reset}`);
  }

  printSpacer(): void {
    console.log();
  }

  // NOTE(self): Response box for agent thoughts
  printResponse(text: string): void {
    const width = getTerminalWidth();
    const innerWidth = Math.min(width - 6, 76);

    console.log();
    console.log(`  ${ANSI.dim}${BOX.topLeft}${BOX.horizontal.repeat(innerWidth + 2)}${BOX.topRight}${ANSI.reset}`);

    const lines = wrapText(text, innerWidth);
    for (const line of lines) {
      const padded = line + ' '.repeat(Math.max(0, innerWidth - line.length));
      console.log(`  ${ANSI.dim}${BOX.vertical}${ANSI.reset} ${padded} ${ANSI.dim}${BOX.vertical}${ANSI.reset}`);
    }

    console.log(`  ${ANSI.dim}${BOX.bottomLeft}${BOX.horizontal.repeat(innerWidth + 2)}${BOX.bottomRight}${ANSI.reset}`);
    console.log();
  }

  // NOTE(self): Queue display
  printQueue(items: Array<{ action: string; priority: string }>): void {
    if (items.length === 0) return;
    console.log();
    console.log(`  ${ANSI.yellow}${SYM.star} Planned Actions${ANSI.reset}`);
    for (const item of items.slice(0, 4)) {
      const style = item.priority === 'high' ? ANSI.magenta : item.priority === 'low' ? ANSI.dim : ANSI.white;
      console.log(`  ${style}${SYM.pointer} ${item.action.slice(0, 60)}${ANSI.reset}`);
    }
    if (items.length > 4) {
      console.log(`  ${ANSI.dim}+${items.length - 4} more${ANSI.reset}`);
    }
  }

  printFarewell(): void {
    console.log();
    console.log(`${ANSI.cyan}${BOX.dHorizontal.repeat(getTerminalWidth())}${ANSI.reset}`);
    console.log(`${ANSI.cyan}              ${SYM.heartEmpty} Until next time ${SYM.heartEmpty}${ANSI.reset}`);
    console.log(`${ANSI.cyan}${BOX.dHorizontal.repeat(getTerminalWidth())}${ANSI.reset}`);
    console.log();
  }

  printSection(title: string): void {
    const width = getTerminalWidth();
    const line = BOX.horizontal.repeat(3);
    const remaining = width - title.length - 8;
    console.log();
    console.log(`${ANSI.dim}${line}${ANSI.reset}${ANSI.cyan} ${title} ${ANSI.reset}${ANSI.dim}${BOX.horizontal.repeat(Math.max(0, remaining))}${ANSI.reset}`);
    console.log();
  }

  printToolStart(toolName: string): void {
    const name = toolName.replace(/_/g, ' ');
    console.log(`  ${ANSI.dim}${timestamp()}${ANSI.reset}  ${ANSI.magenta}${SYM.arrowRight}${ANSI.reset} ${ANSI.dim}executing${ANSI.reset} ${ANSI.white}${name}${ANSI.reset}`);
  }

  printToolResult(toolName: string, success: boolean, detail?: string): void {
    const icon = success ? `${ANSI.green}${SYM.check}` : `${ANSI.red}${SYM.cross}`;
    const name = toolName.replace(/_/g, ' ');
    const det = detail ? `  ${ANSI.dim}${detail.slice(0, 36)}${ANSI.reset}` : '';
    console.log(`  ${ANSI.dim}${timestamp()}${ANSI.reset}  ${icon}${ANSI.reset} ${ANSI.dim}${name}${ANSI.reset}${det}`);
  }

  // NOTE(self): Status bar - prints once at bottom
  enableStatusBar(): void {
    console.log();
    console.log(`  ${ANSI.dim}ESC${ANSI.reset} ${ANSI.gray}clear/quit${ANSI.reset}  ${ANSI.dim}│${ANSI.reset}  ${ANSI.dim}Ctrl+C${ANSI.reset} ${ANSI.gray}halt${ANSI.reset}  ${ANSI.dim}│${ANSI.reset}  ${ANSI.dim}Enter${ANSI.reset} ${ANSI.gray}send${ANSI.reset}`);
    console.log();
  }

  disableStatusBar(): void {
    // NOTE(self): Nothing to do - status bar is just a printed line
  }

  printStatusBar(): void {
    // NOTE(self): No-op - we print it once at startup
  }

  // NOTE(self): Input handling - minimal, no interference
  setInputBuffer(_buffer: string): void {
    // NOTE(self): No-op - we don't track this anymore
  }

  printInputPrompt(_cursorPos?: number): void {
    // NOTE(self): No-op - input just appears naturally as user types
  }

  clearInputLine(): void {
    process.stdout.write('\r' + ANSI.clearLine);
  }
}

export const ui = new TerminalUI();
