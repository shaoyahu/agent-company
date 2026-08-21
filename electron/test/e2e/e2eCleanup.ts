export async function cleanupElectronE2E(options: {
  closeElectron: () => Promise<void>;
  assertPortReleased?: () => Promise<void>;
  removeTestRoot: () => void;
}): Promise<void> {
  const errors: unknown[] = [];

  try {
    await options.closeElectron();
  } catch (error) {
    errors.push(error);
  }
  try {
    await options.assertPortReleased?.();
  } catch (error) {
    errors.push(error);
  }
  try {
    options.removeTestRoot();
  } catch (error) {
    errors.push(error);
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Electron E2E 清理发生多个错误',
      { cause: errors[0] },
    );
  }
}
