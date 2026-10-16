# ChatGPT Region Cloak

Align browser language and time-zone signals on ChatGPT and OpenAI domains.

## Install or update

Requires Chrome 119 or newer. Open `chrome://extensions`, enable Developer mode,
and use **Load unpacked** to select this directory. For an existing installation,
click **Reload**, then reload your ChatGPT and OpenAI pages. Accept the expanded
OpenAI subdomain and IP-service permissions if Chrome requests them.

## Automatic IP matching

Enable **Automatically match my IP** in the popup. The extension queries
`https://ipwho.is/` immediately, on browser startup, and every 15 minutes while
enabled. **Check IP now** refreshes it after a VPN or proxy change. Country,
language and time zone are selected from the existing supported presets.
Turn automatic matching off to use the manual controls again.

Unsupported locations, timeouts and failed lookups preserve the current settings
and show an error. The extension stores the lookup status, not the IP address.
See [PRIVACY.md](PRIVACY.md) for details. With split proxy routing, the lookup
service and ChatGPT may see different exit IPs.

## Coverage and limits

- Local Date constructors, local date-time string parsing, `Date.parse`, local
  getters/setters and default Intl formatting use the selected time zone.
  ISO date-only strings remain UTC; explicit offsets remain explicit.
- Matching frames, including matching-origin about:blank, srcdoc and blob frames,
  receive the document-start patch. All ChatGPT and OpenAI subdomains match.
  Frames on unrelated third-party origins are outside these permissions.
- Newly created same-origin classic/module Worker and SharedWorker scripts receive
  a settings snapshot. Module imports retain their original URLs. Relative classic
  `importScripts`, fetch, Request and XMLHttpRequest URLs resolve against the
  entry script. Reload pages after changing settings to replace running workers.
- Worker bootstrapping requires the page CSP to allow blob workers. Sites that
  forbid them may reject worker construction. Worker location exposes the wrapper
  URL. Service Workers and workers created before injection are not patched.
  SharedWorker wrapper URLs can prevent sharing across different frames or tabs.
- These JavaScript patches do not change your IP or operating-system time zone,
  and do not guarantee an undetectable browser fingerprint.

## Verification

Run `node --test tests/*.test.cjs` for Date and background/IP regression tests.
Run `node tests/browser-smoke.cjs` for a headless Chrome smoke test; set
`CHROME_PATH` if Chrome is installed outside its standard Windows location.
The smoke test injects the script bundle into local fixtures. Extension
registration and network rules are checked with API mocks.
