const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../page.js'), 'utf8');

function realm(timeZone, patched) {
  const context = vm.createContext({navigator: {}, addEventListener() {}});
  if (patched) {
    vm.runInContext(`globalThis[Symbol.for('chatgpt-region-cloak.bootstrap.v3')] =
      {enabled:true,locale:'en-US',timeZone:${JSON.stringify(timeZone)}}`, context);
    vm.runInContext(source, context);
  }
  return (code) => JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context));
}

const scenarios = `(() => {
  const strings = [
    '2026-01-15T12:00:00', '2026-01-15T12:00', '2026-01-15T12:00:00.1234',
    '2026-01-15T24:00:00', '2026-02-30T12:00:00',
    '2026-01-15', '2026-01', '2026', '2026-01-15T12:00:00Z',
    '2026-01-15T12:00:00+08:00', '2026-01-15T12:00:00-0500',
    '01/15/2026 12:00:00', 'January 15, 2026 12:00:00',
    '2026-01-15 12:00 (xyz)', '2026-01-15 12:00 (nested (UTC))',
    'Jan 15 2026 12:00 +05', 'Jan-15-2026', ' 2026-01-15 ', '2026 (comment)',
    'Thu Jan 15 2026 12:00:00 GMT-0500 (Eastern Standard Time)',
    '2026-01-15 12:00:00', '2026-03-08T02:30:00', '2026-11-01T01:30:00',
    '+002026-01-15T12:00:00', '0001-01-15T12:00:00', '-000001-01-15T12:00:00',
    'invalid', '2026-13-15T12:00:00', '2026-01-15T25:00:00'
  ];
  const output = strings.map(value => [value, +new Date(value), Date.parse(value)]);
  for (const args of [[2026,0,15,12],[2026,2,8,2,30],[2026,10,1,1,30],
    [99.9,0,1],[-0.5,0,1],[-1,0,1],[2026,-1,32,25,-4,2,123], [NaN,0]]) {
    output.push(['components', args, +new Date(...args)]);
  }
  for (const stamp of [NaN,0,-1,Date.UTC(2026,2,8,6,30),Date.UTC(2026,10,1,6,30)]) {
    for (const [method,args] of [
      ['setFullYear',[2026]], ['setFullYear',[2026,2,8]], ['setYear',[26.8]],
      ['setMonth',[2,8]], ['setDate',[15]], ['setHours',[2,30]],
      ['setMinutes',[30]], ['setSeconds',[61,123]], ['setMilliseconds',[-1]],
      ['setFullYear',[]], ['setFullYear',[2026,undefined]], ['setHours',[NaN]]
    ]) {
      const date = new Date(stamp);
      const result = date[method](...args);
      output.push([stamp,method,args,result,+date]);
    }
    const d = new Date(stamp);
    output.push(['getters',stamp,d.getFullYear(),d.getMonth(),d.getDate(),d.getDay(),
      d.getHours(),d.getMinutes(),d.getSeconds(),d.getMilliseconds(),d.getTimezoneOffset()]);
  }
  return output;
})()`;

for (const target of ['America/New_York','Europe/London','Australia/Adelaide','Asia/Kolkata']) {
  test(`Date matches native ${target} while host is Shanghai`, () => {
    process.env.TZ = target;
    const expected = realm(target, false)(scenarios);
    process.env.TZ = 'Asia/Shanghai';
    assert.deepEqual(realm(target, true)(scenarios), expected);
  });
}

test('constructor identity, coercion, subclasses, explicit formatting and restoration', () => {
  process.env.TZ = 'Asia/Shanghai';
  const run = realm('America/New_York', true);
  assert.deepEqual(run(`(() => {
    class SubDate extends Date {}
    const copied = new Date(123);
    copied[Symbol.toPrimitive] = () => {throw Error('should not coerce')};
    let hint;
    const converted = new Date({[Symbol.toPrimitive](value) {hint=value;return '2026-01-15T12:00:00'}});
    const errors = [() => Date.parse(Symbol()), () => new Date(1n),
      () => new Date(2026n,0), () => new Date(NaN).setFullYear(1n),
      () => new Date(NaN).setMonth(1n), () => Date.prototype.getHours.call({})]
      .map(fn=>{try {fn();return false}catch(e){return e instanceof TypeError}});
    return [new Date().constructor === Date, new Date() instanceof Date,
      new SubDate().constructor === SubDate, new SubDate() instanceof Date,
      +new Date(copied), hint, converted.toISOString(), errors,
      new Intl.DateTimeFormat().resolvedOptions().timeZone,
      new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Tokyo'}).resolvedOptions().timeZone];
  })()`), [true,true,true,true,123,'default','2026-01-15T17:00:00.000Z',
    [true,true,true,true,true,true],'America/New_York','Asia/Tokyo']);
  assert.deepEqual(run(`(() => {
    globalThis[Symbol.for('chatgpt-region-cloak.state.v3')].apply({enabled:false});
    return [new Date().constructor === Date,new Date('2026-01-15T12:00:00').toISOString(),
      Date.parse('2026-01-15T12:00:00') === Date.UTC(2026,0,15,4)];
  })()`), [true,'2026-01-15T04:00:00.000Z',true]);
});
