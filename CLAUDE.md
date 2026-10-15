# X Tools: project notes

Background for continuing this project in Claude Code. User-facing setup is in `README.md`. The design is in `docs/superpowers/specs/2026-10-15-x-tools-design.md`, the build plan in `docs/superpowers/plans/2026-10-15-x-tools.md`.

## Current state

- Manifest V3 Chrome extension, X Tools 1.0.0, started on 15 October 2026 as a copy of Insta Tools (`~/Projects/insta-tools`) without the native helper, bridge, service worker or popup.
- History logs video posts (videos and GIFs) on Home (`/home`), Bookmarks (`/i/history`), Likes (`/i/history/likes`) and profile Media tabs (`/<user>/media`), including videos in quoted posts.
- Download adds a button to post images (saved with `name=orig`) and videos (highest bitrate MP4 from React props), including media in quoted posts.

## Layout

```
manifest.json           MV3, two content scripts on https://x.com/*
content/history.js      History panel            (world: ISOLATED, chrome.storage.local)
content/download.js     Download buttons         (world: MAIN, reads React fibers)
icons/                  icon.svg (source, X blue) and 16/32/48/128 PNGs rendered with rsvg-convert
tests/                  Playwright + node:test against mock x.com pages, run with npm test
docs/superpowers/       spec and plan
```

The two scripts share one thing through the DOM: download.js tags each quoted post card with `data-xt-post="user/id"` (read from React), and history.js reads it. History cannot see React props from the isolated world, so anything else it needs from React has to be put in the DOM the same way.

## Fixed identifiers

| Thing | Value |
| --- | --- |
| History storage keys | `xHistory.v1.home`, `.bookmarks`, `.likes`, `.profiles`, settings `xHistory.settings`, echo guard `xHistory.writer` |
| Entry format | `[statusId, unixSeconds, user]` |
| History DOM host | `#x-history` (shadow root), fixed at `right: 84px; bottom: 20px` to stay left of X's Grok and Chat buttons |
| Download button class | `xdl-btn` |
| Quote tag | `data-xt-post="user/id"` on quoted cards |
| Load guards | `window.__xHistoryLoaded`, `window.__xDownloadLoaded` |
| Backup | `{app: "x-tools", format: 1, exported, settings, history}` in `x-tools-history-YYYY-MM-DD.json` |

## What was observed on x.com (15 Oct 2026)

- Every post on all four target pages is an `article[data-testid="tweet"]` inside `[data-testid="cellInnerDiv"]`. The post link is the `<a>` wrapping the post's `<time>`: `/<user>/status/<id>` with a 19 digit id.
- `/i/history` is X's Bookmarks page. `/i/history/likes` is the Likes tab next to it. Both are ordinary timelines that scroll the window.
- `/<user>/media` is shown as a "Videos" tab (role `tab`, `aria-selected="true"`), also an ordinary timeline of articles, all by that user.
- A video post contains `[data-testid="videoComponent"]` and a `<video>` whose `src` is a `blob:`. Its poster is also inside `[data-testid="tweetPhoto"]`, so the presence of a photo wrapper does not mean an image.
- Walking up the React fiber from the nearest ancestor that has a `__reactFiber$` key, about 30 levels up, `memoizedProps.source` has `{eventId, contentId, variants, videoId, downloadLink}`. `variants` holds one `application/x-mpegURL` entry and several `video/mp4` entries with `bitrate` (288000, 832000 and 2176000 seen, resolution in the path, up to 1280x720). Files are on `video.twimg.com`.
- `fetch()` of the best MP4 from the page world returned 206 `video/mp4`.
- Images are `pbs.twimg.com/media/...?format=jpg&name=small`. `name=orig` gives the original file. A four photo grid shows images about 145 px tall, hence the 100 px minimum size for buttons.
- Quoted posts sit inside the quoting article as a `div[role="link"]` card. The card has its own `<time>`, but it is not inside an `<a>`, and the card usually has no status link at all. The author is in the card's `[data-testid^="UserAvatar-Container-"]` test id. A quoted video has the same `videoComponent` and `source.variants` as any other video. Walking up the fiber from the card, the first `memoizedProps.tweet` with an `id_str` (about 12 levels) is the quoted post: `tweet.id_str` and `tweet.user.screen_name`. Higher up, `quotingTweet` and another `tweet` are the outer post. A quote can itself contain a `nestedQuotePreview`.

## Tests

`npm test` loads the unpacked extension in Playwright's Chromium (`channel: "chromium"`, headless) and serves mock pages for `https://x.com/...` plus fake `pbs.twimg.com` and `video.twimg.com` responses. `fakeFibers(page)` in `tests/helpers.mjs` attaches React-like props to the mock markup (`data-fake-variants`, `data-fake-tweet`). Mock markup mirrors the observations above; if X changes, update both the constants and the mock builders.

## Gotchas

- Claude in Chrome blocks tool output containing twimg URLs and many x.com paths. Return booleans, counts and lengths when inspecting.
- X recycles timeline cells, so quote tags are re-read on every scan.
- History ignores status pages (`/<user>/status/<id>`), so opening a post from a timeline logs nothing.
- Authors are shared between History tabs (the same post can be in Bookmarks and Likes), so Clear does not remove them.
- From Insta Tools and still true: poll on a timer instead of a MutationObserver, never `innerHTML`, and background tabs pause loading so Auto-scroll needs the tab in front.

## Conventions

Same as Insta Tools: plain JavaScript, no build step, no runtime dependencies (Playwright is for tests only), comments explain why, plain short user-facing text with no em dashes, and every X-specific selector or pattern is a named constant at the top of its file with what was observed.
