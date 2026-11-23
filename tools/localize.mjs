import {readdir,access} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const tools=process.env.FLUXDO_PLUGIN_TOOLS;
const {localizeProject}=await import(tools?pathToFileURL(resolve(tools,'packages/cli/localization/compiler.mjs')).href:'@fluxdo/plugin-cli/localization');
const root=new URL('../plugins/',import.meta.url);
for(const name of await readdir(root)){const dir=new URL(name+'/',root);try{await access(new URL('fluxdo.config.json',dir));}catch{continue;}const result=await localizeProject(fileURLToPath(dir),{check:process.argv.includes('--check')});console.log(name+': '+result.strings+' 条文案');}
