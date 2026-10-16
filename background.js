const COUNTRIES = Object.freeze({
  US: {locale: "en-US", timeZones: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"]},
  CA: {locale: "en-CA", timeZones: ["America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver"]},
  GB: {locale: "en-GB", timeZones: ["Europe/London"]},
  DE: {locale: "de-DE", timeZones: ["Europe/Berlin"]},
  FR: {locale: "fr-FR", timeZones: ["Europe/Paris"]},
  ES: {locale: "es-ES", timeZones: ["Europe/Madrid"]},
  IT: {locale: "it-IT", timeZones: ["Europe/Rome"]},
  BR: {locale: "pt-BR", timeZones: ["America/Sao_Paulo"]},
  JP: {locale: "ja-JP", timeZones: ["Asia/Tokyo"]},
  KR: {locale: "ko-KR", timeZones: ["Asia/Seoul"]},
  SG: {locale: "en-SG", timeZones: ["Asia/Singapore"]},
  AU: {locale: "en-AU", timeZones: ["Australia/Sydney", "Australia/Adelaide", "Australia/Perth"]},
  HK: {locale: "en-HK", timeZones: ["Asia/Hong_Kong"]},
  IN: {locale: "en-IN", timeZones: ["Asia/Kolkata"]}
});

const SUPPORTED_LOCALES = new Set([
  "en-US", "en-CA", "en-GB", "en-AU", "en-SG", "en-HK", "en-IN",
  "fr-CA", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR", "hi-IN",
  "ja-JP", "ko-KR", "zh-CN", "zh-SG", "zh-HK", "zh-TW"
]);

const SUPPORTED_TIME_ZONES = new Set(
  Object.values(COUNTRIES).flatMap((country) => country.timeZones)
);

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  autoByIp: false,
  country: "US",
  locale: "en-US",
  timeZone: "America/New_York"
});

const LEGACY_ZONES = Object.freeze({
  ET: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles"
});

const MATCHES = Object.freeze([
  "*://chatgpt.com/*",
  "*://*.chatgpt.com/*",
  "*://openai.com/*",
  "*://*.openai.com/*"
]);

const CHATGPT_RESET_ORIGINS = Object.freeze([
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://auth.openai.com",
  "https://auth0.openai.com"
]);

const MAIN_SCRIPT_ID = "chatgpt-region-cloak-main";
const LEGACY_MAIN_SCRIPT_IDS = Object.freeze(["us-region-aligner-main"]);
const NETWORK_RULE_IDS = Object.freeze([1001, 1002]);
const LEGACY_RULE_IDS = Object.freeze([1]);
const IP_ALARM = "region-cloak-ip-refresh";
const IP_REFRESH_MINUTES = 15;
let ipRefreshInFlight = null;
let ipRequestGeneration = 0;

function settingsFromIp(data) {
  if (data?.success !== true) throw new Error("IP location lookup failed");
  const country = data.country_code;
  if (!Object.hasOwn(COUNTRIES, country)) {
    throw new Error("The detected country is not supported; current settings were kept");
  }
  const aliases = {"Asia/Calcutta": "Asia/Kolkata", "US/Eastern": "America/New_York", "US/Pacific": "America/Los_Angeles"};
  const detected = data.timezone?.id;
  const timeZone = aliases[detected] || detected;
  if (!COUNTRIES[country].timeZones.includes(timeZone)) {
    throw new Error("The detected time zone is not supported; current settings were kept");
  }
  return {country, locale: COUNTRIES[country].locale, timeZone};
}

async function refreshIpSettings() {
  if (ipRefreshInFlight) return ipRefreshInFlight;
  ipRefreshInFlight = (async () => {
    const settings = await getSettings();
    if (!settings.autoByIp || !settings.enabled) return settings;
    const generation = ipRequestGeneration;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("https://ipwho.is/", {
        signal: controller.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer"
      });
      if (!response.ok) throw new Error("IP location service is unavailable; current settings were kept");
      const next = settingsFromIp(await response.json());
      const current = await getSettings();
      if (!current.autoByIp || !current.enabled || generation !== ipRequestGeneration) return current;
      await chrome.storage.local.set({
        ...next,
        ipStatus: {ok: true, checkedAt: Date.now(), country: next.country, timeZone: next.timeZone}
      });
      return await scheduleReconcile();
    } catch (error) {
      const current = await getSettings();
      if (current.autoByIp && current.enabled && generation === ipRequestGeneration) {
        const message = error?.name === "AbortError"
          ? "IP lookup timed out; current settings were kept"
          : error instanceof Error ? error.message : "IP lookup failed; current settings were kept";
        await chrome.storage.local.set({ipStatus: {ok: false, checkedAt: Date.now(), error: message}});
      }
      return current;
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => { ipRefreshInFlight = null; });
  return ipRefreshInFlight;
}

async function syncIpMode(force = false) {
  const settings = await getSettings();
  if (!settings.autoByIp || !settings.enabled) {
    await chrome.alarms.clear(IP_ALARM);
    return;
  }
  if (!await chrome.alarms.get(IP_ALARM)) {
    await chrome.alarms.create(IP_ALARM, {periodInMinutes: IP_REFRESH_MINUTES});
  }
  const {ipStatus} = await chrome.storage.local.get("ipStatus");
  if (force || !ipStatus || Date.now() - ipStatus.checkedAt >= IP_REFRESH_MINUTES * 60000) {
    await refreshIpSettings();
  }
}

const LOCALE_FILES = Object.freeze(Object.fromEntries(
  [...SUPPORTED_LOCALES].map((locale) => [locale, `config/locales/${locale.toLowerCase()}.js`])
));

const TIME_ZONE_FILES = Object.freeze(Object.fromEntries(
  [...SUPPORTED_TIME_ZONES].map((timeZone) => [
    timeZone,
    `config/timezones/${timeZone.toLowerCase().replaceAll("/", "-").replaceAll("_", "-")}.js`
  ])
));

const RESOURCE_TYPES = Object.freeze([
  "main_frame",
  "sub_frame",
  "stylesheet",
  "script",
  "image",
  "font",
  "object",
  "xmlhttprequest",
  "ping",
  "media",
  "websocket",
  "other"
]);

function normalizeSettings(value) {
  const country = Object.hasOwn(COUNTRIES, value.country)
    ? value.country
    : DEFAULT_SETTINGS.country;
  const countrySettings = COUNTRIES[country];

  return {
    enabled: value.enabled !== false,
    autoByIp: value.autoByIp === true,
    country,
    locale: SUPPORTED_LOCALES.has(value.locale) ? value.locale : countrySettings.locale,
    timeZone: countrySettings.timeZones.includes(value.timeZone)
      ? value.timeZone
      : countrySettings.timeZones[0]
  };
}

async function getSettings() {
  return normalizeSettings(await chrome.storage.local.get(DEFAULT_SETTINGS));
}

async function ensureDefaults() {
  const stored = await chrome.storage.local.get([
    "enabled", "autoByIp", "country", "locale", "timeZone", "zone"
  ]);
  const patch = {};

  if (typeof stored.enabled !== "boolean") {
    patch.enabled = DEFAULT_SETTINGS.enabled;
  }
  if (typeof stored.autoByIp !== "boolean") patch.autoByIp = false;

  const country = Object.hasOwn(COUNTRIES, stored.country)
    ? stored.country
    : DEFAULT_SETTINGS.country;

  if (!Object.hasOwn(COUNTRIES, stored.country)) {
    patch.country = country;
  }

  if (!SUPPORTED_LOCALES.has(stored.locale)) {
    patch.locale = COUNTRIES[country].locale;
  }

  const legacyTimeZone = LEGACY_ZONES[stored.zone];
  const candidateTimeZone = stored.timeZone || legacyTimeZone;
  if (!COUNTRIES[country].timeZones.includes(candidateTimeZone)) {
    patch.timeZone = COUNTRIES[country].timeZones[0];
  } else if (stored.timeZone !== candidateTimeZone) {
    patch.timeZone = candidateTimeZone;
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

function makeAcceptLanguage(locale) {
  const baseLanguage = locale.split("-")[0];
  if (baseLanguage === locale) return locale;
  if (baseLanguage === "en") return `${locale},en;q=0.9`;
  return `${locale},${baseLanguage};q=0.9,en;q=0.7`;
}

function makeNetworkRules(settings) {
  if (!settings.enabled) return [];

  return [
    {
      id: NETWORK_RULE_IDS[0],
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [
          {
            header: "Accept-Language",
            operation: "set",
            value: makeAcceptLanguage(settings.locale)
          }
        ]
      },
      condition: {
        requestDomains: ["openai.com", "chatgpt.com"],
        resourceTypes: RESOURCE_TYPES
      }
    },
    {
      id: NETWORK_RULE_IDS[1],
      priority: 2,
      action: {
        type: "redirect",
        redirect: {
          regexSubstitution: "https://\\1/\\2"
        }
      },
      condition: {
        regexFilter: "^https?://(chatgpt\\.com|chat\\.openai\\.com|openai\\.com)/zh-Hans-CN/?(.*)$",
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"]
      }
    }
  ];
}

async function updateNetworkRules(settings) {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...LEGACY_RULE_IDS, ...NETWORK_RULE_IDS],
    addRules: makeNetworkRules(settings)
  });
}

async function updateMainWorldRegistration(settings) {
  const registered = await chrome.scripting.getRegisteredContentScripts({
    ids: [MAIN_SCRIPT_ID, ...LEGACY_MAIN_SCRIPT_IDS]
  });
  const current = registered.filter((script) => script.id === MAIN_SCRIPT_ID);
  const legacyIds = registered
    .filter((script) => LEGACY_MAIN_SCRIPT_IDS.includes(script.id))
    .map((script) => script.id);

  if (legacyIds.length > 0) {
    await chrome.scripting.unregisterContentScripts({ids: legacyIds});
  }

  if (!settings.enabled) {
    if (current.length > 0) {
      await chrome.scripting.unregisterContentScripts({ids: [MAIN_SCRIPT_ID]});
    }
    return;
  }

  const registration = {
    id: MAIN_SCRIPT_ID,
    matches: MATCHES,
    js: [
      "config/base.js",
      LOCALE_FILES[settings.locale],
      TIME_ZONE_FILES[settings.timeZone],
      "page.js"
    ],
    runAt: "document_start",
    allFrames: true,
    matchOriginAsFallback: true,
    world: "MAIN",
    persistAcrossSessions: true
  };

  if (current.length > 0) {
    await chrome.scripting.updateContentScripts([registration]);
  } else {
    await chrome.scripting.registerContentScripts([registration]);
  }
}

async function updateOpenTabs(settings) {
  const tabs = await chrome.tabs.query({url: MATCHES});
  const message = {
    type: "US_REGION_ALIGNER_CONFIG",
    config: {
      enabled: settings.enabled,
      locale: settings.locale,
      timeZone: settings.timeZone
    }
  };

  await Promise.allSettled(tabs.map(async (tab) => {
    if (typeof tab.id !== "number") return;

    if (settings.enabled) {
      await chrome.scripting.executeScript({
        target: {tabId: tab.id, allFrames: true},
        files: [
          "config/base.js",
          LOCALE_FILES[settings.locale],
          TIME_ZONE_FILES[settings.timeZone],
          "page.js"
        ],
        world: "MAIN",
        injectImmediately: true
      });
    }

    await chrome.tabs.sendMessage(tab.id, message);
  }));
}

async function resetChatGptSiteData() {
  const tabs = await chrome.tabs.query({
    url: [
      "*://chatgpt.com/*",
      "*://*.chatgpt.com/*",
      "*://chat.openai.com/*"
    ]
  });

  await Promise.allSettled(tabs.map((tab) => {
    if (typeof tab.id !== "number") return undefined;
    return chrome.scripting.executeScript({
      target: {tabId: tab.id},
      world: "MAIN",
      func: () => window.sessionStorage.clear()
    });
  }));

  await chrome.browsingData.remove({
    since: 0,
    origins: CHATGPT_RESET_ORIGINS,
    originTypes: {
      unprotectedWeb: true,
      protectedWeb: true
    }
  }, {
    cache: true,
    cacheStorage: true,
    cookies: true,
    fileSystems: true,
    indexedDB: true,
    localStorage: true,
    serviceWorkers: true,
    webSQL: true
  });

  const reloads = await Promise.allSettled(tabs.map((tab) => {
    if (typeof tab.id !== "number") return undefined;
    return chrome.tabs.reload(tab.id, {bypassCache: true});
  }));

  return {
    tabsReloaded: reloads.filter((result) => result.status === "fulfilled").length
  };
}

async function reconcile() {
  await ensureDefaults();
  const settings = await getSettings();

  await Promise.all([
    updateNetworkRules(settings),
    updateMainWorldRegistration(settings)
  ]);

  await updateOpenTabs(settings);
  return settings;
}

let reconcileQueue = Promise.resolve();

function scheduleReconcile() {
  reconcileQueue = reconcileQueue
    .catch(() => undefined)
    .then(reconcile);

  return reconcileQueue;
}

chrome.runtime.onInstalled.addListener(() => {
  void scheduleReconcile().then(() => syncIpMode(true));
});

chrome.runtime.onStartup.addListener(() => {
  void scheduleReconcile().then(() => syncIpMode(true));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === IP_ALARM) void refreshIpSettings();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.autoByIp || changes.enabled) {
    ipRequestGeneration++;
    void scheduleReconcile().then(() => syncIpMode(true));
    return;
  }
  if (!changes.country && !changes.locale && !changes.timeZone && !changes.zone) return;
  void scheduleReconcile();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Only extension pages can trigger settings changes or destructive resets.
  if (_sender.id !== chrome.runtime.id || _sender.tab) return undefined;
  if (message?.type === "REGION_CLOAK_REFRESH_IP") {
    refreshIpSettings()
      .then(async (settings) => {
        const {ipStatus} = await chrome.storage.local.get("ipStatus");
        sendResponse({ok: true, settings, ipStatus});
      })
      .catch((error) => sendResponse({ok: false, error: String(error)}));
    return true;
  }
  if (message?.type === "US_REGION_ALIGNER_APPLY_NOW") {
    scheduleReconcile()
      .then((settings) => sendResponse({ok: true, settings}))
      .catch((error) => sendResponse({ok: false, error: String(error)}));
    return true;
  }

  if (message?.type === "US_REGION_ALIGNER_RESET_CHATGPT") {
    resetChatGptSiteData()
      .then((result) => sendResponse({ok: true, result}))
      .catch((error) => sendResponse({ok: false, error: String(error)}));
    return true;
  }

  return undefined;
});

void scheduleReconcile().then(() => syncIpMode());
