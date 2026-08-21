type Closable = {
  close(): Promise<void>;
};

type MainWindowLike = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  focus(): void;
};

export class ResourceLifecycle<T extends Closable> {
  private startupPromise: Promise<T> | null = null;
  private resource: T | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private shuttingDown = false;

  get current(): T | null {
    return this.resource;
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  get canCreateWindow(): boolean {
    return !this.shuttingDown;
  }

  start(factory: () => Promise<T>): Promise<T> {
    if (this.shuttingDown) {
      return Promise.reject(new Error('应用正在退出，不能启动内置 Server'));
    }
    this.startupPromise ??= Promise.resolve()
      .then(factory)
      .then((resource) => {
        this.resource = resource;
        return resource;
      });
    return this.startupPromise;
  }

  close(): Promise<void> {
    this.shuttingDown = true;
    this.shutdownPromise ??= this.closeStartedResource();
    return this.shutdownPromise;
  }

  private async closeStartedResource(): Promise<void> {
    let resource = this.resource;
    if (!resource && this.startupPromise) {
      try {
        resource = await this.startupPromise;
      } catch {
        return;
      }
    }
    if (!resource) return;

    try {
      await resource.close();
    } finally {
      if (this.resource === resource) {
        this.resource = null;
      }
    }
  }
}

export async function handleSecondInstance(
  ready: Promise<void>,
  getWindow: () => MainWindowLike | null,
  createMainWindow: () => Promise<void>,
): Promise<void> {
  await ready;
  const window = getWindow();
  if (!window || window.isDestroyed()) {
    await createMainWindow();
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.focus();
}
