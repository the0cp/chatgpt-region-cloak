const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const event = () => ({listeners: [], addListener(fn) {this.listeners.push(fn)}});

async function fixture(initial = {}) {
  const stored = {...initial};
  const alarms = new Map();
  const calls = {fetch: [], rules: [], scripts: [], executions: []};
  const chrome = {
    runtime: {id:'test-extension',onInstalled:event(),onStartup:event(),onMessage:event()},
    alarms: {onAlarm:event(),async get(id) {return alarms.get(id)},
      async create(id,value) {alarms.set(id,value)},async clear(id) {return alarms.delete(id)}},
    storage: {onChanged:event(),local: {
      async get(query) {
        if (typeof query === 'string') return {[query]:stored[query]};
        if (Array.isArray(query)) return Object.fromEntries(query.map(key=>[key,stored[key]]));
        return {...query,...stored};
      },
      async set(patch) {Object.assign(stored,patch)}
    }},
    scripting: {
      async getRegisteredContentScripts() {return []},
      async registerContentScripts(value) {calls.scripts.push(...value)},
      async updateContentScripts(value) {calls.scripts.push(...value)},
      async unregisterContentScripts() {},
      async executeScript(value) {calls.executions.push(value)}
    },
    tabs: {async query() {return [{id:1}]},async sendMessage() {},async reload() {}},
    declarativeNetRequest: {async updateDynamicRules(value) {calls.rules.push(value)}},
    browsingData: {async remove() {}}
  };
  let lookup = async () => ({ok:true,json:async()=>({success:true,country_code:'US',timezone:{id:'America/Los_Angeles'}})});
  const context = vm.createContext({chrome,AbortController,setTimeout,clearTimeout,
    fetch: async (...args) => {calls.fetch.push(args);return lookup(...args)}});
  vm.runInContext(source,context);
  await vm.runInContext('scheduleReconcile()',context);
  await new Promise(resolve=>setImmediate(resolve));
  return {stored,alarms,calls,chrome,context,
    lookup(fn) {lookup=fn},run:code=>vm.runInContext(code,context)};
}

test('manual mode has no IP requests; registration covers subdomains and matching frames', async () => {
  const f = await fixture();
  assert.equal(f.calls.fetch.length,0);
  assert.equal(f.alarms.size,0);
  const registration = f.calls.scripts.at(-1);
  assert.equal(registration.allFrames,true);
  assert.equal(registration.matchOriginAsFallback,true);
  assert.ok(registration.matches.includes('*://*.openai.com/*'));
  assert.equal(f.calls.executions.at(-1).target.allFrames,true);
  const rules = f.calls.rules.at(-1).addRules;
  assert.equal(rules[0].action.requestHeaders[0].value,'en-US,en;q=0.9');
  for (const filename of registration.js) assert.ok(fs.existsSync(path.join(__dirname,'..',filename)));
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname,'../manifest.json')));
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.host_permissions.includes('https://ipwho.is/*'));
  assert.equal(manifest.content_scripts[0].all_frames,true);
  assert.equal(manifest.content_scripts[0].match_origin_as_fallback,true);
});

test('IP mode selects exact timezone, persists no IP, schedules and stops checks', async () => {
  const f = await fixture();
  f.stored.autoByIp = true;
  await f.run('syncIpMode(true)');
  assert.equal(f.stored.timeZone,'America/Los_Angeles');
  assert.equal(f.stored.locale,'en-US');
  assert.equal(f.stored.ipStatus.ok,true);
  assert.equal(f.alarms.values().next().value.periodInMinutes,15);
  assert.equal(f.calls.fetch.length,1);
  assert.equal(f.calls.fetch[0][1].credentials,'omit');
  assert.equal(f.calls.fetch[0][1].referrerPolicy,'no-referrer');
  assert.equal('ip' in f.stored,false);
  await f.run('syncIpMode()');
  assert.equal(f.calls.fetch.length,1,'cached status avoids repeated service-worker wakeup requests');
  f.stored.enabled = false;
  await f.run('syncIpMode(true)');
  assert.equal(f.alarms.size,0);
  await f.run('refreshIpSettings()');
  assert.equal(f.calls.fetch.length,1);
});

test('unsupported countries/timezones and network failures keep current settings', async () => {
  const f = await fixture();
  f.stored.autoByIp = true;
  for (const data of [
    {success:true,country_code:'CN',timezone:{id:'Asia/Shanghai'}},
    {success:true,country_code:'US',timezone:{id:'America/Phoenix'}},
    {success:false}, null
  ]) {
    f.lookup(async()=>({ok:true,json:async()=>data}));
    await f.run('refreshIpSettings()');
    assert.equal(f.stored.timeZone,'America/New_York');
    assert.equal(f.stored.ipStatus.ok,false);
  }
  f.lookup(async()=>{throw new Error('offline')});
  await f.run('refreshIpSettings()');
  assert.equal(f.stored.timeZone,'America/New_York');
  assert.match(f.stored.ipStatus.error,/current settings were kept/);
});

test('an in-flight IP request cannot overwrite settings after automatic mode is disabled', async () => {
  const f = await fixture();
  f.stored.autoByIp = true;
  let finish;
  f.lookup(()=>new Promise(resolve=>{finish=resolve}));
  const pending = f.run('refreshIpSettings()');
  await new Promise(resolve=>setImmediate(resolve));
  f.stored.autoByIp = false;
  finish({ok:true,json:async()=>({success:true,country_code:'JP',timezone:{id:'Asia/Tokyo'}})});
  await pending;
  assert.equal(f.stored.country,'US');
  assert.equal(f.stored.timeZone,'America/New_York');
});

test('concurrent IP refreshes share one request and the alarm can refresh again', async () => {
  const f = await fixture();
  f.stored.autoByIp = true;
  await Promise.all([f.run('refreshIpSettings()'),f.run('refreshIpSettings()')]);
  assert.equal(f.calls.fetch.length,1);
  f.chrome.alarms.onAlarm.listeners[0]({name:'region-cloak-ip-refresh'});
  await f.run('refreshIpSettings()');
  assert.equal(f.calls.fetch.length,2);
});
