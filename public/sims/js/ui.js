const MOOD_EMOJI = {
  ecstatic: '&#129321;',
  happy: '&#128522;',
  neutral: '&#128528;',
  uncomfortable: '&#128533;',
  miserable: '&#128557;',
  crisis: '&#128561;',
};

const ACTIVITY_EMOJI = {
  eating: '&#127828;', sleeping: '&#128164;', socializing: '&#128172;',
  training: '&#128170;', browsing: '&#128722;', flexing: '&#128293;',
  showering: '&#128703;', roasting: '&#128293;', resting: '&#9749;',
  performing: '&#127908;', traveling: '&#128694;', idle: '&#129300;',
};

const NEED_COLORS = {
  energy: '#ffdd00',
  hunger: '#ff8844',
  social: '#44aaff',
  fun: '#ff44aa',
  clout: '#aa44ff',
  hygiene: '#44ffaa',
};

const STREAM_ICONS = {
  thought: '\u{1F4AD}',
  speech: '\u{1F4AC}',
  action: '\u26A1',
  movement: '\u{1F6B6}',
  arrival: '\u{1F4CD}',
  plan: '\u{1F4CB}',
  chat: '\u{1F4AC}',
  event: '\u{1F525}',
  viral_tweet: '\u{1F4F1}',
  beef: '\u{1F91C}',
  drama: '\u{1F3AD}',
  windfall: '\u{1F4B0}',
  burnout: '\u{1F6AB}',
  prank: '\u{1F921}',
  mentorship: '\u{1F393}',
  collab: '\u{1F91D}',
  // Initiative events
  challenge_issued: '\u2694\uFE0F',
  challenge_resolved: '\u{1F3C6}',
  challenge_play: '\u{1F3AF}',
  crew_formed: '\u{1F91D}',
  crew_leadership: '\u{1F451}',
  event_hosted: '\u{1F389}',
  event_concluded: '\u{1F3C1}',
  goal_set: '\u{1F3AF}',
  goal_completed: '\u{1F31F}',
  // World building events
  structure_built: '\u{1F3D7}\uFE0F',
  structure_destroyed: '\u{1F4A5}',
  territory_claimed: '\u{1F6A9}',
  territory_expired: '\u{1F3F3}\uFE0F',
};

export class UI {
  constructor() {
    this.agentListEl = document.getElementById('agent-list');
    this.streamEl = document.getElementById('activity-stream');
    this.selectedEl = document.getElementById('hud-selected');
    this.selectedContentEl = document.getElementById('selected-content');
    this.kingNameEl = document.getElementById('king-name');
    this.agentCountEl = document.getElementById('agent-count');
    this.speechContainer = document.getElementById('speech-container');
    this.tickerTrack = document.getElementById('ticker-track');
    this.maxStreamItems = 50;
    this._paused = false;
    this._crews = [];
    this._goals = {};
    this._memories = {};

    // Pause auto-scroll on hover
    if (this.streamEl) {
      this.streamEl.addEventListener('mouseenter', () => { this._paused = true; });
      this.streamEl.addEventListener('mouseleave', () => { this._paused = false; });
    }
  }

  updateAgentList(agents) {
    // Build crew lookup
    const crewLookup = {};
    for (const crew of this._crews) {
      if (crew.members) {
        for (const m of crew.members) {
          crewLookup[m.agent_id] = { name: crew.name, color: crew.color };
        }
      }
    }

    this.agentListEl.innerHTML = agents.map(a => {
      const crew = crewLookup[a.agent_id];
      const crewBadge = crew
        ? `<span class="agent-crew-badge" style="background:${crew.color}">${this._truncate(crew.name, 8)}</span>`
        : '';
      return `
        <div class="agent-entry" data-id="${a.agent_id}" onclick="window._selectAgent && window._selectAgent(${a.agent_id})">
          <div class="agent-dot" style="background: ${a.character_color || '#ff6b35'}"></div>
          <div class="agent-info">
            <span class="agent-name">${this._truncate(a.name, 12)}${crewBadge}</span>
            <span class="agent-activity">${ACTIVITY_EMOJI[a.current_activity] || ''} ${a.current_activity || 'idle'}</span>
          </div>
          <span class="agent-mood">${MOOD_EMOJI[a.mood] || ''}</span>
        </div>
      `;
    }).join('');

    this._agents = agents;
    window._selectAgent = (id) => {
      const agent = this._agents.find(a => a.agent_id === id);
      if (agent) this.showAgentPanel(agent);
    };
  }

  updateKing(hill) {
    if (hill && hill.king_name) {
      this.kingNameEl.innerHTML = `${hill.king_name} <small>(${hill.defended_count || 0} defenses)</small>`;
    } else {
      this.kingNameEl.textContent = 'No King';
    }
  }

  updateAgentCount(count) {
    this.agentCountEl.textContent = `${count} agents`;
  }

  showAgentPanel(agent) {
    this.selectedEl.classList.remove('hidden');

    const needs = ['energy', 'hunger', 'social', 'fun', 'clout', 'hygiene'];
    const activityEmoji = ACTIVITY_EMOJI[agent.current_activity] || '';

    // Find crew for this agent
    let crewHtml = '';
    for (const crew of this._crews) {
      if (crew.members && crew.members.find(m => m.agent_id === agent.agent_id)) {
        const role = crew.leader_id === agent.agent_id ? 'Leader' : 'Member';
        crewHtml = `<div class="panel-crew"><span class="crew-dot" style="background:${crew.color}"></span>${crew.name} (${role})</div>`;
        break;
      }
    }

    // Goal info
    let goalHtml = '';
    const goal = this._goals[agent.agent_id];
    if (goal) {
      const pct = goal.target_value > 0 ? Math.min(100, Math.round((goal.current_value / goal.target_value) * 100)) : 0;
      goalHtml = `
        <div class="panel-goal">
          <div class="panel-goal-label">Active Goal</div>
          <div>${goal.description || goal.type}</div>
          <div class="goal-bar"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
          <div style="font-size:0.65rem;color:#666;margin-top:2px">${goal.current_value}/${goal.target_value} (${pct}%)</div>
        </div>
      `;
    }

    // Memory info
    let memoryHtml = '';
    const memories = this._memories[agent.agent_id];
    if (memories && memories.length > 0) {
      memoryHtml = `
        <div class="panel-memories">
          <h4>Recent Memories</h4>
          ${memories.slice(0, 5).map(m => {
            const cls = m.sentiment > 0.3 ? 'memory-positive' : m.sentiment < -0.3 ? 'memory-negative' : '';
            return `<div class="memory-item ${cls}">${this._escapeHtml(m.description || m.event_type)}</div>`;
          }).join('')}
        </div>
      `;
    }

    this.selectedContentEl.innerHTML = `
      <div class="panel-name">${agent.name}</div>
      <div class="panel-rank">${agent.rank} &bull; ${agent.points} pts &bull; ${agent.simcoins || 0} SC</div>
      ${crewHtml}
      <div class="panel-mood">${MOOD_EMOJI[agent.mood] || ''} ${agent.mood || 'neutral'} &bull; ${activityEmoji} ${agent.current_activity || 'idle'}</div>
      ${agent.current_location ? `<div class="panel-location">&#128205; ${agent.current_location}${agent.target_location ? ' &rarr; ' + agent.target_location : ''}</div>` : ''}
      ${agent.x_handle ? `<div style="font-size:0.8rem;color:#4fc3f7;margin-bottom:8px;">@${agent.x_handle}</div>` : ''}

      ${goalHtml}

      <div style="margin-bottom:12px;">
        ${needs.map(n => `
          <div class="need-bar-container">
            <div class="need-label">${n} <span style="float:right;color:#666">${Math.round(agent[n] || 0)}%</span></div>
            <div class="need-bar">
              <div class="need-bar-fill" style="width:${agent[n] || 0}%;background:${NEED_COLORS[n]}"></div>
            </div>
          </div>
        `).join('')}
      </div>

      ${memoryHtml}

      <div class="panel-hint">Double-click agent in 3D to follow</div>
    `;
  }

  // --- Activity Stream ---
  addStreamItem(type, data) {
    if (!this.streamEl) return;

    const item = document.createElement('div');
    item.className = `stream-item stream-${type}`;

    const icon = STREAM_ICONS[type] || '\u2022';
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let content = '';
    switch (type) {
      case 'thought':
        content = `<span class="stream-agent">${data.agent_name}</span> <span class="stream-thought">${data.text}</span>`;
        break;
      case 'speech':
        content = `<span class="stream-speech">${this._escapeHtml(data.text)}</span>`;
        break;
      case 'plan':
        content = `<span class="stream-agent">${data.agent_name}</span> <span class="stream-plan">${data.text}</span>`;
        break;
      case 'action':
        content = `<span class="stream-agent">${data.agent_name}</span> <span class="stream-action-text">${data.title}</span>`;
        break;
      case 'movement':
        content = `<span class="stream-agent">${data.agent_name}</span> <span class="stream-movement-text">${data.title}</span>`;
        break;
      case 'arrival':
        content = `<span class="stream-agent">${data.agent_name}</span> <span class="stream-arrival-text">${data.title}</span>`;
        break;
      case 'chat':
        content = `<span class="stream-agent">${data.agent_name}</span> <span class="stream-chat-text">${data.title || ''}</span>`;
        break;
      default:
        content = `${data.agent_name ? `<span class="stream-agent">${data.agent_name}</span> ` : ''}<span>${data.title || data.text || ''}</span>`;
    }

    item.innerHTML = `
      <span class="stream-icon">${icon}</span>
      <span class="stream-time">${time}</span>
      ${content}
    `;

    // Add entry animation
    item.style.opacity = '0';
    item.style.transform = 'translateX(-10px)';
    this.streamEl.prepend(item);

    requestAnimationFrame(() => {
      item.style.transition = 'opacity 0.3s, transform 0.3s';
      item.style.opacity = '1';
      item.style.transform = 'translateX(0)';
    });

    // Trim old entries
    while (this.streamEl.children.length > this.maxStreamItems) {
      this.streamEl.removeChild(this.streamEl.lastChild);
    }

    // Auto-scroll to top if not paused
    if (!this._paused) {
      this.streamEl.scrollTop = 0;
    }
  }

  showSpeechBubble(text, x, y, agentName) {
    const bubble = document.createElement('div');
    bubble.className = 'speech-bubble';
    bubble.textContent = text.slice(0, 100);
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y - 30}px`;

    this.speechContainer.appendChild(bubble);
    setTimeout(() => bubble.remove(), 5000);
  }

  showThoughtBubble(text, x, y, agentName) {
    const bubble = document.createElement('div');
    bubble.className = 'thought-bubble';
    bubble.innerHTML = `\u{1F4AD} <em>${this._escapeHtml(text.slice(0, 80))}</em>`;
    bubble.style.left = `${x}px`;
    bubble.style.top = `${y - 50}px`;

    this.speechContainer.appendChild(bubble);
    setTimeout(() => bubble.remove(), 4000);
  }

  // --- Headlines Ticker ---
  updateHeadlines(headlines) {
    if (!this.tickerTrack || !headlines || headlines.length === 0) return;
    this.tickerTrack.innerHTML = headlines.map(h =>
      `<span class="ticker-item"><span class="ticker-dot">\u{1F4E2}</span>${this._escapeHtml(h.text || h)}</span>`
    ).join('');
  }

  // --- Initiative Data ---
  updateCrews(crews) {
    this._crews = crews || [];
  }

  updateGoals(goals) {
    // goals is an array, convert to lookup by agent_id
    this._goals = {};
    if (goals) {
      for (const g of goals) {
        this._goals[g.agent_id] = g;
      }
    }
  }

  updateMemories(memories) {
    // memories is a map { agentId: [...] }
    this._memories = memories || {};
  }

  _truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '...' : str;
  }

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
