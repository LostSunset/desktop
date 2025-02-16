import { app, ipcMain } from 'electron';
import { Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@/constants';
import { registerAppHandlers } from '@/handlers/AppHandlers';

vi.mock('electron', () => ({
  app: {
    quit: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));

interface TestCase {
  channel: string;
  expected: any;
  args?: any[];
}
const getHandler = (channel: string) => {
  const [, handlerFn] = (ipcMain.handle as Mock).mock.calls.find(([ch]) => ch === channel) || [];
  return handlerFn;
};

describe('AppHandlers', () => {
  const testCases: TestCase[] = [{ channel: IPC_CHANNELS.QUIT, expected: undefined }];

  beforeEach(() => {
    registerAppHandlers();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('registerHandlers', () => {
    it.each(testCases)('should register handler for $channel', ({ channel }) => {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });

    it.each(testCases)(
      '$channel handler should return mock value ($expected)',
      async ({ channel, expected, args = [] }) => {
        const handlerFn = getHandler(channel);
        const result = await handlerFn(...args);

        expect(result).toEqual(expected);
      }
    );
  });

  it('quit handler should call app.quit', async () => {
    const handlerFn = getHandler(IPC_CHANNELS.QUIT);
    await handlerFn();
    expect(app.quit).toHaveBeenCalled();
  });
});
