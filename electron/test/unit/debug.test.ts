import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDevToolsToggleInput,
  shouldAutoOpenDevTools,
} from '../../src/debug.js';

test('AGENT_COMPANY_OPEN_DEVTOOLS 控制启动后自动打开 DevTools', () => {
  assert.equal(shouldAutoOpenDevTools({ AGENT_COMPANY_OPEN_DEVTOOLS: '1' }), true);
  assert.equal(shouldAutoOpenDevTools({ AGENT_COMPANY_OPEN_DEVTOOLS: 'true' }), true);
  assert.equal(shouldAutoOpenDevTools({ AGENT_COMPANY_OPEN_DEVTOOLS: 'TRUE' }), true);
  assert.equal(shouldAutoOpenDevTools({ AGENT_COMPANY_OPEN_DEVTOOLS: 'yes' }), true);

  for (const value of [undefined, null, '', '   ', '__proto__', 'constructor', '0', 'false']) {
    assert.equal(
      shouldAutoOpenDevTools({ AGENT_COMPANY_OPEN_DEVTOOLS: value as string | undefined }),
      false,
    );
  }
});

test('DevTools 快捷键支持 Cmd+Option+I 和 F12', () => {
  assert.equal(isDevToolsToggleInput({ key: 'i', meta: true, alt: true }), true);
  assert.equal(isDevToolsToggleInput({ key: 'I', meta: true, alt: true }), true);
  assert.equal(isDevToolsToggleInput({ key: 'F12' }), true);

  assert.equal(isDevToolsToggleInput({ key: 'i', meta: true }), false);
  assert.equal(isDevToolsToggleInput({ key: 'i', alt: true }), false);
  assert.equal(isDevToolsToggleInput({ key: 'x', meta: true, alt: true }), false);
});
