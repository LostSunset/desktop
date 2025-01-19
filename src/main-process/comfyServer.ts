import { app } from 'electron';
import log from 'electron-log/main';
import { ChildProcess } from 'node:child_process';
import path from 'node:path';
import waitOn from 'wait-on';

import { ComfyServerConfig } from '../config/comfyServerConfig';
import { IPC_CHANNELS, ServerArgs } from '../constants';
import { getAppResourcesPath } from '../install/resourcePaths';
import { HasTelemetry, ITelemetry, trackEvent } from '../services/telemetry';
import { ansiCodes, rotateLogFiles } from '../utils';
import { VirtualEnvironment } from '../virtualEnvironment';
import { AppWindow } from './appWindow';

export class ComfyServer implements HasTelemetry {
  /**
   * The maximum amount of time to wait for the server to start.
   * Installing custom nodes dependencies like ffmpeg can take a long time,
   * so we need to give it a long timeout.
   */
  public static readonly MAX_FAIL_WAIT = 30 * 60 * 1000; // 30 minutes

  /**
   * The interval to check if the server is ready.
   */
  public static readonly CHECK_INTERVAL = 1000; // Check every second

  private comfyServerProcess: ChildProcess | null = null;

  constructor(
    public basePath: string,
    public serverArgs: ServerArgs,
    public virtualEnvironment: VirtualEnvironment,
    public appWindow: AppWindow,
    readonly telemetry: ITelemetry
  ) {}

  get baseUrl() {
    return `http://${this.serverArgs.host}:${this.serverArgs.port}`;
  }

  /**
   * The path to the ComfyUI main python script.
   */
  get mainScriptPath() {
    return path.join(getAppResourcesPath(), 'ComfyUI', 'main.py');
  }

  /**
   * The path to the ComfyUI web root. This directory should host compiled
   * ComfyUI web assets.
   */
  get webRootPath() {
    return path.join(getAppResourcesPath(), 'ComfyUI', 'web_custom_versions', 'desktop_app');
  }

  get userDirectoryPath() {
    return path.join(this.basePath, 'user');
  }

  get inputDirectoryPath() {
    return path.join(this.basePath, 'input');
  }

  get outputDirectoryPath() {
    return path.join(this.basePath, 'output');
  }

  /**
   * Core arguments to pass to the ComfyUI server to ensure electron app
   * works as expected.
   */
  get coreLaunchArgs() {
    return {
      'user-directory': this.userDirectoryPath,
      'input-directory': this.inputDirectoryPath,
      'output-directory': this.outputDirectoryPath,
      'front-end-root': this.webRootPath,
      'extra-model-paths-config': ComfyServerConfig.configPath,
      port: this.serverArgs.port.toString(),
      listen: this.serverArgs.host,
    };
  }

  static buildLaunchArgs(mainScriptPath: string, args: Record<string, string>) {
    return [
      mainScriptPath,
      ...Object.entries(args)
        .flatMap(([key, value]) => [`--${key}`, value])
        // Empty string values are ignored. e.g. { cpu: '' } => '--cpu'
        .filter((value: string) => value !== ''),
    ];
  }

  get launchArgs() {
    return ComfyServer.buildLaunchArgs(this.mainScriptPath, {
      ...this.coreLaunchArgs,
      ...this.serverArgs.extraServerArgs,
    });
  }

  @trackEvent('comfyui:server_start')
  async start() {
    await rotateLogFiles(app.getPath('logs'), 'comfyui', 50);
    return new Promise<void>((resolve, reject) => {
      const comfyUILog = log.create({ logId: 'comfyui' });
      comfyUILog.transports.file.fileName = 'comfyui.log';

      // TODO: Check if electron-log has updated types
      // @ts-expect-error electron-log types are broken.  data and return type are `string`.
      comfyUILog.transports.file.transforms.push(({ data }) => {
        return typeof data === 'string' ? (data as string).replaceAll(ansiCodes, '') : data;
      });

      const comfyServerProcess = this.virtualEnvironment.runPythonCommand(this.launchArgs, {
        onStdout: (data) => {
          comfyUILog.info(data);
          this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
        },
        onStderr: (data) => {
          comfyUILog.error(data);
          this.appWindow.send(IPC_CHANNELS.LOG_MESSAGE, data);
        },
      });

      comfyServerProcess.on('error', (err) => {
        log.error(`Failed to start ComfyUI: ${err}`);
        reject(err);
      });

      comfyServerProcess.on('exit', (code, signal) => {
        if (code !== 0) {
          log.error(`Python process exited with code ${code} and signal ${signal}`);
          reject(new Error(`Python process exited with code ${code} and signal ${signal}`));
        } else {
          log.info(`Python process exited successfully with code ${code}`);
          resolve();
        }
      });

      this.comfyServerProcess = comfyServerProcess;

      waitOn({
        resources: [`${this.baseUrl}/queue`],
        timeout: ComfyServer.MAX_FAIL_WAIT,
        interval: ComfyServer.CHECK_INTERVAL,
      })
        .then(() => {
          log.info('Python server is ready');
          resolve();
        })
        .catch((error) => {
          log.error('Server failed to start:', error);
          reject(new Error('Python Server Failed To Start Within Timeout.'));
        });
    });
  }

  async kill() {
    return new Promise<void>((resolve, reject) => {
      if (!this.comfyServerProcess) {
        log.info('No python server process to kill');
        resolve();
        return;
      }

      log.info('Killing ComfyUI python server.');
      // Set up a timeout in case the process doesn't exit
      const timeout = setTimeout(() => {
        reject(new Error('Timeout: Python server did not exit within 10 seconds'));
      }, 10_000);

      // Listen for the 'exit' event
      this.comfyServerProcess.once('exit', (code, signal) => {
        clearTimeout(timeout);
        log.info(`Python server exited with code ${code} and signal ${signal}`);
        this.comfyServerProcess = null;
        resolve();
      });

      // Attempt to kill the process
      const result = this.comfyServerProcess.kill();
      if (!result) {
        clearTimeout(timeout);
        reject(new Error('Failed to initiate kill signal for python server'));
      }
    });
  }
}
