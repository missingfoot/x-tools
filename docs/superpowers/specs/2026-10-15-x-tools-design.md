# X Tools: design

Date: 15 October 2026. Status: approved in conversation, awaiting spec review.

## Goal

A Chrome extension for x.com that does what Insta Tools does for Instagram:

- History: a floating panel that logs the video posts you see, per source, grouped by day, so links can be copied later.
- Download: a small button in the top right of post images and videos that saves the full quality file.

Success: on the four pages below, video posts are logged into the right tab, and every post image and video gets a working download button that saves the original image or the highest bitrate MP4.

## Decisions taken

| Question | Decision |
| --- | --- |
| Packaging | Separate extension in `~/Projects/x-tools`, started as a copy of insta-tools so the panel UI carries over. Own git repo. |
| History scope | Video posts only (videos and GIFs). Image-only and text posts are not logged. |
| yt-dlp helper | Not included. The page already exposes complete MP4 files. |
| Images | Download buttons on images as well as videos, same as Insta Tools. |

## What was observed on x.com (15 Oct 2026, logged in, English UI)

- Every post on all four target pages is an `article[data-testid="tweet"]` inside `[data-testid="cellInnerDiv"]`. The post link is the `<a>` wrapping the post's `<time>`: `/<user>/status/<id>` with a 19 digit id.
- `/i/history` is X's Bookmarks page. `/i/history/likes` is the Likes tab next to it. Both are ordinary timelines that scroll the window.
- `/<user>/media` is shown as a "Videos" tab (role `tab`, `aria-selected="true"`), also an ordinary timeline of articles, all by that user.
- A video post contains `[data-testid="videoComponent"]` and a `<video>` whose `src` is a `blob:`. Its poster is also inside `[data-testid="tweetPhoto"]`, so the presence of a photo wrapper does not mean an image.
- Walking up the React fiber from the nearest ancestor that has a `__reactFiber$` key, about 30 levels up, `memoizedProps.source` has `{eventId, contentId, variants, videoId, downloadLink}`. `variants` holds one `application/x-mpegURL` entry and several `video/mp4` entries with `bitrate` (288000, 832000 and 2176000 seen, resolution in the path, up to 1280x720). Files are on `video.twimg.com`.
- `fetch()` of the best MP4 from the page world returned 206 `video/mp4`.
- Images are `pbs.twimg.com/media/...?format=jpg&name=small`. `name=orig` gives the original file.
- Quoted posts sit inside the quoting article as a `div[role="link"]` card. The card has its own `<time>`, but it is not inside an `<a>`, and the card usually has no status link at all. The author is in the card's `[data-testid^="UserAvatar-Container-"]` test id. A quoted video has the same `videoComponent` and `source.variants` as any other video. Walking up the fiber from the card, the first `memoizedProps.tweet` with an `id_str` (about 12 levels) is the quoted post: `tweet.id_str` and `tweet.user.screen_name`. Higher up, `quotingTweet` and another `tweet` are the outer post. A quote can itself contain a `nestedQuotePreview`.
- Claude in Chrome blocks tool output containing these CDN URLs and many paths. Return booleans, counts and lengths when inspecting.

## Architecture

```
x.com page
  content/history.js   (world: ISOLATED)  History panel, chrome.storage.local
  content/download.js  (world: MAIN)      Download buttons, reads React fiber props
```

The two scripts share one thing through the DOM: `download.js` tags every quoted post card it finds with `data-xt-post="<user>/<id>"` (read from fiber props), and `history.js` reads that attribute. That is how History, which cannot see React props from the isolated world, learns a quoted post's id. Otherwise they do not talk to each other. Download runs in the MAIN world because the video variants are only reachable through React fiber objects. It needs no `chrome.*` API, so there is no bridge, no service worker and no native host.

Manifest: MV3, name "X Tools", version 1.0.0, permissions `storage` and `unlimitedStorage`, content scripts on `https://x.com/*`. No `key`, no popup, no background. The toolbar icon has no action. New icon (an X-themed variant of the Insta Tools icon).

Removed from the copy: `native/`, `background.js`, `content/bridge.js`, `popup.*`, the problem list, Instagram-only code (Likes cache key decoding, Saved Clip detection, Reels address bar logic).

Fixed identifiers:

| Thing | Value |
| --- | --- |
| History storage keys | `xHistory.v1.home`, `.bookmarks`, `.likes`, `.profiles`, settings in `xHistory.settings`, writer echo guard in `xHistory.writer` |
| History DOM host | `#x-history` (shadow root) |
| Download button class | `xdl-btn` |
| Load guards | `window.__xHistoryLoaded`, `window.__xDownloadLoaded` |

## History

Same tick loop as Insta Tools: every 400 ms, find the source for the current path, collect the video post ids visible now, log new ones with the current time.

Each article can yield up to two posts:

- The outer post, when it has a `[data-testid="videoComponent"]` or `video` outside any quoted card. Id and author come from its time link.
- The quoted post, when the quoted card contains a video. Id and author come from the card's `data-xt-post` tag. An untagged card (download script not run yet) is retried on the next tick. A nested quote inside a quote is not logged.

So a text post quoting a video logs only the quoted post, and a video post quoting a video logs both. The Home mid-screen rule applies to the article; both posts in it are logged together.

| Source | Test | Collect | Extras |
| --- | --- | --- | --- |
| Home | `/home` | The qualifying article crossing the vertical middle of the window | |
| Bookmarks | `/i/history` | Every qualifying article | auto-scroll |
| Likes | `/i/history/likes` | Every qualifying article | auto-scroll |
| Profiles | `/<user>/media` | Qualifying posts from articles whose outer author equals the user in the address bar (quoted posts are logged under their own author's section) | auto-scroll, `byUser` sections |

`/<user>` is any single path segment that is not a reserved X route (`home`, `i`, `explore`, `notifications`, `messages`, `settings`, `search`, `compose` and similar, kept in a named constant). A post opened at `/<user>/status/<id>` from one of these pages does not log.

Storage: `chrome.storage.local`, one key per source, value is an array of `[id, unixSeconds, user]` in logging order. Copied link: prefix + `https://x.com/<user>/status/<id>`. Displayed link is the plain URL.

Kept unchanged from Insta Tools: panel at bottom right in a shadow root with constructed stylesheets, tabs with plain labels, badge total with per-tab tooltip, day sections, newest first, 5 second yellow highlight, click to copy and middle or ctrl click to open, Settings tab with copy prefix, Export (`{app: "x-tools", format: 1, ...}` to `x-tools-history-YYYY-MM-DD.json`) and merge Import, two-click Clear of the tab in view, `ready` gate before any write, cross-tab sync with the writer echo guard, auto-scroll stopping after 6 idle rounds of 1.2 s.

Dropped: the localStorage migration (no earlier data exists).

The panel position may need adjusting so it does not cover X's Grok and chat buttons at bottom right; checked on the live page.

## Download

A `scan()` every 500 ms removes buttons whose media has gone (X recycles timeline cells) and adds a button to qualifying media. Skipped paths: `/messages`, `/i/chat`.

Qualifying media:

- Image: an `img` on `pbs.twimg.com/media/` inside `[data-testid="tweetPhoto"]`, at least 200 px rendered, with no video in the same frame. Avatars, link cards and emoji do not match.
- Video: a `video` inside `[data-testid="videoComponent"]`, at least 200 px rendered.

Placement reuses Insta Tools' `frameFor()` approach (walk up same-sized wrappers, take the outermost positioned one) and the overlap check that moves the button down when X's own controls are under it. Constants are re-measured on the live page.

Sources:

- Image: same URL with `name=orig` (and the existing `format` kept). Extension from `format`.
- Video: walk up the fiber from the video to the first `memoizedProps.source.variants`, take the `video/mp4` variant with the highest `bitrate`. GIFs use the same path.

Each scan also tags quoted cards (see Architecture) before placing buttons.

File name: `<user>_<id>[_<n>].<ext>`. User and id come from the post that owns the media: the quoted card's tag when the media is inside a quoted card, otherwise the article's time link. `n` is the photo number from the nearest `a[href*="/photo/N"]`, or the position among the article's media for videos in a mixed post. A post with one media item gets no suffix.

Saving: `fetch()` to a blob, then `<a download>` with an object URL. Button states as in Insta Tools: busy while fetching, green when saved with the resolution in the tooltip, red with the reason on failure (no variants found, fetch failed).

## Error handling

- Fiber or variants missing: red button, tooltip "Could not find the video file on this page."
- Fetch failure or non-2xx: red button with status.
- Storage read failure: History logs nothing and never writes (same `ready` rule as Insta Tools).

## Testing

- `tests/` folder with Playwright (Chromium, `--load-extension`) against mock pages served with `context.route`, mirroring the markup above: video detection, Home mid-screen rule, Profiles author filter, quoted posts (tagging, video only in quote, video in both, nested quote ignored, quoted media file names), image `name=orig` rewrite, best variant choice, file names, button placement and removal on recycle.
- Live check on the four pages through Claude in Chrome by injecting both scripts, returning counts and booleans only. No download clicks without the user's go-ahead.
- Not covered: other UI languages, the photo viewer modal at `/<user>/status/<id>/photo/N` (checked live if time allows).

## Out of scope

yt-dlp or HLS downloads, a popup, gallery "download all", dwell time, Windows or other browsers.
