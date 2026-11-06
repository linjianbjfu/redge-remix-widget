/** Direct JSON generation client; GEC provider output is refreshed for each attempt. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {GENERATION_PATH} from '../backend/src/generation.ts';
import {FIXED_WIDGET} from '../backend/src/widget-contract.ts';
import {capturePage} from './capture-page.mjs';
import {saveCaptureDebug} from './capture-debug.mjs';
import {Agent} from 'undici';

const exec = promisify(execFile);
export const GENERATION_TIMEOUT_MS = 600_000;
export const GENERATE_USAGE = `usage: webclip generate <instruction> --url <http(s)-url> [--select] [--out <directory>]
       webclip generate <instruction> --file <snapshot.html> --source-url <http(s)-url> [--select]
       webclip generate --json <request.json> [--out <directory>]
  --gec-provider <executable>  Read JSON GEC headers from stdout on every attempt.
  --retries <0-5>             Retry network errors, HTTP 429 and 5xx; default 0.
  --timeout-ms <milliseconds> Per-attempt timeout; default 600000.
  --title <title>             Override the captured page title.
  Environment: WEBCLIP_URL, WEBCLIP_GEC_PROVIDER or WEBCLIP_GEC + WEBCLIP_GEC_VERSION.`;

export function parseGenerateArgs(args) {
  if (args.length === 1 && args[0] === '--help') return {help: true};
  const options = {files: [], words: [], retries: 0, timeoutMs: GENERATION_TIMEOUT_MS};
  const values = {'--url':'url', '--file':'file', '--source-url':'sourceUrl', '--json':'json', '--out':'out',
    '--gec-provider':'provider', '--retries':'retryValue', '--timeout-ms':'timeoutValue', '--title':'title'};
  const seen = new Set();
  for (let i=0; i<args.length; i++) {
    const flag = args[i];
    if (flag === '--select') {if (seen.has(flag)) throw new Error('Duplicate --select'); seen.add(flag); options.select = true; continue;}
    if (!flag.startsWith('--')) {options.words.push(flag); continue;}
    if (!values[flag] || seen.has(flag)) throw new Error('Unknown or duplicate argument: '+flag);
    seen.add(flag); const value = args[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(flag+' requires a value');
    options[values[flag]] = value;
  }
  if (options.retryValue !== undefined) {
    if (!/^[0-5]$/.test(options.retryValue)) throw new Error('--retries must be 0 through 5');
    options.retries = Number(options.retryValue);
  }
  if (options.timeoutValue !== undefined) {
    options.timeoutMs = Number(options.timeoutValue);
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_147_483_647) throw new Error('--timeout-ms must be an integer from 1 through 2147483647');
  }
  if (options.json) {
    if (options.url || options.file || options.sourceUrl || options.select || options.words.length || options.title !== undefined) throw new Error('--json cannot be combined with capture arguments');
  } else {
    if (!options.words.length || !(options.url || options.file) || options.url && options.file) throw new Error(GENERATE_USAGE);
    if (options.file && !options.sourceUrl) throw new Error('--file requires --source-url');
    if (options.file) options.files = [options.file];
  }
  return options;
}

export function gecProvider({command, env = process.env, signal} = {}) {
  return async () => {
    signal?.throwIfAborted();
    if (command) {
      let stdout;
      try { ({stdout} = await exec(command, [], {encoding:'utf8', maxBuffer:64*1024, ...(signal ? {signal} : {})})); }
      catch { signal?.throwIfAborted(); throw new Error('GEC provider command failed'); }
      try { return JSON.parse(stdout); } catch { throw new Error('GEC provider must output a JSON object'); }
    }
    return {'Sec-MS-GEC': env.WEBCLIP_GEC, 'Sec-MS-GEC-Version': env.WEBCLIP_GEC_VERSION};
  };
}

export function generationHeaders(provided) {
  const value = name => provided instanceof Headers ? provided.get(name)
    : Object.entries(provided ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const token = value('Sec-MS-GEC'), version = value('Sec-MS-GEC-Version');
  if (typeof token !== 'string' || !token.trim() || typeof version !== 'string'
    || !version.startsWith('1-') || !version.slice(2).trim()) throw new Error('GEC provider must return a nonempty Sec-MS-GEC and Sec-MS-GEC-Version beginning with 1- plus a version');
  return {'Content-Type':'application/json', 'Sec-MS-GEC':token, 'Sec-MS-GEC-Version':version,
    'Cache-Control':'no-store, no-cache', Pragma:'no-cache'};
}

/** Match the native client's response rules, including permissive optional metadata. */
export function generationResult(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object' || value.status !== 'Success') throw new Error('Generation response status must be Success');
  for (const key of ['extractScript', 'widgetHtml']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].includes('\0') || !value[key].isWellFormed()) throw new Error('Generation response requires nonempty UTF-8 '+key+' without NUL');
  }
  return {status:'Success', extractScript:value.extractScript, widgetHtml:value.widgetHtml,
    title:typeof value.title === 'string' ? value.title : '', size:typeof value.size === 'string' ? value.size : '',
    width:Number.isInteger(value.width) ? value.width : 0, height:Number.isInteger(value.height) ? value.height : 0};
}

/** Optional timing covers the first HTTP dispatch through response validation, including retries. */
export async function requestGeneration({baseUrl, input, getHeaders, fetchImpl = fetch, retries = 0, timeoutMs = GENERATION_TIMEOUT_MS, signal, now = () => performance.now(), onTiming}) {
  const body = JSON.stringify({...input, history:[]});
  let startedAt, attempts=0;
  try {
    for (let attempt=0;;attempt++) {
      signal?.throwIfAborted();
      const headers = generationHeaders(await getHeaders());
      const deadline = AbortSignal.timeout(timeoutMs);
      const attemptSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
      // Node's default five-minute header timeout is shorter than this command's long request budget.
      const dispatcher = new Agent({headersTimeout:timeoutMs,bodyTimeout:timeoutMs});
      let response, text;
      try {
        if (startedAt === undefined) startedAt=now();
        attempts++;
        response = await fetchImpl(baseUrl.replace(/\/+$/, '')+GENERATION_PATH, {
          method:'POST', headers, body, credentials:'omit', cache:'no-store', redirect:'error', signal:attemptSignal, dispatcher,
        });
        if (!response.ok) {
          await response.body?.cancel();
          if (attempt < retries && (response.status === 429 || response.status >= 500)) continue;
          throw Object.assign(new Error('Generation HTTP '+response.status), {http:true});
        }
        text = await response.text();
      } catch (error) {
        if (signal?.aborted || attempt >= retries || error.http) throw error;
        continue;
      } finally {
        await dispatcher.destroy();
      }
      return generationResult(JSON.parse(text));
    }
  } finally {
    if (startedAt !== undefined) onTiming?.({elapsedMs:now()-startedAt,attempts});
  }
}

export async function saveGeneration(result, directory) {
  const out = resolve(directory);
  await mkdir(dirname(out), {recursive:true});
  const staging = await mkdtemp(join(dirname(out), '.generation-'));
  try {
    const files = {'extra.js':result.extractScript, 'widget.html':result.widgetHtml,
      'meta.json':JSON.stringify({size:FIXED_WIDGET.size}), 'response.json':JSON.stringify(result,null,2)};
    for (const [name,text] of Object.entries(files)) await writeFile(join(staging,name),text,'utf8');
    await mkdir(out,{recursive:true});
    for (const name of Object.keys(files)) await rename(join(staging,name),join(out,name));
    return out;
  } finally {await rm(staging,{recursive:true,force:true});}
}

export async function runGenerateCommand(args, {env = process.env, capture = capturePage, report = console.log} = {}) {
  const options = parseGenerateArgs(args);
  if (options.help) {report(GENERATE_USAGE); return;}
  if (!env.WEBCLIP_URL) throw new Error('WEBCLIP_URL must be set');
  const stop = new AbortController(), cancel = () => stop.abort();
  process.on('SIGINT',cancel); process.on('SIGTERM',cancel);
  let captured;
  try {
    let input;
    if (options.json) input = JSON.parse(await readFile(options.json,'utf8'));
    else {
      captured = await capture({url:options.url,files:options.files,select:options.select}, {signal:stop.signal,pngOnly:true});
      if (!captured) {report('Capture cancelled; nothing sent.'); return;}
      const image = captured.capture.images[0];
      input = {userQuery:options.words.join(' '), url:options.sourceUrl ?? captured.capture.pageUrl ?? options.url,
        pageTitle:options.title ?? captured.pageTitle ?? '',
        htmlContent:await readFile(captured.files.find(path=>basename(path)==='source.html'),'utf8'), history:[],
        ...(image ? {input_image:'data:image/png;base64,'+(await readFile(captured.files.find(path=>basename(path)===image.file))).toString('base64')} : {})};
    }
    const result = await requestGeneration({baseUrl:env.WEBCLIP_URL,input,
      getHeaders:gecProvider({command:options.provider ?? env.WEBCLIP_GEC_PROVIDER,env,signal:stop.signal}),
      retries:options.retries,timeoutMs:options.timeoutMs,signal:stop.signal,
      onTiming:({elapsedMs,attempts})=>report(`Request elapsed: ${(elapsedMs/1000).toFixed(3)}s${attempts>1?` (${attempts} attempts)`:''}`)});
    const out = await saveGeneration(result,options.out ?? join('downloads','direct-'+crypto.randomUUID()));
    if (captured) await saveCaptureDebug({directory:out,captured});
    else {
      await mkdir(join(out,'capture'),{recursive:true});
      await writeFile(join(out,'capture/source.html'),input.htmlContent,'utf8');
      await writeFile(join(out,'capture/capture.json'),JSON.stringify({pageUrl:input.url,viewport:{width:1280,height:900}}));
    }
    report(JSON.stringify(result)); report('Saved widget: '+out);
    return {result,out};
  } finally {
    await captured?.dispose(); process.off('SIGINT',cancel); process.off('SIGTERM',cancel);
  }
}
