import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, doc } from './helpers.mjs';

test('the extension loads on x.com and adds the History panel', async () => {
  const { page, close } = await launch({ '/home': doc() });
  try {
    await page.goto('https://x.com/home');
    await page.locator('#x-history .fab').waitFor({ timeout: 5000 });
    assert.equal(await page.locator('#x-history').count(), 1);
  } finally {
    await close();
  }
});
