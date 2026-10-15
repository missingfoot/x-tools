// Test harness: loads the unpacked extension into Chromium and serves mock
// x.com pages that mirror the markup seen on the live site (15 Oct 2026).
import { chromium } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CORS = { 'access-control-allow-origin': '*' };

// pages: { '/path': html }. Can be added to after launch.
export async function launch(pages, { viewport = { width: 1280, height: 800 } } = {}) {
  const profileDir = await mkdtemp(join(tmpdir(), 'x-tools-test-'));
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: true,
    viewport,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
  });
  const requests = [];
  await context.route('https://x.com/**', (route) => {
    const html = pages[new URL(route.request().url()).pathname];
    return route.fulfill(html === undefined
      ? { status: 404, body: '' }
      : { headers: { 'content-type': 'text/html' }, body: html });
  });
  await context.route('https://pbs.twimg.com/**', (route) => {
    requests.push(route.request().url());
    return route.fulfill({ headers: { 'content-type': 'image/jpeg', ...CORS }, body: 'jpeg' });
  });
  await context.route('https://video.twimg.com/**', (route) => {
    requests.push(route.request().url());
    return route.fulfill({ headers: { 'content-type': 'video/mp4', ...CORS }, body: 'mp4' });
  });
  const page = context.pages()[0] || await context.newPage();
  const close = async () => {
    await context.close();
    await rm(profileDir, { recursive: true, force: true });
  };
  return { context, page, requests, close };
}

export const DEFAULT_VARIANTS = [
  { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/1/pu/pl/list.m3u8' },
  { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/640x360/low.mp4' },
  { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/best.mp4' },
  { content_type: 'video/mp4', bitrate: 288000, url: 'https://video.twimg.com/ext_tw_video/1/pu/vid/480x270/lowest.mp4' },
];

// Outer post photos are wrapped in a /photo/N link. Quoted post photos are not.
function photoHtml(user, id, n, link) {
  const img = `<img alt="Image" src="https://pbs.twimg.com/media/P${id}x${n}?format=jpg&amp;name=small" style="position:absolute;inset:0;width:100%;height:100%">`;
  const inner = link ? `<a href="/${user}/status/${id}/photo/${n}" style="position:absolute;inset:0;display:block">${img}</a>` : img;
  return `<div data-testid="tweetPhoto" style="position:relative;width:500px;height:300px">${inner}</div>`;
}

// data-fake-variants is turned into React-like fiber props by fakeFibers().
function videoHtml(variants) {
  return `<div data-testid="videoComponent" data-fake-variants='${JSON.stringify(variants)}' style="position:relative;width:500px;height:280px">`
    + '<video style="display:block;width:500px;height:280px" poster="https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg"></video></div>';
}

function mediaHtml({ user, id, video = false, photos = 0, link = true }) {
  let html = '';
  for (let n = 1; n <= photos; n++) html += photoHtml(user, id, n, link);
  if (video) html += videoHtml(video === true ? DEFAULT_VARIANTS : video);
  return html;
}

// A quoted post: a div[role=link] card with a <time> that is not a link.
function quoteHtml(q) {
  return `<div role="link" data-fake-tweet="${q.user}/${q.id}" style="display:block;width:520px;border:1px solid #888">`
    + `<div data-testid="UserAvatar-Container-${q.user}"></div><time datetime="2026-10-14T10:00:00.000Z">1d</time>`
    + mediaHtml({ ...q, link: false })
    + (q.quote ? quoteHtml(q.quote) : '')
    + '</div>';
}

export function post({ user, id, video = false, photos = 0, quote = null, height = 900 }) {
  return `<article data-testid="tweet" style="display:block;width:600px;height:${height}px;overflow:hidden;margin:0 0 100px">`
    + `<div><a href="/${user}">@${user}</a> <a href="/${user}/status/${id}"><time datetime="2026-10-15T10:00:00.000Z">1h</time></a></div>`
    + mediaHtml({ user, id, video, photos })
    + (quote ? quoteHtml(quote) : '')
    + '</article>';
}

export const doc = (...posts) =>
  `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main>${posts.join('')}</main></body></html>`;

// Mirrors what X keeps on its React fibers: the player's source.variants a few
// levels above the <video>, and the quoted tweet above a quote card (with the
// quoting tweet further up, so nearest-first lookups are exercised).
export async function fakeFibers(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-fake-variants]')) {
      el.__reactFiber$test = { memoizedProps: {}, return: { memoizedProps: { source: { variants: JSON.parse(el.dataset.fakeVariants) } } } };
    }
    for (const el of document.querySelectorAll('[data-fake-tweet]')) {
      const [user, id] = el.dataset.fakeTweet.split('/');
      const outer = el.closest('article').querySelector('a[href*="/status/"]').pathname.split('/');
      el.__reactFiber$test = {
        memoizedProps: { link: {} },
        return: {
          memoizedProps: { tweet: { id_str: id, user: { screen_name: user } } },
          return: { memoizedProps: { tweet: { id_str: outer[3], user: { screen_name: outer[1] } } } },
        },
      };
    }
  });
}

export async function until(fn, ok, { timeout = 5000 } = {}) {
  const end = Date.now() + timeout;
  let value = await fn();
  while (!ok(value) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    value = await fn();
  }
  return value;
}

const historyHost = (page) => page.locator('#x-history');

async function openTab(page, label) {
  const host = historyHost(page);
  if (await host.locator('.panel').isHidden()) await host.locator('.fab').click();
  await host.locator('.tab', { hasText: new RegExp(`^${label}$`) }).click();
  await host.locator('details:not([open]) > summary').evaluateAll((els) => els.forEach((s) => s.click()));
}

// Every link shown on a History tab, with all sections opened.
export async function loggedLinks(page, label) {
  await openTab(page, label);
  return historyHost(page).locator('.item a').allTextContents();
}

export async function sectionLabels(page, label) {
  await openTab(page, label);
  return historyHost(page).locator('summary .label').allTextContents();
}

export async function statusText(page) {
  const host = historyHost(page);
  if (await host.locator('.panel').isHidden()) await host.locator('.fab').click();
  return host.locator('.status').textContent();
}
