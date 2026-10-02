import { TextSelection } from '@milkdown/kit/prose/state';
import { TabBar } from './after/tabs';
import './after/styles.css';
const status=document.querySelector('#status');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const frame=()=>new Promise(r=>requestAnimationFrame(r));
const assert=(ok,label)=>{if(!ok)throw new Error(label);};
const summary=values=>{const s=[...values].sort((a,b)=>a-b);return {n:s.length,median:s[Math.floor(s.length/2)],p95:s[Math.ceil(s.length*.95)-1],max:s.at(-1)};};
const tabBar=new TabBar(document.querySelector('#tabs'));
const host=document.querySelector('#editor');
const result=window.__benchmarkProgress={scope:'Chromium frontend components; HEAD vs working tree; IPC excluded',samples:30,editing:[],images:[],restore:[],save:[]};
const heap=()=>performance.memory?.usedJSHeapSize??null;
const peak=(a,b)=>a===null?b:b===null?a:Math.max(a,b);
const dataImage='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="purple"/></svg>');
async function runEditor(variant){
 const {Editor}=await import(`./${variant}/editor.ts`);
 for(const bytes of [10*1024,500*1024,2*1024*1024]){
  status.textContent=`${variant}: edit ${bytes}`;
  window.__scans=0;window.__scanMs=0;
  const editor=new Editor(host);let peakHeap=heap();
  const paragraph='PaperNest performance fixture. '+ 'plain text '.repeat(44)+'\n\n';
  const text=('# Benchmark\n\n'+paragraph.repeat(Math.ceil(bytes/paragraph.length))).slice(0,bytes);
  const start=performance.now();await editor.init(text);await delay(400);
  const coldInitMs=performance.now()-start;
  const original=editor.getMarkdown.bind(editor);let reads=0,serializeMs=0,resolveChange=null;
  editor.getMarkdown=()=>{const s=performance.now();const value=original();reads++;serializeMs+=performance.now()-s;return value;};
  editor.onChange=markdown=>{
   const s=performance.now();
   if(variant==='before'){editor.getMarkdown();editor.getMarkdown();}
   else assert(typeof markdown==='string','callback markdown');
   const done=resolveChange;resolveChange=null;if(done)done(performance.now()-s);
  };
  const callback=[],latency=[],serialize=[],counts=[];
  for(let i=0;i<30;i++){
   reads=0;serializeMs=0;const s=performance.now();
   const changed=new Promise((resolve,reject)=>{resolveChange=resolve;setTimeout(()=>{if(resolveChange===resolve){resolveChange=null;reject(new Error('markdown callback timeout'));}},5000);});
   editor.insertText('x');callback.push(await changed);latency.push(performance.now()-s);serialize.push(serializeMs);counts.push(reads);peakHeap=peak(peakHeap,heap());await frame();
  }
  result.editing.push({variant,bytes,coldInitMs,callbackMs:summary(callback),inputToCallbackMs:summary(latency),extraSerializeMs:summary(serialize),extraReads:counts,peakJsHeapBytes:peakHeap});
  await editor.destroy();host.replaceChildren();await delay(100);
 }
 for(const count of [0,20,200]){
  status.textContent=`${variant}: images ${count}`;
  const editor=new Editor(host);window.__scans=0;window.__scanMs=0;
  await editor.init('# Images\n\ntext\n\n'+Array.from({length:count},(_,i)=>`![image ${i}](${dataImage})\n\n`).join('')+'end\n');await delay(700);
  const view=editor.view();assert(view,'editor view');
  const loadScans=window.__scans,loadScanMs=window.__scanMs;
  window.__scans=0;window.__scanMs=0;const timing=[];let peakHeap=heap();
  for(let i=0;i<30;i++){
   const s=performance.now();view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,1+i%2)));timing.push(performance.now()-s);peakHeap=peak(peakHeap,heap());await frame();
  }
  if(variant==='after')assert(window.__scans===0,'selection must not scan images');
  const selectionScans=window.__scans,selectionScanMs=window.__scanMs;
  let properties=false;
  if(count){let imagePos=-1;view.state.doc.descendants((node,pos)=>{if(imagePos<0&&node.type.name==='image-block')imagePos=pos;});assert(imagePos>=0,'image node');
   const node=view.state.doc.nodeAt(imagePos);view.dispatch(view.state.tr.setNodeMarkup(imagePos,undefined,{...node.attrs,align:'right',ratio:.5,title:'Benchmark title'}));await frame();
   const image=host.querySelector('img[data-type="image-block"]');const block=image?.closest('.milkdown-image-block');properties=block?.dataset.mdmeowImageAlign==='right'&&image.title==='Benchmark title'&&image.style.width==='40px';assert(properties,'image properties');
  }
  result.images.push({variant,count,loadScans,loadScanMs,selectionMs:summary(timing),selectionScans,selectionScanMs,properties,peakJsHeapBytes:peakHeap});
  await editor.destroy();host.replaceChildren();await delay(100);
 }
}
async function runOperations(variant){
 const {makeOperations}=await import(`./${variant}/operations.js`);
 for(const count of [1,20,50]){
  status.textContent=`${variant}: restore ${count}`;
  const timing=[],reads=[];let peakHeap=heap();let restoredActive;
  const files=Array.from({length:count},(_,i)=>i%4===0?`image-${i}.png`:`file-${i}.md`);files.splice(0,0,'missing.md');
  for(let sample=0;sample<30;sample++){
   tabBar.tabs=[];tabBar.activeId='';tabBar.render();let calls=0;
   const settings={open_last_session:true,open_files:files,active_tab:1};
   const invoke=async(command,args)=>{calls++;if(args.path==='missing.md')throw new Error('missing');if(command==='read_image_data_url')return dataImage;return '# Restored\n\n'+('fixture text '.repeat(800));};
   const ops=makeOperations({secondaryWindow:false,settings,tabBar,isImagePath:path=>path.endsWith('.png'),invoke});
   const s=performance.now();await ops.restoreTabs();timing.push(performance.now()-s);reads.push(calls);peakHeap=peak(peakHeap,heap());restoredActive=tabBar.active.path;assert(tabBar.tabs.length===count,'restore count');await frame();
  }
  if(variant==='after')assert(restoredActive===files[1],'restore active identity');
  result.restore.push({variant,count,restoreMs:summary(timing),contentReads:reads,restoredActive,expectedActive:files[1],peakJsHeapBytes:peakHeap});
 }
 tabBar.tabs=[];tabBar.activeId='';const tab=tabBar.add('save.txt','original');let live='before write',resolveWrite;
 const pending=new Promise(r=>resolveWrite=r);
 const env={secondaryWindow:false,settings:{},tabBar,invoke:()=>pending,readView:()=>live,codeViewVisible:true,writeView:value=>live=value,viewScrollTop:()=>0,message:()=>{},updateTitle:()=>{},persistSoon:()=>{},saveAs:()=>{}};
 const ops=makeOperations(env);const saving=ops.saveDoc(tab);live='continued edit';resolveWrite('before write');await saving;
 if(variant==='after')assert(tab.dirty&&tab.content==='continued edit'&&live==='continued edit','in-flight edit survives');
 result.save.push({variant,dirty:tab.dirty,tabContent:tab.content,editorContent:live});
}
document.querySelector('#run').addEventListener('click',async()=>{
 document.querySelector('#run').disabled=true;
 try{for(const variant of ['before','after']){await runEditor(variant);await runOperations(variant);}window.__benchmarkResult=result;status.textContent=JSON.stringify(result,null,2);}
 catch(error){window.__benchmarkError=String(error.stack??error);status.textContent=window.__benchmarkError;}
});
