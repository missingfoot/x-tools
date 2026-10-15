import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, doc, post, until } from './helpers.mjs';

async function clickAndSave(page, btn) {
  const [dl] = await Promise.all([page.waitForEvent('download'), btn.click()]);
  return dl.suggestedFilename();
}

test('one photo: one button, saves the original size as user_id.jpg', async () => {
  const avatar = '<img src="https://pbs.twimg.com/profile_images/1/a.jpg" style="width:300px;height:300px">';
  const { page, requests, close } = await launch({ '/home': doc(avatar + post({ user: 'alice', id: '10001', photos: 1 })) });
  try {
    await page.goto('https://x.com/home');
    await page.locator('.xdl-btn').first().waitFor({ timeout: 5000 });
    await page.waitForTimeout(700); // another scan, so a stray second button would show
    assert.equal(await page.locator('.xdl-btn').count(), 1);
    assert.equal(await clickAndSave(page, page.locator('.xdl-btn')), 'alice_10001.jpg');
    assert.ok(requests.some((u) => u.includes('/media/P10001x1') && new URL(u).searchParams.get('name') === 'orig'));
  } finally {
    await close();
  }
});

test('several photos are numbered from their /photo/N link', async () => {
  const { page, close } = await launch({ '/home': doc(post({ user: 'alice', id: '10002', photos: 2 })) });
  try {
    await page.goto('https://x.com/home');
    await page.locator('.xdl-btn').nth(1).waitFor({ timeout: 5000 });
    assert.equal(await clickAndSave(page, page.locator('.xdl-btn').nth(0)), 'alice_10002_1.jpg');
    assert.equal(await clickAndSave(page, page.locator('.xdl-btn').nth(1)), 'alice_10002_2.jpg');
  } finally {
    await close();
  }
});

test('no buttons in messages', async () => {
  const { page, close } = await launch({ '/messages': doc(post({ user: 'alice', id: '10003', photos: 1 })) });
  try {
    await page.goto('https://x.com/messages');
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.xdl-btn').count(), 0);
  } finally {
    await close();
  }
});

test('a button goes away when its post is removed', async () => {
  const { page, close } = await launch({ '/home': doc(post({ user: 'alice', id: '10004', photos: 1 })) });
  try {
    await page.goto('https://x.com/home');
    await page.locator('.xdl-btn').waitFor({ timeout: 5000 });
    await page.evaluate(() => document.querySelector('article img').remove());
    const count = await until(() => page.locator('.xdl-btn').count(), (n) => n === 0);
    assert.equal(count, 0);
  } finally {
    await close();
  }
});
