export type PackageCommandRunner = (command: string) => Promise<void>;

export type PackageMacOptions = {
  platform?: string;
  arch?: string;
  nodeVersion?: string;
  runCommand: PackageCommandRunner;
};

export type PackageCommandChild = {
  once(event: 'error', listener: (error: Error) => void): unknown;
  once(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  kill(signal: NodeJS.Signals): boolean;
};

export type PackageSignalTarget = {
  exitCode?: number;
  on(event: NodeJS.Signals, listener: () => void): unknown;
  off(event: NodeJS.Signals, listener: () => void): unknown;
};

export type PackageMacCliOptions = {
  platform?: string;
  arch?: string;
  nodeVersion?: string;
  signalTarget?: PackageSignalTarget;
  spawnCommand?: (command: string) => PackageCommandChild;
  reportError?: (error: unknown) => void;
};

export function packageMac(options: PackageMacOptions): Promise<void>;
export function runPackageMacCli(options?: PackageMacCliOptions): Promise<void>;
