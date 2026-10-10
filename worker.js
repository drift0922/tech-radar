const PROVIDERS = {
  deepseek: { base: 'https://api.deepseek.com/v1', keyEnv: 'DEEPSEEK_API_KEY' },
  qwen: { base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyEnv: 'QWEN_API_KEY' },
  zhipu: { base: 'https://open.bigmodel.cn/api/paas/v4', keyEnv: 'ZHIPU_API_KEY' },
  kimi: { base: 'https://api.moonshot.cn/v1', keyEnv: 'MOONSHOT_API_KEY' },
  siliconflow: { base: 'https://api.siliconflow.cn/v1', keyEnv: 'SILICONFLOW_API_KEY' }
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Worker-Access'
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}
async function callLLM(env, provider, model, messages) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error('不支持的模型服务商：' + provider);
  const key = env[p.keyEnv];
  if (!key) throw new Error('云端未配置 ' + p.keyEnv);
  const r = await fetch(p.base + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model, messages, temperature: 0.2 })
  });
  const raw = await r.text();
  let d;
  try { d = JSON.parse(raw); } catch (e) { throw new Error('模型返回非 JSON：' + raw.slice(0, 200)); }
  if (!r.ok) throw new Error(d.error?.message || '模型接口错误 HTTP ' + r.status);
  const out = d.choices?.[0]?.message?.content;
  if (!out) throw new Error('模型无文本输出');
  return out;
}
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/api/status') {
      const provider = url.searchParams.get('provider') || 'deepseek';
      const p = PROVIDERS[provider] || PROVIDERS.deepseek;
      return json({ ok: true, modelConfigured: !!env[p.keyEnv], searchConfigured: false, model: 'deepseek-chat', note: '未配置搜索服务，所有结果均为未联网核验' });
    }
    const token = request.headers.get('X-Worker-Access');
    if (!env.ACCESS_TOKEN) return json({ ok: false, error: '服务端未设置 ACCESS_TOKEN' }, 500);
    if (token !== env.ACCESS_TOKEN) return json({ ok: false, error: 'Worker 访问码错误' }, 401);
    if (path === '/api/test') {
      try {
        const body = await request.json().catch(() => ({}));
        const provider = body.provider || 'deepseek';
        const model = body.model || 'deepseek-chat';
        const out = await callLLM(env, provider, model, [{ role: 'user', content: '请只回复：连接成功' }]);
        return json({ ok: true, message: out.slice(0, 100), provider, model, searchConfigured: false });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    if (path === '/api/discover') {
      try {
        const body = await request.json();
        const scope = body.scope || '未来180天';
        const focus = body.focus || 'AI、半导体';
        const provider = body.provider || 'deepseek';
        const model = body.model || 'deepseek-chat';
        const prompt = `关注重点：${focus}；时间范围：${scope}。生成最多8条值得进一步核实的科技重大事件候选。不得声称刚刚搜索网页，不得虚构来源链接，不得把猜测写成事实。日期不确定时标记待核实。仅输出 JSON，不要 Markdown 围栏：{"main_events":[{"id":"E001","beijing_time":"待核实","original_time":"待核实","event":"候选事件","entity":"主体","type":"事件类型","domains":["领域"],"date_status":"待核实","ESS":50,"impact":"待评估","verification_status":"待联网核实","shock_override":false,"why_important":"重要性","source_url":"","evidence_note":"模型生成候选，尚未网页验证"}],"watchlist":[],"non_fixed_watch":[],"coverage_note":"模型生成候选；没有完成实时网页搜索与来源核验。","verification_notice":"未联网核验。"}`;
        const out = await callLLM(env, provider, model, [
          { role: 'system', content: '严格遵守 JSON 格式。禁止编造搜索证据。' },
          { role: 'user', content: prompt }
        ]);
        let parsed;
        try { parsed = JSON.parse(out.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')); } catch (e) { throw new Error('模型未返回有效 JSON：' + out.slice(0, 300)); }
        return json({ ok: true, data: parsed, verificationNotice: '未联网核验。' });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    if (path === '/api/analyze') {
      try {
        const body = await request.json();
        const event = body.event || {};
        const provider = body.provider || 'deepseek';
        const model = body.model || 'deepseek-chat';
        const prompt = `请审慎分析以下科技事件候选：\n${JSON.stringify(event, null, 2)}\n请输出：\n1. 已知与未核实信息分开\n2. 潜在影响与传导路径\n3. 情景分析及概率\n4. 潜在利多/利空\n5. 需要查证的官方来源清单\n不得声称已联网搜索，不得编造来源。说明这是基于当前输入的模型分析。`;
        const out = await callLLM(env, provider, model, [
          { role: 'system', content: '你是谨慎的科技事件分析助手。区分事实、推断与未知。' },
          { role: 'user', content: prompt }
        ]);
        return json({ ok: true, analysis: out, verificationNotice: '未联网核验。' });
      } catch (e) { return json({ ok: false, error: e.message }, 500); }
    }
    return json({ ok: false, error: '接口不存在' }, 404);
  }
};
