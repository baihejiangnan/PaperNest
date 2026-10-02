import { mockIPC } from '@tauri-apps/api/mocks';
import { Editor } from './after/editor';
import { ImagePreview } from './after/image-preview';
import { message } from './after/dialogs';
import { activateModal, deactivateModal } from './after/modal';
import './after/styles.css';
const variant=new URLSearchParams(location.search).get('variant')??'after';
const {WorkspaceSidebar}=await import(`./${variant}/workspace-sidebar.ts`);
const status=document.querySelector('#status');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const check=(condition,label)=>{if(!condition)throw new Error(label);};
const image='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="purple"/></svg>');
const searches=[];const loads=[];let nativeErrors=0,peakTasks=0,running=0;
mockIPC((command,args)=>{
 if(command==='list_workspace_dir')return {path:args.path,parent:'/',entries:[]};
 if(command==='search_workspace'){
  running++;peakTasks=Math.max(peakTasks,running);
  return new Promise((resolve,reject)=>searches.push({args,resolve:value=>{running--;resolve(value);},reject:value=>{running--;reject(value);}}));
 }
 if(command==='read_image_data_url')return new Promise(resolve=>loads.push(()=>resolve(image)));
 if(command==='plugin:dialog|message'){nativeErrors++;return;}
 throw new Error(`unexpected IPC ${command}`);
});
const workspace=new WorkspaceSidebar();
const result=window.__regressionProgress={variant,search:[],ownership:[],asyncImages:null};
const input=document.querySelector('#workspace-search');
const results=document.querySelector('#workspace-search-results');
const setQuery=value=>{input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
const entry=query=>[{name:`${query}-result.md`,path:`/a/${query}-result.md`,is_dir:false}];
async function searchCases(){
 await workspace.setRoot('/a');workspace.openSearch();
 for(const kind of ['change','clear','root','close','error']){
  let stale=0;const beforeErrors=nativeErrors;
  for(let i=0;i<30;i++){
   await workspace.setRoot('/a');workspace.openSearch();setQuery('old');await wait(230);
   const old=searches.shift();check(old,'old query must start');
   if(kind==='change'||kind==='error')setQuery('new');
   if(kind==='clear')setQuery('');
   if(kind==='root')await workspace.setRoot('/b');
   if(kind==='close')workspace.toggleSearch();
   if(kind==='error')old.reject(new Error('stale query error'));else old.resolve(entry('old'));
   await wait(20);
   if(!results.hidden&&results.textContent.includes('old-result'))stale++;
   if(document.querySelector('.app-dialog-overlay')){stale++;document.querySelector('.app-dialog-close').click();}
   await wait(220);
   for(const query of searches.splice(0))query.resolve(entry(query.args.query));
   await wait(10);
  }
  const staleErrors=nativeErrors-beforeErrors;
  if(variant==='after')check(stale===0&&staleErrors===0,`stale ${kind} must be ignored`);
  result.search.push({kind,samples:30,stalePresentations:stale,staleErrors});
 }
 // No Rust cancellation was implemented. Show that invalidation prevents stale
 // presentation while both already-started mocked requests can still finish.
 await workspace.setRoot('/a');workspace.openSearch();setQuery('old');await wait(230);setQuery('new');await wait(230);
 check(searches.length===2,'two started requests');const [old,newer]=searches.splice(0);newer.resolve(entry('new'));await wait(20);old.resolve(entry('old'));await wait(20);
 if(variant==='after')check(!results.textContent.includes('old-result'),'overlapping old result');
 result.overlap={peakRunningMockedRequests:peakTasks,remainingRequests:running};workspace.show(false);
}
async function editorCases(){
 const editor=new Editor(document.querySelector('#editor'));let callbacks=[];editor.onChange=text=>callbacks.push(text);
 await editor.init('# Old heading\n\nOld text');await wait(300);callbacks=[];
 editor.insertText('x');editor.setContent('# New document\n\nNew text');await wait(350);
 check(callbacks.length===0,'old callback after host replacement');result.ownership.push('old callback rejected after setContent');
 editor.insertText('y');await wait(350);check(callbacks.length===1&&callbacks[0].includes('yNew document'),'heading edit callback');result.ownership.push('heading edit accepted after generated ID update');
 callbacks=[];editor.insertText('z');await editor.destroy();await editor.init('# Rebuilt document');await wait(350);check(callbacks.length===0,'old callback after rebuild');result.ownership.push('old callback rejected after rebuild');
 window.__scans=0;window.__scanMs=0;editor.setDocPath('/a/images.md');
 editor.setContent('# Async images\n\n'+Array.from({length:20},(_,i)=>`![image ${i}](image-${i}.png)\n\n`).join('')+'<img src="html-image.png" alt="HTML image">\n');
 await wait(80);const requested=loads.length;check(requested>=21,'Markdown and HTML image IPC');loads.splice(0).forEach(resolve=>resolve());await wait(350);
 const images=[...document.querySelector('#editor').querySelectorAll('img[data-type]')];check(images.length>=21&&images.every(img=>img.naturalWidth>0),'async Markdown and HTML images load');
 result.asyncImages={requested,loaded:images.length,scans:window.__scans,scanMs:window.__scanMs};
 await editor.destroy();
}
document.querySelector('#run').addEventListener('click',async()=>{
 document.querySelector('#run').disabled=true;
 try{const mode=new URLSearchParams(location.search).get('mode');if(mode!=='editor'&&mode!=='ui'){status.textContent='Running search races';await searchCases();}if(variant==='after'&&mode!=='ui'){status.textContent='Running ownership and image regressions';await editorCases();}window.__regressionResult=result;status.textContent=JSON.stringify(result,null,2);}
 catch(error){window.__regressionError=String(error.stack??error);status.textContent=window.__regressionError;}
});
const preview=new ImagePreview();document.querySelector('#preview').addEventListener('click',()=>preview.open(image,'Gesture regression image'));
document.querySelector('#nested').addEventListener('click',()=>{
 const root=document.createElement('div');root.className='app-dialog-overlay';root.innerHTML='<section class="app-dialog-card"><button id="inner-message">Open message</button><button id="close-outer">Close outer</button></section>';
 const close=()=>{deactivateModal(root);root.remove();};document.body.append(root);activateModal(root,close);
 root.querySelector('#close-outer').onclick=close;root.querySelector('#inner-message').onclick=()=>void message('Nested regression message');
});
