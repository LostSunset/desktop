import { type ElectronApplication } from '@playwright/test';
import electronPath from 'electron';
import { _electron as electron } from 'playwright';

import { TestEnvironment } from './testEnvironment';

// eslint-disable-next-line @typescript-eslint/no-base-to-string
const executablePath = String(electronPath);

// Local testing QoL
async function localTestQoL(app: ElectronApplication) {
  if (process.env.CI) return;

  // Get the first window that the app opens, wait if necessary.
  const window = await app.firstWindow();
  // Direct Electron console to Node terminal.
  window.on('console', console.log);
}

/**
 * Base class for desktop e2e tests.
 */
export class TestApp implements AsyncDisposable {
  /** The test environment. */
  readonly testEnvironment: TestEnvironment = new TestEnvironment();

  /** Remove the install directory when disposed. */
  shouldDisposeTestEnvironment: boolean = false;

  private constructor(readonly app: ElectronApplication) {
    app.once('close', () => (this.#appProcessTerminated = true));
  }

  /** Async static factory */
  static async create() {
    const app = await TestApp.launchElectron();
    return new TestApp(app);
  }

  /** Get the first window that the app opens.  Wait if necessary. */
  async firstWindow() {
    return await this.app.firstWindow();
  }

  /** Executes the Electron app. If not in CI, logs browser console via `console.log()`. */
  protected static async launchElectron() {
    const app = await electron.launch({
      args: ['.'],
      executablePath,
      cwd: '.',
    });
    await localTestQoL(app);
    return app;
  }

  /** Relies on the app exiting on its own. */
  async close() {
    if (this.#appProcessTerminated || this.#closed) return;
    this.#closed = true;

    const windows = this.app.windows();
    if (windows.length === 0) return;

    const close = this.app.waitForEvent('close', { timeout: 60 * 1000 });
    await Promise.all(windows.map((x) => x.close()));
    await close;
  }

  #appProcessTerminated = false;

  /** Ensure close() is called only once. */
  #closed = false;
  /** Ensure the app is disposed only once. */
  #disposed = false;

  /** Dispose: close the app and all disposable objects. */
  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    await this.close();
    if (this.shouldDisposeTestEnvironment) await this.testEnvironment.deleteEverything();
  }
}
