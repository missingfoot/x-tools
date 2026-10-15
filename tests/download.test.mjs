import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, doc, post, until, fakeFibers } from './helpers.mjs';

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

test('video: saves the highest bitrate MP4 as user_id.mp4', async () => {
  const { page, requests, close } = await launch({ '/home': doc(post({ user: 'bob', id: '20001', video: true })) });
  try {
    await page.goto('https://x.com/home');
    await fakeFibers(page);
    const btn = page.locator('.xdl-btn');
    await btn.waitFor({ timeout: 5000 });
    assert.equal(await clickAndSave(page, btn), 'bob_20001.mp4');
    assert.ok(requests.some((u) => u.endsWith('/1280x720/best.mp4')));
    const title = await until(() => btn.getAttribute('title'), (t) => t.startsWith('Saved'));
    assert.equal(title, 'Saved bob_20001.mp4 (1280x720)');
  } finally {
    await close();
  }
});

test('video with only an HLS playlist goes red with a reason', async () => {
  const hlsOnly = [{ content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x/pl/list.m3u8' }];
  const { page, close } = await launch({ '/home': doc(post({ user: 'bob', id: '20002', video: hlsOnly })) });
  try {
    await page.goto('https://x.com/home');
    await fakeFibers(page);
    const btn = page.locator('.xdl-btn');
    await btn.waitFor({ timeout: 5000 });
    await btn.click();
    assert.equal(await until(() => btn.getAttribute('data-state'), (s) => s === 'error'), 'error');
    const title = await until(() => btn.getAttribute('title'), (t) => t.startsWith('Download failed'));
    assert.equal(title, 'Download failed: Could not find the video file on this page.');
  } finally {
    await close();
  }
});

test('video with no React props at all also goes red', async () => {
  const { page, close } = await launch({ '/home': doc(post({ user: 'bob', id: '20003', video: true })) });
  try {
    await page.goto('https://x.com/home'); // no fakeFibers
    const btn = page.locator('.xdl-btn');
    await btn.waitFor({ timeout: 5000 });
    await btn.click();
    assert.equal(await until(() => btn.getAttribute('data-state'), (s) => s === 'error'), 'error');
  } finally {
    await close();
  }
});

test('quoted video: card is tagged and the file is named after the quoted post', async () => {
  const html = doc(post({ user: 'carol', id: '30001', quote: { user: 'dave', id: '30002', video: true } }));
  const { page, close } = await launch({ '/home': html });
  try {
    await page.goto('https://x.com/home');
    await fakeFibers(page);
    const card = page.locator('div[role="link"]');
    assert.equal(await until(() => card.getAttribute('data-xt-post'), (v) => v === 'dave/30002'), 'dave/30002');
    const btn = page.locator('.xdl-btn');
    await btn.waitFor({ timeout: 5000 });
    assert.equal(await clickAndSave(page, btn), 'dave_30002.mp4');
  } finally {
    await close();
  }
});

test('a recycled quote card is re-tagged', async () => {
  const html = doc(post({ user: 'carol', id: '30003', quote: { user: 'dave', id: '30004', video: true } }));
  const { page, close } = await launch({ '/home': html });
  try {
    await page.goto('https://x.com/home');
    await fakeFibers(page);
    const card = page.locator('div[role="link"]');
    await until(() => card.getAttribute('data-xt-post'), (v) => v === 'dave/30004');
    await page.evaluate(() => {
      document.querySelector('div[role="link"]').__reactFiber$test.return.memoizedProps.tweet = { id_str: '30009', user: { screen_name: 'erin' } };
    });
    assert.equal(await until(() => card.getAttribute('data-xt-post'), (v) => v === 'erin/30009'), 'erin/30009');
  } finally {
    await close();
  }
});

test('photo post quoting a photo: each file is named after its own post', async () => {
  const html = doc(post({ user: 'hal', id: '70001', photos: 1, quote: { user: 'ida', id: '70002', photos: 1 } }));
  const { page, close } = await launch({ '/home': html });
  try {
    await page.goto('https://x.com/home');
    await fakeFibers(page);
    await until(() => page.locator('div[role="link"]').getAttribute('data-xt-post'), (v) => v === 'ida/70002');
    await page.locator('.xdl-btn').nth(1).waitFor({ timeout: 5000 });
    assert.equal(await clickAndSave(page, page.locator('.xdl-btn').nth(0)), 'hal_70001.jpg');
    assert.equal(await clickAndSave(page, page.locator('.xdl-btn').nth(1)), 'ida_70002.jpg');
  } finally {
    await close();
  }
});
