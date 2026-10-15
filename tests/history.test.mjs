import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, doc, post, fakeFibers, until, loggedLinks, sectionLabels, statusText } from './helpers.mjs';

const link = (user, id) => `https://x.com/${user}/status/${id}`;

test('Home logs only the video post crossing the middle of the screen', async () => {
  const html = doc(post({ user: 'amy', id: '40001', video: true }), post({ user: 'ben', id: '40002', video: true }));
  const { page, close } = await launch({ '/home': html });
  try {
    await page.goto('https://x.com/home');
    assert.deepEqual(await until(() => loggedLinks(page, 'Home'), (l) => l.length === 1), [link('amy', '40001')]);
    await page.evaluate(() => scrollTo(0, 1000));
    assert.deepEqual(await until(() => loggedLinks(page, 'Home'), (l) => l.length === 2), [link('ben', '40002'), link('amy', '40001')]);
  } finally {
    await close();
  }
});

test('Bookmarks logs video posts only, not photo or text posts', async () => {
  const html = doc(post({ user: 'amy', id: '41001', photos: 1 }), post({ user: 'ben', id: '41002' }), post({ user: 'cy', id: '41003', video: true }));
  const { page, close } = await launch({ '/i/history': html });
  try {
    await page.goto('https://x.com/i/history');
    await until(() => loggedLinks(page, 'Bookmarks'), (l) => l.length >= 1);
    await page.waitForTimeout(800);
    assert.deepEqual(await loggedLinks(page, 'Bookmarks'), [link('cy', '41003')]);
  } finally {
    await close();
  }
});

test('Likes logs into its own tab', async () => {
  const { page, close } = await launch({ '/i/history/likes': doc(post({ user: 'dee', id: '42001', video: true })) });
  try {
    await page.goto('https://x.com/i/history/likes');
    assert.deepEqual(await until(() => loggedLinks(page, 'Likes'), (l) => l.length === 1), [link('dee', '42001')]);
    assert.deepEqual(await loggedLinks(page, 'Bookmarks'), []);
  } finally {
    await close();
  }
});

test('quoted videos are logged under the quoted post, nested quotes are not', async () => {
  const html = doc(
    post({ user: 'ann', id: '60001', quote: { user: 'bea', id: '60002', video: true } }),
    post({ user: 'cat', id: '60003', video: true, quote: { user: 'dan', id: '60004', video: true } }),
    post({ user: 'eve', id: '60005', quote: { user: 'fay', id: '60006', quote: { user: 'gus', id: '60007', video: true } } }),
  );
  const { page, close } = await launch({ '/i/history': html });
  try {
    await page.goto('https://x.com/i/history');
    await fakeFibers(page);
    await until(() => loggedLinks(page, 'Bookmarks'), (l) => l.length >= 3);
    await page.waitForTimeout(800);
    const links = await loggedLinks(page, 'Bookmarks');
    assert.deepEqual(new Set(links), new Set([link('bea', '60002'), link('cat', '60003'), link('dan', '60004')]));
    assert.equal(links.length, 3);
  } finally {
    await close();
  }
});

test('Profiles: only that user, any letter case, quoted videos under their author', async () => {
  const html = doc(
    post({ user: 'NASA', id: '43001', video: true }),
    post({ user: 'NASA', id: '43002', quote: { user: 'other2', id: '43003', video: true } }),
    post({ user: 'Other', id: '43004', video: true }), // left over from the previous profile
  );
  const { page, close } = await launch({ '/nasa/media': html });
  try {
    await page.goto('https://x.com/nasa/media');
    await fakeFibers(page);
    await until(() => loggedLinks(page, 'Profiles'), (l) => l.length >= 2);
    await page.waitForTimeout(800);
    assert.deepEqual(new Set(await loggedLinks(page, 'Profiles')), new Set([link('NASA', '43001'), link('other2', '43003')]));
    const labels = await sectionLabels(page, 'Profiles');
    assert.equal(labels[0], '@NASA'); // the profile open now goes first
    assert.ok(labels.includes('@other2'));
  } finally {
    await close();
  }
});

test('status pages and reserved routes are not logged', async () => {
  const pages = {
    '/zed/status/44001': doc(post({ user: 'zed', id: '44001', video: true })),
    '/explore/media': doc(post({ user: 'zed', id: '44002', video: true })),
  };
  const { page, close } = await launch(pages);
  try {
    for (const path of Object.keys(pages)) {
      await page.goto(`https://x.com${path}`);
      assert.equal(await until(() => statusText(page), (t) => t === 'Not logging on this page'), 'Not logging on this page');
    }
    await page.waitForTimeout(800);
    for (const tab of ['Home', 'Bookmarks', 'Likes', 'Profiles']) assert.deepEqual(await loggedLinks(page, tab), []);
  } finally {
    await close();
  }
});

test('clearing Likes keeps the same post\'s link intact on Bookmarks', async () => {
  const html = doc(post({ user: 'zed', id: '45001', video: true }));
  const { page, close } = await launch({ '/i/history': html, '/i/history/likes': html, '/home': doc() });
  try {
    await page.goto('https://x.com/i/history');
    await until(() => loggedLinks(page, 'Bookmarks'), (l) => l.length === 1);
    await page.goto('https://x.com/i/history/likes');
    await until(() => loggedLinks(page, 'Likes'), (l) => l.length === 1);
    // Clear from a page that is not logging Likes, or the post is logged again on the next tick.
    await page.goto('https://x.com/home');
    await until(() => loggedLinks(page, 'Likes'), (l) => l.length === 1);
    await page.locator('#x-history button', { hasText: /^Clear$/ }).click();
    await page.locator('#x-history button', { hasText: /^Delete / }).click();
    assert.deepEqual(await until(() => loggedLinks(page, 'Likes'), (l) => l.length === 0), []);
    assert.deepEqual(await loggedLinks(page, 'Bookmarks'), [link('zed', '45001')]);
  } finally {
    await close();
  }
});

test('history survives a reload', async () => {
  const { page, close } = await launch({ '/i/history': doc(post({ user: 'zed', id: '46001', video: true })), '/home': doc() });
  try {
    await page.goto('https://x.com/i/history');
    await until(() => loggedLinks(page, 'Bookmarks'), (l) => l.length === 1);
    await page.goto('https://x.com/home');
    assert.deepEqual(await until(() => loggedLinks(page, 'Bookmarks'), (l) => l.length === 1), [link('zed', '46001')]);
  } finally {
    await close();
  }
});

test('panel is titled X History and sits clear of the bottom right corner', async () => {
  const { page, close } = await launch({ '/home': doc() });
  try {
    await page.goto('https://x.com/home');
    await page.locator('#x-history .fab').click();
    assert.equal(await page.locator('#x-history .title').textContent(), 'X History');
    const style = await page.locator('#x-history').getAttribute('style');
    assert.match(style, /right:\s*84px/);
  } finally {
    await close();
  }
});

test('export writes an X Tools backup and import merges it back', async () => {
  const { page, close } = await launch({ '/i/history': doc(post({ user: 'zed', id: '47001', video: true })), '/home': doc() });
  try {
    await page.goto('https://x.com/i/history');
    await until(() => loggedLinks(page, 'Bookmarks'), (l) => l.length === 1);
    await page.goto('https://x.com/home');
    const host = page.locator('#x-history');
    await host.locator('.fab').click(); // the panel starts closed on a fresh page
    await host.locator('.tab', { hasText: /^Settings$/ }).click();
    const [dl] = await Promise.all([page.waitForEvent('download'), host.locator('button', { hasText: /^Export$/ }).click()]);
    assert.match(dl.suggestedFilename(), /^x-tools-history-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'));
    assert.equal(data.app, 'x-tools');
    assert.equal(data.history.bookmarks[0][0], '47001');
    assert.equal(data.history.bookmarks[0][2], 'zed');

    // Clear Bookmarks, then import the file back.
    await host.locator('.tab', { hasText: /^Bookmarks$/ }).click();
    await host.locator('button', { hasText: /^Clear$/ }).click();
    await host.locator('button', { hasText: /^Delete / }).click();
    await host.locator('.tab', { hasText: /^Settings$/ }).click();
    await host.locator('input[type="file"]').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    assert.equal(await until(() => host.locator('.settings-pane .hint').last().textContent(), (t) => t.startsWith('Imported')), 'Imported 1 new links.');
    assert.deepEqual(await loggedLinks(page, 'Bookmarks'), ['https://x.com/zed/status/47001']);

    const insta = { app: 'insta-tools', format: 1, history: {} };
    await host.locator('.tab', { hasText: /^Settings$/ }).click();
    await host.locator('input[type="file"]').setInputFiles({ name: 'i.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(insta)) });
    assert.equal(await until(() => host.locator('.settings-pane .hint').last().textContent(), (t) => t.startsWith('That file')), 'That file is not an X Tools backup.');
  } finally {
    await close();
  }
});

test('a quote tag left from another post is not logged', async () => {
  // Tagged for a different outer post, and no React props, so download.js cannot re-tag it.
  const html = doc(post({ user: 'zoe', id: '61001', quote: { user: 'old', id: '61002', video: true } }))
    .replace('data-fake-tweet="old/61002"', 'data-xt-post="old/61002" data-xt-for="99999"');
  const { page, close } = await launch({ '/i/history': html });
  try {
    await page.goto('https://x.com/i/history');
    await page.locator('#x-history .fab').waitFor();
    await page.waitForTimeout(1200);
    assert.deepEqual(await loggedLinks(page, 'Bookmarks'), []);
  } finally {
    await close();
  }
});
