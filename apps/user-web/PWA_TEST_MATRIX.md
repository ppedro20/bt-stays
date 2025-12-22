# PWA Test Matrix (user-web)

Legend: PASS, FAIL, NOT RUN

## Static checks (local)

| Test | Device/Browser | Status | Notes/Fix |
| --- | --- | --- | --- |
| Manifest linked in `index.html` | Static | PASS | `manifest.json` and meta tags present. |
| Icons exist in `/public/icons` | Static | PASS | Sizes 48-512 + maskable + apple-touch-icon. |
| Offline fallback page exists | Static | PASS | `public/offline.html` present. |

## Installability and UX

| Test | Device/Browser | Status | Notes/Fix |
| --- | --- | --- | --- |
| Lighthouse PWA audit | Desktop Chrome | NOT RUN | Run after deploy with HTTPS. |
| Install prompt | Desktop Chrome | NOT RUN | Verify install banner and icon. |
| Install prompt | Android Chrome | NOT RUN | Verify install banner and icon. |
| Add to Home Screen | iOS Safari | NOT RUN | Verify icon and name. |
| Status bar style | iOS Safari | NOT RUN | Verify status bar appearance. |

## Service worker behavior

| Test | Device/Browser | Status | Notes/Fix |
| --- | --- | --- | --- |
| SW install and activation | Desktop Chrome | NOT RUN | Check Application > Service Workers. |
| Offline load (after first visit) | Desktop Chrome | NOT RUN | App shell loads offline. |
| First load offline fallback | Desktop Chrome | NOT RUN | `offline.html` shown. |
| Update prompt flow | Desktop Chrome | NOT RUN | New build shows update banner. |

## Push notifications

| Test | Device/Browser | Status | Notes/Fix |
| --- | --- | --- | --- |
| Subscribe to push | Desktop Chrome | NOT RUN | "Ativar notificacoes" prompts permission. |
| Receive test push | Desktop Chrome | NOT RUN | Trigger `push_send` function. |
| Unsubscribe flow | Desktop Chrome | NOT RUN | "Desativar notificacoes" disables. |

## Analytics events

| Test | Device/Browser | Status | Notes/Fix |
| --- | --- | --- | --- |
| Install prompt events | Desktop Chrome | NOT RUN | `pwa_event` logs prompt + result. |
| Update events | Desktop Chrome | NOT RUN | `pwa_event` logs update available/applied. |

## Network-dependent flows

| Test | Device/Browser | Status | Notes/Fix |
| --- | --- | --- | --- |
| Validation offline error + retry | Any | NOT RUN | Should show "requires network" + retry. |
| Start purchase offline queue | Any | NOT RUN | Should queue and resume when online. |
| Confirm purchase offline error + retry | Any | NOT RUN | Should show "requires network" + retry. |
| Payment status offline error + retry | Any | NOT RUN | Should show "requires network" + retry. |
| Offline purchase queue | Any | NOT RUN | Queue purchase and resume on reconnect. |

## Performance and throttling

| Test | Device/Browser | Status | Notes/Fix |
| --- | --- | --- | --- |
| Slow 3G throttling | Desktop Chrome | NOT RUN | Confirm UX remains responsive. |
