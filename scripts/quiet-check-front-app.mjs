/** Whether the app in front belongs to the Electron end-to-end test run. */
export function isTestApp(app) {
  return app !== null && app.id === 'com.github.Electron';
}
