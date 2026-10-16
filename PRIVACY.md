# Privacy Policy for ChatGPT Region Cloak

Effective date: October 15, 2026

ChatGPT Region Cloak applies browser language and time-zone settings locally. Optional IP matching contacts a third-party location service as described below. The extension does not collect authentication information, browsing history, website content, chat content, or usage analytics.

## Data stored locally

The extension stores only these preferences in Chrome's local extension storage:

- whether the extension is enabled;
- the selected country or region preset;
- the selected browser language;
- the selected time zone.
- whether automatic IP matching is enabled;
- the last IP lookup time, detected country and time zone, or error status. The IP address and full location response are not stored.

These preferences remain on the user's device until the user changes them, clears extension data, or uninstalls the extension.

## Website access

The extension runs only on the ChatGPT and OpenAI origins declared in its manifest. It changes browser-side language and time-zone signals but does not read page text, prompts, responses, conversations, form contents, cookies, or account details.

## ChatGPT reset

The **Reset ChatGPT** feature runs only after the user opens the extension, chooses the reset action, and confirms it. It instructs Chrome to delete ChatGPT and OpenAI cookies, caches, local site storage, IndexedDB, and service workers used for sign-in. The extension does not inspect or transmit the deleted data. Extension preferences, browsing history, saved passwords, and downloads are not removed.

## Network communication and sharing

Automatic IP matching is off by default. When enabled and the extension is running, it requests `https://ipwho.is/` on browser startup, when enabled, approximately every 15 minutes, and when the user presses **Check IP now**. The service sees the public IP used for that request and returns its estimated country and time zone. Cookies, credentials, page URLs, and page content are not sent. Proxy or VPN routing determines which public IP the service sees; this may differ from the route used for ChatGPT under split routing. Disabling automatic matching or pausing the extension stops future checks.

The service is operated by a third party under its own [privacy policy](https://ipwhois.io/privacy-policy). Lookup failures or unsupported locations keep the existing settings. There is no analytics, advertising, telemetry, remote executable code, or developer-operated data collection server. The extension does not use Google APIs or collect Google user data.

## Policy updates

Material changes will be published at the policy's public URL with an updated effective date and, when required, in the Chrome Web Store listing.

## Contact

Privacy questions can be submitted through the repository's public issue tracker linked from the Chrome Web Store listing.

ChatGPT and OpenAI are trademarks of OpenAI. ChatGPT Region Cloak is an independent project and is not affiliated with, endorsed by, or sponsored by OpenAI.

