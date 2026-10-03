import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { getPublicPricing, parseOpenAIPrices, parseAnthropicPrices, parseGooglePrices, parseOpenRouterPrices, PUBLIC_PRICE_SOURCES } from '../src/publicpricing.js';
import { createPriceLookup, priceRecord, storedPriceFor } from '../src/pricecatalog.js';
import { computeCost } from '../src/pricing.js';
import { createUsageDatabase } from '../src/database.js';
import { createWebDataService } from '../src/webservice.js';
import { createWebServer } from '../src/webserver.js';
import { readStoredPriceFor } from '../src/usageimports.js';
import { parseArgs } from '../src/args.js';
import { readProviderBindings, bindProvider } from '../src/providerbindings.js';

const table = (headers, rows) => `<table><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
const openai = table(['Model','Input','Cached input','Output'], [['gpt-example','$2.00','$0.50','$10.00']]) + table(['Model','Input','Cached input','Output'], [['gpt-example','$1.00','$0.25','$5.00']]);
const anthropic = table(['Name','Input','Output','5m writes','1h writes','Hits and refreshes'], [['Claude Sonnet 4.5','$3 / MTok','$15 / MTok','$3.75 / MTok','$6 / MTok','$0.30 / MTok']]);
const google = `<h2>Gemini</h2><code>gemini-example</code><h3>Standard</h3>${table(['','Free Tier','Paid Tier, per 1M tokens in USD'], [['Input price','Free','$0.30 (text / image / video)<br>$1.00 (audio)'],['Output price','Free','$2.50'],['Context caching price','Free','$0.03 (text / image / video)<br>$1.00 per hour']])}`;
const router = { data: [{ id: 'openai/gpt-example', pricing: { prompt:'0.000002', completion:'0.00001', input_cache_read:'0.0000005', input_cache_write:'0', discount:0.5,
  overrides: [{min_prompt_tokens:100, prompt:'0.000004'}, {utc_start:2300,utc_end:200,utc_days:['monday'],completion:'0.00002'}] } }] };
const usage = (extra={}) => ({ client:'codex', sessionId:'session', model:'gpt-example', timestamp: Date.parse('2026-10-02T00:00:00Z'), inputTokens:1e6,
  outputTokens:0, reasoningTokens:0, cacheReadTokens:0, cacheWriteTokens:0, costUsd:null, directory:null, title:null, ...extra });
const rate = (input=2e-6) => priceRecord({ source:'openai', name:'gpt-example', provider:'openai', input, output:10e-6, cacheRead:0.5e-6, cacheWrite:0,
  official:{channel:'openai',url:PUBLIC_PRICE_SOURCES.openai,reference:true} });
const raw = (entries=[], records=[]) => ({ entries, warnings:[], reportedCosts: new WeakSet(entries.filter(e=>e.costUsd!=null)),
  pricing:{ records, priceFor:createPriceLookup(records), sources:{}, configDir:'/fixture' } });
const mockPublic = (now) => ({ records:[rate()],sources:['openai'],warnings:[],sourceDetails:Object.fromEntries(Object.entries(PUBLIC_PRICE_SOURCES)
  .map(([source,url])=>[source,{fetchedAt:new Date(now()).toISOString(),state:'fresh',url}])) });

test('official adapters read Standard rates, collapsed OpenAI rows, cache duration and Google text prices', () => {
  assert.equal(parseOpenAIPrices(openai)[0].input,2e-6);
  const props = { tier:[0,'standard'],rows:[1,[[1,[[0,'gpt-hidden'],[0,4],[0,0.4],[0,20]]]]] };
  const island = `<astro-island component-export="TextTokenPricingTables" props="${JSON.stringify(props).replaceAll('"','&quot;')}"></astro-island>`;
  assert.equal(parseOpenAIPrices(island)[0].input,4e-6);
  const claude=parseAnthropicPrices(anthropic)[0];
  assert.equal(claude.name,'claude-sonnet-4-5'); assert.equal(claude.official.cacheWrite1h,6e-6);
  assert.equal(computeCost(usage({inputTokens:0,cacheWriteTokens:1000000,cacheWrite1hTokens:500000}),claude),4.875);
  const gemini=parseGooglePrices(google)[0];
  assert.equal(gemini.input,0.3e-6); assert.equal(gemini.cacheRead,0.03e-6);
  assert.throws(()=>parseOpenAIPrices('<p>changed page</p>'),/not found/);
  const promo=google.replace('$0.30 (text / image / video)<br>$1.00 (audio)','$0.30 through December 31, 2026<br>$0.60 starting January 1, 2027');
  assert.equal(parseGooglePrices(promo,Date.parse('2026-12-31T23:59:59Z'))[0].input,0.3e-6);
  assert.equal(parseGooglePrices(promo,Date.parse('2027-01-01T00:00:00Z'))[0].input,0.6e-6);
});

test('OpenRouter prices stay in their channel and apply discounts, context and UTC windows per key', () => {
  const records=parseOpenRouterPrices(router), lookup=createPriceLookup(records);
  assert.equal(lookup('gpt-example'),null); assert.equal(lookup('openai/gpt-example'),null);
  assert.equal(lookup('openai/gpt-example','codex',usage({providerId:'openai'})),null);
  const short=usage({providerId:'openrouter',inputTokens:100,timestamp:Date.parse('2026-10-05T22:59:00Z')});
  assert.equal(lookup('openai/gpt-example','codex',short).input,1e-6);
  const long={...short,inputTokens:101,timestamp:Date.parse('2026-10-05T23:00:00Z')};
  const price=lookup('openai/gpt-example','codex',long);
  assert.equal(price.input,2e-6); assert.equal(price.output,10e-6, 'later matching rule inherits earlier per-key override');
  assert.equal(lookup('openai/gpt-example','codex',{...long,timestamp:Date.parse('2026-10-05T02:00:00Z')}).output,5e-6);
  assert.equal(lookup('openrouter/openai/gpt-example').input,1e-6);
  const endpoints=parseOpenRouterPrices({data:{endpoints:[{tag:'openai',pricing:{prompt:'0.000003',completion:'0.00002'}}]}},'openai/gpt-example');
  const withEndpoints=createPriceLookup([...records,...endpoints]);
  assert.equal(withEndpoints('openai/gpt-example','codex',{...short,providerEndpoint:'openai'}).input,3e-6);
  assert.equal(withEndpoints('openai/gpt-example','codex',{...short,providerEndpoint:'unknown'}),null);
  assert.equal(storedPriceFor('openai/gpt-example',records[0],{...short,providerEndpoint:'unknown'}),null);
});

test('public downloads are isolated, offline does not fetch and one failed source preserves other results', async () => {
  const calls=[], bodies={openai,anthropic,google,openrouter:JSON.stringify(router)};
  const fetchImpl=async(url)=>{calls.push(url);const source=Object.entries(PUBLIC_PRICE_SOURCES).find(([,u])=>url===u)?.[0];
    if(source==='anthropic')return {ok:false,status:503};
    return {ok:true,text:async()=>bodies[source]};};
  const result=await getPublicPricing({fetchImpl,now:()=>Date.parse('2026-10-01T00:00:00Z')});
  assert.equal(calls.length,4); assert.deepEqual(result.sources,['openai','google','openrouter']);
  assert.match(result.warnings[0],/anthropic.*503/); assert.equal(result.sourceDetails.anthropic.fetchedAt,null);
  await getPublicPricing({offline:true,fetchImpl}); assert.equal(calls.length,4);
  assert.equal(parseOpenRouterPrices({data:[{id:'bad',pricing:{prompt:'-1',completion:'0'}},{id:'good',pricing:{prompt:'0',completion:'0'}}]}).length,1);
});

test('local revisions preserve old rates, reprice later requests, survive reopen and offline backup import', async (t) => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'toksight-price-history-')); let target;
  const file=path.join(dir,'usage.sqlite'); let db=createUsageDatabase({file});t.after(async()=>{db.close();target?.close();await rm(dir,{recursive:true,force:true});});
  const reported=usage({sessionId:'reported',costUsd:7});
  db.replace(raw([usage({timestamp:Date.parse('2026-09-01T00:00:00Z')}),usage(),reported]));
  const update=(record,time)=>db.updatePriceCatalog({records:[record],sources:['openai'],sourceDetails:{openai:{fetchedAt:time,state:'refreshed',url:PUBLIC_PRICE_SOURCES.openai}}},time);
  update(rate(), '2026-10-01T00:00:00.000Z'); assert.equal(db.priceStatus().revisions,1);
  update(rate(), '2026-10-01T12:00:00.000Z'); assert.equal(db.priceStatus().revisions,1);
  update(rate(1e-6), '2026-10-02T00:00:00.000Z'); assert.equal(db.priceStatus().revisions,2);
  assert.deepEqual(db.read().entries.map(e=>e.costUsd),[2,1,7]);
  update(rate(9e-6), '2026-09-01T00:00:00.000Z'); assert.deepEqual(db.read().entries.map(e=>e.costUsd),[2,1,7]);
  const bytes=db.exportDatabase();db.close(); db=createUsageDatabase({file});assert.deepEqual(db.read().entries.map(e=>e.costUsd),[2,1,7]);
  const targetFile=path.join(dir,'target.sqlite'); target=createUsageDatabase({file:targetFile});
  target.importDatabase(bytes);assert.equal(target.priceStatus().revisions,2);assert.deepEqual(target.read().entries.map(e=>e.costUsd),[2,1,7]);
  const saved=readStoredPriceFor(targetFile);
  assert.equal(saved('gpt-example','codex',usage({timestamp:Date.parse('2026-09-01T00:00:00Z')})).input,2e-6);
  assert.equal(saved('gpt-example','codex',usage()).input,1e-6);
});

test('first Web setup is local, shared, persistent and schedules updates without rescanning usage', async (t) => {
  const db=createUsageDatabase({file:':memory:'}); let scans=0,fetches=0,tick,clears=0,time=Date.parse('2026-10-01T00:00:00Z');
  const get=createWebDataService(parseArgs([]),{database:db,now:()=>time,
    collect:async(opts)=>{assert.equal(opts.offline,true);scans++;return raw([usage()]);},
    genericPricing:async()=>({records:[],warnings:[],sourceDetails:{}}),
    publicPricing:async({now})=>{fetches++;return mockPublic(now);},
    cursorPricing:async()=>({models:[],warnings:[],state:'fresh',fetchedAt:new Date(time).toISOString(),source:'https://cursor.com'}),
    setIntervalImpl:callback=>{tick=callback;return {unref(){}};},clearIntervalImpl:()=>clears++});t.after(()=>get.close());
  await get.initialize(); assert.equal(fetches,0); assert.equal(scans,1);assert.equal(get.priceStatus().completed,false);
  assert.equal((await get()).priceDatabase.completed,false);
  const [a,b]=await Promise.all([get.setup({}),get.setup({})]);assert.equal(fetches,1);assert.equal(a.completed,true);assert.equal(b.completed,true);assert.ok(tick);
  time+=8*86400000;tick();await get.updatePrices();assert.equal(fetches,2);assert.equal(scans,1);
  await get.setup({offline:true,autoUpdate:false});assert.equal(get.priceStatus().autoUpdate,false);assert.ok(clears);
  time+=8*86400000;await get();assert.equal(fetches,2);
  await get.updatePrices();assert.equal(fetches,3);
  await assert.rejects(get.setup({bad:true}),e=>e.code==='BAD_SETUP');
});

test('offline setup never fetches and new endpoints enforce method, Host, Origin and JSON validation', async (t) => {
  const get=createWebDataService(parseArgs(['--offline']),{database:createUsageDatabase({file:':memory:'}),collect:async()=>raw([]),publicPricing:async()=>{throw new Error('must not fetch');}});
  await get.initialize();const server=createWebServer({port:0,outDir:'.',getData:get});t.after(()=>server.close());const {url}=await server.start();
  assert.equal((await fetch(url+'/api/prices/status')).status,200);
  assert.equal((await fetch(url+'/api/setup')).status,405);
  assert.equal((await fetch(url+'/api/setup',{method:'POST',headers:{origin:'https://foreign.test'}})).status,403);
  const forged=await new Promise((resolve,reject)=>{const request=http.get(url+'/api/prices/status',{headers:{host:'foreign.test'}},response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});
  assert.equal(forged,403);
  assert.equal((await fetch(url+'/api/setup',{method:'POST',body:'bad json'})).status,400);
  assert.equal((await fetch(url+'/api/setup',{method:'POST',body:'{"autoUpdate":"yes"}'})).status,400);
  const response=await fetch(url+'/api/setup',{method:'POST',body:'{"offline":true}'});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.completed,true);assert.equal(body.offline,true);
  await assert.rejects(get.updatePrices(),e=>e.code==='PRICE_OFFLINE');
});

test('continuing locally defers automatic downloads and provider bindings can change by time interval', async (t) => {
  let fetches=0;
  const get=createWebDataService(parseArgs([]),{database:createUsageDatabase({file:':memory:'}),collect:async()=>raw([]),publicPricing:async()=>{fetches++;return {records:[],sources:[],sourceDetails:{},warnings:[]};}});
  t.after(()=>get.close());await get.initialize();await get.setup({offline:true});await get();assert.equal(fetches,0);
  const dir=await mkdtemp(path.join(os.tmpdir(),'toksight-bindings-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const env={TOKSIGHT_CONFIG_DIR:dir};
  await writeFile(path.join(dir,'providers.json'),JSON.stringify([
    {client:'codex',providerId:'myproxy',provider:'openai',until:'2026-10-02T00:00:00Z'},
    {client:'codex',providerId:'myproxy',provider:'openrouter',since:'2026-10-02T00:00:00Z',endpoint:'openai'},
  ]));
  const rows=readProviderBindings({env});
  const old=bindProvider(usage({providerId:'myproxy',timestamp:Date.parse('2026-10-01T00:00:00Z')}),rows);
  const current=bindProvider(usage({providerId:'myproxy'}),rows);
  assert.equal(old.pricingProvider,'openai');assert.equal(current.pricingProvider,'openrouter');assert.equal(current.providerEndpoint,'openai');
  assert.equal(bindProvider(current,[]).pricingProvider,undefined);
  assert.equal(createPriceLookup([rate()])('gpt-example','codex',old).input,2e-6);
  assert.equal(createPriceLookup([rate()])('gpt-example','codex',usage({providerId:'myproxy'})),null);
  assert.equal(bindProvider(old,[rows[0],rows[0]]).pricingProvider,undefined, 'ambiguous bindings remain unknown');
});
