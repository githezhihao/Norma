// ============================================================
// Dashboard — Norma 可视化监控面板
// 零依赖，SVG 雷达图 + CSS gauge + PAD 趋势折线图
// ============================================================

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Norma Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0f1117;--card:#1a1d27;--border:#2a2d3a;
  --text:#e4e4e7;--dim:#71717a;--accent:#818cf8;
  --green:#34d399;--red:#f87171;--yellow:#fbbf24;--blue:#60a5fa;
}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;min-height:100vh}
h1{font-size:1.4rem;font-weight:600;margin-bottom:4px}
.subtitle{color:var(--dim);font-size:.85rem;margin-bottom:20px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.wide{grid-column:1/-1}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px}
.card-title{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin-bottom:12px;display:flex;align-items:center;gap:6px}
.card-title .dot{width:6px;height:6px;border-radius:50%;background:var(--green)}
.card-title .dot.err{background:var(--red)}
.metric{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)}
.metric:last-child{border-bottom:none}
.metric .label{color:var(--dim);font-size:.85rem}
.metric .value{font-size:.85rem;font-weight:500}
.gauge-wrap{text-align:center;width:90px}
.gauge-label{font-size:.75rem;color:var(--dim);margin-top:4px}
.gauge-value{font-size:1.1rem;font-weight:600;margin-top:2px}
.trend{display:inline-block;font-size:.75rem;padding:2px 8px;border-radius:10px;font-weight:500}
.trend.rising{background:#065f4620;color:var(--green)}
.trend.falling{background:#7f1d1d20;color:var(--red)}
.trend.stable{background:#3f3f4620;color:var(--dim)}
.bar-col{display:flex;flex-direction:column;align-items:center;flex:1}
.bar{width:100%;border-radius:4px 4px 0 0;min-height:4px;transition:height .5s}
.bar-label{font-size:.7rem;color:var(--dim);margin-top:6px}
.bar-count{font-size:.85rem;font-weight:600;margin-top:2px}
.legend{display:flex;gap:16px;justify-content:center;margin-top:8px;font-size:.75rem;color:var(--dim)}
.legend span::before{content:'';display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:4px;vertical-align:middle}
.legend .lp::before{background:var(--green)}
.legend .la::before{background:var(--yellow)}
.legend .ld::before{background:var(--blue)}
.empty-hint{color:var(--dim);font-size:.85rem;text-align:center;padding:30px 0}
</style>
</head>
<body>
<h1 id="name">Norma</h1>
<div class="subtitle" id="subtitle">加载中...</div>
<div class="grid">
  <div class="card" id="health-card">
    <div class="card-title"><span class="dot" id="health-dot"></span>系统状态</div>
    <div id="health-body"></div>
  </div>
  <div class="card">
    <div class="card-title">OCEAN 人格特质</div>
    <div style="display:flex;justify-content:center"><svg id="radar" width="240" height="240"></svg></div>
  </div>
  <div class="card">
    <div class="card-title">PAD 情绪状态</div>
    <div id="pad-gauges" style="display:flex;justify-content:space-around;flex-wrap:wrap;gap:8px"></div>
  </div>
  <div class="card">
    <div class="card-title">关系模式</div>
    <div id="rel-body"></div>
  </div>
  <div class="card">
    <div class="card-title">演化概览</div>
    <div id="evo-body"></div>
  </div>
  <div class="card">
    <div class="card-title">触发分布</div>
    <div id="trigger-body" style="display:flex;align-items:end;gap:12px;height:120px;padding-top:8px"></div>
  </div>
  <div class="card wide">
    <div class="card-title">PAD 演化趋势</div>
    <div id="trend-chart"></div>
    <div class="legend"><span class="lp">愉悦度 P</span><span class="la">唤醒度 A</span><span class="ld">支配度 D</span></div>
  </div>
</div>
<script>
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

function fmtUptime(ms) {
  const s = Math.floor(ms/1000), m = Math.floor(s/60), h = Math.floor(m/60), d = Math.floor(h/24);
  if (d > 0) return d+'天 '+h%24+'时';
  if (h > 0) return h+'时 '+m%60+'分';
  return m+'分 '+s%60+'秒';
}
function fmtBytes(b) {
  if (b < 1024) return b+' B';
  if (b < 1048576) return (b/1024).toFixed(1)+' KB';
  return (b/1048576).toFixed(1)+' MB';
}
function fmtTime(ts) {
  const d = new Date(ts);
  return (d.getMonth()+1)+'/'+d.getDate()+' '+d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');
}

// ---- SVG Radar ----
function drawRadar(svg, ocean) {
  if (!ocean) return;
  svg.innerHTML = '';
  const cx=120,cy=120,r=90,dims=['O','C','E','A','N'];
  const labels=['开放性','尽责性','外向性','宜人性','神经质'];
  const n=5, step=Math.PI*2/n, offset=-Math.PI/2;
  for (let ring of [0.25,0.5,0.75,1]) {
    const pts=[];
    for(let i=0;i<n;i++){const a=offset+i*step;pts.push((cx+r*ring*Math.cos(a)).toFixed(1)+','+(cy+r*ring*Math.sin(a)).toFixed(1));}
    const poly=document.createElementNS(NS,'polygon');
    poly.setAttribute('points',pts.join(' '));
    poly.setAttribute('fill','none');poly.setAttribute('stroke','#2a2d3a');poly.setAttribute('stroke-width','1');
    svg.appendChild(poly);
  }
  for(let i=0;i<n;i++){
    const a=offset+i*step;
    const line=document.createElementNS(NS,'line');
    line.setAttribute('x1',cx);line.setAttribute('y1',cy);
    line.setAttribute('x2',cx+r*Math.cos(a));line.setAttribute('y2',cy+r*Math.sin(a));
    line.setAttribute('stroke','#2a2d3a');line.setAttribute('stroke-width','1');
    svg.appendChild(line);
    const tx=cx+(r+16)*Math.cos(a), ty=cy+(r+16)*Math.sin(a);
    const text=document.createElementNS(NS,'text');
    text.setAttribute('x',tx);text.setAttribute('y',ty);
    text.setAttribute('text-anchor','middle');text.setAttribute('dominant-baseline','middle');
    text.setAttribute('fill','#71717a');text.setAttribute('font-size','10');
    text.textContent=labels[i]+' '+ocean[dims[i]].toFixed(2);
    svg.appendChild(text);
  }
  const pts=[];
  for(let i=0;i<n;i++){const a=offset+i*step;const v=ocean[dims[i]];pts.push((cx+r*v*Math.cos(a)).toFixed(1)+','+(cy+r*v*Math.sin(a)).toFixed(1));}
  const poly=document.createElementNS(NS,'polygon');
  poly.setAttribute('points',pts.join(' '));
  poly.setAttribute('fill','rgba(129,140,248,0.2)');poly.setAttribute('stroke','#818cf8');poly.setAttribute('stroke-width','2');
  svg.appendChild(poly);
  for(let i=0;i<n;i++){const a=offset+i*step;const v=ocean[dims[i]];
    const c=document.createElementNS(NS,'circle');
    c.setAttribute('cx',cx+r*v*Math.cos(a));c.setAttribute('cy',cy+r*v*Math.sin(a));
    c.setAttribute('r','3');c.setAttribute('fill','#818cf8');svg.appendChild(c);
  }
}

// ---- Arc Gauge ----
function makeGauge(label, value, min, max, color) {
  const norm = (value - min) / (max - min);
  const angle = norm * 180;
  const r = 35, cx = 45, cy = 45;
  const startA = Math.PI, endA = Math.PI + (angle/180)*Math.PI;
  const x1=cx+r*Math.cos(startA), y1=cy+r*Math.sin(startA);
  const x2=cx+r*Math.cos(endA), y2=cy+r*Math.sin(endA);
  const large = angle > 180 ? 1 : 0;
  return '<div class="gauge-wrap">'+
    '<svg width="90" height="55" viewBox="0 0 90 55">'+
    '<path d="M '+(cx-r)+' '+cy+' A '+r+' '+r+' 0 0 1 '+(cx+r)+' '+cy+'" fill="none" stroke="#2a2d3a" stroke-width="6" stroke-linecap="round"/>'+
    '<path d="M '+x1+' '+y1+' A '+r+' '+r+' 0 '+large+' 1 '+x2.toFixed(1)+' '+y2.toFixed(1)+'" fill="none" stroke="'+color+'" stroke-width="6" stroke-linecap="round"/>'+
    '</svg>'+
    '<div class="gauge-value" style="color:'+color+'">'+value.toFixed(3)+'</div>'+
    '<div class="gauge-label">'+label+'</div></div>';
}

// ---- SVG Line Chart ----
function drawTrendChart(container, history) {
  if (!history || history.length < 2) {
    container.innerHTML = '<div class="empty-hint">演化记录不足，至少需要 2 条数据</div>';
    return;
  }
  const W = container.clientWidth || 600, H = 180;
  const pad = {t:20,r:20,b:30,l:45};
  const cw = W-pad.l-pad.r, ch = H-pad.t-pad.b;
  const n = history.length;

  let svg = '<svg width="'+W+'" height="'+H+'" style="display:block">';
  // Y axis grid (-1 to 1)
  for (let v of [-1,-0.5,0,0.5,1]) {
    const y = pad.t + ch * (1 - (v+1)/2);
    svg += '<line x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'" stroke="#2a2d3a" stroke-width="1"/>';
    svg += '<text x="'+(pad.l-6)+'" y="'+y+'" text-anchor="end" dominant-baseline="middle" fill="#71717a" font-size="10">'+v.toFixed(1)+'</text>';
  }
  // X axis labels (first, mid, last)
  const xLabels = [0, Math.floor(n/2), n-1];
  for (const idx of xLabels) {
    const x = pad.l + (idx/(n-1))*cw;
    svg += '<text x="'+x+'" y="'+(H-5)+'" text-anchor="middle" fill="#71717a" font-size="9">'+fmtTime(history[idx].timestamp)+'</text>';
  }

  const colors = {pleasure:'#34d399',arousal:'#fbbf24',dominance:'#60a5fa'};
  for (const dim of ['pleasure','arousal','dominance']) {
    let path = '';
    for (let i=0;i<n;i++) {
      const x = pad.l + (i/(n-1))*cw;
      const v = history[i].values[dim] || 0;
      const y = pad.t + ch * (1 - (v+1)/2);
      path += (i===0?'M':'L')+x.toFixed(1)+','+y.toFixed(1);
    }
    svg += '<path d="'+path+'" fill="none" stroke="'+colors[dim]+'" stroke-width="2" stroke-linejoin="round"/>';
    // dots
    for (let i=0;i<n;i++) {
      const x = pad.l + (i/(n-1))*cw;
      const v = history[i].values[dim] || 0;
      const y = pad.t + ch * (1 - (v+1)/2);
      svg += '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="2.5" fill="'+colors[dim]+'"/>';
    }
  }
  svg += '</svg>';
  container.innerHTML = svg;
}

// ---- Render ----
async function refresh() {
  try {
    const res = await fetch('/api/dashboard');
    const d = await res.json();
    const trendMap = {rising:'上升',falling:'下降',stable:'平稳'};
    const styleMap = {casual:'随意',formal:'正式',playful:'活泼',demanding:'严格'};
    // header
    $('name').textContent = (d.persona.name || 'Norma') + ' · 诺玛监控面板';
    $('subtitle').textContent = '运行: '+fmtUptime(d.health.uptimeMs)+' · 消息: '+d.system.messageCount+' · 向量: '+(d.system.vecEnabled?'开':'关')+' · 分析: '+(d.system.llmProvider||'规则');
    // health
    $('health-dot').className = 'dot'+(d.health.errors>0?' err':'');
    $('health-body').innerHTML = [
      ['运行状态', d.health.status === 'ok' ? '正常' : d.health.status],
      ['运行时间', fmtUptime(d.health.uptimeMs)],
      ['数据库', fmtBytes(d.system.dbSizeBytes)],
      ['消息总数', d.system.messageCount],
      ['错误数', '<span style="color:'+(d.health.errors>0?'var(--red)':'var(--green)')+'">'+d.health.errors+'</span>'],
      ['向量检索', d.system.vecEnabled?'已启用':'未启用'],
      ['分析引擎', d.system.llmProvider||'规则分析'],
    ].map(([l,v])=>'<div class="metric"><span class="label">'+l+'</span><span class="value">'+v+'</span></div>').join('');
    // radar
    drawRadar($('radar'), d.persona.ocean);
    // PAD gauges
    if (d.persona.pad) {
      const p=d.persona.pad;
      $('pad-gauges').innerHTML =
        makeGauge('愉悦度',p.P,-1,1,'#34d399')+
        makeGauge('唤醒度',p.A,-1,1,'#fbbf24')+
        makeGauge('支配度',p.D,-1,1,'#60a5fa');
    }
    // relationship
    const rel=d.persona.relationship;
    $('rel-body').innerHTML = [
      ['信任度', (rel.trust*100).toFixed(0)+'%'],
      ['平均语气', rel.tone.toFixed(3)],
      ['互动风格', styleMap[rel.style]||rel.style],
      ['互动次数', rel.interactions],
    ].map(([l,v])=>'<div class="metric"><span class="label">'+l+'</span><span class="value">'+v+'</span></div>').join('');
    // evolution
    const evo=d.evolution;
    const trendHtml = (k,v) => '<span class="trend '+v+'">'+k+': '+(v==='rising'?'\\u2191':v==='falling'?'\\u2193':'\\u2192')+' '+trendMap[v]+'</span>';
    $('evo-body').innerHTML =
      '<div class="metric"><span class="label">演化总数</span><span class="value">'+evo.total+'</span></div>'+
      '<div class="metric"><span class="label">趋势</span><span class="value">'+
        trendHtml('P',evo.recentTrend.pleasure)+' '+
        trendHtml('A',evo.recentTrend.arousal)+' '+
        trendHtml('D',evo.recentTrend.dominance)+
      '</span></div>'+
      '<div class="metric"><span class="label">波动性</span><span class="value">P='+evo.volatility.pleasure.toFixed(4)+' A='+evo.volatility.arousal.toFixed(4)+' D='+evo.volatility.dominance.toFixed(4)+'</span></div>';
    // trigger bars
    const tb=evo.triggerBreakdown;
    const maxT=Math.max(tb.conversation,tb.manual,tb.decay,1);
    $('trigger-body').innerHTML = [
      ['对话',tb.conversation,'var(--accent)'],
      ['手动',tb.manual,'var(--yellow)'],
      ['衰减',tb.decay,'var(--blue)'],
    ].map(([l,c,color])=>'<div class="bar-col"><div class="bar" style="height:'+(c/maxT*100)+'%;background:'+color+'"></div><div class="bar-count">'+c+'</div><div class="bar-label">'+l+'</div></div>').join('');
    // trend chart
    drawTrendChart($('trend-chart'), d.history);
  } catch(e) {
    $('subtitle').textContent = '错误: '+e.message;
  }
}
refresh();
setInterval(refresh, 10000);
</script>
</body>
</html>`;
}
