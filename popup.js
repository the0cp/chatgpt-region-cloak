const COUNTRIES = Object.freeze({
  US: {
    name: "United States",
    locale: "en-US",
    timeZones: [
      ["America/New_York", "Eastern Time"],
      ["America/Chicago", "Central Time"],
      ["America/Denver", "Mountain Time"],
      ["America/Los_Angeles", "Pacific Time"]
    ]
  },
  CA: {
    name: "Canada",
    locale: "en-CA",
    timeZones: [
      ["America/Toronto", "Eastern Time"],
      ["America/Winnipeg", "Central Time"],
      ["America/Edmonton", "Mountain Time"],
      ["America/Vancouver", "Pacific Time"]
    ]
  },
  GB: {name: "United Kingdom", locale: "en-GB", timeZones: [["Europe/London", "London"]]},
  DE: {name: "Germany", locale: "de-DE", timeZones: [["Europe/Berlin", "Berlin"]]},
  FR: {name: "France", locale: "fr-FR", timeZones: [["Europe/Paris", "Paris"]]},
  ES: {name: "Spain", locale: "es-ES", timeZones: [["Europe/Madrid", "Madrid"]]},
  IT: {name: "Italy", locale: "it-IT", timeZones: [["Europe/Rome", "Rome"]]},
  BR: {name: "Brazil", locale: "pt-BR", timeZones: [["America/Sao_Paulo", "São Paulo"]]},
  JP: {name: "Japan", locale: "ja-JP", timeZones: [["Asia/Tokyo", "Tokyo"]]},
  KR: {name: "South Korea", locale: "ko-KR", timeZones: [["Asia/Seoul", "Seoul"]]},
  SG: {name: "Singapore", locale: "en-SG", timeZones: [["Asia/Singapore", "Singapore"]]},
  AU: {
    name: "Australia",
    locale: "en-AU",
    timeZones: [
      ["Australia/Sydney", "Sydney"],
      ["Australia/Adelaide", "Adelaide"],
      ["Australia/Perth", "Perth"]
    ]
  },
  HK: {name: "Hong Kong", locale: "en-HK", timeZones: [["Asia/Hong_Kong", "Hong Kong"]]},
  IN: {name: "India", locale: "en-IN", timeZones: [["Asia/Kolkata", "Kolkata"]]}
});

const LOCALES = Object.freeze({
  "en-US": "English (United States)",
  "en-CA": "English (Canada)",
  "en-GB": "English (United Kingdom)",
  "en-AU": "English (Australia)",
  "en-SG": "English (Singapore)",
  "en-HK": "English (Hong Kong)",
  "en-IN": "English (India)",
  "fr-CA": "French (Canada)",
  "fr-FR": "French (France)",
  "de-DE": "German",
  "es-ES": "Spanish (Spain)",
  "it-IT": "Italian",
  "pt-BR": "Portuguese (Brazil)",
  "hi-IN": "Hindi",
  "ja-JP": "Japanese",
  "ko-KR": "Korean",
  "zh-CN": "Chinese (Simplified)",
  "zh-SG": "Chinese (Singapore)",
  "zh-HK": "Chinese (Hong Kong)",
  "zh-TW": "Chinese (Traditional)"
});

const enabledInput = document.getElementById("enabled");
const autoByIpInput = document.getElementById("auto-by-ip");
const refreshIpButton = document.getElementById("refresh-ip");
const ipStatusDetail = document.getElementById("ip-status");
const countrySelect = document.getElementById("country");
const localeSelect = document.getElementById("locale");
const timeZoneSelect = document.getElementById("time-zone");
const statusCard = document.querySelector(".status-card");
const statusTitle = document.getElementById("status-title");
const statusDetail = document.getElementById("status-detail");
const resetButton = document.getElementById("reset-button");
const resetDialog = document.getElementById("reset-dialog");
const cancelResetButton = document.getElementById("cancel-reset");
const confirmResetButton = document.getElementById("confirm-reset");

let settings = {
  enabled: true,
  autoByIp: false,
  ipStatus: null,
  country: "US",
  locale: "en-US",
  timeZone: "America/New_York"
};
let saveSequence = 0;
let busy = false;
let statusTimer;

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

function populateStaticOptions() {
  for (const [code, country] of Object.entries(COUNTRIES)) {
    countrySelect.append(createOption(code, country.name));
  }

  for (const [locale, label] of Object.entries(LOCALES)) {
    localeSelect.append(createOption(locale, label));
  }
}

function populateTimeZones(countryCode, selectedTimeZone) {
  const country = COUNTRIES[countryCode] || COUNTRIES.US;
  timeZoneSelect.replaceChildren();

  for (const [timeZone, label] of country.timeZones) {
    timeZoneSelect.append(createOption(timeZone, `${label} · ${timeZone}`));
  }

  const allowed = country.timeZones.some(([timeZone]) => timeZone === selectedTimeZone);
  timeZoneSelect.value = allowed ? selectedTimeZone : country.timeZones[0][0];
}

function normalizeSettings(value) {
  const country = Object.hasOwn(COUNTRIES, value.country) ? value.country : "US";
  const countrySettings = COUNTRIES[country];
  const locale = Object.hasOwn(LOCALES, value.locale) ? value.locale : countrySettings.locale;
  const timeZone = countrySettings.timeZones.some(([candidate]) => candidate === value.timeZone)
    ? value.timeZone
    : countrySettings.timeZones[0][0];

  return {
    enabled: value.enabled !== false,
    autoByIp: value.autoByIp === true,
    ipStatus: value.ipStatus || null,
    country,
    locale,
    timeZone
  };
}

function setStatus(state, title, detail) {
  statusCard.classList.toggle("is-off", state === "off");
  statusCard.classList.toggle("is-error", state === "error");
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

function render() {
  if (busy) return;

  settings = normalizeSettings(settings);
  enabledInput.checked = settings.enabled;
  autoByIpInput.checked = settings.autoByIp;
  for (const select of [countrySelect, localeSelect, timeZoneSelect]) select.disabled = settings.autoByIp;
  refreshIpButton.disabled = !settings.autoByIp || !settings.enabled;
  const result = settings.ipStatus;
  ipStatusDetail.textContent = !settings.autoByIp ? "Manual settings" : !settings.enabled ? "IP checks paused" : !result
    ? "Waiting for IP lookup…"
    : result.ok ? `${result.country} · ${result.timeZone} · ${new Date(result.checkedAt).toLocaleTimeString()}`
      : result.error;
  countrySelect.value = settings.country;
  localeSelect.value = settings.locale;
  populateTimeZones(settings.country, settings.timeZone);

  if (settings.enabled) {
    setStatus("running", "Running", `${settings.locale} · ${settings.timeZone}`);
  } else {
    setStatus("off", "Paused", "Browser defaults");
  }
}

function renderError(detail = "Reload extension") {
  setStatus("error", "Error", detail);
}

async function save(patch) {
  const sequence = ++saveSequence;
  settings = normalizeSettings({...settings, ...patch});
  render();

  try {
    await chrome.storage.local.set(patch);
    const response = await chrome.runtime.sendMessage({
      type: "US_REGION_ALIGNER_APPLY_NOW"
    });

    if (sequence === saveSequence && response?.ok === false) {
      renderError("Settings were not applied");
    }
  } catch {
    if (sequence === saveSequence) renderError();
  }
}

async function resetChatGpt() {
  resetDialog.close();
  busy = true;
  resetButton.disabled = true;
  clearTimeout(statusTimer);
  setStatus("running", "Resetting…", "Clearing ChatGPT site data");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "US_REGION_ALIGNER_RESET_CHATGPT"
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Reset failed");
    }

    const count = response.result?.tabsReloaded || 0;
    setStatus(
      "running",
      "Reset complete",
      count === 1 ? "1 ChatGPT tab reloaded" : `${count} ChatGPT tabs reloaded`
    );
  } catch {
    renderError("ChatGPT data was not cleared");
  } finally {
    resetButton.disabled = false;
    statusTimer = setTimeout(() => {
      busy = false;
      render();
    }, 2500);
  }
}

enabledInput.addEventListener("change", () => {
  void save({enabled: enabledInput.checked});
});

autoByIpInput.addEventListener("change", () => {
  void save({autoByIp: autoByIpInput.checked});
});

refreshIpButton.addEventListener("click", async () => {
  refreshIpButton.disabled = true;
  ipStatusDetail.textContent = "Checking IP…";
  try {
    const response = await chrome.runtime.sendMessage({type: "REGION_CLOAK_REFRESH_IP"});
    if (!response?.ok) throw new Error("IP lookup failed");
    settings = normalizeSettings({...settings, ...response.settings, ipStatus: response.ipStatus});
    render();
  } catch {
    ipStatusDetail.textContent = "IP lookup failed; current settings were kept";
  } finally {
    refreshIpButton.disabled = !settings.autoByIp || !settings.enabled;
  }
});

countrySelect.addEventListener("change", () => {
  const country = COUNTRIES[countrySelect.value];
  if (!country) return;
  void save({
    country: countrySelect.value,
    locale: country.locale,
    timeZone: country.timeZones[0][0]
  });
});

localeSelect.addEventListener("change", () => {
  if (Object.hasOwn(LOCALES, localeSelect.value)) {
    void save({locale: localeSelect.value});
  }
});

timeZoneSelect.addEventListener("change", () => {
  const allowed = COUNTRIES[settings.country].timeZones
    .some(([timeZone]) => timeZone === timeZoneSelect.value);
  if (allowed) void save({timeZone: timeZoneSelect.value});
});

resetButton.addEventListener("click", () => {
  resetDialog.showModal();
});

cancelResetButton.addEventListener("click", () => {
  resetDialog.close();
});

confirmResetButton.addEventListener("click", () => {
  void resetChatGpt();
});

resetDialog.addEventListener("click", (event) => {
  if (event.target === resetDialog) resetDialog.close();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  for (const key of ["enabled", "autoByIp", "ipStatus", "country", "locale", "timeZone"]) {
    if (changes[key]) settings[key] = changes[key].newValue;
  }
  render();
});

populateStaticOptions();
chrome.storage.local.get(settings)
  .then((stored) => {
    settings = normalizeSettings(stored);
    render();
  })
  .catch(() => renderError());
