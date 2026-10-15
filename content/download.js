// X Tools: download buttons.
// Adds a download button to the top right corner of post images and videos
// on x.com. Runs in the page's own world, because the video files are only
// listed in X's React objects.
//
// Images are saved at their original size. Videos and GIFs are saved as the
// highest bitrate MP4 X lists for them. Quoted posts are tagged with their own
// user and id (data-xt-post) so files are named after the post that owns the
// media, and so content/history.js can log quoted videos.

(function () {
  'use strict';
  if (window.__xDownloadLoaded) return;
  window.__xDownloadLoaded = true;

  const BUTTON_CLASS = 'xdl-btn';
  // Rendered px. Avatars and link cards are already excluded by the selectors,
  // and a four photo grid shows images only about 145 px tall, so this only drops slivers.
  const MIN_SIZE = 100;
  // Every post on a timeline, a status page, Bookmarks and Likes (seen 15 Oct 2026).
  const ARTICLE_SELECTOR = 'article[data-testid="tweet"]';
  // Post photos. Video previews also sit inside tweetPhoto. Most load from
  // amplify_video_thumb or ext_tw_video_thumb, but some are /media/ images next
  // to the player (NASA's Media tab), so isPoster() drops those.
  const IMAGE_SELECTOR = '[data-testid="tweetPhoto"] img[src^="https://pbs.twimg.com/media/"]';
  // X's player. The <video> inside plays a blob: stream, and on Home its box
  // is about 3 px bigger than the player around it (seen 15 Oct 2026).
  const PLAYER_SELECTOR = '[data-testid="videoComponent"]';
  const VIDEO_SELECTOR = `${PLAYER_SELECTOR} video`;
  const MEDIA_SELECTOR = `${IMAGE_SELECTOR}, ${VIDEO_SELECTOR}`;
  // A quoted post is a clickable card inside the quoting article. It has its
  // own <time>, which is not a link, and usually no link to the post at all.
  const QUOTE_SELECTOR = 'div[role="link"]';
  const POST_TAG_RE = /^([A-Za-z0-9_]{1,15})\/(\d{5,25})$/; // data-xt-post, shared with content/history.js
  // A post's own link is the <a> around its <time>.
  const STATUS_PATH_RE = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/;
  // Photos in a post with several are wrapped in /user/status/id/photo/N links.
  const PHOTO_PATH_RE = /\/photo\/(\d+)\/?$/;
  const SKIP_PATHS = /^\/(messages|i\/chat)(\/|$)/;
  const IMAGE_FORMATS = new Set(['jpg', 'png', 'webp', 'gif']);

  const ARROW = 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19h14';
  const CHECK = 'M5 12.5l4.5 4.5L19 7.5';
  const ICONS = { idle: ARROW, busy: ARROW, done: CHECK, error: 'M6 6l12 12M18 6L6 18' };

  const isVideo = (media) => media.tagName === 'VIDEO';
  const isPoster = (media) => {
    const photo = !isVideo(media) && media.closest('[data-testid="tweetPhoto"]');
    return !!photo && !!photo.querySelector(PLAYER_SELECTOR);
  };

  // ---------- Finding media ----------

  function isPostMedia(media) {
    if (isPoster(media)) return false;
    if (media.offsetWidth < MIN_SIZE || media.offsetHeight < MIN_SIZE) return false;
    return !!media.closest(ARTICLE_SELECTOR);
  }

  // The media is wrapped in a stack of same-sized divs (and, for photos, a
  // link to the photo viewer), with click-catching layers as siblings. The
  // button has to sit above all of them, so take the outermost positioned
  // wrapper that still matches the media's size.
  function frameFor(media) {
    // Measure a video from X's player, not the <video>, which can overhang it by a few px.
    const anchor = (isVideo(media) && media.closest(PLAYER_SELECTOR)) || media;
    const box = anchor.getBoundingClientRect();
    let frame = anchor !== media && getComputedStyle(anchor).position !== 'static' ? anchor : null;
    let node = anchor.parentElement;
    for (let depth = 0; node && depth < 12; depth++, node = node.parentElement) {
      if (node.tagName === 'ARTICLE') break;
      const b = node.getBoundingClientRect();
      if (Math.abs(b.width - box.width) > 2 || Math.abs(b.height - box.height) > 2) break;
      if (getComputedStyle(node).position !== 'static') frame = node;
    }
    // A video carries a poster image in the same frame. The video gets the button, not the poster.
    if (frame && !isVideo(media) && frame.querySelector('video')) return null;
    return frame;
  }

  function mediaIn(frame) {
    const all = [...frame.querySelectorAll(MEDIA_SELECTOR)].filter(isPostMedia);
    return all.find(isVideo) || all[0];
  }

  // Drop the button below any small control of X's that sits in the same corner.
  function place(btn, frame, media) {
    const box = frame.getBoundingClientRect();
    const target = { left: box.right - 44, right: box.right - 12, top: box.top + 12, bottom: box.top + 44 };
    const scope = frame.closest('article') || frame;
    const blocked = [...scope.querySelectorAll('[role="button"], button, a')].some((el) => {
      if (el === btn) return false;
      const r = el.getBoundingClientRect();
      if (!r.width || r.width > 100 || r.height > 100) return false; // skip full-size layers and photo links
      return r.left < target.right && r.right > target.left && r.top < target.bottom && r.bottom > target.top;
    });
    btn.style.top = blocked ? '52px' : '';
    // The tooltip shows what the last download did, until the next one.
    const label = btn.dataset.note || (isVideo(media) ? 'Download video' : 'Download image');
    if (btn.title !== label) {
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }
  }

  function scan() {
    tagQuotes();
    // Timeline cells are recycled as you scroll. Drop buttons whose media has gone.
    for (const btn of document.querySelectorAll(`.${BUTTON_CLASS}`)) {
      const media = mediaIn(btn.parentElement);
      if (media) place(btn, btn.parentElement, media);
      else btn.remove();
    }
    if (SKIP_PATHS.test(location.pathname)) return;
    for (const media of document.querySelectorAll(MEDIA_SELECTOR)) {
      if (!isPostMedia(media)) continue;
      const frame = frameFor(media);
      if (!frame || frame.querySelector(`:scope > .${BUTTON_CLASS}`)) continue;
      const btn = makeButton();
      frame.append(btn);
      place(btn, frame, media);
    }
  }

  // ---------- Sources ----------

  // X serves a smaller rendition by default. name=orig is the uploaded file.
  function imageSource(img) {
    const url = new URL(img.currentSrc || img.src);
    url.searchParams.set('name', 'orig');
    return url.href;
  }

  // React keeps its fiber on some elements only, so start from the nearest one that has it.
  function fiberOf(node) {
    for (; node && node !== document.body; node = node.parentElement) {
      const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$'));
      if (key) return node[key];
    }
    return null;
  }

  // The player's props, about 30 levels up from the <video>, list the files X
  // has for it: an HLS playlist and complete MP4s (picture and sound) with
  // their bitrates. The highest bitrate MP4 is the best single file.
  function videoSource(video) {
    let fiber = fiberOf(video);
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      const source = fiber.memoizedProps && fiber.memoizedProps.source;
      if (!source || !Array.isArray(source.variants)) continue;
      const mp4s = source.variants.filter((v) => v && v.content_type === 'video/mp4' && (v.src || v.url));
      mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      return mp4s.length ? mp4s[0].src || mp4s[0].url : null;
    }
    return null;
  }

  // ---------- Quoted posts ----------

  // Walking up from a quote card, the first props with a tweet (about 12
  // levels) are the quoted post. The quoting post's tweet is further up.
  function quotedTweetOf(card) {
    let fiber = fiberOf(card);
    for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
      const t = fiber.memoizedProps && fiber.memoizedProps.tweet;
      if (t && typeof t.id_str === 'string' && t.user && typeof t.user.screen_name === 'string') {
        const tag = `${t.user.screen_name}/${t.id_str}`;
        return POST_TAG_RE.test(tag) ? tag : null;
      }
    }
    return null;
  }

  // Re-read on every scan: X recycles timeline cells, so a card can change post.
  // data-xt-for records the quoting post, so a tag left over from another
  // post is never trusted, even before this scan gets to it.
  function tagQuotes() {
    for (const article of document.querySelectorAll(ARTICLE_SELECTOR)) {
      const own = ownPostOf(article);
      for (const card of article.querySelectorAll(QUOTE_SELECTOR)) {
        if (!card.querySelector('time')) continue;
        const tag = quotedTweetOf(card);
        if (!tag || !own || tag === `${own.user}/${own.id}`) {
          delete card.dataset.xtPost;
          delete card.dataset.xtFor;
          continue;
        }
        if (card.dataset.xtPost !== tag) card.dataset.xtPost = tag;
        if (card.dataset.xtFor !== own.id) card.dataset.xtFor = own.id;
      }
    }
  }

  function quoteTagOf(card) {
    const article = card.closest(ARTICLE_SELECTOR);
    const own = article && ownPostOf(article);
    return own && card.dataset.xtFor === own.id ? POST_TAG_RE.exec(card.dataset.xtPost || '') : null;
  }

  // ---------- File name ----------

  function ownPostOf(article) {
    for (const time of article.querySelectorAll('time')) {
      const a = time.closest('a');
      const m = a && article.contains(a) && STATUS_PATH_RE.exec(a.pathname);
      if (m) return { user: m[1], id: m[2] };
    }
    return null;
  }

  // The innermost quote card around the media, if any.
  function quoteCardOf(media) {
    for (let card = media.closest(QUOTE_SELECTOR); card; card = card.parentElement && card.parentElement.closest(QUOTE_SELECTOR)) {
      if (card.querySelector('time') && card.closest(ARTICLE_SELECTOR)) return card;
    }
    return null;
  }

  // The element whose post owns this media: a quote card or the article.
  function ownerRoot(media) {
    return quoteCardOf(media) || media.closest(ARTICLE_SELECTOR);
  }

  function postOf(media) {
    const root = ownerRoot(media);
    if (root && root.matches(QUOTE_SELECTOR)) {
      const m = quoteTagOf(root);
      return m ? { user: m[1], id: m[2], root } : null;
    }
    const own = root && ownPostOf(root);
    if (own) return { ...own, root };
    // A status page shows the post in the address bar.
    const m = STATUS_PATH_RE.exec(location.pathname);
    return m ? { user: m[1], id: m[2], root: root || document.body } : null;
  }

  // 0 means no number: the post has only one media item.
  function indexOf(media, post) {
    const all = [...post.root.querySelectorAll(MEDIA_SELECTOR)].filter((m) => ownerRoot(m) === post.root && !isPoster(m));
    if (all.length < 2) return 0;
    const link = media.closest('a');
    const photo = link && PHOTO_PATH_RE.exec(link.pathname);
    return photo ? Number(photo[1]) : all.indexOf(media) + 1;
  }

  function extensionOf(url) {
    const u = new URL(url);
    const format = u.searchParams.get('format');
    if (IMAGE_FORMATS.has(format)) return format;
    return (/\.([a-z0-9]{3,4})$/i.exec(u.pathname) || [])[1] || 'jpg';
  }

  function fileName(media, url) {
    const post = postOf(media);
    const n = post ? indexOf(media, post) : 0;
    const base = post ? `${post.user}_${post.id}` : `x_${Date.now()}`;
    return `${base}${n ? `_${n}` : ''}.${extensionOf(url)}`;
  }

  // ---------- Downloading ----------

  // Returns the note for the button's tooltip.
  async function download(media) {
    const url = isVideo(media) ? videoSource(media) : imageSource(media);
    if (!url) throw new Error('Could not find the video file on this page.');
    // The CDN is a different origin, so a plain download link would just open
    // the file. Fetch it and save the bytes from a blob instead.
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const name = fileName(media, url);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 30000);
    const size = (/\/(\d+x\d+)\//.exec(new URL(url).pathname) || [])[1];
    return `Saved ${name}${size ? ` (${size})` : ''}`;
  }

  // ---------- Button ----------

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    .${BUTTON_CLASS} { position: absolute; top: 12px; right: 12px; z-index: 10; width: 32px; height: 32px; padding: 0;
      border: 0; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff; cursor: pointer; opacity: .8;
      display: flex; align-items: center; justify-content: center; transition: opacity .15s, background .15s; }
    .${BUTTON_CLASS}:hover { opacity: 1; background: rgba(0, 0, 0, .8); }
    .${BUTTON_CLASS} svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2;
      stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .${BUTTON_CLASS}[data-state="busy"] { cursor: progress; opacity: 1; }
    .${BUTTON_CLASS}[data-state="busy"] svg { animation: xdl-bob .5s ease-in-out infinite alternate; }
    .${BUTTON_CLASS}[data-state="done"] { background: #1f9d55; opacity: 1; }
    .${BUTTON_CLASS}[data-state="error"] { background: #d93025; opacity: 1; }
    @keyframes xdl-bob { from { transform: translateY(-2px); } to { transform: translateY(2px); } }
  `);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

  function setState(btn, state) {
    btn.dataset.state = state;
    btn.querySelector('path').setAttribute('d', ICONS[state]);
  }

  function makeButton() {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.append(document.createElementNS(svgNs, 'path'));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BUTTON_CLASS;
    btn.append(svg);
    setState(btn, 'idle');

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.state === 'busy') return;
      const media = mediaIn(btn.parentElement);
      if (!media) return;
      setState(btn, 'busy');
      btn.dataset.note = 'Downloading...';
      // Red stays a little longer so the tooltip can be read.
      let hold = 1500;
      try {
        btn.dataset.note = await download(media);
        setState(btn, 'done');
      } catch (err) {
        console.error('[X Tools]', err);
        setState(btn, 'error');
        btn.dataset.note = `Download failed: ${err.message}`;
        hold = 4000;
      }
      setTimeout(() => setState(btn, 'idle'), hold);
    });
    // Keep X from treating a press on the button as opening the photo, a like or a pause.
    for (const type of ['dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart']) {
      btn.addEventListener(type, (e) => e.stopPropagation());
    }
    return btn;
  }

  // ---------- Start ----------

  scan();
  setInterval(scan, 500);
})();
