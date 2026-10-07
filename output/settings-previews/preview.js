(() => {
  const variant = document.body.dataset.variant;
  const names = { a: 'A · 左侧分类', b: 'B · 紧凑标签', c: 'C · 右侧抽屉', d: 'A＋C · 组合方案' };
  const routes = { a: 'a-sidebar.html', b: 'b-top-tabs.html', c: 'c-drawer.html', d: 'd-combined.html' };
  const icons = {
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    files: '<path d="M3 6h7l2 2h9v12H3z"/>',
    outline: '<path d="M4 5h2M10 5h10M4 12h2M10 12h10M4 19h2M10 19h10"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    gear: '<path d="m9 3-.5 2-2 1-2-.5-2 3.5 1.5 1.5v3L2.5 15l2 3.5 2-.5 2 1L9 21h6l.5-2 2-1 2 .5 2-3.5-1.5-1.5v-3L21.5 9l-2-3.5-2 .5-2-1L15 3z"/><circle cx="12" cy="12" r="3"/>',
    editor: '<path d="m4 17 12-12 3 3L7 20H4zm10-10 3 3"/>',
    shortcuts: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1m3 0h1M8 16h8"/>',
    associations: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5"/>',
    updates: '<path d="M20 7a8 8 0 1 0 0 10M20 3v5h-5"/>',
    about: '<circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7h.01"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
  };
  const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.gear}</svg>`;
  const tabs = [ ['general','常规','gear','语言、外观与窗口行为'], ['editor','编辑器','editor','阅读字体与编辑体验'], ['shortcuts','快捷键','shortcuts','常用操作的按键绑定'], ['associations','文件关联','associations','选择由 PaperNest 打开的文件类型'], ['updates','更新','updates','版本信息与更新偏好'] ];
  const state = { language:'zh-CN', color_scheme:'light', accent:'#8a5cf5', confirm_delete:true, quit_on_escape:false, always_show_tabbar:false, open_last_session:true, remember_window_position:true, proxy_enabled:false, proxy_url:'http://127.0.0.1:7897', spellcheck:false, show_path:false, list_marker:'*', editor_font:'', editor_font_size:16, source_font:'', source_font_size:15, code_alternate_rows:true, code_alternate_row_color:'#f6f6f6', auto_check_updates:false };
  const f = (key,label,kind,hint='',options) => ({key,label,kind,hint,options});
  const groups = {
    general:[
      {title:'语言与外观',fields:[f('language','界面语言','select','菜单与设置界面使用的语言',[['system','跟随系统'],['zh-CN','简体中文'],['en','English'],['de','Deutsch'],['ja','日本語']]),f('color_scheme','主题','theme','浅色、深色，或跟随系统'),f('accent','强调色','color','用于选中状态、链接与键盘焦点')]},
      {title:'窗口与会话',fields:[f('open_last_session','恢复上次会话','toggle','启动时重新打开之前的标签页'),f('remember_window_position','记住窗口位置和大小','toggle'),f('always_show_tabbar','始终显示标签栏','toggle','即使只打开一个文件'),f('quit_on_escape','按 Esc 退出应用','toggle')]},
      {title:'文件操作',fields:[f('confirm_delete','删除前询问','toggle','删除的文件移入系统回收站')]},
      {title:'网络代理',fields:[f('proxy_enabled','使用代理','toggle','用于远程图片与检查更新'),f('proxy_url','代理地址','proxy','支持 HTTP、HTTPS 与 SOCKS5')]}
    ],
    editor:[
      {title:'正文与源码字体',fields:[f('editor_font','正文字体','font','留空使用系统默认'),f('editor_font_size','正文字号','number','8–40 px'),f('source_font','源码字体','font','留空使用默认等宽字体'),f('source_font_size','源码字号','number','8–40 px')]},
      {title:'阅读与编辑',fields:[f('spellcheck','拼写检查','toggle'),f('show_path','显示完整文件路径','toggle','显示在文档标题栏'),f('list_marker','无序列表标记','select','保存 Markdown 时使用的标记',[['*','* 星号'],['-','- 短横线'],['+','+ 加号']])]},
      {title:'代码显示',fields:[f('code_alternate_rows','代码隔行底色','toggle'),f('code_alternate_row_color','隔行颜色','color','默认跟随应用主题')]}
    ],
    shortcuts:[{title:'文档与编辑',fields:[['new_tab','新建标签页','Ctrl+N'],['open','打开文件','Ctrl+O'],['save','保存','Ctrl+S'],['save_as','另存为','Ctrl+Shift+S'],['close_tab','关闭标签页','Ctrl+W'],['export','导出 HTML / PDF','Ctrl+E'],['toggle_source','正文 / 源码切换','Ctrl+/'],['find','查找','Ctrl+F'],['replace','替换','Ctrl+H'],['emoji','表情符号','Ctrl+.'],['settings','打开设置','Ctrl+,']].map(([key,label,value])=>({...f(key,label,'shortcut'),value}))}],
    associations:[],
    updates:[{title:'更新偏好',fields:[f('auto_check_updates','自动检查更新','toggle','启动时检查，距离上次尝试至少 24 小时；下载与安装由你确认')]}]
  };
  let active = variant === 'd' ? 'editor' : 'general', query = '', sampleMode = 'body';
  const root = document.querySelector('#preview-root');
  root.innerHTML = `<header class="preview-bar"><a class="preview-home" href="index.html">${svg('panel')}<span>PaperNest · 设置方案</span></a><nav class="scheme-nav" aria-label="预览方案">${Object.entries(names).map(([id,name])=>`<a href="${routes[id]}" ${id===variant?'aria-current="page"':''}>${name}</a>`).join('')}</nav><span class="prototype-note">界面预览 · 不修改实际设置</span></header>
    <main class="demo-window">
      <aside class="demo-rail" aria-label="左侧功能栏"><button title="侧栏开关" aria-label="侧栏开关">${svg('panel')}</button><i></i><button title="文件" aria-label="文件" class="rail-active">${svg('files')}</button><button title="大纲" aria-label="大纲">${svg('outline')}</button><button title="搜索" aria-label="搜索">${svg('search')}</button><span></span><button class="open-settings rail-active" title="设置" aria-label="打开设置">${svg('gear')}</button><button title="关于" aria-label="关于">${svg('about')}</button></aside>
      <div class="document-frame"><header class="demo-titlebar"><span>README.md <b>×</b></span><span>＋</span><div>—　□　×</div></header><div class="demo-workspace"><aside class="demo-tree"><div>文件 <span>大纲</span></div><p>⌄　PaperNest</p><p>　 ›　docs</p><p>　 ›　src</p><p class="selected">　　README.md</p><p>　　TODO.md</p></aside><article class="demo-document"><div class="doc-breadcrumb">README.md</div><h1>把注意力留给文字</h1><p>纸间 PaperNest 是一个面向本地文件的轻量阅读与编辑工具。</p><h2>阅读，也可以轻量编辑</h2><p>直接打开 Markdown，整理标题、插入链接和图片。在正文和源码之间切换，保留你的阅读位置。</p><blockquote>文档是中心。设置只在需要时出现。</blockquote><ul><li>本地文件，多标签页阅读</li><li>所见即所得与源码编辑</li><li>查找、链接和图片预览</li></ul><pre><code># PaperNest\n\n- 轻量阅读\n- 保留原始 Markdown</code></pre></article></div></div>
      <div class="settings-shade"></div><section class="settings-demo" aria-label="设置界面预览"><header class="settings-heading"><div class="heading-title">${svg('gear')}<span>设置</span></div><label class="search-box">${svg('search')}<input type="search" placeholder="搜索设置…" aria-label="搜索设置"></label><button class="close-settings icon-button" title="关闭设置" aria-label="关闭设置">${svg('close')}</button></header><div class="settings-body"><nav class="settings-navigation" aria-label="设置分类">${tabs.map(([id,label,icon])=>`<button data-tab="${id}" ${id===active?'aria-current="page"':''}>${svg(icon)}<span>${label}</span></button>`).join('')}<div class="nav-meta"><strong>纸间 PaperNest</strong><span>版本 0.1.1</span></div></nav><div class="content-scroll"><header class="page-heading"><span class="eyebrow"></span><h1></h1><p></p></header><div class="settings-fields"></div></div></div><footer class="settings-footer"><span class="save-status">${svg('check')}<span>更改即时生效 · 仅本页预览</span></span><span class="config-location">settings.toml</span></footer></section>
    </main>`;
  const panel = root.querySelector('.settings-demo');
  const content = root.querySelector('.settings-fields');
  const status = root.querySelector('.save-status span');
  const notice = text => {status.textContent=text;};
  if (variant === 'd') {
    const area = root.querySelector('.content-scroll');
    const workbench = document.createElement('div'); workbench.className='editor-workbench';
    area.replaceWith(workbench);workbench.append(area);
    const preview = document.createElement('aside');preview.className='live-type-preview';preview.setAttribute('aria-label','字体效果预览');
    preview.innerHTML=`<header class="type-preview-heading"><h2>效果预览</h2><p>中文、英文与代码，随设置即时变化。</p></header><div class="sample-tabs" role="tablist" aria-label="预览内容"><button type="button" role="tab" id="sample-body-tab" data-sample="body" aria-controls="sample-body" aria-selected="true">正文示例</button><button type="button" role="tab" id="sample-source-tab" data-sample="source" aria-controls="sample-source" aria-selected="false" tabindex="-1">源码示例</button></div><div class="sample-meta"><span class="sample-font-name"></span><span class="sample-font-size"></span></div><section class="type-sample body-sample" id="sample-body" role="tabpanel" aria-labelledby="sample-body-tab"><div class="sample-kicker">PAPERNEST / 纸间</div><h2>读得舒服，写得自然</h2><p>字体不只改变文字的样子，也改变阅读时的节奏。</p><p>PaperNest keeps your notes close, and your workspace quiet.</p><h3>把注意力留给文字</h3><ul><li>理清标题，组织想法</li><li>链接文档，保留线索</li><li>中英混排，清晰易读</li></ul><blockquote>一点调整，找到适合自己的阅读方式。</blockquote><p>也可以试试 <a href="#" class="sample-link">文档链接</a> 与 <strong>重点内容</strong>。</p></section><section class="type-sample source-sample" id="sample-source" role="tabpanel" aria-labelledby="sample-source-tab" hidden><div class="sample-code-line"><span>1</span><code><b>#</b> 阅读与记录</code></div><div class="sample-code-line"><span>2</span><code></code></div><div class="sample-code-line"><span>3</span><code><b>-</b> 本地 Markdown 文件</code></div><div class="sample-code-line"><span>4</span><code><b>-</b> Keep your notes close.</code></div><div class="sample-code-line"><span>5</span><code></code></div><div class="sample-code-line"><span>6</span><code><b>const</b> note = <i>"PaperNest"</i>;</code></div><div class="sample-code-line"><span>7</span><code>console.log(note);</code></div></section><div class="sample-footnote"><p>仅调整示例显示，不改变文档内容。</p><button type="button" class="reset-fonts">恢复字体默认值</button></div>`;
    workbench.append(preview);
    const buttons = [...preview.querySelectorAll('[data-sample]')];
    buttons.forEach((button,index)=>{
      button.onclick=()=>{sampleMode=button.dataset.sample;syncDocument();};
      button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:(index+1)%2;buttons[next].click();buttons[next].focus();};
    });
    preview.querySelector('.sample-link').onclick=event=>event.preventDefault();
    preview.querySelector('.reset-fonts').onclick=()=>{
      Object.assign(state,{editor_font:'',editor_font_size:16,source_font:'',source_font_size:15});
      ['editor_font','editor_font_size','source_font','source_font_size'].forEach(key=>{const input=root.querySelector('#field-'+key);if(input)input.value=state[key];});
      syncDocument();notice('字体预览已恢复默认值');
    };
  }
  function syncDocument() {
    const scheme = state.color_scheme === 'system' ? (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light') : state.color_scheme;
    document.documentElement.dataset.theme=scheme;
    document.documentElement.style.setProperty('--accent',state.accent);
    root.querySelector('.demo-document').style.fontSize=state.editor_font_size+'px';
    root.querySelector('.demo-document').style.fontFamily=state.editor_font || '';
    root.querySelector('.demo-document pre').style.fontSize=state.source_font_size+'px';
    root.querySelector('.demo-document pre').style.fontFamily=state.source_font || '';
    const preview=root.querySelector('.live-type-preview');
    if(preview){
      const body=preview.querySelector('.body-sample'),source=preview.querySelector('.source-sample');
      body.style.fontSize=state.editor_font_size+'px';body.style.fontFamily=state.editor_font || '"Segoe UI","Microsoft YaHei",system-ui,sans-serif';
      source.style.fontSize=state.source_font_size+'px';source.style.fontFamily=state.source_font || 'Consolas,"Cascadia Code",monospace';
      source.dataset.striped=String(state.code_alternate_rows);
      source.style.setProperty('--sample-row-color',state.code_alternate_row_color==='#f6f6f6'?'var(--subtle)':state.code_alternate_row_color);
      body.hidden=sampleMode!=='body';source.hidden=sampleMode!=='source';
      preview.querySelectorAll('[data-sample]').forEach(button=>{const selected=button.dataset.sample===sampleMode;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});
      preview.querySelector('.sample-font-name').textContent=sampleMode==='body'?(state.editor_font||'系统默认字体'):(state.source_font||'默认等宽字体');
      preview.querySelector('.sample-font-size').textContent=(sampleMode==='body'?state.editor_font_size:state.source_font_size)+' px';
    }
  }
  function changed(key,value) {state[key]=value;if(key.startsWith('source_')||key.startsWith('code_alternate'))sampleMode='source';else if(key.startsWith('editor_'))sampleMode='body';syncDocument();notice('预览已更新 · 实际设置未修改');}
  function fieldRow(field) {
    const row=document.createElement('div'); row.className='setting-row';row.dataset.key=field.key;
    const copy=document.createElement('div');copy.className='setting-copy';
    const label=document.createElement('label');label.htmlFor='field-'+field.key;label.textContent=field.label;copy.append(label);
    if(field.hint){const hint=document.createElement('p');hint.textContent=field.hint;copy.append(hint);}
    const control=document.createElement('div');control.className='setting-control';row.append(copy,control);
    if(field.kind==='theme') {
      const segment=document.createElement('div');segment.className='theme-choice';segment.setAttribute('role','group');segment.setAttribute('aria-label','主题');
      [['light','浅色'],['dark','深色'],['system','系统']].forEach(([value,label])=>{const b=document.createElement('button');b.textContent=label;b.type='button';b.setAttribute('aria-pressed',String(state.color_scheme===value));b.onclick=()=>{changed(field.key,value);segment.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));};segment.append(b);});control.append(segment);
    } else if(field.kind==='shortcut') {
      const button=document.createElement('button');button.id=label.htmlFor;button.className='shortcut-key';button.textContent=field.value;button.setAttribute('aria-label','修改'+field.label+'快捷键');
      button.onclick=()=>{button.textContent='按下新组合键…';button.classList.add('listening');button.focus();};
      button.onkeydown=e=>{if(!button.classList.contains('listening'))return;e.preventDefault();e.stopPropagation();if(['Control','Shift','Alt','Meta'].includes(e.key))return;if(e.key==='Escape'){button.textContent=field.value;button.classList.remove('listening');return;}field.value=[e.ctrlKey?'Ctrl':'',e.metaKey?'Cmd':'',e.altKey?'Alt':'',e.shiftKey?'Shift':'',e.key.length===1?e.key.toUpperCase():e.key].filter(Boolean).join('+');button.textContent=field.value;button.classList.remove('listening');notice('快捷键预览已更新');};control.append(button);
    } else {
      let input;
      if(field.kind==='select'){input=document.createElement('select');field.options.forEach(([value,text])=>{const o=document.createElement('option');o.value=value;o.textContent=text;input.append(o);});input.value=state[field.key];}
      else {input=document.createElement('input');input.type=field.kind==='toggle'?'checkbox':field.kind==='color'?'color':field.kind==='number'?'number':'text';
        if(field.kind==='toggle'){input.checked=state[field.key];input.setAttribute('role','switch');input.setAttribute('aria-checked',String(input.checked));}
        else{input.value=state[field.key];if(field.kind==='font')input.placeholder=field.key==='source_font'?'默认等宽字体':'系统默认';if(field.kind==='number'){input.min='8';input.max='40';input.step='1';}}
      }
      input.id=label.htmlFor;input.setAttribute('aria-label',field.label);
      const update=()=>{let value=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;if(input.type==='number'&&(!input.validity.valid||!input.value))return;if(input.type==='checkbox')input.setAttribute('aria-checked',String(input.checked));changed(field.key,value);if(field.key==='proxy_enabled'){const address=root.querySelector('#field-proxy_url');if(address)address.disabled=!value;}};
      input.addEventListener('input',update);
      if(field.kind==='toggle'){const wrap=document.createElement('label');wrap.className='switch';wrap.append(input,document.createElement('span'));control.append(wrap);}
      else {control.append(input);if(field.kind==='number'){const unit=document.createElement('span');unit.className='unit';unit.textContent='px';control.append(unit);}if(field.kind==='color'){const code=document.createElement('code');code.textContent=input.value;input.addEventListener('input',()=>code.textContent=input.value);control.append(code);const reset=document.createElement('button');reset.className='text-button';reset.textContent='默认';reset.onclick=()=>{input.value=field.key==='accent'?'#8a5cf5':'#f6f6f6';input.dispatchEvent(new Event('input'));};control.append(reset);}}
      if(field.kind==='proxy')input.disabled=!state.proxy_enabled;
    }
    return row;
  }
  function groupSection(title,fields){const section=document.createElement('section');section.className='setting-group';const h=document.createElement('h2');h.textContent=title;section.append(h,...fields.map(fieldRow));content.append(section);}
  const assocSelected=new Set(['md','markdown','mdx']);
  function associations(){
    const summary=document.createElement('div');summary.className='association-summary';summary.innerHTML='<div><strong>文件类型</strong><p>选择要在“打开方式”中注册的扩展名。</p></div><span class="association-count"></span>';content.append(summary);
    [['Markdown',['md','markdown','mdx']],['配置与数据',['json','yaml','yml','xml','toml','ini','conf','env','jsonl','csv']],['网页与脚本',['html','htm','css','scss','less','js','mjs','cjs','ts','jsx','tsx','vue']],['代码',['py','rs','c','cpp','cc','h','hpp','java','go','php','sql','sh','bash','ps1','rb','swift','kt','kts','cs']],['纯文本',['txt','log']]].forEach(([label,exts])=>{
      const group=document.createElement('section');group.className='association-group';group.innerHTML=`<h2>${label}</h2><div class="extensions"></div>`;
      exts.forEach(ext=>{const l=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.checked=assocSelected.has(ext);input.setAttribute('aria-label','关联 .'+ext);input.onchange=()=>{input.checked?assocSelected.add(ext):assocSelected.delete(ext);updateCount();notice('文件关联选择预览已更新');};const code=document.createElement('code');code.textContent='.'+ext;l.append(input,code);group.querySelector('.extensions').append(l);});content.append(group);
    });
    const actions=document.createElement('div');actions.className='system-actions';actions.innerHTML='<p>默认应用仍需在 Windows 设置中选择。</p><button type="button" class="primary-button">注册所选类型</button><button type="button">打开默认应用设置</button>';actions.querySelectorAll('button').forEach(b=>b.onclick=()=>notice('布局预览 · 未修改 Windows 文件关联'));content.append(actions);
    function updateCount(){summary.querySelector('.association-count').textContent=assocSelected.size+' 项已选';}updateCount();
  }
  function updates(){const box=document.createElement('section');box.className='version-block';box.innerHTML=`<div class="version-icon">${svg('updates')}</div><div><span class="version-caption">当前版本</span><h2>PaperNest <code>v0.1.1</code></h2><p class="version-state" role="status">从本项目的 GitHub Releases 获取更新</p></div><button type="button" class="check-update">检查更新</button>`;box.querySelector('button').onclick=()=>{const b=box.querySelector('button');b.disabled=true;b.textContent='正在检查…';setTimeout(()=>{b.disabled=false;b.textContent='检查更新';box.querySelector('.version-state').textContent='预览状态：当前已是最新版本';},350);};content.append(box);}
  function render(){
    content.replaceChildren(); const meta=tabs.find(x=>x[0]===active);
    root.querySelector('.page-heading .eyebrow').textContent=names[variant];root.querySelector('.page-heading h1').textContent=query?'搜索设置':meta[1];root.querySelector('.page-heading p').textContent=query?'查找当前项目提供的设置项':meta[3];
    root.querySelectorAll('[data-tab]').forEach(b=>{b.setAttribute('aria-current',b.dataset.tab===active&&!query?'page':'false');});
    if(query){let hits=0;Object.entries(groups).forEach(([tab,sections])=>sections.forEach(section=>{const fields=section.fields.filter(field=>(field.label+' '+field.hint+' '+section.title).toLowerCase().includes(query.toLowerCase()));if(fields.length){hits+=fields.length;groupSection(tabs.find(x=>x[0]===tab)[1]+' / '+section.title,fields);}}));if(!hits){const p=document.createElement('p');p.className='empty-search';p.textContent='没有找到匹配的设置。';content.append(p);}}
    else{if(active==='updates')updates();if(active==='associations')associations();else groups[active].forEach(section=>groupSection(section.title,section.fields));}
    root.querySelector('.content-scroll').scrollTop=0;
    const preview=root.querySelector('.live-type-preview');
    if(preview){const show=(!query&&active==='editor')||Boolean(query&&content.querySelector('[data-key^="editor_"], [data-key^="source_"], [data-key^="code_alternate"]'));preview.hidden=!show;panel.classList.toggle('has-live-preview',show);}
    syncDocument();
  }
  root.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{active=button.dataset.tab;query='';root.querySelector('[type=search]').value='';render();});
  root.querySelector('[type=search]').oninput=e=>{query=e.target.value.trim();render();};
  const open=()=>{panel.hidden=false;root.querySelector('.settings-shade').hidden=false;root.querySelector('.close-settings').focus();};
  const close=()=>{panel.hidden=true;root.querySelector('.settings-shade').hidden=true;root.querySelector('.open-settings').focus();};
  root.querySelector('.close-settings').onclick=close;root.querySelector('.open-settings').onclick=open;
  root.querySelector('.settings-shade').onclick=close;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden&&!e.target.classList.contains('listening')){e.preventDefault();close();}});
  const system=matchMedia('(prefers-color-scheme:dark)');system.addEventListener('change',()=>{if(state.color_scheme==='system')syncDocument();});
  syncDocument();render();window.previewReady=true;
})();
