/* Time Lens: offline, conservative date interpretation and deterministic conversion. */
(function (root) {
  'use strict';
  const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
  const MONTH_WORDS = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';
  const FIXED = {UTC:0,GMT:0,Z:0,PST:-480,PDT:-420,EST:-300,EDT:-240,CDT:-300,MST:-420,MDT:-360,JST:540,KST:540,CET:60,CEST:120,AEST:600,AEDT:660,SGT:480,HKT:480,AKST:-540,AKDT:-480,HST:-600};
  const AMBIGUOUS_ZONES = new Set(['CST','IST','BST']);
  const REGION = {PT:'America/Los_Angeles',ET:'America/New_York',CT:'America/Chicago',MT:'America/Denver','PACIFIC TIME':'America/Los_Angeles','EASTERN TIME':'America/New_York','CENTRAL TIME':'America/Chicago','BEIJING TIME':'Asia/Shanghai','CHINA STANDARD TIME':'Asia/Shanghai'};
  const TZ_PATTERN = /Anywhere\s+on\s+Earth|\bAoE\b|\b(?:UTC|GMT)\s*[+-]\s*[0-9:]+h?(?![a-z0-9:])|\b(?:Pacific|Eastern|Central|Beijing|China Standard)\s+Time\b|\b(?:UTC|GMT|PST|PDT|EST|EDT|CST|CDT|MST|MDT|JST|KST|IST|CET|CEST|BST|AEST|AEDT|SGT|HKT|AKST|AKDT|HST|PT|ET|CT|MT)\b|\b[A-Za-z_]+\/[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+)?\b/g;
  const pad = n => String(n).padStart(2,'0');
  const has = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
  const dateKey = p => p.year+'-'+pad(p.month)+'-'+pad(p.day);
  const dateLabel = p => p.month+'月'+p.day+'日';
  const weekdayLabel = p => ['周日','周一','周二','周三','周四','周五','周六'][new Date(Date.UTC(p.year,p.month-1,p.day)).getUTCDay()];
  function partsInZone(epoch,zone) {
    const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(epoch)).map(x=>[x.type,+x.value]));
    return {year:p.year,month:p.month,day:p.day,hour:p.hour,minute:p.minute,second:p.second};
  }
  function zoneOffset(epoch,zone) {
    const p=partsInZone(epoch,zone);
    return (Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-Math.floor(epoch/1000)*1000)/60000;
  }
  function formatOffset(minutes) {
    const seconds=Math.round(Math.abs(minutes)*60);
    if(seconds===0)return 'UTC';
    const remainder=seconds%3600;
    return 'UTC'+(minutes<0?'-':'+')+Math.floor(seconds/3600)+(remainder?':'+pad(Math.floor(remainder/60)):'')+(seconds%60?':'+pad(seconds%60):'');
  }
  function offsetAt(epoch,tz) {return tz.offset!==undefined?tz.offset:zoneOffset(epoch,tz.zone);}
  function sourceParts(epoch,tz) {return tz.offset!==undefined?partsInZone(epoch+tz.offset*60000,'UTC'):partsInZone(epoch,tz.zone);}
  function toEpoch(d,tz) {
    const naive=Date.UTC(d.year,d.month-1,d.day,d.hour,d.minute,d.second);
    if(tz.offset!==undefined)return {epoch:naive-tz.offset*60000};
    // Enumerate offsets, including half-hour DST; never normalize invalid clocks.
    const offsets=new Set([-36,-12,0,12,36].map(h=>zoneOffset(naive+h*3600000,tz.zone)));
    const matches=[...offsets].map(offset=>naive-offset*60000).filter(epoch=>{
      const q=partsInZone(epoch,tz.zone);
      return ['year','month','day','hour','minute','second'].every(k=>q[k]===d[k]);
    });
    if(matches.length===0)return {error:'当地时间位于夏令时跳跃或跳日区间，不对应真实时刻'};
    if(matches.length>1)return {error:'夏令时切换使此时间出现两次，请指定 UTC 偏移'};
    return {epoch:matches[0]};
  }
  function parseOffset(raw) {
    const m=raw.match(/([+-])\s*(\d{1,2})(?::?(\d{2}))?h?$/i);
    if(!m)return null;
    const h=+m[2],minute=+(m[3]||0);
    if(h>14||minute>59||(h===14&&minute!==0))return null;
    return (m[1]==='-'?-1:1)*(h*60+minute);
  }
  function detectZones(text) {
    const s=String(text).replace(/[−–]/g,'-');
    const matches=[],pattern=new RegExp(TZ_PATTERN.source,'ig');
    for(const match of s.matchAll(pattern)) {
      const raw=match[0],key=raw.toUpperCase().replace(/\s+/g,' ');
      let z;
      if(/^(?:AOE|ANYWHERE ON EARTH)$/i.test(key))z={label:'AoE',offset:-720,aoe:true};
      else if(/^(?:UTC|GMT)\s*[+-]/i.test(raw)) {
        const offset=parseOffset(raw);
        z=offset===null?{label:raw,error:'UTC 偏移无效'}:{label:raw.replace(/\s+/g,'').replace(/h$/i,''),offset};
      } else if(AMBIGUOUS_ZONES.has(key))z={label:key,ambiguous:true};
      else if(has(FIXED,key))z={label:key,offset:FIXED[key]};
      else if(has(REGION,key))z={label:key.length===2?key:raw,zone:REGION[key]};
      else {try{new Intl.DateTimeFormat('en',{timeZone:raw});z={label:raw,zone:raw};}catch{continue;}}
      matches.push({...z,start:match.index,end:match.index+raw.length});
    }
    const iso=/\b(?:19|20)\d{2}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::\d{2})?(Z|[+-]\d{2}:?\d{2})(?!\w)/ig;
    for(const match of s.matchAll(iso)) {
      const raw=match[1],start=match.index+match[0].length-raw.length;
      const offset=raw.toUpperCase()==='Z'?0:parseOffset(raw);
      matches.push({label:raw.toUpperCase()==='Z'?'UTC':'UTC'+raw,offset:offset===null?undefined:offset,error:offset===null?'UTC 偏移无效':undefined,start,end:start+raw.length});
    }
    return matches.sort((a,b)=>a.start-b.start);
  }
  function maskSpans(s,spans) {
    let out=s;
    for(const span of [...spans].sort((a,b)=>b.start-a.start))out=out.slice(0,span.start)+' '.repeat(span.end-span.start)+out.slice(span.end);
    return out;
  }
  function yearSuffix(s,end) {
    // Bare clocks are not years. Two-digit years require an apostrophe.
    const match=s.slice(end).match(/^\s*,?\s*((?:19|20)\d{2}|2100|'\d{2})(?![\da-z])/i);
    return match?{year:match[1][0]==="'"?2000+Number(match[1].slice(1)):+match[1],end:end+match[0].length}:{};
  }
  function findDates(s,anchor,tz) {
    const found=[];
    for(const m of s.matchAll(/\b((?:19|20)\d{2}|2100)[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g))found.push({year:+m[1],month:+m[2],day:+m[3],start:m.index,end:m.index+m[0].length,explicit:true});
    for(const m of s.matchAll(new RegExp('\\b('+MONTH_WORDS+')\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)','ig'))) {
      const end=m.index+m[0].length,ys=yearSuffix(s,end);
      found.push({month:MONTHS[m[1].toLowerCase().slice(0,3)],day:+m[2],start:m.index,end,...ys,explicit:ys.year!==undefined});
    }
    for(const m of s.matchAll(new RegExp('(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+('+MONTH_WORDS+')\\.?(?![a-z])','ig'))) {
      const end=m.index+m[0].length,ys=yearSuffix(s,end);
      found.push({month:MONTHS[m[2].toLowerCase().slice(0,3)],day:+m[1],start:m.index,end,...ys,explicit:ys.year!==undefined});
    }
    for(const m of s.matchAll(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日?/g))found.push({year:m[1]?+m[1]:undefined,month:+m[2],day:+m[3],start:m.index,end:m.index+m[0].length,explicit:!!m[1]});
    const dates=found.sort((a,b)=>a.start-b.start).filter((x,i,all)=>!all.slice(0,i).some(y=>x.start<y.end&&x.end>y.start));
    if(dates.length||anchor===null)return dates;
    const relatives=[...s.matchAll(/\b(today|tonight|tomorrow|yesterday)\b|今天|今晚|明天|昨天/ig)];
    if(relatives.length!==1)return [];
    const m=relatives[0],word=m[0].toLowerCase();
    const day=['tomorrow','明天'].includes(word)?1:['yesterday','昨天'].includes(word)?-1:0;
    const p=sourceParts(anchor,tz),dt=new Date(Date.UTC(p.year,p.month-1,p.day+day));
    return [{year:dt.getUTCFullYear(),month:dt.getUTCMonth()+1,day:dt.getUTCDate(),start:m.index,end:m.index+m[0].length,explicit:false,relative:true}];
  }
  function findClocks(s) {
    const found=[];
    const detailed=/(?<![a-z0-9])(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![a-z0-9])/ig;
    for(const m of s.matchAll(detailed)) {
      let hour=+m[1];const minute=+m[2],second=+(m[3]||0),ap=m[4]?.replace(/\./g,'').toLowerCase();
      const invalid=hour>(ap?12:23)||minute>59||second>59||(ap&&hour<1);
      if(ap)hour=hour%12+(ap==='pm'?12:0);
      found.push({hour,minute,second,secondsExplicit:!!m[3],explicit:true,start:m.index,end:m.index+m[0].length,error:invalid?'时间数字不合法':null});
    }
    const remainder=maskSpans(s,found);
    for(const m of remainder.matchAll(/(?<![a-z0-9])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z0-9])/ig))found.push({hour:+m[1]%12+(m[2][0].toLowerCase()==='p'?12:0),minute:0,second:0,explicit:true,secondsExplicit:false,start:m.index,end:m.index+m[0].length,error:+m[1]<1||+m[1]>12?'时间数字不合法':null});
    for(const m of remainder.matchAll(/\b(noon|midday|midnight|EOD|end of (?:the )?day|start of (?:the )?day|beginning of (?:the )?day)\b|中午|午夜|当天结束前/ig)) {
      const word=m[0].toLowerCase(),endOfDay=/eod|end of|当天/.test(word);
      found.push({hour:/noon|midday|中午/.test(word)?12:0,minute:0,second:0,explicit:true,secondsExplicit:false,endOfDay,start:m.index,end:m.index+m[0].length});
    }
    return found.sort((a,b)=>a.start-b.start);
  }
  function dateValid(d) {return d.year>=1900&&d.year<=2100&&d.month>=1&&d.month<=12&&d.day>=1&&d.day<=31&&new Date(Date.UTC(d.year,d.month-1,d.day)).getUTCDate()===d.day;}
  function hasUnparsedClock(text) {
    // A failed clock parse is not evidence that the text contains only a date.
    // Reject obvious clock language instead of silently broadening it to a day.
    return /\b(?:at|by|before|after|around|about|until|from)\s+(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(text)
      || /\bo\s*'?\s*clock\b/i.test(text)
      || /\d\s*[:.]\s*\d|\d\s*(?:点|时)/i.test(text)
      || /\b\d+\s*(?:hrs?|hours?|mins?|minutes?|secs?|seconds?)\b/i.test(text)
      || /\b(?:morning|afternoon|evening|tonight)\b/i.test(text);
  }
  function nextDate(d) {const x=new Date(Date.UTC(d.year,d.month-1,d.day+1));return {year:x.getUTCFullYear(),month:x.getUTCMonth()+1,day:x.getUTCDate()};}
  function fmt(epoch,zone,locale='zh-CN') {return new Intl.DateTimeFormat(locale,{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(epoch));}
  function display(p,zoneName,offset,time=null,end=null,endOffset=offset) {
    const spansDates=end&&dateKey(end)!==dateKey(p);
    return {weekday:spansDates?weekdayLabel(p)+'–'+weekdayLabel(end):weekdayLabel(p),date:spansDates?dateLabel(p)+'–'+dateLabel(end):dateLabel(p),time,zoneName,utcOffset:offset===endOffset?formatOffset(offset):formatOffset(offset)+' / '+formatOffset(endOffset)};
  }
  function timeLabel(p,seconds) {return pad(p.hour)+':'+pad(p.minute)+(seconds?':'+pad(p.second):'');}
  function zoneIdentity(z) {return z.offset!==undefined?'offset:'+z.offset:'zone:'+(z.zone||z.label);}
  function hasDateHint(text) {
    // Date-free conversion must never erase an unrecognized or unresolved date.
    // Narrow modal-verb exception; "in May" / "May at ..." remain date hints.
    const hints=text.replace(/\bmay(?=\s+(?:reset|land|happen|arrive|occur|start|begin|be)\b)/g,'   ');
    return new RegExp('\\b(?:'+MONTH_WORDS+'|Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|today|tonight|tomorrow|yesterday)\\b','i').test(hints)
      || /\b(?:this|next|last)\s+(?:day|week|month|year)|\bin\s+(?:\d+|a|one|two|three)\s+(?:days?|weeks?|months?|years?)\b/i.test(text)
      || /\b\d{4}\b|\b\d{1,2}\s*\/\s*\d{1,2}\b|\b\d{1,2}(?:st|nd|rd|th)\b/i.test(text)
      || /年|月|日|今天|明天|昨天|后天|前天|今晚|明早|下周|下星期|星期|周[一二三四五六日天]/.test(text);
  }
  function relativeDayLabel(delta) {
    if(delta===-2)return '前两天';
    if(delta===-1)return '前一天';
    if(delta===0)return '当天';
    if(delta===1)return '第二天';
    if(delta===2)return '后天';
    return Math.abs(delta)+'天'+(delta<0?'前':'后');
  }
  function parseTimeOnly(raw,clockText,tz,localZone,options) {
    if(hasDateHint(clockText))return {status:'ambiguous',message:'选区含有尚未确定的日期，不能只按时间换算',sourceZone:tz.label};
    // Shared-meridiem lists may contain only one fully specified clock. Reject
    // the whole list rather than silently dropping e.g. the 10 in "10 and 11am".
    if(/(?<![a-z0-9])\d{1,2}(?:[:.]\d{2}(?::\d{2})?)?\s*(?:[ap]\.?m\.?)?\s*(?:and(?:\s*\/\s*or)?\b|or\b|&|[,，、]\s*(?:(?:and|or)\b)?|[-\u2010-\u2015\u2212~～]+|to\b|through\b|until\b|till\b)\s*\d{1,2}(?!\d)/i.test(clockText))return {status:'ambiguous',message:'选区包含多个时间或时间范围，请逐个选择'};
    if(/\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\s*(?:-|to\b|through\b|until\b)\s*\d{1,2}/i.test(clockText))return {status:'ambiguous',message:'选区包含时间范围，请逐个选择'};
    const clocks=findClocks(clockText);
    if(clocks.length>1)return {status:'ambiguous',message:'选区包含多个时间，请逐个选择'};
    const clock=clocks[0];
    if(!clock)return {status:'ambiguous',message:'没有可确定的日期或明确时间',sourceZone:tz.label};
    if(clock.error)return {status:'unsupported',message:clock.error};
    const residue=maskSpans(clockText,clocks);
    if(hasUnparsedClock(residue)||/[:.]\s*\d|\d\s*[:.]/.test(residue))return {status:'ambiguous',message:'选区含有未解析的时间部分，请提供单个明确时间'};
    // Only the source zone's current civil date chooses the applicable offset.
    // Publication timestamps are deliberately NOT dates for a time-only event.
    const now=options.nowEpoch!==undefined?options.nowEpoch:options.referenceEpoch!==undefined?options.referenceEpoch:Date.now();
    if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))return {status:'unsupported',message:'参考时间无效'};
    const today=sourceParts(now,tz);
    if(!dateValid(today))return {status:'unsupported',message:'参考日期超出支持范围'};
    const sourceDate=clock.endOfDay?nextDate(today):today;
    const d={year:sourceDate.year,month:sourceDate.month,day:sourceDate.day,hour:clock.hour,minute:clock.minute,second:clock.second};
    const resolved=toEpoch(d,tz);
    if(resolved.error)return {status:'ambiguous',message:resolved.error,sourceZone:tz.label};
    const local=partsInZone(resolved.epoch,localZone),seconds=!!clock.secondsExplicit;
    const dayDelta=Math.round((Date.UTC(local.year,local.month-1,local.day)-Date.UTC(today.year,today.month-1,today.day))/86400000);
    const sourceDisplay={weekday:'',date:'',time:clock.endOfDay?'24:00':timeLabel(d,seconds),zoneName:tz.label,utcOffset:formatOffset(offsetAt(resolved.epoch,tz))};
    const localDisplay={weekday:'',date:relativeDayLabel(dayDelta),time:timeLabel(local,seconds),zoneName:localZone,utcOffset:formatOffset(zoneOffset(resolved.epoch,localZone))};
    return {status:'ok',input:raw,sourceZone:tz.label,sourceDate:null,localZone,localDate:null,epoch:resolved.epoch,sourceKind:'time',hasTime:true,dayDelta,sourceDisplay,localDisplay,referenceEpoch:now,referenceDate:dateKey(today),notes:['未提供日期；时区偏移以来源时区的今天为参考'],assumed:true,anchorUsed:false};
  }
  function parse(input,options={}) {
    const raw=String(input||'').trim().replace(/[\u00a0\u202f]/g,' ').replace(/[−–]/g,'-').replace(/[’‘]/g,"'");
    if(!raw||raw.length>900)return {status:'unsupported',message:'请选择长度不超过 900 字的时间描述'};
    if(/\bend of (?:the )?business day\b/i.test(raw))return {status:'ambiguous',message:'营业日结束没有统一时刻，请选取明确的截止时间'};
    const localZone=options.localZone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
    try{new Intl.DateTimeFormat('en',{timeZone:localZone});}catch{return {status:'unsupported',message:'目标时区无效'};}
    const zones=detectZones(raw);
    if(zones.some(z=>z.error))return {status:'unsupported',message:zones.find(z=>z.error).error};
    if(zones.some(z=>z.ambiguous))return {status:'ambiguous',message:'CST、IST、BST 等缩写存在地区歧义，请使用明确的 UTC 偏移或 IANA 时区名'};
    const unique=zones.filter((z,i)=>zones.findIndex(x=>zoneIdentity(x)===zoneIdentity(z))===i);
    if(unique.length>1)return {status:'ambiguous',message:'发现多个不同的时区，请缩小选区',zones:unique.map(z=>z.label)};
    const tz=unique[0]||(options.sourceZone?{label:options.sourceZone,zone:options.sourceZone}:null);
    if(!tz)return {status:'ambiguous',message:'缺少明确来源时区，请选中时区或在设置中指定'};
    if(tz.zone){try{new Intl.DateTimeFormat('en',{timeZone:tz.zone});}catch{return {status:'unsupported',message:'来源时区无效'};}}
    const anchor=Number.isFinite(options.anchorEpoch)?options.anchorEpoch:null;
    const withoutZones=maskSpans(raw,zones);
    const dates=findDates(withoutZones,anchor,tz);
    if(dates.length>1)return {status:'ambiguous',message:'选区包含多个日期，请逐个选择'};
    if(!dates.length)return parseTimeOnly(raw,withoutZones,tz,localZone,options);
    const date=dates[0],notes=[];
    if(/^\s*(?:-|to\b|through\b|until\b|and\b)\s*\d{1,2}\b(?![:.])/i.test(withoutZones.slice(date.end)))return {status:'ambiguous',message:'选区包含日期范围，请逐个选择'};
    if(date.year===undefined) {
      if(anchor===null)return {status:'ambiguous',message:'缺少年份，请将年份一起选中',sourceZone:tz.label};
      date.year=sourceParts(anchor,tz).year;notes.push('年份由同一条内容的发布时间推断');
    }
    if(!dateValid(date))return {status:'unsupported',message:'日期无效'};
    if(date.relative)notes.push('相对日期以同一条内容的发布时间为参照');
    const clockText=maskSpans(withoutZones,dates).replace(/[Tt](?=\d{2}:)/g,' ');
    if(/\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?\s*(?:-|to\b|through\b|until\b)\s*\d{1,2}/i.test(clockText))return {status:'ambiguous',message:'选区包含时间范围，请逐个选择'};
    const clocks=findClocks(clockText);
    if(clocks.length>1)return {status:'ambiguous',message:'选区包含多个时间，请逐个选择'};
    const clock=clocks[0]||null;
    if(clock?.error)return {status:'unsupported',message:clock.error};
    const localTz={zone:localZone};
    if(/\b(?:by|before|until|no later than|sometime|around|approximately|roughly)\b|之前|大约|左右/i.test(raw))notes.push('原文表达界限或近似时间，而非实际发生时刻');
    if(!clock) {
      if(hasUnparsedClock(clockText))return {status:'ambiguous',message:'发现未能确定的时间表达，请提供明确的小时、分钟及上午或下午'};
      const start=toEpoch({...date,hour:0,minute:0,second:0},tz);
      const end=toEpoch({...nextDate(date),hour:0,minute:0,second:0},tz);
      if(start.error||end.error)return {status:'ambiguous',message:start.error||end.error};
      const last=end.epoch-1,localStart=partsInZone(start.epoch,localZone),localLast=partsInZone(last,localZone);
      const sourceDisplay=display(date,tz.label,offsetAt(start.epoch,tz),null,null,offsetAt(last,tz));
      const localDisplay=display(localStart,localZone,offsetAt(start.epoch,localTz),null,localLast,offsetAt(last,localTz));
      return {status:'ok',input:raw,sourceZone:tz.label,sourceDate:dateKey(date),localZone,localDate:dateKey(localStart)+(dateKey(localStart)!==dateKey(localLast)?' – '+dateKey(localLast):''),epoch:null,interval:{startEpoch:start.epoch,endEpochExclusive:end.epoch},sourceKind:'date',hasTime:false,sourceDisplay,localDisplay,notes,assumed:notes.length>0,anchorUsed:!date.explicit};
    }
    // EOD is a boundary at next midnight, not a fabricated last second.
    const sourceDate=clock.endOfDay?nextDate(date):date;
    const d={year:sourceDate.year,month:sourceDate.month,day:sourceDate.day,hour:clock.hour,minute:clock.minute,second:clock.second};
    const resolved=toEpoch(d,tz);
    if(resolved.error)return {status:'ambiguous',message:resolved.error,sourceZone:tz.label};
    const local=partsInZone(resolved.epoch,localZone),seconds=!!clock.secondsExplicit;
    const sourceTime=clock.endOfDay?'24:00':timeLabel(d,seconds);
    const sourceDisplay=display(date,tz.label,offsetAt(resolved.epoch,tz),sourceTime);
    const localDisplay=display(local,localZone,offsetAt(resolved.epoch,localTz),timeLabel(local,seconds));
    return {status:'ok',input:raw,sourceZone:tz.label,sourceDate:dateKey(date)+' '+(clock.endOfDay?'24:00:00':pad(d.hour)+':'+pad(d.minute)+':'+pad(d.second)),localZone,localDate:fmt(resolved.epoch,localZone),epoch:resolved.epoch,sourceKind:clock.endOfDay?'boundary':'instant',hasTime:true,sourceDisplay,localDisplay,notes,assumed:notes.length>0,anchorUsed:!date.explicit};
  }
  root.TimeLensParser={parse,fmt,detectZones,formatOffset};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.TimeLensParser;
})(typeof globalThis!=='undefined'?globalThis:this);
