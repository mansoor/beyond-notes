# Beyond Notes Clipper

A browser extension for Chrome, Edge, Brave and Firefox that saves what you're
reading into your own Beyond Notes:

- **Inbox:** the link, with your selection quoted under it, to sort later.
- **New page:** the article (or just your selection) as Markdown, with its
  images, in the notebook or wiki you pick.
- **Right-click:** "Save page / selection / link to Beyond Notes Inbox" saves
  in one click. The toolbar icon shows ✓ when it worked.
- **Keyboard:** Alt+Shift+S opens the clipper.

The page is converted in your browser, so articles behind a login clip exactly
as you see them. Nothing goes anywhere except your own instance.

## Install

Every [release](https://github.com/mansoor/beyond-notes/releases) has a
`beyond-notes-clipper-<version>.zip`. Until it's in the extension stores:

- **Chrome / Edge / Brave:** unzip it, open `chrome://extensions`, turn on
  Developer mode, choose **Load unpacked** and pick the folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, choose **Load
  Temporary Add-on…** and pick `manifest.json` (it lasts until Firefox
  restarts; a signed build comes with the store listing).

## Connect

1. In Beyond Notes, open **Settings → Integrations → API tokens** and create a
   **read and write** token (for example "Browser clipper").
2. Click the clipper icon, enter your Beyond Notes address and the token, and
   choose **Connect**. The browser asks to let the clipper reach that one
   address. It never asks for access to other sites.

The token is kept in the browser's local extension storage on this device
(never synced). **Disconnect** in the clipper forgets it; revoking the token in
Settings stops it everywhere.

## Privacy

The clipper reads a page only when you click it or use its menu, and sends
the result only to the Beyond Notes address you connected. It has no
analytics and talks to no other server.

## Develop

Plain JavaScript, no build step. `lib.js` holds the API calls and the
page-to-Markdown extractor (`extractForClip`, which runs inside the tab, so it
has to stay self-contained). Load the folder unpacked and reload it after
changes.
