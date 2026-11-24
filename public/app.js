import { apiBase } from './config.js';

const svgPaths = {
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/>',
  shield: '<path d="m12 22 5-4c2-2 3-5 3-8V5l-8-3-8 3v5c0 3 1 6 3 8z"/><path d="m9 12 2 2 4-4"/>',
  tv: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 1 1 8 0v4m-4 4v3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M7 12h10m-10 4h7"/>',
  volume: '<path d="M3 9h4l5-4v14l-5-4H3zm13 0a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${svgPaths[name]}</svg>`;
document.querySelector('[data-icon]').innerHTML = icon('target');
const app = document.querySelector('#app');
const nav = document.querySelector('#navigation');
const notice = document.querySelector('#notice');
const query = new URLSearchParams(location.search);
const code = (query.get('join') || query.get('game') || '').toUpperCase();
const page = query.get('join') ? 'agent' : query.get('view') || 'agent';
const hostToken = code && localStorage.getItem('gobble-host-' + code);
let playerToken = code && localStorage.getItem('gobble-agent-' + code);
let game;
let audio;
let sound = false;
let lastSequence = null;
let alertEvent;
let alertTimer;
let refreshing = false;
let actionVersion = 0;
let noticeTimer;
let pending = false;
let openingError = '';
let nextRead = 0;
const escape = value => String(value).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const gameLink = (view, gameCode = code) => `${location.pathname}?view=${view}${gameCode ? '&game=' + encodeURIComponent(gameCode) : ''}`;
const joinLink = (gameCode = code) => `${location.pathname}?join=${encodeURIComponent(gameCode)}`;
const link = (label, view, image) => `<a class="${page === view ? 'selected' : ''}" href="${gameLink(view, code || (view === 'host' ? localStorage.getItem('gobble-last-host') : ''))}">${icon(image)}<span>${label}</span></a>`;
nav.innerHTML = link('Agent dossier', 'agent', 'folder') + link('TV scoreboard', 'tv', 'tv') + link('Game leader', 'host', 'settings');

const demoCards = [
  ['Operation Platypus', 'Get another guest to say “platypus” without directly asking them to.', 'Easy', 100],
  ['Operation Musical Chairs', 'Convince two guests to exchange seats without revealing your mission.', 'Medium', 250],
  ['Operation Standing Ovation', 'Get at least five guests to applaud at the same time.', 'Hard', 500],
  ['Photo Evidence', 'Get someone to show you a photo on their phone.', 'Easy', 100],
  ['Double Agent', 'Get two guests to agree that dessert should come first.', 'Medium', 250],
  ['Full Performance', 'Get someone to sing an entire song.', 'Hard', 400],
].map(([title, description, difficulty, points], index) => ({ title, description, difficulty, points, assignmentId: 'demo-' + index }));
let demoNext = 3;
const demo = { id: 19, score: 0, completed: 0, missions: demoCards.slice(0, 3) };
const agentLabel = id => 'AGENT ' + String(id).padStart(3, '0');
const xp = value => new Intl.NumberFormat().format(value);
const phaseLabel = () => ({ open: 'In progress', closed: 'Scoring closed', revealed: 'Declassified' })[game?.phase] || 'Demo mode';
const header = (eyebrow, title, description) => `<div class="page-heading"><div class="kicker">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>`;
const empty = message => `<p class="empty">${message}</p>`;

function missionCard(mission, index, enabled) {
  return `<article class="mission ${mission.difficulty.toLowerCase()}">
    <div class="mission-meta"><span class="difficulty"><i></i>${mission.difficulty}</span><span>MISSION ${String(index + 1).padStart(2, '0')}</span><span class="points">+${mission.points} XP</span></div>
    <h3>${escape(mission.title)}</h3><p>${escape(mission.description)}</p>
    ${enabled ? `<div class="mission-actions"><button class="primary" data-result="completed" data-id="${mission.assignmentId}">${icon('check')} Mark as completed</button><button class="text-button" data-result="abandoned" data-id="${mission.assignmentId}">Abandon</button></div>` : ''}
  </article>`;
}

function countdown() {
  const ms = Math.max(0, (game?.cutoff || 0) - Date.now());
  const seconds = Math.ceil(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
}
const qr = () => `<img class="qr" src="${apiBase}/api/games/${game.code}/qr?target=${encodeURIComponent(new URL(joinLink(), location.href).href)}" alt="Scan to join Operation Gobble" width="116" height="116">`;

function agent() {
  if (code && !game?.player) {
    if (!game) return header('SECURE ACCESS', 'Join a game', escape(openingError || 'Contacting headquarters…'));
    return `${header('SECURE ACCESS', 'Join the operation', `Game code ${game.code}`)}
      <section class="panel form-panel">${game.phase === 'open' ? `<form id="join-form"><label>Your name<input name="name" maxlength="24" autocomplete="nickname" required autofocus placeholder="Enter your name"></label><label class="checkbox"><input type="checkbox" name="family"> Deal me kid-friendly missions</label><button class="primary" type="submit">Join game ${icon('arrow')}</button></form>` : `<p>Joining is closed.</p><a href="${gameLink('tv')}">View the scoreboard</a>`}</section>`;
  }
  const player = game?.player || demo;
  const playing = !game || game.phase === 'open';
  return `<div class="dossier-banner">
    <div><div class="kicker banner-label">${icon('lock')} CLASSIFIED <span></span> ${agentLabel(player.id)}</div>
    <h1>Agent dossier<span>.</span></h1><p>Your missions are for your eyes only.</p></div>
    <div class="banner-mark" aria-hidden="true">${icon('target')}</div>
    <div class="status"><i></i>${phaseLabel()}</div>
  </div>
  <div class="dashboard">
    <section class="mission-list" aria-label="Your missions">
      <div class="section-title"><div><div class="kicker">FIELD ASSIGNMENTS</div><h2>Active missions</h2></div><span class="counter">${player.missions.length} ACTIVE</span></div>
      ${player.missions.map((mission, index) => missionCard(mission, index, playing)).join('') || empty('You’ve cleared your mission deck.')}
    </section>
    <aside>
      <section class="panel stat-panel">
        <div class="kicker">${icon('shield')} AGENT RECORD</div>
        <div class="score"><strong>${xp(player.score)}</strong><span> XP</span></div><p>Total score</p>
        <div class="stat-bottom"><span>Missions completed</span><strong>${player.completed}</strong></div>
      </section>
      <section class="panel briefing">
        <div class="kicker">${icon('folder')} FIELD BRIEFING</div>
        ${game ? `<h3>${icon('clock')} <span data-clock>${countdown()}</span></h3><p>Time remaining</p><a class="inline-link" href="${gameLink('tv')}">View scoreboard ${icon('arrow')}</a>`
          : `<h3>Playing the demo</h3><p>Try a mission here, or open a live game for your guests.</p><a class="inline-link" href="${gameLink('host', localStorage.getItem('gobble-last-host') || '')}">Host a game ${icon('arrow')}</a><form id="code-form"><label for="join-code">Have a game code?</label><div class="code-entry"><input id="join-code" name="code" required pattern="[0-9A-Fa-f]{6}" maxlength="6" placeholder="A1B2C3"><button class="secondary" type="submit">Join</button></div></form>`}
      </section>
    </aside>
  </div>`;
}

function host() {
  if (!game) {
    const suggested = new Date(Date.now() + 3 * 3600000);
    const localTime = new Date(suggested - suggested.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return `${header('COMMAND CENTER', 'Game leader', 'Set the mission cutoff and get your guests into the game.')}
      <section class="panel form-panel"><form id="host-form">
        <label>Scoring cutoff<input type="datetime-local" name="cutoff" value="${localTime}" required></label>
        <button class="primary" type="submit">Create game ${icon('arrow')}</button></form>${openingError ? empty(escape(openingError)) : ''}</section>`;
  }
  if (!game.host) return `${header('COMMAND CENTER', 'Game leader', 'Open this game on the browser that created it to control the reveal.')}<a class="inline-link" href="${gameLink('host', '')}">Create a game</a>`;
  return `${header('COMMAND CENTER', 'Game leader', `Game ${game.code} · ${phaseLabel()}`)}
    <div class="dashboard"><section class="panel">
    <h2>Guest list</h2>${standings()}
    <div class="host-actions">${game.phase === 'closed' ? '<button class="primary" data-action="reveal">Open group reveal</button>' : ''}
    ${game.phase === 'open' ? '<p>The group reveal opens automatically at the scoring cutoff.</p>' : ''}
    ${game.phase === 'revealed' && game.reveal.length ? `<button class="secondary" data-action="advance" data-step="-1" ${game.revealIndex === 0 ? 'disabled' : ''}>Previous agent</button> <button class="primary" data-action="advance" data-step="1" ${game.revealIndex >= game.reveal.length - 1 ? 'disabled' : ''}>Next agent</button>` : ''}</div></section>
    <aside><section class="panel briefing"><div class="kicker">RECRUIT AGENTS</div>${qr()}<h2>${game.code}</h2>
    <button class="secondary" data-action="copy">Copy join link</button> <a class="inline-link" href="${joinLink()}">${playerToken ? 'My missions' : 'Join as a player'} ${icon('arrow')}</a> <a class="inline-link" href="${gameLink('tv')}" target="_blank" rel="noopener">Open TV ${icon('arrow')}</a></section>
    <section class="panel briefing"><div class="kicker">TIME REMAINING</div><h3 data-clock>${countdown()}</h3><p>Cutoff at ${new Date(game.cutoff).toLocaleString()}</p></section></aside></div>`;
}

function standings() {
  if (!game.standings.length) return empty('Waiting for agents to join.');
  return `<ol class="standings">${game.standings.map((row, index) => `<li><span class="rank">${String(index + 1).padStart(2, '0')}</span><strong>${escape(row.name)}</strong><span class="standing-points">${xp(row.score)} <small>XP</small></span></li>`).join('')}</ol>`;
}

function tv() {
  if (!game) return `${header('LIVE FEED', 'TV scoreboard', escape(openingError || (code ? 'Contacting headquarters…' : 'Enter a game code to watch the live rankings.')))}
    <form id="tv-form" class="panel form-panel"><label>Game code<input name="code" required pattern="[0-9A-Fa-f]{6}" maxlength="6" placeholder="A1B2C3" value="${escape(code)}"></label><button class="primary">Open scoreboard</button></form>`;
  const reveal = game.reveal?.[game.revealIndex];
  return `<div class="tv-header">${header('LIVE FEED · ' + game.code, game.phase === 'revealed' ? 'Mission reveal' : 'TV scoreboard', game.phase === 'open' ? 'Standings update as agents report in.' : 'Final standings')}
    <button class="secondary" data-action="sound" aria-pressed="${sound}">${icon('volume')} ${sound ? 'Mute sound' : 'Enable sound'}</button></div>
    <div class="tv-alert" role="status">${alertEvent ? `<strong>${escape(alertEvent.name)}</strong> completed a mission <span>+${alertEvent.points} XP</span>` : ''}</div>
    <div class="dashboard"><section class="panel">
    <h2>Standings</h2>${standings()}</section>
    <aside><section class="panel briefing"><div class="kicker">${game.phase === 'open' ? 'TIME REMAINING' : 'OPERATION STATUS'}</div>
    <h3 ${game.phase === 'open' ? 'data-clock' : ''}>${game.phase === 'open' ? countdown() : phaseLabel()}</h3>
    ${game.phase === 'open' ? `${qr()}<p>Scan to join · ${game.code}</p>` : ''}</section></aside></div>
    ${reveal ? `<section class="panel reveal"><div class="kicker">AGENT ${game.revealIndex + 1} OF ${game.reveal.length}</div><h2>${escape(reveal.name)}’s missions</h2><ul>${reveal.missions.map(mission => `<li><strong>${escape(mission.title)}</strong><span>${escape(mission.description)}</span><small>${mission.state === 'active' ? 'In progress at cutoff' : mission.state}</small></li>`).join('')}</ul></section>` : ''}`;
}

function render() {
  app.classList.toggle('tv-view', page === 'tv');
  app.innerHTML = page === 'host' ? host() : page === 'tv' ? tv() : agent();
}

async function request(path = '', data, useToken = page === 'host' ? hostToken : page === 'agent' ? playerToken : null) {
  const response = await fetch(apiBase + '/api/games' + path, {
    method: data ? 'POST' : 'GET',
    headers: { ...(useToken ? { Authorization: 'Bearer ' + useToken } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Live play requires a reachable game API. You can still try the demo.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function flash(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 3500);
}

function chime(delay = 0) {
  if (!audio || audio.state !== 'running') return;
  [540, 800, 1080].forEach((frequency, index) => {
    const start = audio.currentTime + delay + index * .065;
    const note = audio.createOscillator();
    const gain = audio.createGain();
    note.type = 'triangle';
    note.frequency.value = frequency;
    gain.gain.setValueAtTime(0.001, start);
    gain.gain.exponentialRampToValueAtTime(0.19, start + .012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + .12);
    note.connect(gain).connect(audio.destination);
    note.start(start);
    note.stop(start + .13);
  });
}

async function refresh() {
  if (!/^[0-9A-F]{6}$/.test(code) || pending || refreshing) return;
  const now = Date.now();
  const reachedCutoff = game?.phase === 'open' && now >= game.cutoff;
  if (now < nextRead && !reachedCutoff) return;
  refreshing = true;
  const version = actionVersion;
  try {
    const next = await request('/' + code);
    if (pending || version !== actionVersion) return;
    if (page === 'tv') {
      const latest = next.events.at(-1)?.sequence || 0;
      if (lastSequence !== null) {
        const arrivals = next.events.filter(item => item.sequence > lastSequence);
        if (arrivals.length) {
          alertEvent = arrivals.at(-1);
          clearTimeout(alertTimer);
          alertTimer = setTimeout(() => {
            alertEvent = null;
            document.querySelector('.tv-alert').textContent = '';
          }, 6500);
          if (sound) arrivals.forEach((_, index) => chime(index * .24));
        }
      }
      lastSequence = latest;
    }
    if (JSON.stringify(game) !== JSON.stringify(next)) {
      game = next;
      render();
    }
  } catch (error) {
    if (!game && openingError !== error.message) {
      openingError = error.message;
      render();
    }
  } finally {
    const interval = game?.phase === 'revealed' && page === 'agent' ? 60000
      : page === 'tv' ? 1200 : page === 'host' ? 4000 : 12000;
    nextRead = Date.now() + interval;
    refreshing = false;
  }
}

app.addEventListener('submit', async event => {
  event.preventDefault();
  if (pending) return;
  const form = new FormData(event.target);
  const id = event.target.id;
  pending = true;
  actionVersion++;
  try {
    if (id === 'host-form') {
      const result = await request('', { cutoff: new Date(form.get('cutoff')).getTime() }, null);
      localStorage.setItem('gobble-host-' + result.code, result.token);
      localStorage.setItem('gobble-last-host', result.code);
      location.href = gameLink('host', result.code);
    } else if (id === 'join-form') {
      const result = await request('/' + code + '/join', { name: form.get('name'), family: form.has('family') }, null);
      playerToken = result.token;
      localStorage.setItem('gobble-agent-' + code, playerToken);
      game = result;
      render();
    } else if (id === 'code-form' || id === 'tv-form') {
      const enteredCode = form.get('code').trim().toUpperCase();
      location.href = id === 'tv-form' ? gameLink('tv', enteredCode) : joinLink(enteredCode);
    }
  } catch (error) {
    flash(error.message);
  } finally {
    pending = false;
  }
});

app.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action],button[data-result]');
  if (!button || pending) return;
  const { action, result, id, step } = button.dataset;
  if (result === 'abandoned' && !window.confirm('Abandon this mission for a 25 XP penalty?')) return;
  pending = true;
  actionVersion++;
  button.disabled = true;
  try {
    if (result) {
      if (game) {
        game = await request('/' + code + '/mission', { assignmentId: id, result });
      } else {
        const index = demo.missions.findIndex(item => item.assignmentId === id);
        if (index < 0) return;
        demo.score += result === 'completed' ? demo.missions[index].points : -25;
        if (result === 'completed') demo.completed++;
        demo.missions.splice(index, 1, { ...demoCards[demoNext % demoCards.length], assignmentId: 'demo-' + demoNext });
        demoNext++;
      }
      flash(result === 'completed' ? 'Mission completed.' : 'Mission abandoned. −25 XP');
    } else if (action === 'sound') {
      if (!sound) {
        audio ||= new AudioContext();
        await audio.resume();
        sound = true;
        chime();
      } else {
        sound = false;
        await audio.suspend();
      }
    } else if (action === 'copy') {
      await navigator.clipboard.writeText(new URL(joinLink(), location.href).href);
      flash('Join link copied.');
      return;
    } else {
      game = await request('/' + code + '/' + action, action === 'advance' ? { step: Number(step) } : {});
    }
    render();
  } catch (error) {
    flash(error.message);
  } finally {
    pending = false;
    button.disabled = false;
  }
});

render();
refresh();
setInterval(refresh, 1200);
setInterval(() => document.querySelectorAll('[data-clock]').forEach(element => { element.textContent = countdown(); }), 250);
