export async function runWithAbiRestore({
  commands,
  restoreCommand,
  runCommand,
  dualFailureMessage,
}) {
  let operationError;
  try {
    for (const command of commands) {
      await runCommand(command);
    }
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await runCommand(restoreCommand);
    } catch (restoreError) {
      if (operationError) {
        throw new AggregateError(
          [operationError, restoreError],
          dualFailureMessage,
          { cause: operationError },
        );
      }
      throw restoreError;
    }
  }
}

function signalExitCode(signal) {
  return signal === 'SIGINT' ? 130 : 143;
}

export async function runAbiRestoreCli({
  execute,
  restoreCommand,
  signalTarget = process,
  spawnCommand,
  reportError = console.error,
  interruptedMessage,
}) {
  let activeChild;
  let receivedSignal;
  let phase = 'operation';

  const handleSignal = (signal) => {
    receivedSignal ??= signal;
    signalTarget.exitCode = signalExitCode(receivedSignal);
    if (phase === 'operation') {
      activeChild?.kill(signal);
    }
  };
  const handleSigint = () => handleSignal('SIGINT');
  const handleSigterm = () => handleSignal('SIGTERM');
  signalTarget.on('SIGINT', handleSigint);
  signalTarget.on('SIGTERM', handleSigterm);

  const runCommand = (command) => new Promise((resolve, reject) => {
    const restoring = command === restoreCommand;
    phase = restoring ? 'restoring' : 'operation';
    if (receivedSignal && !restoring) {
      reject(new Error(interruptedMessage(receivedSignal)));
      return;
    }

    const child = spawnCommand(command);
    activeChild = child;
    child.once('error', (error) => {
      if (activeChild === child) activeChild = undefined;
      reject(error);
    });
    child.once('close', (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        `命令失败: ${command} (${signal ? `signal ${signal}` : `exit ${code}`})`,
      ));
    });
  });

  try {
    await execute(runCommand);
  } catch (error) {
    reportError(error);
    signalTarget.exitCode = receivedSignal
      ? signalExitCode(receivedSignal)
      : 1;
  } finally {
    phase = 'done';
    if (receivedSignal) {
      signalTarget.exitCode = signalExitCode(receivedSignal);
    }
    signalTarget.off('SIGINT', handleSigint);
    signalTarget.off('SIGTERM', handleSigterm);
  }
}
