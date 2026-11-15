// CAM3D · Cerebro IA — motor de lenguaje con varios proveedores gratuitos y respaldo local
// © 2026 Tectónica Studio · Todos los derechos reservados
const LS = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const SYS = 'Eres "IA 3D", el asistente experto de CAM3D (app de escaneo 3D, medición y planos de arquitectura de Tectónica Studio). Respondes SIEMPRE en español neutro, claro, profesional y breve. Usas metros y m². No inventas medidas: usas solo los datos que te doy. No uses LaTeX ni notación \\( \\); escribe en texto plano con viñetas y negritas **así**.';

async function withTimeout(p, ms) { let t; const to = new Promise((_, rej) => t = setTimeout(() => rej(new Error('tiempo agotado')), ms)); try { return await Promise.race([p, to]); } finally { clearTimeout(t); } }

const PROVIDERS = {
  // Google Gemini (clave gratuita del usuario, se guarda solo en este teléfono)
  gemini: {
    name: 'Google Gemini 2.5 Flash', ok: () => !!LS('cam3dGeminiKey'),
    async chat(msgs, o) {
      const key = LS('cam3dGeminiKey'), model = o.model || 'gemini-2.5-flash';
      const sys = msgs.filter(m => m.role === 'system').map(m => m.content).join('\n');
      const contents = msgs.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: o.temperature ?? 0.4, maxOutputTokens: o.max || 600, thinkingConfig: { thinkingBudget: 0 } } }) });
      if (!r.ok) throw new Error('Gemini ' + r.status); const j = await r.json();
      return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    }
  },
  // Pollinations con clave gratuita del usuario (enter.pollinations.ai)
  pollkey: {
    name: 'Pollinations (clave gratuita)', ok: () => !!LS('cam3dPollKey'),
    async chat(msgs, o) {
      const r = await fetch('https://gen.pollinations.ai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LS('cam3dPollKey') }, body: JSON.stringify({ model: 'openai', messages: msgs, temperature: o.temperature ?? 0.4 }) });
      if (!r.ok) throw new Error('Pollinations ' + r.status); const j = await r.json(); return (j.choices?.[0]?.message?.content || '').trim();
    }
  },
  // Pollinations anónimo: gratis, sin clave ni registro (limitado por IP)
  pollinations: {
    name: 'Pollinations (gratis, sin clave)', ok: () => true,
    async chat(msgs, o) {
      const go = () => fetch('https://text.pollinations.ai/openai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'openai', messages: msgs, temperature: o.temperature ?? 0.4, private: true, referrer: 'cam3d-tectonica' }) });
      let r = await go();
      if (r.status === 402 || r.status === 429) { // límite gratuito: 1 respuesta cada ~45 s por conexión
        const t = await r.text(); const w = +((t.match(/Retry after (\d+)/i) || [])[1] || 45); AI.waitUntil = Date.now() + w * 1000;
        if (!o.wait || w > 50) throw new Error('límite gratuito, intenta en ' + w + ' s'); o.onWait && o.onWait(w); await new Promise(res => setTimeout(res, (w + 1) * 1000)); r = await go();
      }
      if (!r.ok) throw new Error('Pollinations ' + r.status); AI.waitUntil = Date.now() + 45000; const j = await r.json(); return (j.choices?.[0]?.message?.content || '').trim();
    }
  }
};

const AI = {
  last: null, busy: false,
  order() { const pref = LS('cam3dAIProv') || 'auto'; const all = ['gemini', 'pollkey', 'pollinations']; return pref === 'auto' ? all : [pref, ...all.filter(x => x !== pref)]; },
  get engine() { return this.last || (this.order().map(k => PROVIDERS[k]).find(p => p.ok()) || PROVIDERS.pollinations).name; },
  async chat(messages, o = {}) {
    const msgs = [{ role: 'system', content: SYS + (o.sys ? '\n' + o.sys : '') }, ...messages];
    let err;
    for (const k of this.order()) { const p = PROVIDERS[k]; if (!p.ok()) continue; try { const t = await withTimeout(p.chat(msgs, o), o.timeout || 20000); if (t) { this.last = p.name; return t; } } catch (e) { err = e; } }
    throw err || new Error('IA no disponible');
  },
  coachInterval() { return PROVIDERS.gemini.ok() || PROVIDERS.pollkey.ok() ? 16000 : 47000; },
  online() { return navigator.onLine !== false; },
  // ---- guía de escaneo: frase corta y precisa a partir del estado real de la captura
  async coach(state) {
    if (this.busy || !this.online() || (!PROVIDERS.gemini.ok() && !PROVIDERS.pollkey.ok() && Date.now() < (this.waitUntil || 0))) return null; this.busy = true;
    try {
      const t = await this.chat([{ role: 'user', content: `Estado del escaneo con la cámara AR: ${JSON.stringify(state)}. Da UNA instrucción de máximo 14 palabras para completar la captura al 100% (indica izquierda, derecha, arriba o abajo cuando aplique). Sin comillas.` }], { max: 60, timeout: 14000, temperature: 0.3 });
      return t.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].slice(0, 140);
    } catch (e) { return null; } finally { this.busy = false; }
  },
  // ---- informe técnico del espacio reconstruido
  async report(room, extra = {}, onWait) {
    const ctx = { area_m2: +room.area.toFixed(2), perimetro_m: +room.per.toFixed(2), alto_m: room.h, muros_m: room.walls.map(w => +w.toFixed(2)), ...extra };
    return this.chat([{ role: 'user', content: `Datos medidos de un espacio escaneado: ${JSON.stringify(ctx)}. Escribe un informe breve en viñetas (máx. 8): tipo de espacio probable, forma y proporción, área y volumen, cantidades útiles (pintura de muros en m² descontando ~10% de vanos, piso en m² con 5% de desperdicio, zócalo en ml), y 2 recomendaciones para verificar medidas en obra.` }], { max: 700, timeout: 110000, wait: true, onWait: arguments[2] });
  },
  // ---- chat con el contexto del proyecto
  async ask(q, project, history = [], onWait) {
    const ctx = project ? { proyecto: project.name, espacios: project.rooms.map(r => ({ nombre: r.name, area_m2: +r.area.toFixed(2), alto_m: r.h, muros_m: r.walls.map(w => +w.toFixed(2)) })), medidas: project.measures, puntos: project.pts, solidos: project.solids } : {};
    return this.chat([...history.slice(-8), { role: 'user', content: `Contexto del proyecto (datos reales): ${JSON.stringify(ctx)}\n\nPregunta: ${q}` }], { max: 900, timeout: 110000, wait: true, onWait: arguments[3], sys: 'Si la pregunta es de cálculo (materiales, áreas, volúmenes, costos), muestra la operación paso a paso. Si falta un dato, dilo y sugiere cómo medirlo con CAM3D.' });
  },
  async test() { const t0 = performance.now(); const r = await this.chat([{ role: 'user', content: 'Responde solo: "IA 3D lista".' }], { max: 20, timeout: 70000, wait: true }); return { text: r, ms: Math.round(performance.now() - t0), engine: this.last }; },
  providers: PROVIDERS
};
export default AI;
