import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const folder = path.resolve('output/tmp/search-performance');
fs.mkdirSync(folder, { recursive: true });
for (const [scenario, dirs, files] of [['normal',1,100],['generated',50,100],['huge',1,10000]]) {
  const root = path.join(folder, scenario);
  for (let d=0;d<dirs;d++) {
    const dir=dirs===1?root:path.join(root,`generated-${d}`);
    fs.mkdirSync(dir,{recursive:true});
    for(let f=0;f<files;f++) {
      const file=path.join(dir,`fixture-${f}${f===files-1?'-target':''}.md`);
      if(!fs.existsSync(file))fs.writeFileSync(file,'# Search fixture\n');
    }
  }
}
let modules='';
for(const variant of ['before','after']) {
  let source=variant==='before'?execFileSync('git',['show','8a5416b493c8ad9306570e0c2fb940b7ea8e380f:src-tauri/src/workspace.rs'],{encoding:'utf8'}):fs.readFileSync('src-tauri/src/workspace.rs','utf8');
  const start=source.indexOf('pub fn search_workspace(');
  const brace=source.indexOf('{',start);let depth=1,end=brace+1;
  while(depth&&end<source.length){if(source[end]==='{')depth++;if(source[end]==='}')depth--;end++;}
  source=source.slice(0,end).replace(/^use serde::Serialize;\r?\n/m,'').replace(/^use tauri::[^\n]+\r?\n/m,'').replaceAll('#[derive(Serialize)]','').replaceAll('#[tauri::command]','');
  source=source.replace('visited += 1;', 'visited += 1; DIRS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);');
  source=source.replace('for item in items.flatten() {','for item in items.flatten() { ENTRIES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);');
  modules+=`mod ${variant} { ${source}
    static DIRS: std::sync::atomic::AtomicUsize=std::sync::atomic::AtomicUsize::new(0);
    static ENTRIES: std::sync::atomic::AtomicUsize=std::sync::atomic::AtomicUsize::new(0);
    pub fn run(root:&str)->(usize,usize,usize) {
      use std::sync::atomic::Ordering::Relaxed;
      DIRS.store(0,Relaxed);ENTRIES.store(0,Relaxed);
      let results=search_workspace(root.to_string(),"-target".to_string()).unwrap();
      (results.len(),DIRS.load(Relaxed),ENTRIES.load(Relaxed))
    }
  }\n`;
}
const runner=String.raw`
#[repr(C)] struct Memory { cb:u32,faults:u32,peak_working:usize,working:usize,peak_paged:usize,paged:usize,peak_nonpaged:usize,nonpaged:usize,pagefile:usize,peak_pagefile:usize }
#[link(name="kernel32")] extern "system" {
 fn GetCurrentProcess()->isize;
 fn K32GetProcessMemoryInfo(process:isize,counters:*mut Memory,bytes:u32)->i32;
}
fn memory()->(usize,usize){unsafe{let mut m:Memory=std::mem::zeroed();m.cb=std::mem::size_of::<Memory>() as u32;assert_ne!(K32GetProcessMemoryInfo(GetCurrentProcess(),&mut m,m.cb),0);(m.working,m.peak_working)}}
fn main(){
 let args:Vec<String>=std::env::args().collect();let root=&args[1];let variant=&args[2];
 let run:fn(&str)->(usize,usize,usize)=if variant=="before"{before::run}else{after::run};
 for scenario in ["normal","generated","huge"] {
  let dir=std::path::Path::new(root).join(scenario);let dir=dir.to_str().unwrap();
  let cold=std::time::Instant::now();let (found,dirs,entries)=run(dir);let first_ms=cold.elapsed().as_secs_f64()*1000.;
  let mut times=Vec::new();let mut peak=0;let mut max_running=0;
  for _ in 0..30 {let start=std::time::Instant::now();max_running=max_running.max(1);assert_eq!(run(dir),(found,dirs,entries));times.push(start.elapsed().as_secs_f64()*1000.);peak=peak.max(memory().0);}
  times.sort_by(|a,b|a.total_cmp(b));
  println!("{{\"variant\":\"{}\",\"scenario\":\"{}\",\"samples\":30,\"firstRunMs\":{},\"medianMs\":{},\"p95Ms\":{},\"found\":{},\"directories\":{},\"entries\":{},\"maxRunningSequential\":{},\"sampledWorkingSetPeakBytes\":{},\"processWorkingSetPeakBytes\":{}}}",variant,scenario,first_ms,times[15],times[28],found,dirs,entries,max_running,peak,memory().1);
 }
}`;
fs.writeFileSync(path.join(folder,'benchmark.rs'),modules+runner);
console.log(folder);
