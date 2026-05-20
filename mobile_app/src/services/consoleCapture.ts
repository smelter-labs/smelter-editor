import { useLogStore, type LogLevel } from "../store/logStore";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

const GLOBAL_KEY = "__smelterConsoleCapture__";

type ConsoleSnapshot = Record<ConsoleMethod, (...args: unknown[]) => void>;

function safeStringify(value: unknown, spacing = 0): string {
  const seen = new Set<object>();

  try {
    return JSON.stringify(
      value,
      (_key, currentValue) => {
        if (typeof currentValue === "object" && currentValue !== null) {
          if (seen.has(currentValue)) {
            return "[Circular]";
          }
          seen.add(currentValue);
        }
        if (currentValue instanceof Error) {
          return {
            name: currentValue.name,
            message: currentValue.message,
            stack: currentValue.stack,
          };
        }
        return currentValue;
      },
      spacing,
    );
  } catch {
    return String(value);
  }
}

function formatArg(value: unknown, spacing = 2): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  if (typeof value === "object") {
    return safeStringify(value, spacing);
  }

  return String(value);
}

function formatConsoleMessage(args: unknown[]): string {
  if (args.length === 0) return "";

  const [first, ...rest] = args;
  if (typeof first === "string") {
    let index = 0;
    const message = first.replace(/%[sdifjoO%]/g, (token) => {
      if (token === "%%") return "%";
      const nextArg = rest[index++];
      if (nextArg === undefined) return token;

      switch (token) {
        case "%s":
          return String(nextArg);
        case "%d":
        case "%i":
          return String(parseInt(String(nextArg), 10));
        case "%f":
          return String(parseFloat(String(nextArg)));
        case "%j":
          return safeStringify(nextArg, 0) ?? "undefined";
        case "%o":
        case "%O":
          return formatArg(nextArg);
        default:
          return token;
      }
    });

    const trailing = rest
      .slice(index)
      .map((arg) => formatArg(arg))
      .join(" ");
    return trailing ? `${message} ${trailing}` : message;
  }

  return args.map((arg) => formatArg(arg)).join(" ");
}

function installMethod(
  method: ConsoleMethod,
  original: ConsoleSnapshot[ConsoleMethod],
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    // Defer log update to avoid state mutations during render
    queueMicrotask(() => {
      useLogStore.getState().appendEntry({
        timestamp: Date.now(),
        level: method as LogLevel,
        message: formatConsoleMessage(args),
      });
    });
    original(...args);
  };
}

export function installConsoleCapture(): void {
  const globalObject = globalThis as typeof globalThis & {
    [GLOBAL_KEY]?: ConsoleSnapshot;
  };

  if (globalObject[GLOBAL_KEY]) {
    return;
  }

  const original: ConsoleSnapshot = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  globalObject[GLOBAL_KEY] = original;

  console.log = installMethod("log", original.log);
  console.info = installMethod("info", original.info);
  console.warn = installMethod("warn", original.warn);
  console.error = installMethod("error", original.error);
  console.debug = installMethod("debug", original.debug);
}
