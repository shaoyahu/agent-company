import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type DiscoveredCliPreset = 'trae' | 'claude' | 'codex' | 'gemini' | 'opencode' | null;

export interface DiscoveredCli {
  id: string;
  label: string;
  executable: string;
  path: string;
  preset: DiscoveredCliPreset;
}

type CliDefinition = Omit<DiscoveredCli, 'path'>;

const CLI_DEFINITIONS: CliDefinition[] = [
  { id: 'trae-cli', label: 'Trae CLI', executable: 'traecli', preset: 'trae' },
  { id: 'claude-code', label: 'Claude Code', executable: 'claude', preset: 'claude' },
  { id: 'codex-cli', label: 'Codex CLI', executable: 'codex', preset: 'codex' },
  { id: 'gemini-cli', label: 'Gemini CLI', executable: 'gemini', preset: 'gemini' },
  { id: 'opencode', label: 'OpenCode', executable: 'opencode', preset: 'opencode' },
];

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function discoverInstalledClis(options: {
  pathEnv?: string;
  homeDir?: string;
} = {}): DiscoveredCli[] {
  const pathEnv = typeof options.pathEnv === 'string'
    ? options.pathEnv
    : (process.env.PATH ?? '');
  const homeDir = typeof options.homeDir === 'string'
    ? options.homeDir
    : (process.env.HOME ?? '');
  const directories = [
    ...pathEnv.split(delimiter),
    homeDir ? join(homeDir, '.local', 'bin') : '',
    homeDir ? join(homeDir, '.npm-global', 'bin') : '',
    homeDir ? join(homeDir, '.bun', 'bin') : '',
  ].filter((path, index, paths) => path && paths.indexOf(path) === index);

  const found: DiscoveredCli[] = [];
  for (const definition of CLI_DEFINITIONS) {
    const directory = directories.find(candidate =>
      isExecutableFile(join(candidate, definition.executable)));
    if (!directory) continue;
    found.push({
      ...definition,
      path: join(directory, definition.executable),
    });
  }
  return found;
}
