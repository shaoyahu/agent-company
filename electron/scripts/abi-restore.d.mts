export type AbiCommandRunner = (command: string) => Promise<void>;

export type AbiCommandChild = {
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal: NodeJS.Signals): boolean;
};

export type AbiSignalTarget = {
  exitCode?: number;
  on(event: NodeJS.Signals, listener: () => void): unknown;
  off(event: NodeJS.Signals, listener: () => void): unknown;
};

export function runWithAbiRestore(options: {
  commands: string[];
  restoreCommand: string;
  runCommand: AbiCommandRunner;
  dualFailureMessage: string;
}): Promise<void>;

export function runAbiRestoreCli(options: {
  execute: (runCommand: AbiCommandRunner) => Promise<void>;
  restoreCommand: string;
  signalTarget?: AbiSignalTarget;
  spawnCommand: (command: string) => AbiCommandChild;
  reportError?: (error: unknown) => void;
  interruptedMessage: (signal: NodeJS.Signals) => string;
}): Promise<void>;
