import { expect, test as setup } from './testExtensions';

// This "test" is a setup process.  Any failure here should break all post-install tests.
// After running, the test environment will contain an installed ComfyUI app, ready for other tests to use as a base.

setup('Installs the app with default settings', async ({ installWizard, installedApp, serverStart }) => {
  setup.slow();

  await installWizard.clickGetStarted();

  // Select CPU as torch device
  await installWizard.cpuToggle.click();
  await installWizard.clickNext();

  // Install to default location
  await expect(installWizard.installLocationTitle).toBeVisible();
  await installWizard.clickNext();

  await expect(installWizard.migrateTitle).toBeVisible();
  await installWizard.clickNext();

  await expect(installWizard.desktopSettingsTitle).toBeVisible();
  await installWizard.installButton.click();

  const status = await serverStart.status.get();
  expect(['loading', 'setting up python']).toContain(status);

  // When the terminal is hidden and no error is shown, the install is successful
  await expect(serverStart.terminal).not.toBeVisible({ timeout: 5 * 60 * 1000 });
  await expect(serverStart.status.error).not.toBeVisible();
  await expect(serverStart.showTerminalButton).not.toBeVisible();

  await installedApp.waitUntilLoaded();
});
