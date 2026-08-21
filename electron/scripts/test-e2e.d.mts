export type E2ECommandRunner = (command: string) => Promise<void>;

export function runElectronE2E(
  runCommand: E2ECommandRunner,
): Promise<void>;

export type E2ECommandChild = {
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal: NodeJS.Signals): boolean;
};

export type E2ESignalTarget = {
  exitCode?: number;
  on(event: NodeJS.Signals, listener: () => void): unknown;
  off(event: NodeJS.Signals, listener: () => void): unknown;
};

export function runElectronE2ECli(options?: {
  signalTarget?: E2ESignalTarget;
  spawnCommand?: (command: string) => E2ECommandChild;
  reportError?: (error: unknown) => void;
}): Promise<void>;
