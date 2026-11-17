/* FRONTERA — sin dependencias. El motor también puede ejecutarse en Node para pruebas. */
'use strict';
(function (root) {
  const WIDTH = 1080, HEIGHT = 1920;
  const COLORS = { red: '#ff4864', blue: '#48acff' };
  const CONFIG = Object.freeze({ duration: 180, intermission: 8, baseHP: 10000,
    maxUnits: 360, maxQueue: 3000, maxUsers: 10000, maxParticles: 380, maxTexts: 70,
    minX: 118, maxX: 962, top: 500, bottom: 1460, gridSize: 110 });
  const TYPES = Object.freeze({
    basic: { hp: 100, damage: 10, radius: 23, speed: 78, interval: .75 },
    mini: { hp: 45, damage: 6, radius: 15, speed: 135, interval: .55 },
    warrior: { hp: 300, damage: 35, radius: 34, speed: 62, interval: .85 },
    titan: { hp: 2500, damage: 150, radius: 69, speed: 38, interval: 1.1 }
  });
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const other = team => team === 'red' ? 'blue' : 'red';
  const number = (n, fallback = 0) => Number.isFinite(Number(n)) ? Number(n) : fallback;
  const positiveInt = (n, max, fallback = 0) => clamp(Math.floor(number(n, fallback)), 0, max);
  const clean = (s, length = 32) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, length);
  const rand = (a, b) => a + Math.random() * (b - a);
  const initials = name => [...(name || '?').replace(/^@/, '')].slice(0, 2).join('').toUpperCase();
  function avatarURL(value) {
    if (typeof value !== 'string' || value.length > 2048) return '';
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) && !u.username && !u.password && u.href.length <= 2048 ? u.href : ''; } catch { return ''; }
  }

  class Emitter {
    constructor() { this.listeners = new Map(); }
    on(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
    emit(type, data) { for (const fn of this.listeners.get(type) || []) fn(data); }
  }

  class SpatialGrid {
    constructor() { this.cells = new Map(); }
    build(units) {
      this.cells.clear();
      for (const u of units) {
        const key = `${Math.floor(u.x / CONFIG.gridSize)},${Math.floor(u.y / CONFIG.gridSize)}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(u);
      }
    }
    nearby(u, radius, fn) {
      const s = CONFIG.gridSize, x1 = Math.floor((u.x-radius)/s), x2 = Math.floor((u.x+radius)/s);
      const y1 = Math.floor((u.y-radius)/s), y2 = Math.floor((u.y+radius)/s);
      for (let x=x1; x<=x2; x++) for (let y=y1; y<=y2; y++) {
        const cell = this.cells.get(`${x},${y}`); if (cell) for (const v of cell) fn(v);
      }
    }
  }

  class Battle extends Emitter {
    constructor(options = {}) {
      super(); this.options = { ...CONFIG, ...options }; this.users = new Map(); this.units = [];
      this.queue = []; this.particles = []; this.texts = []; this.meteors = [];
      this.seen = new Map(); this.streaks = new Map(); this.grid = new SpatialGrid();
      this.wins = { red: 0, blue: 0 }; this.round = 0; this.nextID = 1;
      this.clock = 0; this.cleanupAt = 30; this.paused = false;
      this.stats = { accepted: 0, rejected: 0, overflow: 0 }; this.reset();
    }
    reset() {
      this.round++; this.phase = 'playing'; this.remaining = this.options.duration; this.breakRemaining = 0;
      this.bases = { red: this.options.baseHP, blue: this.options.baseHP }; this.territory = .5;
      this.units.length = 0; this.queue.length = 0; this.particles.length = 0; this.texts.length = 0; this.meteors.length = 0;
      this.shake = 0; this.spawnBudget = 0; this.lastResult = null;
      // Identidad/equipo y likes pendientes se conservan; el ranking comienza en cero.
      for (const p of this.users.values()) { p.damage = 0; p.troops = 0; p.score = 0; }
      this.emit('round', { round: this.round });
    }
    normalize(raw) {
      if (typeof raw === 'string') { if (raw.length > 65536) return null; try { raw = JSON.parse(raw); } catch { return null; } }
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const event = String(raw.event || raw.type || '').toLowerCase();
      if (!['chat', 'like', 'gift'].includes(event)) return null;
      const d = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data) ? raw.data : raw;
      const u = d.user && typeof d.user === 'object' ? d.user : d;
      const id = clean(u.uniqueId || u.userId || d.uniqueId || d.userId, 96);
      if (!id) return null;
      const picture = u.avatarThumb?.urlList?.[0] || u.avatarThumb?.url_list?.[0] || u.profilePicture?.urls?.[0];
      return { event, d, id, name: clean(u.nickname || d.nickname || u.uniqueId || id),
        avatar: avatarURL(d.avatarUrl || u.avatarUrl || u.profilePictureUrl || d.profilePictureUrl || picture),
        // TikTok msgId identifica el mensaje, no el regalo completo de una racha.
        messageID: clean(d.msgId || d.messageId || raw.id, 128) };
    }
    player(e) {
      let p = this.users.get(e.id);
      if (!p) {
        if (this.users.size >= this.options.maxUsers) {
          // No se expulsa una identidad que aún tiene unidades o puntuación en esta ronda.
          const active = new Set(this.units.map(u => u.owner));
          const victim = [...this.users.values()].find(v => !active.has(v.id) && !v.score && !this.queue.some(q => q.owner === v.id));
          if (!victim) return null;
          this.users.delete(victim.id);
        }
        p = { id: e.id, name: e.name, avatar: e.avatar, team: null, likes: 0, damage: 0, troops: 0, score: 0, lastSeen: this.clock };
        this.users.set(e.id, p);
      }
      p.name = e.name || p.name; if (e.avatar) p.avatar = e.avatar; p.lastSeen = this.clock; return p;
    }
    handle(raw) {
      const e = this.normalize(raw);
      if (!e) { this.stats.rejected++; return false; }
      const key = e.messageID ? `${e.event}:${e.id}:${e.messageID}` : '';
      if (key && this.seen.has(key)) return false;
      if (key) { this.seen.set(key, this.clock + 300); if (this.seen.size > 12000) this.seen.delete(this.seen.keys().next().value); }
      const p = this.player(e); if (!p) return false;
      const d = e.d;
      if (e.event === 'chat') {
        const text = clean(d.comment || d.text, 500).toLowerCase();
        const redAt = text.indexOf('rojo'), blueAt = text.indexOf('azul');
        const digit = text.match(/(?:^|\s)([12])(?=\s|$|[!.,?])/);
        const named = redAt >= 0 || blueAt >= 0;
        const team = named ? (redAt >= 0 && (blueAt < 0 || redAt < blueAt) ? 'red' : 'blue') : digit ? (digit[1] === '1' ? 'red' : 'blue') : null;
        if (!team) return false;
        p.team = team;
        if (this.phase === 'playing') this.enqueue(p, 'basic', 1);
        this.emit('activity', `${p.name} se une al equipo ${team === 'red' ? 'ROJO' : 'AZUL'}`);
      } else if (e.event === 'like') {
        this.assign(p);
        const total = p.likes + positiveInt(d.likeCount ?? d.count, 1000000);
        const packs = Math.floor(total / 10); p.likes = total % 10;
        if (packs && this.phase === 'playing') { this.enqueue(p, 'mini', packs * 3); this.emit('activity', `${p.name} envía refuerzos con sus likes`); }
      } else {
        this.assign(p);
        const coins = positiveInt(d.diamondCount ?? d.gift?.diamondCount ?? d.giftDetails?.diamondCount ?? d.coins, 10000000);
        if (!coins) return false;
        const repeat = positiveInt(d.repeatCount ?? 1, 100000, 1) || 1;
        let delta = repeat;
        const streak = number(d.giftType ?? d.gift?.giftType ?? d.giftDetails?.giftType) === 1;
        if (streak) {
          const streakKey = `${p.id}:${clean(d.giftId ?? d.gift?.giftId ?? d.giftName, 80)}:${clean(d.groupId || d.repeatId || '', 96)}`;
          const previous = this.streaks.get(streakKey);
          const active = previous && previous.expires > this.clock;
          const priorCount = active ? previous.count : 0;
          // Eventos acumulativos: 1 → 2 → 2(final) equivalen a dos regalos.
          delta = repeat > priorCount ? repeat - priorCount : 0;
          const newSeries = active && previous.ended && d.repeatEnd === false;
          if (newSeries) delta = repeat;
          this.streaks.set(streakKey, { count: newSeries ? repeat : Math.max(priorCount, repeat), ended: d.repeatEnd === true, expires: this.clock + 120 });
          if (this.streaks.size > 5000) this.streaks.delete(this.streaks.keys().next().value);
        }
        // Se registra incluso durante intermisión para no repetir una racha al cambiar de ronda.
        if (this.phase === 'playing' && delta) {
          if (coins <= 10) { this.enqueue(p, 'mini', 5 * delta); this.enqueue(p, 'warrior', delta); }
          else if (coins <= 99) this.meteor(p, delta);
          else { this.enqueue(p, 'titan', delta); this.shake = Math.max(this.shake, 22); this.emit('titan', { name: p.name, team: p.team, count: delta }); }
          this.emit('activity', `${p.name} · ${clean(d.giftName || 'Regalo', 30)} ×${delta} · ${coins} monedas/u.`);
        }
      }
      this.stats.accepted++; return true;
    }
    assign(p) { if (!p.team) p.team = Math.random() < .5 ? 'red' : 'blue'; }
    enqueue(p, type, count) {
      const n = Math.min(positiveInt(count, 1000000), this.options.maxQueue - this.queue.length);
      this.stats.overflow += Math.max(0, count - n);
      // Cada entrada conserva el equipo del evento, aunque el usuario cambie después.
      for (let i=0; i<n; i++) this.queue.push({ owner: p.id, team: p.team, type });
      return n;
    }
    spawn(q) {
      const p = this.users.get(q.owner); if (!p) return;
      const spec = TYPES[q.type], direction = q.team === 'red' ? 1 : -1;
      const lane = this.nextID % 7;
      const unit = { ...spec, maxHP: spec.hp, id: this.nextID++, owner: p.id, team: q.team, type: q.type,
        x: clamp(190 + lane * 116 + rand(-24, 24), CONFIG.minX+spec.radius, CONFIG.maxX-spec.radius),
        y: q.team === 'red' ? CONFIG.top + spec.radius + 25 : CONFIG.bottom - spec.radius - 25,
        vx: 0, vy: 0, direction, nextAttack: this.clock + .3, age: 0, hit: 0, pending: 0 };
      this.units.push(unit); p.troops++; p.score = p.damage + p.troops;
      this.burst(unit.x, unit.y, COLORS[q.team], 5, 65);
    }
    award(owner, damage) { const p = this.users.get(owner); if (p) { p.damage += damage; p.score = p.damage + p.troops; } }
    meteor(p, count = 1) {
      // Rachas grandes se consolidan en una sola explosión visual y potencia limitada.
      const power = Math.min(6, count), x = rand(320, 760), y = CONFIG.top + (CONFIG.bottom-CONFIG.top) * this.territory;
      if (this.meteors.length >= 16) { this.stats.overflow += count; return; }
      this.meteors.push({ x, y, owner: p.id, team: p.team, power, timer: .85, exploded: false });
      this.emit('meteor-incoming', { team: p.team });
    }
    explode(m) {
      const radius = 260 + m.power * 15;
      for (const u of this.units) {
        const distance = Math.hypot(u.x-m.x, u.y-m.y);
        if (u.team === m.team || distance > radius || u.hp <= 0) continue;
        const amount = Math.min(u.hp, (u.type === 'mini' || u.type === 'basic') ? u.hp : 160 * m.power);
        u.hp -= amount; this.award(m.owner, amount); u.vy += (m.team === 'red' ? 1 : -1) * 340;
        u.hit = .2; this.damageText(u.x, u.y-30, amount, '#ffce8f');
      }
      this.territory = clamp(this.territory + (m.team === 'red' ? .075 : -.075) * Math.sqrt(m.power), .12, .88);
      this.burst(m.x, m.y, '#ffd38b', 90, 450); this.shake = 26;
      this.emit('explosion', m);
    }
    burst(x, y, color, count, speed) {
      const n = Math.min(count, this.options.maxParticles-this.particles.length);
      for (let i=0; i<n; i++) { const a = rand(0, Math.PI*2), v = rand(speed*.25, speed), life = rand(.2, .65);
        this.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,color,life,maxLife:life,size:rand(2,6)}); }
    }
    damageText(x, y, amount, color) {
      if (this.texts.length < this.options.maxTexts) this.texts.push({x,y,value:Math.round(amount),color,life:.8});
    }
    update(dt) {
      if (this.paused || !Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, .05); this.clock += dt;
      if (this.clock >= this.cleanupAt) {
        for (const [key, expires] of this.seen) if (expires < this.clock) this.seen.delete(key);
        for (const [key, v] of this.streaks) if (v.expires < this.clock) this.streaks.delete(key);
        this.cleanupAt = this.clock + 30;
      }
      if (this.phase === 'results') {
        this.breakRemaining = Math.max(0, this.breakRemaining-dt);
        if (this.breakRemaining <= 0) this.reset(); return;
      }
      this.remaining = Math.max(0, this.remaining-dt); this.shake *= Math.exp(-8*dt);
      this.spawnBudget = Math.min(12, this.spawnBudget + dt*40);
      while (this.queue.length && this.units.length < this.options.maxUnits && this.spawnBudget >= 1) { this.spawn(this.queue.shift()); this.spawnBudget--; }
      for (const m of this.meteors) { m.timer -= dt; if (m.timer <= 0 && !m.exploded) { m.exploded = true; this.explode(m); } }
      this.meteors = this.meteors.filter(m => m.timer > -.5);
      this.grid.build(this.units);
      const baseDamage = { red: 0, blue: 0 }, credits = [];
      for (const u of this.units) {
        u.pending = 0; u.hit = Math.max(0, u.hit-dt); u.age += dt;
      }
      for (const u of this.units) {
        if (u.hp <= 0) continue;
        let target = null, nearest = Infinity;
        this.grid.nearby(u, 185, v => {
          if (v.team === u.team || v.hp <= 0) return;
          const d = Math.hypot(v.x-u.x, v.y-u.y);
          if (d < nearest && d < 185) { nearest = d; target = v; }
        });
        const reach = target ? u.radius+target.radius+6 : 0;
        if (target && nearest <= reach) {
          if (this.clock >= u.nextAttack) {
            // El daño se aplica tras resolver todos los ataques: los choques son mutuos.
            target.pending += u.damage; credits.push({ owner: u.owner, target, amount: u.damage });
            u.nextAttack = this.clock + u.interval; target.hit = .16;
            const dy = target.y-u.y, dx = target.x-u.x, len = Math.max(1, nearest);
            target.vx += dx/len*75; target.vy += dy/len*90;
            this.burst((u.x+target.x)/2,(u.y+target.y)/2,'#ffe9b5',3,100);
            this.damageText(target.x,target.y-target.radius-12,u.damage,COLORS[u.team]);
            this.emit('impact', null);
          }
        } else {
          let moveX = 0, moveY = u.direction;
          if (target) { const dx = target.x-u.x, dy = target.y-u.y, len = Math.max(1,nearest); moveX = dx/len; moveY = dy/len; }
          u.x += moveX*u.speed*dt; u.y += moveY*u.speed*dt;
        }
        // Separación local evita colisiones O(n²) y pilas de unidades del mismo lado.
        this.grid.nearby(u, u.radius+72, v => {
          if (v.id <= u.id || v.hp <= 0) return;
          const dx=v.x-u.x, dy=v.y-u.y, d=Math.hypot(dx,dy), min=(u.radius+v.radius)*.87;
          if (d < min) { const a=d>.01?dx/d:(u.id%2?1:-1), b=d>.01?dy/d:0, push=Math.min(2.5,(min-d)*.15);
            u.x-=a*push; v.x+=a*push; u.y-=b*push; v.y+=b*push; }
        });
        u.x = clamp(u.x+u.vx*dt,CONFIG.minX+u.radius,CONFIG.maxX-u.radius);
        u.y = clamp(u.y+u.vy*dt,CONFIG.top+u.radius,CONFIG.bottom-u.radius);
        u.vx *= Math.exp(-10*dt); u.vy *= Math.exp(-9*dt);
        const atBase = u.team === 'red' ? u.y >= CONFIG.bottom-u.radius-12 : u.y <= CONFIG.top+u.radius+12;
        if (atBase && this.clock >= u.nextAttack) {
          const victim = other(u.team), amount = Math.min(u.damage, Math.max(0,this.bases[victim]-baseDamage[victim]));
          baseDamage[victim] += amount; this.award(u.owner,amount); u.nextAttack = this.clock + u.interval;
          this.burst(u.x,u.y+u.direction*u.radius,COLORS[u.team],4,100); this.emit('impact',null);
        }
      }
      // Reparto proporcional si varios atacantes liquidan la misma tropa: MVP sin sobrecontar overkill.
      for (const c of credits) this.award(c.owner, c.amount * Math.min(1, c.target.hp/Math.max(1,c.target.pending)));
      for (const u of this.units) { u.hp -= u.pending; if (u.hp <= 0) this.burst(u.x,u.y,COLORS[u.team],8,130); }
      this.units = this.units.filter(u => u.hp > 0 && u.age < 240);
      for (const team of ['red','blue']) this.bases[team] = Math.max(0,this.bases[team]-baseDamage[team]);
      const red = this.units.filter(u=>u.team==='red'), blue = this.units.filter(u=>u.team==='blue');
      const massR = red.reduce((s,u)=>s+Math.min(u.hp,500),0), massB = blue.reduce((s,u)=>s+Math.min(u.hp,500),0);
      const average = this.units.length ? this.units.reduce((s,u)=>s+(u.y-CONFIG.top)/(CONFIG.bottom-CONFIG.top),0)/this.units.length : .5;
      const desired = clamp(.5+(massR-massB)/Math.max(1000,massR+massB)*.25+(average-.5)*.35,.12,.88);
      this.territory += (desired-this.territory)*dt*.35;
      for (const p of this.particles) { p.x+=p.vx*dt; p.y+=p.vy*dt; p.vy+=100*dt; p.life-=dt; }
      this.particles = this.particles.filter(p=>p.life>0);
      for (const t of this.texts) { t.y-=45*dt; t.life-=dt; } this.texts = this.texts.filter(t=>t.life>0);
      if (this.bases.red <= 0 || this.bases.blue <= 0 || this.remaining <= 0) this.finish();
    }
    finish() {
      if (this.phase !== 'playing') return this.lastResult;
      let winner = null, reason = 'Empate exacto · ambos equipos resisten';
      const endLabel = this.remaining <= 0 ? 'Tiempo agotado' : 'Ronda finalizada';
      if (this.bases.red !== this.bases.blue) { winner = this.bases.red > this.bases.blue ? 'red' : 'blue'; reason = Math.min(this.bases.red,this.bases.blue)<=0 ? 'Base enemiga destruida' : `${endLabel} · mayor vida de base`; }
      else if (Math.abs(this.territory-.5) > .002) { winner = this.territory > .5 ? 'red' : 'blue'; reason = `${endLabel} · desempate por territorio`; }
      if (winner) this.wins[winner]++;
      this.phase = 'results'; this.breakRemaining = this.options.intermission; this.queue.length = 0;
      const mvp = [...this.users.values()].filter(p=>p.score>0).sort((a,b)=>b.score-a.score || b.damage-a.damage).slice(0,3).map(p=>({...p}));
      this.lastResult = { winner, reason, mvp }; this.emit('result',this.lastResult); return this.lastResult;
    }
    snapshot() { return { round:this.round, phase:this.phase, remaining:this.remaining, wins:{...this.wins}, bases:{...this.bases}, territory:this.territory,
      units:this.units.length, queued:this.queue.length, users:this.users.size, stats:{...this.stats} }; }
  }

  class Sound {
    constructor() { this.enabled=false; this.muted=false; this.ctx=null; this.lastImpact=0; this.lastEffect=0; }
    async unlock() {
      if(this.muted)return false;
      try {
        if (!this.ctx) { const Audio = root.AudioContext || root.webkitAudioContext; if (!Audio) return false;
          this.ctx = new Audio(); this.master=this.ctx.createGain(); this.master.gain.value=.17; this.master.connect(this.ctx.destination);
          this.noise=this.ctx.createBuffer(1,this.ctx.sampleRate*.5,this.ctx.sampleRate);
          const data=this.noise.getChannelData(0); for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
        }
        await this.ctx.resume(); this.enabled=this.ctx.state==='running'; return this.enabled;
      } catch { this.enabled=false; return false; }
    }
    tone(freq, endFreq, duration, type='sine', delay=0, volume=.4) {
      if(!this.enabled || this.ctx?.state!=='running')return;
      const t=this.ctx.currentTime+delay, o=this.ctx.createOscillator(), g=this.ctx.createGain();
      o.type=type; o.frequency.setValueAtTime(freq,t); o.frequency.exponentialRampToValueAtTime(Math.max(20,endFreq),t+duration);
      g.gain.setValueAtTime(.001,t); g.gain.exponentialRampToValueAtTime(volume,t+.008); g.gain.exponentialRampToValueAtTime(.001,t+duration);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t+duration+.02); o.onended=()=>{o.disconnect();g.disconnect();};
    }
    play(kind) {
      if(!this.enabled || !this.ctx)return;
      const now=this.ctx.currentTime;
      if(kind==='impact') { if(now-this.lastImpact<.085)return;this.lastImpact=now;this.tone(180,65,.07,'triangle',0,.18); }
      if(kind==='explosion') {
        if(now-this.lastEffect<.12)return;this.lastEffect=now;
        this.tone(120,25,.6,'sawtooth',0,.45);
        const s=this.ctx.createBufferSource(), f=this.ctx.createBiquadFilter(), g=this.ctx.createGain();
        s.buffer=this.noise;f.type='lowpass';f.frequency.value=1700;g.gain.setValueAtTime(.5,now);g.gain.exponentialRampToValueAtTime(.001,now+.5);
        s.connect(f);f.connect(g);g.connect(this.master);s.start();s.onended=()=>{s.disconnect();f.disconnect();g.disconnect();};
      }
      if(kind==='titan') { if(now-this.lastEffect<.3)return;this.lastEffect=now;[65,98,130,196].forEach((f,i)=>this.tone(f,f*1.5,.7,'sawtooth',i*.12,.16)); }
      if(kind==='victory') [262,330,392,523,392,523].forEach((f,i)=>this.tone(f,f,.25,'triangle',i*.17,.5));
    }
  }

  class Avatars {
    constructor() { this.cache=new Map(); this.limit=420; this.loading=0; }
    get(p, team) {
      const key=`${p.avatar}|${p.name}|${team}`;
      let entry=this.cache.get(key); if(entry){entry.used=performance.now();return entry.canvas;}
      // La caché supera el límite de combatientes; evita regenerar todo al alternar 360 avatares.
      if(this.cache.size>=this.limit){ const oldest=[...this.cache].reduce((a,b)=>a[1].used<b[1].used?a:b);this.cache.delete(oldest[0]); }
      const canvas=document.createElement('canvas');canvas.width=144;canvas.height=144;
      entry={canvas,used:performance.now()};this.cache.set(key,entry);
      const c=canvas.getContext('2d'),g=c.createLinearGradient(0,0,144,144);
      g.addColorStop(0,team==='red'?'#7e334b':'#235682');g.addColorStop(1,'#142239');c.fillStyle=g;c.fillRect(0,0,144,144);
      c.strokeStyle=COLORS[team]+'45';c.lineWidth=2;
      c.beginPath();c.moveTo(0,110);c.lineTo(110,0);c.moveTo(35,144);c.lineTo(144,35);c.stroke();
      c.fillStyle='#eaf0ff';c.textAlign='center';c.textBaseline='middle';c.font='700 44px Segoe UI, Arial';c.fillText(initials(p.name),72,76);
      if(p.avatar && this.loading<8) {
        const img=new Image();let done=false;this.loading++;
        const release=()=>{if(done)return;done=true;this.loading--;clearTimeout(timeout);img.onload=null;img.onerror=null;};
        const timeout=setTimeout(()=>{release();img.src='';},6500);
        // CORS anónimo; no se reintenta sin CORS ni se usa un proxy de terceros.
        img.crossOrigin='anonymous';img.referrerPolicy='no-referrer';img.decoding='async';
        img.onload=()=>{if(done)return;try{if(img.naturalWidth){const s=Math.min(img.naturalWidth,img.naturalHeight);c.drawImage(img,(img.naturalWidth-s)/2,(img.naturalHeight-s)/2,s,s,0,0,144,144);}}catch{/* Se conserva el avatar generado. */}release();};
        img.onerror=release;img.src=p.avatar;
      }
      return canvas;
    }
  }

  class Renderer {
    constructor(canvas, game, avatars) {
      this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.game=game;this.avatars=avatars;
      this.background=document.createElement('canvas');this.background.width=WIDTH;this.background.height=HEIGHT;
      this.makeBackground();this.fps=60;this.lastTime=0;
    }
    path(c,x,y,w,h,r=12){c.beginPath();c.roundRect(x,y,w,h,r);}
    text(c,t,x,y,size,color='#eaf0ff',align='center',weight=600){c.font=`${weight} ${size}px Segoe UI, Arial`;c.textAlign=align;c.textBaseline='middle';c.fillStyle=color;c.fillText(t,x,y);}
    makeBackground() {
      const c=this.background.getContext('2d');c.fillStyle='#090e1b';c.fillRect(0,0,WIDTH,HEIGHT);
      const g=c.createRadialGradient(540,950,70,540,950,1000);g.addColorStop(0,'#172035');g.addColorStop(1,'#090e1b');c.fillStyle=g;c.fillRect(0,0,WIDTH,HEIGHT);
      c.strokeStyle='#ffffff03';c.lineWidth=1;for(let y=0;y<HEIGHT;y+=6){c.beginPath();c.moveTo(0,y);c.lineTo(WIDTH,y);c.stroke();}
      this.path(c,74,463,932,1035,34);c.fillStyle='#0a1020';c.fill();c.strokeStyle='#344057';c.lineWidth=2;c.stroke();
      this.path(c,94,482,892,996,24);c.fillStyle='#10192b';c.fill();c.strokeStyle='#202d45';c.stroke();
      c.save();this.path(c,98,486,884,988,22);c.clip();
      c.strokeStyle='#28365065';c.lineWidth=1;
      for(let x=120;x<1000;x+=70){c.beginPath();c.moveTo(x,490);c.lineTo(x,1470);c.stroke();}
      for(let y=490;y<1480;y+=70){c.beginPath();c.moveTo(98,y);c.lineTo(982,y);c.stroke();}
      c.setLineDash([12,22]);c.strokeStyle='#63718d30';c.beginPath();c.moveTo(540,500);c.lineTo(540,1460);c.stroke();c.setLineDash([]);c.restore();
      for(const x of [76,1004])for(let y=520;y<1470;y+=85){c.fillStyle='#3f4e6880';c.fillRect(x-3,y,6,26);}
      for(const y of [478,1482])for(const x of [115,965]){c.fillStyle='#65718b';c.beginPath();c.arc(x,y,3,0,Math.PI*2);c.fill();}
      this.text(c,'SECTOR 01',44,800,11,'#45536f');this.text(c,'SECTOR 02',1036,1160,11,'#45536f');
    }
    base(c,team,y) {
      const g=this.game,col=COLORS[team],pct=g.bases[team]/g.options.baseHP;
      c.save();
      const glow=c.createRadialGradient(540,y,15,540,y,170);glow.addColorStop(0,col+'20');glow.addColorStop(1,col+'00');c.fillStyle=glow;c.fillRect(350,y-170,380,340);
      this.path(c,327,y-39,426,78,13);c.fillStyle='#10192bf0';c.fill();c.strokeStyle=col+'75';c.lineWidth=2;c.stroke();
      c.fillStyle=col;c.beginPath();c.moveTo(354,y-13);c.lineTo(368,y-20);c.lineTo(382,y-13);c.lineTo(380,y+9);c.lineTo(368,y+19);c.lineTo(356,y+9);c.closePath();c.fill();
      this.text(c,team==='red'?'BASE ROJA':'BASE AZUL',403,y-12,16,col,'left',800);
      this.text(c,`${Math.ceil(g.bases[team]).toLocaleString('es-AR')} HP`,727,y-12,15,'#c4cfe4','right');
      this.path(c,403,y+10,324,5,2);c.fillStyle='#2a3449';c.fill();if(pct>0){this.path(c,403,y+10,324*pct,5,2);c.fillStyle=col;c.fill();}
      c.restore();
    }
    draw(time) {
      const c=this.ctx,g=this.game;if(this.lastTime){const dt=time-this.lastTime;if(dt>0)this.fps=this.fps*.95+Math.min(120,1000/dt)*.05;}this.lastTime=time;
      c.drawImage(this.background,0,0);c.save();
      if(g.shake>.1)c.translate(rand(-g.shake,g.shake),rand(-g.shake,g.shake));
      const front=CONFIG.top+(CONFIG.bottom-CONFIG.top)*g.territory;
      c.save();this.path(c,98,486,884,988,22);c.clip();
      const rg=c.createLinearGradient(0,500,0,front);rg.addColorStop(0,'#ff486409');rg.addColorStop(1,'#ff48641d');c.fillStyle=rg;c.fillRect(98,486,884,front-486);
      const bg=c.createLinearGradient(0,front,0,1480);bg.addColorStop(0,'#48acff1a');bg.addColorStop(1,'#48acff08');c.fillStyle=bg;c.fillRect(98,front,884,1480-front);
      c.strokeStyle='#d5e4ff60';c.lineWidth=2;c.setLineDash([15,12]);c.beginPath();c.moveTo(98,front);c.lineTo(982,front);c.stroke();c.setLineDash([]);
      const pulse=.35+Math.sin(time*.002)*.12;
      c.globalAlpha=pulse;c.strokeStyle='#ccdfff';c.lineWidth=1;c.beginPath();c.arc(540,front,72,0,Math.PI*2);c.stroke();c.beginPath();c.arc(540,front,87,0,Math.PI*2);c.stroke();c.globalAlpha=1;
      this.path(c,450,front-14,180,28,14);c.fillStyle='#131e32e8';c.fill();this.text(c,'LÍNEA DE FRENTE',540,front,10,'#9facbf');
      for(const m of g.meteors) {
        if(!m.exploded){const progress=1-m.timer/.85;c.strokeStyle='#ffc781';c.lineWidth=2;c.setLineDash([8,9]);c.beginPath();c.arc(m.x,m.y,90+progress*55,0,Math.PI*2);c.stroke();c.setLineDash([]);
          const x=m.x-320*(1-progress),y=m.y-520*(1-progress);const trail=c.createLinearGradient(x-100,y-160,x,y);trail.addColorStop(0,'#ff6c3100');trail.addColorStop(1,'#ffe0a9');c.strokeStyle=trail;c.lineWidth=18;c.beginPath();c.moveTo(x-100,y-160);c.lineTo(x,y);c.stroke();c.fillStyle='#fff3d0';c.beginPath();c.arc(x,y,15,0,Math.PI*2);c.fill();
        }else{c.globalAlpha=Math.max(0,1+m.timer/.5);c.strokeStyle='#ffd79b';c.lineWidth=5;c.beginPath();c.arc(m.x,m.y,50-m.timer*480,0,Math.PI*2);c.stroke();c.globalAlpha=1;}
      }
      // Orden estable por y sin ordenar objetos del motor en cada frame.
      for(const u of g.units)this.unit(c,u,time);
      for(const p of g.particles){c.globalAlpha=p.life/p.maxLife;c.fillStyle=p.color;c.fillRect(p.x,p.y,p.size,p.size);}c.globalAlpha=1;
      for(const t of g.texts){c.globalAlpha=Math.min(1,t.life*2);this.text(c,`−${t.value}`,t.x,t.y,20,t.color,'center',800);}c.globalAlpha=1;
      c.restore();this.base(c,'red',509);this.base(c,'blue',1451);
      if(!g.units.length&&g.phase==='playing') {
        this.text(c,'EL CAMPO TE ESPERA',540,900,25,'#8290a9','center',700);
        this.text(c,'Cada comentario invoca un combatiente',540,940,16,'#5c6d8b');
        this.text(c,'ROJO  ↓',310,1100,18,COLORS.red);this.text(c,'↑  AZUL',770,1100,18,COLORS.blue);
      }
      c.restore();
    }
    unit(c,u,time) {
      const p=this.game.users.get(u.owner);if(!p)return;const r=u.radius,color=COLORS[u.team],bob=Math.sin(time*.007+u.id)*1.4;
      c.save();c.translate(u.x,u.y+bob);
      c.fillStyle='#00000040';c.beginPath();c.ellipse(0,r*.85,r*.95,r*.35,0,0,Math.PI*2);c.fill();
      if(u.type==='titan'){
        c.strokeStyle='#f5ca8265';c.lineWidth=2;c.beginPath();c.arc(0,0,r+10,0,Math.PI*2);c.stroke();
        this.text(c,'♛',0,-r-35,28,'#ffe0a0');
      }
      c.save();c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.clip();c.drawImage(this.avatars.get(p,u.team),-r,-r,r*2,r*2);
      if(u.hit>0){c.fillStyle=`rgba(255,255,255,${u.hit*2.8})`;c.fillRect(-r,-r,r*2,r*2);}c.restore();
      c.strokeStyle=color;c.lineWidth=u.type==='titan'?5:3;c.beginPath();c.arc(0,0,r,0,Math.PI*2);c.stroke();
      c.strokeStyle='#0a1221';c.lineWidth=4;c.beginPath();c.arc(0,0,r+5,-Math.PI/2,Math.PI*1.5);c.stroke();
      c.strokeStyle=u.hp/u.maxHP<.25?'#ffcc7b':color;c.lineWidth=3;c.beginPath();c.arc(0,0,r+5,-Math.PI/2,-Math.PI/2+Math.PI*2*u.hp/u.maxHP);c.stroke();
      // Nombres siguen visibles; se acortan en unidades pequeñas para controlar la densidad.
      const name=u.type==='mini'?p.name.slice(0,9):p.name.slice(0,15),size=u.type==='titan'?19:u.type==='mini'?10:13;
      c.font=`600 ${size}px Segoe UI, Arial`;c.textAlign='center';c.textBaseline='middle';c.lineWidth=4;c.strokeStyle='#090e1be8';c.strokeText(name,0,-r-14);c.fillStyle='#dfe7f9';c.fillText(name,0,-r-14);
      c.restore();
    }
  }

  class LiveSocket extends Emitter {
    constructor(game) { super();this.game=game;this.socket=null;this.retry=null;this.watchdog=null;this.generation=0;this.attempt=0;this.enabled=false;this.url=''; }
    connect(url) {
      this.disconnect();let parsed;
      try { parsed=new URL(url);if(!['ws:','wss:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error(); }
      catch {this.emit('status',{state:'offline',text:'URL INVÁLIDA'});return false;}
      this.url=parsed.href;this.enabled=true;this.attempt=0;this.open(this.generation);return true;
    }
    open(generation) {
      if(!this.enabled||generation!==this.generation)return;
      this.emit('status',{state:'waiting',text:'CONECTANDO'});let ws;
      try {ws=new WebSocket(this.url);this.socket=ws;}catch{this.schedule(generation);return;}
      this.watchdog=setTimeout(()=>{if(ws.readyState===WebSocket.CONNECTING)ws.close();},8000);
      ws.onopen=()=>{if(generation!==this.generation)return;clearTimeout(this.watchdog);this.attempt=0;this.emit('status',{state:'connected',text:'TIKFINITY CONECTADO'});};
      ws.onmessage=message=>{if(generation===this.generation&&typeof message.data==='string')this.game.handle(message.data);};
      ws.onerror=()=>{};
      ws.onclose=()=>{clearTimeout(this.watchdog);if(generation===this.generation)this.schedule(generation);};
    }
    schedule(generation){if(!this.enabled||generation!==this.generation)return;this.emit('status',{state:'offline',text:'SIN TIKFINITY'});const wait=Math.min(30000,1000*2**Math.min(5,this.attempt++))+Math.random()*350;this.retry=setTimeout(()=>this.open(generation),wait);}
    disconnect(){this.enabled=false;this.generation++;clearTimeout(this.retry);clearTimeout(this.watchdog);if(this.socket){this.socket.onclose=null;this.socket.onmessage=null;this.socket.onopen=null;this.socket.close();this.socket=null;}this.emit('status',{state:'offline',text:'MODO LOCAL'});}
  }

  function boot() {
    const $=id=>document.getElementById(id),game=new Battle(),avatars=new Avatars(),audio=new Sound();
    const renderer=new Renderer($('battle'),game,avatars),socket=new LiveSocket(game);
    let demoTimer=null,alertUntil=0,activityUntil=0,hudAt=0,renderAt=0,last=performance.now(),accumulator=0,demoIndex=0;
    const params=new URLSearchParams(location.search);const log=message=>{$('debug-log').textContent=message;};
    const saveWins=()=>{try{localStorage.setItem('frontera.wins',JSON.stringify(game.wins));}catch{/* Funciona sin almacenamiento. */}};
    try{const saved=JSON.parse(localStorage.getItem('frontera.wins'));if(saved){game.wins.red=positiveInt(saved.red,1000000);game.wins.blue=positiveInt(saved.blue,1000000);}}catch{/* Primer inicio o almacenamiento no disponible. */}
    function resize(){const scale=Math.min(innerWidth/WIDTH,innerHeight/HEIGHT);$('stage').style.transform=`scale(${scale})`;}
    root.addEventListener('resize',resize);resize();
    function stopDemo(){if(demoTimer)clearInterval(demoTimer);demoTimer=null;$('demo').textContent='Iniciar demo';}
    function toggleDemo(){
      if(demoTimer){stopDemo();return;}
      if(socket.enabled){socket.disconnect();log('Demo: TikFinity desconectado para mantener los datos de prueba separados.');}
      $('demo').textContent='Detener demo';
      const names=['Luna','Nico','Valen','Sofi','Mateo','Cami','Leo','Meli','Tomi','Alma','Max','Flor'];
      function tick(){if(game.paused||game.phase!=='playing')return;const i=demoIndex++,team=i%2===0?'rojo':'azul',name=names[i%names.length];const data={uniqueId:`demo-${i%names.length}`,nickname:name,comment:team};game.handle({event:'chat',data});if(i%7===0)game.handle({event:'gift',data:{...data,diamondCount:1}});if(i>0&&i%43===0)game.handle({event:'gift',data:{...data,diamondCount:100}});}
      for(let i=0;i<16;i++)tick();demoTimer=setInterval(tick,650);
    }
    function simulate(action){
      const name=clean($('sim-user').value||'Streamer'),base={uniqueId:`sim-${name}`,nickname:name,avatarUrl:$('sim-avatar').value};
      const [team,type]=action.split('-');
      if(team==='red'||team==='blue'){
        // La asignación se hace con un comentario solo en la acción de tropa; regalos usan el equipo ya asignado.
        const event=game.normalize({event:'chat',data:{...base,comment:team==='red'?'rojo':'azul'}}),p=game.player(event);if(!p)return;p.team=team;
        if(type==='basic')game.handle({event:'chat',data:{...base,comment:team==='red'?'rojo':'azul'}});
        else game.handle({event:'gift',data:{...base,diamondCount:type==='titan'?100:25,giftName:type==='titan'?'Titán de prueba':'Meteorito de prueba'}});
      }else if(action==='likes')game.handle({event:'like',data:{...base,likeCount:10}});
      else if(action==='gift')game.handle({event:'gift',data:{...base,diamondCount:1,giftName:'Rosa'}});
      log(`Simulado: ${action} · ${name}`);
    }
    function showResult(result){
      const team=result.winner,color=team?COLORS[team]:'#f4d399';$('results').style.setProperty('--winner',color);
      $('winner').textContent=team?`VICTORIA ${team==='red'?'ROJA':'AZUL'}`:'EMPATE';$('win-reason').textContent=result.reason;
      const list=$('mvp-list');list.replaceChildren();
      if(!result.mvp.length){const li=document.createElement('li');li.className='empty-mvp';li.textContent='La próxima ronda espera a sus héroes.';list.append(li);}
      result.mvp.forEach((p,i)=>{const li=document.createElement('li'),rank=document.createElement('span'),pic=document.createElement('canvas'),info=document.createElement('div'),name=document.createElement('strong'),detail=document.createElement('small'),points=document.createElement('div'),label=document.createElement('small');
        rank.className='rank';rank.textContent=`0${i+1}`;pic.width=144;pic.height=144;pic.className='mvp-avatar';pic.style.borderColor=COLORS[p.team];pic.getContext('2d').drawImage(avatars.get(p,p.team),0,0);info.className='mvp-info';name.textContent=p.name;detail.textContent=`${Math.round(p.damage).toLocaleString('es-AR')} daño · ${p.troops} tropas`;info.append(name,detail);points.className='mvp-points';points.textContent=Math.round(p.score).toLocaleString('es-AR');label.textContent='PUNTOS';points.append(label);li.append(rank,pic,info,points);list.append(li);});
      $('results').hidden=false;$('titan-alert').hidden=true;saveWins();audio.play('victory');
    }
    game.on('activity',text=>{$('activity').textContent=text;activityUntil=game.clock+5;});
    game.on('titan',e=>{if(alertUntil<game.clock+.5){$('titan-user').textContent=`¡${e.name} ha invocado un TITÁN!`;$('titan-alert').hidden=false;alertUntil=game.clock+3.6;}audio.play('titan');});
    game.on('impact',()=>audio.play('impact'));game.on('explosion',()=>audio.play('explosion'));
    game.on('result',showResult);game.on('round',()=>{$('results').hidden=true;$('titan-alert').hidden=true;alertUntil=0;$('activity').textContent='NUEVA RONDA · ESCRIBE ROJO O AZUL';activityUntil=game.clock+5;});
    socket.on('status',s=>{$('connection').className=`status ${s.state}`;$('connection').replaceChildren();const dot=document.createElement('i');$('connection').append(dot,document.createTextNode(s.text));});
    $('close-debug').onclick=()=>{$('debug').hidden=true;};
    for(const button of document.querySelectorAll('[data-sim]'))button.onclick=()=>{void audio.unlock().then(updateAudio);simulate(button.dataset.sim);};
    function updateAudio(){$('audio-toggle').textContent=audio.enabled?'Silenciar sonido':'Activar sonido';$('sound-label').textContent=audio.enabled?'AUDIO SINTÉTICO · ON':'SONIDO DESACTIVADO';}
    $('audio-toggle').onclick=async()=>{if(audio.enabled){audio.enabled=false;audio.muted=true;}else{audio.muted=false;await audio.unlock();}updateAudio();};
    $('demo').onclick=()=>{void audio.unlock().then(updateAudio);toggleDemo();};
    $('pause').onclick=()=>{game.paused=!game.paused;$('pause').textContent=game.paused?'Reanudar':'Pausar';};
    $('finish').onclick=()=>game.finish();$('reset').onclick=()=>{game.reset();};
    $('reset-scores').onclick=()=>{game.wins={red:0,blue:0};saveWins();log('Marcador global reiniciado.');};
    $('connect').onclick=()=>{stopDemo();socket.connect($('ws-url').value);};$('disconnect').onclick=()=>socket.disconnect();
    $('send-json').onclick=()=>log(game.handle($('json-event').value)?'Evento aceptado.':'Evento ignorado: inválido, duplicado o sin acción aplicable.');
    root.addEventListener('keydown',e=>{
      if(/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable||e.ctrlKey||e.metaKey||e.altKey||e.repeat)return;
      if(e.key.toLowerCase()==='d'){$('debug').hidden=!$('debug').hidden;return;}
      const action={'1':'red-basic','2':'blue-basic','3':'red-titan','4':'blue-titan','5':'red-meteor','6':'blue-meteor','7':'likes','8':'gift'}[e.key];
      if(action){e.preventDefault();void audio.unlock().then(updateAudio);simulate(action);}
    });
    function hud(){
      const r=game.units.filter(u=>u.team==='red').length,b=game.units.length-r,percentage=Math.round(game.territory*100);
      $('red-wins').textContent=game.wins.red;$('blue-wins').textContent=game.wins.blue;
      const seconds=Math.ceil(game.remaining);$('timer').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
      $('timer').style.color=seconds<=30?'#ffba82':'';$('round-label').textContent=`RONDA ${String(game.round).padStart(2,'0')}`;
      $('red-territory').textContent=`${percentage}%`;$('blue-territory').textContent=`${100-percentage}%`;$('territory-red').style.width=`${percentage}%`;
      $('red-count').textContent=r;$('blue-count').textContent=b;$('battle-state').textContent=game.paused?'PAUSADO':demoTimer?'DEMOSTRACIÓN':game.phase==='results'?'RONDA FINALIZADA':game.units.length?'BATALLA EN CURSO':'ESPERANDO REFUERZOS';
      if(!$('debug').hidden)$('metrics').textContent=`${Math.round(renderer.fps)} FPS · ${game.units.length}/${CONFIG.maxUnits} unidades · Cola ${game.queue.length} · Usuarios ${game.users.size} · Saturación ${game.stats.overflow}`;
      if(game.phase==='results'){$('countdown').textContent=Math.ceil(game.breakRemaining);$('countdown-progress').style.width=`${game.breakRemaining/game.options.intermission*100}%`;}
      if(alertUntil&&game.clock>alertUntil)$('titan-alert').hidden=true;
      if(activityUntil&&game.clock>activityUntil){$('activity').textContent='ELIGE TU EQUIPO · ESCRIBE ROJO O AZUL';activityUntil=0;}
    }
    function frame(now){
      const elapsed=Math.min((now-last)/1000,.12);last=now;accumulator+=elapsed;
      let steps=0;while(accumulator>=1/60&&steps<7){game.update(1/60);accumulator-=1/60;steps++;}
      if(steps===7)accumulator=0;
      if(now>=renderAt){renderer.draw(now);renderAt=now-(now-renderAt)%(1000/60)+1000/60;}
      if(now>=hudAt){hud();hudAt=now+125;}root.requestAnimationFrame(frame);
    }
    document.addEventListener('visibilitychange',()=>{last=performance.now();accumulator=0;});
    root.addEventListener('pagehide',()=>{stopDemo();socket.disconnect();});
    // API local explícita para Custom Script y pruebas. No recibe postMessage de otras páginas.
    root.BattleLive=Object.freeze({handleEvent:event=>game.handle(event),snapshot:()=>game.snapshot(),game,connect:url=>{stopDemo();return socket.connect(url||'ws://localhost:21213/');},disconnect:()=>socket.disconnect()});
    if(params.get('debug')==='1')$('debug').hidden=false;
    if(params.get('connect')!=='0')socket.connect('ws://localhost:21213/');else socket.disconnect();
    if(params.get('demo')==='1')toggleDemo();
    root.requestAnimationFrame(frame);hud();
  }

  const engine={Battle,SpatialGrid,CONFIG,TYPES,avatarURL,LiveSocket,Renderer,Sound,Avatars,COLORS};
  if(typeof module!=='undefined'&&module.exports)module.exports=engine;
  if(typeof document!=='undefined'){
    root.FronteraEngine=Object.freeze(engine);
    if(document.documentElement.dataset.server!=='true')boot();
  }
})(typeof window!=='undefined'?window:globalThis);
