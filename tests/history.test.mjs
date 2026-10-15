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
