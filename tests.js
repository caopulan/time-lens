const assert=require('node:assert/strict');
const {parse,formatOffset}=require('./parser');
const target='Asia/Shanghai';
let count=0;
function test(name,fn){try{fn();count++;}catch(e){console.error('FAIL: '+name);throw e;}}
function ok(s,opt={}){const r=parse(s,{localZone:target,...opt});assert.equal(r.status,'ok',s+': '+JSON.stringify(r));return r;}
function iso(r){return new Date(r.epoch).toISOString();}
const anchor=Date.parse('2026-10-23T04:47:00Z');
test('Screenshot regression: Oct is October, PDT is UTC−7',()=>{
  const r=ok('USA (PDT) Before 10:00 AM, Oct 23',{anchorEpoch:anchor});
  assert.equal(r.sourceDate,'2026-10-23 10:00:00');
  assert.equal(iso(r),'2026-10-23T17:00:00.000Z');
  assert.deepEqual(r.sourceDisplay,{weekday:'周五',date:'10月23日',time:'10:00',zoneName:'PDT',utcOffset:'UTC-7'});
  assert.deepEqual(r.localDisplay,{weekday:'周六',date:'10月24日',time:'01:00',zoneName:'Asia/Shanghai',utcOffset:'UTC+8'});
});
for(const [minutes,expected] of [[0,'UTC'],[-0,'UTC'],[480,'UTC+8'],[-420,'UTC-7'],[330,'UTC+5:30'],[-210,'UTC-3:30'],[345,'UTC+5:45'],[-765,'UTC-12:45'],[330.25,'UTC+5:30:15'],[-210.5,'UTC-3:30:30'],[0.5,'UTC+0:00:30'],[-0.5,'UTC-0:00:30']])test('Compact UTC formatting: '+minutes+' minutes',()=>assert.equal(formatOffset(minutes),expected));
for(const [offset,expected] of [['UTC+08:00','UTC+8'],['UTC-07:00','UTC-7'],['UTC+05:30','UTC+5:30'],['UTC-03:30','UTC-3:30'],['UTC+05:45','UTC+5:45'],['UTC-12:45','UTC-12:45'],['UTC+00:00','UTC']])test('Parsed offset uses compact display: '+offset,()=>assert.equal(ok('2026-10-23 10am '+offset).sourceDisplay.utcOffset,expected));
for(const [i,weekday] of ['周一','周二','周三','周四','周五','周六','周日'].entries())test('Weekday maps civil date correctly: '+weekday,()=>{
  const r=ok('2026-10-'+(19+i)+' 10am UTC',{localZone:'UTC'});
  assert.equal(r.sourceDisplay.weekday,weekday);assert.equal(r.localDisplay.weekday,weekday);
  assert.ok(!Object.hasOwn(r.sourceDisplay,'year'));assert.ok(!Object.hasOwn(r.localDisplay,'year'));
});
test('Weekday rolls forward across a year boundary',()=>{
  const r=ok('2026-12-31 23:30 UTC');
  assert.equal(r.sourceDisplay.weekday,'周四');assert.equal(r.localDisplay.weekday,'周五');
  assert.equal(r.sourceDate,'2026-12-31 23:30:00');assert.equal(r.localDisplay.date,'1月1日');
});
test('Weekday rolls backward across a year boundary',()=>{
  const r=ok('2027-01-01 00:30 UTC',{localZone:'America/Los_Angeles'});
  assert.equal(r.sourceDisplay.weekday,'周五');assert.equal(r.localDisplay.weekday,'周四');
  assert.equal(r.localDisplay.date,'12月31日');assert.equal(r.localDisplay.time,'16:30');
});
test('Time-only converts without fabricating a publication-day date',()=>{
  const r=ok('10am PST',{anchorEpoch:anchor,nowEpoch:Date.parse('2027-01-01T12:00:00Z')});
  assert.equal(r.sourceKind,'time');assert.equal(r.sourceDate,null);assert.equal(r.localDate,null);assert.equal(r.anchorUsed,false);
  assert.deepEqual(r.sourceDisplay,{weekday:'',date:'',time:'10:00',zoneName:'PST',utcOffset:'UTC-8'});
  assert.deepEqual(r.localDisplay,{weekday:'',date:'第二天',time:'02:00',zoneName:'Asia/Shanghai',utcOffset:'UTC+8'});
  assert.equal(r.dayDelta,1);assert.equal(r.referenceDate,'2027-01-01');
});
const timeReference=Date.parse('2026-10-24T12:00:00Z');
for(const [input,localZone,dayDelta,label,time] of [
  ['10am UTC','Asia/Shanghai',0,'当天','18:00'],
  ['10am PDT','Asia/Shanghai',1,'第二天','01:00'],
  ['01:00 UTC','America/Los_Angeles',-1,'前一天','18:00'],
  ['00:15 UTC+05:45','UTC',-1,'前一天','18:30'],
  ['00:15 UTC+05:45','Asia/Shanghai',0,'当天','02:30'],
  ['23:45 UTC-03:30','Asia/Shanghai',1,'第二天','11:15'],
  ['23:30 AoE','Pacific/Kiritimati',2,'后天','01:30'],
  ['00:30 UTC+14','Etc/GMT+12',-2,'前两天','22:30'],
  ['13:14:15 UTC','Asia/Shanghai',0,'当天','21:14:15'],
  ['noon UTC','Asia/Shanghai',0,'当天','20:00'],
  ['midnight UTC','America/Los_Angeles',-1,'前一天','17:00'],
  ['EOD UTC','Asia/Shanghai',1,'第二天','08:00']
])test('Time-only day delta: '+input+' → '+localZone,()=>{
  const r=ok(input,{localZone,nowEpoch:timeReference});
  assert.equal(r.sourceKind,'time');assert.equal(r.dayDelta,dayDelta);assert.equal(r.localDisplay.date,label);assert.equal(r.localDisplay.time,time);
  assert.equal(r.sourceDisplay.date,'');assert.equal(r.sourceDisplay.weekday,'');assert.equal(r.localDisplay.weekday,'');
  assert.ok(!Object.hasOwn(r.sourceDisplay,'year'));assert.ok(!Object.hasOwn(r.localDisplay,'year'));
  assert.equal(r.sourceDate,null);assert.equal(r.localDate,null);assert.equal(r.hasTime,true);assert.equal(r.anchorUsed,false);
});
test('Time-only defaults to Date.now, not a tweet anchor',()=>{
  const previous=Date.now;
  Date.now=()=>Date.parse('2027-01-01T02:00:00Z');
  try {
    const r=ok('10am PT',{anchorEpoch:Date.parse('2026-07-14T12:00:00Z')});
    assert.equal(r.referenceDate,'2026-12-31');assert.equal(r.sourceDisplay.utcOffset,'UTC-8');assert.equal(r.localDisplay.time,'02:00');assert.equal(r.dayDelta,1);
  } finally { Date.now=previous; }
});
test('Time-only referenceEpoch alias is deterministic',()=>{
  const r=ok('10am PT',{referenceEpoch:Date.parse('2026-07-14T12:00:00Z')});
  assert.equal(r.referenceDate,'2026-07-14');assert.equal(r.sourceDisplay.utcOffset,'UTC-7');assert.equal(r.localDisplay.time,'01:00');
});
test('Time-only nowEpoch takes precedence over referenceEpoch',()=>{
  const r=ok('10am PT',{nowEpoch:Date.parse('2026-01-14T12:00:00Z'),referenceEpoch:Date.parse('2026-07-14T12:00:00Z')});
  assert.equal(r.sourceDisplay.utcOffset,'UTC-8');
});
test('Time-only reference is today in source zone, not UTC today',()=>{
  const r=ok('2:30am PT',{nowEpoch:Date.parse('2026-03-08T06:00:00Z')});
  assert.equal(r.referenceDate,'2026-03-07');assert.equal(r.sourceDisplay.utcOffset,'UTC-8');
});
test('Time-only source offset follows resolved clock on DST-change day',()=>{
  const r=ok('10am PT',{nowEpoch:Date.parse('2026-03-08T09:00:00Z')});
  assert.equal(r.referenceDate,'2026-03-08');assert.equal(r.sourceDisplay.utcOffset,'UTC-7');
});
test('Time-only target offset follows resolved clock, not now',()=>{
  const r=ok('1am UTC',{localZone:'America/New_York',nowEpoch:Date.parse('2026-11-01T12:00:00Z')});
  assert.equal(r.localDisplay.utcOffset,'UTC-4');assert.equal(r.localDisplay.time,'21:00');assert.equal(r.dayDelta,-1);
});
test('Time-only source zone may be explicitly configured',()=>{
  const r=ok('10am',{sourceZone:'America/Los_Angeles',nowEpoch:timeReference});
  assert.equal(r.sourceKind,'time');assert.equal(r.sourceDisplay.zoneName,'America/Los_Angeles');assert.equal(r.localDisplay.time,'01:00');
});
for(const input of ['10am','09:30','10am CST','10am IST','10am BST','tomorrow 10am UTC','today 10am UTC','Friday 10am UTC','next week at 10am UTC','in two days at 10am UTC','10/23 at 10am UTC','2026-10- at 10am UTC','2026 at 10am UTC','Oct 23 10am UTC','9-11am UTC','10am and 11am UTC','10am UTC at 13','10:00:00.500 UTC','at 10 UTC'])test('Time-only rejects missing context or malformed residue: '+input,()=>assert.equal(parse(input,{nowEpoch:timeReference}).status,'ambiguous'));
for(const input of ['2026-02-30 10am UTC','2026-13-23 10am UTC','25:00 UTC','13am UTC','10:99 UTC','10am UTC+15'])test('Time-only invalid date or clock is not reinterpreted: '+input,()=>assert.equal(parse(input,{nowEpoch:timeReference}).status,'unsupported'));
for(const [input,now] of [['2:30am PT','2026-03-08T12:00:00Z'],['1:30am PT','2026-11-01T12:00:00Z'],['01:45 Australia/Lord_Howe','2026-04-05T02:00:00Z']])test('Time-only still rejects DST gap/fold: '+input,()=>assert.equal(parse(input,{nowEpoch:Date.parse(now)}).status,'ambiguous'));
test('Time-only rejects invalid reference epoch',()=>assert.equal(parse('10am PST',{nowEpoch:Infinity}).status,'unsupported'));
for(const clock of ['10 and 11am','10 or 11am','10 and/or 11am','10 & 11am','10, 11am','10, or 11am','10, and 11am','10am and 11','10am or 11','10am & 11','10am, 11','10-11am','10–11am','10—11am','10‑11am','10‒11am','10−11am','10~11am','10--11am','10——11am','10，11am','10、11am','10 to 11am','10 till 11am','10.30—11am','10:30 and 11am','9, 10 and 11am'])test('Time-only shared-meridiem list is rejected: '+clock,()=>assert.equal(parse(clock+' PST',{localZone:target,nowEpoch:timeReference}).status,'ambiguous'));
for(const input of ['limits may reset at 10am PST','it may happen at 10am PST','the reset may land at 10am PST','10am PST, reset confirmed','1,000 users will reset at 10am PST'])test('Single-time prose remains supported: '+input,()=>{
  const r=ok(input,{nowEpoch:timeReference});assert.equal(r.sourceKind,'time');assert.equal(r.sourceDisplay.time,'10:00');
});
for(const input of ['in May at 10am PST','in may at 10am PST','May at 10am PST','by May at 10am PST'])test('Actual incomplete May date is not treated as modal: '+input,()=>assert.equal(parse(input,{nowEpoch:timeReference}).status,'ambiguous'));
const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
for(const [i,name] of months.entries()){
  test(name+': full month-first',()=>assert.equal(ok(name+' 14, 2026 at 10am UTC').sourceDate,'2026-'+String(i+1).padStart(2,'0')+'-14 10:00:00'));
  test(name+': abbreviated day-first',()=>assert.equal(ok('14 '+name.slice(0,3)+'. 2026 10am UTC').sourceDate,'2026-'+String(i+1).padStart(2,'0')+'-14 10:00:00'));
}
test('Sept / Sep / September share September',()=>{for(const m of ['Sep','Sept','Sept.','September'])assert.equal(ok(m+' 25, 2026 11:59pm AOE').sourceDate,'2026-09-25 23:59:00');});
test('Month/day followed by clock is not a year',()=>{
  assert.equal(ok('Oct 23 10am PDT',{anchorEpoch:anchor}).sourceDate,'2026-10-23 10:00:00');
  assert.equal(ok('23 Oct 10am PDT',{anchorEpoch:anchor}).sourceDate,'2026-10-23 10:00:00');
});
test('Date-only AoE is a civil date without invented clock',()=>{
  const r=ok("May 04 '26 (Anywhere on Earth)");
  assert.equal(r.sourceDate,'2026-05-04');assert.equal(r.hasTime,false);assert.equal(r.epoch,null);
  assert.equal(r.sourceDisplay.time,null);assert.equal(r.localDisplay.time,null);
  assert.equal(r.localDisplay.date,'5月4日–5月5日');
  assert.equal(r.sourceDisplay.weekday,'周一');assert.equal(r.localDisplay.weekday,'周一–周二');
  assert.equal(new Date(r.interval.startEpoch).toISOString(),'2026-05-04T12:00:00.000Z');
  assert.equal(new Date(r.interval.endEpochExclusive).toISOString(),'2026-05-05T12:00:00.000Z');
});
test('Date-only deadline never invents 23:59:59',()=>assert.equal(ok('Deadline Sep 25, 2026 AOE').sourceDisplay.time,null));
for(const clock of ['at 10','at 10 o’clock',"10 o'clock",'at ten','10:0','10点','in 2 hours','in the afternoon'])test('Unparsed clock is not treated as date-only: '+clock,()=>assert.equal(parse('2026-10-23 '+clock+' UTC').status,'ambiguous'));
test('Same source and destination date-only remains one date',()=>{
  const r=ok('October 23, 2026 UTC',{localZone:'UTC'});assert.equal(r.localDisplay.date,'10月23日');assert.equal(r.localDisplay.weekday,'周五');assert.equal(r.localDisplay.time,null);assert.equal(r.localDisplay.utcOffset,'UTC');
});
test('Explicit AoE clock precision retained',()=>{
  const r=ok('May 28, 2026, 11:59pm AOE');assert.equal(r.sourceDate,'2026-05-28 23:59:00');assert.equal(r.sourceDisplay.time,'23:59');assert.equal(r.localDisplay.date,'5月29日');
});
test('UTC literal numeric date',()=>assert.equal(iso(ok('2026-10-30 09:00 UTC')),'2026-10-30T09:00:00.000Z'));
test('PST remains fixed on summer dates',()=>assert.equal(iso(ok('2026-10-30 9 AM PST')),'2026-10-30T17:00:00.000Z'));
test('PT daylight offset',()=>{
  const r=ok('2026-07-30 9 AM PT');assert.equal(iso(r),'2026-07-30T16:00:00.000Z');assert.equal(r.sourceDisplay.utcOffset,'UTC-7');
});
test('PT standard offset',()=>{
  const r=ok('2026-01-30 9 AM PT');assert.equal(iso(r),'2026-01-30T17:00:00.000Z');assert.equal(r.sourceDisplay.utcOffset,'UTC-8');
});
test('UTC offset is not itself the clock',()=>assert.equal(iso(ok('2026-10-30 6pm UTC+05:30')),'2026-10-30T12:30:00.000Z'));
test('Compact UTC offset',()=>assert.equal(iso(ok('2026-10-30 6pm UTC+0530')),'2026-10-30T12:30:00.000Z'));
test('Date-only offset does not produce a clock',()=>assert.equal(ok('2026-10-30 UTC+05:30').sourceDisplay.time,null));
test('Dotted date does not produce a clock',()=>assert.equal(ok('2026.10.30 UTC').sourceDisplay.time,null));
test('Dotted am/pm clock and full timezone name',()=>assert.equal(ok('2026-10-30 6 p.m. Pacific time').sourceDisplay.time,'18:00'));
test('Explicit seconds visible',()=>assert.equal(ok('2026-10-30 09:10:31 UTC').sourceDisplay.time,'09:10:31'));
test('ISO Z',()=>assert.equal(iso(ok('2026-10-23T10:00:00Z')),'2026-10-23T10:00:00.000Z'));
test('ISO numeric offset',()=>assert.equal(iso(ok('2026-10-23T10:00:00-07:00')),'2026-10-23T17:00:00.000Z'));
test('ISO compact offset',()=>assert.equal(iso(ok('2026-10-23T10:00+0530')),'2026-10-23T04:30:00.000Z'));
test('Etc/GMT IANA offset suffix is not truncated',()=>assert.equal(ok('2026-10-23 10:00 Etc/GMT+5').sourceDisplay.utcOffset,'UTC-5'));
test('Hyphen in IANA location remains intact',()=>assert.equal(ok('2026-10-23 10:00 America/Port-au-Prince').sourceDisplay.zoneName,'America/Port-au-Prince'));
test('Date-clock dash separator is not mistaken for a date range',()=>assert.equal(ok('2026-10-23 - 10:00 UTC').sourceDisplay.time,'10:00'));
for(const offset of ['UTC+05:3','UTC+5:300','UTC+5:','UTC+99999'])test('Malformed offset cannot be partially accepted: '+offset,()=>assert.equal(parse('2026-10-23 10:00 '+offset).status,'unsupported'));
test('AoE and UTC−12h have the same offset',()=>assert.equal(ok('May 4 2026 23:59 AoE (UTC-12h)').sourceDisplay.utcOffset,'UTC-12'));
test('Chinese date',()=>assert.equal(ok('2026年10月23日 10:00 JST').sourceDate,'2026-10-23 10:00:00'));
test('Anchor year uses source-local date',()=>{
  const r=ok('Dec 31 10am PST',{anchorEpoch:Date.parse('2027-01-01T01:00:00Z')});assert.equal(r.sourceDate,'2026-12-31 10:00:00');assert.equal(r.sourceDisplay.weekday,'周四');assert.ok(!Object.hasOwn(r.sourceDisplay,'year'));
});
test('Explicit today uses source-local date',()=>{
  const r=ok('today 10am PST',{anchorEpoch:Date.parse('2026-10-24T02:00:00Z')});assert.equal(r.sourceDate,'2026-10-23 10:00:00');
});
test('Selected tomorrow works without surrounding context',()=>{
  const r=ok('tomorrow before 10am PST',{anchorEpoch:Date.parse('2026-10-23T04:47:00Z')});assert.equal(r.sourceDate,'2026-10-23 10:00:00');
});
test('EOD boundary uses 24:00, not fabricated last second',()=>{
  const r=ok('by EOD PST today',{anchorEpoch:Date.parse('2026-10-24T02:00:00Z')});assert.equal(r.sourceDisplay.time,'24:00');assert.equal(r.sourceKind,'boundary');assert.equal(iso(r),'2026-10-24T08:00:00.000Z');
});
for(const phrase of ['end of business day','end of the business day'])test('Business-day end is not midnight: '+phrase,()=>assert.equal(parse('2026-10-23 '+phrase+' PST').status,'ambiguous'));
test('Date-only target range crosses year',()=>{
  const r=ok('December 31, 2026 AoE');assert.equal(r.localDate,'2026-12-31 – 2027-01-01');assert.equal(r.localDisplay.weekday,'周四–周五');assert.equal(r.localDisplay.date,'12月31日–1月1日');assert.ok(!Object.hasOwn(r.localDisplay,'year'));
});
test('Date-only source DST change shows both offsets',()=>{
  const r=ok('March 8, 2026 PT');assert.equal(r.sourceDisplay.utcOffset,'UTC-8 / UTC-7');assert.equal(r.sourceDisplay.time,null);
});
test('Date-only target DST change shows both offsets',()=>{
  const r=ok('March 8, 2026 UTC',{localZone:'America/Los_Angeles'});assert.equal(r.localDisplay.utcOffset,'UTC-8 / UTC-7');
});
for(const input of ['2026-10-30 9am','2026-10-30 9am PST and 8am EST','Oct 23 2026 UTC and Oct 24 2026 UTC','Oct 23-24 2026 UTC','2026-10-23 9-11am UTC','2026-10-23 9am and 11am UTC','Oct 23 10am PDT','2026-10-23 10am CST','2026-10-23 10am IST','2026-10-23 10am BST'])test('Conservative rejection: '+input,()=>assert.equal(parse(input,{localZone:target}).status,'ambiguous'));
for(const input of ['2026-02-30 9am UTC','2026-13-30 9am UTC','2026-10-32 9am UTC','2025-02-29 9am UTC','2026-10-30 25:00 UTC','2026-10-30 9:99 UTC','2026-10-30 13am UTC','2026-10-30 6pm UTC+15:00','2026-10-30 6pm UTC+14:30'])test('Invalid input: '+input,()=>assert.equal(parse(input,{localZone:target}).status,'unsupported'));
test('Leap date',()=>assert.equal(ok('2024-02-29 10am UTC').sourceDisplay.date,'2月29日'));
test('DST nonexistent time',()=>assert.equal(parse('2026-03-08 2:30am PT').status,'ambiguous'));
test('DST repeated time',()=>assert.equal(parse('2026-11-01 1:30am PT').status,'ambiguous'));
test('30-minute DST repeated time',()=>assert.equal(parse('2026-04-05 01:45 Australia/Lord_Howe').status,'ambiguous'));
test('Target IANA offset respects date',()=>{
  const winter=ok('2026-01-23 10am UTC',{localZone:'America/New_York'}),summer=ok('2026-07-23 10am UTC',{localZone:'America/New_York'});
  assert.equal(winter.localDisplay.utcOffset,'UTC-5');assert.equal(summer.localDisplay.utcOffset,'UTC-4');
});
console.log('All '+count+' Time Lens parser regression tests passed');
