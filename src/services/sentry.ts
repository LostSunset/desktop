import * as Sentry from '@sentry/electron/main';
import { app, dialog } from 'electron';

import { SENTRY_URL_ENDPOINT } from '../constants';
import { ComfyDesktopApp } from '../main-process/comfyDesktopApp';
import { getTelemetry } from './telemetry';

const createSentryUrl = (eventId: string) => `https://comfy-org.sentry.io/projects/4508007940685824/events/${eventId}/`;

const queueMixPanelEvents = (event: Sentry.Event) => {
  const mixpanel = getTelemetry();

  while (mixpanel.hasPendingSentryEvents()) {
    const { eventName, properties } = mixpanel.popSentryEvent()!;
    mixpanel.track(eventName, {
      sentry_url: createSentryUrl(event.event_id!),
      ...properties,
    });
  }
};

class SentryLogging {
  comfyDesktopApp: ComfyDesktopApp | undefined;

  init() {
    Sentry.init({
      dsn: SENTRY_URL_ENDPOINT,
      autoSessionTracking: false,
      enabled: process.env.SENTRY_ENABLED === 'true' || app.isPackaged,
      normalizeDepth: 4,
      beforeSend: async (event) => {
        this.filterEvent(event);

        if (this.comfyDesktopApp?.comfySettings.get('Comfy-Desktop.SendStatistics')) {
          queueMixPanelEvents(event);
          return event;
        }

        getTelemetry().clearSentryQueue();

        const errorMessage = event.exception?.values?.[0]?.value || 'Unknown error';
        const errorType = event.exception?.values?.[0]?.type || 'Error';

        const { response } = await dialog.showMessageBox({
          title: 'Send Crash Report',
          message: `An error occurred: ${errorType}`,
          detail: `${errorMessage}\n\nWould you like to send the crash to the team?`,
          buttons: ['Send Report', 'Do not send crash report'],
          type: 'error',
        });

        return response === 0 ? event : null;
      },
      integrations: [
        Sentry.childProcessIntegration({
          breadcrumbs: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
          events: ['abnormal-exit', 'killed', 'crashed', 'launch-failed', 'oom', 'integrity-failure'],
        }),
      ],
    });
  }

  private filterEvent(obj: unknown) {
    if (!obj || !this.comfyDesktopApp?.basePath) return obj;

    if (typeof obj === 'string') {
      return obj.replaceAll(this.comfyDesktopApp.basePath, '[basePath]');
    }

    try {
      if (typeof obj === 'object') {
        for (const k in obj) {
          try {
            const record = obj as Record<string, unknown>;
            record[k] = this.filterEvent(record[k]);
          } catch {
            // Failed to read/write key
          }
        }
      }
    } catch {
      // Failed to enumerate keys
    }

    return obj;
  }
}

export default new SentryLogging();
