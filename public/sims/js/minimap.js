const LOCATION_POSITIONS = {
  arena:  { x: 0,   z: 0,   w: 20, d: 20, color: '#ff4444' },
  shop:   { x: 40,  z: 0,   w: 14, d: 10, color: '#44aa44' },
  social: { x: -40, z: 0,   w: 14, d: 14, color: '#4444ff' },
  cafe:   { x: 20,  z: 30,  w: 10, d: 10, color: '#aa8844' },
  gym:    { x: -20, z: 30,  w: 12, d: 12, color: '#aa44aa' },
};

export class Minimap {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap-canvas';
    this.canvas.width = 180;
    this.canvas.height = 180;
    document.getElementById('hud').appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.agents = [];
    // World coords: roughly -100 to +100 for x, -40 to +80 for z
    this.scale = 180 / 200;
    this.offsetX = 100;
    this.offsetZ = 50;
    this._onClick = null;
  }

  update(agents) {
    this.agents = agents;
    this.render();
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 180, 180);

    // Background
    ctx.fillStyle = 'rgba(10, 10, 30, 0.8)';
    ctx.fillRect(0, 0, 180, 180);
    ctx.strokeStyle = 'rgba(255, 107, 53, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 180, 180);

    // Roads
    ctx.strokeStyle = 'rgba(44, 62, 80, 0.6)';
    ctx.lineWidth = 3;
    // Horizontal
    const roadZ = this._toMapZ(15);
    ctx.beginPath();
    ctx.moveTo(0, roadZ);
    ctx.lineTo(180, roadZ);
    ctx.stroke();
    // Vertical
    const roadX = this._toMapX(0);
    ctx.beginPath();
    ctx.moveTo(roadX, 0);
    ctx.lineTo(roadX, 180);
    ctx.stroke();

    // Buildings
    for (const [id, loc] of Object.entries(LOCATION_POSITIONS)) {
      const mx = this._toMapX(loc.x);
      const mz = this._toMapZ(loc.z);
      const mw = loc.w * this.scale;
      const md = loc.d * this.scale;
      ctx.fillStyle = loc.color;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(mx - mw / 2, mz - md / 2, mw, md);
      ctx.globalAlpha = 1;
      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = '8px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(id.toUpperCase(), mx, mz + 3);
    }

    // Agent dots
    for (const agent of this.agents) {
      const pos = this._agentMapPos(agent);
      ctx.beginPath();
      ctx.arc(pos.x, pos.z, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = agent.character_color || '#ff6b35';
      ctx.fill();
      // Traveling agents get a ring
      if (agent.current_location === 'traveling') {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }

  _toMapX(worldX) {
    return (worldX + this.offsetX) * this.scale;
  }

  _toMapZ(worldZ) {
    return (worldZ + this.offsetZ) * this.scale;
  }

  _agentMapPos(agent) {
    const seed = agent.agent_id * 137.5;
    const spread = 8;
    let baseX, baseZ;

    if (agent.current_location === 'traveling' && agent.target_location) {
      const loc = LOCATION_POSITIONS[agent.target_location] || { x: 0, z: 0 };
      baseX = loc.x;
      baseZ = loc.z;
    } else {
      const loc = LOCATION_POSITIONS[agent.current_location] || { x: 0, z: 0 };
      baseX = loc.x;
      baseZ = loc.z;
    }

    return {
      x: this._toMapX(baseX + Math.sin(seed) * spread),
      z: this._toMapZ(baseZ + Math.cos(seed * 1.3) * spread),
    };
  }

  setupClickHandler(flyToFn) {
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const mz = e.clientY - rect.top;
      const worldX = (mx / this.scale) - this.offsetX;
      const worldZ = (mz / this.scale) - this.offsetZ;
      flyToFn(worldX, worldZ);
    });
  }
}
