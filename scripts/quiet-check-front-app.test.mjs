import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTestApp } from './quiet-check-front-app.mjs';

test('the owner’s installed Drashti in front is not a test takeover', () => {
  assert.equal(isTestApp({ name: 'Drashti', id: 'org.drashti.app' }), false);
});

test('the test Electron in front is a takeover', () => {
  assert.equal(isTestApp({ name: 'Electron', id: 'com.github.Electron' }), true);
});

test('the test app renamed Drashti in front is still a takeover', () => {
  assert.equal(isTestApp({ name: 'Drashti', id: 'com.github.Electron' }), true);
});

test('another Electron-based app in front is not the test app', () => {
  assert.equal(isTestApp({ name: 'Electron editor', id: 'com.example.editor' }), false);
});

test('no front app is not a takeover', () => {
  assert.equal(isTestApp(null), false);
});
