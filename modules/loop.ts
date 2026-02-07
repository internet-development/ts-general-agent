//NOTE(self): Main Loop Module
//NOTE(self): The heart of the agent - powered by the five-loop scheduler.
//NOTE(self): Awareness (cheap) + Expression (scheduled) + Reflection (deep) + Self-Improvement (rare) + Plan Awareness (collaborative)
//NOTE(self): Self-discovery through expression, not passive waiting.

import { logger } from '@modules/logger.js';
import { chatWithTools, AGENT_TOOLS, isFatalError, createAssistantToolUseMessage, createToolResultMessage, type Message } from '@modules/openai.js';
import { readSoul, readSelf } from '@modules/memory.js';
import { getConfig, type Config } from '@modules/config.js';
import { executeTools } from '@modules/executor.js';
import { ui } from '@modules/ui.js';
import { buildSystemPrompt } from '@modules/skills.js';
import { recordSignificantEvent, addInsight } from '@modules/engagement.js';
import { getScheduler } from '@modules/scheduler.js';
import { recordFriction } from '@local-tools/self-detect-friction.js';
import { createRequire } from 'module';

//NOTE(self): Read version from package.json
const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const VERSION = pkg.version || '0.0.0';

//NOTE(self): Types

export interface LoopContext {
  config: Config;
  messages: Message[];
  soul: string;
  self: string;
}

export interface LoopCallbacks {
  onThink?: (thought: string) => void;
  onAction?: (action: string) => void;
  onError?: (error: Error) => void;
}

//NOTE(self): ========== SCHEDULER-BASED LOOP ==========
//NOTE(self): Uses the five-loop architecture: awareness, expression, reflection, self-improvement, plan awareness
//NOTE(self): More efficient, more expressive, better self-discovery

export async function runSchedulerLoop(callbacks?: LoopCallbacks): Promise<void> {
  const config = getConfig();

  logger.info('Agent awakening (scheduler mode)');

  //NOTE(self): Extract identity from SELF.md
  const selfContent = readSelf(config.paths.selfmd);
  const name =
    selfContent.match(/I'm\s+(\w+)/)?.[1] ||
    selfContent
      .match(/^#\s*(.+)$/m)?.[1]
      ?.replace(/^(SELF|Agent Self Document)\s*/i, '')
      .trim() ||
    'Agent';

  //NOTE(self): Display welcome
  ui.printHeader(name, 'AUTONOMOUS SOUL');
  ui.printDivider('light');

  //NOTE(self): Enable status bar with command hints
  ui.enableStatusBar();

  //NOTE(self): Initialize the dignified input box
  ui.initInputBox(VERSION);

  //NOTE(self): Get the scheduler
  const scheduler = getScheduler();

  //NOTE(self): Input setup - raw mode for character-by-character handling
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  let shouldExit = false;
  let inputBuffer = '';

  //NOTE(self): Graceful departure
  const shutdown = (reason: string): void => {
    if (shouldExit) return;
    shouldExit = true;

    scheduler.stop();

    ui.stopSpinner();
    ui.finalizeInputBox();
    ui.disableStatusBar();
    ui.printFarewell();

    logger.info('Agent resting', { reason });

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  //NOTE(self): Key input handling for owner communication
  process.stdin.on('data', async (key: Buffer) => {
    const char = key.toString();

    //NOTE(self): ESC - clear input or exit
    if (char === '\x1b') {
      if (inputBuffer.length > 0) {
        inputBuffer = '';
        ui.printInputBox('', 0, VERSION);
      } else {
        shutdown('ESC');
      }
      return;
    }

    //NOTE(self): Ctrl+C
    if (char === '\x03') {
      shutdown('Ctrl+C');
      return;
    }

    //NOTE(self): Enter - submit input
    if (char === '\r' || char === '\n') {
      const input = inputBuffer.trim();
      inputBuffer = '';

      ui.finalizeInputBox();

      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        shutdown('exit command');
        return;
      }

      if (input) {
        ui.printSpacer();
        ui.social('Owner speaks', input);

        //NOTE(self): Process owner input with full context
        await processOwnerInput(input, config);

        ui.initInputBox(VERSION);
      } else {
        ui.initInputBox(VERSION);
      }
      return;
    }

    //NOTE(self): Backspace
    if (char === '\x7f' || char === '\b') {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        ui.printInputBox(inputBuffer, inputBuffer.length, VERSION);
      }
      return;
    }

    //NOTE(self): Regular character - update input box
    if (char >= ' ' && char <= '~') {
      inputBuffer += char;
      ui.printInputBox(inputBuffer, inputBuffer.length, VERSION);
    }
  });

  //NOTE(self): Start the scheduler
  ui.system('Scheduler starting', 'awareness + expression + reflection');
  ui.printSpacer();

  try {
    await scheduler.start();
  } catch (error) {
    ui.error(`Scheduler failed to start: ${String(error)}`);
    logger.error('Scheduler start error', { error: String(error) });
    recordFriction('tools', 'Scheduler failed to start', String(error));
  }
}

//NOTE(self): Process owner input with full attention
async function processOwnerInput(input: string, config: Config): Promise<void> {
  ui.startSpinner('Processing owner input');

  try {
    const soul = readSoul(config.paths.soul);
    const fullSelf = readSelf(config.paths.selfmd);

    const systemPrompt = buildSystemPrompt(soul, fullSelf, 'AGENT-OWNER-COMMUNICATION', {
      blueskyUsername: config.bluesky.username,
      ownerHandle: config.owner.blueskyHandle,
    });

    const messages: Message[] = [{ role: 'user', content: input }];

    let response = await chatWithTools({
      system: systemPrompt,
      messages,
      tools: AGENT_TOOLS,
    });

    //NOTE(self): Execute any tool calls
    while (response.toolCalls.length > 0) {
      const results = await executeTools(response.toolCalls);

      //NOTE(self): Format messages correctly for the AI SDK
      messages.push(createAssistantToolUseMessage(response.text || '', response.toolCalls));
      messages.push(createToolResultMessage(results));

      response = await chatWithTools({
        system: systemPrompt,
        messages,
        tools: AGENT_TOOLS,
      });
    }

    ui.stopSpinner();

    if (response.text) {
      ui.printResponse(response.text);
    }

    //NOTE(self): Owner interaction is always significant
    recordSignificantEvent('owner_interaction');
    addInsight('Owner spoke - what did they need?');
  } catch (error) {
    ui.stopSpinner('Error processing input', false);

    //NOTE(self): Check if this is a fatal error that should stop the agent
    if (isFatalError(error)) {
      ui.error('Fatal API Error', error.message);
      ui.printResponse(`The agent must stop: ${error.message}\n\nPlease check your API configuration and restart.`);
      logger.error('Fatal API error - shutting down', { code: error.code, message: error.message });
      process.exit(1);
    }

    ui.error('API Error', String(error));
    recordFriction('social', 'Failed to process owner input', String(error));
  }
}

//NOTE(self): Legacy export for backward compatibility
//NOTE(self): Just redirects to the scheduler-based loop
export async function runLoop(callbacks?: LoopCallbacks): Promise<void> {
  return runSchedulerLoop(callbacks);
}
