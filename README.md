# X Tools

A Chrome extension for x.com with two tools:

- **History**: a floating panel that logs the video posts you see, so you can copy their links later. One tab per source: Home, Bookmarks, Likes and Profiles.
- **Download**: a button in the top right of post images and videos. Images are saved at their original size, videos and GIFs as the best MP4 X has for them.

Quoted posts count too: a video in a quoted post is logged and downloaded under the quoted post's own link.

## Install

1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and pick this folder.
3. Open or refresh x.com.

There is nothing else to install.

## Using it

### Download buttons

Hover a post image or video and click the round button in its top right corner.

- Green: saved. The tooltip shows the file name and, for videos, the resolution.
- Red: nothing saved. The tooltip says why.

Files are named `user_postid.ext`, with `_1`, `_2` and so on when a post has several images or videos. Buttons are not added in Messages.

### History

Click History at the bottom right of x.com.

| Tab | Page | What is logged |
| --- | --- | --- |
| Home | x.com/home | The video post in the middle of the screen as you scroll |
| Bookmarks | x.com/i/history | Every video post on the page |
| Likes | x.com/i/history/likes | Every video post on the page |
| Profiles | x.com/user/media | That user's video posts, in a section per user |

Only posts with a video or GIF are logged. Click a link to copy it, middle click to open it. Copy all and the per-section Copy buttons copy every link in view. Auto-scroll scrolls Bookmarks, Likes and Profiles to the end for you. Clear needs a second click and only clears the tab you are looking at.

Settings has a copy prefix (added to the start of every copied link) and Export and Import. History is kept by the extension, so removing the extension deletes it. Export first.

## How it works

- `content/history.js` runs in the extension's own world and keeps History in `chrome.storage.local`.
- `content/download.js` runs in the page's world, because the list of video files is only in X's React data. It also marks quoted posts with their own link so History can log them.

## Limitations

- Tested with the English interface.
- The best MP4 is usually 720p or 1080p. X's HLS stream is not used.
- History only logs while the tab is in view: X pauses loading in background tabs.

## Tests

```
npm install
npx playwright install chromium
npm test
```

## Licence

MIT, see `LICENSE`.
