type LogFn = (message: string, ...meta: unknown[]) => void;

function timestamp(): string {
  return new Date().toISOString();
}

function makeLogger(prefix: string): { log: LogFn; error: LogFn } {
  const log: LogFn = (message, ...meta) => {
    console.log(`${timestamp()} ${prefix} ${message}`, ...meta);
  };
  const error: LogFn = (message, ...meta) => {
    console.error(`${timestamp()} ${prefix} ${message}`, ...meta);
  };
  return { log, error };
}

// Never pass API keys or other secrets into these loggers.
export const bflLogger = makeLogger('[BFL]');
export const xaiLogger = makeLogger('[XAI]');
export const serverLogger = makeLogger('[SERVER]');
export const geminiLogger = makeLogger('[GEMINI]');
export const openaiLogger = makeLogger('[OPENAI]');
